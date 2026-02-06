/**
 * SceneManager - Core Three.js scene setup and render loop
 */

import * as THREE from 'three';

export class SceneManager {
    constructor(canvasId) {
        this.canvasId = canvasId;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = null;
        this.onUpdate = null;
    }

    async init() {
        // Create scene
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x9bb5ce, 0.00035); // Denser fog to soften world boundary

        // Create camera - positioned to see entire mountain
        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.5,
            20000
        );
        // Position camera high and back to see the whole resort
        this.camera.position.set(0, 2000, 3500);
        this.camera.lookAt(0, 0, -400);

        // Create renderer
        const canvas = document.getElementById(this.canvasId);
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: false
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.8;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        // Set clear color (will be covered by sky)
        this.renderer.setClearColor(0x87ceeb);

        // Create clock for delta time
        this.clock = new THREE.Clock();

        // Handle window resize
        window.addEventListener('resize', () => this.onResize());

        return this;
    }

    onResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    start() {
        this.animate();
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();

        // Call update callback if defined
        if (this.onUpdate) {
            this.onUpdate(delta);
        }

        this.renderer.render(this.scene, this.camera);
    }

    // Helper to get scene center point
    getSceneCenter() {
        return new THREE.Vector3(0, 5, 0);
    }

    // Take a screenshot
    screenshot() {
        this.renderer.render(this.scene, this.camera);
        const dataUrl = this.renderer.domElement.toDataURL('image/png');

        // Create download link
        const link = document.createElement('a');
        link.download = `alpine-dreams-${Date.now()}.png`;
        link.href = dataUrl;
        link.click();
    }
}
