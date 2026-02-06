/**
 * CameraControls - Smooth orbital camera controls
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class CameraControls {
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement;
        this.controls = null;

        this.setup();
    }

    setup() {
        // Use Three.js OrbitControls for smooth interaction
        this.controls = new OrbitControls(this.camera, this.domElement);

        // Configure controls
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;

        // Pan settings
        this.controls.enablePan = true;
        this.controls.panSpeed = 0.8;
        this.controls.screenSpacePanning = false; // Pan parallel to ground

        // Zoom settings (scaled for large resort terrain)
        this.controls.enableZoom = true;
        this.controls.zoomSpeed = 1.2;
        this.controls.minDistance = 20;
        this.controls.maxDistance = 5000;

        // Rotation settings
        this.controls.enableRotate = true;
        this.controls.rotateSpeed = 0.5;

        // Limit vertical angle (don't go underground)
        this.controls.minPolarAngle = 0.2; // ~11 degrees from top
        this.controls.maxPolarAngle = Math.PI / 2 - 0.1; // ~85 degrees

        // Set target (look at center of terrain)
        this.controls.target.set(0, 0, -400);

        // Smooth key controls
        this.controls.keys = {
            LEFT: 'ArrowLeft',
            UP: 'ArrowUp',
            RIGHT: 'ArrowRight',
            BOTTOM: 'ArrowDown'
        };
        this.controls.keyPanSpeed = 20;

        // Initial update
        this.controls.update();
    }

    update() {
        if (this.controls) {
            this.controls.update();
        }
    }

    // Focus camera on a specific point
    focusOn(position, distance = 30) {
        this.controls.target.copy(position);

        // Animate camera to new position
        const direction = this.camera.position.clone()
            .sub(this.controls.target)
            .normalize()
            .multiplyScalar(distance);

        this.camera.position.copy(position).add(direction);
        this.camera.position.y = Math.max(position.y + 10, this.camera.position.y);
    }

    // Reset to default view - shows entire mountain
    reset() {
        this.camera.position.set(0, 2000, 3500);
        this.controls.target.set(0, 0, -400);
        this.controls.update();
    }

    // Set camera to a preset view (scaled for large resort)
    setView(view) {
        const views = {
            'top': { pos: [0, 4000, 0.1], target: [0, 0, 0] },
            'front': { pos: [0, 600, 3000], target: [0, 100, 0] },
            'side': { pos: [3000, 600, 0], target: [0, 100, 0] },
            'default': { pos: [0, 2000, 3500], target: [0, 0, -400] }
        };

        const v = views[view] || views.default;
        this.camera.position.set(...v.pos);
        this.controls.target.set(...v.target);
        this.controls.update();
    }

    // Enable/disable controls
    setEnabled(enabled) {
        this.controls.enabled = enabled;
    }

    // Set sculpt mode - disable left-click rotation but allow two-finger/right-click
    setSculptMode(enabled) {
        if (enabled) {
            // In sculpt mode: right-click/two-finger for rotate, middle for pan
            this.controls.mouseButtons = {
                LEFT: null, // Disable left-click rotation (used for sculpting)
                MIDDLE: THREE.MOUSE.PAN,
                RIGHT: THREE.MOUSE.ROTATE // Two-finger on trackpad = right-click
            };
            // Also allow touch rotation with two fingers
            this.controls.touches = {
                ONE: null, // Single touch disabled (used for sculpting)
                TWO: THREE.TOUCH.DOLLY_ROTATE // Two-finger for zoom and rotate
            };
        } else {
            // Normal mode: standard controls
            this.controls.mouseButtons = {
                LEFT: THREE.MOUSE.ROTATE,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.PAN
            };
            this.controls.touches = {
                ONE: THREE.TOUCH.ROTATE,
                TWO: THREE.TOUCH.DOLLY_PAN
            };
        }
    }
}
