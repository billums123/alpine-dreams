/**
 * Lighting - "Alpenglow" light rig.
 *
 * Day: a low, warm golden-hour sun (the only shadow caster), a hemisphere
 * light for sky/snow bounce, and a weak cool back-fill opposite the sun.
 * Night: the same lights re-tinted as moonlight.
 *
 * The shadow camera follows a focus point (orbit target in the editor, the
 * skier in ski mode) with texel snapping so shadows don't shimmer.
 *
 * Environment drives day/night/blizzard blends through applyBlend(night, blizzard).
 */

import * as THREE from 'three';
import { events } from '../core/events.js';
import { getPreset } from '../core/quality.js';

const DAY = {
    // Strong warm key over a weaker, bluer sky fill: lit snow glows cream,
    // shaded snow drops clearly into blue (a strong hemi flattened it to milk).
    sunColor: new THREE.Color(0xffdfbc),
    sunIntensity: 3.4,
    hemiSky: new THREE.Color(0x7c9fda),
    hemiGround: new THREE.Color(0xa9bad2),
    hemiIntensity: 1.0,
    fillColor: new THREE.Color(0x7f9ff0),
    fillIntensity: 0.22,
};

// Night: a brighter, whiter moon key over a dimmer, cooler fill gives the
// slopes real light/shade contrast instead of a flat monochrome navy.
const NIGHT = {
    sunColor: new THREE.Color(0xc4d4f4),
    sunIntensity: 1.25,
    hemiSky: new THREE.Color(0x2a3c68),
    hemiGround: new THREE.Color(0x141d33),
    hemiIntensity: 0.42,
    fillColor: new THREE.Color(0x3d58a0),
    fillIntensity: 0.1,
};

const BLIZZARD = {
    sunScale: 0.45,        // overcast: the key light is mostly blocked
    hemiBoost: 1.25,
    hemiSky: new THREE.Color(0xc2ccd8),
};

export const DAY_SUN_DIRECTION = new THREE.Vector3(-0.62, 0.42, -0.66).normalize();
// Lower, side-on moon: rakes across the slopes so night terrain keeps its form.
export const MOON_DIRECTION = new THREE.Vector3(0.66, 0.52, 0.1).normalize();

const SHADOW_DISTANCE = 2200;   // how far "up the sun ray" the shadow camera sits

const _tmp = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _snapped = new THREE.Vector3();
const _c = new THREE.Color();

export class Lighting {
    constructor(scene) {
        this.scene = scene;
        this.lights = {};
        this.isNight = false;
        this.nightAmount = 0;
        this.blizzardAmount = 0;

        this.sunDirection = DAY_SUN_DIRECTION.clone();
        this.focus = new THREE.Vector3(0, 0, -400);
        this.shadowHalfSize = 1100;
        this._appliedHalfSize = -1;

        // Kept for backwards compatibility with anything that read it
        this.daySettings = {
            sun: { color: DAY.sunColor.getHex(), intensity: DAY.sunIntensity },
            hemisphere: { skyColor: DAY.hemiSky.getHex(), groundColor: DAY.hemiGround.getHex(), intensity: DAY.hemiIntensity },
        };
        this._unsubs = [];
    }

    setup() {
        const preset = getPreset();

        // Key light: sun / moon. The only shadow caster.
        const sun = new THREE.DirectionalLight(DAY.sunColor, DAY.sunIntensity);
        sun.name = 'sunLight';
        sun.castShadow = true;
        sun.shadow.mapSize.set(preset.shadowMapSize || 2048, preset.shadowMapSize || 2048);
        sun.shadow.camera.near = 1;
        sun.shadow.camera.far = SHADOW_DISTANCE * 2;
        sun.shadow.bias = -0.0004;
        sun.shadow.normalBias = 0.6;
        this.scene.add(sun);
        this.scene.add(sun.target);
        this.lights.sun = sun;

        // Sky / snow bounce
        this.lights.hemisphere = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemiIntensity);
        this.lights.hemisphere.name = 'skyFill';
        this.scene.add(this.lights.hemisphere);

        // Weak cool back-fill opposite the sun (no shadows)
        this.lights.fill = new THREE.DirectionalLight(DAY.fillColor, DAY.fillIntensity);
        this.lights.fill.name = 'backFill';
        this.scene.add(this.lights.fill);
        this.scene.add(this.lights.fill.target);

        // Legacy handles: some code may still poke these. They are not in the scene.
        this.lights.ambient = new THREE.AmbientLight(0xffffff, 0);
        this.lights.rim = this.lights.fill;

        this.setShadowFocus(this.focus, this.shadowHalfSize);
        this.applyBlend(0, 0);

        this._unsubs.push(events.on('quality:change', ({ preset: p }) => {
            const size = (p && p.shadowMapSize) || 2048;
            this.setShadowMapSize(size);
        }));
    }

    /** Resize the shadow map live (quality tier change). Never above 2048. */
    setShadowMapSize(size) {
        const sun = this.lights.sun;
        if (!sun) return;
        size = Math.min(2048, size);
        if (sun.shadow.mapSize.x === size) return;
        sun.shadow.mapSize.set(size, size);
        if (sun.shadow.map) {
            sun.shadow.map.dispose();
            sun.shadow.map = null;
        }
        this._appliedHalfSize = -1;
        this._updateShadowCamera();
    }

    /** Direction toward the sun/moon (world, normalized). */
    setSunDirection(dir) {
        if (!dir) return;
        this.sunDirection.copy(dir).normalize();
        this._updateShadowCamera();
    }

    /**
     * Keep the shadow camera centred on `target` (editor orbit target or skier).
     * halfSize ~140 in ski mode (crisp), ~900 in the editor (soft but present).
     */
    setShadowFocus(target, halfSize) {
        if (target) this.focus.copy(target);
        if (typeof halfSize === 'number' && halfSize > 0) this.shadowHalfSize = halfSize;
        this._updateShadowCamera();
    }

    _updateShadowCamera() {
        const sun = this.lights.sun;
        if (!sun) return;
        const cam = sun.shadow.camera;
        const half = this.shadowHalfSize;

        if (half !== this._appliedHalfSize) {
            cam.left = -half;
            cam.right = half;
            cam.top = half;
            cam.bottom = -half;
            cam.updateProjectionMatrix();
            this._appliedHalfSize = half;
        }

        // Light-space basis
        const dir = this.sunDirection;
        _right.set(0, 1, 0).cross(dir);
        if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
        _right.normalize();
        _up.copy(dir).cross(_right).normalize();

        // Texel snapping: quantize the focus in the light's right/up plane
        const texel = (2 * half) / sun.shadow.mapSize.x;
        const f = this.focus;
        const rx = Math.round(f.dot(_right) / texel) * texel;
        const uy = Math.round(f.dot(_up) / texel) * texel;
        const d = f.dot(dir);
        _snapped.copy(_right).multiplyScalar(rx)
            .addScaledVector(_up, uy)
            .addScaledVector(dir, d);

        sun.target.position.copy(_snapped);
        sun.position.copy(_snapped).addScaledVector(dir, SHADOW_DISTANCE);
        sun.target.updateMatrixWorld();
        sun.updateMatrixWorld();

        // Bias scales with texel size so both the 140 and 900 frusta stay clean
        sun.shadow.normalBias = Math.max(0.04, texel * 0.9);

        const fill = this.lights.fill;
        if (fill) {
            fill.target.position.copy(_snapped);
            _tmp.set(-dir.x, Math.max(0.35, dir.y), -dir.z).normalize();
            fill.position.copy(_snapped).addScaledVector(_tmp, 1000);
            fill.target.updateMatrixWorld();
        }
    }

    /**
     * Blend the rig. night/blizzard are 0..1.
     * Called by Environment every frame during a transition.
     */
    applyBlend(night, blizzard = 0) {
        this.nightAmount = night;
        this.blizzardAmount = blizzard;
        const L = this.lights;
        if (!L.sun) return;

        L.sun.color.copy(DAY.sunColor).lerp(NIGHT.sunColor, night);
        // Dip through dusk: the key light dims more in the middle of the blend
        const dusk = 1 - 0.35 * Math.sin(Math.PI * night);
        L.sun.intensity = THREE.MathUtils.lerp(DAY.sunIntensity, NIGHT.sunIntensity, night) * dusk
            * THREE.MathUtils.lerp(1, BLIZZARD.sunScale, blizzard);

        L.hemisphere.color.copy(DAY.hemiSky).lerp(NIGHT.hemiSky, night);
        _c.copy(BLIZZARD.hemiSky).lerp(NIGHT.hemiSky, night);
        L.hemisphere.color.lerp(_c, blizzard * 0.7);
        L.hemisphere.groundColor.copy(DAY.hemiGround).lerp(NIGHT.hemiGround, night);
        L.hemisphere.intensity = THREE.MathUtils.lerp(DAY.hemiIntensity, NIGHT.hemiIntensity, night)
            * THREE.MathUtils.lerp(1, BLIZZARD.hemiBoost, blizzard);

        L.fill.color.copy(DAY.fillColor).lerp(NIGHT.fillColor, night);
        L.fill.intensity = THREE.MathUtils.lerp(DAY.fillIntensity, NIGHT.fillIntensity, night);
    }

    /** Snap to day or night (Environment animates; this is the instant form). */
    setNightMode(enabled) {
        this.isNight = !!enabled;
        this.applyBlend(enabled ? 1 : 0, this.blizzardAmount);
        // Standalone use (no Environment): also move the light
        if (!this._driven) {
            this.setSunDirection(enabled ? MOON_DIRECTION : DAY_SUN_DIRECTION);
        }
    }

    /** Legacy helper (unused by the app): 0 = dawn .. 1 = dusk. */
    setTimeOfDay(time) {
        const a = THREE.MathUtils.clamp(time, 0, 1) * Math.PI;
        _tmp.set(Math.cos(a) * -0.8, Math.max(0.12, Math.sin(a) * 0.8), -0.6).normalize();
        this.setSunDirection(_tmp);
    }

    dispose() {
        this._unsubs.forEach((off) => off());
        this._unsubs = [];
    }
}
