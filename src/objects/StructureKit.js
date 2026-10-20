/**
 * StructureKit - shared helpers for the structure factories (Lodge, SkiLift, Decorations).
 *
 * - PALETTE: the "Alpenglow" structure palette (DESIGN_BRIEF §1.1).
 * - PartBuilder: collects many small primitives (with a per-part vertex color and a
 *   transform stack) and merges them into ONE BufferGeometry per material key, so a
 *   whole lodge renders in a handful of draw calls.
 * - nightFader: a tiny global fader that eases emissive/opacity values between day and
 *   night (~1s) whenever setNightMode() is called on any factory. It is ticked from
 *   onBeforeRender hooks on the structures themselves, so nobody has to call update().
 * - Glow helpers: shared soft radial texture for additive halo points and light pools.
 *
 * Owned by workstream C (structures).
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const PALETTE = {
    timber: 0x8A5A3B,
    timberLight: 0xA06C47,
    timberDark: 0x5A3A28,
    timberEnd: 0xB98A5E,
    stone: 0x7D7A76,
    stoneLight: 0x9A968F,
    stoneDark: 0x5E5B58,
    concrete: 0xA8A49C,
    roofRed: 0xA23A2C,
    roofRedDark: 0x7E2A20,
    roofSlate: 0x3D4A5C,
    roofSlateDark: 0x2C3644,
    snow: 0xFFF8EF,
    snowMid: 0xE7EEF6,
    snowShade: 0xCFDCEB,
    ice: 0xCFE4F4,
    liftSteel: 0x8C96A3,
    steelDark: 0x4A525E,
    rubber: 0x23272E,
    liftChair: 0x2B3A55,
    liftChairLight: 0x3C4F72,
    gondola: 0xD9452B,
    gondolaDark: 0xA8321F,
    white: 0xF2F2EE,
    flagRed: 0xE0473A,
    flagBlue: 0x2F6FD6,
    jumpLip: 0xFF7A1A,
    jacket: 0xE8553D,
    carrot: 0xF07A1E,
    coal: 0x1B1C20,
    stick: 0x5A3E2B,
    glass: 0x1B2436,
    warmWindow: 0xFFB04D,
    warmLamp: 0xFFC870,
    pineDeep: 0x1C3A31,
    pineMid: 0x2C5545,
    pineTip: 0x4A7A5A,
    trunk: 0x4A3426,
};

/** Deterministic PRNG (mulberry32) so cached template geometry is stable. */
export function rng(seed = 1) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * PartBuilder: accumulate primitives per material key, then merge.
 * All transforms are local to the current frame (push/pop).
 */
export class PartBuilder {
    constructor() {
        this.parts = new Map();
        this.stack = [new THREE.Matrix4()];
    }

    get top() { return this.stack[this.stack.length - 1]; }

    /** Push a frame: translate, then rotate (Euler XYZ in radians, yaw usually), then uniform scale. */
    push(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1) {
        _e.set(rx, ry, rz, 'YXZ');
        _q.setFromEuler(_e);
        _m.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
        this.stack.push(this.top.clone().multiply(_m));
        return this;
    }

    pop() {
        if (this.stack.length > 1) this.stack.pop();
        return this;
    }

    /**
     * Add a geometry (consumed) with a flat vertex color and local transform.
     * color may be a hex number or a function(cx,cy,cz,nx,ny,nz) -> hex evaluated per triangle (post-transform, frame coords).
     */
    add(key, geometry, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
        let g = geometry.index ? geometry.toNonIndexed() : geometry;
        if (g !== geometry) geometry.dispose();
        for (const name of Object.keys(g.attributes)) {
            if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
        }
        if (!g.attributes.normal) g.computeVertexNormals();
        _e.set(rx, ry, rz, 'XYZ');
        _q.setFromEuler(_e);
        _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
        _m.premultiply(this.top);
        g.applyMatrix4(_m);

        const count = g.attributes.position.count;
        const colors = new Float32Array(count * 3);
        if (typeof color === 'function') {
            // Per-face coloring: evaluated at each triangle's centroid with its face normal,
            // so color boundaries stay crisp on faceted geometry.
            const pos = g.attributes.position;
            const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
            const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
            for (let i = 0; i + 2 < count; i += 3) {
                va.fromBufferAttribute(pos, i); vb.fromBufferAttribute(pos, i + 1); vc.fromBufferAttribute(pos, i + 2);
                n.crossVectors(e1.subVectors(vb, va), e2.subVectors(vc, va)).normalize();
                _c.setHex(color((va.x + vb.x + vc.x) / 3, (va.y + vb.y + vc.y) / 3, (va.z + vb.z + vc.z) / 3, n.x, n.y, n.z));
                for (let k = 0; k < 3; k++) {
                    colors[(i + k) * 3] = _c.r; colors[(i + k) * 3 + 1] = _c.g; colors[(i + k) * 3 + 2] = _c.b;
                }
            }
        } else {
            _c.setHex(color ?? 0xffffff);
            for (let i = 0; i < count; i++) {
                colors[i * 3] = _c.r; colors[i * 3 + 1] = _c.g; colors[i * 3 + 2] = _c.b;
            }
        }
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        if (!this.parts.has(key)) this.parts.set(key, []);
        this.parts.get(key).push(g);
        return g;
    }

    box(key, color, w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
        return this.add(key, new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz);
    }

    cyl(key, color, rTop, rBot, h, seg, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
        return this.add(key, new THREE.CylinderGeometry(rTop, rBot, h, seg), color, x, y, z, rx, ry, rz, sx, sy, sz);
    }

    cone(key, color, r, h, seg, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
        return this.add(key, new THREE.ConeGeometry(r, h, seg), color, x, y, z, rx, ry, rz);
    }

    sphere(key, color, r, ws, hs, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
        return this.add(key, new THREE.SphereGeometry(r, ws, hs), color, x, y, z, 0, 0, 0, sx, sy, sz);
    }

    ico(key, color, r, detail, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
        return this.add(key, new THREE.IcosahedronGeometry(r, detail), color, x, y, z, rx, ry, rz, sx, sy, sz);
    }

    /** A square-section beam between two local points. */
    beam(key, color, ax, ay, az, bx, by, bz, thick = 0.1, thickZ = thick) {
        _a.set(ax, ay, az);
        _b.set(bx, by, bz);
        const len = _a.distanceTo(_b);
        if (len < 1e-5) return null;
        const g = new THREE.BoxGeometry(thick, len, thickZ);
        const dir = _b.clone().sub(_a).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(_up, dir);
        const mid = _a.clone().add(_b).multiplyScalar(0.5);
        const m = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
        g.applyMatrix4(m);
        return this.add(key, g, color);
    }

    /** A round rod between two points. */
    rod(key, color, ax, ay, az, bx, by, bz, r = 0.05, seg = 5) {
        _a.set(ax, ay, az);
        _b.set(bx, by, bz);
        const len = _a.distanceTo(_b);
        if (len < 1e-5) return null;
        const g = new THREE.CylinderGeometry(r, r, len, seg);
        const dir = _b.clone().sub(_a).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(_up, dir);
        const mid = _a.clone().add(_b).multiplyScalar(0.5);
        g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
        return this.add(key, g, color);
    }

    /**
     * Snow skirt: a flared square frustum hanging below (cx, topY, cz) so structures sitting on a
     * slope get a natural snow bank instead of a floating slab. Invisible on flat ground.
     */
    skirt(key, color, cx, cz, hx, hz, topY = 0, depth = 6, flare = 5) {
        const g = new THREE.CylinderGeometry(Math.SQRT2, Math.SQRT2, 1, 4, 1, true);
        g.rotateY(Math.PI / 4);
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const top = pos.getY(i) > 0;
            const sx = pos.getX(i) > 0 ? 1 : -1;
            const sz = pos.getZ(i) > 0 ? 1 : -1;
            pos.setXYZ(i,
                sx * (hx + (top ? 0 : flare)),
                top ? 0 : -depth,
                sz * (hz + (top ? 0 : flare)));
        }
        g.computeVertexNormals();
        const out = this.add(key, g, color, cx, topY, cz);
        out.userData.noBounds = true; // keep footprints/bounds tight (skirt is mostly underground)
        return out;
    }

    /** Transform a local point by the current frame (useful to record glow/smoke anchors). */
    point(x, y, z) {
        return new THREE.Vector3(x, y, z).applyMatrix4(this.top);
    }

    has(key) { return this.parts.has(key) && this.parts.get(key).length > 0; }

    /** Merge all parts with this key into one geometry (or null). */
    build(key) {
        const list = this.parts.get(key);
        if (!list || list.length === 0) return null;
        const merged = mergeGeometries(list, false);
        let bounds = null;
        for (const g of list) {
            if (g.userData.noBounds) continue;
            g.computeBoundingBox();
            bounds = bounds ? bounds.union(g.boundingBox) : g.boundingBox.clone();
        }
        list.forEach(g => g.dispose());
        this.parts.delete(key);
        if (merged) {
            merged.computeBoundingSphere();
            if (bounds) merged.boundingBox = bounds;
            else merged.computeBoundingBox();
        }
        return merged;
    }
}

/* ------------------------------------------------------------------------- */
/* Night fader                                                                */
/* ------------------------------------------------------------------------- */

class NightFader {
    constructor() {
        this.k = 0;            // 0 = day, 1 = night (eased)
        this.target = 0;
        this.duration = 1.1;   // seconds
        this.entries = [];
        this.last = 0;
        this.tick = this.tick.bind(this);
    }

    /** Register a material property that blends between day and night values. */
    register(material, prop, day, night, { hideAtDay = false, color = null } = {}) {
        const entry = { material, prop, day, night, hideAtDay, color };
        this.entries.push(entry);
        this.applyEntry(entry, this.k);
        return entry;
    }

    setNight(enabled, instant = false) {
        this.target = enabled ? 1 : 0;
        if (instant) {
            this.k = this.target;
            this.applyAll();
        }
        // make sure the next tick does not see a huge dt
        if (!this.last) this.last = performance.now();
    }

    applyEntry(e, k) {
        const s = k * k * (3 - 2 * k);
        const v = e.day + (e.night - e.day) * s;
        if (e.prop === 'uniform') {
            e.material.uniforms.uNight.value = s;
        } else {
            e.material[e.prop] = v;
        }
        if (e.hideAtDay) e.material.visible = v > 0.004;
    }

    applyAll() {
        for (const e of this.entries) this.applyEntry(e, this.k);
    }

    /** Called from onBeforeRender hooks; idempotent within ~1ms. */
    tick() {
        const now = performance.now();
        const dt = Math.min(0.1, (now - this.last) / 1000);
        if (dt < 0.001) return;
        this.last = now;
        if (this.k === this.target) return;
        const step = dt / this.duration;
        this.k = this.target > this.k ? Math.min(this.target, this.k + step) : Math.max(this.target, this.k - step);
        this.applyAll();
    }
}

export const nightFader = new NightFader();

/** Attach the fader tick to a mesh so it advances whenever structures render. */
export function hookTick(object) {
    const prev = object.onBeforeRender;
    object.onBeforeRender = function (...args) {
        nightFader.tick();
        if (prev && prev !== THREE.Object3D.prototype.onBeforeRender) prev.apply(this, args);
    };
    return object;
}

/* ------------------------------------------------------------------------- */
/* Glow / light pool                                                          */
/* ------------------------------------------------------------------------- */

let _glowTexture = null;
export function getGlowTexture() {
    if (_glowTexture) return _glowTexture;
    const size = 64;
    let canvas;
    try {
        canvas = document.createElement('canvas');
    } catch (e) {
        return null;
    }
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    _glowTexture = new THREE.CanvasTexture(canvas);
    _glowTexture.colorSpace = THREE.SRGBColorSpace;
    return _glowTexture;
}

/** Shared material set for warm night glows (one set per factory). */
export function createGlowMaterials(color = PALETTE.warmWindow) {
    const tex = getGlowTexture();
    const halo = new THREE.PointsMaterial({
        color,
        size: 3.2,
        map: tex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
    });
    const pool = new THREE.MeshBasicMaterial({
        color,
        map: tex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
    });
    nightFader.register(halo, 'opacity', 0, 0.85, { hideAtDay: true });
    nightFader.register(pool, 'opacity', 0, 0.8, { hideAtDay: true });
    return { halo, pool };
}

/** Points at each anchor; shows only at night. */
export function createHaloPoints(anchors, material) {
    if (!anchors.length) return null;
    const arr = new Float32Array(anchors.length * 3);
    anchors.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z; });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    g.computeBoundingSphere();
    const pts = new THREE.Points(g, material);
    pts.name = 'nightHalo';
    pts.renderOrder = 2;
    pts.userData.isDecal = true;
    return pts;
}

/** Flat warm "light pool" decals (merged). Each pool: {x,y,z,r}. */
export function createLightPools(pools, material) {
    if (!pools.length) return null;
    const geos = pools.map(p => {
        const g = new THREE.CircleGeometry(p.r, 20);
        g.rotateX(-Math.PI / 2);
        g.translate(p.x, p.y, p.z);
        return g;
    });
    const merged = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = 'lightPool';
    mesh.renderOrder = 1;
    mesh.userData.isDecal = true;
    return mesh;
}

/** Standard vertex-colored faceted material. */
export function createSolidMaterial(opts = {}) {
    return new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.82,
        metalness: 0.0,
        flatShading: true,
        ...opts,
    });
}

/** Window/lamp glass that glows warm (dim by day, blooms at night). */
export function createWindowMaterial({ day = 0.28, night = 2.6, color = PALETTE.glass, emissive = PALETTE.warmWindow } = {}) {
    const mat = new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity: day,
        roughness: 0.22,
        metalness: 0.1,
        flatShading: true,
    });
    nightFader.register(mat, 'emissiveIntensity', day, night);
    return mat;
}

/** Flag cached template geometries so placement code never disposes them on delete. */
export function markShared(...geos) {
    for (const g of geos) if (g) g.userData.shared = true;
}

/** Make a mesh from a builder key and set shadow flags. */
export function meshFrom(builder, key, material, { cast = false, receive = false, name = '' } = {}) {
    const geo = builder.build(key);
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    if (name) mesh.name = name;
    return mesh;
}
