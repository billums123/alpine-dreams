/**
 * Sky - "Alpenglow" sky dome, sun/moon, stars, aurora and painted cloud cards.
 *
 * - Dome shader: zenith -> mid -> horizon gradient with an azimuth-dependent
 *   warm horizon toward the sun, an HDR sun disc + Mie-like glow (blooms),
 *   and a horizon haze band computed with exactly the same formula as the
 *   atmospheric fog (SceneManager.installAtmosphericFog) so terrain melts into sky.
 * - Night: indigo gradient, cratered moon disc + glow, faint milky way and a
 *   slow aurora ribbon. Stars fade in (Points, 1 draw call).
 * - Clouds: billboard cards in one draw call, painted on a procedural canvas
 *   atlas (lit tops, shaded flat bottoms), tinted by sun and night, drifting.
 * - Dome, stars and clouds follow whatever camera renders them, so the sky can
 *   never end up outside the camera.
 *
 * Distant mountains now live in src/terrain/DistantRanges.js (workstream B).
 */

import * as THREE from 'three';
import { fogAtmosphere } from './SceneManager.js';

const DOME_RADIUS = 9000;
const STAR_RADIUS = 8500;
const CLOUD_FIELD = 7600;      // half-extent of the drifting cloud field around the camera

const DAY = {
    zenith: new THREE.Color(0x3d6fb6),
    mid: new THREE.Color(0x8fb6e0),
    horizonCool: new THREE.Color(0xc9d7ea),
    horizonWarm: new THREE.Color(0xf4c9a0),
    sunDisc: new THREE.Color(0xfff4de),
    sunGlow: new THREE.Color(0xffc27a),
    cloudLit: new THREE.Color(0xfff3e4),
    cloudShade: new THREE.Color(0xa9b7d0),
};
const NIGHT = {
    zenith: new THREE.Color(0x050b1e),
    mid: new THREE.Color(0x0c1834),
    horizonCool: new THREE.Color(0x1a2a4c),
    horizonWarm: new THREE.Color(0x24345a),
    cloudLit: new THREE.Color(0x46588a),
    cloudShade: new THREE.Color(0x141e38),
};
const BLIZZARD = {
    sky: new THREE.Color(0xb7c2d0),
    nightSky: new THREE.Color(0x1a2438),
};

// Moon disc placement: low over the far side of the resort so it shows up
// from both the editor camera and the title-screen orbit.
const MOON_DISC_DIRECTION = new THREE.Vector3(0.42, 0.24, -0.88).normalize();

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

export class Sky {
    constructor(scene) {
        this.scene = scene;
        this.skyMesh = null;
        this.clouds = [];          // kept for compatibility (holds the single cloud mesh)
        this.cloudMesh = null;
        this.starField = null;
        this.isNight = false;
        this.nightAmount = 0;
        this.blizzardAmount = 0;
        this.time = 0;
        this.camera = null;

        this.sunDirection = new THREE.Vector3(-0.62, 0.42, -0.66).normalize();
        this.moonDirection = MOON_DISC_DIRECTION.clone();
        this.fogColor = new THREE.Color(0xc4d2e4);

        // Back-compat
        this.dayColors = { top: DAY.zenith.clone(), horizon: DAY.horizonCool.clone(), bottom: DAY.horizonCool.clone() };
    }

    create() {
        this.createSkyDome();
        this.createClouds();
        this.createStarField();
        this.applyBlend(0, 0);
    }

    /* ------------------------------------------------------------ */
    /* Dome                                                          */
    /* ------------------------------------------------------------ */

    createSkyDome() {
        const geometry = new THREE.SphereGeometry(DOME_RADIUS, 48, 24);

        const uniforms = {
            uZenith: { value: DAY.zenith.clone() },
            uMid: { value: DAY.mid.clone() },
            uHorizonCool: { value: DAY.horizonCool.clone() },
            uHorizonWarm: { value: DAY.horizonWarm.clone() },
            uFogColor: { value: this.fogColor.clone() },
            // shared with every fogged material: the haze formula must match
            uHazeDir: { value: fogAtmosphere.sunDir },
            uHazeColor: { value: fogAtmosphere.sunColor },
            uHazeParams: { value: fogAtmosphere.params },
            uSunDir: { value: this.sunDirection.clone() },
            uSunDisc: { value: DAY.sunDisc.clone().multiplyScalar(18) },
            uSunGlow: { value: DAY.sunGlow.clone() },
            uSunVis: { value: 1 },
            uMoonDir: { value: this.moonDirection.clone() },
            uMoonColor: { value: new THREE.Color(0xdce6ff).multiplyScalar(1.5) },
            uNight: { value: 0 },
            uBlizzard: { value: 0 },
            uBlizzardColor: { value: BLIZZARD.sky.clone() },
            uTime: { value: 0 },
        };

        const material = new THREE.ShaderMaterial({
            name: 'AlpenglowSky',
            uniforms,
            vertexShader: /* glsl */`
                varying vec3 vDir;
                void main() {
                    vDir = position;
                    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    gl_Position = p.xyww; // pin to the far plane
                }
            `,
            fragmentShader: /* glsl */`
                uniform vec3 uZenith;
                uniform vec3 uMid;
                uniform vec3 uHorizonCool;
                uniform vec3 uHorizonWarm;
                uniform vec3 uFogColor;
                uniform vec3 uHazeDir;
                uniform vec3 uHazeColor;
                uniform vec3 uHazeParams;
                uniform vec3 uSunDir;
                uniform vec3 uSunDisc;
                uniform vec3 uSunGlow;
                uniform float uSunVis;
                uniform vec3 uMoonDir;
                uniform vec3 uMoonColor;
                uniform float uNight;
                uniform float uBlizzard;
                uniform vec3 uBlizzardColor;
                uniform float uTime;
                varying vec3 vDir;

                float hash13(vec3 p3) {
                    p3 = fract(p3 * 0.1031);
                    p3 += dot(p3, p3.zyx + 31.32);
                    return fract((p3.x + p3.y) * p3.z);
                }
                float vnoise(vec3 p) {
                    vec3 i = floor(p);
                    vec3 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(
                        mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x),
                            mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
                        mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                            mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
                }

                void main() {
                    vec3 dir = normalize(vDir);
                    float h = dir.y;

                    // --- gradient with warm horizon toward the sun's azimuth
                    vec2 hd = normalize(dir.xz + vec2(1e-5));
                    vec2 sh = normalize(uSunDir.xz + vec2(1e-5));
                    float az = max(dot(hd, sh), 0.0);
                    float warm = pow(az, 2.2) * (1.0 - smoothstep(0.0, 0.45, h));
                    vec3 horizon = mix(uHorizonCool, uHorizonWarm, warm * (1.0 - uNight * 0.6));
                    vec3 col = mix(horizon, uMid, smoothstep(0.02, 0.26, h));
                    col = mix(col, uZenith, smoothstep(0.16, 0.8, h));

                    // --- blizzard: flatten toward an overcast grey
                    col = mix(col, uBlizzardColor, uBlizzard * 0.85);

                    // --- night extras: milky way + aurora
                    if (uNight > 0.01 && h > -0.05) {
                        // milky way: a faint noisy band along a tilted great circle
                        vec3 bandN = normalize(vec3(0.35, 0.25, 0.9));
                        float band = exp(-pow(dot(dir, bandN) * 4.2, 2.0));
                        float n = vnoise(dir * 9.0) * 0.6 + vnoise(dir * 23.0) * 0.4;
                        col += vec3(0.05, 0.065, 0.11) * band * smoothstep(0.35, 0.85, n) * uNight * (1.0 - uBlizzard) * smoothstep(0.0, 0.3, h);

                        // aurora: slow curtains low over the far (north, -z) horizon
                        float north = smoothstep(0.1, 0.75, -dir.z);
                        if (north > 0.0) {
                            float a = atan(dir.x, -dir.z);
                            float wave = sin(a * 3.0 + uTime * 0.05 + sin(a * 7.0 - uTime * 0.09) * 0.7);
                            float base = 0.11 + 0.05 * wave;
                            float above = h - base;
                            float shape = smoothstep(-0.012, 0.012, above) * exp(-max(above, 0.0) * 9.0);
                            float rays = 0.55 + 0.45 * vnoise(vec3(a * 38.0, uTime * 0.25, 1.7));
                            float flick = 0.7 + 0.3 * sin(uTime * 0.4 + a * 5.0);
                            vec3 aur = mix(vec3(0.12, 0.95, 0.55), vec3(0.45, 0.25, 0.95), smoothstep(0.0, 0.14, above));
                            col += aur * shape * rays * flick * north * 0.32 * uNight * (1.0 - uBlizzard);
                        }
                    }

                    // --- horizon haze band: identical to the fog formula
                    float hazeAmt = pow(max(dot(dir, uHazeDir), 0.0), max(uHazeParams.y, 1.0)) * uHazeParams.x;
                    vec3 fogCol = mix(uFogColor, uHazeColor, clamp(hazeAmt, 0.0, 1.0));
                    float band = 1.0 - smoothstep(-0.015, 0.075 + 0.3 * uBlizzard, h);
                    col = mix(col, fogCol, band);

                    // --- sun: glow + HDR disc (blooms)
                    float cs = dot(dir, normalize(uSunDir));
                    float csp = max(cs, 0.0);
                    float glow = pow(csp, 8.0) * 0.1 + pow(csp, 64.0) * 0.28 + pow(csp, 900.0) * 1.4;
                    float vis = uSunVis * (1.0 - uBlizzard * 0.85);
                    col += uSunGlow * glow * vis;
                    float disc = smoothstep(0.99955, 0.99972, cs) * smoothstep(-0.03, 0.01, h);
                    col = mix(col, uSunDisc, disc * vis * (1.0 - uBlizzard * 0.5));

                    // --- moon: cratered disc + cool glow
                    if (uNight > 0.01) {
                        vec3 md = normalize(uMoonDir);
                        float cm = dot(dir, md);
                        float mglow = pow(max(cm, 0.0), 40.0) * 0.12 + pow(max(cm, 0.0), 900.0) * 0.4;
                        float mvis = uNight * (1.0 - uBlizzard * 0.85);
                        col += uMoonColor * 0.12 * mglow * mvis;
                        float mdisc = smoothstep(0.99935, 0.9995, cm);
                        if (mdisc > 0.0) {
                            vec3 t = normalize(cross(md, vec3(0.0, 1.0, 0.0)));
                            vec3 b = cross(t, md);
                            vec2 muv = vec2(dot(dir, t), dot(dir, b)) * 28.0;
                            float crater = vnoise(vec3(muv * 2.3, 3.1)) * 0.6 + vnoise(vec3(muv * 5.0, 7.7)) * 0.4;
                            float limb = 1.0 - 0.35 * pow(clamp(length(muv) / 1.0, 0.0, 1.0), 3.0);
                            vec3 moon = uMoonColor * (0.78 + 0.32 * smoothstep(0.35, 0.75, crater)) * limb;
                            col = mix(col, moon, mdisc * mvis);
                        }
                    }

                    // below the horizon the dome is pure fog colour (hidden by terrain anyway)
                    gl_FragColor = vec4(col, 1.0);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }
            `,
            side: THREE.BackSide,
            depthWrite: false,
            depthTest: false,
            fog: false,
        });

        this.skyMesh = new THREE.Mesh(geometry, material);
        this.skyMesh.name = 'skyDome';
        this.skyMesh.renderOrder = -1000;
        this.skyMesh.frustumCulled = false;
        this.skyMesh.matrixAutoUpdate = false;
        this.skyMesh.onBeforeRender = (renderer, scene, camera) => this._followCamera(this.skyMesh, camera);
        this.scene.add(this.skyMesh);
    }

    _followCamera(obj, camera) {
        obj.position.copy(camera.position);
        obj.updateMatrix();
        obj.matrixWorld.copy(obj.matrix);
        // modelViewMatrix is computed right after onBeforeRender from matrixWorld
    }

    /* ------------------------------------------------------------ */
    /* Clouds                                                        */
    /* ------------------------------------------------------------ */

    _paintCloudAtlas() {
        const W = 1024, H = 512, CW = 512, CH = 256;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        let s = 1337;
        const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };

        for (let cell = 0; cell < 4; cell++) {
            const ox = (cell % 2) * CW;
            const oy = Math.floor(cell / 2) * CH;
            ctx.save();
            ctx.beginPath();
            ctx.rect(ox, oy, CW, CH);
            ctx.clip();

            const base = oy + CH * (0.74 + rnd() * 0.06);   // flat bottom line
            const puffs = [];
            const n = 9 + Math.floor(rnd() * 6);
            for (let i = 0; i < n; i++) {
                const t = (i + 0.5) / n;
                const cx = ox + CW * (0.12 + 0.76 * t + (rnd() - 0.5) * 0.06);
                const bell = Math.sin(Math.PI * t);
                const r = CH * (0.12 + 0.2 * bell * (0.6 + rnd() * 0.6));
                const cy = base - r * (0.35 + rnd() * 0.5) - bell * CH * 0.08 * rnd();
                puffs.push({ cx, cy, r });
            }
            // a few small top puffs for a cauliflower crown
            for (let i = 0; i < 4; i++) {
                const p = puffs[2 + Math.floor(rnd() * (puffs.length - 4))];
                puffs.push({ cx: p.cx + (rnd() - 0.5) * p.r, cy: p.cy - p.r * (0.5 + rnd() * 0.3), r: p.r * (0.45 + rnd() * 0.25) });
            }
            puffs.sort((a, b) => b.cy - a.cy); // lower puffs first, crowns on top

            // Pass 1: lit puffs. Highlight centre offset up toward the light.
            for (const p of puffs) {
                const g = ctx.createRadialGradient(p.cx - p.r * 0.15, p.cy - p.r * 0.45, p.r * 0.05, p.cx, p.cy, p.r);
                g.addColorStop(0, 'rgba(255,255,255,1)');
                g.addColorStop(0.55, 'rgba(214,214,214,1)');
                g.addColorStop(0.86, 'rgba(160,160,160,0.75)');
                g.addColorStop(1, 'rgba(150,150,150,0)');
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
                ctx.fill();
            }

            // Pass 2: shade the underside (keeps alpha)
            ctx.globalCompositeOperation = 'source-atop';
            const shade = ctx.createLinearGradient(0, base - CH * 0.35, 0, base);
            shade.addColorStop(0, 'rgba(70,70,70,0)');
            shade.addColorStop(1, 'rgba(70,70,70,0.65)');
            ctx.fillStyle = shade;
            ctx.fillRect(ox, oy, CW, CH);

            // Pass 3: flat, soft bottom edge
            ctx.globalCompositeOperation = 'destination-out';
            const cut = ctx.createLinearGradient(0, base - 6, 0, base + 10);
            cut.addColorStop(0, 'rgba(0,0,0,0)');
            cut.addColorStop(1, 'rgba(0,0,0,1)');
            ctx.fillStyle = cut;
            ctx.fillRect(ox, base - 6, CW, CH);
            ctx.restore();
            ctx.globalCompositeOperation = 'source-over';
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.NoColorSpace; // data texture: r = light, a = coverage
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = 4;
        return tex;
    }

    createClouds() {
        let s = 4242;
        const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };

        const cards = [];
        // Banks low over the distant ranges + a few higher wisps
        const count = 26;
        for (let i = 0; i < count; i++) {
            const ang = (i / count) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
            const high = i % 4 === 0;
            const dist = high ? 2600 + rnd() * 2600 : 4400 + rnd() * 2600;
            const w = high ? 900 + rnd() * 700 : 1500 + rnd() * 1500;
            cards.push({
                x: Math.cos(ang) * dist,
                z: Math.sin(ang) * dist,
                y: high ? 2300 + rnd() * 900 : 1100 + rnd() * 700,
                w,
                h: w * (0.42 + rnd() * 0.12),
                tile: Math.floor(rnd() * 4),
                flip: rnd() < 0.5 ? -1 : 1,
                drift: 6 + rnd() * 10,
                alpha: high ? 0.55 : 0.85,
            });
        }
        cards.sort((a, b) => Math.hypot(b.x, b.z) - Math.hypot(a.x, a.z)); // far to near

        const vCount = cards.length * 4;
        const corner = new Float32Array(vCount * 2);
        const center = new Float32Array(vCount * 3);
        const data = new Float32Array(vCount * 4);   // w, h, drift, alpha
        const tile = new Float32Array(vCount * 2);   // tile index, flip
        const index = [];
        const corners = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]];
        cards.forEach((c, i) => {
            for (let k = 0; k < 4; k++) {
                const v = i * 4 + k;
                corner[v * 2] = corners[k][0];
                corner[v * 2 + 1] = corners[k][1];
                center[v * 3] = c.x; center[v * 3 + 1] = c.y; center[v * 3 + 2] = c.z;
                data[v * 4] = c.w; data[v * 4 + 1] = c.h; data[v * 4 + 2] = c.drift; data[v * 4 + 3] = c.alpha;
                tile[v * 2] = c.tile; tile[v * 2 + 1] = c.flip;
            }
            const b = i * 4;
            index.push(b, b + 1, b + 2, b, b + 2, b + 3);
        });

        const geo = new THREE.BufferGeometry();
        // 'position' is required by three; the shader uses aCorner/aCenter
        geo.setAttribute('position', new THREE.BufferAttribute(center, 3));
        geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
        geo.setAttribute('aData', new THREE.BufferAttribute(data, 4));
        geo.setAttribute('aTile', new THREE.BufferAttribute(tile, 2));
        geo.setIndex(index);

        const material = new THREE.ShaderMaterial({
            name: 'PaintedClouds',
            uniforms: {
                uTex: { value: this._paintCloudAtlas() },
                uTime: { value: 0 },
                uCamPos: { value: new THREE.Vector3() },
                uField: { value: CLOUD_FIELD },
                uLit: { value: DAY.cloudLit.clone() },
                uShade: { value: DAY.cloudShade.clone() },
                uSunDir: { value: this.sunDirection.clone() },
                uSunGlow: { value: DAY.sunGlow.clone() },
                uFogColor: { value: this.fogColor.clone() },
                uOpacity: { value: 1 },
                uNight: { value: 0 },
            },
            vertexShader: /* glsl */`
                attribute vec2 aCorner;
                attribute vec4 aData;
                attribute vec2 aTile;
                uniform float uTime;
                uniform vec3 uCamPos;
                uniform float uField;
                varying vec2 vUv;
                varying float vAlpha;
                varying vec3 vWorld;
                varying float vDist;
                void main() {
                    vec3 c = position;
                    // drift: slow orbit around the camera (distance stays constant)
                    float dist = length(c.xz);
                    float th = uTime * aData.z / max(dist, 1.0);
                    float cs = cos(th), sn = sin(th);
                    c.xz = vec2(c.x * cs - c.z * sn, c.x * sn + c.z * cs);
                    vec3 center = vec3(uCamPos.x + c.x, c.y, uCamPos.z + c.z);

                    // cylindrical billboard (stays upright)
                    vec3 toCam = uCamPos - center;
                    vec3 fwd = normalize(vec3(toCam.x, 0.0, toCam.z) + vec3(1e-4, 0.0, 0.0));
                    vec3 right = vec3(fwd.z, 0.0, -fwd.x);
                    vec3 wp = center + right * aCorner.x * aData.x + vec3(0.0, 1.0, 0.0) * (aCorner.y - 0.25) * aData.y;

                    float tileIdx = aTile.x;
                    vec2 cell = vec2(mod(tileIdx, 2.0), floor(tileIdx / 2.0));
                    float u = aCorner.x * aTile.y + 0.5;
                    vUv = (cell + vec2(u, 1.0 - aCorner.y)) * 0.5;
                    vUv.y = 1.0 - vUv.y;

                    // clouds are sky scenery: hide the ones seen from above
                    // (editor camera is high) so they never veil the resort
                    vec3 toCloud = normalize(center + vec3(0.0, aData.y * 0.25, 0.0) - uCamPos);
                    vAlpha = aData.w * smoothstep(-0.02, 0.06, toCloud.y);
                    vWorld = wp;
                    vDist = dist;
                    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                uniform sampler2D uTex;
                uniform vec3 uLit;
                uniform vec3 uShade;
                uniform vec3 uSunDir;
                uniform vec3 uSunGlow;
                uniform vec3 uFogColor;
                uniform vec3 uCamPos;
                uniform float uOpacity;
                uniform float uNight;
                varying vec2 vUv;
                varying float vAlpha;
                varying vec3 vWorld;
                varying float vDist;
                void main() {
                    vec4 t = texture2D(uTex, vUv);
                    float a = t.a * vAlpha * uOpacity;
                    if (a < 0.004) discard;
                    float lit = smoothstep(0.3, 1.0, t.r);
                    vec3 col = mix(uShade, uLit, lit);
                    vec3 v = normalize(vWorld - uCamPos);
                    float toSun = max(dot(v, normalize(uSunDir)), 0.0);
                    // silver lining when looking toward the sun, strongest on thin edges
                    col += uSunGlow * pow(toSun, 6.0) * (1.0 - t.a * 0.7) * 0.9 * (1.0 - uNight);
                    // aerial perspective toward the haze colour
                    float fogF = smoothstep(2500.0, 8000.0, vDist);
                    col = mix(col, uFogColor, fogF * 0.55);
                    gl_FragColor = vec4(col, a);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }
            `,
            transparent: true,
            depthWrite: false,
            fog: false,
        });

        this.cloudMesh = new THREE.Mesh(geo, material);
        this.cloudMesh.name = 'clouds';
        this.cloudMesh.frustumCulled = false;
        this.cloudMesh.renderOrder = -10;
        this.cloudMesh.onBeforeRender = (renderer, scene, camera) => {
            material.uniforms.uCamPos.value.copy(camera.position);
        };
        this.scene.add(this.cloudMesh);
        this.clouds = [this.cloudMesh];
    }

    /* ------------------------------------------------------------ */
    /* Stars                                                         */
    /* ------------------------------------------------------------ */

    createStarField() {
        const starCount = 1800;
        const positions = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const phases = new Float32Array(starCount);
        const tints = new Float32Array(starCount);

        for (let i = 0; i < starCount; i++) {
            const theta = Math.random() * Math.PI * 2;
            // bias toward the zenith a bit less than uniform; avoid the horizon
            const y = 0.04 + Math.pow(Math.random(), 0.8) * 0.96;
            const rxz = Math.sqrt(1 - y * y);
            positions[i * 3] = STAR_RADIUS * rxz * Math.cos(theta);
            positions[i * 3 + 1] = STAR_RADIUS * y;
            positions[i * 3 + 2] = STAR_RADIUS * rxz * Math.sin(theta);
            const bright = Math.random() < 0.06;
            sizes[i] = bright ? 2.6 + Math.random() * 1.8 : 1.0 + Math.random() * 1.3;
            phases[i] = Math.random() * Math.PI * 2;
            tints[i] = Math.random();
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('tint', new THREE.BufferAttribute(tints, 1));

        const material = new THREE.ShaderMaterial({
            name: 'Stars',
            uniforms: {
                time: { value: 0 },
                uOpacity: { value: 0 },
                uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
            },
            vertexShader: /* glsl */`
                attribute float size;
                attribute float phase;
                attribute float tint;
                uniform float time;
                uniform float uPixelRatio;
                varying float vAlpha;
                varying vec3 vColor;
                void main() {
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * 1.6 * uPixelRatio;
                    vAlpha = 0.65 + 0.35 * sin(time * (1.1 + tint) + phase);
                    float horizonFade = smoothstep(0.02, 0.18, position.y / ${STAR_RADIUS.toFixed(1)});
                    vAlpha *= horizonFade;
                    vColor = mix(vec3(0.75, 0.84, 1.0), vec3(1.0, 0.9, 0.78), step(0.8, tint));
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: /* glsl */`
                uniform float uOpacity;
                varying float vAlpha;
                varying vec3 vColor;
                void main() {
                    float d = length(gl_PointCoord - vec2(0.5));
                    if (d > 0.5) discard;
                    float core = smoothstep(0.5, 0.0, d);
                    float a = core * core * vAlpha * uOpacity;
                    gl_FragColor = vec4(vColor * 1.6, a);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            fog: false,
        });

        this.starField = new THREE.Points(geometry, material);
        this.starField.name = 'stars';
        this.starField.visible = false;
        this.starField.frustumCulled = false;
        this.starField.renderOrder = -900;
        this.starField.matrixAutoUpdate = false;
        this.starField.onBeforeRender = (renderer, scene, camera) => this._followCamera(this.starField, camera);
        this.scene.add(this.starField);
    }

    /* ------------------------------------------------------------ */
    /* Environment hooks                                             */
    /* ------------------------------------------------------------ */

    setSunDirection(dir) {
        if (!dir) return;
        this.sunDirection.copy(dir).normalize();
        if (this.skyMesh) this.skyMesh.material.uniforms.uSunDir.value.copy(this.sunDirection);
        if (this.cloudMesh) this.cloudMesh.material.uniforms.uSunDir.value.copy(this.sunDirection);
    }

    setMoonDirection(dir) {
        if (!dir) return;
        this.moonDirection.copy(dir).normalize();
        if (this.skyMesh) this.skyMesh.material.uniforms.uMoonDir.value.copy(this.moonDirection);
    }

    /** Fog colour (linear) so the horizon band matches the fog exactly. */
    setFogColor(color) {
        this.fogColor.copy(color);
        if (this.skyMesh) this.skyMesh.material.uniforms.uFogColor.value.copy(color);
        if (this.cloudMesh) this.cloudMesh.material.uniforms.uFogColor.value.copy(color);
    }

    /** night, blizzard: 0..1 */
    applyBlend(night, blizzard = 0) {
        this.nightAmount = night;
        this.blizzardAmount = blizzard;
        if (!this.skyMesh) return;
        const u = this.skyMesh.material.uniforms;
        u.uZenith.value.copy(DAY.zenith).lerp(NIGHT.zenith, night);
        u.uMid.value.copy(DAY.mid).lerp(NIGHT.mid, night);
        u.uHorizonCool.value.copy(DAY.horizonCool).lerp(NIGHT.horizonCool, night);
        u.uHorizonWarm.value.copy(DAY.horizonWarm).lerp(NIGHT.horizonWarm, night);
        u.uNight.value = night;
        u.uBlizzard.value = blizzard;
        u.uBlizzardColor.value.copy(BLIZZARD.sky).lerp(BLIZZARD.nightSky, night);
        u.uSunVis.value = Math.pow(1 - night, 1.5);

        if (this.cloudMesh) {
            const cu = this.cloudMesh.material.uniforms;
            cu.uLit.value.copy(DAY.cloudLit).lerp(NIGHT.cloudLit, night);
            cu.uShade.value.copy(DAY.cloudShade).lerp(NIGHT.cloudShade, night);
            _c1.copy(BLIZZARD.sky).lerp(BLIZZARD.nightSky, night);
            cu.uLit.value.lerp(_c1, blizzard * 0.6);
            _c2.copy(cu.uShade.value);
            cu.uShade.value.lerp(_c1, blizzard * 0.4);
            cu.uNight.value = night;
            cu.uOpacity.value = THREE.MathUtils.lerp(1, 0.55, night) * (1 - blizzard * 0.5);
        }

        if (this.starField) {
            const op = Math.max(0, (night - 0.25) / 0.75) * (1 - blizzard * 0.9);
            this.starField.material.uniforms.uOpacity.value = op;
            this.starField.visible = op > 0.001;
        }
    }

    setNightMode(enabled) {
        this.isNight = !!enabled;
        this.applyBlend(enabled ? 1 : 0, this.blizzardAmount);
    }

    /** Animate clouds, stars and aurora. camera is optional (meshes follow the render camera anyway). */
    update(delta, camera) {
        if (camera) this.camera = camera;
        this.time += delta;
        if (this.skyMesh) this.skyMesh.material.uniforms.uTime.value = this.time;
        if (this.cloudMesh) this.cloudMesh.material.uniforms.uTime.value = this.time;
        if (this.starField && this.starField.visible) {
            this.starField.material.uniforms.time.value = this.time;
        }
    }
}
