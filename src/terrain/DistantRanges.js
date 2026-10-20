/**
 * DistantRanges - three concentric rings of jagged, faceted mountain ridges
 * around the resort, with noisy snowlines and per-layer aerial perspective
 * (each ring lighter and bluer than the one in front of it).
 *
 * One mesh per ring (3 draw calls), flat-shaded, lit by the scene sun so the
 * facets catch the golden-hour light. Fog is applied with a per-layer scale so
 * the ranges stay visible as a silhouette on a clear day but vanish in a blizzard.
 */

import * as THREE from 'three';

const LAYERS = [
    // Deeper, bluer rock than the brief swatches: the editor looks into the sun,
    // so these faces are backlit and must read as cool layered silhouettes.
    { radius: 6000, depth: 1500, hMin: 180, hMax: 1000, freq: 3.4, cols: 300, color: 0x667b9e, snow: 0xeef1f6, haze: 0.0, fogScale: 1.0, seed: 11 },
    { radius: 7600, depth: 1900, hMin: 300, hMax: 1450, freq: 2.7, cols: 320, color: 0x8496b6, snow: 0xeef1f6, haze: 0.2, fogScale: 0.95, seed: 23 },
    { radius: 9400, depth: 2300, hMin: 450, hMax: 1950, freq: 2.2, cols: 340, color: 0xa3b3cc, snow: 0xf0f2f6, haze: 0.38, fogScale: 0.9, seed: 37 },
];

// Cross-section profile: [fraction of ridge height, radial offset in units of depth]
// front face (toward the resort) climbs to the crest, back face drops away.
const PROFILE = [
    [-0.4, -1.0],
    [0.08, -0.84],
    [0.24, -0.66],
    [0.42, -0.48],
    [0.62, -0.3],
    [0.82, -0.14],
    [1.0, 0.0],
    [0.7, 0.24],
    [0.32, 0.55],
    [-0.4, 0.9],
];
const CREST_ROW = 6;
const FOLLOW = 0.35;

function hash(i, s) {
    let h = Math.imul(i | 0, 374761393) ^ Math.imul(s | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

function hash2(ix, iz, s) {
    return hash(Math.imul(ix | 0, 73856093) ^ Math.imul(iz | 0, 19349663), s);
}

function vnoise2(x, z, s) {
    const xi = Math.floor(x), zi = Math.floor(z);
    let xf = x - xi, zf = z - zi;
    xf = xf * xf * (3 - 2 * xf);
    zf = zf * zf * (3 - 2 * zf);
    const a = hash2(xi, zi, s), b = hash2(xi + 1, zi, s);
    const c = hash2(xi, zi + 1, s), d = hash2(xi + 1, zi + 1, s);
    const ab = a + (b - a) * xf, cd = c + (d - c) * xf;
    return ab + (cd - ab) * zf;
}

/** Periodic ridged FBM along the circle (sampled on a 2D circle so it wraps). */
function ridgeAt(theta, freq, s) {
    const cx = Math.cos(theta), sz = Math.sin(theta);
    let total = 0, amp = 1, norm = 0, f = freq;
    for (let o = 0; o < 5; o++) {
        const n = vnoise2(cx * f + 31.7 * o, sz * f - 17.3 * o, s + o * 101);
        const r = 1 - Math.abs(n * 2 - 1);
        total += r * r * amp;
        norm += amp;
        amp *= 0.5;
        f *= 2.1;
    }
    return total / norm;
}

export class DistantRanges {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.group.name = 'distantRanges';
        this.meshes = [];
        this.materials = [];
        this.isNight = false;
    }

    create() {
        LAYERS.forEach((layer, li) => {
            const geo = this.buildRing(layer, li);
            const mat = this.createMaterial(layer, li);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.name = `distantRange${li + 1}`;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.frustumCulled = false; // ring surrounds the camera
            mesh.renderOrder = -0.5;
            this.meshes.push(mesh);
            this.materials.push(mat);
            this.group.add(mesh);
        });
        this.scene.add(this.group);
    }

    buildRing(layer, li) {
        const cols = layer.cols;
        const rows = PROFILE.length;
        const s = layer.seed * 7919;

        // crest heights per column
        const crest = new Float32Array(cols);
        for (let c = 0; c < cols; c++) {
            const th = (c / cols) * Math.PI * 2;
            const r = ridgeAt(th, layer.freq, s);
            // accentuate peaks so silhouettes are jagged, not lumpy
            const peaky = Math.pow(r, 1.8);
            // broad envelope: massifs separated by low saddles (lets far layers show through)
            const env = vnoise2(Math.cos(th) * 2.3 + 5.1, Math.sin(th) * 2.3 - 2.7, s + 999);
            const envelope = 0.3 + 0.7 * Math.pow(Math.min(1, Math.max(0, (env - 0.22) / 0.56)), 1.3);
            crest[c] = layer.hMin + (layer.hMax - layer.hMin) * peaky * envelope;
        }

        const positions = [];
        for (let c = 0; c <= cols; c++) {
            const cc = c % cols;
            const th = (cc / cols) * Math.PI * 2;
            const cos = Math.cos(th), sin = Math.sin(th);
            const H = crest[cc];
            for (let r = 0; r < rows; r++) {
                const [hf, off] = PROFILE[r];
                const j1 = hash(cc * 31 + r, s + 7) - 0.5;
                const j2 = hash(cc * 17 + r * 3, s + 13) - 0.5;
                // spurs: inner rows bulge up/down with a slow noise so faces facet
                const spur = r > 0 && r < rows - 1 && r !== CREST_ROW ? (vnoise2(cc * 0.21, r * 1.7, s + 3) - 0.5) * 0.24 : 0;
                let y = hf * H + (hf > 0 && r !== CREST_ROW ? (spur + j1 * 0.1) * H : 0);
                if (hf < 0) y = -300;
                const rad = layer.radius + off * layer.depth * (0.85 + 0.3 * (j2 + 0.5)) + (r === CREST_ROW ? j2 * 140 : 0);
                // slight angular jitter for irregular facets (not on the seam column)
                const ath = th + (c === cols || cc === 0 ? 0 : j1 * (Math.PI * 2 / cols) * 0.6);
                positions.push(Math.cos(ath) * rad, y, Math.sin(ath) * rad);
            }
        }

        const index = [];
        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows - 1; r++) {
                const a = c * rows + r;
                const b = (c + 1) * rows + r;
                const d = c * rows + r + 1;
                const e = (c + 1) * rows + r + 1;
                // winding so the resort-facing side is the front face
                index.push(a, b, d, b, e, d);
            }
        }

        let geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setIndex(index);
        geo = geo.toNonIndexed();
        geo.computeVertexNormals();

        // Per-face colors: snow above a noisy snowline (less on steep faces), rock below
        const pos = geo.attributes.position.array;
        const nrm = geo.attributes.normal.array;
        const colors = new Float32Array(pos.length);
        const rock = new THREE.Color(layer.color);
        const rockDark = new THREE.Color(layer.color).multiplyScalar(0.82);
        const snow = new THREE.Color(layer.snow).lerp(new THREE.Color(layer.color), layer.haze);
        const tmp = new THREE.Color();
        for (let i = 0; i < pos.length; i += 9) {
            const cx = (pos[i] + pos[i + 3] + pos[i + 6]) / 3;
            const cy = (pos[i + 1] + pos[i + 4] + pos[i + 7]) / 3;
            const cz = (pos[i + 2] + pos[i + 5] + pos[i + 8]) / 3;
            const th = Math.atan2(cz, cx);
            const ny = nrm[i + 1];
            const sl = layer.hMin * 0.55 + (vnoise2(Math.cos(th) * 9, Math.sin(th) * 9, s + 55) - 0.5) * layer.hMax * 0.45
                + (hash(i, s + 77) - 0.5) * layer.hMax * 0.12;
            const steep = ny < 0.42; // cliffs shed snow
            if (cy > sl && !steep) {
                tmp.copy(snow);
                if (ny < 0.6) tmp.lerp(rock, 0.25);
            } else {
                tmp.copy(hash(i, s + 91) > 0.5 ? rock : rockDark);
                // snow streaks just under the line
                if (cy > sl * 0.82 && hash(i, s + 5) > 0.55) tmp.lerp(snow, 0.55);
            }
            for (let k = 0; k < 9; k += 3) {
                colors[i + k] = tmp.r;
                colors[i + k + 1] = tmp.g;
                colors[i + k + 2] = tmp.b;
            }
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.computeBoundingSphere();
        return geo;
    }

    createMaterial(layer, li) {
        const hazeColor = new THREE.Color(layer.color);
        const mat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            flatShading: true,
            roughness: 1,
            metalness: 0,
            emissive: hazeColor.clone().multiplyScalar(0.05 + li * 0.08),
        });
        mat.userData.dayEmissive = mat.emissive.clone();
        const fogUniform = { value: layer.fogScale };
        mat.userData.fogScale = fogUniform;
        mat.onBeforeCompile = (shader) => {
            shader.uniforms.uFogScale = fogUniform;
            // Use the render workstream's sun in-scatter fog colour when it is installed
            const fogColorExpr = (THREE.ShaderChunk.fog_pars_fragment || '').includes('alpineFogColor')
                ? 'alpineFogColor()' : 'fogColor';
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nvarying float vRangeY;')
                .replace('#include <fog_vertex>', '#include <fog_vertex>\nvRangeY = (modelMatrix * vec4(transformed, 1.0)).y;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nuniform float uFogScale;\nvarying float vRangeY;')
                .replace('#include <fog_fragment>', `
#ifdef USE_FOG
    #ifdef FOG_EXP2
        float rangeFog = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth * uFogScale );
        // valley haze: bases melt into the fog, summits rise clear above it
        rangeFog *= mix(1.0, 0.45, smoothstep(0.0, 1100.0, vRangeY));
    #else
        float rangeFog = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb = mix( gl_FragColor.rgb, ${fogColorExpr}, rangeFog );
#endif`);
        };
        mat.customProgramCacheKey = () => 'alpine-distant-range-v1';
        return mat;
    }

    setNightMode(enabled) {
        this.isNight = !!enabled;
        const night = new THREE.Color(0x0c1730);
        this.materials.forEach((m, i) => {
            if (enabled) {
                m.emissive.copy(night).multiplyScalar(0.6 + i * 0.35);
                m.color.setScalar(0.75);
            } else {
                m.emissive.copy(m.userData.dayEmissive);
                m.color.setScalar(1);
            }
        });
    }

    /**
     * Partially follow the camera (35%): the rings keep a little parallax but the
     * camera can never reach the nearest ring, even fully zoomed out at the edge.
     */
    update(delta, camera) {
        if (camera) {
            this.group.position.x = camera.position.x * FOLLOW;
            this.group.position.z = camera.position.z * FOLLOW;
        }
    }

    dispose() {
        this.scene.remove(this.group);
        this.meshes.forEach(m => m.geometry.dispose());
        this.materials.forEach(m => m.dispose());
        this.meshes = [];
        this.materials = [];
    }
}
