/**
 * Lighting - Winter atmosphere lighting setup with day/night support
 */

import * as THREE from 'three';

export class Lighting {
    constructor(scene) {
        this.scene = scene;
        this.lights = {};
        this.isNight = false;

        // Store day settings for restoration
        this.daySettings = {
            ambient: { color: 0x8fadc8, intensity: 0.6 },
            sun: { color: 0xfff4e6, intensity: 1.2, position: [300, 500, 200] },
            fill: { color: 0xb4c8dc, intensity: 0.4 },
            hemisphere: { skyColor: 0x87ceeb, groundColor: 0x446688, intensity: 0.5 },
            rim: { color: 0xffffff, intensity: 0.2 }
        };
    }

    setup() {
        // Ambient light - soft blue tint for snowy atmosphere
        this.lights.ambient = new THREE.AmbientLight(0x8fadc8, 0.6);
        this.scene.add(this.lights.ambient);

        // Main directional light (sun/moon)
        this.lights.sun = new THREE.DirectionalLight(0xfff4e6, 1.2);
        this.lights.sun.position.set(300, 500, 200);
        this.lights.sun.castShadow = true;

        // Configure shadow map (balanced quality/performance)
        this.lights.sun.shadow.mapSize.width = 2048;
        this.lights.sun.shadow.mapSize.height = 2048;
        this.lights.sun.shadow.camera.near = 10;
        this.lights.sun.shadow.camera.far = 3000;
        this.lights.sun.shadow.camera.left = -600;
        this.lights.sun.shadow.camera.right = 600;
        this.lights.sun.shadow.camera.top = 600;
        this.lights.sun.shadow.camera.bottom = -600;
        this.lights.sun.shadow.bias = -0.0005;
        this.lights.sun.shadow.normalBias = 0.02;

        this.scene.add(this.lights.sun);

        // Secondary fill light
        this.lights.fill = new THREE.DirectionalLight(0xb4c8dc, 0.4);
        this.lights.fill.position.set(-200, 300, -150);
        this.scene.add(this.lights.fill);

        // Hemisphere light - sky/ground bounce
        this.lights.hemisphere = new THREE.HemisphereLight(0x87ceeb, 0x446688, 0.5);
        this.scene.add(this.lights.hemisphere);

        // Subtle rim light for depth
        this.lights.rim = new THREE.DirectionalLight(0xffffff, 0.2);
        this.lights.rim.position.set(-150, 200, -300);
        this.scene.add(this.lights.rim);
    }

    setNightMode(enabled) {
        this.isNight = enabled;

        if (enabled) {
            // Moon light - cool blue-white, lower intensity, high angle
            this.lights.sun.color.setHex(0xc0d8f0);
            this.lights.sun.intensity = 0.5;
            this.lights.sun.position.set(-200, 600, -100);

            // Darker ambient - deep blue
            this.lights.ambient.color.setHex(0x1a2a4a);
            this.lights.ambient.intensity = 0.25;

            // Fill light - very dim cool
            this.lights.fill.color.setHex(0x2040a0);
            this.lights.fill.intensity = 0.15;

            // Hemisphere - dark night sky / dark ground
            this.lights.hemisphere.color.setHex(0x1a2040);
            this.lights.hemisphere.groundColor.setHex(0x0a1020);
            this.lights.hemisphere.intensity = 0.3;

            // Rim light - silver moonlit edge
            this.lights.rim.color.setHex(0xaac0e0);
            this.lights.rim.intensity = 0.35;
            this.lights.rim.position.set(-200, 400, -200);
        } else {
            // Restore day settings
            const d = this.daySettings;
            this.lights.sun.color.setHex(d.sun.color);
            this.lights.sun.intensity = d.sun.intensity;
            this.lights.sun.position.set(...d.sun.position);

            this.lights.ambient.color.setHex(d.ambient.color);
            this.lights.ambient.intensity = d.ambient.intensity;

            this.lights.fill.color.setHex(d.fill.color);
            this.lights.fill.intensity = d.fill.intensity;

            this.lights.hemisphere.color.setHex(d.hemisphere.skyColor);
            this.lights.hemisphere.groundColor.setHex(d.hemisphere.groundColor);
            this.lights.hemisphere.intensity = d.hemisphere.intensity;

            this.lights.rim.color.setHex(d.rim.color);
            this.lights.rim.intensity = d.rim.intensity;
            this.lights.rim.position.set(-150, 200, -300);
        }
    }

    // Adjust lighting for different times of day (future feature)
    setTimeOfDay(time) {
        const sunAngle = time * Math.PI;
        this.lights.sun.position.x = Math.cos(sunAngle) * 80;
        this.lights.sun.position.y = Math.sin(sunAngle) * 60 + 30;

        if (time < 0.3) {
            this.lights.sun.color.setHex(0xffa07a);
            this.lights.sun.intensity = 0.8;
        } else if (time > 0.7) {
            this.lights.sun.color.setHex(0xdda0dd);
            this.lights.sun.intensity = 0.7;
        } else {
            this.lights.sun.color.setHex(0xfff4e6);
            this.lights.sun.intensity = 1.2;
        }
    }
}
