/**
 * Mountain - Smooth procedural mountain terrain with interactive sculpting
 */

import * as THREE from 'three';

export class Mountain {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.geometry = null;

        // Terrain parameters (5x larger terrain)
        this.width = 600;
        this.depth = 600;
        this.segments = 200; // Higher resolution for larger terrain
        this.maxHeight = 80;

        // Height map for fast lookups
        this.heightMap = null;
        this.heightMapSize = this.segments + 1;

        // Sculpting state
        this.sculptMode = null; // 'raise', 'lower', 'smooth', 'flatten'
        this.sculptRadius = 20; // Larger for bigger terrain
        this.sculptStrength = 0.5;

        // Noise seed for reproducibility
        this.seed = Math.random() * 1000;

        // Randomized peak parameters (generated from seed)
        this.peaks = this.generateRandomPeaks();

        // Random cliff formations
        this.cliffs = this.generateRandomCliffs();
    }

    // Generate random peak positions and heights
    generateRandomPeaks() {
        const peaks = [];
        const numPeaks = 6 + Math.floor(this.seededRandom() * 6); // 6-11 gentle peaks

        // Terrain fills 75% of space, centered
        const terrainRadius = this.width * 0.375; // 75% / 2

        for (let i = 0; i < numPeaks; i++) {
            // Peaks distributed across center 75% of terrain
            const angle = this.seededRandom() * Math.PI * 2;
            const dist = this.seededRandom() * terrainRadius * 0.8;
            peaks.push({
                x: Math.cos(angle) * dist,
                z: Math.sin(angle) * dist - terrainRadius * 0.3, // Slight back bias
                height: 20 + this.seededRandom() * 30, // Lower, gentler peaks
                radius: 80 + this.seededRandom() * 120 // Much wider = gentler slopes
            });
        }

        return peaks;
    }

    // Generate random cliff formations
    generateRandomCliffs() {
        const cliffs = [];
        const numCliffs = 3 + Math.floor(this.seededRandom() * 5); // 3-7 cliffs

        const terrainRadius = this.width * 0.375;

        for (let i = 0; i < numCliffs; i++) {
            // Cliffs appear on the mountain slopes
            const angle = this.seededRandom() * Math.PI * 2;
            const dist = 30 + this.seededRandom() * terrainRadius * 0.6;

            // Cliff direction (perpendicular to radius for natural look)
            const cliffAngle = angle + Math.PI / 2 + (this.seededRandom() - 0.5) * 0.5;

            cliffs.push({
                x: Math.cos(angle) * dist,
                z: Math.sin(angle) * dist - terrainRadius * 0.2,
                angle: cliffAngle, // Direction the cliff faces
                length: 30 + this.seededRandom() * 60, // How long the cliff is
                height: 8 + this.seededRandom() * 15, // How tall the drop is
                steepness: 0.8 + this.seededRandom() * 0.2 // How steep (0.8-1.0)
            });
        }

        return cliffs;
    }

    // Seeded random number generator
    seededRandom() {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        return this.seed / 233280;
    }

    generate() {
        // Initialize height map
        this.heightMap = new Float32Array(this.heightMapSize * this.heightMapSize);
        this.generateHeightMap();

        // Create terrain geometry
        this.geometry = new THREE.PlaneGeometry(
            this.width,
            this.depth,
            this.segments,
            this.segments
        );

        // Rotate to horizontal
        this.geometry.rotateX(-Math.PI / 2);

        // Apply height map to geometry
        this.applyHeightMap();

        // Recompute normals for lighting
        this.geometry.computeVertexNormals();

        // Create material with vertex colors
        this.applyVertexColors();

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            flatShading: false, // Smooth shading for natural look
            roughness: 0.85,
            metalness: 0.0
        });

        this.mesh = new THREE.Mesh(this.geometry, material);
        this.mesh.receiveShadow = true;
        this.mesh.castShadow = true;
        this.mesh.name = 'terrain';

        this.scene.add(this.mesh);
    }

    generateHeightMap() {
        // Generate smooth terrain using layered noise
        for (let z = 0; z < this.heightMapSize; z++) {
            for (let x = 0; x < this.heightMapSize; x++) {
                const worldX = (x / this.segments - 0.5) * this.width;
                const worldZ = (z / this.segments - 0.5) * this.depth;

                const height = this.calculateHeight(worldX, worldZ);
                this.heightMap[z * this.heightMapSize + x] = height;
            }
        }

        // Apply smoothing passes for gentler slopes
        this.smoothHeightMap(3);
    }

    calculateHeight(x, z) {
        let height = 0;

        // Terrain fills 75% of available space, centered
        const terrainRadius = this.width * 0.375; // 75% / 2 = 225 for 600 width
        const distFromCenter = Math.sqrt(x * x + z * z);

        // Smooth falloff at 75% boundary
        const edgeFalloff = this.smoothstep(terrainRadius, terrainRadius * 0.85, distFromCenter);

        // Gentler back bias for natural mountain feel
        const backBias = this.smoothstep(terrainRadius * 0.6, -terrainRadius * 0.4, z);

        // Main terrain shape using smooth noise - reduced amplitude for gentler slopes
        const noiseScale = 0.004 + (this.seed % 100) / 50000;
        const baseNoise = this.fbmNoise(x * noiseScale + this.seed, z * noiseScale, 4, 0.5, 2.0);
        height += baseNoise * 30 * edgeFalloff;

        // Large rounded peaks (randomized) - gentler with larger radii
        let peakHeight = 0;
        for (const peak of this.peaks) {
            peakHeight += this.gaussianPeak(x, z, peak.x, peak.z, peak.height, peak.radius);
        }
        height += peakHeight * backBias;

        // Gentle rolling hills
        const hillScale = 0.005 + (this.seed % 50) / 25000;
        const hills = this.fbmNoise(x * hillScale + this.seed * 0.1, z * hillScale + 100, 2, 0.5, 2.0);
        height += hills * 15 * edgeFalloff * (1 - backBias * 0.3);

        // Gradual valley floor in front
        const valleyFloor = this.smoothstep(terrainRadius * 0.2, terrainRadius * 0.5, z);
        height *= (1 - valleyFloor * 0.6);

        // Add cliff formations
        for (const cliff of this.cliffs) {
            const cliffEffect = this.calculateCliffEffect(x, z, cliff);
            height -= cliffEffect;
        }

        // Ensure minimum height
        height = Math.max(0, height);

        // Smooth terrain edges to flat ground at boundary
        const edgeSmooth = this.smoothstep(terrainRadius, terrainRadius * 0.9, distFromCenter);
        height *= edgeSmooth;

        return height;
    }

    // Gaussian peak for smooth, rounded mountains
    gaussianPeak(x, z, centerX, centerZ, height, radius) {
        const dx = x - centerX;
        const dz = z - centerZ;
        const distSq = dx * dx + dz * dz;
        return height * Math.exp(-distSq / (radius * radius));
    }

    // Calculate cliff drop effect at a position
    calculateCliffEffect(x, z, cliff) {
        // Vector from cliff center to point
        const dx = x - cliff.x;
        const dz = z - cliff.z;

        // Project onto cliff direction (perpendicular distance)
        const cliffDirX = Math.cos(cliff.angle);
        const cliffDirZ = Math.sin(cliff.angle);

        // Distance along cliff line
        const alongCliff = dx * cliffDirX + dz * cliffDirZ;

        // Distance perpendicular to cliff (how far "into" the cliff)
        const perpDist = dx * (-cliffDirZ) + dz * cliffDirX;

        // Check if within cliff length
        const halfLength = cliff.length / 2;
        if (Math.abs(alongCliff) > halfLength) return 0;

        // Smooth falloff along the cliff length
        const lengthFalloff = 1 - Math.pow(alongCliff / halfLength, 2);

        // Cliff face - sharp drop on one side
        const cliffWidth = 8; // Width of the transition
        const dropStart = -2; // Where the drop begins
        const dropEnd = cliffWidth; // Where the drop ends

        let dropAmount = 0;
        if (perpDist > dropStart && perpDist < dropEnd) {
            // In the cliff transition zone - create steep drop
            const t = (perpDist - dropStart) / (dropEnd - dropStart);
            // Use steep sigmoid for cliff face
            const steepT = 1 / (1 + Math.exp(-10 * (t - 0.5) * cliff.steepness));
            dropAmount = cliff.height * steepT * lengthFalloff;
        } else if (perpDist >= dropEnd) {
            // Below the cliff - full drop
            const fadeOut = Math.exp(-(perpDist - dropEnd) / 20);
            dropAmount = cliff.height * lengthFalloff * fadeOut;
        }

        return dropAmount;
    }

    // Smooth noise using value noise with cubic interpolation
    valueNoise(x, z) {
        const xi = Math.floor(x);
        const zi = Math.floor(z);
        const xf = x - xi;
        const zf = z - zi;

        // Smooth interpolation curve
        const u = this.smootherstep(xf);
        const v = this.smootherstep(zf);

        // Hash corners
        const n00 = this.hash2D(xi, zi);
        const n10 = this.hash2D(xi + 1, zi);
        const n01 = this.hash2D(xi, zi + 1);
        const n11 = this.hash2D(xi + 1, zi + 1);

        // Bilinear interpolation
        const nx0 = this.lerp(n00, n10, u);
        const nx1 = this.lerp(n01, n11, u);
        return this.lerp(nx0, nx1, v);
    }

    // Fractal Brownian Motion for natural-looking terrain
    fbmNoise(x, z, octaves, persistence, lacunarity) {
        let total = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            total += this.valueNoise(x * frequency + this.seed, z * frequency + this.seed) * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }

        return total / maxValue;
    }

    // Hash function for noise
    hash2D(x, z) {
        let n = Math.sin(x * 127.1 + z * 311.7 + this.seed) * 43758.5453;
        return (n - Math.floor(n)) * 2 - 1;
    }

    // Interpolation helpers
    lerp(a, b, t) {
        return a + (b - a) * t;
    }

    smoothstep(edge0, edge1, x) {
        const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t);
    }

    smootherstep(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    // Smooth the height map for gentler slopes
    smoothHeightMap(passes) {
        for (let pass = 0; pass < passes; pass++) {
            const newHeightMap = new Float32Array(this.heightMap.length);

            for (let z = 0; z < this.heightMapSize; z++) {
                for (let x = 0; x < this.heightMapSize; x++) {
                    let sum = 0;
                    let count = 0;

                    // 3x3 kernel averaging
                    for (let dz = -1; dz <= 1; dz++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nx = x + dx;
                            const nz = z + dz;
                            if (nx >= 0 && nx < this.heightMapSize && nz >= 0 && nz < this.heightMapSize) {
                                const weight = (dx === 0 && dz === 0) ? 4 : 1;
                                sum += this.heightMap[nz * this.heightMapSize + nx] * weight;
                                count += weight;
                            }
                        }
                    }

                    newHeightMap[z * this.heightMapSize + x] = sum / count;
                }
            }

            this.heightMap = newHeightMap;
        }
    }

    applyHeightMap() {
        const positions = this.geometry.attributes.position.array;

        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i + 2];

            // Convert world position to heightmap index
            const hmX = Math.round((x / this.width + 0.5) * this.segments);
            const hmZ = Math.round((z / this.depth + 0.5) * this.segments);

            const clampedX = Math.max(0, Math.min(this.segments, hmX));
            const clampedZ = Math.max(0, Math.min(this.segments, hmZ));

            positions[i + 1] = this.heightMap[clampedZ * this.heightMapSize + clampedX];
        }

        this.geometry.attributes.position.needsUpdate = true;
    }

    applyVertexColors() {
        const positions = this.geometry.attributes.position.array;
        const normals = this.geometry.attributes.normal.array;
        const colors = new Float32Array(positions.length);

        // Snow color palette (softer, more natural)
        const snowBright = new THREE.Color(0xfcfcfc);
        const snowMid = new THREE.Color(0xe8f0f5);
        const snowShadow = new THREE.Color(0xd0dce5);
        const rockLight = new THREE.Color(0x8899a8);
        const rockDark = new THREE.Color(0x5a6a7a);

        // Use deterministic variation instead of random
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const y = positions[i + 1];
            const z = positions[i + 2];
            const normalY = normals[i + 1];

            let color = new THREE.Color();

            // Slope angle (0 = vertical cliff, 1 = flat)
            const slopeAngle = Math.abs(normalY);

            // Deterministic variation based on position
            const variation = this.hash2D(x * 0.5, z * 0.5) * 0.5 + 0.5;

            if (slopeAngle < 0.5) {
                // Steep = rocky
                color.lerpColors(rockDark, rockLight, variation);
            } else if (slopeAngle < 0.7) {
                // Moderate slope = mixed
                const t = (slopeAngle - 0.5) / 0.2;
                const rockColor = new THREE.Color().lerpColors(rockDark, rockLight, variation);
                color.lerpColors(rockColor, snowShadow, t);
            } else {
                // Gentle slope = snow
                if (variation > 0.6) {
                    color.copy(snowBright);
                } else if (variation > 0.3) {
                    color.copy(snowMid);
                } else {
                    color.copy(snowShadow);
                }

                // Altitude-based tinting
                const altitudeFactor = Math.min(1, y / this.maxHeight);
                color.lerp(snowBright, altitudeFactor * 0.3);
            }

            colors[i] = color.r;
            colors[i + 1] = color.g;
            colors[i + 2] = color.b;
        }

        this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    // Get height at world position using bilinear interpolation
    getHeightAt(x, z) {
        // Clamp to terrain bounds
        x = Math.max(-this.width / 2, Math.min(this.width / 2, x));
        z = Math.max(-this.depth / 2, Math.min(this.depth / 2, z));

        // Convert to heightmap coordinates
        const hmX = (x / this.width + 0.5) * this.segments;
        const hmZ = (z / this.depth + 0.5) * this.segments;

        // Bilinear interpolation
        const x0 = Math.floor(hmX);
        const z0 = Math.floor(hmZ);
        const x1 = Math.min(x0 + 1, this.segments);
        const z1 = Math.min(z0 + 1, this.segments);

        const xFrac = hmX - x0;
        const zFrac = hmZ - z0;

        const h00 = this.heightMap[z0 * this.heightMapSize + x0];
        const h10 = this.heightMap[z0 * this.heightMapSize + x1];
        const h01 = this.heightMap[z1 * this.heightMapSize + x0];
        const h11 = this.heightMap[z1 * this.heightMapSize + x1];

        const h0 = h00 + (h10 - h00) * xFrac;
        const h1 = h01 + (h11 - h01) * xFrac;

        return h0 + (h1 - h0) * zFrac;
    }

    // Get terrain normal at position
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

    // Get slope angle at position (0 = flat, 1 = vertical)
    getSlopeAt(x, z) {
        const normal = this.getNormalAt(x, z);
        return 1 - Math.abs(normal.y);
    }

    // Sculpt terrain at position
    sculpt(x, z, mode, delta = 1) {
        const hmX = Math.round((x / this.width + 0.5) * this.segments);
        const hmZ = Math.round((z / this.depth + 0.5) * this.segments);
        const radiusInCells = Math.ceil(this.sculptRadius / (this.width / this.segments));

        for (let dz = -radiusInCells; dz <= radiusInCells; dz++) {
            for (let dx = -radiusInCells; dx <= radiusInCells; dx++) {
                const nx = hmX + dx;
                const nz = hmZ + dz;

                if (nx < 0 || nx > this.segments || nz < 0 || nz > this.segments) continue;

                // Calculate distance falloff
                const worldDx = dx * (this.width / this.segments);
                const worldDz = dz * (this.depth / this.segments);
                const dist = Math.sqrt(worldDx * worldDx + worldDz * worldDz);
                if (dist > this.sculptRadius) continue;

                const falloff = 1 - (dist / this.sculptRadius);
                const smoothFalloff = falloff * falloff * (3 - 2 * falloff); // Smoothstep

                const idx = nz * this.heightMapSize + nx;
                const amount = this.sculptStrength * smoothFalloff * delta;

                switch (mode) {
                    case 'raise':
                        this.heightMap[idx] += amount;
                        break;
                    case 'lower':
                        this.heightMap[idx] -= amount;
                        break;
                    case 'smooth':
                        // Average with neighbors
                        let sum = 0;
                        let count = 0;
                        for (let sz = -1; sz <= 1; sz++) {
                            for (let sx = -1; sx <= 1; sx++) {
                                const snx = nx + sx;
                                const snz = nz + sz;
                                if (snx >= 0 && snx <= this.segments && snz >= 0 && snz <= this.segments) {
                                    sum += this.heightMap[snz * this.heightMapSize + snx];
                                    count++;
                                }
                            }
                        }
                        const avg = sum / count;
                        this.heightMap[idx] = this.lerp(this.heightMap[idx], avg, smoothFalloff * 0.5);
                        break;
                    case 'flatten':
                        // Flatten toward target height
                        const targetHeight = this.heightMap[hmZ * this.heightMapSize + hmX];
                        this.heightMap[idx] = this.lerp(this.heightMap[idx], targetHeight, smoothFalloff * 0.3);
                        break;
                }
            }
        }

        // Update geometry
        this.applyHeightMap();
        this.geometry.computeVertexNormals();
        this.applyVertexColors();
        this.geometry.attributes.color.needsUpdate = true;
    }

    // Raycast to terrain
    raycast(raycaster) {
        if (!this.mesh) return null;

        const intersects = raycaster.intersectObject(this.mesh);
        if (intersects.length > 0) {
            return intersects[0];
        }
        return null;
    }

    // Regenerate terrain with new seed
    regenerate(seed = null) {
        if (seed !== null) {
            this.seed = seed;
        } else {
            this.seed = Math.random() * 1000;
        }

        // Regenerate random peaks and cliffs with new seed
        this.peaks = this.generateRandomPeaks();
        this.cliffs = this.generateRandomCliffs();

        this.generateHeightMap();
        this.applyHeightMap();
        this.geometry.computeVertexNormals();
        this.applyVertexColors();
        this.geometry.attributes.color.needsUpdate = true;
    }
}
