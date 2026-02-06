/**
 * Alpine Dreams - Ski Resort Builder
 * Main entry point
 */

import { SceneManager } from './scene/SceneManager.js';
import { Lighting } from './scene/Lighting.js';
import { Sky } from './scene/Sky.js';
import { Snow } from './scene/Snow.js';
import { Mountain } from './terrain/Mountain.js';
import { Trees } from './terrain/Trees.js';
import { ObjectPlacer } from './controls/ObjectPlacer.js';
import { CameraControls } from './controls/CameraControls.js';
import { Skier } from './objects/Skier.js';
import { UI } from './ui/UI.js';
import { Music } from './audio/Music.js';

class AlpineDreams {
    constructor() {
        this.sceneManager = null;
        this.lighting = null;
        this.sky = null;
        this.snow = null;
        this.mountain = null;
        this.trees = null;
        this.objectPlacer = null;
        this.cameraControls = null;
        this.skier = null;
        this.ui = null;
        this.music = null;

        this.isInitialized = false;
        this.isNight = false;
    }

    async init() {
        try {
            // Initialize scene manager
            this.sceneManager = new SceneManager('canvas');
            await this.sceneManager.init();

            // Set up lighting
            this.lighting = new Lighting(this.sceneManager.scene);
            this.lighting.setup();

            // Create sky and atmosphere
            this.sky = new Sky(this.sceneManager.scene);
            this.sky.create();

            // Generate mountain terrain
            this.mountain = new Mountain(this.sceneManager.scene);
            this.mountain.generate();

            // Add trees
            this.trees = new Trees(this.sceneManager.scene, this.mountain);
            this.trees.populate();

            // Set up snow particles
            this.snow = new Snow(this.sceneManager.scene);
            this.snow.create();

            // Initialize camera controls
            this.cameraControls = new CameraControls(
                this.sceneManager.camera,
                this.sceneManager.renderer.domElement
            );

            // Initialize object placer
            this.objectPlacer = new ObjectPlacer(
                this.sceneManager.scene,
                this.sceneManager.camera,
                this.sceneManager.renderer.domElement,
                this.mountain
            );

            // Initialize skier
            this.skier = new Skier(
                this.sceneManager.scene,
                this.mountain,
                this.sceneManager.camera,
                this.cameraControls
            );
            this.skier.trees = this.trees;

            // Initialize UI
            this.ui = new UI(this.objectPlacer, this.snow, this.sceneManager, this.mountain, this.skier, this.trees, this.cameraControls);
            this.ui.init();

            // Initialize background music (starts on first user interaction)
            this.music = new Music();
            this.music.init();

            // Music toggle button
            const musicBtn = document.getElementById('btn-toggle-music');
            if (musicBtn) {
                musicBtn.addEventListener('click', () => {
                    const muted = this.music.toggleMute();
                    musicBtn.textContent = muted ? '🔇' : '🔊';
                    musicBtn.title = muted ? 'Unmute Music' : 'Mute Music';
                });
            }

            // Track switch button
            const trackBtn = document.getElementById('btn-switch-track');
            if (trackBtn) {
                trackBtn.addEventListener('click', () => {
                    this.music.toggleTrack();
                    const trackName = this.music.getTrackName();
                    trackBtn.title = `Switch Track: ${trackName}`;
                });
            }

            // Day/night toggle via N key
            window.addEventListener('keydown', (e) => {
                if (e.key === 'n' || e.key === 'N') {
                    // Don't hijack typing in input fields
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                    this.toggleNightMode();
                }
            });

            // Start render loop
            this.sceneManager.onUpdate = (delta) => this.update(delta);
            this.sceneManager.start();

            this.isInitialized = true;

            // Hide loading screen
            setTimeout(() => {
                document.getElementById('loading-screen').classList.add('hidden');
            }, 500);

            console.log('🏔️ Alpine Dreams initialized successfully!');
        } catch (error) {
            console.error('Failed to initialize Alpine Dreams:', error);
        }
    }

    toggleNightMode() {
        this.isNight = !this.isNight;

        if (this.lighting) this.lighting.setNightMode(this.isNight);
        if (this.sky) this.sky.setNightMode(this.isNight);
        if (this.snow) this.snow.setNightMode(this.isNight);

        // Update fog and clear color
        const scene = this.sceneManager.scene;
        const renderer = this.sceneManager.renderer;
        if (this.isNight) {
            scene.fog.color.setHex(0x0a1525);
            scene.fog.density = 0.00025;
            renderer.setClearColor(0x050a15);
            renderer.toneMappingExposure = 0.7;
        } else {
            scene.fog.color.setHex(0x9bb5ce);
            scene.fog.density = 0.00018;
            renderer.setClearColor(0x87ceeb);
            renderer.toneMappingExposure = 1.0;
        }
    }

    update(delta) {
        // Update snow particles
        if (this.snow) {
            this.snow.update(delta);
        }

        // Update sky (star twinkle, cloud drift)
        if (this.sky) {
            this.sky.update(delta);
        }

        // Update skier (if active, handles its own camera)
        if (this.skier && this.skier.isActive) {
            this.skier.update(delta);
        } else {
            // Update camera controls only when not skiing
            if (this.cameraControls) {
                this.cameraControls.update();
            }
        }

        // Update object placer (for animations)
        if (this.objectPlacer) {
            this.objectPlacer.update(delta);
        }
    }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new AlpineDreams();
    app.init();

    // Expose for debugging
    window.alpineDreams = app;
});
