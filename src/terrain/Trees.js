/**
 * Trees - Instanced, faceted, snow-laden conifers ("Alpenglow" art direction)
 *
 * Three variants (pine, tall spruce, snow-heavy fir) built from drooping,
 * slightly irregular tiers with snow caps, merged into one vertex-colored
 * geometry per variant and drawn as spatially chunked InstancedMeshes (frustum + shadow culled per chunk).
 * Placement follows a low-frequency grove density (Mountain.getForestDensity),
 * giving dense forests, open meadows and a thinning tree line. A thin band of
 * forest continues onto the outer apron so the terrain rectangle never shows.
 *
 * Wind sway is a vertex-shader bend driven by Trees.update(delta).
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getPreset } from '../core/quality.js';
import { events } from '../core/events.js';

// ===== Palette (DESIGN_BRIEF §1.1) =====
const COL = {
    // A step brighter/greener than the brief's swatches: after ACES and fog the
    // authored values crushed to black specks at editor distance.
    pineDeep: new THREE.Color(0x214536),
    pineMid: new THREE.Color(0x336a50),
    pineTip: new THREE.Color(0x5b9466),
    trunk: new THREE.Color(0x4a3426),
    snowTop: new THREE.Color(0xf8fafd),
    snowEdge: new THREE.Color(0xd6e2f0),
};

// ~124 triangles per tree, so the forest is cheap; groves need numbers to read.
const BASE_TREE_COUNT = 16000;
const APRON_TREE_SHARE = 0.3;  // share of trees placed just beyond the terrain edge
const APRON_BAND = 800;        // how far beyond the terrain edge the forest continues
// Spatial chunking: each variant is split into ~1000-unit cells over the
// terrain (plus 4 apron sides) so camera AND shadow frustum culling can skip
// whole groves. Ski mode's 70-unit shadow frustum touches 1-2 chunks instead
// of the whole 4000-tree forest.
const CHUNK_SIZE = 1000;
// Distance LOD: chunks whose nearest point is farther than LOD_FAR from the
// camera swap to a ~18-triangle tree (same silhouette, colours, sway); they
// come back below LOD_NEAR (hysteresis). Re-evaluated a few times per second.
const LOD_NEAR = 1100;
const LOD_FAR = 1300;
const LOD_INTERVAL_MS = 200;

// ===== Template variants =====
// Each tier: base radius r, height h, base y. Template heights are ~10-13 units.
const VARIANTS = {
    pine: {
        segs: 8,
        trunk: { r0: 0.42, r1: 0.22, h: 2.4 },
        tiers: 6, baseY: 1.4, top: 11.2, r0: 3.3, r1: 0.9,
        droop: 0.55, snow: 0.74, snowDepth: 0.55, jag: 0.16,
    },
    tall: {
        segs: 7,
        trunk: { r0: 0.36, r1: 0.18, h: 2.8 },
        tiers: 7, baseY: 1.8, top: 13.0, r0: 2.5, r1: 0.6,
        droop: 0.5, snow: 0.66, snowDepth: 0.46, jag: 0.14,
    },
    snowy: {
        segs: 8,
        trunk: { r0: 0.4, r1: 0.22, h: 2.0 },
        tiers: 5, baseY: 1.2, top: 10.2, r0: 3.4, r1: 1.0,
        droop: 0.7, snow: 0.92, snowDepth: 0.8, jag: 0.2,
    },
};

// Deterministic tiny RNG for template irregularity
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function paint(geo, fn) {
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
        fn(pos.getX(i), pos.getY(i), pos.getZ(i), c, i);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
}

/**
 * A drooping, star-edged cone tier. Ring vertices alternate long/short
 * (branch tips) and sag at the tips; the underside cap is pushed up into a
 * concave dark skirt.
 */
function makeTier(r, h, y, segs, droop, jag, rand, rot, cap = true) {
    const geo = new THREE.ConeGeometry(r, h, segs, 1, !cap, rot);
    const pos = geo.attributes.position;
    const half = h / 2;
    const ringJitter = [];
    for (let k = 0; k <= segs; k++) ringJitter.push(rand());
    for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
        const rad = Math.hypot(px, pz);
        if (py < -half + 1e-4) {
            if (rad < 1e-4) {
                // cap center -> concave underside
                pos.setY(i, -half + h * 0.32);
                continue;
            }
            const ang = Math.atan2(pz, px) - rot;
            const k = Math.round(((ang / (Math.PI * 2)) * segs + segs * 4)) % segs;
            const tip = (k % 2 === 0) ? 1 + jag : 1 - jag * 0.6;
            const j = 0.92 + ringJitter[k] * 0.16;
            const s = tip * j;
            pos.setX(i, px * s);
            pos.setZ(i, pz * s);
            pos.setY(i, -half - droop * h * 0.35 * (k % 2 === 0 ? 1 : 0.55) * j);
        }
    }
    geo.translate(0, y + half, 0);
    return geo;
}

/** Snow cap draped over the upper part of a tier, with drippy edge. */
function makeSnowCap(r, depth, apexY, segs, jag, rand, rot) {
    const geo = new THREE.ConeGeometry(r, depth, segs, 1, true, rot);
    const pos = geo.attributes.position;
    const half = depth / 2;
    for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
        if (py < -half + 1e-4) {
            const ang = Math.atan2(pz, px) - rot;
            const k = Math.round(((ang / (Math.PI * 2)) * segs + segs * 4)) % segs;
            const tip = (k % 2 === 0) ? 1 + jag * 0.9 : 1 - jag * 0.3;
            pos.setX(i, px * tip);
            pos.setZ(i, pz * tip);
            pos.setY(i, -half - depth * (0.12 + rand() * 0.22) * (k % 2 === 0 ? 1.0 : 0.4));
        }
    }
    // apex slightly above the green apex so the top reads white
    geo.translate(0, apexY - half + depth * 0.06, 0);
    return geo;
}

/** Remove zero-area triangles (r161 cones emit a degenerate apex triangle per segment). */
function dropDegenerate(geo) {
    const pos = geo.attributes.position.array;
    const col = geo.attributes.color.array;
    const keepP = [];
    const keepC = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < pos.length; i += 9) {
        a.fromArray(pos, i); b.fromArray(pos, i + 3); c.fromArray(pos, i + 6);
        b.sub(a); c.sub(a);
        if (b.cross(c).lengthSq() < 1e-10) continue;
        for (let k = 0; k < 9; k++) { keepP.push(pos[i + k]); keepC.push(col[i + k]); }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(keepP, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(keepC, 3));
    geo.dispose();
    return out;
}

function buildTemplate(variantKey, seed = 7) {
    const v = VARIANTS[variantKey] || VARIANTS.pine;
    const rand = mulberry32(seed * 7919 + variantKey.length * 131);
    const geos = [];
    const H = v.top;

    // Trunk
    const trunk = new THREE.CylinderGeometry(v.trunk.r1, v.trunk.r0, v.trunk.h, 6, 1, true);
    trunk.translate(0, v.trunk.h / 2 - 0.3, 0);
    paint(trunk, (x, y, z, c) => c.copy(COL.trunk).multiplyScalar(y < 0.6 ? 0.8 : 1.0));
    geos.push(trunk);

    // Tiers, bottom to top, overlapping
    const span = v.top - v.baseY;
    for (let t = 0; t < v.tiers; t++) {
        const f = t / (v.tiers - 1);              // 0 bottom .. 1 top
        const r = THREE.MathUtils.lerp(v.r0, v.r1, Math.pow(f, 0.9)) * (0.94 + rand() * 0.12);
        const yBase = v.baseY + span * Math.pow(f, 1.08) * 0.82;
        const h = t === v.tiers - 1 ? (v.top - yBase) : r * 1.25 + 0.6;
        const rot = rand() * Math.PI * 2;
        // undersides are only visible on the lowest tiers (skier eye level)
        const tier = makeTier(r, h, yBase, v.segs, v.droop, v.jag, rand, rot, t < 2);
        const apexY = yBase + h;
        const tierLow = yBase - h * 0.3;
        // color: deep at the skirt -> mid -> tip near apex, lighter overall toward the crown
        const crown = COL.pineMid.clone().lerp(COL.pineTip, 0.35 + f * 0.65).multiplyScalar(1.35);
        const skirt = COL.pineDeep.clone().lerp(COL.pineMid, 0.35 + f * 0.3).multiplyScalar(1.15);
        paint(tier, (x, y, z, c) => {
            const k = THREE.MathUtils.clamp((y - tierLow) / (apexY - tierLow), 0, 1);
            const rad = Math.hypot(x, z);
            if (y < yBase + h * 0.36 && rad < r * 0.5) {
                c.copy(COL.pineDeep).multiplyScalar(0.7); // underside
            } else {
                c.copy(skirt).lerp(crown, k * 0.9 + 0.1);
            }
        });
        geos.push(tier);

        // Snow cap
        const snowR = r * v.snow * (0.92 + rand() * 0.14);
        const snowD = h * v.snowDepth;
        const cap = makeSnowCap(snowR, snowD, apexY, v.segs, v.jag, rand, rot + Math.PI / v.segs * 0.0);
        const capTop = apexY + snowD * 0.06;
        const capLow = capTop - snowD * 1.3;
        paint(cap, (x, y, z, c) => {
            const k = THREE.MathUtils.clamp((y - capLow) / (capTop - capLow), 0, 1);
            c.copy(COL.snowEdge).lerp(COL.snowTop, k);
        });
        geos.push(cap);
    }

    const merged = dropDegenerate(mergeGeometries(geos.map(g => g.index ? g.toNonIndexed() : g)));
    geos.forEach(g => g.dispose());
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    merged.userData.height = H;
    return merged;
}

/**
 * Far-LOD tree: three stacked 6-sided cones (~18 tris) sized to the variant's
 * tiers. Vertex colours go from the tier's pine green at the skirt to snow at
 * the apex, so the average tone matches the full tree at a distance.
 */
function buildLodTemplate(variantKey) {
    const v = VARIANTS[variantKey] || VARIANTS.pine;
    const geos = [];
    const tiers = 3;
    const span = v.top - v.baseY;
    for (let t = 0; t < tiers; t++) {
        const f = t / (tiers - 1);
        const r = THREE.MathUtils.lerp(v.r0 * 1.02, v.r1 * 1.6, f);
        const yBase = v.baseY - 0.5 + span * f * 0.62;
        const h = t === tiers - 1 ? v.top - yBase + 0.2 : span * 0.5;
        const cone = new THREE.ConeGeometry(r, h, 6, 1, true, t * 0.5);
        cone.translate(0, yBase + h / 2, 0);
        const skirt = COL.pineDeep.clone().lerp(COL.pineMid, 0.55 + f * 0.3).multiplyScalar(1.3);
        const snow = COL.snowEdge.clone().lerp(COL.snowTop, 0.5);
        paint(cone, (x, y, z, c) => {
            const k = THREE.MathUtils.clamp((y - yBase) / h, 0, 1);
            // full trees show snow on every tier, so even the skirt carries some
            c.copy(skirt).lerp(snow, 0.28 + 0.72 * Math.min(1, k * 1.15) * v.snow);
        });
        geos.push(cone);
    }
    const merged = dropDegenerate(mergeGeometries(geos.map(g => g.index ? g.toNonIndexed() : g)));
    geos.forEach(g => g.dispose());
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    return merged;
}

// ===== Shared (module-level) resources for standalone trees =====
let _sharedTemplates = null;
let _standaloneMaterial = null;

function getTemplates() {
    if (!_sharedTemplates) {
        _sharedTemplates = {
            pine: buildTemplate('pine', 3),
            tall: buildTemplate('tall', 5),
            snowy: buildTemplate('snowy', 9),
        };
    }
    return _sharedTemplates;
}

function getStandaloneMaterial() {
    if (!_standaloneMaterial) {
        _standaloneMaterial = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.92,
            metalness: 0,
            flatShading: true,
        });
    }
    return _standaloneMaterial;
}

function normalizeVariant(variant) {
    if (variant === 'tall' || variant === 'spruce') return 'tall';
    if (variant === 'snowy' || variant === 'snow' || variant === 'fir') return 'snowy';
    return 'pine';
}

/**
 * Standalone tree with the same look as the instanced forest (1 mesh).
 * Scale lives on the inner mesh so callers can animate the root's scale/rotation.
 */
export function createStandaloneTree(variant = 'pine', scale = 1) {
    const key = normalizeVariant(variant);
    const group = new THREE.Group();
    group.name = 'pineTree';
    group.userData.isTree = true;
    group.userData.knockedDown = false;
    group.userData.variant = key;

    const mesh = new THREE.Mesh(getTemplates()[key], getStandaloneMaterial());
    mesh.name = 'pineTreeMesh';
    mesh.scale.setScalar(scale);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    group.add(mesh);
    return group;
}

export class Trees {
    constructor(scene, mountain) {
        this.scene = scene;
        this.mountain = mountain;
        this.treeGroup = new THREE.Group();
        this.treeGroup.name = 'treeGroup';

        // Instanced meshes (one per variant)
        this.instancedMeshes = [];
        // Far-LOD twins (share each chunk's instance matrices/colours) + chunk bounds
        this.lodMeshes = [];
        this.chunks = [];
        this._lodNext = 0;
        this._lodHooked = false;

        // Tree data for collision detection and knockdown
        this.treeData = [];

        // Fallback (knocked-down) trees spawned into the scene
        this.fallbackTrees = [];

        // Materials
        this.instancedMaterial = null;
        this.uniforms = { uTime: { value: 0 }, uWind: { value: 1 } };

        // Legacy material fields (kept for compatibility)
        this.trunkMaterial = null;
        this.foliageMaterial = null;
        this.snowMaterial = null;

        this._tmpMatrix = new THREE.Matrix4();
        this.density = 1;

        // Runtime quality changes thin / restore the forest without a rebuild.
        events.on('quality:change', ({ preset } = {}) => {
            if (preset && typeof preset.treeDensity === 'number') this.setDensity(preset.treeDensity);
        });
    }

    /**
     * Show only the first `d` share of each chunk's instances. Instances are
     * stored sorted by a random LOD key, so lowering mesh.count drops a
     * uniformly random subset (no matrix rewrites, knockdown indices stay valid).
     */
    setDensity(d) {
        d = Math.max(0.05, Math.min(1, d));
        this.density = d;
        for (const mesh of this.instancedMeshes) {
            const keys = mesh.userData.lodKeys;
            if (!keys) continue;
            let n = 0;
            while (n < keys.length && keys[n] < d) n++;
            mesh.count = n;
            if (mesh.userData.lodMesh) mesh.userData.lodMesh.count = n;
        }
        for (const e of this.treeData) e.culled = e.lod >= d;
    }

    // ===== POPULATE =====
    populate() {
        this.createMaterials();
        if (!this.treeGroup.parent) this.scene.add(this.treeGroup);

        let density = 1;
        try { density = getPreset().treeDensity ?? 1; } catch (e) { /* default */ }
        // Always generate the full forest; quality just shows a subset.
        const target = BASE_TREE_COUNT;
        const apronTarget = Math.round(target * APRON_TREE_SHARE);
        const terrainTarget = target - apronTarget;

        const m = this.mountain;
        const hw = m.width / 2;
        const hd = m.depth / 2;
        const hasDensity = typeof m.getForestDensity === 'function';
        const buckets = { pine: [], tall: [], snowy: [] };
        const treeLine = m.maxHeight * 0.8;

        const tryPlace = (x, z, d, onApron) => {
            const y = onApron
                ? (m.getApronHeightAt ? m.getApronHeightAt(x, z) : 0)
                : m.getHeightAt(x, z);
            if (y > treeLine && !onApron) return false;

            const alt = y / m.maxHeight;
            // variant: snow-heavy up high, tall spruces in the dense core, pines elsewhere
            const r = Math.random();
            let key;
            if (r < 0.15 + alt * 0.6) key = 'snowy';
            else if (r < 0.5 + d * 0.2) key = 'tall';
            else key = 'pine';

            // scale ~1.1..2.6 (14-34 units, mature conifers next to a 1.8 skier):
            // biggest in dense cores, younger at grove edges
            const scale = (1.1 + 1.5 * Math.pow(Math.random(), 1.3) * (0.4 + 0.6 * d)) * (onApron ? 1.15 : 1);

            let rotX = (Math.random() - 0.5) * 0.06;
            let rotZ = (Math.random() - 0.5) * 0.06;
            if (!onApron) {
                const n = m.getNormalAt(x, z);
                rotX += -n.z * 0.08;
                rotZ += n.x * 0.08;
            }

            buckets[key].push({
                x, y: y - 0.35 * scale, z,
                rotX, rotY: Math.random() * Math.PI * 2, rotZ,
                scale,
                tint: 0.9 + Math.random() * 0.18,
                hue: (Math.random() - 0.5) * 0.06,
                lod: Math.random(),
                onApron,
            });
            return true;
        };

        // --- Terrain forests (groves + scattered singles in meadows) ---
        let placed = 0;
        let attempts = 0;
        const maxAttempts = terrainTarget * 40;
        while (placed < terrainTarget && attempts < maxAttempts) {
            attempts++;
            const x = (Math.random() - 0.5) * m.width * 0.98;
            const z = (Math.random() - 0.5) * m.depth * 0.98;
            const d = hasDensity ? m.getForestDensity(x, z) : 0.5;
            // dense groves + a rare lone tree in the open
            if (Math.random() > Math.pow(d, 1.6) + 0.0015) continue;
            if (!hasDensity && m.getSlopeAt(x, z) > 0.7) continue;
            if (!tryPlace(x, z, d, false)) continue;
            placed++;

            // small clumps: a few neighbors close by
            const clump = d > 0.35 ? 1 + Math.floor(Math.random() * 4) : 0;
            for (let c = 0; c < clump && placed < terrainTarget; c++) {
                const a = Math.random() * Math.PI * 2;
                const rr = 9 + Math.random() * 16;
                const cx = x + Math.cos(a) * rr;
                const cz = z + Math.sin(a) * rr;
                if (Math.abs(cx) > hw * 0.99 || Math.abs(cz) > hd * 0.99) continue;
                const cd = hasDensity ? m.getForestDensity(cx, cz) : d;
                if (cd < 0.2) continue;
                if (tryPlace(cx, cz, cd, false)) placed++;
            }
        }

        // --- Apron band: forest continues past the terrain edge ---
        if (hasDensity && m.getApronHeightAt) {
            let ap = 0;
            let tries = 0;
            while (ap < apronTarget && tries < apronTarget * 40) {
                tries++;
                const x = (Math.random() - 0.5) * (m.width + APRON_BAND * 2);
                const z = (Math.random() - 0.5) * (m.depth + APRON_BAND * 2);
                if (Math.abs(x) < hw && Math.abs(z) < hd) continue;
                // densest at the seam (matching the terrain groves), thinning outward
                const ex = Math.max(Math.abs(x) - hw, 0), ez = Math.max(Math.abs(z) - hd, 0);
                const thin = 1 - 0.75 * Math.min(1, Math.sqrt(ex * ex + ez * ez) / APRON_BAND);
                const d = m.getForestDensity(x, z);
                if (Math.random() > Math.pow(d, 1.4) * thin) continue;
                if (tryPlace(x, z, d, true)) ap++;
                // clumps, like the terrain groves
                for (let c = d > 0.4 ? 2 : 0; c > 0 && ap < apronTarget; c--) {
                    const a = Math.random() * Math.PI * 2;
                    const rr = 10 + Math.random() * 18;
                    const cx = x + Math.cos(a) * rr, cz = z + Math.sin(a) * rr;
                    if (Math.abs(cx) < hw && Math.abs(cz) < hd) continue;
                    const cd = m.getForestDensity(cx, cz);
                    if (cd > 0.25 && tryPlace(cx, cz, cd, true)) ap++;
                }
            }
        }

        // Build template geometries (merged, vertex colored)
        const templates = {
            pine: buildTemplate('pine', 3),
            tall: buildTemplate('tall', 5),
            snowy: buildTemplate('snowy', 9),
        };
        const lodTemplates = {
            pine: buildLodTemplate('pine'),
            tall: buildLodTemplate('tall'),
            snowy: buildLodTemplate('snowy'),
        };
        for (const key of ['pine', 'tall', 'snowy']) {
            const chunks = new Map();
            for (const t of buckets[key]) {
                let ck;
                if (t.onApron) {
                    // 4 apron sides
                    const ax = Math.abs(t.x) / hw, az = Math.abs(t.z) / hd;
                    ck = ax > az ? (t.x > 0 ? 'aE' : 'aW') : (t.z > 0 ? 'aS' : 'aN');
                } else {
                    const cx = Math.floor((t.x + hw) / CHUNK_SIZE);
                    const cz = Math.floor((t.z + hd) / CHUNK_SIZE);
                    ck = `${cx},${cz}`;
                }
                if (!chunks.has(ck)) chunks.set(ck, []);
                chunks.get(ck).push(t);
            }
            for (const [ck, list] of chunks) {
                list.sort((a, b) => a.lod - b.lod);
                // Template geometry is shared by all chunks of a variant.
                this.createInstancedMesh(key, templates[key], list, ck, lodTemplates[key]);
            }
            if (chunks.size === 0) { templates[key].dispose(); lodTemplates[key].dispose(); }
        }
        this.setDensity(density);
        this._installLodHook();

    }

    createMaterials() {
        if (this.instancedMaterial) return;

        // Instanced trees: vertex colors x per-instance color, with wind sway
        this.instancedMaterial = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.92,
            metalness: 0,
            flatShading: true,
        });
        const uniforms = this.uniforms;
        this.instancedMaterial.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = uniforms.uTime;
            shader.uniforms.uWind = uniforms.uWind;
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
                .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
{
    vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    float ph = ip.x * 0.021 + ip.z * 0.017;
    float sw = sin(uTime * 1.25 + ph) * 0.7 + sin(uTime * 2.9 + ph * 2.3) * 0.3;
    float hh = max(position.y, 0.0) / 12.0;
    float bend = hh * hh * uWind;
    transformed.x += sw * 0.16 * bend;
    transformed.z += cos(uTime * 1.05 + ph) * 0.09 * bend;
}
#endif`);
        };
        this.instancedMaterial.customProgramCacheKey = () => 'alpine-tree-sway-v1';

        // Legacy materials (still used by populateZone/old callers)
        this.trunkMaterial = new THREE.MeshStandardMaterial({ color: COL.trunk, roughness: 1.0, flatShading: true });
        this.foliageMaterial = new THREE.MeshStandardMaterial({ color: COL.pineMid, roughness: 0.9, flatShading: true });
        this.snowMaterial = new THREE.MeshStandardMaterial({ color: COL.snowTop, roughness: 0.8, flatShading: true });
    }

    createInstancedMesh(variant, geometry, positions, chunkKey = '', lodGeometry = null) {
        const count = positions.length;
        if (count === 0) return;

        const mesh = new THREE.InstancedMesh(geometry, this.instancedMaterial, count);
        // Apron forest lies outside every shadow frustum we use; skip it there.
        mesh.castShadow = !chunkKey.startsWith('a');
        mesh.receiveShadow = false;
        mesh.name = `trees_${variant}${chunkKey ? '_' + chunkKey : ''}`;
        mesh.userData.lodKeys = positions.map((p) => p.lod ?? 0);

        const matrix = this._tmpMatrix;
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scl = new THREE.Vector3();
        const euler = new THREE.Euler();
        const tint = new THREE.Color();

        for (let i = 0; i < count; i++) {
            const data = positions[i];

            pos.set(data.x, data.y, data.z);
            euler.set(data.rotX, data.rotY, data.rotZ);
            quat.setFromEuler(euler);
            scl.setScalar(data.scale);

            matrix.compose(pos, quat, scl);
            mesh.setMatrixAt(i, matrix);

            // ±8% value, slight warm/cool hue drift
            tint.setRGB(data.tint * (1 + data.hue), data.tint, data.tint * (1 - data.hue));
            mesh.setColorAt(i, tint);

            // Store data for collision detection
            this.treeData.push({
                variant,
                instanceIndex: i,
                mesh,
                position: new THREE.Vector3(data.x, data.y, data.z),
                scale: data.scale,
                radius: 0.5 * data.scale,   // trunk + inner branches, world units
                rotation: new THREE.Euler(data.rotX, data.rotY, data.rotZ),
                knockedDown: false,
                lod: data.lod ?? 0,
                culled: false,
            });
        }

        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        this.instancedMeshes.push(mesh);
        this.treeGroup.add(mesh);

        if (!lodGeometry) return;
        // Far LOD: same instances (shared attributes, so hideInstance and
        // setDensity apply to both). It is cheap enough to keep casting shadows
        // where the shadow frustum reaches, so tree shadows survive the swap.
        const lod = new THREE.InstancedMesh(lodGeometry, this.instancedMaterial, count);
        lod.instanceMatrix = mesh.instanceMatrix;
        lod.instanceColor = mesh.instanceColor;
        lod.castShadow = mesh.castShadow;
        lod.receiveShadow = false;
        lod.name = mesh.name + '_lod';
        lod.visible = false;
        lod.computeBoundingSphere();
        mesh.userData.lodMesh = lod;
        this.lodMeshes.push(lod);
        this.treeGroup.add(lod);

        const box = new THREE.Box3();
        for (const p of positions) box.expandByPoint(pos.set(p.x, p.y, p.z));
        box.max.y += 35;
        this.chunks.push({ mesh, lod, box, far: false });
    }

    /**
     * Pick each chunk's LOD from the camera that is about to render. Hooked on
     * scene.onBeforeRender, which three calls before frustum projection, so the
     * swap applies to the same frame. Throttled to a few checks per second.
     */
    _installLodHook() {
        if (this._lodHooked) return;
        this._lodHooked = true;
        const prev = this.scene.onBeforeRender;
        const self = this;
        this.scene.onBeforeRender = function (renderer, scene, camera, ...rest) {
            if (prev && prev !== THREE.Object3D.prototype.onBeforeRender) prev.call(this, renderer, scene, camera, ...rest);
            if (camera && camera.isPerspectiveCamera) self.updateLod(camera);
        };
    }

    /** Swap chunk LODs for `camera` (throttled unless `force`). */
    updateLod(camera, force = false) {
        const now = performance.now();
        if (!force && now < this._lodNext) return;
        this._lodNext = now + LOD_INTERVAL_MS;
        const cp = camera.position;
        for (const c of this.chunks) {
            const d = c.box.distanceToPoint(cp);
            const far = c.far ? d > LOD_NEAR : d > LOD_FAR;
            c.far = far;
            c.mesh.visible = !far;
            c.lod.visible = far;
        }
    }

    // Hide an instanced tree (set scale to 0)
    hideInstance(treeEntry) {
        const matrix = this._tmpMatrix;
        matrix.makeScale(0, 0, 0);
        treeEntry.mesh.setMatrixAt(treeEntry.instanceIndex, matrix);
        treeEntry.mesh.instanceMatrix.needsUpdate = true;
    }

    // Create a standalone tree Group for knockdown animation (matches the instance)
    createFallbackTree(treeEntry) {
        const tree = createStandaloneTree(treeEntry.variant, treeEntry.scale);
        const inner = tree.children[0];
        if (inner && treeEntry.rotation) inner.rotation.copy(treeEntry.rotation);
        tree.position.copy(treeEntry.position);
        tree.userData.isTree = true;
        tree.userData.knockedDown = false;
        this.scene.add(tree);
        this.fallbackTrees.push(tree);
        return tree;
    }

    // Create a single tree mesh for placement tool (non-instanced)
    createTreeMesh(type = 'pine') {
        return createStandaloneTree(type, 1);
    }

    // Add a tree at specific position (non-instanced)
    addTree(x, z, type = 'pine') {
        const height = this.mountain.getHeightAt(x, z);
        const tree = this.createTreeMesh(type);
        tree.position.set(x, height, z);
        tree.rotation.y = Math.random() * Math.PI * 2;
        this.scene.add(tree);
        return tree;
    }

    /** Optional per-frame hook: wind sway clock. */
    update(delta) {
        this.uniforms.uTime.value += delta || 0;
    }

    /** Wind strength multiplier for sway (1 = calm breeze, ~2.5 = blizzard). */
    setWindStrength(v) {
        this.uniforms.uWind.value = v;
    }

    // Remove all instanced trees (and any knocked-down fallbacks)
    clear() {
        const geos = new Set();
        this.instancedMeshes.forEach(mesh => {
            this.treeGroup.remove(mesh);
            geos.add(mesh.geometry);
            mesh.dispose?.();
        });
        this.lodMeshes.forEach(mesh => {
            this.treeGroup.remove(mesh);
            geos.add(mesh.geometry);
        });
        geos.forEach((g) => g.dispose());
        this.instancedMeshes = [];
        this.lodMeshes = [];
        this.chunks = [];
        this.treeData = [];
        this.fallbackTrees.forEach(t => this.scene.remove(t));
        this.fallbackTrees = [];
    }

    // --- Legacy standalone builders (all share the new look) ---
    createPineTree(scale = 1) { return createStandaloneTree('pine', scale); }
    createTallPine(scale = 1) { return createStandaloneTree('tall', scale); }
    createSnowyCone(scale = 1) { return createStandaloneTree('snowy', scale); }

    populateZone(zone) {
        const { minX, maxX, minZ, maxZ, density } = zone;
        const area = (maxX - minX) * (maxZ - minZ);
        const treeCount = Math.floor(area * density * 0.08);

        for (let i = 0; i < treeCount; i++) {
            const x = minX + Math.random() * (maxX - minX);
            const z = minZ + Math.random() * (maxZ - minZ);
            const height = this.mountain.getHeightAt(x, z);
            if (height < 1 || height > this.mountain.maxHeight * 0.8) continue;
            if (this.mountain.getSlopeAt(x, z) > 0.7) continue;

            const r = Math.random();
            const key = r < 0.4 ? 'pine' : r < 0.7 ? 'tall' : 'snowy';
            const tree = createStandaloneTree(key, 0.8 + Math.random() * 0.6);
            tree.position.set(x, height, z);
            tree.rotation.y = Math.random() * Math.PI * 2;
            this.treeGroup.add(tree);
        }
    }
}
