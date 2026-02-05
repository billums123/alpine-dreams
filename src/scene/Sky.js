/**
 * Sky - Winter sky and atmosphere
 */

import * as THREE from 'three';

export class Sky {
    constructor(scene) {
        this.scene = scene;
        this.skyMesh = null;
        this.clouds = [];
    }

    create() {
        // Create gradient sky dome
        this.createSkyDome();

        // Add distant mountains for depth
        this.createDistantMountains();

        // Add subtle cloud layer
        this.createClouds();
    }

    createSkyDome() {
        // Create a large sphere for the sky
        const geometry = new THREE.SphereGeometry(400, 32, 32);

        // Custom shader for gradient sky
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

                // Three-color gradient: bottom -> horizon -> top
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
            topColor: { value: new THREE.Color(0x4a7cb5) }, // Deep blue
            horizonColor: { value: new THREE.Color(0xb4d4e8) }, // Light blue-white
            bottomColor: { value: new THREE.Color(0xdce8f0) }, // Pale blue-gray
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
        // Create low-poly distant mountain range for depth
        const mountainGroup = new THREE.Group();
        mountainGroup.name = 'distantMountains';

        const mountainMaterial = new THREE.MeshBasicMaterial({
            color: 0x8899aa,
            fog: true
        });

        // Create several mountain peaks
        const peaks = [
            { x: -200, z: -150, scale: 1.5, height: 80 },
            { x: -140, z: -180, scale: 1.2, height: 60 },
            { x: -80, z: -160, scale: 1.0, height: 70 },
            { x: 0, z: -200, scale: 1.8, height: 100 },
            { x: 80, z: -170, scale: 1.3, height: 65 },
            { x: 150, z: -150, scale: 1.1, height: 55 },
            { x: 200, z: -180, scale: 1.4, height: 75 }
        ];

        peaks.forEach(peak => {
            const coneGeo = new THREE.ConeGeometry(
                40 * peak.scale,
                peak.height,
                6, // Low poly
                1
            );
            const cone = new THREE.Mesh(coneGeo, mountainMaterial);
            cone.position.set(peak.x, peak.height / 2 - 10, peak.z);
            cone.rotation.y = Math.random() * Math.PI;
            mountainGroup.add(cone);
        });

        this.scene.add(mountainGroup);
    }

    createClouds() {
        // Create simple, stylized cloud shapes
        const cloudMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.7,
            fog: true
        });

        const cloudPositions = [
            { x: -80, y: 60, z: -50, scale: 1.5 },
            { x: 50, y: 70, z: -80, scale: 2.0 },
            { x: 120, y: 55, z: -30, scale: 1.2 },
            { x: -40, y: 65, z: 60, scale: 1.8 },
            { x: 90, y: 75, z: 40, scale: 1.4 }
        ];

        cloudPositions.forEach(pos => {
            const cloud = this.createCloud(cloudMaterial, pos.scale);
            cloud.position.set(pos.x, pos.y, pos.z);
            this.scene.add(cloud);
            this.clouds.push(cloud);
        });
    }

    createCloud(material, scale) {
        const cloud = new THREE.Group();

        // Create cloud from multiple spheres
        const puffs = [
            { x: 0, y: 0, z: 0, r: 6 },
            { x: 5, y: 1, z: 0, r: 5 },
            { x: -5, y: 0.5, z: 0, r: 4.5 },
            { x: 3, y: -0.5, z: 2, r: 4 },
            { x: -3, y: 0, z: -2, r: 5 }
        ];

        puffs.forEach(puff => {
            const geometry = new THREE.SphereGeometry(puff.r, 8, 6);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(puff.x, puff.y, puff.z);
            cloud.add(mesh);
        });

        cloud.scale.setScalar(scale);
        return cloud;
    }

    // Animate clouds slowly (called from main update loop if desired)
    update(delta) {
        this.clouds.forEach((cloud, i) => {
            cloud.position.x += Math.sin(Date.now() * 0.0001 + i) * 0.01;
        });
    }
}
