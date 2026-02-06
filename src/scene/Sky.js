/**
 * Sky - Winter sky and atmosphere with day/night support (optimized)
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export class Sky {
    constructor(scene) {
        this.scene = scene;
        this.skyMesh = null;
        this.clouds = [];
        this.starField = null;
        this.distantMountainsMesh = null;
        this.isNight = false;

        // Store day colors for restoration
        this.dayColors = {
            top: new THREE.Color(0x4a7cb5),
            horizon: new THREE.Color(0xb4d4e8),
            bottom: new THREE.Color(0xdce8f0),
            mountain: 0x8899aa
        };
    }

    create() {
        this.createSkyDome();
        this.createDistantMountains();
        this.createClouds();
        this.createStarField();
    }

    createSkyDome() {
        const geometry = new THREE.SphereGeometry(5000, 32, 15);

        const vertexShader = `
            varying vec3 vWorldPosition;
            void main() {
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;

        const fragmentShader = `
            varying vec3 vWorldPosition;
            uniform vec3 topColor;
            uniform vec3 bottomColor;
            uniform vec3 horizonColor;
            uniform float offset;
            uniform float exponent;

            void main() {
                float h = normalize(vWorldPosition + offset).y;

                vec3 color;
                if (h < 0.0) {
                    color = bottomColor;
                } else if (h < 0.3) {
                    float t = h / 0.3;
                    color = mix(bottomColor, horizonColor, t);
                } else {
                    float t = (h - 0.3) / 0.7;
                    color = mix(horizonColor, topColor, pow(t, exponent));
                }

                gl_FragColor = vec4(color, 1.0);
            }
        `;

        const uniforms = {
            topColor: { value: new THREE.Color(0x4a7cb5) },
            horizonColor: { value: new THREE.Color(0xb4d4e8) },
            bottomColor: { value: new THREE.Color(0xdce8f0) },
            offset: { value: 20 },
            exponent: { value: 0.8 }
        };

        const material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms,
            side: THREE.BackSide,
            depthWrite: false
        });

        this.skyMesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.skyMesh);
    }

    createDistantMountains() {
        const mountainMaterial = new THREE.MeshBasicMaterial({
            color: 0x8899aa,
            fog: true
        });

        // Generate peaks around the full perimeter (360 degrees)
        // Two rings: near ring and far ring for depth
        const geos = [];
        const seed = 42;

        const rings = [
            { distance: 2800, count: 24, minH: 200, maxH: 500, minR: 250, maxR: 500 },
            { distance: 3600, count: 18, minH: 300, maxH: 700, minR: 350, maxR: 650 }
        ];

        let s = seed;
        const pseudoRandom = () => {
            s = (s * 9301 + 49297) % 233280;
            return s / 233280;
        };

        rings.forEach(ring => {
            for (let i = 0; i < ring.count; i++) {
                // Evenly spaced around perimeter with slight randomization
                const baseAngle = (i / ring.count) * Math.PI * 2;
                const angle = baseAngle + (pseudoRandom() - 0.5) * (Math.PI * 2 / ring.count) * 0.6;
                const dist = ring.distance + (pseudoRandom() - 0.5) * 400;

                const px = Math.cos(angle) * dist;
                const pz = Math.sin(angle) * dist;
                const height = ring.minH + pseudoRandom() * (ring.maxH - ring.minH);
                const radius = ring.minR + pseudoRandom() * (ring.maxR - ring.minR);

                // Smooth cones (16 segments instead of 6)
                const coneGeo = new THREE.ConeGeometry(radius, height, 16, 1);
                coneGeo.rotateY(pseudoRandom() * Math.PI);
                coneGeo.translate(px, height * 0.3, pz);
                geos.push(coneGeo);
            }
        });

        const merged = mergeGeometries(geos);
        if (merged) {
            this.distantMountainsMesh = new THREE.Mesh(merged, mountainMaterial);
            this.distantMountainsMesh.name = 'distantMountains';
            this.scene.add(this.distantMountainsMesh);
        }
    }

    createClouds() {
        const cloudMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.7,
            fog: true
        });

        const cloudPositions = [
            { x: -800, y: 800, z: -600, scale: 10, drift: 0.3 },
            { x: 500, y: 900, z: -900, scale: 12, drift: 0.2 },
            { x: 1200, y: 750, z: -400, scale: 9, drift: 0.35 },
            { x: -400, y: 850, z: 200, scale: 11, drift: 0.25 },
            { x: 900, y: 950, z: 100, scale: 10, drift: 0.15 },
            { x: -1100, y: 820, z: -100, scale: 9, drift: 0.3 },
            { x: 300, y: 1000, z: -1200, scale: 13, drift: 0.2 },
            { x: -600, y: 880, z: -1000, scale: 8, drift: 0.28 },
            { x: 1400, y: 780, z: -700, scale: 10, drift: 0.22 }
        ];

        const puffs = [
            { x: 0, y: 0, z: 0, r: 6 },
            { x: 5, y: 1, z: 0, r: 5 },
            { x: -5, y: 0.5, z: 0, r: 4.5 },
            { x: 3, y: -0.5, z: 2, r: 4 },
            { x: -3, y: 0, z: -2, r: 5 }
        ];

        cloudPositions.forEach(pos => {
            const puffGeos = puffs.map(puff => {
                const geo = new THREE.SphereGeometry(puff.r, 8, 6);
                geo.translate(puff.x, puff.y, puff.z);
                return geo;
            });

            const mergedCloud = mergeGeometries(puffGeos);
            if (mergedCloud) {
                const cloudMesh = new THREE.Mesh(mergedCloud, cloudMaterial);
                cloudMesh.scale.setScalar(pos.scale);
                cloudMesh.position.set(pos.x, pos.y, pos.z);
                cloudMesh.userData.driftSpeed = pos.drift || 0.2;
                cloudMesh.userData.startX = pos.x;
                this.scene.add(cloudMesh);
                this.clouds.push(cloudMesh);
            }
        });
    }

    createStarField() {
        // Starfield - points on upper hemisphere of sky dome (single draw call)
        const starCount = 1500;
        const positions = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const twinklePhases = new Float32Array(starCount);

        for (let i = 0; i < starCount; i++) {
            // Random point on upper hemisphere
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI * 0.45; // Upper hemisphere only
            const r = 4800; // Just inside sky dome

            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.cos(phi); // Y = up
            positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

            // Varied sizes (some brighter stars)
            sizes[i] = Math.random() < 0.05 ? 3.0 + Math.random() * 2.0 : 1.0 + Math.random() * 1.5;
            twinklePhases[i] = Math.random() * Math.PI * 2;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('phase', new THREE.BufferAttribute(twinklePhases, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 }
            },
            vertexShader: `
                attribute float size;
                attribute float phase;
                uniform float time;
                varying float vAlpha;

                void main() {
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * (300.0 / -mvPosition.z);

                    // Gentle twinkle
                    vAlpha = 0.6 + 0.4 * sin(time * 1.5 + phase);

                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying float vAlpha;

                void main() {
                    // Soft circular point
                    float d = length(gl_PointCoord - vec2(0.5));
                    if (d > 0.5) discard;
                    float alpha = smoothstep(0.5, 0.1, d) * vAlpha;
                    gl_FragColor = vec4(0.9, 0.92, 1.0, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.starField = new THREE.Points(geometry, material);
        this.starField.visible = false; // Hidden by default (day mode)
        this.starField.frustumCulled = false;
        this.scene.add(this.starField);
    }

    setNightMode(enabled) {
        this.isNight = enabled;

        const uniforms = this.skyMesh.material.uniforms;

        if (enabled) {
            // Dark night sky gradient
            uniforms.topColor.value.setHex(0x050a1a);    // Near black
            uniforms.horizonColor.value.setHex(0x0e1a35); // Dark navy
            uniforms.bottomColor.value.setHex(0x15253f);  // Dark blue-gray

            // Show stars
            this.starField.visible = true;

            // Dim clouds
            this.clouds.forEach(cloud => {
                cloud.material.opacity = 0.15;
                cloud.material.color.setHex(0x3a4a6a);
            });

            // Dim distant mountains
            if (this.distantMountainsMesh) {
                this.distantMountainsMesh.material.color.setHex(0x1a2540);
            }
        } else {
            // Restore day sky
            uniforms.topColor.value.copy(this.dayColors.top);
            uniforms.horizonColor.value.copy(this.dayColors.horizon);
            uniforms.bottomColor.value.copy(this.dayColors.bottom);

            // Hide stars
            this.starField.visible = false;

            // Restore clouds
            this.clouds.forEach(cloud => {
                cloud.material.opacity = 0.7;
                cloud.material.color.setHex(0xffffff);
            });

            // Restore distant mountains
            if (this.distantMountainsMesh) {
                this.distantMountainsMesh.material.color.setHex(this.dayColors.mountain);
            }
        }
    }

    // Animate clouds and stars
    update(delta) {
        // Gentle cloud drift
        this.clouds.forEach((cloud) => {
            cloud.position.x += cloud.userData.driftSpeed * delta;
            // Wrap around when cloud drifts too far
            if (cloud.position.x > cloud.userData.startX + 2000) {
                cloud.position.x = cloud.userData.startX - 2000;
            }
        });

        // Update star twinkle
        if (this.starField && this.starField.visible) {
            this.starField.material.uniforms.time.value = performance.now() * 0.001;
        }
    }
}
