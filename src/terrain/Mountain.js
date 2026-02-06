/**
 * Mountain - Large-scale ski resort terrain with multi-cluster mountain generation
 *
 * Mountains are generated via multiple randomized cluster centers spread across
 * the full terrain. Each cluster gets its own peaks, ridges, and character.
 * Domain-warped FBM noise adds organic roughness everywhere. Edges fade gently
 * into fog for immersion.
 */

import * as THREE from 'three';

// Tunable parameters
const CLUSTER_COUNT_MIN = 2;
const CLUSTER_COUNT_MAX = 4;
const PEAKS_PER_CLUSTER_MIN = 2;
const PEAKS_PER_CLUSTER_MAX = 4;
const EDGE_FALLOFF_START = 0.55; // Fraction of half-extent where fade begins (wider = gentler)
const EDGE_FALLOFF_END = 0.92;   // Fraction where height reaches zero
const BASE_ROUGHNESS_AMPLITUDE = 18; // Low-frequency everywhere-roughness
const VALLEY_DEPTH = 0.25; // How deep valleys between clusters carve (0-1)

export class Mountain {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.geometry = null;

        // Terrain parameters
        this.width = 3000;
        this.depth = 4000;
        this.segments = 400;
        this.maxHeight = 280;

        // Height map for fast lookups
        this.heightMap = null;
        this.heightMapSize = this.segments + 1;

        // Sculpting state
        this.sculptMode = null;
        this.sculptRadius = 150;
        this.sculptStrength = 6.0;
        this.sculptDirty = false; // true when sculpt needs finalize (normals + colors)

        // Noise seed
        this.seed = Math.random() * 1000;

        // Generated features (populated in generate/regenerate)
        this.clusters = [];
        this.peaks = [];
        this.ridges = [];
        this.cliffs = [];
    }

    // ===== SEEDED RANDOM =====
    seededRandom() {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        return this.seed / 233280;
    }

    // ===== CLUSTER GENERATION =====
    generateClusters() {
        const clusters = [];
        const numClusters = CLUSTER_COUNT_MIN + Math.floor(this.seededRandom() * (CLUSTER_COUNT_MAX - CLUSTER_COUNT_MIN + 1));

        for (let i = 0; i < numClusters; i++) {
            // Spread centers across full terrain (with margin from edges)
            const cx = (this.seededRandom() - 0.5) * this.width * 0.75;
            const cz = (this.seededRandom() - 0.5) * this.depth * 0.75;

            // Each cluster has unique character
            const heightScale = 0.5 + this.seededRandom() * 0.5; // 0.5-1.0 of maxHeight
            const spreadRadius = 500 + this.seededRandom() * 600; // How wide the cluster extends
            const sharpness = 0.4 + this.seededRandom() * 0.6; // Ridge sharpness factor (gentler)

            clusters.push({
                x: cx, z: cz,
                heightScale,
                spreadRadius,
                sharpness,
                peakCount: PEAKS_PER_CLUSTER_MIN + Math.floor(this.seededRandom() * (PEAKS_PER_CLUSTER_MAX - PEAKS_PER_CLUSTER_MIN + 1))
            });
        }

        return clusters;
    }

    // ===== PEAK GENERATION (per-cluster) =====
    generatePeaks() {
        const peaks = [];

        for (const cluster of this.clusters) {
            for (let i = 0; i < cluster.peakCount; i++) {
                // Peaks scatter around cluster center within its spread radius
                const angle = this.seededRandom() * Math.PI * 2;
                const dist = this.seededRandom() * cluster.spreadRadius * 0.7;

                const px = cluster.x + Math.cos(angle) * dist;
                const pz = cluster.z + Math.sin(angle) * dist;

                // Height varies per peak; first peak in cluster is tallest
                const heightFactor = i === 0 ? (0.5 + this.seededRandom() * 0.3) : (0.15 + this.seededRandom() * 0.3);
                const height = this.maxHeight * cluster.heightScale * heightFactor;

                // Radius varies — wide for skiable slopes
                const radius = 400 + this.seededRandom() * 500;

                peaks.push({ x: px, z: pz, height, radius });
            }
        }

        // Add a few scattered isolated hills for variety
        const numIsolated = 2 + Math.floor(this.seededRandom() * 3);
        for (let i = 0; i < numIsolated; i++) {
            peaks.push({
                x: (this.seededRandom() - 0.5) * this.width * 0.8,
                z: (this.seededRandom() - 0.5) * this.depth * 0.8,
                height: 20 + this.seededRandom() * 50,
                radius: 300 + this.seededRandom() * 400
            });
        }

        return peaks;
    }

    // ===== RIDGE GENERATION =====
    generateRidges() {
        const ridges = [];

        // Ridges within clusters (from tallest peak outward)
        for (const cluster of this.clusters) {
            const numRidges = 1 + Math.floor(this.seededRandom() * 3);
            for (let i = 0; i < numRidges; i++) {
                const startAngle = this.seededRandom() * Math.PI * 2;
                const endAngle = startAngle + (this.seededRandom() - 0.5) * Math.PI;
                const ridgeLength = cluster.spreadRadius * (0.5 + this.seededRandom() * 0.8);

                const startX = cluster.x + Math.cos(startAngle) * cluster.spreadRadius * 0.15;
                const startZ = cluster.z + Math.sin(startAngle) * cluster.spreadRadius * 0.15;
                const endX = cluster.x + Math.cos(endAngle) * ridgeLength;
                const endZ = cluster.z + Math.sin(endAngle) * ridgeLength;
                const midX = (startX + endX) / 2 + (this.seededRandom() - 0.5) * 200;
                const midZ = (startZ + endZ) / 2 + (this.seededRandom() - 0.5) * 200;

                ridges.push({
                    startX, startZ,
                    midX, midZ,
                    endX, endZ,
                    height: 10 + this.seededRandom() * 30 * cluster.sharpness,
                    width: 120 + this.seededRandom() * 250
                });
            }
        }

        // Inter-cluster ridges (connecting nearby clusters)
        if (this.clusters.length >= 2) {
            for (let i = 0; i < this.clusters.length - 1; i++) {
                // Only connect if clusters are reasonably close
                const a = this.clusters[i];
                const b = this.clusters[i + 1];
                const dx = b.x - a.x;
                const dz = b.z - a.z;
                const dist = Math.sqrt(dx * dx + dz * dz);

                if (dist < 1500 && this.seededRandom() > 0.3) {
                    const midX = (a.x + b.x) / 2 + (this.seededRandom() - 0.5) * 300;
                    const midZ = (a.z + b.z) / 2 + (this.seededRandom() - 0.5) * 300;

                    ridges.push({
                        startX: a.x, startZ: a.z,
                        midX, midZ,
                        endX: b.x, endZ: b.z,
                        height: 10 + this.seededRandom() * 20,
                        width: 150 + this.seededRandom() * 200
                    });
                }
            }
        }

        return ridges;
    }

    // ===== CLIFF GENERATION =====
    generateCliffs() {
        const cliffs = [];
        const numCliffs = 2 + Math.floor(this.seededRandom() * 4);

        for (let i = 0; i < numCliffs; i++) {
            // Place cliffs near cluster centers for realism
            const cluster = this.clusters[Math.floor(this.seededRandom() * this.clusters.length)];
            const angle = this.seededRandom() * Math.PI * 2;
            const dist = cluster.spreadRadius * (0.3 + this.seededRandom() * 0.6);

            cliffs.push({
                x: cluster.x + Math.cos(angle) * dist,
                z: cluster.z + Math.sin(angle) * dist,
                angle: angle + Math.PI / 2 + (this.seededRandom() - 0.5) * 0.5,
                length: 60 + this.seededRandom() * 120,
                height: 8 + this.seededRandom() * 22,
                steepness: 0.6 + this.seededRandom() * 0.3
            });
        }

        return cliffs;
    }

    // ===== MAIN GENERATION =====
    generate() {
        // Generate all features
        this.clusters = this.generateClusters();
        this.peaks = this.generatePeaks();
        this.ridges = this.generateRidges();
        this.cliffs = this.generateCliffs();

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
        this.geometry.rotateX(-Math.PI / 2);

        this.applyHeightMap();
        this.geometry.computeVertexNormals();
        this.applyVertexColors();

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            flatShading: false,
            roughness: 0.85,
            metalness: 0.0
        });

        this.mesh = new THREE.Mesh(this.geometry, material);
        this.mesh.receiveShadow = true;
        this.mesh.castShadow = false;
        this.mesh.name = 'terrain';

        this.scene.add(this.mesh);

        // Add ground plane that extends far beyond terrain to hide world edges
        this.createGroundPlane();
    }

    createGroundPlane() {
        // Large plane at y=0 extending well beyond terrain — fog hides the far edges
        const groundGeo = new THREE.PlaneGeometry(15000, 15000, 1, 1);
        groundGeo.rotateX(-Math.PI / 2);

        const groundMat = new THREE.MeshStandardMaterial({
            color: 0xe8f0f5,
            roughness: 0.9,
            metalness: 0.0,
            fog: true
        });

        this.groundPlane = new THREE.Mesh(groundGeo, groundMat);
        this.groundPlane.position.y = -0.5; // Slightly below terrain to avoid z-fighting
        this.groundPlane.receiveShadow = true;
        this.groundPlane.name = 'groundPlane';
        this.scene.add(this.groundPlane);
    }

    generateHeightMap() {
        for (let z = 0; z < this.heightMapSize; z++) {
            for (let x = 0; x < this.heightMapSize; x++) {
                const worldX = (x / this.segments - 0.5) * this.width;
                const worldZ = (z / this.segments - 0.5) * this.depth;

                const height = this.calculateHeight(worldX, worldZ);
                this.heightMap[z * this.heightMapSize + x] = height;
            }
        }

        this.smoothHeightMap(5);
    }

    calculateHeight(x, z) {
        let height = 0;

        const halfW = this.width / 2;
        const halfD = this.depth / 2;
        const nx = x / halfW; // -1 to 1
        const nz = z / halfD;

        // ===== 1. GENTLE EDGE FALLOFF (wider, smoother) =====
        const edgeX = this.smoothstep(EDGE_FALLOFF_END, EDGE_FALLOFF_START, Math.abs(nx));
        const edgeZ = this.smoothstep(EDGE_FALLOFF_END, EDGE_FALLOFF_START, Math.abs(nz));
        const edgeFalloff = edgeX * edgeZ;

        // ===== 2. BASE TERRAIN ROUGHNESS (everywhere, no dead zones) =====
        // Domain-warped FBM for organic shapes
        const warpScale = 0.0008;
        const warpX = this.fbmNoise(x * warpScale + this.seed * 0.7, z * warpScale + 50, 2, 0.5, 2.0) * 200;
        const warpZ = this.fbmNoise(x * warpScale + 100, z * warpScale + this.seed * 0.3, 2, 0.5, 2.0) * 200;

        const warpedX = x + warpX;
        const warpedZ = z + warpZ;

        // Large-scale rolling terrain
        const baseScale = 0.0012;
        const baseNoise = this.fbmNoise(warpedX * baseScale + this.seed, warpedZ * baseScale, 4, 0.5, 2.0);
        height += baseNoise * BASE_ROUGHNESS_AMPLITUDE * edgeFalloff;

        // Medium-scale hills
        const hillScale = 0.003;
        const hills = this.fbmNoise(warpedX * hillScale + this.seed * 0.2, warpedZ * hillScale + 200, 3, 0.5, 2.0);
        height += hills * 12 * edgeFalloff;

        // Fine detail
        const detailScale = 0.006;
        const detail = this.fbmNoise(warpedX * detailScale + this.seed * 0.4, warpedZ * detailScale + 300, 2, 0.5, 2.0);
        height += detail * 5 * edgeFalloff;

        // ===== 3. CLUSTER-BASED MOUNTAIN HEIGHTS =====
        // Each cluster contributes a regional elevation boost
        for (const cluster of this.clusters) {
            const dx = x - cluster.x;
            const dz = z - cluster.z;
            const distSq = dx * dx + dz * dz;
            const r = cluster.spreadRadius;
            // Smooth radial falloff from cluster center
            const clusterInfluence = Math.exp(-distSq / (r * r * 0.8));
            height += this.maxHeight * cluster.heightScale * 0.25 * clusterInfluence * edgeFalloff;
        }

        // ===== 4. PEAKS =====
        for (const peak of this.peaks) {
            height += this.gaussianPeak(x, z, peak.x, peak.z, peak.height, peak.radius) * edgeFalloff;
        }

        // ===== 5. RIDGES =====
        for (const ridge of this.ridges) {
            height += this.calculateRidgeHeight(x, z, ridge) * edgeFalloff;
        }

        // ===== 6. VALLEY CARVING (between clusters) =====
        // Use minimum distance to any cluster center to create valleys between ranges
        if (this.clusters.length >= 2) {
            let minDist = Infinity;
            let secondDist = Infinity;
            for (const cluster of this.clusters) {
                const dx = x - cluster.x;
                const dz = z - cluster.z;
                const d = Math.sqrt(dx * dx + dz * dz);
                if (d < minDist) {
                    secondDist = minDist;
                    minDist = d;
                } else if (d < secondDist) {
                    secondDist = d;
                }
            }
            // Valley factor: deeper where roughly equidistant between two clusters
            const valleyRatio = minDist / (minDist + secondDist + 1);
            // valleyRatio near 0.5 = between clusters = carve valley
            const valleyFactor = this.smoothstep(0.3, 0.48, valleyRatio);
            height *= (1 - valleyFactor * VALLEY_DEPTH);
        }

        // ===== 7. CLIFFS =====
        for (const cliff of this.cliffs) {
            height -= this.calculateCliffEffect(x, z, cliff);
        }

        // ===== 8. FINAL EDGE FALLOFF (applied again for smooth termination) =====
        height *= edgeFalloff;

        return Math.max(0, height);
    }

    // ===== TERRAIN FEATURE FUNCTIONS =====

    gaussianPeak(x, z, centerX, centerZ, height, radius) {
        const dx = x - centerX;
        const dz = z - centerZ;
        const distSq = dx * dx + dz * dz;
        return height * Math.exp(-distSq / (radius * radius));
    }

    calculateRidgeHeight(x, z, ridge) {
        let minDist = Infinity;
        let closestT = 0;

        const samples = 20;
        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            const omt = 1 - t;
            const bx = omt * omt * ridge.startX + 2 * omt * t * ridge.midX + t * t * ridge.endX;
            const bz = omt * omt * ridge.startZ + 2 * omt * t * ridge.midZ + t * t * ridge.endZ;
            const dx = x - bx;
            const dz = z - bz;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < minDist) {
                minDist = dist;
                closestT = t;
            }
        }

        const lengthDecay = 1 - closestT * 0.7;
        const perpFalloff = Math.exp(-(minDist * minDist) / (ridge.width * ridge.width));

        return ridge.height * Math.max(0, lengthDecay) * perpFalloff;
    }

    calculateCliffEffect(x, z, cliff) {
        const dx = x - cliff.x;
        const dz = z - cliff.z;

        const cliffDirX = Math.cos(cliff.angle);
        const cliffDirZ = Math.sin(cliff.angle);

        const alongCliff = dx * cliffDirX + dz * cliffDirZ;
        const perpDist = dx * (-cliffDirZ) + dz * cliffDirX;

        const halfLength = cliff.length / 2;
        if (Math.abs(alongCliff) > halfLength) return 0;

        const lengthFalloff = 1 - Math.pow(alongCliff / halfLength, 2);

        const cliffWidth = 15;
        const dropStart = -3;
        const dropEnd = cliffWidth;

        let dropAmount = 0;
        if (perpDist > dropStart && perpDist < dropEnd) {
            const t = (perpDist - dropStart) / (dropEnd - dropStart);
            const steepT = 1 / (1 + Math.exp(-10 * (t - 0.5) * cliff.steepness));
            dropAmount = cliff.height * steepT * lengthFalloff;
        } else if (perpDist >= dropEnd) {
            const fadeOut = Math.exp(-(perpDist - dropEnd) / 40);
            dropAmount = cliff.height * lengthFalloff * fadeOut;
        }

        return dropAmount;
    }

    // ===== NOISE FUNCTIONS =====

    valueNoise(x, z) {
        const xi = Math.floor(x);
        const zi = Math.floor(z);
        const xf = x - xi;
        const zf = z - zi;

        const u = this.smootherstep(xf);
        const v = this.smootherstep(zf);

        const n00 = this.hash2D(xi, zi);
        const n10 = this.hash2D(xi + 1, zi);
        const n01 = this.hash2D(xi, zi + 1);
        const n11 = this.hash2D(xi + 1, zi + 1);

        const nx0 = this.lerp(n00, n10, u);
        const nx1 = this.lerp(n01, n11, u);
        return this.lerp(nx0, nx1, v);
    }

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

    hash2D(x, z) {
        let n = Math.sin(x * 127.1 + z * 311.7 + this.seed) * 43758.5453;
        return (n - Math.floor(n)) * 2 - 1;
    }

    // ===== INTERPOLATION HELPERS =====

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

    // ===== HEIGHT MAP PROCESSING =====

    smoothHeightMap(passes) {
        for (let pass = 0; pass < passes; pass++) {
            const newHeightMap = new Float32Array(this.heightMap.length);

            for (let z = 0; z < this.heightMapSize; z++) {
                for (let x = 0; x < this.heightMapSize; x++) {
                    let sum = 0;
                    let count = 0;

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

        const snowBright = new THREE.Color(0xfcfcfc);
        const snowMid = new THREE.Color(0xe8f0f5);
        const snowShadow = new THREE.Color(0xd0dce5);
        const rockLight = new THREE.Color(0x8899a8);
        const rockDark = new THREE.Color(0x5a6a7a);
        const alpineRock = new THREE.Color(0x7a8a9a);
        const iceBlue = new THREE.Color(0xd8eaf5);

        const color = new THREE.Color();
        const tempRock = new THREE.Color();
        const invMaxHeight = 1 / this.maxHeight;

        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const y = positions[i + 1];
            const z = positions[i + 2];
            const normalY = normals[i + 1];

            const slopeAngle = Math.abs(normalY);
            const altitudeRatio = Math.min(1, y * invMaxHeight);
            const variation = this.hash2D(x * 0.1, z * 0.1) * 0.5 + 0.5;

            if (slopeAngle < 0.5) {
                color.lerpColors(rockDark, rockLight, variation);
            } else if (slopeAngle < 0.7) {
                const t = (slopeAngle - 0.5) * 5;
                tempRock.lerpColors(rockDark, rockLight, variation);
                color.lerpColors(tempRock, snowShadow, t);
            } else {
                if (altitudeRatio > 0.75) {
                    if (variation > 0.7) {
                        color.lerpColors(iceBlue, alpineRock, (variation - 0.7) / 0.3 * 0.5);
                    } else {
                        color.lerpColors(iceBlue, snowBright, variation);
                    }
                } else if (altitudeRatio > 0.5) {
                    if (variation > 0.5) {
                        color.copy(snowBright);
                    } else {
                        color.lerpColors(snowMid, snowBright, variation * 2);
                    }
                } else {
                    if (variation > 0.6) {
                        color.copy(snowBright);
                    } else if (variation > 0.3) {
                        color.copy(snowMid);
                    } else {
                        color.copy(snowShadow);
                    }
                }

                color.lerp(snowBright, altitudeRatio * 0.2);
            }

            colors[i] = color.r;
            colors[i + 1] = color.g;
            colors[i + 2] = color.b;
        }

        this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    // ===== RUNTIME QUERIES =====

    getHeightAt(x, z) {
        x = Math.max(-this.width / 2, Math.min(this.width / 2, x));
        z = Math.max(-this.depth / 2, Math.min(this.depth / 2, z));

        const hmX = (x / this.width + 0.5) * this.segments;
        const hmZ = (z / this.depth + 0.5) * this.segments;

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

    getNormalAt(x, z) {
        const epsilon = 2.0;
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

    getSlopeAt(x, z) {
        const normal = this.getNormalAt(x, z);
        return 1 - Math.abs(normal.y);
    }

    // ===== SCULPTING =====

    sculpt(x, z, mode, delta = 1) {
        const hmX = Math.round((x / this.width + 0.5) * this.segments);
        const hmZ = Math.round((z / this.depth + 0.5) * this.segments);
        const cellW = this.width / this.segments;
        const cellD = this.depth / this.segments;
        const radiusInCellsX = Math.ceil(this.sculptRadius / cellW);
        const radiusInCellsZ = Math.ceil(this.sculptRadius / cellD);

        for (let dz = -radiusInCellsZ; dz <= radiusInCellsZ; dz++) {
            for (let dx = -radiusInCellsX; dx <= radiusInCellsX; dx++) {
                const nx = hmX + dx;
                const nz = hmZ + dz;

                if (nx < 0 || nx > this.segments || nz < 0 || nz > this.segments) continue;

                const worldDx = dx * cellW;
                const worldDz = dz * cellD;
                const dist = Math.sqrt(worldDx * worldDx + worldDz * worldDz);
                if (dist > this.sculptRadius) continue;

                const falloff = 1 - (dist / this.sculptRadius);
                const smoothFalloff = falloff * falloff * (3 - 2 * falloff);

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
                        const targetHeight = this.heightMap[hmZ * this.heightMapSize + hmX];
                        this.heightMap[idx] = this.lerp(this.heightMap[idx], targetHeight, smoothFalloff * 0.3);
                        break;
                }
            }
        }

        // Fast path: only update geometry positions in the affected region
        const positions = this.geometry.attributes.position.array;
        const rowSize = this.segments + 1;
        const minRow = Math.max(0, hmZ - radiusInCellsZ);
        const maxRow = Math.min(this.segments, hmZ + radiusInCellsZ);
        const minCol = Math.max(0, hmX - radiusInCellsX);
        const maxCol = Math.min(this.segments, hmX + radiusInCellsX);

        for (let row = minRow; row <= maxRow; row++) {
            for (let col = minCol; col <= maxCol; col++) {
                const vertIdx = (row * rowSize + col) * 3;
                positions[vertIdx + 1] = this.heightMap[row * this.heightMapSize + col];
            }
        }

        this.geometry.attributes.position.needsUpdate = true;
        this.sculptDirty = true;
    }

    // Call after sculpting ends (mouseup) to recompute normals and colors
    finalizeSculpt() {
        if (!this.sculptDirty) return;
        this.geometry.computeVertexNormals();
        this.applyVertexColors();
        this.geometry.attributes.color.needsUpdate = true;
        this.sculptDirty = false;
    }

    // ===== UTILITY =====

    raycast(raycaster) {
        if (!this.mesh) return null;

        const intersects = raycaster.intersectObject(this.mesh);
        if (intersects.length > 0) {
            return intersects[0];
        }
        return null;
    }

    regenerate(seed = null) {
        if (seed !== null) {
            this.seed = seed;
        } else {
            this.seed = Math.random() * 1000;
        }

        // Regenerate all features with new seed
        this.clusters = this.generateClusters();
        this.peaks = this.generatePeaks();
        this.ridges = this.generateRidges();
        this.cliffs = this.generateCliffs();

        this.generateHeightMap();
        this.applyHeightMap();
        this.geometry.computeVertexNormals();
        this.applyVertexColors();
        this.geometry.attributes.color.needsUpdate = true;
    }
}
