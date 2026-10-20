/**
 * Mountain - Large-scale ski resort terrain ("Alpenglow" art direction)
 *
 * Heights: multiple randomized mountain clusters, peaks, ridges, crags and
 * cliffs over domain-warped FBM, fading to a flat rim at the terrain edge.
 *
 * Look: low-frequency painterly vertex colors (warm lit snow, cool shaded snow,
 * strata-banded rock on steep faces, icy wind-scoured summits, bluer forest
 * floor under groves), a seamless outer "apron" of rolling snowy foothills that
 * hides the rectangle edge, and an optional per-fragment detail layer
 * (wind ripples + HDR sun sparkle) injected via onBeforeCompile.
 */

import * as THREE from 'three';
import { getPreset } from '../core/quality.js';
import { events } from '../core/events.js';

// Tunable parameters
const CLUSTER_COUNT_MIN = 2;
const CLUSTER_COUNT_MAX = 4;
const PEAKS_PER_CLUSTER_MIN = 2;
const PEAKS_PER_CLUSTER_MAX = 4;
const EDGE_FALLOFF_START = 0.55; // Fraction of half-extent where fade begins (wider = gentler)
const EDGE_FALLOFF_END = 0.92;   // Fraction where height reaches zero
const BASE_ROUGHNESS_AMPLITUDE = 18; // Low-frequency everywhere-roughness
const VALLEY_DEPTH = 0.25; // How deep valleys between clusters carve (0-1)
const CRAG_AMPLITUDE = 70; // Ridged-noise crags near cluster cores
const FOREST_LO = 0.54;  // grove noise thresholds (higher = fewer, denser groves)
const FOREST_HI = 0.66;

// Apron (outer foothills)
const APRON_SIZE = 18000;
const APRON_SEGMENTS = 120;

// Key light direction (matches Environment's day sun; only used to bias vertex colors)
const SUN_DIR = new THREE.Vector3(-0.62, 0.42, -0.66).normalize();

// ===== Palette (Alpenglow, DESIGN_BRIEF §1.1) =====
const C = {
    snowLit: new THREE.Color(0xfff8ef),
    snowMid: new THREE.Color(0xe7eef6),
    snowShade: new THREE.Color(0xb8c9e0),
    snowIce: new THREE.Color(0xcfe4f4),
    snowForest: new THREE.Color(0xc3d0e2),
    rockDark: new THREE.Color(0x67656e),
    rockLight: new THREE.Color(0x9a9aa3),
    rockWarm: new THREE.Color(0x8e7e6f),
    pineDeep: new THREE.Color(0x1c3a31),
};

// ===== Fast deterministic value noise (integer hash, 0..1) =====
function hashI(ix, iz, seed) {
    let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function vnoise(x, z, seed) {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    let xf = x - xi;
    let zf = z - zi;
    xf = xf * xf * (3 - 2 * xf);
    zf = zf * zf * (3 - 2 * zf);
    const a = hashI(xi, zi, seed);
    const b = hashI(xi + 1, zi, seed);
    const c = hashI(xi, zi + 1, seed);
    const d = hashI(xi + 1, zi + 1, seed);
    const ab = a + (b - a) * xf;
    const cd = c + (d - c) * xf;
    return ab + (cd - ab) * zf;
}

function fbm2(x, z, seed, octaves = 3) {
    let total = 0;
    let amp = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
        total += vnoise(x, z, seed + i * 7919) * amp;
        norm += amp;
        amp *= 0.5;
        x = x * 2.03 + 17.1;
        z = z * 2.03 - 11.7;
    }
    return total / norm;
}

function sstep(e0, e1, x) {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

export class Mountain {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.geometry = null;
        this.material = null;
        this.apron = null;
        this.groundPlane = null; // legacy alias of the apron mesh

        // Terrain parameters
        this.width = 3000;
        this.depth = 4000;
        this.segments = 400;
        this.maxHeight = 280;

        // Height map for fast lookups
        this.heightMap = null;
        this.heightMapSize = this.segments + 1;

        // Cached per-vertex color noise (static per seed, reused by finalizeSculpt)
        this.colorNoiseA = null;
        this.colorNoiseB = null;
        this.forestNoise = null;
        this.colorSeed = 1;

        // Apron height grid (for tree placement beyond the terrain)
        this.apronHeights = null;

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

        // Shader uniforms for the detail layer
        this.uniforms = { uTime: { value: 0 }, uDetail: { value: 1 } };
        // Quality tier toggles the per-fragment detail at runtime (uniform branch).
        events.on('quality:change', ({ preset } = {}) => {
            if (preset) this.uniforms.uDetail.value = preset.terrainDetail === false ? 0 : 1;
        });
        this._tmpColor = new THREE.Color();
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
    buildFeatures() {
        this.clusters = this.generateClusters();
        this.peaks = this.generatePeaks();
        this.ridges = this.generateRidges();
        this.cliffs = this.generateCliffs();
        // Seed for color/forest/apron noise (derived after feature RNG has advanced)
        this.colorSeed = (Math.floor(this.seed * 7919) ^ 0x5bd1e995) | 0;
    }

    generate() {
        this.buildFeatures();

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
        this.computeColorNoise();
        this.applyVertexColors();

        this.material = this.createMaterial();

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.receiveShadow = true;
        this.mesh.castShadow = false;
        this.mesh.name = 'terrain';

        this.scene.add(this.mesh);

        // Outer foothill apron hides the terrain rectangle edge
        this.createApron();

        // Faceted rock outcrops on steep ground
        this.createRocks();
    }

    // ===== MATERIAL =====
    createMaterial() {
        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            flatShading: false,
            roughness: 0.88,
            metalness: 0.0
        });

        let detail = true;
        try { detail = !!getPreset().terrainDetail; } catch (e) { /* default on */ }
        this.uniforms.uDetail.value = detail ? 1 : 0;
        // Always installed; uDetail gates it so quality can change at runtime.
        this.installDetailShader(material);
        return material;
    }

    /**
     * Per-fragment snow detail: wind ripples (normal tilt) and HDR sun sparkle
     * (view-dependent micro-facet glints that bloom). Both fade out with
     * distance, so the editor view stays clean and the ski view gets texture.
     */
    installDetailShader(material) {
        const uniforms = this.uniforms;
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = uniforms.uTime;
            shader.uniforms.uDetail = uniforms.uDetail;

            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vAdWorld;')
                .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvAdWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');

            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>
varying vec3 vAdWorld;
uniform float uTime;
uniform float uDetail;
float adHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
float adNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = adHash(i);
    float b = adHash(i + vec2(1.0, 0.0));
    float c = adHash(i + vec2(0.0, 1.0));
    float d = adHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`)
                .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
float adDist = length(vAdWorld - cameraPosition);
{
    float adFade = uDetail * (1.0 - smoothstep(25.0, 200.0, adDist)) * smoothstep(0.62, 0.8, diffuseColor.g);
    if (adFade > 0.001) {
        vec2 wp = vAdWorld.xz;
        // Wind-sculpted ripples (sastrugi), warped by a broad noise so they meander
        float warp = adNoise(wp * 0.035) * 9.0 + adNoise(wp * 0.23) * 2.2;
        float phase = dot(wp, vec2(0.62, 0.78)) * 0.9 + warp;
        // Screen-space AA: fade ripples out before they alias into banding.
        adFade *= 1.0 - smoothstep(0.35, 1.1, fwidth(phase));
        // patchy: ripples only where the wind scoured, soft drifts elsewhere
        float ripPatch = smoothstep(0.35, 0.75, adNoise(wp * 0.018 + 7.3));
        float rip = cos(phase) * ripPatch * (0.4 + 0.6 * adNoise(wp * 0.09 + 3.1));
        vec3 tiltW = vec3(0.62, 0.0, 0.78) * rip * 0.03 * adFade;
        normal = normalize(normal + (viewMatrix * vec4(tiltW, 0.0)).xyz);
    }
}`)
                .replace('#include <opaque_fragment>', `
#if NUM_DIR_LIGHTS > 0
{
    float spFade = uDetail * (1.0 - smoothstep(15.0, 140.0, adDist));
    if (spFade > 0.001) {
        vec3 spV = normalize(vViewPosition);
        vec3 spH = normalize(directionalLights[0].direction + spV);
        vec2 spP = vAdWorld.xz * 2.4;
        vec2 spCell = floor(spP);
        vec3 spR = vec3(adHash(spCell), adHash(spCell + 17.31), adHash(spCell + 41.97)) * 2.0 - 1.0;
        vec3 spN = normalize(normal + (viewMatrix * vec4(spR * 0.32, 0.0)).xyz);
        float spG = pow(max(dot(spN, spH), 0.0), 560.0);
        vec2 spLocal = fract(spP) - 0.5 - spR.xz * 0.28;
        // Only ~6% of cells hold a glint: occasional sparkles, not salt noise.
        float spDot = smoothstep(0.18, 0.0, length(spLocal)) * step(0.94, adHash(spCell + 5.17));
        float spLit = clamp(dot(reflectedLight.directDiffuse, vec3(0.3333)) * 5.0, 0.0, 1.0);
        float spSnow = smoothstep(0.6, 0.82, diffuseColor.g);
        outgoingLight += vec3(1.0, 0.93, 0.8) * spG * spDot * spLit * spSnow * spFade * 6.0;
    }
}
#endif
#include <opaque_fragment>`);
        };
        material.customProgramCacheKey = () => 'alpine-terrain-detail-v2';
    }

    // ===== ROCK OUTCROPS (1 instanced draw call) =====
    buildRockGeometry() {
        const geo = new THREE.IcosahedronGeometry(1, 0); // non-indexed, 20 faces
        const pos = geo.attributes.position;
        // jitter by original position so shared corners move together
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            const k = 0.78 + 0.44 * hashI(Math.round(x * 100), Math.round(y * 100) * 7 + Math.round(z * 100), 77);
            pos.setXYZ(i, x * k, y * k * 0.85, z * k);
        }
        geo.computeVertexNormals();
        const nrm = geo.attributes.normal;
        const colors = new Float32Array(pos.count * 3);
        const c = this._tmpColor;
        for (let f = 0; f < pos.count; f += 3) {
            const ny = (nrm.getY(f) + nrm.getY(f + 1) + nrm.getY(f + 2)) / 3;
            if (ny > 0.62) c.copy(C.snowLit);
            else if (ny > 0.35) c.copy(C.snowShade).lerp(C.rockLight, 0.35);
            else c.copy(C.rockDark).lerp(C.rockLight, hashI(f, 3, 91) * 0.6).lerp(C.rockWarm, hashI(f, 5, 19) * 0.4);
            for (let k = 0; k < 3; k++) {
                colors[(f + k) * 3] = c.r;
                colors[(f + k) * 3 + 1] = c.g;
                colors[(f + k) * 3 + 2] = c.b;
            }
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        return geo;
    }

    createRocks() {
        if (this.rocks) {
            this.scene.remove(this.rocks);
            this.rocks.dispose?.();
        }
        if (!this.rockGeometry) this.rockGeometry = this.buildRockGeometry();
        if (!this.rockMaterial) {
            this.rockMaterial = new THREE.MeshStandardMaterial({
                vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0,
            });
        }

        const MAX = 520;
        const data = [];
        let rs = (this.colorSeed >>> 0) || 1;
        const rnd = () => { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
        let tries = 0;
        while (data.length < MAX && tries < MAX * 60) {
            tries++;
            const x = (rnd() - 0.5) * this.width * 0.92;
            const z = (rnd() - 0.5) * this.depth * 0.92;
            const slope = this.getSlopeAt(x, z);
            const h = this.getHeightAt(x, z);
            // steep faces, plus a few boulders on high ground
            const want = sstep(0.22, 0.45, slope) + sstep(0.75, 1.1, h / this.maxHeight) * 0.12;
            if (rnd() > want) continue;
            const s = 2.5 + rnd() * rnd() * 9;
            data.push({ x, z, sx: s * (0.8 + rnd() * 0.6), sy: s * (0.55 + rnd() * 0.5), sz: s * (0.8 + rnd() * 0.6), ry: rnd() * Math.PI * 2, rx: (rnd() - 0.5) * 0.5, tint: 0.85 + rnd() * 0.25 });
            // small companions
            if (rnd() < 0.5 && data.length < MAX) {
                const a = rnd() * Math.PI * 2, d = s * (1.2 + rnd());
                const s2 = s * (0.3 + rnd() * 0.35);
                data.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, sx: s2, sy: s2 * 0.8, sz: s2 * 1.1, ry: rnd() * 6.28, rx: 0, tint: 0.85 + rnd() * 0.25 });
            }
        }
        this.rockData = data;

        const mesh = new THREE.InstancedMesh(this.rockGeometry, this.rockMaterial, Math.max(1, data.length));
        mesh.count = data.length;
        mesh.name = 'rockOutcrops';
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const col = new THREE.Color();
        data.forEach((d, i) => {
            col.setScalar(d.tint);
            mesh.setColorAt(i, col);
        });
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        this.rocks = mesh;
        this.snapRocks();
        this.scene.add(mesh);
    }

    /** Re-seat rock instances on the (possibly sculpted) surface. */
    snapRocks() {
        if (!this.rocks || !this.rockData) return;
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const e = new THREE.Euler();
        const p = new THREE.Vector3();
        const sc = new THREE.Vector3();
        this.rockData.forEach((d, i) => {
            const y = this.getHeightAt(d.x, d.z) - d.sy * 0.35;
            e.set(d.rx, d.ry, 0);
            q.setFromEuler(e);
            m.compose(p.set(d.x, y, d.z), q, sc.set(d.sx, d.sy, d.sz));
            this.rocks.setMatrixAt(i, m);
        });
        this.rocks.instanceMatrix.needsUpdate = true;
        this.rocks.computeBoundingSphere();
    }

    // ===== APRON (outer foothills) =====
    apronHeightAt(x, z) {
        const dx = Math.max(Math.abs(x) - this.width / 2, 0);
        const dz = Math.max(Math.abs(z) - this.depth / 2, 0);
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d <= 0) return -3;
        const rise = sstep(140, 2800, d);
        if (rise <= 0) return 0;
        const s = this.colorSeed;
        const hills = fbm2(x * 0.00052 + 3.7, z * 0.00052 - 1.3, s + 303, 4);
        const rn = fbm2(x * 0.0011 - 7.1, z * 0.0011 + 2.9, s + 404, 3);
        const ridge = 1 - Math.abs(rn * 2 - 1);
        const h = 20 + 300 * hills * hills * (0.55 + 0.45 * rise) + 110 * ridge * ridge * ridge * rise;
        // foothills stay near the resort; farther out the valley floor flattens under the ranges
        const far = 1 - 0.85 * sstep(1600, 3200, d);
        return h * rise * far;
    }

    createApron() {
        if (this.apron) {
            this.scene.remove(this.apron);
            this.apron.geometry.dispose();
            this.apron = null;
        }

        let segs = APRON_SEGMENTS;
        try { if (getPreset().terrainDetail === false) segs = 80; } catch (e) { /* keep */ }
        this.apronSegments = segs;

        const geo = new THREE.PlaneGeometry(APRON_SIZE, APRON_SIZE, segs, segs);
        geo.rotateX(-Math.PI / 2);
        const pos = geo.attributes.position.array;
        const n = segs + 1;
        this.apronHeights = new Float32Array(n * n);
        for (let i = 0, v = 0; i < pos.length; i += 3, v++) {
            const h = this.apronHeightAt(pos[i], pos[i + 2]);
            pos[i + 1] = h;
            const col = Math.round((pos[i] / APRON_SIZE + 0.5) * segs);
            const row = Math.round((pos[i + 2] / APRON_SIZE + 0.5) * segs);
            this.apronHeights[row * n + col] = h;
        }
        geo.computeVertexNormals();

        // Colors: same palette function as the terrain so the seam disappears
        const nrm = geo.attributes.normal.array;
        const colors = new Float32Array(pos.length);
        const col = this._tmpColor;
        const s = this.colorSeed;
        for (let i = 0; i < pos.length; i += 3) {
            const x = pos[i], y = pos[i + 1], z = pos[i + 2];
            const nA = fbm2(x * 0.0016, z * 0.0016, s + 11, 3);
            const nB = fbm2(x * 0.0065, z * 0.0065, s + 23, 2);
            const fRaw = fbm2(x * 0.0011, z * 0.0011, s + 101, 3);
            // distant forests: grove noise, thinning with altitude
            const forest = sstep(FOREST_LO, FOREST_HI, fRaw) * (1 - sstep(240, 480, y));
            this.snowColor(x, y, z, nrm[i], nrm[i + 1], nrm[i + 2], nA, nB, forest, col);
            // Beyond the band of real tree instances, groves become a painted
            // dark-pine carpet on the foothills (reads as distant woods through the haze)
            if (forest > 0) {
                const ex = Math.max(Math.abs(x) - this.width / 2, 0);
                const ez = Math.max(Math.abs(z) - this.depth / 2, 0);
                const edgeD = Math.sqrt(ex * ex + ez * ez);
                col.lerp(C.pineDeep, forest * 0.38 * sstep(500, 1400, edgeD));
            }
            colors[i] = col.r;
            colors[i + 1] = col.g;
            colors[i + 2] = col.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        this.apron = new THREE.Mesh(geo, this.material);
        this.apron.receiveShadow = true;
        this.apron.castShadow = false;
        this.apron.name = 'terrainApron';
        this.groundPlane = this.apron;
        this.scene.add(this.apron);
    }

    /** Height of the outer apron at (x,z) (bilinear on its grid). */
    getApronHeightAt(x, z) {
        if (!this.apronHeights) return 0;
        const segs = this.apronSegments || APRON_SEGMENTS;
        const n = segs + 1;
        const fx = Math.max(0, Math.min(segs - 1e-4, (x / APRON_SIZE + 0.5) * segs));
        const fz = Math.max(0, Math.min(segs - 1e-4, (z / APRON_SIZE + 0.5) * segs));
        const x0 = Math.floor(fx), z0 = Math.floor(fz);
        const tx = fx - x0, tz = fz - z0;
        const h = this.apronHeights;
        // match the PlaneGeometry triangle split (diagonal from (x0,z0+1) to (x0+1,z0))
        const a = h[z0 * n + x0], b = h[z0 * n + x0 + 1], c = h[(z0 + 1) * n + x0], d = h[(z0 + 1) * n + x0 + 1];
        if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
        return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
    }

    /** Ground height anywhere: terrain inside the rectangle, apron outside. */
    getGroundHeightAt(x, z) {
        if (Math.abs(x) <= this.width / 2 && Math.abs(z) <= this.depth / 2) return this.getHeightAt(x, z);
        return this.getApronHeightAt(x, z);
    }

    /**
     * Forest density 0..1 at (x,z): low-frequency grove noise (open meadows
     * between groves), thinning toward the tree line and off steep slopes.
     */
    getForestDensity(x, z) {
        const raw = fbm2(x * 0.0011, z * 0.0011, this.colorSeed + 101, 3);
        const groves = sstep(FOREST_LO, FOREST_HI, raw);
        if (groves <= 0) return 0;
        const inside = Math.abs(x) <= this.width / 2 && Math.abs(z) <= this.depth / 2;
        const h = inside ? this.getHeightAt(x, z) : this.getApronHeightAt(x, z);
        const alt = h / this.maxHeight;
        const altF = 1 - sstep(0.55, 0.8, alt);
        let slopeF = 1;
        if (inside) slopeF = 1 - sstep(0.35, 0.6, this.getSlopeAt(x, z));
        return groves * altF * slopeF;
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

        // ===== 4b. CRAGS (ridged noise near cluster cores, gives rock faces up high) =====
        let cragMask = 0;
        for (const cluster of this.clusters) {
            const dx = x - cluster.x;
            const dz = z - cluster.z;
            const r = cluster.spreadRadius;
            cragMask = Math.max(cragMask, cluster.heightScale * Math.exp(-(dx * dx + dz * dz) / (r * r * 0.22)));
        }
        if (cragMask > 0.02) {
            const cn = this.fbmNoise(warpedX * 0.0032 + 400, warpedZ * 0.0032 - 300, 3, 0.5, 2.1);
            const ridged = 1 - Math.abs(cn);
            height += ridged * ridged * ridged * CRAG_AMPLITUDE * cragMask * edgeFalloff;
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

    // ===== COLORS =====

    /** Cache static per-vertex color noise (depends only on x/z + seed). */
    computeColorNoise() {
        const positions = this.geometry.attributes.position.array;
        const count = positions.length / 3;
        if (!this.colorNoiseA || this.colorNoiseA.length !== count) {
            this.colorNoiseA = new Float32Array(count);
            this.colorNoiseB = new Float32Array(count);
            this.forestNoise = new Float32Array(count);
        }
        const s = this.colorSeed;
        for (let v = 0, i = 0; v < count; v++, i += 3) {
            const x = positions[i];
            const z = positions[i + 2];
            this.colorNoiseA[v] = fbm2(x * 0.0016, z * 0.0016, s + 11, 3);
            this.colorNoiseB[v] = fbm2(x * 0.0065, z * 0.0065, s + 23, 2);
            this.forestNoise[v] = fbm2(x * 0.0011, z * 0.0011, s + 101, 3);
        }
    }

    /**
     * Shared palette function (terrain + apron). Allocation-free: writes `out`.
     * nA = broad 0..1 noise, nB = medium 0..1 noise, forest = 0..1 grove density.
     */
    snowColor(x, y, z, nx, ny, nz, nA, nB, forest, out) {
        const alt = Math.max(0, y) / this.maxHeight;
        const ndl = nx * SUN_DIR.x + ny * SUN_DIR.y + nz * SUN_DIR.z;

        // Base snow: broad painterly drifts between mid and warm-lit snow
        let litT = sstep(0.3, 0.72, nA) * 0.65 + sstep(0.25, 0.75, ndl) * 0.45;
        out.copy(C.snowMid).lerp(C.snowLit, Math.min(1, litT));

        // Cool shade on steeper / sun-averted slopes (lighting adds the rest)
        // Kept subtle and sharp: real lighting carries the form; a broad, strong
        // term here smeared into soft navy blotches at editor distance.
        const shadeT = sstep(0.95, 0.8, ny) * 0.22 + sstep(0.05, -0.12, ndl) * 0.18;
        if (shadeT > 0) out.lerp(C.snowShade, Math.min(0.32, shadeT));

        // Wind-scoured icy tint near summits
        const iceT = sstep(0.5, 0.9, alt) * (0.3 + 0.6 * nB);
        if (iceT > 0) out.lerp(C.snowIce, iceT * 0.75);

        // Forest floor: slightly darker, bluer snow so groves read from afar
        if (forest > 0) out.lerp(C.snowForest, forest * 0.45);

        // Rock on steep faces, banded by altitude (strata) with warm lichen patches
        // Narrow transition = crisp rock edges (a wide one read as soft smudges).
        const thr = (nB - 0.5) * 0.06;
        const rockT = sstep(0.8 + thr, 0.74 + thr, ny);
        if (rockT > 0) {
            // stepped strata bands rather than a smooth sine wash
            const strata = Math.floor((0.5 + 0.5 * Math.sin(y * 0.075 + nB * 7.0 + nA * 4.0)) * 3) / 2;
            const rock = this._tmpRock || (this._tmpRock = new THREE.Color());
            rock.copy(C.rockDark).lerp(C.rockLight, 0.2 + strata * 0.3 + nB * 0.45);
            rock.lerp(C.rockWarm, sstep(0.45, 0.8, nA) * 0.5);
            // Subtle: smooth 7.5-unit vertex colour cannot draw crisp rock, so steep
            // faces get a light scoured-grey wash; the faceted outcrop instances
            // supply the real, sharp rock.
            out.lerp(rock, rockT * 0.38);
        }
        return out;
    }

    applyVertexColors() {
        const positions = this.geometry.attributes.position.array;
        const normals = this.geometry.attributes.normal.array;
        if (!this.colorNoiseA || this.colorNoiseA.length !== positions.length / 3) this.computeColorNoise();

        let attr = this.geometry.attributes.color;
        if (!attr || attr.array.length !== positions.length) {
            attr = new THREE.BufferAttribute(new Float32Array(positions.length), 3);
            this.geometry.setAttribute('color', attr);
        }
        const colors = attr.array;
        const color = this._tmpColor;
        const nAarr = this.colorNoiseA, nBarr = this.colorNoiseB, fArr = this.forestNoise;
        const invMax = 1 / this.maxHeight;

        for (let i = 0, v = 0; i < positions.length; i += 3, v++) {
            const y = positions[i + 1];
            const ny = normals[i + 1];
            // Forest density (same formula as getForestDensity, from cached data)
            let forest = sstep(FOREST_LO, FOREST_HI, fArr[v]);
            if (forest > 0) {
                forest *= (1 - sstep(0.55, 0.8, y * invMax)) * (1 - sstep(0.35, 0.6, 1 - Math.abs(ny)));
            }
            this.snowColor(positions[i], y, positions[i + 2], normals[i], ny, normals[i + 2],
                nAarr[v], nBarr[v], forest, color);
            colors[i] = color.r;
            colors[i + 1] = color.g;
            colors[i + 2] = color.b;
        }
        attr.needsUpdate = true;
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
        this.geometry.computeBoundingSphere();
        this.snapRocks();
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
        this.buildFeatures();

        this.generateHeightMap();
        this.applyHeightMap();
        this.geometry.computeVertexNormals();
        this.geometry.computeBoundingSphere();
        this.geometry.computeBoundingBox();
        this.computeColorNoise();
        this.applyVertexColors();

        this.createApron();
        this.createRocks();
    }

    /** Optional per-frame hook (drives the detail shader clock). */
    update(delta) {
        this.uniforms.uTime.value += delta || 0;
    }
}
