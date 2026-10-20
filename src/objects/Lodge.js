/**
 * Lodge - alpine chalets for the resort.
 *
 * Every variant is built from primitives with a PartBuilder and merged by material:
 *   solid  (vertex-colored stone / timber / roof / snow / ice)  -> 1 draw call, casts shadow
 *   glass  (warm emissive windows + lantern glass)              -> 1 draw call
 *   halo   (additive glow points, night only)                   -> 1 draw call
 *   pool   (warm light pool decal on the porch, night only)     -> 1 draw call
 *   smoke  (GPU-animated chimney smoke points)                  -> 1 draw call
 * Templates are cached per variant, so placing many lodges only costs new Mesh objects.
 *
 * Public API (unchanged): constructor(scene, mountain), create(type='main'|'small'|'large').
 * Additions: setNightMode(enabled, instant?), update(delta) (optional; animation is self-driven).
 */

import * as THREE from 'three';
import {
    PALETTE as P, PartBuilder, rng, nightFader, hookTick,
    createSolidMaterial, createWindowMaterial, createGlowMaterials,
    createHaloPoints, createLightPools, markShared,
} from './StructureKit.js';

const _bufSize = new THREE.Vector2();

export class Lodge {
    constructor(scene, mountain) {
        this.scene = scene;
        this.mountain = mountain;

        // Shared materials (one instance per factory; night mode flips them).
        this.solidMaterial = createSolidMaterial({ roughness: 0.86 });
        this.windowMaterial = createWindowMaterial({ day: 0.17, night: 2.8, color: 0x2A3A55 });
        const glow = createGlowMaterials(P.warmWindow);
        this.haloMaterial = glow.halo;
        this.poolMaterial = glow.pool;
        this.smokeMaterial = this.createSmokeMaterial();
        nightFader.register(this.smokeMaterial, 'uniform', 0, 1);

        // Legacy material names (kept so older code that pokes at them still works).
        this.woodMaterial = this.solidMaterial;
        this.roofMaterial = this.solidMaterial;
        this.snowMaterial = this.solidMaterial;
        this.stoneMaterial = this.solidMaterial;

        this.templates = {};
    }

    create(type = 'main') {
        switch (type) {
            case 'small':
                return this.createSmallCabin();
            case 'large':
                return this.createLargeLodge();
            default:
                return this.createMainLodge();
        }
    }

    createMainLodge() { return this.instantiate('main', 'lodge'); }
    createSmallCabin() { return this.instantiate('small', 'smallCabin'); }
    createLargeLodge() { return this.instantiate('large', 'largeLodge'); }

    /** Night lights: warm windows bloom, halos + light pools fade in, smoke tints blue. */
    setNightMode(enabled, instant = false) {
        nightFader.setNight(!!enabled, instant);
    }

    /** Optional: animation is driven by onBeforeRender hooks, so this is a no-op tick. */
    update() {
        nightFader.tick();
    }

    /* --------------------------------------------------------------------- */

    instantiate(variant, name) {
        const t = this.templates[variant] || (this.templates[variant] = this.buildTemplate(variant));
        const group = new THREE.Group();
        group.name = name;

        const solid = new THREE.Mesh(t.solid, this.solidMaterial);
        solid.castShadow = true;
        solid.receiveShadow = true;
        solid.name = name + 'Body';
        hookTick(solid);
        group.add(solid);

        if (t.glass) {
            const glass = new THREE.Mesh(t.glass, this.windowMaterial);
            glass.name = name + 'Windows';
            group.add(glass);
        }
        if (t.haloGeo) {
            const halo = new THREE.Points(t.haloGeo, this.haloMaterial);
            halo.name = 'nightHalo';
            halo.renderOrder = 2;
            group.add(halo);
        }
        if (t.poolGeo) {
            const pool = new THREE.Mesh(t.poolGeo, this.poolMaterial);
            pool.name = 'lightPool';
            pool.renderOrder = 1;
            group.add(pool);
        }
        if (t.smokeGeo) {
            const smoke = new THREE.Points(t.smokeGeo, this.smokeMaterial);
            smoke.name = 'chimneySmoke';
            smoke.renderOrder = 3;
            smoke.frustumCulled = false;
            smoke.onBeforeRender = (renderer, scene, camera, geometry, material) => {
                const u = material.uniforms;
                if (!u) return;
                u.uTime.value = performance.now() / 1000;
                renderer.getDrawingBufferSize(_bufSize);
                const fov = camera.isPerspectiveCamera ? camera.fov : 60;
                u.uScale.value = _bufSize.y / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
            };
            group.add(smoke);
        }

        group.userData.placedObject = true;
        group.userData.footprint = t.footprint;
        return group;
    }

    buildTemplate(variant) {
        const b = new PartBuilder();
        const anchors = { halos: [], pools: [], smoke: [] };
        let footprint;

        if (variant === 'small') {
            this.buildChalet(b, anchors, {
                w: 4.6, d: 4.4, stoneH: 0.7, wallH: 2.5, pitch: 3.0,
                roof: P.roofSlate, roofDark: P.roofSlateDark,
                eave: 0.9, gableOver: 0.7, snowCover: 0.9,
                chimney: { x: -1.1, z: -0.8 },
                door: { x: -0.7, lamp: -1 }, frontWindows: [1.2], sideWindows: 1, backWindows: [0],
                balcony: false, porch: 'stoop', gableWindow: true, seed: 3,
            });
            // firewood stack along the right wall
            const r = rng(11);
            for (let row = 0; row < 3; row++) {
                for (let i = 0; i < 6 - row; i++) {
                    b.cyl('solid', i % 2 ? P.timberEnd : P.timberLight, 0.17, 0.17, 1.1, 6,
                        2.62 + row * 0.02, 0.86 + row * 0.3, -1.3 + i * 0.34 + row * 0.17,
                        0, 0, Math.PI / 2 + (r() - 0.5) * 0.1);
                }
            }
            b.box('solid', P.timberDark, 0.08, 1.4, 0.08, 2.85, 0.9, -1.55);
            b.box('solid', P.timberDark, 0.08, 1.4, 0.08, 2.85, 0.9, 0.65);
            b.box('solid', P.snow, 0.5, 0.12, 2.0, 2.62, 1.66, -0.45);
            footprint = 3.2;
        } else if (variant === 'large') {
            // Main hall: stone ground floor, timber upper floor, red roof, wide terrace.
            this.buildChalet(b, anchors, {
                w: 12, d: 9, stoneH: 2.8, wallH: 3.1, pitch: 4.8,
                roof: P.roofRed, roofDark: P.roofRedDark,
                eave: 1.3, gableOver: 1.1, snowCover: 0.8,
                chimney: { x: 3.2, z: -1.6 }, chimney2: { x: -3.6, z: 1.8 },
                door: { x: 0 }, frontWindows: [-4.2, -2.2, 2.2, 4.2], bigGround: true,
                sideWindows: 3, backWindows: [-3, 0, 3], upperWindows: [-3.6, 3.6],
                balcony: true, porch: 'terrace', gableWindow: true, seed: 7, stringLights: true,
            });
            // Side wing, gable facing +X.
            b.push(8.6, 0, -0.6, Math.PI / 2);
            this.buildChalet(b, anchors, {
                w: 6.4, d: 6.2, stoneH: 1.4, wallH: 2.8, pitch: 3.4,
                roof: P.roofRed, roofDark: P.roofRedDark,
                eave: 1.0, gableOver: 0.8, snowCover: 0.82,
                chimney: null,
                door: { x: 1.2 }, frontWindows: [-1.4], sideWindows: 0, backWindows: [],
                balcony: false, porch: 'stoop', gableWindow: true, seed: 9, noBack: true,
            });
            b.pop();
            // Terrace tables with umbrellas.
            [[-3.8, 7.0], [3.8, 7.0]].forEach(([x, z], i) => this.buildTable(b, x, 0.72, z, i));
            footprint = 9;
        } else {
            this.buildChalet(b, anchors, {
                w: 8, d: 7, stoneH: 1.2, wallH: 3.3, pitch: 3.9,
                roof: P.roofRed, roofDark: P.roofRedDark,
                eave: 1.1, gableOver: 0.9, snowCover: 0.8,
                chimney: { x: 2.2, z: -1.2 },
                door: { x: 0 }, frontWindows: [-2.5, 2.5], sideWindows: 2, backWindows: [-2, 2],
                balcony: true, porch: 'porch', gableWindow: true, seed: 5, stringLights: true,
            });
            footprint = 5.2;
        }

        const t = { footprint };
        t.solid = b.build('solid');
        t.glass = b.build('glass');
        if (anchors.halos.length) {
            const pts = createHaloPoints(anchors.halos, this.haloMaterial);
            t.haloGeo = pts.geometry;
        }
        if (anchors.pools.length) {
            const pool = createLightPools(anchors.pools, this.poolMaterial);
            t.poolGeo = pool.geometry;
        }
        if (anchors.smoke.length) t.smokeGeo = this.createSmokeGeometry(anchors.smoke);
        markShared(t.solid, t.glass, t.haloGeo, t.poolGeo, t.smokeGeo);
        return t;
    }

    /**
     * Parametric chalet. Local frame: origin at ground center, front (door, gable) faces +Z,
     * ridge runs along Z.
     */
    buildChalet(b, A, o) {
        const r = rng(o.seed || 1);
        const W = o.w, D = o.d, S = o.stoneH, H = o.stoneH + o.wallH, PH = o.pitch;
        const ridgeY = H + PH;
        const hw = W / 2, hd = D / 2;

        // --- Stone foundation (sinks 3 units into the ground to hide slopes) ---
        b.box('solid', P.stone, W + 0.3, S + 3, D + 0.3, 0, (S - 3) / 2, 0);
        b.box('solid', P.stoneLight, W + 0.5, 0.16, D + 0.5, 0, S + 0.02, 0);
        // a few protruding stones for texture
        for (let i = 0; i < 18; i++) {
            const side = i % 4;
            const u = r() - 0.5;
            const y = 0.2 + r() * (S - 0.35);
            const sw = 0.5 + r() * 0.5, sh = 0.25 + r() * 0.2;
            const col = r() > 0.5 ? P.stoneDark : P.stoneLight;
            if (S < 0.6) break;
            if (side === 0) b.box('solid', col, sw, sh, 0.1, u * W, y, hd + 0.17);
            else if (side === 1) b.box('solid', col, sw, sh, 0.1, u * W, y, -hd - 0.17);
            else if (side === 2) b.box('solid', col, 0.1, sh, sw, hw + 0.17, y, u * D);
            else b.box('solid', col, 0.1, sh, sw, -hw - 0.17, y, u * D);
        }

        // snow bank under the foundation (only shows on slopes)
        const porchDepth = o.porch === 'terrace' ? 4.6 : (o.porch === 'porch' ? 2.6 : 1.2);
        b.skirt('solid', P.snowMid, 0, porchDepth / 2, hw + 0.25, hd + 0.25 + porchDepth / 2, -0.25, 7, 6);

        // --- Timber walls with log grooves and crossed beam ends ---
        b.box('solid', P.timber, W, o.wallH, D, 0, S + o.wallH / 2, 0);
        const logH = 0.46;
        let level = 0;
        for (let y = S + logH; y < H - 0.1; y += logH, level++) {
            b.box('solid', P.timberDark, W + 0.04, 0.07, D + 0.04, 0, y, 0);
        }
        level = 0;
        for (let y = S + logH / 2; y < H; y += logH, level++) {
            for (const sx of [-1, 1]) {
                for (const sz of [-1, 1]) {
                    if (level % 2 === 0) {
                        b.box('solid', P.timberEnd, 0.62, logH * 0.82, 0.36, sx * (hw + 0.06), y, sz * (hd - 0.1));
                    } else {
                        b.box('solid', P.timberEnd, 0.36, logH * 0.82, 0.62, sx * (hw - 0.1), y, sz * (hd + 0.06));
                    }
                }
            }
        }

        // --- Gable / attic prism ---
        const gable = new THREE.Shape();
        gable.moveTo(-hw, 0);
        gable.lineTo(hw, 0);
        gable.lineTo(0, PH);
        gable.closePath();
        const gableGeo = new THREE.ExtrudeGeometry(gable, { depth: D, bevelEnabled: false });
        b.add('solid', gableGeo, P.timberLight, 0, H, -hd);
        // vertical board battens on the front gable
        if (!o.noFront) {
            for (let x = -hw + 0.5; x < hw - 0.3; x += 0.5) {
                const top = PH * (1 - Math.abs(x) / hw) - 0.1;
                if (top < 0.3) continue;
                b.box('solid', P.timberDark, 0.06, top, 0.05, x, H + top / 2, hd + 0.02);
            }
        }
        if (!o.noBack) {
            for (let x = -hw + 0.5; x < hw - 0.3; x += 0.5) {
                const top = PH * (1 - Math.abs(x) / hw) - 0.1;
                if (top < 0.3) continue;
                b.box('solid', P.timberDark, 0.06, top, 0.05, x, H + top / 2, -hd - 0.02);
            }
        }
        // floor beam band between floors
        b.box('solid', P.timberDark, W + 0.12, 0.22, D + 0.12, 0, H + 0.02, 0);

        // --- Roof ---
        const a = Math.atan2(PH, hw);
        const ca = Math.cos(a), sa = Math.sin(a);
        const slopeLen = Math.hypot(hw, PH);
        const L = slopeLen + o.eave;
        const t = 0.32;
        const Dz = D + o.gableOver * 2;
        const ts = 0.42;
        const coverLen = L * o.snowCover;
        for (const s of [-1, 1]) {
            const dx = s * ca, dy = -sa;      // down-slope direction
            const nx = s * sa, ny = ca;       // outward normal
            const off = 0.14;                 // run past the ridge a little
            const cx = dx * (L / 2 - off) + nx * (t / 2);
            const cy = ridgeY + dy * (L / 2 - off) + ny * (t / 2);
            b.box('solid', o.roof, L, t, Dz, cx, cy, 0, 0, 0, -s * a);
            // fascia boards on the gable rakes
            for (const z of [-Dz / 2, Dz / 2]) {
                b.box('solid', o.roofDark, L, t + 0.14, 0.12, cx - nx * 0.06, cy - ny * 0.06, z, 0, 0, -s * a);
            }
            // eave board
            const ex = dx * (L - off) + nx * (t / 2);
            const ey = ridgeY + dy * (L - off) + ny * (t / 2);
            b.box('solid', o.roofDark, 0.14, t + 0.12, Dz + 0.1, ex, ey - 0.03, 0, 0, 0, -s * a);
            // rafter tails under the overhang
            for (let z = -Dz / 2 + 0.45; z <= Dz / 2 - 0.4; z += 0.9) {
                const d0 = slopeLen - 0.1, d1 = L - off - 0.1;
                const dm = (d0 + d1) / 2;
                b.box('solid', P.timberDark, d1 - d0, 0.2, 0.16,
                    dx * dm - nx * 0.1, ridgeY + dy * dm - ny * 0.1, z, 0, 0, -s * a);
            }
            // snow blanket
            const sLen = coverLen - off;
            const sx = dx * (sLen / 2 - off) + nx * (t + ts / 2 - 0.03);
            const sy = ridgeY + dy * (sLen / 2 - off) + ny * (t + ts / 2 - 0.03);
            b.box('solid', P.snow, sLen, ts, Dz + 0.16, sx, sy, 0, 0, 0, -s * a);
            // rounded snow lip
            const lx = dx * (coverLen - off * 2) + nx * (t + ts / 2 - 0.03);
            const ly = ridgeY + dy * (coverLen - off * 2) + ny * (t + ts / 2 - 0.03);
            b.cyl('solid', P.snowMid, ts / 2 + 0.03, ts / 2 + 0.03, Dz + 0.16, 7, lx, ly, 0, Math.PI / 2, 0, 0);
            // fairy lights along the front rake and the eave (warm glass, bloom at night)
            if (o.stringLights) {
                const zf = Dz / 2 - 0.08;
                let k = 0;
                for (let d = 0.35; d < L - off - 0.15; d += 0.42, k++) {
                    const droop = (k % 2) * 0.07 + 0.12;
                    b.add('glass', new THREE.OctahedronGeometry(0.075, 0), 0,
                        dx * d - nx * droop, ridgeY + dy * d - ny * droop, zf);
                }
                k = 0;
                for (let z = -Dz / 2 + 0.3; z <= Dz / 2 - 0.25; z += 0.45, k++) {
                    b.add('glass', new THREE.OctahedronGeometry(0.07, 0), 0,
                        ex - nx * 0.05, ey - t / 2 - 0.1 - (k % 2) * 0.06, z);
                }
            }
            // icicles hanging from the eave
            for (let z = -Dz / 2 + 0.25; z <= Dz / 2 - 0.2; z += 0.3) {
                if (r() < 0.35) continue;
                const len = 0.2 + r() * r() * 0.85;
                const rad = 0.05 + r() * 0.05;
                b.cone('solid', P.ice, rad, len, 4, ex + s * 0.02, ey - t / 2 - len / 2 - 0.02, z + (r() - 0.5) * 0.1, Math.PI, 0, 0);
            }
        }
        // ridge snow cap
        b.box('solid', P.snow, 0.62, 0.62, Dz + 0.18, 0, ridgeY + (t + ts) / ca - 0.38, 0, 0, 0, Math.PI / 4);
        b.cyl('solid', P.snow, 0.33, 0.33, Dz + 0.2, 7, 0, ridgeY + (t + ts) / ca - 0.2, 0, Math.PI / 2, 0, 0);

        // --- Chimneys ---
        const chimneys = [o.chimney, o.chimney2].filter(Boolean);
        for (const c of chimneys) {
            const s = Math.sign(c.x) || 1;
            const surf = ridgeY - Math.abs(c.x) * Math.tan(a) + t + ts; // roof+snow surface at x
            const top = Math.max(surf + 1.0, ridgeY + 0.7);
            const bottom = H - 0.5;
            const h = top - bottom;
            b.box('solid', P.stone, 0.95, h, 0.95, c.x, bottom + h / 2, c.z);
            // stone courses
            for (let y = bottom + 0.4; y < top - 0.2; y += 0.38) {
                b.box('solid', P.stoneDark, 0.99, 0.05, 0.99, c.x, y, c.z);
            }
            b.box('solid', P.stoneDark, 1.18, 0.16, 1.18, c.x, top + 0.04, c.z);
            b.box('solid', P.snow, 1.14, 0.14, 1.14, c.x, top + 0.18, c.z);
            b.cyl('solid', P.stoneDark, 0.17, 0.2, 0.42, 6, c.x, top + 0.38, c.z);
            // snow pile on the uphill side of the chimney
            b.ico('solid', P.snow, 0.5, 0, c.x - s * 0.55, surf - 0.05, c.z, 0.9, 0.6, 1.0);
            A.smoke.push(new THREE.Vector3(c.x, top + 0.62, c.z).applyMatrix4(b.top));
        }

        // --- Windows ---
        const winY = S + o.wallH * 0.52;
        const groundH = o.bigGround ? 1.7 : 1.25;
        const groundW = o.bigGround ? 1.5 : 1.05;
        if (!o.noFront) {
            (o.frontWindows || []).forEach(x => this.buildWindow(b, A, x, o.bigGround ? 1.8 : winY, o.bigGround ? hd + 0.16 : hd, 0, groundW, groundH, !o.bigGround));
            (o.upperWindows || []).forEach(x => this.buildWindow(b, A, x, S + o.wallH * 0.5, hd, 0, 1.0, 1.25, true));
        }
        if (!o.noBack) {
            (o.backWindows || []).forEach(x => this.buildWindow(b, A, x, winY, -hd, Math.PI, 1.0, 1.2, true));
        }
        if (o.sideWindows > 0) {
            const n = o.sideWindows;
            for (let i = 0; i < n; i++) {
                const z = -hd + (D * (i + 1)) / (n + 1);
                this.buildWindow(b, A, z, winY, hw, Math.PI / 2, 1.0, 1.2, true, true);
                this.buildWindow(b, A, -z, winY, hw, -Math.PI / 2, 1.0, 1.2, true, true);
            }
        }

        // --- Door + lantern ---
        if (o.door && !o.noFront) {
            const dx = o.door.x;
            const dh = o.bigGround ? 1.95 : 2.05;
            const dw = o.bigGround ? 1.6 : 1.1;
            const baseY = o.bigGround ? 0.72 : S;
            const hd = o.bigGround ? D / 2 + 0.16 : D / 2;
            b.box('solid', P.timberDark, dw + 0.32, dh + 0.18, 0.1, dx, baseY + (dh + 0.18) / 2, hd + 0.03);
            b.box('solid', P.roofRedDark, dw, dh, 0.12, dx, baseY + dh / 2, hd + 0.06);
            // door planks
            for (let k = -1; k <= 1; k++) b.box('solid', P.timberDark, 0.04, dh - 0.1, 0.03, dx + k * dw * 0.3, baseY + dh / 2, hd + 0.13);
            b.box('glass', 0, dw * 0.45, 0.42, 0.04, dx, baseY + dh * 0.74, hd + 0.13);
            b.sphere('solid', P.liftSteel, 0.05, 5, 4, dx + dw * 0.35, baseY + dh * 0.48, hd + 0.16);
            // small canopy over the door (only when no balcony above)
            if (!o.balcony) {
                b.box('solid', o.roof, dw + 0.8, 0.12, 0.8, dx, baseY + dh + 0.45, hd + 0.4, 0.35, 0, 0);
                b.box('solid', P.snow, dw + 0.7, 0.12, 0.65, dx, baseY + dh + 0.55, hd + 0.38, 0.35, 0, 0);
            }
            // wall lantern
            const lx = dx + (o.door.lamp ?? 1) * (dw / 2 + 0.45), ly = baseY + dh * 0.8, lz = hd + 0.28;
            b.box('solid', P.coal, 0.06, 0.06, 0.28, lx, ly + 0.2, hd + 0.14);
            b.cone('solid', P.coal, 0.2, 0.16, 4, lx, ly + 0.27, lz, 0, Math.PI / 4, 0);
            b.box('glass', 0, 0.2, 0.26, 0.2, lx, ly + 0.04, lz);
            b.box('solid', P.coal, 0.24, 0.05, 0.24, lx, ly - 0.12, lz);
            A.halos.push(b.point(lx, ly + 0.04, lz + 0.05));
            A.pools.push(Object.assign(b.point(dx, (o.porch === 'stoop' ? S : (o.porch === 'terrace' ? 0.74 : S + 0.02)) + 0.02, hd + 1.1), { r: o.bigGround ? 3.2 : 2.2 }));
        }

        // --- Balcony on the front gable ---
        if (o.balcony && !o.noFront) {
            const bw = W * 0.74, bd = 1.35, by = H + 0.06;
            b.box('solid', P.timberDark, bw, 0.18, bd, 0, by, hd + bd / 2);
            b.box('solid', P.snowMid, bw - 0.1, 0.06, bd - 0.25, 0, by + 0.12, hd + bd / 2 - 0.05);
            // brackets
            for (const x of [-bw / 2 + 0.3, 0, bw / 2 - 0.3]) {
                b.beam('solid', P.timberDark, x, by - 1.2, hd + 0.02, x, by - 0.08, hd + bd - 0.15, 0.16);
            }
            // railing with carved balusters
            const ry = by + 0.1;
            b.box('solid', P.timberDark, bw, 0.12, 0.12, 0, ry + 0.95, hd + bd - 0.06);
            b.box('solid', P.timberDark, bw, 0.1, 0.1, 0, ry + 0.12, hd + bd - 0.06);
            b.box('solid', P.snow, bw + 0.06, 0.12, 0.2, 0, ry + 1.06, hd + bd - 0.06);
            for (let x = -bw / 2 + 0.12; x <= bw / 2 - 0.1; x += 0.24) {
                b.box('solid', (Math.round((x + bw) / 0.24) % 2) ? P.timberLight : P.timberEnd, 0.15, 0.82, 0.05, x, ry + 0.54, hd + bd - 0.06);
            }
            for (const sx of [-1, 1]) {
                b.box('solid', P.timberDark, 0.12, 0.12, bd, sx * (bw / 2 - 0.06), ry + 0.95, hd + bd / 2);
                for (let z = hd + 0.15; z < hd + bd - 0.1; z += 0.24) {
                    b.box('solid', P.timberLight, 0.05, 0.82, 0.15, sx * (bw / 2 - 0.06), ry + 0.54, z);
                }
            }
            // gable windows / balcony doors
            const gw = Math.min(1.0, W * 0.12);
            this.buildWindow(b, A, -W * 0.16, H + 1.0, hd, 0, gw, 1.35, true);
            this.buildWindow(b, A, W * 0.16, H + 1.0, hd, 0, gw, 1.35, true);
        }
        if (o.gableWindow && !o.noFront && PH > 2.6) {
            const gy = H + PH * (o.balcony ? 0.66 : 0.45);
            this.buildWindow(b, A, 0, gy, hd, 0, 0.62, 0.62, false);
        }
        if (o.gableWindow && !o.noBack && PH > 2.6) {
            this.buildWindow(b, A, 0, H + PH * 0.4, -hd, Math.PI, 0.62, 0.62, false);
        }

        // --- Porch / terrace / stoop ---
        if (!o.noFront) {
            if (o.porch === 'porch') {
                const pw = W * 0.74, pd = 1.6;
                b.box('solid', P.timberDark, pw, 0.22, pd, 0, S - 0.08, hd + pd / 2);
                b.box('solid', P.stone, pw, S + 1, pd - 0.1, 0, (S - 1) / 2 - 0.2, hd + pd / 2);
                // posts up to the balcony
                for (const sx of [-1, 1]) {
                    b.box('solid', P.timberDark, 0.24, H - S, 0.24, sx * (pw / 2 - 0.2), S + (H - S) / 2, hd + 1.2);
                }
                // stone steps
                b.box('solid', P.stoneLight, 1.8, S * 0.66 + 1, 0.45, 0, S * 0.33 - 0.5, hd + pd + 0.22);
                b.box('solid', P.stoneLight, 1.8, S * 0.33 + 1, 0.45, 0, S * 0.165 - 0.5, hd + pd + 0.66);
                b.box('solid', P.snowMid, 1.6, 0.05, 0.4, 0, S * 0.66 + 0.02, hd + pd + 0.22);
            } else if (o.porch === 'terrace') {
                const pw = W + 1.2, pd = 4.2, ty = 0.7;
                b.box('solid', P.timberDark, pw, 0.24, pd, 0, ty - 0.1, hd + pd / 2);
                b.box('solid', P.stone, pw, ty + 1, pd - 0.1, 0, (ty - 1) / 2 - 0.25, hd + pd / 2);
                // deck boards
                for (let x = -pw / 2 + 0.3; x < pw / 2; x += 0.6) {
                    b.box('solid', P.timber, 0.05, 0.02, pd - 0.1, x, ty + 0.03, hd + pd / 2);
                }
                // railing with a gap for the stairs
                for (const sx of [-1, 1]) {
                    const segW = pw / 2 - 1.2;
                    const cx = sx * (1.2 + segW / 2);
                    b.box('solid', P.timberDark, segW, 0.12, 0.12, cx, ty + 1.0, hd + pd - 0.06);
                    b.box('solid', P.snow, segW + 0.04, 0.1, 0.18, cx, ty + 1.1, hd + pd - 0.06);
                    for (let x = 1.25; x < pw / 2; x += 0.5) {
                        b.box('solid', P.timberLight, 0.1, 0.95, 0.08, sx * x, ty + 0.5, hd + pd - 0.06);
                    }
                    b.box('solid', P.timberDark, 0.12, 0.12, pd, sx * (pw / 2 - 0.06), ty + 1.0, hd + pd / 2);
                    for (let z = hd + 0.3; z < hd + pd; z += 0.5) {
                        b.box('solid', P.timberLight, 0.08, 0.95, 0.1, sx * (pw / 2 - 0.06), ty + 0.5, z);
                    }
                }
                // stairs down the front
                const steps = 2;
                for (let i = 0; i < steps; i++) {
                    const h = ty * (1 - (i + 1) / (steps + 1));
                    b.box('solid', P.stoneLight, 2.2, h + 1, 0.42, 0, h / 2 - 0.5, hd + pd + 0.21 + i * 0.42);
                }
            } else if (o.porch === 'stoop') {
                b.box('solid', P.stoneLight, 1.8, S + 1, 1.1, o.door ? o.door.x : 0, (S - 1) / 2 - 0.02, hd + 0.55);
                b.box('solid', P.snowMid, 1.6, 0.05, 0.6, o.door ? o.door.x : 0, S + 0.01, hd + 0.75);
            }
        }

        // --- Snow drifts banked against the walls ---
        const drifts = 4 + Math.floor(W / 3);
        for (let i = 0; i < drifts; i++) {
            const side = i % 3;
            const u = (r() - 0.5) * 0.9;
            const sc = 0.6 + r() * 0.7;
            if (side === 0) b.ico('solid', P.snowMid, 1, 0, u * W, 0.05, -hd - 0.35, sc * 1.4, sc * 0.55, sc * 0.8);
            else if (side === 1) b.ico('solid', P.snowMid, 1, 0, hw + 0.35, 0.05, u * D, sc * 0.8, sc * 0.55, sc * 1.4);
            else b.ico('solid', P.snowMid, 1, 0, -hw - 0.35, 0.05, u * D, sc * 0.8, sc * 0.55, sc * 1.4);
        }
    }

    /**
     * Window centered at (u along wall, y) on a wall at distance `dist` from center,
     * rotated by yaw (0 = front +Z wall, PI = back, PI/2 = +X side, -PI/2 = -X side).
     */
    buildWindow(b, A, u, y, dist, yaw, w, h, shutters = true, sideWall = false) {
        // Frame with local +Z pointing out of the wall.
        const sx = Math.sin(yaw), cz = Math.cos(yaw);
        const px = sideWall ? Math.sign(sx) * dist : u * cz;
        const pz = sideWall ? u : dist * Math.sign(cz || 1);
        b.push(px, y, pz, yaw);
        b.box('glass', 0, w, h, 0.08, 0, 0, 0.02);
        const f = 0.11;
        b.box('solid', P.timberDark, w + f * 2, f, 0.16, 0, h / 2 + f / 2, 0.06);
        b.box('solid', P.timberDark, w + f * 2, f, 0.16, 0, -h / 2 - f / 2, 0.06);
        b.box('solid', P.timberDark, f, h, 0.16, -w / 2 - f / 2, 0, 0.06);
        b.box('solid', P.timberDark, f, h, 0.16, w / 2 + f / 2, 0, 0.06);
        // mullions
        b.box('solid', P.white, 0.06, h, 0.05, 0, 0, 0.09);
        b.box('solid', P.white, w, 0.06, 0.05, 0, h * 0.12, 0.09);
        // sill with snow
        b.box('solid', P.timberDark, w + 0.4, 0.1, 0.3, 0, -h / 2 - f - 0.04, 0.15);
        b.box('solid', P.snow, w + 0.3, 0.1, 0.26, 0, -h / 2 - f + 0.05, 0.16);
        // lintel snow
        b.box('solid', P.snowMid, w + 0.2, 0.07, 0.14, 0, h / 2 + f + 0.03, 0.12);
        if (shutters) {
            for (const s of [-1, 1]) {
                b.box('solid', P.roofRed, w * 0.48, h + 0.06, 0.06, s * (w / 2 + f + w * 0.24 + 0.03), 0, 0.05);
                b.box('solid', P.roofRedDark, w * 0.48, 0.06, 0.07, s * (w / 2 + f + w * 0.24 + 0.03), h * 0.25, 0.07);
                b.box('solid', P.roofRedDark, w * 0.48, 0.06, 0.07, s * (w / 2 + f + w * 0.24 + 0.03), -h * 0.25, 0.07);
            }
        }
        A.halos.push(b.point(0, 0, 0.35));
        b.pop();
    }

    buildTable(b, x, y, z, i) {
        b.push(x, y, z, i * 0.4);
        b.cyl('solid', P.timber, 0.75, 0.75, 0.08, 8, 0, 0.78, 0);
        b.cyl('solid', P.timberDark, 0.06, 0.08, 0.76, 5, 0, 0.38, 0);
        b.box('solid', P.timber, 1.4, 0.06, 0.32, 0, 0.45, 0.85);
        b.box('solid', P.timber, 1.4, 0.06, 0.32, 0, 0.45, -0.85);
        // umbrella
        b.cyl('solid', P.white, 0.03, 0.03, 2.0, 4, 0, 1.6, 0);
        b.cone('solid', i % 2 ? P.roofRed : P.white, 1.25, 0.5, 8, 0, 2.55, 0);
        b.cone('solid', P.snow, 1.0, 0.32, 8, 0, 2.72, 0);
        b.pop();
    }

    /* --------------------------------------------------------------------- */
    /* Chimney smoke                                                          */
    /* --------------------------------------------------------------------- */

    createSmokeGeometry(origins) {
        const per = 14;
        const n = origins.length * per;
        const pos = new Float32Array(n * 3);
        const seed = new Float32Array(n);
        let k = 0;
        origins.forEach((o, oi) => {
            for (let i = 0; i < per; i++, k++) {
                pos[k * 3] = o.x; pos[k * 3 + 1] = o.y; pos[k * 3 + 2] = o.z;
                seed[k] = i / per + oi * 0.37;
            }
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 10, 0), 20);
        return g;
    }

    createSmokeMaterial() {
        return new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.merge([
                THREE.UniformsLib.fog,
                {
                    uTime: { value: 0 },
                    uScale: { value: 800 },
                    uNight: { value: 0 },
                    uDayColor: { value: new THREE.Color(0xEDE6DE) },
                    uNightColor: { value: new THREE.Color(0x5A6684) },
                },
            ]),
            vertexShader: /* glsl */`
                uniform float uTime;
                uniform float uScale;
                attribute float aSeed;
                varying float vAlpha;
                #include <fog_pars_vertex>
                void main() {
                    float life = 7.0;
                    float age = fract(uTime / life + aSeed);
                    vec4 base = modelMatrix * vec4(position, 1.0);
                    float h = fract(aSeed * 17.31);
                    vec3 wind = vec3(0.9, 0.0, 0.4);
                    vec3 offs = vec3(0.0, age * 8.0, 0.0) + wind * age * age * 5.0;
                    offs.x += sin(uTime * 0.6 + h * 30.0) * 0.5 * age;
                    offs.z += cos(uTime * 0.5 + h * 21.0) * 0.5 * age;
                    vec4 mvPosition = viewMatrix * (base + vec4(offs, 0.0));
                    gl_Position = projectionMatrix * mvPosition;
                    float size = mix(0.6, 3.6, sqrt(age)) * (0.8 + 0.4 * h);
                    gl_PointSize = size * uScale / max(0.5, -mvPosition.z);
                    vAlpha = smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.45, 1.0, age));
                    #include <fog_vertex>
                }
            `,
            fragmentShader: /* glsl */`
                uniform vec3 uDayColor;
                uniform vec3 uNightColor;
                uniform float uNight;
                varying float vAlpha;
                #include <fog_pars_fragment>
                void main() {
                    vec2 c = gl_PointCoord - 0.5;
                    float d = length(c);
                    float a = smoothstep(0.5, 0.1, d) * vAlpha * 0.42;
                    if (a < 0.004) discard;
                    vec3 col = mix(uDayColor, uNightColor, uNight);
                    col *= 1.0 - 0.18 * smoothstep(0.0, 0.5, c.y + 0.25);
                    gl_FragColor = vec4(col, a);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                    #include <fog_fragment>
                }
            `,
            transparent: true,
            depthWrite: false,
            fog: true,
        });
    }
}
