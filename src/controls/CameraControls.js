/**
 * CameraControls - editor orbit camera with eased fly-to transitions.
 *
 * Public API (see DESIGN_BRIEF §3.2 / §3.3):
 *   constructor(camera, domElement)
 *   controls                      OrbitControls (Skier reads controls.target)
 *   update(delta?)                call every frame while the editor camera is live
 *   setEnabled(bool), setSculptMode(bool)
 *   reset(), setView(name)        both animate through flyTo
 *   focusOn(pos, dist)
 *   setAutoRotate(enabled, speed = 0.25)   speed in radians / second
 *   flyTo(position, target, duration = 1.2, { fov, arc } = {}) -> Promise<void>
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEFAULT_POS = new THREE.Vector3(0, 1500, 2550);
const DEFAULT_TARGET = new THREE.Vector3(0, 60, -250);

const VIEWS = {
    // 'top' keeps a small z offset so the min polar angle (0.2 rad) doesn't snap it after the flight.
    top: { pos: [0, 4000, 850], target: [0, 0, 0] },
    front: { pos: [0, 600, 3000], target: [0, 100, 0] },
    side: { pos: [3000, 600, 0], target: [0, 100, 0] },
    default: { pos: [DEFAULT_POS.x, DEFAULT_POS.y, DEFAULT_POS.z], target: [DEFAULT_TARGET.x, DEFAULT_TARGET.y, DEFAULT_TARGET.z] },
};

// easeInOutCubic, but with a slightly softer landing so arrivals feel "settled".
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class CameraControls {
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement;
        this.controls = null;

        this._fly = null;           // active flight state
        this._lastTime = performance.now();
        this._tmpDir = new THREE.Vector3();
        this._tmpPos = new THREE.Vector3();

        this.setup();
    }

    setup() {
        const c = new OrbitControls(this.camera, this.domElement);
        this.controls = c;

        c.enableDamping = true;
        c.dampingFactor = 0.06;

        c.enablePan = true;
        c.panSpeed = 0.8;
        c.screenSpacePanning = false; // pan parallel to the ground

        c.enableZoom = true;
        c.zoomSpeed = 1.1;
        c.zoomToCursor = true;        // r161: dolly toward the pointer
        c.minDistance = 20;
        c.maxDistance = 5000;

        c.enableRotate = true;
        c.rotateSpeed = 0.5;

        c.minPolarAngle = 0.2;
        c.maxPolarAngle = Math.PI / 2 - 0.1;

        c.target.copy(DEFAULT_TARGET);

        // Arrow keys are used by the editor to rotate objects, so OrbitControls
        // never listens to the keyboard (listenToKeyEvents is not called).
        c.keys = { LEFT: 'ArrowLeft', UP: 'ArrowUp', RIGHT: 'ArrowRight', BOTTOM: 'ArrowDown' };
        c.keyPanSpeed = 20;

        c.autoRotate = false;

        // Any user input cancels an in-flight camera move and the idle orbit.
        c.addEventListener('start', () => {
            this.cancelFly();
            if (c.autoRotate) c.autoRotate = false;
        });

        c.update();
    }

    /**
     * @param {number} [delta] seconds since last frame (optional, measured if omitted)
     */
    update(delta) {
        const now = performance.now();
        let dt = typeof delta === 'number' && isFinite(delta) ? delta : (now - this._lastTime) / 1000;
        this._lastTime = now;
        dt = Math.min(Math.max(dt, 0), 0.1);

        if (!this.controls) return;

        if (this._fly) {
            this._stepFly(dt);
            return;
        }

        // OrbitControls.update(deltaTime) uses deltaTime for autoRotate (r155+).
        this.controls.update(dt);
    }

    _stepFly(dt) {
        const f = this._fly;
        f.t = Math.min(1, f.t + dt / f.duration);
        const e = easeInOutCubic(f.t);

        this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
        this._tmpPos.lerpVectors(f.fromPos, f.toPos, e);
        // Gentle arc so long flights don't skim the terrain.
        this._tmpPos.y += Math.sin(Math.PI * e) * f.arc;
        this.camera.position.copy(this._tmpPos);

        if (f.fromFov !== null) {
            this.camera.fov = THREE.MathUtils.lerp(f.fromFov, f.toFov, e);
            this.camera.updateProjectionMatrix();
        }

        this.camera.lookAt(this.controls.target);

        if (f.t >= 1) {
            this._fly = null;
            // Sync OrbitControls' internal spherical state with the new pose.
            this.controls.update(0);
            f.resolve();
        }
    }

    /**
     * Eased camera flight. Resolves when it arrives (or is cancelled by user input).
     * @returns {Promise<void>}
     */
    flyTo(position, target, duration = 1.2, opts = {}) {
        this.cancelFly();
        const toPos = position.clone ? position.clone() : new THREE.Vector3(...position);
        const toTarget = target.clone ? target.clone() : new THREE.Vector3(...target);
        const fromPos = this.camera.position.clone();
        const fromTarget = this.controls.target.clone();
        const travel = fromPos.distanceTo(toPos);

        const reduced = typeof window !== 'undefined' && window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        const hasFov = typeof opts.fov === 'number';
        if (duration <= 0 || reduced || travel < 0.01 && fromTarget.distanceTo(toTarget) < 0.01) {
            this.camera.position.copy(toPos);
            this.controls.target.copy(toTarget);
            if (hasFov) {
                this.camera.fov = opts.fov;
                this.camera.updateProjectionMatrix();
            }
            this.controls.update(0);
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            this._fly = {
                t: 0,
                duration,
                fromPos, toPos, fromTarget, toTarget,
                arc: typeof opts.arc === 'number' ? opts.arc : Math.min(travel * 0.12, 400),
                fromFov: hasFov ? this.camera.fov : null,
                toFov: hasFov ? opts.fov : null,
                resolve,
            };
        });
    }

    get isFlying() {
        return !!this._fly;
    }

    /** Where the active flight ends ({position, target, fov|null}), or null. */
    flightDestination() {
        const f = this._fly;
        if (!f) return null;
        return { position: f.toPos, target: f.toTarget, fov: f.toFov };
    }

    cancelFly() {
        const f = this._fly;
        if (!f) return;
        this._fly = null;
        if (f.toFov !== null) {
            this.camera.fov = f.toFov;
            this.camera.updateProjectionMatrix();
        }
        f.resolve();
    }

    setAutoRotate(enabled, speed = 0.25) {
        if (!this.controls) return;
        this.controls.autoRotate = !!enabled;
        // OrbitControls: angle per second = 2π/60 * autoRotateSpeed
        this.controls.autoRotateSpeed = (speed * 60) / (2 * Math.PI);
    }

    // Focus camera on a specific point (animated).
    focusOn(position, distance = 30) {
        const dir = this._tmpDir.copy(this.camera.position).sub(this.controls.target);
        if (dir.lengthSq() < 1e-6) dir.set(0, 0.5, 1);
        dir.normalize().multiplyScalar(distance);
        const toPos = position.clone().add(dir);
        toPos.y = Math.max(position.y + 10, toPos.y);
        return this.flyTo(toPos, position.clone(), 0.9);
    }

    /**
     * Fly to a 3/4 view that frames a world-space Box3 (e.g. a freshly
     * generated resort). `dir` is the view direction from target to camera.
     */
    frameBox(box, { dir = new THREE.Vector3(0.42, 0.52, 0.74), padding = 1.05, duration = 1.6 } = {}) {
        if (!box || box.isEmpty()) return Promise.resolve();
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const radius = 0.5 * Math.hypot(size.x, size.z) * padding;
        const vfov = THREE.MathUtils.degToRad(this.camera.fov || 60);
        const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (this.camera.aspect || 1.6));
        const fit = Math.min(vfov, hfov);
        const dist = Math.max(600, radius / Math.sin(fit / 2));
        center.y = box.min.y + size.y * 0.3;
        const toPos = center.clone().add(dir.clone().normalize().multiplyScalar(dist));
        return this.flyTo(toPos, center, duration);
    }

    // Reset to default view - shows the whole mountain.
    reset() {
        return this.flyTo(DEFAULT_POS, DEFAULT_TARGET, 1.2);
    }

    setView(view) {
        const v = VIEWS[view] || VIEWS.default;
        return this.flyTo(new THREE.Vector3(...v.pos), new THREE.Vector3(...v.target), 1.2);
    }

    setEnabled(enabled) {
        if (!enabled) this.cancelFly();
        this.controls.enabled = enabled;
    }

    // Sculpt mode: left button sculpts, right/two-finger rotates, middle pans.
    setSculptMode(enabled) {
        if (enabled) {
            this.controls.mouseButtons = {
                LEFT: null,
                MIDDLE: THREE.MOUSE.PAN,
                RIGHT: THREE.MOUSE.ROTATE,
            };
            this.controls.touches = {
                ONE: null,
                TWO: THREE.TOUCH.DOLLY_ROTATE,
            };
        } else {
            this.controls.mouseButtons = {
                LEFT: THREE.MOUSE.ROTATE,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.PAN,
            };
            this.controls.touches = {
                ONE: THREE.TOUCH.ROTATE,
                TWO: THREE.TOUCH.DOLLY_PAN,
            };
        }
    }
}
