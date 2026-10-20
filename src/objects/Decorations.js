/**
 * Decorations - resort props: slalom gates, snowmen, trees, kickers, benches, ski racks, snow piles.
 *
 * Each prop is merged into one vertex-colored faceted mesh (plus a tiny night-reflector mesh or a
 * waving banner where relevant), cached per variant, so placing dozens costs a few draw calls each.
 *
 * Public API (unchanged): createFlag(color), createSnowman(), createTree(variant), createJump(),
 * createBench(), createSkiRack(), createSnowPile(). Every returned root has userData.placedObject = true.
 * Additions: setNightMode(enabled, instant?), update(delta) (optional; waving is self-driven).
 */

import * as THREE from 'three';
import * as TreesModule from '../terrain/Trees.js';
import {
    PALETTE as P, PartBuilder, rng, nightFader, hookTick,
    createSolidMaterial, createWindowMaterial, markShared,
} from './StructureKit.js';

const FLAG_COLORS = {
    red: P.flagRed,
    blue: P.flagBlue,
    green: 0x3C9A5F,
    orange: 0xFB8C00,
    yellow: 0xF2C230,
};

const SCARF_COLORS = [P.jacket, P.flagBlue, 0x3C9A5F, 0xF2B33D];

export class Decorations {
    constructor(scene, mountain) {
        this.scene = scene;
        this.mountain = mountain;

        this.solidMaterial = createSolidMaterial({ roughness: 0.8 });
        // Reflective tips / caps that glow at night so gates and kickers read in the dark.
        this.reflectorMaterial = createWindowMaterial({ day: 0.15, night: 2.2, color: 0xF4F1EA, emissive: 0xFFB36B });

        // Legacy names
        this.woodMaterial = this.solidMaterial;
        this.snowMaterial = this.solidMaterial;
        this.foliageMaterial = this.solidMaterial;

        this.windTime = { value: 0 };
        this.templates = {};
        this._snowmanCount = 0;
    }

    setNightMode(enabled, instant = false) {
        nightFader.setNight(!!enabled, instant);
    }

    update() {
        this.windTime.value = performance.now() / 1000;
        nightFader.tick();
    }

    /* --------------------------------------------------------------------- */

    template(key, buildFn) {
        if (!this.templates[key]) {
            const b = new PartBuilder();
            buildFn(b);
            this.templates[key] = {
                solid: b.build('solid'),
                glow: b.build('glow'),
            };
            markShared(this.templates[key].solid, this.templates[key].glow);
        }
        return this.templates[key];
    }

    makeGroup(name, t, { cast = true, receive = false } = {}) {
        const group = new THREE.Group();
        group.name = name;
        const solid = new THREE.Mesh(t.solid, this.solidMaterial);
        solid.castShadow = cast;
        solid.receiveShadow = receive;
        hookTick(solid);
        group.add(solid);
        if (t.glow) group.add(new THREE.Mesh(t.glow, this.reflectorMaterial));
        group.userData.placedObject = true;
        return group;
    }

    /* --------------------------------------------------------------------- */
    /* Slalom gate                                                            */
    /* --------------------------------------------------------------------- */

    /** One shared waving material for every gate banner (colors are baked per face). */
    getBannerMaterial() {
        if (this._bannerMat) return this._bannerMat;
        const mat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.75,
            side: THREE.DoubleSide,
            flatShading: true,
        });
        const windTime = this.windTime;
        mat.onBeforeCompile = (shader) => {
            shader.uniforms.uWindTime = windTime;
            shader.vertexShader = 'uniform float uWindTime;\n' + shader.vertexShader.replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>
                float fx = clamp(position.x / 1.08 + 0.5, 0.0, 1.0);
                float fy = clamp(position.y / 0.78 + 0.5, 0.0, 1.0);
                float pin = sin(fx * 3.14159);
                float w = 0.075 * sin(uWindTime * 3.2 + fx * 5.0 + fy * 1.7)
                        + 0.035 * sin(uWindTime * 5.9 + fx * 9.0 - fy * 2.0);
                transformed.z += pin * (0.55 + 0.45 * fy) * w + pin * 0.05;`
            );
        };
        mat.customProgramCacheKey = () => 'alpine-banner';
        this._bannerMat = mat;
        return mat;
    }

    /** Banner plane with a crisp white race stripe, colored per face. */
    getBannerGeometry(hex) {
        this._bannerGeos = this._bannerGeos || {};
        if (this._bannerGeos[hex]) return this._bannerGeos[hex];
        const g = new THREE.PlaneGeometry(1.08, 0.78, 8, 5).toNonIndexed();
        g.deleteAttribute('uv');
        const pos = g.attributes.position;
        const col = new Float32Array(pos.count * 3);
        const base = new THREE.Color(hex), white = new THREE.Color(0xF6F4EF);
        for (let f = 0; f < pos.count; f += 3) {
            const cy = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
            const c = Math.abs(cy) < 0.078 ? white : base;
            for (let k = 0; k < 3; k++) {
                col[(f + k) * 3] = c.r; col[(f + k) * 3 + 1] = c.g; col[(f + k) * 3 + 2] = c.b;
            }
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        markShared(g);
        this._bannerGeos[hex] = g;
        return g;
    }

    createFlag(color = 'red') {
        const hex = FLAG_COLORS[color] || FLAG_COLORS.red;
        const t = this.template('flag-' + hex, (b) => {
            for (const s of [-1, 1]) {
                const x = s * 0.62;
                // pole: colored with white top section, sunk into a small snow mound
                b.cyl('solid', hex, 0.045, 0.05, 1.7, 6, x, 0.55, 0);
                b.cyl('solid', P.white, 0.045, 0.045, 0.45, 6, x, 1.62, 0);
                b.cyl('solid', P.coal, 0.05, 0.05, 0.06, 6, x, 1.4, 0);
                b.cyl('glow', 0, 0.06, 0.05, 0.08, 6, x, 1.88, 0);
                b.ico('solid', P.snowMid, 0.32, 0, x, -0.02, 0, 1, 0.45, 1);
            }
            // banner clips
            for (const s of [-1, 1]) {
                for (const y of [0.88, 1.6]) b.box('solid', P.coal, 0.08, 0.06, 0.08, s * 0.58, y, 0);
            }
        });
        const flag = this.makeGroup('markerFlag', t);

        const banner = new THREE.Mesh(this.getBannerGeometry(hex), this.getBannerMaterial());
        banner.position.set(0, 1.24, 0);
        banner.castShadow = true;
        banner.name = 'gateBanner';
        const windTime = this.windTime;
        banner.onBeforeRender = () => { windTime.value = performance.now() / 1000; };
        flag.add(banner);

        flag.userData.flagColor = color;
        return flag;
    }

    /* --------------------------------------------------------------------- */
    /* Snowman                                                                */
    /* --------------------------------------------------------------------- */

    createSnowman() {
        const idx = this._snowmanCount++;
        const hat = Math.random() < 0.6 ? 'beanie' : 'tophat';
        const scarfIdx = idx === 0 ? 0 : Math.floor(Math.random() * SCARF_COLORS.length);
        const scarf = SCARF_COLORS[scarfIdx];
        const t = this.template(`snowman-${hat}-${scarfIdx}`, (b) => this.buildSnowman(b, hat, scarf));
        const snowman = this.makeGroup('snowman', t);
        // a little personality: lean + look direction
        snowman.children[0].rotation.set(0, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.08);
        return snowman;
    }

    buildSnowman(b, hat, scarf) {
        const r = rng(hat === 'beanie' ? 21 : 37);
        // snow skirt
        b.ico('solid', P.snowMid, 1.0, 1, 0, 0.02, 0, 1.15, 0.22, 1.15);
        // body
        b.sphere('solid', P.snow, 0.78, 12, 9, 0, 0.62, 0, 1, 0.86, 1);
        b.sphere('solid', P.snow, 0.56, 12, 8, 0, 1.52, 0, 1, 0.9, 1);
        b.sphere('solid', P.snow, 0.41, 12, 8, 0, 2.2, 0, 1, 0.96, 1);
        // coal eyes (with a hint of brow)
        for (const s of [-1, 1]) {
            b.sphere('solid', P.coal, 0.06, 6, 5, s * 0.14, 2.3, 0.355, 1, 1.15, 0.7);
            b.box('solid', P.coal, 0.12, 0.025, 0.03, s * 0.15, 2.41, 0.355, 0, 0, s * -0.25);
        }
        // smile
        for (let i = 0; i < 5; i++) {
            const a = (i - 2) * 0.32;
            b.sphere('solid', P.coal, 0.035, 5, 4, Math.sin(a) * 0.19, 2.1 + (1 - Math.cos(a)) * 0.17, 0.37 - Math.abs(Math.sin(a)) * 0.06);
        }
        // carrot nose (slightly droopy, faceted)
        b.cone('solid', P.carrot, 0.075, 0.5, 6, 0, 2.2, 0.62, Math.PI / 2 + 0.12, 0, 0);
        for (let i = 0; i < 3; i++) b.box('solid', 0xC85F14, 0.1, 0.012, 0.012, 0, 2.21 - 0.012 * i, 0.45 + i * 0.09, 0, 0, 0);
        // buttons
        [1.32, 1.55, 1.78].forEach((y, i) => b.sphere('solid', P.coal, 0.055, 6, 5, 0, y, 0.53 - Math.abs(i - 1) * 0.03, 1, 1, 0.7));
        // stick arms with forked twigs
        for (const s of [-1, 1]) {
            const ax = s * 0.48, ay = 1.66;
            const bx = s * 1.22, by = 2.08 + (s > 0 ? 0.12 : -0.05);
            b.rod('solid', P.stick, ax, ay, 0.05, bx, by, 0.12, 0.035, 5);
            b.rod('solid', P.stick, s * 0.98, 1.98, 0.1, s * 1.2, 2.3, 0.08, 0.022, 4);
            b.rod('solid', P.stick, bx, by, 0.12, s * 1.42, by + 0.05, 0.18, 0.02, 4);
            b.rod('solid', P.stick, s * 1.05, 2.01, 0.1, s * 1.18, 1.92, 0.25, 0.018, 4);
        }
        // scarf
        b.add('solid', new THREE.TorusGeometry(0.4, 0.11, 6, 14), scarf, 0, 1.95, 0, Math.PI / 2 + 0.06, 0, 0, 1, 1, 1);
        b.add('solid', new THREE.TorusGeometry(0.4, 0.035, 4, 14), P.white, 0, 1.95, 0, Math.PI / 2 + 0.06, 0, 0, 1.03, 1.03, 1.6);
        b.box('solid', scarf, 0.2, 0.62, 0.08, 0.26, 1.62, 0.43, 0.25, 0, -0.18);
        b.box('solid', scarf, 0.2, 0.45, 0.08, 0.06, 1.68, 0.48, 0.18, 0, 0.1);
        b.box('solid', P.white, 0.21, 0.06, 0.09, 0.3, 1.48, 0.47, 0.25, 0, -0.18);
        b.box('solid', P.white, 0.21, 0.06, 0.09, 0.08, 1.52, 0.51, 0.18, 0, 0.1);
        // hat
        if (hat === 'beanie') {
            b.add('solid', new THREE.SphereGeometry(0.4, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), scarf, 0, 2.33, 0, -0.12, 0, 0, 1.04, 1.12, 1.04);
            b.cyl('solid', P.white, 0.43, 0.43, 0.16, 12, 0, 2.38, 0.01, -0.12, 0, 0);
            b.ico('solid', P.white, 0.13, 1, 0, 2.82, -0.06);
        } else {
            b.cyl('solid', P.coal, 0.46, 0.46, 0.05, 12, 0, 2.52, 0, -0.1, 0, 0.06);
            b.cyl('solid', P.coal, 0.27, 0.3, 0.52, 12, 0, 2.8, -0.02, -0.1, 0, 0.06);
            b.cyl('solid', scarf, 0.305, 0.305, 0.1, 12, 0, 2.6, -0.01, -0.1, 0, 0.06);
            b.cyl('solid', P.snow, 0.22, 0.27, 0.08, 10, 0, 3.08, -0.05, -0.1, 0, 0.06);
        }
        // a few snow clumps at the base
        for (let i = 0; i < 4; i++) {
            const a = r() * Math.PI * 2;
            b.ico('solid', P.snow, 0.16 + r() * 0.12, 0, Math.cos(a) * 0.95, 0.08, Math.sin(a) * 0.95);
        }
    }

    /* --------------------------------------------------------------------- */
    /* Tree                                                                   */
    /* --------------------------------------------------------------------- */

    createTree(variant = 'default') {
        const v = (variant === 'default' || !variant) ? 'pine' : variant;
        let tree = null;
        if (typeof TreesModule.createStandaloneTree === 'function') {
            try {
                tree = TreesModule.createStandaloneTree(v, 0.85 + Math.random() * 0.4);
            } catch (e) {
                tree = null;
            }
        }
        if (!tree) tree = this.createFallbackTree(v);
        tree.name = 'pineTree';
        tree.userData.isTree = true;
        tree.userData.placedObject = true;
        return tree;
    }

    createFallbackTree(variant = 'pine') {
        const key = 'tree-' + variant;
        const t = this.template(key, (b) => {
            const r = rng(variant === 'spruce' ? 5 : 9);
            const tall = variant === 'spruce';
            const H = tall ? 12 : 10;
            const tiers = tall ? 7 : 6;
            b.cyl('solid', P.trunk, 0.18, 0.32, 2.4, 6, 0, 1.0, 0);
            for (let i = 0; i < tiers; i++) {
                const k = i / (tiers - 1);
                const y = 1.6 + k * (H - 3.0);
                const rad = (tall ? 2.2 : 2.6) * (1 - k * 0.82) + 0.25;
                const h = (H - 1.6) / tiers * 1.9;
                const col = k < 0.35 ? P.pineDeep : (k < 0.7 ? P.pineMid : P.pineTip);
                b.add('solid', new THREE.ConeGeometry(rad, h, 8), col, (r() - 0.5) * 0.1, y + h / 2, (r() - 0.5) * 0.1, 0, r() * Math.PI, 0);
                b.add('solid', new THREE.ConeGeometry(rad * 0.72, h * 0.32, 8), P.snow, 0, y + h * 0.62, 0, 0, r() * Math.PI, 0);
            }
        });
        const tree = this.makeGroup('pineTree', t);
        const s = 0.85 + Math.random() * 0.35;
        tree.children[0].scale.setScalar(s);
        tree.children[0].rotation.y = Math.random() * Math.PI * 2;
        tree.userData.isTree = true;
        return tree;
    }

    /* --------------------------------------------------------------------- */
    /* Kicker                                                                 */
    /* --------------------------------------------------------------------- */

    /**
     * Single curved kicker. Footprint at scale 1: width 3 (X), length 4 (Z), lip height 1.5,
     * high lip toward local -Z, origin at ground center (gameplay contract).
     */
    createJump() {
        const t = this.template('jump', (b) => {
            // Profile in (u, v) where u = -z (so the lip, at u > 0, ends up toward -Z).
            const lipU = 1.45, lipV = 1.42;
            const shape = new THREE.Shape();
            shape.moveTo(-1.95, -1.6);
            shape.lineTo(-1.95, 0.0);
            const steps = 14;
            for (let i = 1; i <= steps; i++) {
                const k = i / steps;
                const u = -1.95 + k * (lipU + 1.95);
                shape.lineTo(u, lipV * Math.pow(k, 1.75));
            }
            shape.lineTo(lipU + 0.25, lipV);                 // short flat table behind the lip
            shape.quadraticCurveTo(1.95, lipV - 0.1, 1.95, 0.6); // rounded knuckle
            shape.lineTo(1.95, -1.6);
            shape.closePath();
            const geo = new THREE.ExtrudeGeometry(shape, {
                depth: 2.84, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2, curveSegments: 6,
            });
            geo.translate(0, 0, -1.42);
            b.add('solid', geo, (x, y, z, nx) => {
                const side = Math.abs(nx) > 0.6;
                if (!side && z < -1.2 && z > -1.9 && y > 1.15) return P.jumpLip; // painted lip stripe
                if (side) return 0xCCD9E8;                                       // sidewalls bluer (reads vs. terrain)
                return 0xEEF3FA;                                                 // packed, groomed snow
            }, 0, 0, 0, 0, Math.PI / 2, 0);
            // groomed corduroy lines on the in-run
            for (let i = 0; i < 6; i++) {
                const k = (i + 0.5) / 7;
                const u = -1.95 + k * (lipU + 1.95);
                const v = lipV * Math.pow(k, 1.75);
                const slope = Math.atan(1.75 * lipV * Math.pow(k, 0.75) / (lipU + 1.95));
                b.box('solid', 0xD6E2F0, 2.7, 0.03, 0.06, 0, v + 0.085, -u, -slope, 0, 0);
            }
            // side marker poles (orange / black stripes) with reflector caps
            for (const s of [-1, 1]) {
                for (const z of [-1.55, 1.7]) {
                    const x = s * 1.85;
                    const h = z < 0 ? 2.4 : 1.6;
                    const segs = z < 0 ? 6 : 4;
                    for (let i = 0; i < segs; i++) {
                        b.cyl('solid', i % 2 ? P.coal : P.jumpLip, 0.045, 0.05, h / segs, 6, x, (h / segs) * (i + 0.5) - 0.15, z);
                    }
                    b.cyl('glow', 0, 0.065, 0.055, 0.1, 6, x, h - 0.1, z);
                    b.ico('solid', P.snowMid, 0.28, 0, x, -0.02, z, 1, 0.4, 1);
                }
                // little pennant on the tall lip poles
                const pennant = new THREE.Shape();
                pennant.moveTo(0, 0);
                pennant.lineTo(0.55, -0.16);
                pennant.lineTo(0, -0.32);
                pennant.closePath();
                b.add('solid', new THREE.ShapeGeometry(pennant), P.jumpLip, s * 1.85, 2.2, -1.55, 0, s > 0 ? 0 : Math.PI, 0);
            }
        });
        const jump = this.makeGroup('snowJump', t, { cast: true, receive: true });
        jump.userData.isJump = true;
        return jump;
    }

    /* --------------------------------------------------------------------- */
    /* Small props                                                            */
    /* --------------------------------------------------------------------- */

    createBench() {
        const t = this.template('bench', (b) => {
            // cast-iron ends
            for (const s of [-1, 1]) {
                b.box('solid', P.coal, 0.08, 0.5, 0.08, s * 0.75, 0.25, 0.2);
                b.box('solid', P.coal, 0.08, 1.0, 0.08, s * 0.75, 0.5, -0.22, -0.1, 0, 0);
                b.box('solid', P.coal, 0.08, 0.06, 0.5, s * 0.75, 0.48, 0.0);
                b.box('solid', P.coal, 0.08, 0.06, 0.45, s * 0.75, 0.62, 0.02);
            }
            // seat slats
            for (let i = 0; i < 4; i++) b.box('solid', i % 2 ? P.timber : P.timberLight, 1.75, 0.07, 0.11, 0, 0.53, 0.2 - i * 0.13);
            // back slats
            for (let i = 0; i < 3; i++) b.box('solid', i % 2 ? P.timberLight : P.timber, 1.75, 0.12, 0.05, 0, 0.72 + i * 0.16, -0.25 - i * 0.016, -0.1, 0, 0);
            // snow cushion + cap on the backrest
            b.box('solid', P.snow, 1.6, 0.12, 0.42, 0, 0.62, 0.02);
            b.ico('solid', P.snow, 0.2, 0, -0.55, 0.66, 0.05, 1.2, 0.5, 1);
            b.box('solid', P.snow, 1.65, 0.08, 0.1, 0, 1.08, -0.3);
        });
        return this.makeGroup('bench', t);
    }

    createSkiRack() {
        const t = this.template('skiRack', (b) => {
            const r = rng(77);
            for (const s of [-1, 1]) {
                b.box('solid', P.timberDark, 0.12, 1.5, 0.12, s * 1.0, 0.75, 0);
            }
            b.box('solid', P.timberDark, 2.2, 0.1, 0.14, 0, 1.25, 0);
            b.box('solid', P.timberDark, 2.2, 0.08, 0.14, 0, 0.35, 0.18);
            b.box('solid', P.snow, 2.25, 0.1, 0.2, 0, 1.33, 0);
            // a colorful set of skis leaning on the rack
            const colors = [P.jacket, P.flagBlue, 0xF2C230, P.white, 0x3C9A5F, P.jumpLip];
            for (let i = 0; i < 6; i++) {
                const x = -0.8 + i * 0.32;
                const tilt = 0.12 + r() * 0.05;
                b.box('solid', colors[i], 0.09, 1.75, 0.03, x, 0.85, 0.12, tilt, 0, (r() - 0.5) * 0.06);
                b.box('solid', P.coal, 0.09, 0.15, 0.04, x, 1.66, 0.01, tilt + 0.4, 0, 0);
            }
            // a pair of poles
            b.rod('solid', P.steelDark, 0.95, 0.0, 0.35, 0.85, 1.4, 0.05, 0.02, 4);
            b.rod('solid', P.steelDark, 1.05, 0.0, 0.35, 0.9, 1.4, 0.05, 0.02, 4);
            // snow at the base
            b.ico('solid', P.snowMid, 0.5, 0, -0.7, 0.0, 0, 1.6, 0.3, 0.8);
            b.ico('solid', P.snowMid, 0.4, 0, 0.8, 0.0, 0.1, 1.3, 0.3, 0.8);
        });
        return this.makeGroup('skiRack', t);
    }

    createSnowPile() {
        const t = this.template('snowPile', (b) => {
            const r = rng(31);
            b.ico('solid', P.snow, 1.5, 1, 0, 0.2, 0, 1, 0.55, 1);
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2 + r();
                const d = 0.9 + r() * 0.5;
                b.ico('solid', i % 2 ? P.snowMid : P.snow, 0.5 + r() * 0.35, 0, Math.cos(a) * d, 0.12, Math.sin(a) * d, 1, 0.6, 1);
            }
            // a shovel stuck in the top
            b.box('solid', P.timber, 0.06, 1.3, 0.06, 0.3, 1.2, 0.1, 0.2, 0, 0.15);
            b.box('solid', P.jacket, 0.32, 0.4, 0.04, 0.24, 0.55, 0.0, 0.2, 0, 0.15);
        });
        return this.makeGroup('snowPile', t, { cast: true, receive: true });
    }
}
