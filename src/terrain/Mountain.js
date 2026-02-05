/**
 * Mountain - Procedural low-poly snowy mountain terrain
 */

import * as THREE from 'three';

export class Mountain {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.geometry = null;

        // Terrain parameters
        this.width = 100;
        this.depth = 100;
        this.segments = 50;
        this.maxHeight = 35;

        // Store height data for collision/placement
        this.heightData = [];
    }

    generate() {
        // Create terrain geometry
        this.geometry = new THREE.PlaneGeometry(
            this.width,
            this.depth,
            this.segments,
            this.segments
        );

        // Rotate to horizontal
        this.geometry.rotateX(-Math.PI / 2);

        // Generate heightmap
        const positions = this.geometry.attributes.position.array;
        this.heightData = [];

        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i + 2];

            // Generate height using multiple noise octaves
            let height = this.generateHeight(x, z);

            // Store in height data
            this.heightData.push({
                x: positions[i],
                z: positions[i + 2],
                y: height
            });

            positions[i + 1] = height;
        }

        // Recompute normals for lighting
        this.geometry.computeVertexNormals();

        // Create material with vertex colors for snow/rock variation
        this.applyVertexColors();

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            flatShading: true, // Low-poly look
            roughness: 0.9,
            metalness: 0.0
        });

        this.mesh = new THREE.Mesh(this.geometry, material);
        this.mesh.receiveShadow = true;
        this.mesh.castShadow = true;
        this.mesh.name = 'terrain';

        this.scene.add(this.mesh);

        // Add ski slopes (groomed paths)
        this.addSkiSlopes();
    }

    generateHeight(x, z) {
        // Multi-octave noise for natural terrain
        let height = 0;

        // Main mountain shape - higher toward the back
        const distFromCenter = Math.sqrt(x * x + z * z);
        const falloff = Math.max(0, 1 - distFromCenter / 60);

        // Push height up toward back (negative z)
        const backBias = Math.max(0, (-z + 30) / 60);

        // Simplex-like noise (approximation using sin)
        const noise1 = this.noise(x * 0.05, z * 0.05) * 15;
        const noise2 = this.noise(x * 0.1, z * 0.1) * 7;
        const noise3 = this.noise(x * 0.2, z * 0.2) * 3;

        height = (noise1 + noise2 + noise3) * falloff;

        // Add central peak
        const peakFalloff = Math.exp(-((x - 5) * (x - 5) + (z + 20) * (z + 20)) / 400);
        height += peakFalloff * this.maxHeight * backBias;

        // Secondary peaks
        const peak2 = Math.exp(-((x + 25) * (x + 25) + (z + 10) * (z + 10)) / 300);
        height += peak2 * 20;

        const peak3 = Math.exp(-((x - 30) * (x - 30) + (z + 5) * (z + 5)) / 350);
        height += peak3 * 18;

        // Flatten the front area (valley floor)
        if (z > 20) {
            const valleyFloor = Math.max(0, (z - 20) / 30);
            height *= (1 - valleyFloor);
        }

        // Minimum height
        height = Math.max(-2, height);

        return height;
    }

    // Simple noise function
    noise(x, z) {
        const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
        return (n - Math.floor(n)) * 2 - 1;
    }

    applyVertexColors() {
        const positions = this.geometry.attributes.position.array;
        const normals = this.geometry.attributes.normal.array;
        const colors = new Float32Array(positions.length);

        // Snow color palette
        const snowWhite = new THREE.Color(0xffffff);
        const snowBlue = new THREE.Color(0xe8f4f8);
        const snowShadow = new THREE.Color(0xc5d8e0);
        const rockGray = new THREE.Color(0x6b7b8c);
        const rockDark = new THREE.Color(0x4a5568);

        for (let i = 0; i < positions.length; i += 3) {
            const y = positions[i + 1];
            const normalY = normals[i + 1];

            let color = new THREE.Color();

            // Steep slopes show rock
            const steepness = 1 - Math.abs(normalY);

            if (steepness > 0.6) {
                // Rocky
                color.lerpColors(rockGray, rockDark, Math.random() * 0.5);
            } else if (steepness > 0.4) {
                // Mixed rock/snow
                color.lerpColors(snowShadow, rockGray, steepness - 0.4);
            } else {
                // Snow with subtle variation
                const t = Math.random();
                if (t > 0.7) {
                    color.copy(snowWhite);
                } else if (t > 0.3) {
                    color.copy(snowBlue);
                } else {
                    color.copy(snowShadow);
                }

                // Slightly blue-er in shadows (lower areas)
                if (y < 10) {
                    color.lerp(snowShadow, 0.3);
                }
            }

            colors[i] = color.r;
            colors[i + 1] = color.g;
            colors[i + 2] = color.b;
        }

        this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    addSkiSlopes() {
        // Add visible groomed ski runs
        const slopeMaterial = new THREE.MeshStandardMaterial({
            color: 0xf5f9fc,
            roughness: 0.7,
            flatShading: true
        });

        // Main slope path
        const slopePoints = [
            new THREE.Vector3(-5, this.getHeightAt(-5, -25) + 0.1, -25),
            new THREE.Vector3(-8, this.getHeightAt(-8, -15) + 0.1, -15),
            new THREE.Vector3(-3, this.getHeightAt(-3, -5) + 0.1, -5),
            new THREE.Vector3(5, this.getHeightAt(5, 10) + 0.1, 10),
            new THREE.Vector3(10, this.getHeightAt(10, 25) + 0.1, 25)
        ];

        // Create slope mesh (simplified ribbon)
        this.createSlopeRibbon(slopePoints, 4, slopeMaterial);

        // Secondary slope
        const slope2Points = [
            new THREE.Vector3(25, this.getHeightAt(25, -15) + 0.1, -15),
            new THREE.Vector3(20, this.getHeightAt(20, -5) + 0.1, -5),
            new THREE.Vector3(15, this.getHeightAt(15, 10) + 0.1, 10),
            new THREE.Vector3(10, this.getHeightAt(10, 20) + 0.1, 20)
        ];

        this.createSlopeRibbon(slope2Points, 3, slopeMaterial);
    }

    createSlopeRibbon(points, width, material) {
        if (points.length < 2) return;

        const curve = new THREE.CatmullRomCurve3(points);
        const curvePoints = curve.getPoints(30);

        const vertices = [];
        const indices = [];

        for (let i = 0; i < curvePoints.length; i++) {
            const point = curvePoints[i];
            const tangent = curve.getTangentAt(i / (curvePoints.length - 1));

            // Perpendicular direction
            const perp = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

            // Left and right edge points
            const left = point.clone().add(perp.clone().multiplyScalar(width / 2));
            const right = point.clone().sub(perp.clone().multiplyScalar(width / 2));

            // Snap to terrain height
            left.y = this.getHeightAt(left.x, left.z) + 0.15;
            right.y = this.getHeightAt(right.x, right.z) + 0.15;

            vertices.push(left.x, left.y, left.z);
            vertices.push(right.x, right.y, right.z);
        }

        // Create faces
        for (let i = 0; i < curvePoints.length - 1; i++) {
            const a = i * 2;
            const b = i * 2 + 1;
            const c = (i + 1) * 2;
            const d = (i + 1) * 2 + 1;

            indices.push(a, b, c);
            indices.push(b, d, c);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const mesh = new THREE.Mesh(geometry, material);
        mesh.receiveShadow = true;
        mesh.name = 'skiSlope';
        this.scene.add(mesh);
    }

    // Get terrain height at any x, z position
    getHeightAt(x, z) {
        // Clamp to terrain bounds
        x = Math.max(-this.width / 2, Math.min(this.width / 2, x));
        z = Math.max(-this.depth / 2, Math.min(this.depth / 2, z));

        return this.generateHeight(x, z);
    }

    // Get terrain normal at position (for object alignment)
    getNormalAt(x, z) {
        const epsilon = 0.5;
        const h = this.getHeightAt(x, z);
        const hx = this.getHeightAt(x + epsilon, z);
        const hz = this.getHeightAt(x, z + epsilon);

        const normal = new THREE.Vector3(
            h - hx,
            epsilon,
            h - hz
        ).normalize();

        return normal;
    }

    // Raycast to terrain for precise placement
    raycast(raycaster) {
        if (!this.mesh) return null;

        const intersects = raycaster.intersectObject(this.mesh);
        if (intersects.length > 0) {
            return intersects[0];
        }
        return null;
    }
}
