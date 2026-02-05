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
import { UI } from './ui/UI.js';

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
        this.ui = null;

        this.isInitialized = false;
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

            // Initialize UI
            this.ui = new UI(this.objectPlacer, this.snow, this.sceneManager);
            this.ui.init();

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

    update(delta) {
        // Update snow particles
        if (this.snow) {
            this.snow.update(delta);
        }

        // Update camera controls
        if (this.cameraControls) {
            this.cameraControls.update();
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
