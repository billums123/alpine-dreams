/**
 * SkiLift - chairlifts and gondolas.
 *
 * A lift is one Group positioned at the bottom station (start point). Inside:
 *   structure  - all towers + both terminals merged, vertex-colored (1 draw call, casts shadow)
 *   lamps      - tower/terminal lamp glass, warm emissive (1 draw call)
 *   cable      - one closed haul-rope loop (tube) around both bullwheels (1 draw call)
 *   carriers   - InstancedMesh chairs / gondola cabins (+ gondola glass) (1-2 draw calls)
 *   halo/pool  - night-only glow points + light pools (2 draw calls)
 * Carriers run continuously around the loop, slow down through the terminals and swing gently.
 *
 * Public API (unchanged): constructor(scene, mountain), createTower(height), createLift(start, end, isGondola),
 * update(liftGroup, delta). Additions: setNightMode(enabled, instant?).
 */

import * as THREE from 'three';
import {
    PALETTE as P, PartBuilder, rng, nightFader, hookTick,
    createSolidMaterial, createWindowMaterial, createGlowMaterials,
    createHaloPoints, createLightPools, markShared,
} from './StructureKit.js';

const CHAIR_GAUGE = 1.7;     // half distance between up and down rope (chairs)
const GONDOLA_GAUGE = 1.9;   // ... (gondolas)
const STATION_ROPE_H = 4.6;  // rope height at the terminals
const CHAIR_HANG = 3.25;     // grip -> seat bottom
const GONDOLA_HANG = 3.45;   // grip -> cabin floor

const _obj = new THREE.Object3D();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class SkiLift {
    constructor(scene, mountain) {
        this.scene = scene;
        this.mountain = mountain;

        this.solidMaterial = createSolidMaterial({ roughness: 0.62 });
        this.carrierMaterial = createSolidMaterial({ roughness: 0.55 });
        this.cableMaterial = new THREE.MeshStandardMaterial({ color: 0x2B2F36, roughness: 0.55, metalness: 0.2 });
        this.lampMaterial = createWindowMaterial({ day: 0.35, night: 3.2, color: 0xFFF1D6, emissive: P.warmLamp });
        this.gondolaGlassMaterial = createWindowMaterial({ day: 0.0, night: 1.4, color: 0x1E2C44, emissive: P.warmLamp });
        this.gondolaGlassMaterial.roughness = 0.12;
        this.gondolaGlassMaterial.metalness = 0.35;
        const glow = createGlowMaterials(P.warmLamp);
        this.haloMaterial = glow.halo;
        this.poolMaterial = glow.pool;

        // Legacy names
        this.metalMaterial = this.solidMaterial;
        this.chairMaterial = this.carrierMaterial;
        this.gondolaMaterial = this.carrierMaterial;

        this._chairGeo = null;
        this._gondolaGeo = null;
        this._gondolaGlassGeo = null;
    }

    setNightMode(enabled, instant = false) {
        nightFader.setNight(!!enabled, instant);
    }

    /* --------------------------------------------------------------------- */
    /* Towers                                                                 */
    /* --------------------------------------------------------------------- */

    /** Standalone tower (used for placement previews). Rope rides at y = height. */
    createTower(height = 10, gauge = CHAIR_GAUGE) {
        const b = new PartBuilder();
        const halos = [];
        this.buildTower(b, height, gauge, halos);
        const tower = new THREE.Group();
        tower.name = 'liftTower';
        const solid = new THREE.Mesh(b.build('solid'), this.solidMaterial);
        solid.castShadow = true;
        hookTick(solid);
        tower.add(solid);
        const lampGeo = b.build('lamp');
        if (lampGeo) tower.add(new THREE.Mesh(lampGeo, this.lampMaterial));
        tower.userData.placedObject = true;
        return tower;
    }

    /** Lattice tower in the current builder frame: local +Z along the lift line, X across. */
    buildTower(b, h, gauge, halos) {
        const r = rng(Math.floor(h * 100));
        // concrete footing
        b.box('solid', P.concrete, 1.7, 2.0, 1.7, 0, -0.6, 0);
        b.skirt('solid', P.snowMid, 0, 0, 0.95, 0.95, -0.05, 4, 2.2);
        b.box('solid', P.stoneDark, 1.2, 0.12, 1.2, 0, 0.42, 0);
        // tapered truss legs
        const topY = h - 1.05;
        const b0 = 0.62, b1 = 0.24;
        const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        legs.forEach(([sx, sz]) => b.beam('solid', P.liftSteel, sx * b0, 0.4, sz * b0, sx * b1, topY, sz * b1, 0.13));
        const segs = Math.max(3, Math.round((topY - 0.4) / 1.7));
        for (let i = 0; i <= segs; i++) {
            const y = 0.4 + ((topY - 0.4) * i) / segs;
            const k = (y - 0.4) / (topY - 0.4);
            const hw = b0 + (b1 - b0) * k;
            // horizontal ring
            b.box('solid', P.liftSteel, hw * 2, 0.07, 0.07, 0, y, hw);
            b.box('solid', P.liftSteel, hw * 2, 0.07, 0.07, 0, y, -hw);
            b.box('solid', P.liftSteel, 0.07, 0.07, hw * 2, hw, y, 0);
            b.box('solid', P.liftSteel, 0.07, 0.07, hw * 2, -hw, y, 0);
            if (i < segs) {
                const y2 = 0.4 + ((topY - 0.4) * (i + 1)) / segs;
                const k2 = (y2 - 0.4) / (topY - 0.4);
                const hw2 = b0 + (b1 - b0) * k2;
                const f = i % 2 ? 1 : -1;
                b.beam('solid', P.steelDark, -f * hw, y, hw, f * hw2, y2, hw2, 0.05);
                b.beam('solid', P.steelDark, f * hw, y, -hw, -f * hw2, y2, -hw2, 0.05);
                b.beam('solid', P.steelDark, hw, y, f * hw, hw2, y2, -f * hw2, 0.05);
                b.beam('solid', P.steelDark, -hw, y, -f * hw, -hw2, y2, f * hw2, 0.05);
            }
        }
        // maintenance ladder on the -Z face
        b.box('solid', P.steelDark, 0.04, topY - 1.0, 0.04, -0.14, (topY + 1.0) / 2 + 0.4, -b1 - 0.22);
        b.box('solid', P.steelDark, 0.04, topY - 1.0, 0.04, 0.14, (topY + 1.0) / 2 + 0.4, -b1 - 0.22);
        // head + crossarm
        b.box('solid', P.liftSteel, 0.7, 0.45, 0.7, 0, h - 0.82, 0);
        const armY = h - 0.62;
        b.box('solid', P.liftSteel, gauge * 2 + 0.9, 0.3, 0.34, 0, armY, 0);
        b.box('solid', P.jacket, 0.62, 0.32, 0.36, 0, armY, 0); // red accent band
        for (const s of [-1, 1]) {
            b.beam('solid', P.liftSteel, s * 0.25, h - 2.2, 0, s * (gauge - 0.25), armY - 0.12, 0, 0.1);
            // sheave train: rope rides on top of the wheels at y = h
            b.box('solid', P.steelDark, 0.12, 0.4, 0.12, s * gauge, armY + 0.25, 0);
            b.box('solid', P.liftSteel, 0.2, 0.18, 2.0, s * gauge, h - 0.38, 0);
            for (const z of [-0.72, -0.24, 0.24, 0.72]) {
                b.cyl('solid', P.rubber, 0.17, 0.17, 0.12, 8, s * gauge, h - 0.17, z, 0, 0, Math.PI / 2);
            }
            // rope catcher horn
            b.beam('solid', P.liftSteel, s * (gauge + 0.12), h - 0.38, 0.95, s * (gauge + 0.12), h + 0.2, 1.05, 0.05);
        }
        // lamp under the crossarm
        b.box('solid', P.steelDark, 0.4, 0.1, 0.3, 0, armY - 0.22, 0.2);
        b.box('lamp', 0, 0.32, 0.1, 0.22, 0, armY - 0.31, 0.2);
        // little warning stripe on the footing
        b.box('solid', P.jumpLip, 1.22, 0.12, 1.22, 0, 0.3 + r() * 0.01, 0);
        halos.push(b.point(0, armY - 0.45, 0.2));
    }

    /* --------------------------------------------------------------------- */
    /* Terminals                                                              */
    /* --------------------------------------------------------------------- */

    /** Terminal in the current builder frame: local +Z points toward the lift line, rope at STATION_ROPE_H. */
    buildStation(b, gauge, isBottom, isGondola, A) {
        const rh = STATION_ROPE_H;
        const R = gauge;
        // platform
        b.box('solid', P.concrete, R * 2 + 6, 0.8, 10, 0, -0.15, -0.8);
        b.skirt('solid', P.snowMid, 0, -0.8, R + 3.05, 5.05, -0.45, 8, 7);
        b.box('solid', P.snowMid, R * 2 + 6.2, 0.14, 10.2, 0, 0.27, -0.8);
        b.box('solid', P.stoneLight, R * 2 + 6.3, 0.1, 10.3, 0, 0.17, -0.8);
        // central column + bullwheel
        b.box('solid', P.liftSteel, 0.9, rh + 0.4, 0.9, 0, (rh + 0.4) / 2, 0);
        b.cyl('solid', P.steelDark, R + 0.05, R + 0.05, 0.28, 20, 0, rh + 0.05, 0);
        b.cyl('solid', P.liftSteel, R - 0.25, R - 0.25, 0.32, 20, 0, rh + 0.05, 0);
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI;
            b.box('solid', P.steelDark, (R - 0.2) * 2, 0.12, 0.16, 0, rh + 0.24, 0, 0, a, 0);
        }
        // housing above the bullwheel
        const hw = R + 0.9, hl = R * 2 + 2.2;
        const hy = rh + 1.25;
        b.box('solid', P.white, hw * 2, 1.4, hl, 0, hy, -0.2);
        b.box('solid', isGondola ? P.gondola : P.liftChair, hw * 2 + 0.04, 0.28, hl + 0.04, 0, hy - 0.45, -0.2);
        // glazed band around the housing
        b.box('solid', P.glass, hw * 2 + 0.03, 0.42, hl - 0.6, 0, hy + 0.12, -0.2);
        b.box('solid', P.glass, hw * 2 - 0.6, 0.42, hl + 0.03, 0, hy + 0.12, -0.2);
        for (let z = -hl / 2 + 0.3; z <= hl / 2 - 0.2; z += 0.75) b.box('solid', P.white, hw * 2 + 0.06, 0.44, 0.08, 0, hy + 0.12, z - 0.2);
        for (let x = -hw + 0.3; x <= hw - 0.2; x += 0.75) b.box('solid', P.white, 0.08, 0.44, hl + 0.06, x, hy + 0.12, -0.2);
        // pitched slate roof with snow
        const ra = 0.38;
        for (const s of [-1, 1]) {
            const rl = hw + 0.6;
            const cy = hy + 0.7 + Math.sin(ra) * rl / 2 - 0.05;
            b.box('solid', P.roofSlate, rl, 0.16, hl + 0.6, s * Math.cos(ra) * rl / 2, cy, -0.2, 0, 0, -s * ra);
            b.box('solid', P.snow, rl - 0.3, 0.2, hl + 0.5, s * Math.cos(ra) * (rl - 0.3) / 2, cy + 0.17 + Math.sin(ra) * 0.15, -0.2, 0, 0, -s * ra);
        }
        b.box('solid', P.snow, 0.42, 0.42, hl + 0.55, 0, hy + 0.75 + Math.sin(ra) * (hw + 0.6) - 0.05, -0.2, 0, 0, Math.PI / 4);
        // support legs for the housing (outside the rope loop)
        for (const s of [-1, 1]) {
            b.box('solid', P.liftSteel, 0.3, rh + 0.6, 0.3, s * (R + 1.1), (rh + 0.6) / 2, -R - 0.6);
        }
        // terminal lamps on the housing front (+Z)
        for (const s of [-1, 1]) {
            b.box('lamp', 0, 0.3, 0.16, 0.12, s * (hw - 0.4), hy - 0.6, -0.2 + hl / 2 + 0.06);
            A.halos.push(b.point(s * (hw - 0.4), hy - 0.62, -0.2 + hl / 2 + 0.3));
        }

        // operator hut beside the rope (on +X side for bottom, -X for top)
        const hx = (isBottom ? 1 : -1) * (R + 3.2);
        b.push(hx, 0.27, -1.2);
        b.box('solid', P.timber, 2.4, 2.5, 2.4, 0, 1.25, 0);
        for (let y = 0.45; y < 2.5; y += 0.42) b.box('solid', P.timberDark, 2.44, 0.05, 2.44, 0, y, 0);
        b.box('glass', 0, 1.6, 0.8, 0.06, 0, 1.55, 1.22);
        b.box('glass', 0, 0.06, 0.8, 1.4, -Math.sign(hx) * 1.22, 1.55, 0);
        b.box('solid', P.timberDark, 1.8, 0.1, 0.25, 0, 1.1, 1.3);
        for (const s of [-1, 1]) {
            b.box('solid', P.roofSlate, 1.75, 0.14, 3.2, s * 0.8, 2.85, 0, 0, 0, -s * 0.5);
            b.box('solid', P.snow, 1.6, 0.16, 3.0, s * 0.78, 2.98, 0, 0, 0, -s * 0.5);
        }
        b.box('solid', P.snow, 0.3, 0.3, 3.1, 0, 3.32, 0, 0, 0, Math.PI / 4);
        A.halos.push(b.point(0, 1.55, 1.6));
        b.pop();

        if (isBottom) {
            // loading carpet + maze fences on the uphill-rope side
            const sx = -R; // up rope rides on local -X at the bottom terminal
            b.box('solid', P.rubber, 2.0, 0.08, 3.2, sx, 0.4, 2.4);
            b.box('solid', P.jumpLip, 2.05, 0.09, 0.12, sx, 0.41, 0.85);
            for (const s of [-1, 1]) {
                const fx = sx + s * 1.5;
                for (let z = 1.2; z <= 6.5; z += 1.3) b.box('solid', P.timberDark, 0.08, 0.9, 0.08, fx, 0.72, z);
                b.box('solid', P.flagBlue, 0.04, 0.12, 5.3, fx, 1.05, 3.85);
                b.box('solid', P.flagBlue, 0.04, 0.12, 5.3, fx, 0.6, 3.85);
            }
            // trail map sign
            b.push((R + 3.6) * -1 - 0.4, 0.27, 2.6, 0.35);
            b.box('solid', P.timberDark, 0.14, 2.6, 0.14, -1.1, 1.3, 0);
            b.box('solid', P.timberDark, 0.14, 2.6, 0.14, 1.1, 1.3, 0);
            b.box('solid', P.timberDark, 2.6, 1.5, 0.12, 0, 1.9, 0);
            b.box('solid', 0xEEE8DA, 2.35, 1.25, 0.04, 0, 1.9, 0.08);
            // stylized peaks + runs
            b.add('solid', new THREE.ConeGeometry(0.75, 0.9, 3), 0xB9C7DA, -0.35, 2.0, 0.11, 0, 0, 0, 1, 1, 0.05);
            b.add('solid', new THREE.ConeGeometry(0.6, 0.75, 3), 0xCAD6E6, 0.5, 1.95, 0.11, 0, 0, 0, 1, 1, 0.05);
            b.box('solid', 0x3C9A5F, 0.05, 0.85, 0.03, -0.7, 1.85, 0.13, 0, 0, 0.5);
            b.box('solid', P.flagBlue, 0.05, 0.9, 0.03, -0.15, 1.8, 0.13, 0, 0, -0.3);
            b.box('solid', P.flagRed, 0.05, 0.8, 0.03, 0.45, 1.8, 0.13, 0, 0, 0.35);
            b.box('solid', P.coal, 0.05, 0.6, 0.03, 0.85, 1.75, 0.13, 0, 0, -0.2);
            b.box('solid', P.roofRed, 2.7, 0.18, 0.3, 0, 2.72, 0.02);
            b.box('solid', P.snow, 2.6, 0.12, 0.3, 0, 2.86, 0.02);
            b.pop();
        } else {
            // unload ramp on the arriving (up) side
            const sx = R;
            const ramp = new THREE.Shape();
            ramp.moveTo(0, 0);
            ramp.lineTo(4, 0);
            ramp.lineTo(4, 0.05);
            ramp.quadraticCurveTo(1.5, 0.15, 0, 0.9);
            ramp.closePath();
            const g = new THREE.ExtrudeGeometry(ramp, { depth: 2.2, bevelEnabled: false, curveSegments: 6 });
            g.translate(0, 0, -1.1);
            b.add('solid', g, P.snowMid, sx, 0.27, 0.6, 0, -Math.PI / 2, 0);
        }
        A.pools.push(Object.assign(b.point(0, 0.36, 2.0), { r: 4.2 }));
        A.pools.push(Object.assign(b.point(hx, 0.36, 0.8), { r: 2.0 }));
    }

    /* --------------------------------------------------------------------- */
    /* Carriers                                                               */
    /* --------------------------------------------------------------------- */

    /** Chair geometry with the grip at the origin; travel along +Z, seat across X. */
    getChairGeometry() {
        if (this._chairGeo) return this._chairGeo;
        const b = new PartBuilder();
        const H = 2.35;
        const sw = 2.0;
        b.box('c', P.steelDark, 0.26, 0.26, 0.5, 0, -0.02, 0);
        b.box('c', P.liftSteel, 0.1, H, 0.1, 0, -H / 2 - 0.1, 0);
        b.box('c', P.liftSteel, sw, 0.08, 0.08, 0, -H - 0.1, -0.32);
        b.beam('c', P.liftSteel, 0, -H + 0.25, 0, 0, -H - 0.1, -0.32, 0.09);
        // backrest + seat (padded)
        b.box('c', P.liftChair, sw, 0.78, 0.12, 0, -H - 0.55, -0.36, -0.14, 0, 0);
        b.box('c', P.liftChairLight, sw - 0.1, 0.62, 0.05, 0, -H - 0.55, -0.28, -0.14, 0, 0);
        b.box('c', P.liftChair, sw, 0.16, 0.68, 0, -H - 0.98, -0.04);
        b.box('c', P.liftChairLight, sw - 0.1, 0.05, 0.6, 0, -H - 0.89, -0.02);
        // seat dividers (quad)
        for (const x of [-0.5, 0, 0.5]) b.box('c', P.liftChair, 0.04, 0.06, 0.6, x, -H - 0.86, -0.02);
        // armrests / side frames
        for (const s of [-1, 1]) {
            b.box('c', P.liftSteel, 0.07, 0.07, 0.75, s * (sw / 2), -H - 0.62, 0.0);
            b.box('c', P.liftSteel, 0.07, 0.42, 0.07, s * (sw / 2), -H - 0.8, 0.32);
            // safety bar arms
            b.beam('c', P.steelDark, s * (sw / 2 - 0.04), -H - 0.1, -0.32, s * (sw / 2 - 0.04), -H - 0.32, 0.55, 0.05);
            // footrest struts
            b.beam('c', P.steelDark, s * 0.75, -H - 0.32, 0.55, s * 0.75, -H - 1.42, 0.62, 0.05);
        }
        b.box('c', P.steelDark, sw - 0.08, 0.06, 0.06, 0, -H - 0.32, 0.55);
        b.box('c', P.steelDark, 1.56, 0.06, 0.26, 0, -H - 1.44, 0.64);
        this._chairGeo = b.build('c');
        markShared(this._chairGeo);
        return this._chairGeo;
    }

    /** Gondola cabin (grip at origin), travel along +Z. Returns {body, glass}. */
    getGondolaGeometry() {
        if (this._gondolaGeo) return { body: this._gondolaGeo, glass: this._gondolaGlassGeo };
        const b = new PartBuilder();
        const top = -1.0;            // cabin roof
        const ry = Math.PI / 8;
        const sx = 0.78, sz = 1.0;   // footprint scale (1.56 x 2.0)
        b.box('c', P.steelDark, 0.28, 0.26, 0.5, 0, -0.02, 0);
        b.box('c', P.liftSteel, 0.12, 0.55, 0.12, 0, -0.35, 0);
        b.box('c', P.liftSteel, 0.12, 0.12, 1.3, 0, -0.62, 0);
        b.beam('c', P.liftSteel, 0, -0.62, 0.62, 0, top + 0.05, 0.4, 0.09);
        b.beam('c', P.liftSteel, 0, -0.62, -0.62, 0, top + 0.05, -0.4, 0.09);
        // roof cap
        b.cyl('c', P.white, 0.55, 0.85, 0.22, 8, 0, top - 0.11, 0, 0, ry, 0, sx, 1, sz);
        b.cyl('c', P.gondola, 0.98, 0.98, 0.32, 8, 0, top - 0.38, 0, 0, ry, 0, sx, 1, sz);
        // glass band
        const gTop = top - 0.54, gBot = top - 1.42;
        b.cyl('g', 0, 0.97, 0.97, gTop - gBot, 8, 0, (gTop + gBot) / 2, 0, 0, ry, 0, sx, 1, sz);
        // mullions at the corners
        for (let i = 0; i < 8; i++) {
            const a = ry + (i / 8) * Math.PI * 2 + Math.PI / 8;
            const x = Math.sin(a) * 0.99 * sx, z = Math.cos(a) * 0.99 * sz;
            b.box('c', P.gondola, 0.1, gTop - gBot, 0.1, x, (gTop + gBot) / 2, z, 0, a, 0);
        }
        // lower body
        b.cyl('c', P.white, 1.0, 1.0, 0.14, 8, 0, gBot - 0.07, 0, 0, ry, 0, sx, 1, sz);
        b.cyl('c', P.gondola, 1.0, 1.0, 0.62, 8, 0, gBot - 0.45, 0, 0, ry, 0, sx, 1, sz);
        b.cyl('c', P.gondolaDark, 1.0, 0.82, 0.24, 8, 0, gBot - 0.88, 0, 0, ry, 0, sx, 1, sz);
        // door seam + number plate
        b.box('c', P.gondolaDark, 0.04, 0.9, 0.04, 0.0, gBot - 0.45, 1.0 * sz);
        b.box('c', P.white, 0.36, 0.2, 0.04, 0.0, top - 0.38, 0.99 * sz);
        // ski racks on the outside
        for (const s of [-1, 1]) {
            b.box('c', P.steelDark, 0.06, 0.06, 1.2, s * 0.83, gBot - 0.25, 0);
            b.box('c', P.flagBlue, 0.05, 1.3, 0.08, s * 0.86, gBot - 0.15, -0.25, 0, 0, s * 0.05);
            b.box('c', P.jumpLip, 0.05, 1.3, 0.08, s * 0.86, gBot - 0.15, 0.0, 0, 0, s * 0.05);
        }
        this._gondolaGeo = b.build('c');
        this._gondolaGlassGeo = b.build('g');
        markShared(this._gondolaGeo, this._gondolaGlassGeo);
        return { body: this._gondolaGeo, glass: this._gondolaGlassGeo };
    }

    // Legacy single-carrier builders (kept for compatibility; not used by createLift).
    createChair() {
        const m = new THREE.Mesh(this.getChairGeometry(), this.carrierMaterial);
        m.name = 'liftChair';
        m.castShadow = true;
        return m;
    }

    createGondolaCabin() {
        const g = this.getGondolaGeometry();
        const grp = new THREE.Group();
        grp.name = 'gondolaCabin';
        const body = new THREE.Mesh(g.body, this.carrierMaterial);
        body.castShadow = true;
        grp.add(body, new THREE.Mesh(g.glass, this.gondolaGlassMaterial));
        return grp;
    }

    /* --------------------------------------------------------------------- */
    /* Lift assembly                                                          */
    /* --------------------------------------------------------------------- */

    createLift(startPoint, endPoint, isGondola = false) {
        const lift = new THREE.Group();
        lift.name = isGondola ? 'gondola' : 'skiLift';
        lift.userData.placedObject = true;
        lift.userData.isGondola = isGondola;

        const origin = startPoint.clone();
        lift.position.copy(origin);

        const gauge = isGondola ? GONDOLA_GAUGE : CHAIR_GAUGE;
        const hang = isGondola ? GONDOLA_HANG : CHAIR_HANG;
        const delta = endPoint.clone().sub(startPoint);
        const hDir = new THREE.Vector3(delta.x, 0, delta.z);
        const hLen = Math.max(0.001, hDir.length());
        hDir.divideScalar(hLen);
        const perp = new THREE.Vector3(-hDir.z, 0, hDir.x);
        const yaw = Math.atan2(hDir.x, hDir.z);

        // ---- Tower layout with terrain clearance ----
        const spacing = isGondola ? 55 : 42;
        const nSpans = Math.max(1, Math.round(hLen / spacing));
        const rand = rng(Math.floor(Math.abs(startPoint.x * 13 + startPoint.z * 7 + endPoint.x * 3)) + 1);
        const nodes = [];
        for (let i = 0; i <= nSpans; i++) {
            const t = i / nSpans;
            const x = startPoint.x + delta.x * t;
            const z = startPoint.z + delta.z * t;
            const isStation = i === 0 || i === nSpans;
            const ground = i === 0 ? startPoint.y : (i === nSpans ? endPoint.y : this.mountain.getHeightAt(x, z));
            nodes.push({ x, z, ground, h: isStation ? STATION_ROPE_H : 10 + rand() * 1.5, isStation, t });
        }
        const sagOf = (span) => span * 0.022;
        const clearance = hang + 1.4;
        for (let iter = 0; iter < 6; iter++) {
            let changed = false;
            for (let i = 0; i < nSpans; i++) {
                const A = nodes[i], B = nodes[i + 1];
                const span = Math.hypot(B.x - A.x, B.z - A.z);
                const sag = sagOf(span);
                let worst = 0;
                for (let k = 1; k < 16; k++) {
                    const t = k / 16;
                    // relax near terminals (carriers are meant to come low there)
                    if ((A.isStation && t < 0.18) || (B.isStation && t > 0.82)) continue;
                    const x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t;
                    const g = this.mountain.getHeightAt(x, z);
                    const y = (A.ground + A.h) + ((B.ground + B.h) - (A.ground + A.h)) * t - sag * 4 * t * (1 - t);
                    worst = Math.max(worst, g + clearance - y);
                }
                if (worst > 0.05) {
                    const inc = worst + 0.3;
                    if (!A.isStation) A.h = Math.min(26, A.h + (B.isStation ? inc * 1.6 : inc));
                    if (!B.isStation) B.h = Math.min(26, B.h + (A.isStation ? inc * 1.6 : inc));
                    changed = true;
                }
            }
            if (!changed) break;
        }

        // ---- Build static structure ----
        const b = new PartBuilder();
        const A = { halos: [], pools: [] };
        const toLocal = (x, y, z) => new THREE.Vector3(x - origin.x, y - origin.y, z - origin.z);
        nodes.forEach((n, i) => {
            const p = toLocal(n.x, n.ground, n.z);
            if (n.isStation) {
                const bottom = i === 0;
                b.push(p.x, p.y, p.z, bottom ? yaw : yaw + Math.PI);
                this.buildStation(b, gauge, bottom, isGondola, A);
                b.pop();
            } else {
                b.push(p.x, p.y, p.z, yaw);
                this.buildTower(b, n.h, gauge, A.halos);
                b.pop();
            }
        });

        const structure = new THREE.Mesh(b.build('solid'), this.solidMaterial);
        structure.name = 'liftStructure';
        structure.castShadow = true;
        structure.receiveShadow = true;
        hookTick(structure);
        lift.add(structure);
        const lampGeo = b.build('lamp');
        const glassGeo = b.build('glass');
        if (lampGeo || glassGeo) {
            const geos = [lampGeo, glassGeo].filter(Boolean);
            const lamps = new THREE.Mesh(geos.length > 1 ? mergeTwo(geos) : geos[0], this.lampMaterial);
            lamps.name = 'liftLamps';
            lift.add(lamps);
        }
        const halo = createHaloPoints(A.halos, this.haloMaterial);
        if (halo) lift.add(halo);
        const pools = createLightPools(A.pools, this.poolMaterial);
        if (pools) lift.add(pools);

        // ---- Haul rope loop (local coords) ----
        const pts = [];
        const ropeY = (i) => nodes[i].ground + nodes[i].h - origin.y;
        const pushPt = (x, y, z) => {
            const last = pts[pts.length - 1];
            if (last && Math.abs(last.x - x) + Math.abs(last.y - y) + Math.abs(last.z - z) < 0.05) return;
            pts.push(new THREE.Vector3(x, y, z));
        };
        const side = (i, s) => ({
            x: nodes[i].x - origin.x + perp.x * gauge * s,
            z: nodes[i].z - origin.z + perp.z * gauge * s,
        });
        const run = (s, forward) => {
            const order = [];
            for (let i = 0; i < nSpans; i++) order.push(forward ? [i, i + 1] : [nSpans - i, nSpans - i - 1]);
            order.forEach(([ia, ib]) => {
                const a = side(ia, s), c = side(ib, s);
                const ya = ropeY(ia), yc = ropeY(ib);
                const span = Math.hypot(c.x - a.x, c.z - a.z);
                const sag = sagOf(span);
                const steps = Math.max(4, Math.ceil(span / 3));
                for (let k = 0; k <= steps; k++) {
                    const t = k / steps;
                    pushPt(a.x + (c.x - a.x) * t, ya + (yc - ya) * t - sag * 4 * t * (1 - t), a.z + (c.z - a.z) * t);
                }
            });
        };
        const arc = (i, dirSign, from, to) => {
            const cx = nodes[i].x - origin.x, cz = nodes[i].z - origin.z, y = ropeY(i);
            const steps = 14;
            for (let k = 0; k <= steps; k++) {
                const phi = from + ((to - from) * k) / steps;
                pushPt(
                    cx + perp.x * gauge * Math.cos(phi) + hDir.x * dirSign * gauge * Math.sin(phi),
                    y,
                    cz + perp.z * gauge * Math.cos(phi) + hDir.z * dirSign * gauge * Math.sin(phi),
                );
            }
        };
        // up side (+perp) start -> end, top bullwheel, down side (-perp) end -> start, bottom bullwheel
        run(1, true);
        arc(nSpans, 1, 0, Math.PI);
        run(-1, false);
        arc(0, -1, Math.PI, 0);
        if (pts.length > 2 && pts[0].distanceTo(pts[pts.length - 1]) < 0.05) pts.pop();

        // arc-length LUT
        const lut = buildLoopLUT(pts, 0.5);
        // speed factor: slow through the terminals
        const c0 = new THREE.Vector3(nodes[0].x - origin.x, 0, nodes[0].z - origin.z);
        const c1 = new THREE.Vector3(nodes[nSpans].x - origin.x, 0, nodes[nSpans].z - origin.z);
        lut.speed = new Float32Array(lut.count);
        for (let i = 0; i < lut.count; i++) {
            const x = lut.pos[i * 3], z = lut.pos[i * 3 + 2];
            const d = Math.min(Math.hypot(x - c0.x, z - c0.z), Math.hypot(x - c1.x, z - c1.z));
            const k = THREE.MathUtils.smoothstep(d, gauge + 2, gauge + 16);
            lut.speed[i] = 0.32 + 0.68 * k;
        }

        const curve = new LoopCurve(lut);
        const tubeSegs = Math.min(2400, Math.max(64, Math.ceil(lut.length / 1.5)));
        const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, tubeSegs, 0.055, 5, true), this.cableMaterial);
        cable.name = 'liftCable';
        lift.add(cable);

        // ---- Carriers (instanced) ----
        const carrierSpacing = isGondola ? 24 : 13;
        const count = Math.max(4, Math.floor(lut.length / carrierSpacing));
        const carriers = [];
        let bodyGeo, glassGeo2 = null;
        if (isGondola) {
            const g = this.getGondolaGeometry();
            bodyGeo = g.body;
            glassGeo2 = g.glass;
        } else {
            bodyGeo = this.getChairGeometry();
        }
        const bodyMesh = new THREE.InstancedMesh(bodyGeo, this.carrierMaterial, count);
        bodyMesh.name = isGondola ? 'gondolaCabins' : 'liftChairs';
        bodyMesh.castShadow = true;
        bodyMesh.frustumCulled = false;
        bodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        lift.add(bodyMesh);
        let glassMesh = null;
        if (glassGeo2) {
            glassMesh = new THREE.InstancedMesh(glassGeo2, this.gondolaGlassMaterial, count);
            glassMesh.name = 'gondolaGlass';
            glassMesh.frustumCulled = false;
            glassMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            lift.add(glassMesh);
        }
        for (let i = 0; i < count; i++) {
            carriers.push({ s: (i / count) * lut.length, phase: rand() * Math.PI * 2, index: i });
        }

        lift.userData.carriers = carriers;
        lift.userData.speed = isGondola ? 6.5 : 5.2;          // rope speed (units / s) on the line
        lift.userData.lut = lut;
        lift.userData.carrierMeshes = glassMesh ? [bodyMesh, glassMesh] : [bodyMesh];
        lift.userData.time = 0;
        lift.userData.towers = nodes.length - 2;
        lift.userData.start = startPoint.clone();
        lift.userData.end = endPoint.clone();

        this.update(lift, 0);
        this.scene.add(lift);
        return lift;
    }

    // Kept for compatibility (older callers). Returns world-space sag points through tower tops.
    calculateCablePointsThroughTowers(towerData, perpendicular, offset) {
        const points = [];
        for (let i = 0; i < towerData.length; i++) {
            const a = towerData[i];
            const top = new THREE.Vector3(a.pos.x + perpendicular.x * offset, a.pos.y + a.height, a.pos.z + perpendicular.z * offset);
            points.push(top);
            if (i < towerData.length - 1) {
                const n = towerData[i + 1];
                const next = new THREE.Vector3(n.pos.x + perpendicular.x * offset, n.pos.y + n.height, n.pos.z + perpendicular.z * offset);
                const d = top.distanceTo(next);
                const steps = Math.max(2, Math.floor(d / 8));
                for (let j = 1; j <= steps; j++) {
                    const t = j / (steps + 1);
                    const p = top.clone().lerp(next, t);
                    p.y -= d * 0.022 * 4 * t * (1 - t);
                    points.push(p);
                }
            }
        }
        return points;
    }

    calculateCablePoints(start, end, startHeight, endHeight, intermediateTowers) {
        const towerData = [{ pos: start.clone(), height: startHeight }];
        intermediateTowers.forEach(t => towerData.push({ pos: t.position.clone(), height: 10 }));
        towerData.push({ pos: end.clone(), height: endHeight });
        return this.calculateCablePointsThroughTowers(towerData, new THREE.Vector3(0, 0, 1), 0);
    }

    /** Animate carriers around the loop. */
    update(liftGroup, delta) {
        const ud = liftGroup && liftGroup.userData;
        if (!ud || !ud.lut || !ud.carriers) return;
        const lut = ud.lut;
        const meshes = ud.carrierMeshes;
        const dt = Math.min(delta || 0, 0.1);
        ud.time += dt;
        const time = ud.time;
        const speed = ud.speed;
        const L = lut.length;
        const step = lut.step;
        const pos = lut.pos;
        const n = lut.count;

        for (let c = 0; c < ud.carriers.length; c++) {
            const car = ud.carriers[c];
            let s = car.s;
            const fi = s / step;
            let i0 = Math.floor(fi) % n;
            if (i0 < 0) i0 += n;
            const f = lut.speed[i0];
            s += speed * f * dt;
            if (s >= L) s -= L;
            car.s = s;

            const u = s / step;
            let a = Math.floor(u);
            const t = u - a;
            a %= n;
            const bI = (a + 1) % n;
            const x = pos[a * 3] + (pos[bI * 3] - pos[a * 3]) * t;
            const y = pos[a * 3 + 1] + (pos[bI * 3 + 1] - pos[a * 3 + 1]) * t;
            const z = pos[a * 3 + 2] + (pos[bI * 3 + 2] - pos[a * 3 + 2]) * t;
            // heading from a wider window for smoothness
            const pa = (a - 2 + n) % n, pb = (a + 3) % n;
            const tx = pos[pb * 3] - pos[pa * 3];
            const tz = pos[pb * 3 + 2] - pos[pa * 3 + 2];
            const heading = Math.atan2(tx, tz);
            const sway = Math.sin(time * 1.1 + car.phase) * 0.035;
            const swing = Math.sin(time * 0.8 + car.phase * 1.7) * 0.025 * f;
            _e.set(swing, heading, sway, 'YXZ');
            _obj.position.set(x, y, z);
            _obj.quaternion.setFromEuler(_e);
            _obj.scale.set(1, 1, 1);
            _obj.updateMatrix();
            for (let m = 0; m < meshes.length; m++) meshes[m].setMatrixAt(c, _obj.matrix);
        }
        for (let m = 0; m < meshes.length; m++) meshes[m].instanceMatrix.needsUpdate = true;
    }
}

/* ------------------------------------------------------------------------- */

function mergeTwo(geos) {
    // Both come from PartBuilder (same attributes), so a manual concat is safe.
    const total = geos.reduce((n, g) => n + g.attributes.position.count, 0);
    const out = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color']) {
        const arr = new Float32Array(total * 3);
        let o = 0;
        for (const g of geos) {
            const a = g.attributes[name].array;
            arr.set(a, o);
            o += a.length;
        }
        out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
    }
    geos.forEach(g => g.dispose());
    out.computeBoundingSphere();
    return out;
}

/** Resample a closed polyline at a fixed arc-length step. */
function buildLoopLUT(points, step) {
    const n = points.length;
    const cum = new Float32Array(n + 1);
    for (let i = 0; i < n; i++) {
        cum[i + 1] = cum[i] + points[i].distanceTo(points[(i + 1) % n]);
    }
    const length = cum[n];
    const count = Math.max(8, Math.ceil(length / step));
    const realStep = length / count;
    const pos = new Float32Array(count * 3);
    let seg = 0;
    for (let k = 0; k < count; k++) {
        const d = k * realStep;
        while (seg < n - 1 && cum[seg + 1] < d) seg++;
        const a = points[seg], b = points[(seg + 1) % n];
        const segLen = cum[seg + 1] - cum[seg];
        const t = segLen > 0 ? (d - cum[seg]) / segLen : 0;
        pos[k * 3] = a.x + (b.x - a.x) * t;
        pos[k * 3 + 1] = a.y + (b.y - a.y) * t;
        pos[k * 3 + 2] = a.z + (b.z - a.z) * t;
    }
    return { pos, count, length, step: realStep };
}

class LoopCurve extends THREE.Curve {
    constructor(lut) {
        super();
        this.lut = lut;
    }
    getPoint(t, target = new THREE.Vector3()) {
        const { pos, count } = this.lut;
        const u = (((t % 1) + 1) % 1) * count;
        const a = Math.floor(u) % count;
        const b = (a + 1) % count;
        const f = u - Math.floor(u);
        return target.set(
            pos[a * 3] + (pos[b * 3] - pos[a * 3]) * f,
            pos[a * 3 + 1] + (pos[b * 3 + 1] - pos[a * 3 + 1]) * f,
            pos[a * 3 + 2] + (pos[b * 3 + 2] - pos[a * 3 + 2]) * f,
        );
    }
}
