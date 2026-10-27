/**
 * SceneManager - renderer, camera, render loop, quality tiers and post-processing.
 *
 * Also installs the "atmospheric fog" shader patch (see installAtmosphericFog):
 * every built-in material's fog picks up a warm in-scatter tint toward the sun
 * so the haze reads peach toward the sun and periwinkle away from it, and the
 * sky dome's horizon band uses the exact same formula so they meet seamlessly.
 */

import * as THREE from 'three';
import { events } from '../core/events.js';
import { QUALITY_LEVELS, getQuality, getPreset, setQuality as setGlobalQuality } from '../core/quality.js';
import { PostFX } from './PostFX.js';

/* ------------------------------------------------------------------ */
/* Atmospheric fog (global, shared by every material that uses fog)   */
/* ------------------------------------------------------------------ */

/**
 * Plain {x,y,z} objects on purpose: UniformsUtils.clone() copies Vector3/Color
 * values per material but keeps plain objects by reference, and WebGLUniforms
 * uploads any object with x/y/z to a vec3. So every material shares these and
 * Environment can animate them by writing the fields.
 * Colors are linear RGB.
 */
export const fogAtmosphere = {
    sunDir: { x: -0.79, y: 0.18, z: -0.84 },  // horizon-centric sun direction (normalized)
    sunColor: { x: 0.9, y: 0.6, z: 0.38 },    // in-scatter colour toward the sun
    params: { x: 0.75, y: 5.0, z: 0.0 },      // x = strength, y = exponent
};

let fogInstalled = false;
export function installAtmosphericFog() {
    if (fogInstalled) return;
    fogInstalled = true;

    const C = THREE.ShaderChunk;
    C.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
    varying float vFogDepth;
    varying vec3 vFogWorldDir;
#endif
`;
    C.fog_vertex = /* glsl */`
#ifdef USE_FOG
    vFogDepth = - mvPosition.z;
    vFogWorldDir = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif
`;
    C.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
    uniform vec3 fogColor;
    uniform vec3 fogSunDir;
    uniform vec3 fogSunColor;
    uniform vec3 fogSunParams;
    varying float vFogDepth;
    varying vec3 vFogWorldDir;
    #ifdef FOG_EXP2
        uniform float fogDensity;
    #else
        uniform float fogNear;
        uniform float fogFar;
    #endif
    // Fog colour for this fragment including the warm in-scatter toward the sun.
    // Custom fog code (e.g. DistantRanges) should use this instead of fogColor.
    vec3 alpineFogColor() {
        vec3 fogViewDir = normalize( vFogWorldDir + vec3( 0.0, 1e-5, 0.0 ) );
        float fogSunAmt = pow( max( dot( fogViewDir, fogSunDir ), 0.0 ), max( fogSunParams.y, 1.0 ) ) * fogSunParams.x;
        return mix( fogColor, fogSunColor, clamp( fogSunAmt, 0.0, 1.0 ) );
    }
#endif
`;
    C.fog_fragment = /* glsl */`
#ifdef USE_FOG
    #ifdef FOG_EXP2
        float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
        float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb = mix( gl_FragColor.rgb, alpineFogColor(), fogFactor );
#endif
`;

    const extra = () => ({
        fogSunDir: { value: fogAtmosphere.sunDir },
        fogSunColor: { value: fogAtmosphere.sunColor },
        fogSunParams: { value: fogAtmosphere.params },
    });
    Object.assign(THREE.UniformsLib.fog, extra());
    for (const key of Object.keys(THREE.ShaderLib)) {
        const u = THREE.ShaderLib[key] && THREE.ShaderLib[key].uniforms;
        if (u && u.fogColor) Object.assign(u, extra());
    }
}

// Patch as early as possible: before any other module builds a ShaderMaterial
// that merges UniformsLib.fog, and before the first compile.
installAtmosphericFog();

/* ------------------------------------------------------------------ */

const AUTOTUNE_WARMUP = 5;       // seconds after start / after a change before measuring
const AUTOTUNE_WINDOW = 4;       // seconds of sustained slowness
const AUTOTUNE_LIMIT_MS = 24;
const AUTOTUNE_MAX_STEPS = 2;

export class SceneManager {
    constructor(canvasId) {
        this.canvasId = canvasId;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = null;
        this.onUpdate = null;
        this.postFX = null;
        this.quality = getQuality();
        this.preset = getPreset(this.quality);

        this._running = false;
        this.paused = false;
        this._autoTune = { steps: 0, cooldown: AUTOTUNE_WARMUP, acc: 0, frames: 0, slowTime: 0 };
        this._unsubs = [];
    }

    async init() {
        this.scene = new THREE.Scene();
        // Environment owns colour/density after construction; these are the Alpenglow day values.
        this.scene.fog = new THREE.FogExp2(0xc4d2e4, 0.00016);

        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.5,
            16000
        );
        this.camera.position.set(0, 1500, 2550);
        this.camera.lookAt(0, 60, -250);

        const canvas = document.getElementById(this.canvasId);
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,            // used by the low tier (no composer)
            alpha: false,
            powerPreference: 'high-performance',
            stencil: false,
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(this._pixelRatio());
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.setClearColor(0xc4d2e4);
        this.renderer.info.autoReset = false; // reset once per frame in renderFrame()

        this.clock = new THREE.Clock();

        this._buildPost();

        this._unsubs.push(events.on('quality:change', ({ level }) => this._applyQuality(level)));

        // Phones (and the Overworld's iframe) also resize on rotation and when the
        // browser chrome or on-screen keyboard shows/hides; re-check after rotation settles.
        window.addEventListener('resize', () => this.onResize());
        window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 250));
        window.visualViewport?.addEventListener('resize', () => this.onResize());
        document.addEventListener('visibilitychange', () => {
            // A hidden tab produces huge deltas; never let them count as "slow"
            this._resetAutoTune(2);
            if (this.clock) this.clock.getDelta();
        });

        return this;
    }

    /* ---------------- quality ---------------- */

    _pixelRatio() {
        let cap = this.preset.pixelRatioCap || 1;
        // Big retina canvases are fill-rate bound with MSAA + post: past ~2600
        // device px wide, 1.5x is visually indistinguishable and far cheaper.
        const dpr = window.devicePixelRatio || 1;
        // Phones: thousands of trees + shadows + post at 3x DPR is too much at any tier.
        if (cap > 1.5 && this._coarse()) cap = 1.5;
        if (cap > 1.5 && window.innerWidth * Math.min(dpr, cap) > 2600) cap = 1.5;
        return Math.min(dpr, cap);
    }

    _coarse() {
        try { return window.matchMedia('(pointer: coarse)').matches; } catch (e) { return false; }
    }

    _buildPost() {
        if (this.postFX) {
            this.postFX.dispose();
            this.postFX = null;
        }
        if (!this.preset.post) return;
        if (!PostFX.isSupported(this.renderer)) {
            console.warn('[Alpine Dreams] HalfFloat render targets unsupported, using the low quality tier');
            this.preset = getPreset('low');
            this.quality = 'low';
            setGlobalQuality('low', { persist: false });
            return;
        }
        try {
            this.postFX = new PostFX(this.renderer, this.scene, this.camera, this.preset);
            this.postFX.setSize(window.innerWidth, window.innerHeight);
        } catch (err) {
            console.warn('[Alpine Dreams] Post-processing unavailable, using the low quality tier:', err);
            if (this.postFX) { try { this.postFX.dispose(); } catch (e) { /* ignore */ } }
            this.postFX = null;
            this.preset = getPreset('low');
            this.quality = 'low';
            setGlobalQuality('low', { persist: false });
        }
    }

    /** Public: change the tier (persisted). Rebuilds post and pixel ratio. */
    setQuality(level, { persist = true } = {}) {
        if (!QUALITY_LEVELS.includes(level)) return this.quality;
        if (level === getQuality()) {
            // Global already there (e.g. picked at load) but make sure we match it
            if (level !== this.quality) this._applyQuality(level);
            return this.quality;
        }
        setGlobalQuality(level, { persist }); // emits quality:change -> _applyQuality
        return this.quality;
    }

    _applyQuality(level) {
        if (!this.renderer) return;
        this.quality = level;
        this.preset = getPreset(level);
        this.renderer.setPixelRatio(this._pixelRatio());
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        const night = this.postFX ? this.postFX.isNight : false;
        const sunDir = this.postFX ? this.postFX.sunDirection.clone() : null;
        const sunVis = this.postFX ? this.postFX.sunVisibility : 1;
        this._buildPost();
        if (this.postFX) {
            this.postFX.setNight(night, { instant: true });
            if (sunDir) this.postFX.setSunDirection(sunDir);
            this.postFX.setSunVisibility(sunVis);
        }
        this._resetAutoTune(AUTOTUNE_WARMUP);
    }

    _resetAutoTune(cooldown) {
        const a = this._autoTune;
        a.cooldown = Math.max(a.cooldown, cooldown);
        a.acc = 0; a.frames = 0; a.slowTime = 0;
    }

    _autoTuneStep(delta) {
        const a = this._autoTune;
        if (a.steps >= AUTOTUNE_MAX_STEPS) return;
        if (typeof navigator !== 'undefined' && navigator.webdriver) return; // headless/test harness
        if (document.hidden || delta > 0.25) return;
        if (a.cooldown > 0) { a.cooldown -= delta; return; }

        a.acc += delta; a.frames++;
        if (a.acc < 0.5) return;
        const avgMs = (a.acc / a.frames) * 1000;
        if (avgMs > AUTOTUNE_LIMIT_MS) a.slowTime += a.acc; else a.slowTime = 0;
        a.acc = 0; a.frames = 0;

        if (a.slowTime >= AUTOTUNE_WINDOW) {
            const idx = QUALITY_LEVELS.indexOf(this.quality);
            if (idx <= 0) { a.steps = AUTOTUNE_MAX_STEPS; return; }
            const next = QUALITY_LEVELS[idx - 1];
            a.steps++;
            // Session-only: a single slow window (GC, background tab work) must not
            // lower the tier for every future visit. Only user picks persist.
            this.setQuality(next, { persist: false });
            events.emit('ui:toast', {
                text: `Graphics set to ${next} for smoother play`,
                kind: 'info',
            });
        }
    }

    /* ---------------- loop ---------------- */

    onResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        if (!width || !height) return;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setPixelRatio(this._pixelRatio());
        this.renderer.setSize(width, height);
        if (this.postFX) this.postFX.setSize(width, height);
        // Resizing clears the canvas; while paused, redraw the frozen frame.
        if (this.paused) this.renderFrame(0);
    }

    /**
     * Freeze (Overworld pause): no simulation, no camera, no rendering. On
     * resume the paused time is dropped so physics doesn't jump.
     */
    setPaused(paused) {
        paused = !!paused;
        if (paused === this.paused) return;
        this.paused = paused;
        if (!paused && this.clock) {
            this.clock.getDelta();
            this._resetAutoTune(2);
        }
    }

    start() {
        if (this._running) return;
        this._running = true;
        this.clock.getDelta();
        this.animate();
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.paused) return;

        const rawDelta = this.clock.getDelta();
        const delta = Math.min(rawDelta, 0.1); // keep physics stable after hitches

        if (this.onUpdate) {
            this.onUpdate(delta);
        }

        this.renderFrame(delta);
        this._autoTuneStep(rawDelta);
    }

    renderFrame(delta = 0) {
        // Count the whole frame (shadow + scene + post passes) in renderer.info
        this.renderer.info.reset();
        if (this.postFX) {
            try {
                this.postFX.render(delta);
                return;
            } catch (err) {
                console.warn('[Alpine Dreams] Post-processing failed, falling back to direct rendering:', err);
                try { this.postFX.dispose(); } catch (e) { /* ignore */ }
                this.postFX = null;
            }
        }
        this.renderer.render(this.scene, this.camera);
    }

    getSceneCenter() {
        return new THREE.Vector3(0, 5, 0);
    }

    /** Captures the final (post-processed) frame and downloads it. */
    screenshot() {
        this.renderFrame(0);
        const dataUrl = this.renderer.domElement.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `alpine-dreams-${Date.now()}.png`;
        link.href = dataUrl;
        link.click();
        return dataUrl;
    }
}
