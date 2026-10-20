/**
 * Environment - the single owner of fog, clear colour and exposure.
 *
 * Drives smooth day <-> night (~1.2s) and blizzard blends across Lighting, Sky,
 * the atmospheric fog in-scatter, PostFX and (at the blend midpoint) Snow,
 * DistantRanges and ObjectPlacer night modes.
 *
 * Blizzard visibility depends on the camera mode: the editor still shows the
 * resort silhouette, ski mode drops visibility dramatically (listens to
 * ski:start / ski:end).
 */

import * as THREE from 'three';
import { events } from '../core/events.js';
import { fogAtmosphere } from './SceneManager.js';
import { DAY_SUN_DIRECTION, MOON_DIRECTION } from './Lighting.js';

const NIGHT_BLEND_SECONDS = 1.2;
const BLIZZARD_BLEND_SECONDS = 1.6;
const SKI_BLEND_SECONDS = 1.0;

const FOG = {
    day: new THREE.Color(0xc4d2e4),
    night: new THREE.Color(0x0f1a30),
    blizzardDay: new THREE.Color(0xc5cfdb),
    blizzardNight: new THREE.Color(0x1b2539),
    dayDensity: 0.00007,
    nightDensity: 0.0001,
    blizzardEditorDensity: 0.0002,
    blizzardSkiDensity: 0.0017,
    skiDensityScale: 1.0,
};

const HAZE = {
    day: new THREE.Color(0xf5c08e),
    night: new THREE.Color(0x2c3d68),
    dayStrength: 0.65,
    nightStrength: 0.5,
    exponent: 6.0,
};

const EXPOSURE = { day: 1.0, night: 0.85, blizzard: 1.05 };

const easeInOut = (t) => t * t * (3 - 2 * t);

const _fog = new THREE.Color();
const _c = new THREE.Color();
const _haze = new THREE.Vector3();
const _moonDisc = new THREE.Vector3();

export class Environment {
    constructor({ sceneManager, lighting, sky, snow = null, distantRanges = null, objectPlacer = null, postFX = null } = {}) {
        this.sceneManager = sceneManager;
        this.lighting = lighting;
        this.sky = sky;
        this.snow = snow;
        this.distantRanges = distantRanges;
        this.objectPlacer = objectPlacer;
        this._postFX = postFX;

        this.sunDirection = DAY_SUN_DIRECTION.clone();
        this.daySunDirection = DAY_SUN_DIRECTION.clone();
        this.moonLightDirection = MOON_DIRECTION.clone();

        this._night = false;
        this._blizzard = false;
        this._skiing = false;

        // animated 0..1 values
        this.night = 0;
        this.blizzard = 0;
        this.ski = 0;
        this._nightFrom = 0; this._nightP = 1;
        this._blizFrom = 0; this._blizP = 1;
        this._skiFrom = 0; this._skiP = 1;
        this._midpointFired = true;

        if (this.lighting) this.lighting._driven = true;

        this._unsubs = [
            events.on('ski:start', () => this._setSkiing(true)),
            events.on('ski:end', () => this._setSkiing(false)),
        ];

        this._apply(true);
    }

    get isNight() { return this._night; }
    get isBlizzard() { return this._blizzard; }

    get postFX() {
        return (this.sceneManager && this.sceneManager.postFX) || this._postFX || null;
    }
    set postFX(v) { this._postFX = v; }

    setNight(enabled, { instant = false } = {}) {
        enabled = !!enabled;
        if (enabled === this._night && !instant) return;
        this._night = enabled;
        this._nightFrom = this.night;
        this._nightP = instant ? 1 : 0;
        this._midpointFired = false;
        if (instant) {
            this.night = enabled ? 1 : 0;
            this._fireMidpoint();
        }
        this.postFX?.setNight?.(enabled, { instant });
        if (this.lighting) this.lighting.isNight = enabled;
        if (this.sky) this.sky.isNight = enabled;
        this._apply(true);
        events.emit('env:night', { night: enabled });
    }

    setBlizzard(enabled) {
        enabled = !!enabled;
        if (enabled === this._blizzard) return;
        this._blizzard = enabled;
        this._blizFrom = this.blizzard;
        this._blizP = 0;
        events.emit('env:blizzard', { on: enabled });
    }

    _setSkiing(on) {
        if (on === this._skiing) return;
        this._skiing = on;
        this._skiFrom = this.ski;
        this._skiP = 0;
    }

    _fireMidpoint() {
        if (this._midpointFired) return;
        this._midpointFired = true;
        const b = this._night;
        try { this.snow?.setNightMode?.(b); } catch (e) { console.error(e); }
        try { this.distantRanges?.setNightMode?.(b); } catch (e) { console.error(e); }
        try { this.objectPlacer?.setNightMode?.(b); } catch (e) { console.error(e); }
    }

    update(delta) {
        const dt = Math.min(delta || 0, 0.1);
        let changed = false;

        if (this._nightP < 1) {
            this._nightP = Math.min(1, this._nightP + dt / NIGHT_BLEND_SECONDS);
            const to = this._night ? 1 : 0;
            this.night = this._nightFrom + (to - this._nightFrom) * easeInOut(this._nightP);
            if (this._nightP >= 0.5) this._fireMidpoint();
            changed = true;
        }
        if (this._blizP < 1) {
            this._blizP = Math.min(1, this._blizP + dt / BLIZZARD_BLEND_SECONDS);
            const to = this._blizzard ? 1 : 0;
            this.blizzard = this._blizFrom + (to - this._blizFrom) * easeInOut(this._blizP);
            changed = true;
        }
        if (this._skiP < 1) {
            this._skiP = Math.min(1, this._skiP + dt / SKI_BLEND_SECONDS);
            const to = this._skiing ? 1 : 0;
            this.ski = this._skiFrom + (to - this._skiFrom) * easeInOut(this._skiP);
            changed = true;
        }

        if (changed) this._apply(false);
    }

    _apply(force) {
        const n = this.night;
        const b = this.blizzard;
        const sm = this.sceneManager;

        // --- light direction: sweep from sun to moon
        this.sunDirection.copy(this.daySunDirection).lerp(this.moonLightDirection, n).normalize();
        if (this.lighting) {
            this.lighting.setSunDirection(this.sunDirection);
            this.lighting.applyBlend(n, b);
        }

        // --- fog
        _fog.copy(FOG.day).lerp(FOG.night, n);
        _c.copy(FOG.blizzardDay).lerp(FOG.blizzardNight, n);
        _fog.lerp(_c, b);
        const baseDensity = THREE.MathUtils.lerp(FOG.dayDensity, FOG.nightDensity, n);
        const blizDensity = THREE.MathUtils.lerp(FOG.blizzardEditorDensity, FOG.blizzardSkiDensity, this.ski);
        const density = THREE.MathUtils.lerp(baseDensity, blizDensity, b);

        if (sm && sm.scene) {
            const scene = sm.scene;
            if (!scene.fog || !scene.fog.isFogExp2) scene.fog = new THREE.FogExp2(_fog.getHex(), density);
            scene.fog.color.copy(_fog);
            scene.fog.density = density;
        }
        if (sm && sm.renderer) {
            sm.renderer.setClearColor(_fog);
            sm.renderer.toneMappingExposure =
                THREE.MathUtils.lerp(THREE.MathUtils.lerp(EXPOSURE.day, EXPOSURE.night, n), EXPOSURE.blizzard, b * (1 - n));
        }

        // --- fog in-scatter toward the sun (day) / moon (night)
        _moonDisc.copy(this.sky ? this.sky.moonDirection : this.moonLightDirection);
        _haze.copy(this.daySunDirection).lerp(_moonDisc, n);
        _haze.y *= 0.35;
        _haze.normalize();
        fogAtmosphere.sunDir.x = _haze.x;
        fogAtmosphere.sunDir.y = _haze.y;
        fogAtmosphere.sunDir.z = _haze.z;
        _c.copy(HAZE.day).lerp(HAZE.night, n);
        // in a blizzard the haze collapses toward the flat fog colour
        _c.lerp(_fog, b * 0.8);
        fogAtmosphere.sunColor.x = _c.r;
        fogAtmosphere.sunColor.y = _c.g;
        fogAtmosphere.sunColor.z = _c.b;
        fogAtmosphere.params.x = THREE.MathUtils.lerp(HAZE.dayStrength, HAZE.nightStrength, n) * (1 - 0.75 * b);
        fogAtmosphere.params.y = HAZE.exponent;

        // --- sky
        if (this.sky) {
            this.sky.setSunDirection?.(this.daySunDirection);
            this.sky.setFogColor?.(_fog);
            if (typeof this.sky.applyBlend === 'function') this.sky.applyBlend(n, b);
        }

        // --- post
        const post = this.postFX;
        if (post) {
            post.setSunDirection?.(this.daySunDirection);
            post.setSunVisibility?.((1 - n) * (1 - b));
        }
    }

    dispose() {
        this._unsubs.forEach((off) => off());
        this._unsubs = [];
    }
}
