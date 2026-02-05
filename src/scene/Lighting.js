/**
 * Lighting - Winter atmosphere lighting setup
 */

import * as THREE from 'three';

export class Lighting {
    constructor(scene) {
        this.scene = scene;
        this.lights = {};
    }

    setup() {
        // Ambient light - soft blue tint for snowy atmosphere
        this.lights.ambient = new THREE.AmbientLight(0x8fadc8, 0.6);
        this.scene.add(this.lights.ambient);

        // Main directional light (sun) - warm winter sunlight
        this.lights.sun = new THREE.DirectionalLight(0xfff4e6, 1.2);
        this.lights.sun.position.set(50, 80, 30);
        this.lights.sun.castShadow = true;

        // Configure shadow map
        this.lights.sun.shadow.mapSize.width = 2048;
        this.lights.sun.shadow.mapSize.height = 2048;
        this.lights.sun.shadow.camera.near = 10;
        this.lights.sun.shadow.camera.far = 200;
        this.lights.sun.shadow.camera.left = -80;
        this.lights.sun.shadow.camera.right = 80;
        this.lights.sun.shadow.camera.top = 80;
        this.lights.sun.shadow.camera.bottom = -80;
        this.lights.sun.shadow.bias = -0.0005;
        this.lights.sun.shadow.normalBias = 0.02;

        this.scene.add(this.lights.sun);

        // Secondary fill light - cooler, from opposite direction
        this.lights.fill = new THREE.DirectionalLight(0xb4c8dc, 0.4);
        this.lights.fill.position.set(-30, 40, -20);
        this.scene.add(this.lights.fill);

        // Hemisphere light - sky/ground bounce
        this.lights.hemisphere = new THREE.HemisphereLight(
            0x87ceeb, // Sky color (light blue)
            0x446688, // Ground color (cool blue)
            0.5
        );
        this.scene.add(this.lights.hemisphere);

        // Subtle rim light for depth
        this.lights.rim = new THREE.DirectionalLight(0xffffff, 0.2);
        this.lights.rim.position.set(-20, 20, -40);
        this.scene.add(this.lights.rim);
    }

    // Adjust lighting for different times of day (future feature)
    setTimeOfDay(time) {
        // 0 = dawn, 0.5 = noon, 1 = dusk
        const sunAngle = time * Math.PI;

        // Update sun position
        this.lights.sun.position.x = Math.cos(sunAngle) * 80;
        this.lights.sun.position.y = Math.sin(sunAngle) * 60 + 30;

        // Adjust colors based on time
        if (time < 0.3) {
            // Dawn - warm orange tint
            this.lights.sun.color.setHex(0xffa07a);
            this.lights.sun.intensity = 0.8;
        } else if (time > 0.7) {
            // Dusk - pink/purple tint
            this.lights.sun.color.setHex(0xdda0dd);
            this.lights.sun.intensity = 0.7;
        } else {
            // Day - warm white
            this.lights.sun.color.setHex(0xfff4e6);
            this.lights.sun.intensity = 1.2;
        }
    }
}
