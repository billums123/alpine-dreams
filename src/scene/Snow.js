/**
 * Snow - GPU-animated falling snow ("Alpenglow" art direction)
 *
 * Every flake position is computed in the vertex shader from a per-flake seed
 * plus CPU-accumulated fall/wind offsets, wrapped inside a box that follows the
 * camera (so the snow field is infinite and has real parallax). Zero per-flake
 * CPU work per frame.
 *
 * Two nested layers in one draw call: a dense "near" layer of small flakes
 * around the lens (ski mode), and a sparse "far" layer of larger flakes that
 * reads from the high editor camera.
 *
 * Blizzard: density x2.5 (extra flakes fade in), faster fall, strong slanted
 * gusting wind, flakes stretch into streaks along their screen-space motion.
 * Blizzard does NOT touch scene.fog (Environment owns fog).
 */

import * as THREE from 'three';
import { getPreset } from '../core/quality.js';
import { events } from '../core/events.js';

const MAX_BASE_COUNT = 3000;    // high preset count
const BLIZZARD_MULT = 2.5;
const NEAR_SHARE = 0.62;        // share of flakes in the near layer
const NEAR_RANGE = 42;          // half-size of near box (world units)
const FAR_RANGE = 900;          // half-size of far box

const vertexShader = /* glsl */`
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uFallOffset;     // x: wind x, y: fall, z: wind z (accumulated)
uniform float uBlizzard;      // 0..1
uniform float uVisible;       // fraction of flakes visible (base / total)
uniform float uScale;         // px per world unit at distance 1
uniform vec3 uWindDir;        // current wind velocity (for streak direction)

attribute vec4 aSeed;         // xyz: position seed 0..1, w: visibility rank 0..1
attribute vec4 aProps;        // x: range (half-size), y: size, z: speed mul, w: phase

varying float vAlpha;
varying vec2 vStreak;         // screen-space streak direction * stretch
varying float vStretch;

#include <fog_pars_vertex>

void main() {
    float R = aProps.x;
    float speed = aProps.z;
    float phase = aProps.w;

    // Local wobble (gentle when calm, damped in blizzard)
    float wob = 1.0 - uBlizzard * 0.7;
    vec3 wobble = vec3(
        sin(uTime * (0.6 + speed * 0.7) + phase) * 0.9,
        0.0,
        cos(uTime * (0.5 + speed * 0.6) + phase * 1.7) * 0.7
    ) * wob * (R < 200.0 ? 0.35 : 3.0);

    vec3 travel = vec3(uFallOffset.x, -uFallOffset.y, uFallOffset.z) * speed;
    vec3 p = aSeed.xyz * (2.0 * R) + travel + wobble;

    // Wrap into a box of size 2R centered on the camera
    vec3 rel = mod(p - uCam + R, 2.0 * R) - R;
    vec3 world = uCam + rel;

    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float dist = -mvPosition.z;

    // Visibility: extra blizzard flakes fade in by rank
    float vis = 1.0 - smoothstep(uVisible - 0.04, uVisible + 0.04, aSeed.w);

    // Fade at the box boundary (no popping when wrapping) and right at the lens
    float edge = 1.0 - smoothstep(0.72, 1.0, length(rel) / R);
    // Flakes inside ~5 units would be huge soft discs (lens dust); fade them out.
    float nearFade = smoothstep(2.5, 6.0, dist);

    // Streak: project wind+fall velocity into screen space
    vec3 vel = uWindDir * (0.6 + 0.4 * speed) + vec3(0.0, -1.0, 0.0) * (6.0 + 10.0 * uBlizzard) * speed;
    vec4 clipB = projectionMatrix * (mvPosition + viewMatrix * vec4(vel * 0.06, 0.0));
    vec2 sA = gl_Position.xy / max(gl_Position.w, 1e-3);
    vec2 sB = clipB.xy / max(clipB.w, 1e-3);
    vec2 sd = sB - sA;
    float sl = length(sd);
    vStreak = sl > 1e-5 ? sd / sl : vec2(0.0, -1.0);
    vStretch = 1.0 + uBlizzard * clamp(sl * 60.0, 0.0, 3.0);

    float size = aProps.y * uScale / max(dist, 0.5);
    size *= vStretch;
    gl_PointSize = clamp(size, 0.0, min(48.0, 22.0 * vStretch));

    // Sub-pixel flakes fade instead of shimmering
    float pxFade = smoothstep(0.6, 2.0, size);
    vAlpha = vis * edge * nearFade * pxFade;
    if (vAlpha < 0.002) gl_PointSize = 0.0;

    #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;

varying float vAlpha;
varying vec2 vStreak;
varying float vStretch;

#include <fog_pars_fragment>

void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    uv.y = -uv.y;
    // Rotate into streak space and squash across it
    vec2 dir = vStreak;
    float along = dot(uv, dir);
    float across = dot(uv, vec2(-dir.y, dir.x));
    float r = length(vec2(along, across * vStretch));
    float a = smoothstep(1.0, 0.15, r);
    a *= vAlpha * uOpacity;
    if (a < 0.003) discard;
    // brighter core
    vec3 col = uColor * (0.85 + 0.35 * smoothstep(0.6, 0.0, r));
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
}
`;

export class Snow {
    constructor(scene) {
        this.scene = scene;
        this.particles = null;
        this.material = null;
        this.enabled = true;

        // Blizzard mode
        this.isBlizzard = false;
        this.blizzardBlend = 0;

        this.baseCount = MAX_BASE_COUNT;
        this.particleCount = MAX_BASE_COUNT;
        this.totalCount = Math.ceil(MAX_BASE_COUNT * BLIZZARD_MULT);

        // Accumulated motion (continuous, so gust changes never jump)
        this.offset = new THREE.Vector3();
        this.wind = new THREE.Vector3();
        this.time = 0;
        this._unsub = null;

        // Legacy fields (kept for compatibility)
        this.bounds = { x: FAR_RANGE, y: FAR_RANGE * 2, z: FAR_RANGE };
        this.blizzardWindX = 0;
        this.blizzardWindZ = 0;
        this.blizzardFallMultiplier = 1;
    }

    create() {
        let count = MAX_BASE_COUNT;
        try { count = getPreset().snowCount || MAX_BASE_COUNT; } catch (e) { /* default */ }
        this.baseCount = count;
        this.particleCount = count;

        // Allocate for the largest preset in blizzard so quality changes are just uniforms
        const total = this.totalCount;
        const seeds = new Float32Array(total * 4);
        const props = new Float32Array(total * 4);
        const positions = new Float32Array(total * 3); // unused by the shader; required by three

        for (let i = 0; i < total; i++) {
            const near = Math.random() < NEAR_SHARE;
            const R = near ? NEAR_RANGE : FAR_RANGE;
            seeds[i * 4] = Math.random();
            seeds[i * 4 + 1] = Math.random();
            seeds[i * 4 + 2] = Math.random();
            seeds[i * 4 + 3] = i / total; // visibility rank (low index = always visible)
            props[i * 4] = R;
            // world-space flake size: small real flakes near, big soft flakes far
            props[i * 4 + 1] = near ? (0.09 + Math.random() * 0.14) : (1.2 + Math.random() * 1.6);
            props[i * 4 + 2] = 0.65 + Math.random() * 0.7;
            props[i * 4 + 3] = Math.random() * Math.PI * 2;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
        geometry.setAttribute('aProps', new THREE.BufferAttribute(props, 4));
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

        this.material = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.merge([
                THREE.UniformsLib.fog,
                {
                    uTime: { value: 0 },
                    uCam: { value: new THREE.Vector3() },
                    uFallOffset: { value: new THREE.Vector3() },
                    uBlizzard: { value: 0 },
                    uVisible: { value: 1 / BLIZZARD_MULT },
                    uScale: { value: 800 },
                    uWindDir: { value: new THREE.Vector3() },
                    uColor: { value: new THREE.Color(0xf4f7ff) },
                    uOpacity: { value: 0.9 },
                },
            ]),
            vertexShader,
            fragmentShader,
            transparent: true,
            depthWrite: false,
            fog: true,
            blending: THREE.NormalBlending,
        });

        this.particles = new THREE.Points(geometry, this.material);
        this.particles.frustumCulled = false;
        this.particles.name = 'snow';
        this.particles.renderOrder = 5;
        this.applyCount();
        this.scene.add(this.particles);

        // Live quality changes only touch the draw range
        try {
            this._unsub = events.on('quality:change', ({ preset } = {}) => {
                if (preset && preset.snowCount) {
                    this.baseCount = preset.snowCount;
                    this.particleCount = preset.snowCount;
                    this.applyCount();
                }
            });
        } catch (e) { /* events optional */ }
    }

    applyCount() {
        if (!this.particles) return;
        // Draw enough flakes for full blizzard at this tier; uVisible fades the extras
        const draw = Math.min(this.totalCount, Math.ceil(this.baseCount * BLIZZARD_MULT));
        this.particles.geometry.setDrawRange(0, draw);
        this._drawCount = draw;
    }

    update(delta, camera) {
        if (!this.particles) return;
        const dt = Math.min(delta || 0, 0.1);

        // Blizzard blend
        const target = this.isBlizzard ? 1 : 0;
        this.blizzardBlend += (target - this.blizzardBlend) * (1 - Math.exp(-dt * 1.6));
        const b = this.blizzardBlend;

        if (!this.enabled) return;

        this.time += dt;
        const t = this.time;

        // Wind: light breeze when calm, strong slanted gusts in blizzard
        const gust = 0.65 + 0.35 * Math.sin(t * 0.37) * Math.sin(t * 0.11 + 1.3);
        const calmX = Math.sin(t * 0.07) * 0.6 + 0.4;
        const calmZ = Math.cos(t * 0.05) * 0.4;
        const bx = (16 + 14 * gust) * (0.85 + 0.15 * Math.sin(t * 0.15));
        const bz = 6 * Math.cos(t * 0.12) + 4 * gust;
        this.wind.set(calmX + (bx - calmX) * b, 0, calmZ + (bz - calmZ) * b);
        this.blizzardWindX = this.wind.x;
        this.blizzardWindZ = this.wind.z;

        const fall = 2.4 * (1 + 1.5 * b);
        this.blizzardFallMultiplier = 1 + 1.5 * b;
        this.offset.x += this.wind.x * dt;
        this.offset.y += fall * dt;
        this.offset.z += this.wind.z * dt;
        // Keep the accumulator bounded without visible jumps:
        // all layers' box sizes divide 2*FAR_RANGE*k only approximately, so we
        // wrap at a very large period instead (float precision stays < 0.01).
        if (Math.abs(this.offset.y) > 2e5) this.offset.set(0, 0, 0);

        const u = this.material.uniforms;
        u.uTime.value = t;
        u.uFallOffset.value.copy(this.offset);
        u.uBlizzard.value = b;
        u.uVisible.value = this.baseCount * (1 + (BLIZZARD_MULT - 1) * b) / this.totalCount;
        u.uWindDir.value.copy(this.wind);
        u.uOpacity.value = 0.85 + 0.1 * b;

        if (camera) {
            u.uCam.value.copy(camera.position);
            // pixels per world unit at distance 1 (device pixels)
            let pr = 1;
            try { pr = Math.min(window.devicePixelRatio || 1, getPreset().pixelRatioCap || 2); } catch (e) { /* default */ }
            const fov = (camera.fov || 60) * Math.PI / 180;
            u.uScale.value = (window.innerHeight * pr) / (2 * Math.tan(fov / 2));
        }
    }

    toggle() {
        this.enabled = !this.enabled;
        if (this.particles) this.particles.visible = this.enabled;
        return this.enabled;
    }

    /** Toggles blizzard particles + wind only. Fog belongs to Environment. */
    toggleBlizzard() {
        this.isBlizzard = !this.isBlizzard;
        return this.isBlizzard;
    }

    setNightMode(enabled) {
        if (this.material) {
            this.material.uniforms.uColor.value.setHex(enabled ? 0xa9b8dc : 0xf4f7ff);
        }
    }

    setIntensity(intensity) {
        // 0..1 scales the visible base count
        this.baseCount = Math.max(1, Math.floor(this.particleCount * Math.max(0, Math.min(1, intensity))));
        this.applyCount();
    }

    dispose() {
        this._unsub?.();
        if (this.particles) {
            this.scene.remove(this.particles);
            this.particles.geometry.dispose();
            this.material.dispose();
        }
    }
}
