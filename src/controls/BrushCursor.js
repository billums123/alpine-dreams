/**
 * BrushCursor - terrain-conforming sculpt brush indicator.
 *
 *   setMode('raise'|'lower'|'smooth'|null)   null hides
 *   update(point|null, radius, active)       conforms rings + falloff disc to the terrain
 *   pulse()                                  expanding ripple (also auto on 'sculpt:stroke' start)
 *   tick(delta)                              animation; ObjectPlacer.update() calls it
 *   dispose()
 *
 * Draws: a bright outer ribbon ring, a fainter inner falloff ring (50%), a soft
 * radial fill (vertex alpha), a center pip, and a ripple ring on pulse.
 * 3 draw calls while visible (fill, rings, ripple). No allocations per update.
 */

import * as THREE from 'three';
import { events } from '../core/events.js';

const MODE_COLORS = {
    raise: new THREE.Color('#FFB46A'),   // warm
    lower: new THREE.Color('#7CC4FF'),   // glacier
    smooth: new THREE.Color('#F4F8FF'),  // white
};

const SEG = 96;          // ring segments
const FILL_RINGS = 7;    // radial rings in the fill disc
const FILL_SEG = 48;

export class BrushCursor {
    constructor(scene, mountain) {
        this.scene = scene;
        this.mountain = mountain;
        this.mode = null;
        this.radius = 150;
        this.active = false;
        this.point = new THREE.Vector3();
        this.hasPoint = false;
        this.time = 0;
        this.pulseT = -1;
        this.color = new THREE.Color('#F4F8FF');
        this.targetColor = new THREE.Color('#F4F8FF');
        this.activeAmt = 0;

        this.group = new THREE.Group();
        this.group.name = 'brushCursor';
        this.group.visible = false;
        this.group.renderOrder = 20;

        // --- Rings (outer ribbon + inner falloff ribbon + center pip) as one mesh
        const ringVerts = (SEG + 1) * 2 * 2 + 2 * (12 + 1);
        this.ringPos = new Float32Array(ringVerts * 3);
        this.ringAlpha = new Float32Array(ringVerts);
        const ringGeo = new THREE.BufferGeometry();
        ringGeo.setAttribute('position', new THREE.BufferAttribute(this.ringPos, 3).setUsage(THREE.DynamicDrawUsage));
        ringGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.ringAlpha, 1));
        const idx = [];
        const addStrip = (base, n) => {
            for (let i = 0; i < n; i++) {
                const a = base + i * 2;
                idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
            }
        };
        addStrip(0, SEG);                        // outer
        addStrip((SEG + 1) * 2, SEG);            // inner
        addStrip((SEG + 1) * 4, 12);             // pip
        ringGeo.setIndex(idx);
        // Static alpha: outer 1, inner 0.45, pip 0.9
        for (let i = 0; i < (SEG + 1) * 2; i++) this.ringAlpha[i] = 1;
        for (let i = (SEG + 1) * 2; i < (SEG + 1) * 4; i++) this.ringAlpha[i] = 0.42;
        for (let i = (SEG + 1) * 4; i < ringVerts; i++) this.ringAlpha[i] = 0.9;
        ringGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

        this.ringMat = this._makeMaterial(1);
        this.rings = new THREE.Mesh(ringGeo, this.ringMat);
        this.rings.frustumCulled = false;
        this.rings.renderOrder = 22;
        this.group.add(this.rings);

        // --- Fill disc with radial alpha falloff
        const fillVerts = 1 + FILL_RINGS * (FILL_SEG + 1);
        this.fillPos = new Float32Array(fillVerts * 3);
        this.fillAlpha = new Float32Array(fillVerts);
        const fillGeo = new THREE.BufferGeometry();
        fillGeo.setAttribute('position', new THREE.BufferAttribute(this.fillPos, 3).setUsage(THREE.DynamicDrawUsage));
        fillGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.fillAlpha, 1));
        const fidx = [];
        for (let s = 0; s < FILL_SEG; s++) fidx.push(0, 1 + s + 1, 1 + s);
        for (let r = 0; r < FILL_RINGS - 1; r++) {
            const a0 = 1 + r * (FILL_SEG + 1);
            const a1 = 1 + (r + 1) * (FILL_SEG + 1);
            for (let s = 0; s < FILL_SEG; s++) {
                fidx.push(a0 + s, a0 + s + 1, a1 + s, a0 + s + 1, a1 + s + 1, a1 + s);
            }
        }
        fillGeo.setIndex(fidx);
        this.fillAlpha[0] = 1;
        for (let r = 0; r < FILL_RINGS; r++) {
            const rr = (r + 1) / FILL_RINGS;
            // smooth falloff matching Mountain.sculpt (smoothstep of 1 - d/R)
            const f = 1 - rr;
            const a = f * f * (3 - 2 * f);
            for (let s = 0; s <= FILL_SEG; s++) this.fillAlpha[1 + r * (FILL_SEG + 1) + s] = a;
        }
        fillGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
        this.fillMat = this._makeMaterial(0.16);
        this.fill = new THREE.Mesh(fillGeo, this.fillMat);
        this.fill.frustumCulled = false;
        this.fill.renderOrder = 21;
        this.group.add(this.fill);

        // --- Ripple ring (pulse)
        this.ripplePos = new Float32Array((SEG + 1) * 2 * 3);
        const rippleAlpha = new Float32Array((SEG + 1) * 2).fill(1);
        const ripGeo = new THREE.BufferGeometry();
        ripGeo.setAttribute('position', new THREE.BufferAttribute(this.ripplePos, 3).setUsage(THREE.DynamicDrawUsage));
        ripGeo.setAttribute('aAlpha', new THREE.BufferAttribute(rippleAlpha, 1));
        const ridx = [];
        for (let i = 0; i < SEG; i++) { const a = i * 2; ridx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        ripGeo.setIndex(ridx);
        ripGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
        this.rippleMat = this._makeMaterial(0);
        this.ripple = new THREE.Mesh(ripGeo, this.rippleMat);
        this.ripple.frustumCulled = false;
        this.ripple.visible = false;
        this.ripple.renderOrder = 23;
        this.group.add(this.ripple);

        this.scene.add(this.group);

        this._unsub = events.on('sculpt:stroke', (p) => {
            if (p && p.phase === 'start') this.pulse();
        });
    }

    _makeMaterial(opacity) {
        return new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color('#F4F8FF') },
                uOpacity: { value: opacity },
            },
            vertexShader: /* glsl */`
                attribute float aAlpha;
                varying float vAlpha;
                void main() {
                    vAlpha = aAlpha;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                uniform vec3 uColor;
                uniform float uOpacity;
                varying float vAlpha;
                void main() {
                    gl_FragColor = vec4(uColor, vAlpha * uOpacity);
                }
            `,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            polygonOffset: true,
            polygonOffsetFactor: -6,
            polygonOffsetUnits: -6,
            side: THREE.DoubleSide,
            toneMapped: false,
            fog: false,
        });
    }

    setMode(mode) {
        this.mode = mode || null;
        if (!this.mode) {
            this.group.visible = false;
            return;
        }
        this.targetColor.copy(MODE_COLORS[this.mode] || MODE_COLORS.smooth);
        if (!this.group.visible) this.color.copy(this.targetColor);
        this.group.visible = this.hasPoint;
    }

    update(point, radius, active) {
        if (!point || !this.mode) {
            this.hasPoint = false;
            this.group.visible = false;
            return;
        }
        this.hasPoint = true;
        this.point.copy(point);
        if (radius) this.radius = radius;
        this.active = !!active;
        this.group.visible = true;
        this._rebuild();
    }

    pulse() {
        this.pulseT = 0;
        this.ripple.visible = this.group.visible;
    }

    _h(x, z) {
        return this.mountain.getHeightAt(x, z);
    }

    _writeRibbon(arr, base, cx, cz, r, width, lift) {
        const hw = width * 0.5;
        for (let i = 0; i <= SEG; i++) {
            const a = (i / SEG) * Math.PI * 2;
            const c = Math.cos(a), s = Math.sin(a);
            const ri = r - hw, ro = r + hw;
            let x = cx + c * ri, z = cz + s * ri;
            let k = (base + i * 2) * 3;
            arr[k] = x; arr[k + 1] = this._h(x, z) + lift; arr[k + 2] = z;
            x = cx + c * ro; z = cz + s * ro;
            k += 3;
            arr[k] = x; arr[k + 1] = this._h(x, z) + lift; arr[k + 2] = z;
        }
    }

    _rebuild() {
        const cx = this.point.x, cz = this.point.z;
        const R = this.radius;
        const breathe = 1 + Math.sin(this.time * 2.4) * 0.012 * (1 - this.activeAmt);
        const r = R * breathe;
        const width = Math.max(1.2, R * 0.022) * (1 + this.activeAmt * 0.6);
        const lift = 0.8;

        this._writeRibbon(this.ringPos, 0, cx, cz, r, width, lift);
        this._writeRibbon(this.ringPos, (SEG + 1) * 2, cx, cz, r * 0.5, width * 0.55, lift);

        // Center pip (small ring)
        const pipBase = (SEG + 1) * 4;
        const pr = Math.max(1.5, R * 0.03);
        for (let i = 0; i <= 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            const c = Math.cos(a), s = Math.sin(a);
            let x = cx + c * pr * 0.35, z = cz + s * pr * 0.35;
            let k = (pipBase + i * 2) * 3;
            this.ringPos[k] = x; this.ringPos[k + 1] = this._h(x, z) + lift; this.ringPos[k + 2] = z;
            x = cx + c * pr; z = cz + s * pr;
            k += 3;
            this.ringPos[k] = x; this.ringPos[k + 1] = this._h(x, z) + lift; this.ringPos[k + 2] = z;
        }
        this.rings.geometry.attributes.position.needsUpdate = true;

        // Fill disc
        const fp = this.fillPos;
        fp[0] = cx; fp[1] = this._h(cx, cz) + lift * 0.5; fp[2] = cz;
        for (let ri = 0; ri < FILL_RINGS; ri++) {
            const rr = r * (ri + 1) / FILL_RINGS;
            for (let s = 0; s <= FILL_SEG; s++) {
                const a = (s / FILL_SEG) * Math.PI * 2;
                const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
                const k = (1 + ri * (FILL_SEG + 1) + s) * 3;
                fp[k] = x; fp[k + 1] = this._h(x, z) + lift * 0.5; fp[k + 2] = z;
            }
        }
        this.fill.geometry.attributes.position.needsUpdate = true;
    }

    tick(delta = 0.016) {
        if (!this.group.visible) return;
        this.time += delta;
        const k = 1 - Math.exp(-delta * 10);
        this.activeAmt += ((this.active ? 1 : 0) - this.activeAmt) * k;
        this.color.lerp(this.targetColor, k);

        this.ringMat.uniforms.uColor.value.copy(this.color);
        this.fillMat.uniforms.uColor.value.copy(this.color);
        this.rippleMat.uniforms.uColor.value.copy(this.color);
        this.ringMat.uniforms.uOpacity.value = 0.75 + 0.25 * this.activeAmt;
        this.fillMat.uniforms.uOpacity.value = 0.1 + 0.14 * this.activeAmt + 0.03 * Math.sin(this.time * 6) * this.activeAmt;

        // Breathing ring needs a rebuild only occasionally (cheap: ~400 height samples)
        if (this.hasPoint) this._rebuild();

        if (this.pulseT >= 0) {
            this.pulseT += delta;
            const d = 0.55;
            const t = Math.min(1, this.pulseT / d);
            const ease = 1 - Math.pow(1 - t, 3);
            const r = this.radius * (0.35 + 0.85 * ease);
            this._writeRibbon(this.ripplePos, 0, this.point.x, this.point.z, r, Math.max(1, this.radius * 0.03) * (1 - t * 0.6), 1.0);
            this.ripple.geometry.attributes.position.needsUpdate = true;
            this.rippleMat.uniforms.uOpacity.value = 0.85 * (1 - t);
            this.ripple.visible = true;
            if (t >= 1) {
                this.pulseT = -1;
                this.ripple.visible = false;
            }
        }
    }

    dispose() {
        this._unsub?.();
        this.scene.remove(this.group);
        [this.rings, this.fill, this.ripple].forEach(m => {
            m.geometry.dispose();
            m.material.dispose();
        });
    }
}
