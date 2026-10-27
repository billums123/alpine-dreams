/**
 * ObjectPlacer - placing, selecting and manipulating resort objects.
 *
 * Public API (kept): constructor(scene, camera, domElement, mountain),
 * setPlacementMode(type): displayName, cancelPlacement(), clearAll(),
 * autoGenerate(), generateTrickPark(), update(delta), placedObjects[]
 * ({type, object, data?, footprint?}), mode, selectedObject, deleteSelected().
 *
 * Additions: setNightMode(enabled), brush (BrushCursor), undo() (Ctrl/Cmd+Z),
 * events: place:mode / place:object / place:lift-start / place:lift-preview /
 * place:select / place:remove / place:invalid (+ place:pop, place:undo,
 * place:generate for audio juice).
 *
 * Feel: glassy holographic ghost (glacier blue = valid, coral = invalid) that
 * bobs over a soft footprint ring; pop-in (easeOutBack-ish 0 -> 1.08 -> 1) with
 * a pooled snow-puff burst; shrink + poof on delete; pulsing selection ring and
 * thin hover ring; live lift preview (catenary cable + ghost towers).
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SkiLift } from '../objects/SkiLift.js';
import { Lodge } from '../objects/Lodge.js';
import { Decorations } from '../objects/Decorations.js';
import { BrushCursor } from './BrushCursor.js';
import { events } from '../core/events.js';
import { nightFader } from '../objects/StructureKit.js';

const TYPE_NAMES = {
    'ski-lift': 'Ski Lift',
    'gondola': 'Gondola',
    'lodge': 'Lodge',
    'pine-tree': 'Pine Tree',
    'flag': 'Marker Flag',
    'snowman': 'Snowman',
    'jump': 'Snow Jump',
    'bench': 'Bench',
    'ski-rack': 'Ski Rack',
    'snow-pile': 'Snow Pile',
};

const COLOR_VALID = new THREE.Color('#7CC4FF');
const COLOR_INVALID = new THREE.Color('#FF7A7A');
const COLOR_SELECT = new THREE.Color('#7CC4FF');
const COLOR_HOVER = new THREE.Color('#DDEEFF');

const MAX_SLOPE = { lodge: 0.2, default: 0.38 }; // 1 - normal.y
const LIFT_MIN_LENGTH = 25;
const TOWER_SPACING = 30;          // matches SkiLift.createLift intermediate tower spacing
const MAX_GHOST_TOWERS = 160;
const CABLE_POINTS = 256;
const PUFF_POOL = 512;
const UNDO_LIMIT = 20;

const isLift = (t) => t === 'ski-lift' || t === 'gondola';

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------
function popCurve(t) {
    // 0 -> 1.08 (easeOutCubic over 70%) -> 1 (easeInOutSine over 30%)
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    if (t < 0.7) {
        const u = t / 0.7;
        return 1.08 * (1 - Math.pow(1 - u, 3));
    }
    const u = (t - 0.7) / 0.3;
    return 1.08 - 0.08 * (0.5 - 0.5 * Math.cos(Math.PI * u));
}
function shrinkCurve(t) {
    // 1 -> 1.07 -> 0 (easeInBack-like)
    if (t <= 0) return 1;
    if (t >= 1) return 0;
    if (t < 0.25) return 1 + 0.07 * Math.sin((t / 0.25) * Math.PI * 0.5);
    const u = (t - 0.25) / 0.75;
    return 1.07 * (1 - u * u);
}

// ---------------------------------------------------------------------------
// Shared materials
// ---------------------------------------------------------------------------
function createGhostMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: COLOR_VALID.clone() },
            uOpacity: { value: 1 },
            uTime: { value: 0 },
            uFlash: { value: 0 },
        },
        vertexShader: /* glsl */`
            varying vec3 vNormalV;
            varying vec3 vViewDir;
            varying float vWorldY;
            void main() {
                vec4 p = vec4(position, 1.0);
                vec3 n = normal;
                #ifdef USE_INSTANCING
                    p = instanceMatrix * p;
                    n = mat3(instanceMatrix) * n;
                #endif
                vec4 wp = modelMatrix * p;
                vWorldY = wp.y;
                vec4 mv = viewMatrix * wp;
                vNormalV = normalize(normalMatrix * n);
                vViewDir = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
            }
        `,
        fragmentShader: /* glsl */`
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uTime;
            uniform float uFlash;
            varying vec3 vNormalV;
            varying vec3 vViewDir;
            varying float vWorldY;
            void main() {
                vec3 n = normalize(vNormalV);
                if (!gl_FrontFacing) n = -n;
                float fres = pow(1.0 - clamp(abs(dot(n, normalize(vViewDir))), 0.0, 1.0), 2.2);
                float shade = 0.62 + 0.38 * clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
                float scan = 1.0 - smoothstep(0.0, 0.07, abs(fract(vWorldY * 0.22 - uTime * 0.45) - 0.5));
                vec3 col = uColor * shade + uColor * fres * 0.9 + vec3(1.0) * (fres * 0.25 + scan * 0.18 + uFlash * 0.5);
                float a = (0.42 + 0.55 * fres + scan * 0.12 + uFlash * 0.3) * uOpacity;
                gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
            }
        `,
        transparent: true,
        depthWrite: true,
        side: THREE.FrontSide,
        fog: false,
        toneMapped: false,
    });
}

function createRingMaterial(color, { opacity = 1, dash = 0, fill = 0.22 } = {}) {
    return new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: color.clone() },
            uOpacity: { value: opacity },
            uTime: { value: 0 },
            uDash: { value: dash },
            uFill: { value: fill },
            uWidth: { value: 0.12 },
        },
        vertexShader: /* glsl */`
            varying vec2 vUv;
            void main() {
                vUv = uv * 2.0 - 1.0;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */`
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uTime;
            uniform float uDash;
            uniform float uFill;
            uniform float uWidth;
            varying vec2 vUv;
            void main() {
                float d = length(vUv);
                if (d > 1.0) discard;
                float aa = fwidth(d) * 1.5;
                float outer = 1.0 - smoothstep(1.0 - aa, 1.0, d);
                float band = smoothstep(1.0 - uWidth - aa, 1.0 - uWidth, d) * outer;
                float ang = atan(vUv.y, vUv.x);
                float dashes = mix(1.0, smoothstep(0.3, 0.36, fract(ang * 5.7296 + uTime * 0.35)), uDash);
                float fillA = (1.0 - d) * (1.0 - d) * uFill + smoothstep(0.55, 1.0, d) * uFill * 0.6;
                float a = (band * dashes + fillA * outer) * uOpacity;
                gl_FragColor = vec4(uColor, a);
            }
        `,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: false,
        extensions: { derivatives: true },
    });
}

// ---------------------------------------------------------------------------
// Snow puff particle pool (one draw call, GPU-animated)
// ---------------------------------------------------------------------------
class PuffPool {
    constructor(scene, size = PUFF_POOL) {
        this.size = size;
        this.cursor = 0;
        this.time = 0;
        const g = new THREE.BufferGeometry();
        this.start = new Float32Array(size * 3);
        this.vel = new Float32Array(size * 3);
        this.birth = new Float32Array(size).fill(-1000);
        this.sizes = new Float32Array(size);
        g.setAttribute('position', new THREE.BufferAttribute(this.start, 3));
        g.setAttribute('aVel', new THREE.BufferAttribute(this.vel, 3));
        g.setAttribute('aBirth', new THREE.BufferAttribute(this.birth, 1));
        g.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uLife: { value: 1.3 },
                uScale: { value: 450 },
                uColor: { value: new THREE.Color('#FFF8EF') },
                uShade: { value: new THREE.Color('#9DB2D0') },
            },
            vertexShader: /* glsl */`
                attribute vec3 aVel;
                attribute float aBirth;
                attribute float aSize;
                uniform float uTime;
                uniform float uLife;
                uniform float uScale;
                varying float vAlpha;
                varying float vT;
                void main() {
                    float age = uTime - aBirth;
                    float t = age / uLife;
                    if (age < 0.0 || t > 1.0) {
                        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                        gl_PointSize = 0.0;
                        vAlpha = 0.0;
                        return;
                    }
                    float k = 3.2;
                    float drift = (1.0 - exp(-k * age)) / k;
                    vec3 p = position + aVel * drift + vec3(0.0, -1.2 * age * age, 0.0);
                    vec4 mv = modelViewMatrix * vec4(p, 1.0);
                    float s = aSize * (0.55 + 1.1 * sqrt(t));
                    // Pull each sprite toward the camera by ~its radius so the
                    // billboard is not swallowed by the slope it sits on.
                    mv.xyz += normalize(-mv.xyz) * min(s * 0.7, -mv.z * 0.5);
                    gl_Position = projectionMatrix * mv;
                    gl_PointSize = clamp(s * uScale / max(1.0, -mv.z), 0.0, 96.0);
                    vAlpha = smoothstep(0.0, 0.06, age) * pow(1.0 - t, 1.6);
                    vT = t;
                }
            `,
            fragmentShader: /* glsl */`
                uniform vec3 uColor;
                uniform vec3 uShade;
                varying float vAlpha;
                varying float vT;
                void main() {
                    vec2 c = gl_PointCoord * 2.0 - 1.0;
                    float d = dot(c, c);
                    if (d > 1.0) discard;
                    float soft = 1.0 - d;
                    vec3 col = mix(uShade, uColor, clamp(0.1 + soft * 0.85 - c.y * 0.4, 0.0, 1.0));
                    gl_FragColor = vec4(col, smoothstep(0.0, 0.6, soft) * vAlpha * 0.9);
                }
            `,
            transparent: true,
            depthWrite: false,
            fog: false,
        });
        this.points = new THREE.Points(g, this.material);
        this.points.frustumCulled = false;
        this.points.renderOrder = 15;
        this.points.name = 'placementPuffs';
        scene.add(this.points);
    }

    /** Burst of `count` puffs at (x,y,z); `radius` scales spread and size. */
    emit(x, y, z, radius = 3, count = 18, { up = 1 } = {}) {
        const r = Math.max(0.6, radius);
        for (let i = 0; i < count; i++) {
            const k = this.cursor;
            this.cursor = (this.cursor + 1) % this.size;
            const a = Math.random() * Math.PI * 2;
            const rr = r * (0.3 + Math.random() * 0.6);
            this.start[k * 3] = x + Math.cos(a) * rr * 0.4;
            this.start[k * 3 + 1] = y + 0.5 + Math.random() * r * 0.2;
            this.start[k * 3 + 2] = z + Math.sin(a) * rr * 0.4;
            const sp = r * (1.6 + Math.random() * 1.8);
            this.vel[k * 3] = Math.cos(a) * sp;
            this.vel[k * 3 + 1] = (0.6 + Math.random() * 1.6) * r * up;
            this.vel[k * 3 + 2] = Math.sin(a) * sp;
            this.birth[k] = this.time + Math.random() * 0.05;
            this.sizes[k] = r * (0.5 + Math.random() * 0.6);
        }
        const g = this.points.geometry;
        g.attributes.position.needsUpdate = true;
        g.attributes.aVel.needsUpdate = true;
        g.attributes.aBirth.needsUpdate = true;
        g.attributes.aSize.needsUpdate = true;
    }

    update(delta, viewportHeight, fovDeg) {
        this.time += delta;
        this.material.uniforms.uTime.value = this.time;
        // Projected size: px = size * (h / (2*tan(fov/2))) / depth
        const f = (viewportHeight || 900) / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg || 50) / 2));
        this.material.uniforms.uScale.value = f;
    }

    setNight(night) {
        this.material.uniforms.uColor.value.set(night ? '#C9D6F2' : '#FFF8EF');
        this.material.uniforms.uShade.value.set(night ? '#5E6F9E' : '#9DB2D0');
    }
}

// ---------------------------------------------------------------------------
// ObjectPlacer
// ---------------------------------------------------------------------------
function _uiModalOpen() {
    const b = document.body;
    if (b.classList.contains('title-open') || b.classList.contains('photo-mode')) return true;
    const sheet = document.getElementById('shortcuts-sheet');
    if (sheet && !sheet.classList.contains('hidden')) return true;
    return !!document.querySelector('.popover:not(.hidden)');
}

export class ObjectPlacer {
    constructor(scene, camera, domElement, mountain) {
        this.scene = scene;
        this.camera = camera;
        this.domElement = domElement;
        this.mountain = mountain;

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // State
        this.mode = 'select'; // 'select' | 'place'
        this.currentObjectType = null;
        this.previewObject = null;
        this.selectedObject = null;
        this.hoveredObject = null;
        this.placedObjects = [];
        this.isNight = false;
        this.skiing = false;

        // Factories
        this.skiLift = new SkiLift(scene, mountain);
        this.lodge = new Lodge(scene, mountain);
        this.decorations = new Decorations(scene, mountain);

        // Lift placement state
        this.liftStartPoint = null;
        this.liftPreviewLine = null; // kept for back-compat (now the catenary cable line)

        // Ghost + feedback visuals
        this.ghostMaterial = createGhostMaterial();
        this.ghostCache = new Map(); // type -> { object, footprint, height }
        this.ghostGround = new THREE.Vector3();
        this.ghostValid = true;
        this.ghostVisible = false;
        this.ghostReason = null;
        this.ghostSquash = 1;
        this.ghostShake = 0;
        this.userPitch = 0;
        this.time = 0;
        this._ghostColor = COLOR_VALID.clone();

        const ringGeo = new THREE.PlaneGeometry(2, 2);
        ringGeo.rotateX(-Math.PI / 2);
        this.footprintRing = new THREE.Mesh(ringGeo, createRingMaterial(COLOR_VALID, { opacity: 0.9, fill: 0.28 }));
        this.selectRing = new THREE.Mesh(ringGeo, createRingMaterial(COLOR_SELECT, { opacity: 1, dash: 1, fill: 0.18 }));
        this.hoverRing = new THREE.Mesh(ringGeo, createRingMaterial(COLOR_HOVER, { opacity: 0.7, fill: 0.05 }));
        this.hoverRing.material.uniforms.uWidth.value = 0.05;
        this.selectRing.material.uniforms.uWidth.value = 0.075;
        [this.footprintRing, this.selectRing, this.hoverRing].forEach((m, i) => {
            m.visible = false;
            m.renderOrder = 5 + i;
            m.frustumCulled = false;
            m.name = 'placementRing';
            this.scene.add(m);
        });

        this.puffs = new PuffPool(scene);

        // Ground shockwave ripples (pooled)
        this.ripples = [];
        for (let i = 0; i < 6; i++) {
            const r = new THREE.Mesh(ringGeo, createRingMaterial(new THREE.Color('#FFFFFF'), { opacity: 0, fill: 0.0 }));
            r.material.uniforms.uWidth.value = 0.09;
            r.visible = false;
            r.renderOrder = 4;
            r.frustumCulled = false;
            r.userData.t = 1;
            this.scene.add(r);
            this.ripples.push(r);
        }
        this._rippleCursor = 0;

        // Lift preview (ghost towers + catenary cable + start marker)
        this._buildLiftPreview();

        // Animations: { object, t, dur, delay, base: Vector3, kind:'in'|'out', onStart?, onDone? }
        this.anims = [];
        this.selectionClones = new Map(); // mesh -> original material

        // Undo
        this.undoStack = [];
        this._pendingDispose = [];
        this._lastSkiTick = 0;

        // Hover throttling
        this._mouseDirty = false;
        this._hoverTimer = 0;
        this._liftPreviewTimer = 0;
        this._lastLiftLen = 0;
        this._selectables = null; // cached flat array for raycasting

        // Sculpt brush (driven by UI)
        this.brush = new BrushCursor(scene, mountain);

        // Scratch
        this._v1 = new THREE.Vector3();
        this._v2 = new THREE.Vector3();
        this._q = new THREE.Quaternion();
        this._m = new THREE.Matrix4();
        this._up = new THREE.Vector3(0, 1, 0);
        this._box = new THREE.Box3();

        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
        this.setupEvents();

        this._unsubs = [
            events.on('ski:start', () => {
                this.skiing = true;
                if (this.mode === 'place') this.cancelPlacement();
                this.clearSelection();
                this._setHover(null);
            }),
            events.on('ski:end', () => { this.skiing = false; }),
            events.on('ski:tick', () => { this._lastSkiTick = this.time; }),
        ];
        this._createBeacons();
    }

    // =====================================================================
    // Distance beacons: lodges and lift stations shrink to sub-pixel at editor
    // distance. A screen-space marker (soft warm dot by day, a bloomed lamp at
    // night) keeps the resort readable from far away and fades out up close.
    // =====================================================================
    _createBeacons() {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
        geo.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(1), 1));
        geo.setDrawRange(0, 0);
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uNight: { value: 0 },
                uPx: { value: 1 },
            },
            vertexShader: /* glsl */`
                attribute float aKind;
                uniform float uNight;
                uniform float uPx;
                varying float vFade;
                varying float vKind;
                void main() {
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    float d = -mv.z;
                    vFade = smoothstep(260.0, 900.0, d);
                    vKind = aKind;
                    float base = mix(7.0, 15.0, uNight) * (aKind > 0.5 ? 1.0 : 0.8);
                    gl_PointSize = base * uPx * vFade;
                    gl_Position = projectionMatrix * mv;
                }`,
            fragmentShader: /* glsl */`
                uniform float uNight;
                varying float vFade;
                varying float vKind;
                void main() {
                    vec2 c = gl_PointCoord - 0.5;
                    float r = length(c) * 2.0;
                    if (r > 1.0) discard;
                    // day: crisp warm pin with a light rim; night: soft HDR lamp
                    vec3 dayCol = mix(vec3(1.0, 0.52, 0.24), vec3(0.98, 0.98, 1.0), smoothstep(0.55, 0.75, r));
                    float dayA = 1.0 - smoothstep(0.85, 1.0, r);
                    vec3 nightCol = vec3(1.0, 0.72, 0.38) * (0.6 + 2.6 * pow(1.0 - r, 3.0));
                    float nightA = pow(1.0 - r, 1.6);
                    vec3 col = mix(dayCol, nightCol, uNight);
                    float a = mix(dayA * 0.92, nightA, uNight) * vFade;
                    if (a < 0.01) discard;
                    gl_FragColor = vec4(col, a);
                }`,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            fog: false,
        });
        const pts = new THREE.Points(geo, mat);
        pts.name = 'resortBeacons';
        pts.frustumCulled = false;
        pts.renderOrder = 3;
        pts.userData.isDecal = true;
        pts.raycast = () => {};
        nightFader.register(mat, 'uniform', 0, 1);
        this.scene.add(pts);
        this._beacons = pts;
        this._beaconSig = -1;
        this._beaconBox = new THREE.Box3();
    }

    _rebuildBeacons() {
        const pts = this._beacons;
        if (!pts) return;
        const anchors = [];
        for (const e of this.placedObjects) {
            if (!e || !e.object || !e.object.parent) continue;
            if (isLift(e.type) && e.data && e.data.start && e.data.end) {
                anchors.push(e.data.start.x, e.data.start.y + 7, e.data.start.z, 1);
                anchors.push(e.data.end.x, e.data.end.y + 7, e.data.end.z, 1);
            } else if (e.type === 'lodge') {
                const b = this._beaconBox.setFromObject(e.object);
                if (b.isEmpty()) continue;
                anchors.push((b.min.x + b.max.x) / 2, b.max.y + 3, (b.min.z + b.max.z) / 2, 0);
            }
        }
        const n = anchors.length / 4;
        const geo = pts.geometry;
        let posAttr = geo.attributes.position;
        let kindAttr = geo.attributes.aKind;
        if (posAttr.count < n) {
            posAttr = new THREE.BufferAttribute(new Float32Array(Math.max(8, n * 2) * 3), 3);
            kindAttr = new THREE.BufferAttribute(new Float32Array(Math.max(8, n * 2)), 1);
            geo.setAttribute('position', posAttr);
            geo.setAttribute('aKind', kindAttr);
        }
        for (let i = 0; i < n; i++) {
            posAttr.array[i * 3] = anchors[i * 4];
            posAttr.array[i * 3 + 1] = anchors[i * 4 + 1];
            posAttr.array[i * 3 + 2] = anchors[i * 4 + 2];
            kindAttr.array[i] = anchors[i * 4 + 3];
        }
        posAttr.needsUpdate = true;
        kindAttr.needsUpdate = true;
        geo.setDrawRange(0, n);
    }

    setupEvents() {
        this.domElement.addEventListener('mousemove', this.onMouseMove);
        this.domElement.addEventListener('mousedown', this.onMouseDown);
        // Touch / pen: place or select on a tap, so a one-finger drag still orbits
        // and two fingers still pinch. A mouse keeps placing on press (above).
        this.domElement.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse') return;
            this._tap = e.isPrimary ? { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId } : null;
        });
        this.domElement.addEventListener('pointerup', (e) => {
            if (e.pointerType === 'mouse') return;
            this._lastTouch = performance.now();
            const st = this._tap;
            this._tap = null;
            if (!st || st.id !== e.pointerId) return;
            if (Math.hypot(e.clientX - st.x, e.clientY - st.y) > 12 || performance.now() - st.t > 600) return; // a drag
            this.onMouseMove(e); // move the ghost under the finger first
            this.onMouseDown(e);
        });
        this.domElement.addEventListener('mouseleave', () => {
            this.ghostVisible = false;
            this._setHover(null);
        });
        window.addEventListener('keydown', this.onKeyDown);
    }

    // =====================================================================
    // Placement mode
    // =====================================================================
    setPlacementMode(objectType) {
        this.clearSelection();
        this._setHover(null);
        this._hideLiftPreview();
        this.removePreview();

        this.mode = 'place';
        this.currentObjectType = objectType;
        this.liftStartPoint = null;
        this.userPitch = 0;
        this._lodgeYawSet = false;

        this.createPreview(objectType);
        document.body.classList.add('placing-mode');
        events.emit('place:mode', { active: true, type: objectType });

        return TYPE_NAMES[objectType] || objectType;
    }

    cancelPlacement() {
        const wasPlacing = this.mode === 'place';
        this.mode = 'select';
        this.currentObjectType = null;
        this.liftStartPoint = null;
        this.removePreview();
        this.removeLiftPreviewLine();
        document.body.classList.remove('placing-mode', 'placing-invalid');
        if (wasPlacing) events.emit('place:mode', { active: false, type: null });
    }

    /** Build (or fetch cached) ghost for a type. */
    _getGhost(type) {
        const key = isLift(type) ? 'lift-tower' : type;
        let g = this.ghostCache.get(key);
        if (g) return g;
        const obj = this._createRaw(key === 'lift-tower' ? 'lift-tower' : type);
        if (!obj) return null;
        const size = this._v1.copy(this._solidSize(obj));
        const footprint = Math.max(0.6, Math.max(size.x, size.z) * 0.5);
        const height = Math.max(0.5, size.y);
        this._applyGhost(obj);
        obj.userData.isPreview = true;
        obj.name = 'placementGhost';
        g = { object: obj, footprint, height, baseScale: obj.scale.clone() };
        this.ghostCache.set(key, g);
        return g;
    }

    _applyGhost(root) {
        root.traverse(child => {
            if (child.isMesh) {
                child.material = this.ghostMaterial;
                child.castShadow = false;
                child.receiveShadow = false;
                child.renderOrder = 10;
            } else if (child.isPoints || child.isLine || child.isSprite) {
                child.visible = false;
            }
        });
    }

    createPreview(objectType) {
        this.removePreview();
        const ghost = this._getGhost(objectType);
        if (!ghost) return;
        this.previewObject = ghost.object;
        this.previewInfo = ghost;
        this.previewObject.visible = false; // shown once the cursor hits terrain
        this.scene.add(this.previewObject);
        this.ghostVisible = false;
        // Re-run the hit test at the current mouse so the ghost appears immediately
        this._updateGhostFromMouse();
    }

    removePreview() {
        if (this.previewObject) {
            this.scene.remove(this.previewObject);
            this.previewObject = null;
            this.previewInfo = null;
        }
        this.footprintRing.visible = false;
        this.ghostVisible = false;
    }

    removeLiftPreviewLine() {
        this._hideLiftPreview();
    }

    /** Kept for compatibility: clones materials and sets opacity. */
    setObjectOpacity(object, opacity) {
        object.traverse(child => {
            if (child.isMesh && child.material) {
                child.material = child.material.clone();
                child.material.transparent = true;
                child.material.opacity = opacity;
            }
        });
    }

    // =====================================================================
    // Factories
    // =====================================================================
    _createRaw(type, opts = {}) {
        const d = this.decorations;
        switch (type) {
            case 'lift-tower': return this.skiLift.createTower();
            case 'lodge': return this.lodge.create(opts.variant || 'main');
            case 'pine-tree': return d.createTree(opts.variant);
            case 'flag': return d.createFlag(opts.color || 'red');
            case 'snowman': return d.createSnowman();
            case 'jump': return d.createJump();
            case 'bench': return typeof d.createBench === 'function' ? d.createBench() : null;
            case 'ski-rack': return typeof d.createSkiRack === 'function' ? d.createSkiRack() : null;
            case 'snow-pile': return typeof d.createSnowPile === 'function' ? d.createSnowPile() : null;
            default: return null;
        }
    }

    /**
     * Create, position, register and (optionally) animate a placed object.
     * Returns the placedObjects entry or null.
     */
    _spawn(type, x, z, { rotY = 0, tiltX = 0, tiltZ = 0, scale = 1, opts = {}, delay = 0, animate = true, silent = true, y = null } = {}) {
        const obj = this._createRaw(type, opts);
        if (!obj) return null;
        const h = y ?? this.mountain.getHeightAt(x, z);
        obj.position.set(x, h, z);
        obj.rotation.set(tiltX, rotY, tiltZ);
        if (scale !== 1) obj.scale.multiplyScalar(scale);
        obj.userData.type = type;
        obj.userData.placedObject = true;
        if (type === 'jump') obj.userData.isJump = true;
        if (!obj.parent) this.scene.add(obj);
        const entry = { type, object: obj, data: { position: obj.position.clone() } };
        entry.footprint = this._footprintOf(obj);
        this.placedObjects.push(entry);
        this._selectables = null;
        if (animate) this._popIn(entry, delay, silent);
        return entry;
    }

    _footprintOf(obj) {
        const s = this._solidSize(obj);
        return Math.max(0.5, Math.max(s.x, s.z) * 0.5);
    }

    /** Bounding size of an object's solid meshes (ignores glow sprites, smoke, light-pool decals). */
    _solidSize(obj) {
        obj.updateMatrixWorld(true);
        const box = this._box.makeEmpty();
        const tmp = this._tmpBox || (this._tmpBox = new THREE.Box3());
        obj.traverse(c => {
            if (!c.isMesh || c.isInstancedMesh) return;
            const m = Array.isArray(c.material) ? c.material[0] : c.material;
            if (m && m.transparent && (m.depthWrite === false || m.blending === THREE.AdditiveBlending)) return;
            if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
            tmp.copy(c.geometry.boundingBox).applyMatrix4(c.matrixWorld);
            box.union(tmp);
        });
        if (box.isEmpty()) this._box.setFromObject(obj);
        // Measure relative to the object's own position
        return this._box.getSize(this._v2);
    }

    // =====================================================================
    // Input
    // =====================================================================
    _setMouse(event) {
        const rect = this.domElement.getBoundingClientRect();
        const w = rect.width || window.innerWidth;
        const h = rect.height || window.innerHeight;
        this.mouse.x = ((event.clientX - rect.left) / w) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / h) * 2 + 1;
        this._hasMouse = true;
    }

    /** Mouse events a browser synthesizes after a tap (the tap was already handled). */
    _isCompatMouse(event) {
        return event.type.startsWith('mouse') && performance.now() - (this._lastTouch || 0) < 800;
    }

    /** Rotate the ghost or the selection 45° (the touch Rotate button; R on a keyboard). */
    rotateTarget(steps = 1) {
        const target = this.previewObject || (this.selectedObject && this.selectedObject.object);
        if (!target) return false;
        // Lifts are world-space groups at the origin; don't spin them around (0,0,0)
        if (!this.previewObject && isLift(this.selectedObject.type)) return false;
        if (this.previewObject && isLift(this.currentObjectType)) return false;
        target.rotation.y += steps * (Math.PI / 4);
        if (target === this.previewObject && this.currentObjectType === 'lodge') this._lodgeYawSet = true;
        return true;
    }

    onMouseMove(event) {
        if (this._isCompatMouse(event)) return;
        this._setMouse(event);
        this._mouseDirty = true;
        if (this.mode === 'place') this._updateGhostFromMouse();
    }

    _updateGhostFromMouse() {
        if (this.mode !== 'place' || !this.previewObject || !this._hasMouse) return;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const hit = this.mountain.raycast(this.raycaster);
        if (!hit) {
            this.ghostVisible = false;
            this.previewObject.visible = false;
            this.footprintRing.visible = false;
            this.ghostValid = false;
            this.ghostReason = 'Off the mountain';
            return;
        }
        const p = hit.point;
        this.ghostGround.copy(p);
        this.ghostVisible = true;
        this.previewObject.visible = true;

        const type = this.currentObjectType;
        if (['pine-tree', 'flag', 'snowman', 'jump', 'bench', 'ski-rack', 'snow-pile'].includes(type)) {
            const n = this.mountain.getNormalAt(p.x, p.z);
            const tilt = type === 'jump' ? 0.5 : 0.2;
            this.previewObject.rotation.x = -n.z * tilt + this.userPitch;
            this.previewObject.rotation.z = n.x * tilt;
        } else if (type === 'lodge' && !this._lodgeYawSet) {
            // Lodges default to facing up the slope (user arrows override)
            this.previewObject.rotation.y = this._uphillYaw(p.x, p.z);
        }

        const v = this._validate(type, p);
        this._setGhostValid(v.ok, v.reason);

        if (this.liftStartPoint && isLift(type)) this._updateLiftPreview(this.liftStartPoint, p);
    }

    _setGhostValid(ok, reason) {
        this.ghostValid = ok;
        this.ghostReason = ok ? null : reason;
        document.body.classList.toggle('placing-invalid', !ok);
    }

    onMouseDown(event) {
        if (event.button !== 0 || this._isCompatMouse(event)) return;
        if (event.target.closest && event.target.closest('#ui-overlay')) return;
        if (this.skiing) return;
        this._setMouse(event);

        if (this.mode === 'place') {
            this._updateGhostFromMouse();
            this.placeObject();
        } else if (this.mode === 'select') {
            // Sculpt mode clicks belong to the terrain tools
            if (document.body.classList.contains('sculpt-mode')) return;
            this.trySelect();
        }
    }

    // =====================================================================
    // Validation
    // =====================================================================
    _validate(type, p, { ignore = null } = {}) {
        const m = this.mountain;
        const hw = m.width * 0.5 - 8, hd = m.depth * 0.5 - 8;
        if (Math.abs(p.x) > hw || Math.abs(p.z) > hd) return { ok: false, reason: 'Too close to the edge' };

        if (isLift(type)) {
            if (this.liftStartPoint) {
                const len = Math.hypot(p.x - this.liftStartPoint.x, p.z - this.liftStartPoint.z);
                if (len < LIFT_MIN_LENGTH) return { ok: false, reason: 'Lift is too short' };
            }
            const hit = this._overlap(p, 3, ignore, true);
            if (hit) return { ok: false, reason: `Blocked by ${TYPE_NAMES[hit.type] || hit.type}` };
            return { ok: true };
        }

        const slope = m.getSlopeAt(p.x, p.z);
        const max = MAX_SLOPE[type] ?? MAX_SLOPE.default;
        if (slope > max) return { ok: false, reason: 'Too steep here' };

        const fp = this.previewInfo?.footprint ?? 2;
        const hit = this._overlap(p, fp, ignore, false);
        if (hit) return { ok: false, reason: `Too close to ${TYPE_NAMES[hit.type] || hit.type}` };
        return { ok: true };
    }

    _overlap(p, radius, ignore, liftOnlyBig) {
        for (const e of this.placedObjects) {
            if (e === ignore || isLift(e.type)) continue;
            if (liftOnlyBig && e.type !== 'lodge') continue;
            const o = e.object.position;
            const r = (e.footprint ?? 2) + radius;
            const dx = o.x - p.x, dz = o.z - p.z;
            if (dx * dx + dz * dz < r * r * 0.55) return e;
        }
        return null;
    }

    // =====================================================================
    // Placing
    // =====================================================================
    placeObject() {
        if (!this.previewObject || !this.ghostVisible) {
            events.emit('place:invalid', { reason: 'Off the mountain' });
            return;
        }
        const type = this.currentObjectType;
        const position = this.ghostGround.clone();

        if (!this.ghostValid) {
            this.ghostShake = 1;
            events.emit('place:invalid', { reason: this.ghostReason || 'Can\'t place here' });
            return;
        }

        if (isLift(type)) {
            if (!this.liftStartPoint) {
                this.liftStartPoint = position.clone();
                this._showLiftStart(position);
                this.puffs.emit(position.x, position.y, position.z, 2.5, 14);
                this.ghostSquash = 0.8;
                events.emit('place:lift-start', { type, x: position.x, y: position.y, z: position.z });
                this._updateLiftPreview(this.liftStartPoint, position);
                return;
            }
            const isGondola = type === 'gondola';
            const start = this.liftStartPoint.clone();
            const lift = this.skiLift.createLift(start, position, isGondola);
            if (!lift.parent) this.scene.add(lift);
            lift.userData.type = type;
            const entry = { type, object: lift, data: { start, end: position.clone() } };
            this.placedObjects.push(entry);
            this._selectables = null;
            this._popIn(entry, 0, true);
            this._pushUndo({ kind: 'place', entry });
            events.emit('place:object', { type, x: position.x, y: position.y, z: position.z });

            // Stay in lift mode (like other objects) so the next lift can be laid out right away
            this.liftStartPoint = null;
            this.removeLiftPreviewLine();
            this.ghostSquash = 0.75;
            this._updateGhostFromMouse();
            return;
        }

        const g = this.previewObject;
        const entry = this._spawn(type, position.x, position.z, {
            rotY: g.rotation.y, tiltX: g.rotation.x, tiltZ: g.rotation.z, y: position.y, animate: true, silent: true,
        });
        if (!entry) return;
        this._pushUndo({ kind: 'place', entry });
        this.ghostSquash = 0.75;
        events.emit('place:object', { type, x: position.x, y: position.y, z: position.z });
        // Stay in placement mode for rapid placement; re-validate (the spot is now taken)
        this._updateGhostFromMouse();
    }

    // =====================================================================
    // Lift preview
    // =====================================================================
    _buildLiftPreview() {
        const pole = new THREE.CylinderGeometry(0.22, 0.3, 8, 6);
        pole.translate(0, 4, 0);
        const beam = new THREE.BoxGeometry(2.5, 0.3, 0.3);
        beam.translate(0, 8, 0);
        const towerGeo = mergeGeometries([pole.toNonIndexed(), beam.toNonIndexed()]);
        pole.dispose(); beam.dispose();
        this.ghostTowers = new THREE.InstancedMesh(towerGeo, this.ghostMaterial, MAX_GHOST_TOWERS);
        this.ghostTowers.count = 0;
        this.ghostTowers.frustumCulled = false;
        this.ghostTowers.renderOrder = 10;
        this.ghostTowers.visible = false;
        this.ghostTowers.name = 'liftPreviewTowers';
        this.scene.add(this.ghostTowers);

        const cableGeo = new THREE.BufferGeometry();
        this.cablePositions = new Float32Array(CABLE_POINTS * 2 * 3);
        cableGeo.setAttribute('position', new THREE.BufferAttribute(this.cablePositions, 3).setUsage(THREE.DynamicDrawUsage));
        cableGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
        this.cableMaterial = new THREE.LineBasicMaterial({
            color: COLOR_VALID, transparent: true, opacity: 0.95, depthWrite: false, fog: false, toneMapped: false,
        });
        this.liftPreviewLine = new THREE.LineSegments(cableGeo, this.cableMaterial);
        this.liftPreviewLine.frustumCulled = false;
        this.liftPreviewLine.visible = false;
        this.liftPreviewLine.renderOrder = 11;
        this.liftPreviewLine.name = 'liftPreviewCable';
        this.scene.add(this.liftPreviewLine);

        // Ground track: terrain-conformed ribbon with marching dashes toward the top station
        const TR = 128;
        this.trackSegs = TR;
        this.trackPos = new Float32Array((TR + 1) * 2 * 3);
        const trackUv = new Float32Array((TR + 1) * 2 * 2);
        const tIdx = [];
        for (let i = 0; i < TR; i++) { const a = i * 2; tIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        const trackGeo = new THREE.BufferGeometry();
        trackGeo.setAttribute('position', new THREE.BufferAttribute(this.trackPos, 3).setUsage(THREE.DynamicDrawUsage));
        trackGeo.setAttribute('uv', new THREE.BufferAttribute(trackUv, 2).setUsage(THREE.DynamicDrawUsage));
        trackGeo.setIndex(tIdx);
        trackGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
        this.trackMaterial = new THREE.ShaderMaterial({
            uniforms: { uColor: { value: COLOR_VALID.clone() }, uTime: { value: 0 }, uDash: { value: 12 } },
            vertexShader: /* glsl */`
                varying vec2 vUv;
                void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
            `,
            fragmentShader: /* glsl */`
                uniform vec3 uColor; uniform float uTime; uniform float uDash;
                varying vec2 vUv;
                void main() {
                    float edge = 1.0 - smoothstep(0.55, 1.0, abs(vUv.y * 2.0 - 1.0));
                    float f = fract(vUv.x / uDash - uTime * 1.2);
                    float dash = smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.5, 0.58, f));
                    float a = (0.3 + 0.62 * dash) * edge;
                    gl_FragColor = vec4(uColor, a);
                }
            `,
            transparent: true, depthWrite: false, fog: false, toneMapped: false,
            polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide,
        });
        this.liftTrack = new THREE.Mesh(trackGeo, this.trackMaterial);
        this.liftTrack.frustumCulled = false;
        this.liftTrack.visible = false;
        this.liftTrack.renderOrder = 4;
        this.liftTrack.name = 'liftPreviewTrack';
        this.scene.add(this.liftTrack);

        // Start-station ghost marker (a ring + the cached tower ghost clone)
        this.liftStartRing = new THREE.Mesh(this.footprintRing.geometry, createRingMaterial(COLOR_VALID, { opacity: 1, dash: 1, fill: 0.2 }));
        this.liftStartRing.visible = false;
        this.liftStartRing.renderOrder = 6;
        this.liftStartRing.frustumCulled = false;
        this.scene.add(this.liftStartRing);
        this.liftStartGhost = null;
    }

    _showLiftStart(pos) {
        if (!this.liftStartGhost) {
            const g = this._getGhost('ski-lift');
            this.liftStartGhost = g.object.clone();
            this.liftStartGhost.name = 'liftStartGhost';
        }
        this.liftStartGhost.position.copy(pos);
        this.liftStartGhost.visible = true;
        if (!this.liftStartGhost.parent) this.scene.add(this.liftStartGhost);
        this.liftStartRing.position.copy(pos);
        this.liftStartRing.position.y += 0.3;
        this.liftStartRing.visible = true;
    }

    _hideLiftPreview() {
        this.ghostTowers.visible = false;
        this.ghostTowers.count = 0;
        this.liftPreviewLine.visible = false;
        this.liftTrack.visible = false;
        this.liftStartRing.visible = false;
        if (this.liftStartGhost) this.liftStartGhost.visible = false;
    }

    _updateLiftPreview(start, end) {
        const dx = end.x - start.x, dz = end.z - start.z;
        const len = Math.hypot(dx, dz);
        const yaw = Math.atan2(dx, dz);
        const nInter = Math.min(MAX_GHOST_TOWERS - 1, Math.floor(len / TOWER_SPACING));
        // Tower list: start (skip, has its own ghost), intermediates, end (preview ghost)
        const towers = this._towerScratch || (this._towerScratch = []);
        towers.length = 0;
        towers.push([start.x, start.y + 8, start.z]);
        this._q.setFromAxisAngle(this._up, yaw);
        let count = 0;
        for (let i = 1; i <= nInter; i++) {
            const t = i / (nInter + 1);
            const x = start.x + dx * t, z = start.z + dz * t;
            const y = this.mountain.getHeightAt(x, z);
            this._v1.set(x, y, z);
            this._v2.set(1, 1, 1);
            this._m.compose(this._v1, this._q, this._v2);
            this.ghostTowers.setMatrixAt(count++, this._m);
            towers.push([x, y + 8, z]);
        }
        towers.push([end.x, end.y + 8, end.z]);
        this.ghostTowers.count = count;
        this.ghostTowers.instanceMatrix.needsUpdate = true;
        this.ghostTowers.visible = count > 0;
        if (this.previewObject) this.previewObject.rotation.y = yaw + Math.PI;
        if (this.liftStartGhost) this.liftStartGhost.rotation.y = yaw;

        // Catenary cables (two, offset ±0.9 like the real lift) as line segments
        const px = Math.cos(yaw) * 0.9, pz = -Math.sin(yaw) * 0.9;
        const segs = towers.length - 1;
        const perSeg = Math.max(2, Math.floor((CABLE_POINTS - 1) / Math.max(1, segs)));
        const pos = this.cablePositions;
        let w = 0;
        const maxVerts = CABLE_POINTS * 2;
        for (const side of [1, -1]) {
            let prev = null;
            for (let s = 0; s < segs && w < maxVerts - 2; s++) {
                const a = towers[s], b = towers[s + 1];
                const span = Math.hypot(b[0] - a[0], b[2] - a[2]);
                const sag = Math.min(4, span * 0.035);
                for (let j = (s === 0 ? 0 : 1); j <= perSeg && w < maxVerts - 2; j++) {
                    const t = j / perSeg;
                    const x = a[0] + (b[0] - a[0]) * t + px * side;
                    const y = a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t);
                    const z = a[2] + (b[2] - a[2]) * t + pz * side;
                    if (prev) {
                        pos[w * 3] = prev[0]; pos[w * 3 + 1] = prev[1]; pos[w * 3 + 2] = prev[2]; w++;
                        pos[w * 3] = x; pos[w * 3 + 1] = y; pos[w * 3 + 2] = z; w++;
                        prev[0] = x; prev[1] = y; prev[2] = z;
                    } else {
                        prev = [x, y, z];
                    }
                }
            }
        }
        this.liftPreviewLine.geometry.setDrawRange(0, w);
        this.liftPreviewLine.geometry.attributes.position.needsUpdate = true;
        this.liftPreviewLine.visible = true;

        // Ground track ribbon
        {
            const TR = this.trackSegs;
            const camD = this.camera.position.distanceTo(end);
            const hw = Math.max(1.5, camD * 0.006);
            const ux = len > 1e-3 ? dx / len : 0, uz = len > 1e-3 ? dz / len : 1;
            const nx = -uz * hw, nz = ux * hw;
            const tp = this.trackPos;
            const uv = this.liftTrack.geometry.attributes.uv.array;
            for (let i = 0; i <= TR; i++) {
                const t = i / TR;
                const cx = start.x + dx * t, cz = start.z + dz * t;
                let k = i * 6;
                let x = cx + nx, z = cz + nz;
                tp[k] = x; tp[k + 1] = this.mountain.getHeightAt(x, z) + 0.5; tp[k + 2] = z;
                x = cx - nx; z = cz - nz;
                tp[k + 3] = x; tp[k + 4] = this.mountain.getHeightAt(x, z) + 0.5; tp[k + 5] = z;
                const d = t * len;
                uv[i * 4] = d; uv[i * 4 + 1] = 0; uv[i * 4 + 2] = d; uv[i * 4 + 3] = 1;
            }
            this.trackMaterial.uniforms.uDash.value = Math.max(6, hw * 6);
            this.liftTrack.geometry.attributes.position.needsUpdate = true;
            this.liftTrack.geometry.attributes.uv.needsUpdate = true;
            this.liftTrack.visible = true;
        }

        // Throttled preview event (~10Hz)
        this._pendingLiftLen = len;
    }

    // =====================================================================
    // Selection
    // =====================================================================
    _getSelectables() {
        if (!this._selectables) this._selectables = this.placedObjects.map(o => o.object);
        return this._selectables;
    }

    _pick() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const hits = this.raycaster.intersectObjects(this._getSelectables(), true);
        for (const h of hits) {
            if (!h.object.visible) continue;
            let o = h.object;
            while (o) {
                const entry = this.placedObjects.find(e => e.object === o);
                if (entry) return entry;
                o = o.parent;
            }
        }
        return null;
    }

    trySelect() {
        const found = this._pick();
        if (found) {
            if (found !== this.selectedObject) this.selectObject(found);
            this.puffs.emit(found.object.position.x, found.object.position.y, found.object.position.z, (found.footprint || 2) * 0.5, 6);
        } else {
            this.clearSelection();
        }
    }

    selectObject(placedObj) {
        this.clearSelection();
        this.selectedObject = placedObj;
        this.highlightObject(placedObj.object, true);
        if (this.hoveredObject === placedObj) this._setHover(null);
        this._selectT = 0;
        events.emit('place:select', { type: placedObj.type });
    }

    clearSelection() {
        if (this.selectedObject) {
            this.highlightObject(this.selectedObject.object, false);
            this.selectedObject = null;
            this.selectRing.visible = false;
            events.emit('place:select', { type: null });
        }
    }

    highlightObject(object, highlight) {
        if (highlight) {
            object.traverse(child => {
                if (!child.isMesh || this.selectionClones.has(child)) return;
                const orig = child.material;
                const tint = (m) => {
                    const c = m.clone();
                    if (c.emissive) {
                        const k = 0.16 / Math.max(0.2, c.emissiveIntensity ?? 1);
                        c.emissive = c.emissive.clone().add(COLOR_SELECT.clone().multiplyScalar(k));
                    }
                    return c;
                };
                child.material = Array.isArray(orig) ? orig.map(tint) : tint(orig);
                this.selectionClones.set(child, orig);
            });
        } else {
            for (const [mesh, orig] of this.selectionClones) {
                const clone = mesh.material;
                mesh.material = orig;
                (Array.isArray(clone) ? clone : [clone]).forEach(m => m && m !== orig && m.dispose?.());
            }
            this.selectionClones.clear();
        }
    }

    _setHover(entry) {
        if (this.hoveredObject === entry) return;
        this.hoveredObject = entry;
        document.body.classList.toggle('hovering-object', !!entry);
        this.hoverRing.visible = !!entry && entry !== this.selectedObject;
    }

    // =====================================================================
    // Keyboard
    // =====================================================================
    onKeyDown(event) {
        const tag = event.target && event.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
        if (this.skiing) return;
        // Modal UI (title, shortcuts sheet, popovers, photo mode) owns the keyboard.
        if (_uiModalOpen()) return;

        // Undo
        if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z') && !event.shiftKey) {
            if (this.undo()) event.preventDefault();
            return;
        }

        if (event.key === 'Escape') {
            if (this.mode === 'place') {
                if (this.liftStartPoint) {
                    // First escape backs out of the lift's second click
                    this.liftStartPoint = null;
                    this._hideLiftPreview();
                    this._updateGhostFromMouse();
                    // Tell UI's Escape handler not to cancel placement as well.
                    event._placerHandled = true;
                } else {
                    this.cancelPlacement();
                }
            } else {
                this.clearSelection();
            }
        }

        const target = this.previewObject || (this.selectedObject && this.selectedObject.object);
        if (target && !(event.ctrlKey || event.metaKey || event.altKey)) {
            const step = Math.PI / 18; // 10 degrees
            const selectedLift = !this.previewObject && this.selectedObject && isLift(this.selectedObject.type);
            let handled = true;
            switch (event.key) {
                case 'r': case 'R': target.rotation.y += Math.PI / 4; break;
                case 't': case 'T': target.rotation.set(0, 0, 0); this.userPitch = 0; break;
                case 'ArrowLeft': target.rotation.y += step; break;
                case 'ArrowRight': target.rotation.y -= step; break;
                case 'ArrowUp': target.rotation.x -= step; if (this.previewObject) this.userPitch -= step; break;
                case 'ArrowDown': target.rotation.x += step; if (this.previewObject) this.userPitch += step; break;
                default: handled = false;
            }
            if (handled) {
                if (selectedLift) {
                    // Lifts are world-space groups at the origin; don't spin them around (0,0,0)
                    target.rotation.set(0, 0, 0);
                } else {
                    event.preventDefault();
                    if (target === this.previewObject && this.currentObjectType === 'lodge') this._lodgeYawSet = true;
                }
            }
        }

        if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedObject) {
            event.preventDefault();
            this.deleteSelected();
        }
    }

    // =====================================================================
    // Removal / undo
    // =====================================================================
    deleteSelected() {
        if (!this.selectedObject) return;
        const entry = this.selectedObject;
        this.clearSelection();
        this._removeEntry(entry, { keep: true });
        this._pushUndo({ kind: 'delete', entry });
        events.emit('place:remove', { type: entry.type, count: 1 });
    }

    /** Remove an entry from the world with shrink + poof. keep=true defers disposal (undo). */
    _removeEntry(entry, { keep = false, animate = true, delay = 0 } = {}) {
        const i = this.placedObjects.indexOf(entry);
        if (i > -1) this.placedObjects.splice(i, 1);
        this._selectables = null;
        if (this.hoveredObject === entry) this._setHover(null);
        const obj = entry.object;
        // Cancel any running pop-in on this object
        this.anims = this.anims.filter(a => {
            if (a.entry === entry) { a.restore?.(); return false; }
            return true;
        });
        const p = obj.position;
        const finish = () => {
            this.scene.remove(obj);
            if (!keep) this._pendingDispose.push(obj);
        };
        if (isLift(entry.type)) {
            const d = entry.data || {};
            [d.start, d.end].forEach(pt => pt && this.puffs.emit(pt.x, pt.y, pt.z, 3, 14));
            finish();
            return;
        }
        if (!animate) { finish(); return; }
        const fp = entry.footprint || 2;
        this.anims.push({
            entry, object: obj, t: 0, dur: 0.22, delay, kind: 'out', base: obj.scale.clone(),
            onStart: () => { this.puffs.emit(p.x, p.y, p.z, Math.min(8, fp * 0.7), 18); if (delay === 0) this._ripple(p, fp * 1.4, '#DDE8F5'); },
            onDone: finish,
        });
    }

    _pushUndo(action) {
        this.undoStack.push(action);
        while (this.undoStack.length > UNDO_LIMIT) {
            const old = this.undoStack.shift();
            if (old.kind === 'delete') this._pendingDispose.push(old.entry.object);
        }
    }

    _clearUndo() {
        for (const a of this.undoStack) {
            if (a.kind === 'delete' && !a.entry.object.parent) this._pendingDispose.push(a.entry.object);
        }
        this.undoStack.length = 0;
    }

    /** Undo the last placement or deletion. Returns true if something changed. */
    undo() {
        const a = this.undoStack.pop();
        if (!a) return false;
        if (a.kind === 'place') {
            if (this.selectedObject === a.entry) this.clearSelection();
            if (this.placedObjects.includes(a.entry)) this._removeEntry(a.entry);
            events.emit('place:undo', { action: 'place', type: a.entry.type });
            events.emit('place:remove', { type: a.entry.type, count: 1 });
        } else if (a.kind === 'delete') {
            const e = a.entry;
            // Cancel a still-running shrink so it can't remove the object afterwards
            this.anims = this.anims.filter(x => {
                if (x.entry === e) { x.object.scale.copy(x.base); return false; }
                return true;
            });
            if (!e.object.parent) this.scene.add(e.object);
            this.placedObjects.push(e);
            this._selectables = null;
            this._popIn(e, 0, true);
            const p = e.object.position;
            events.emit('place:undo', { action: 'delete', type: e.type });
            events.emit('place:object', { type: e.type, x: p.x, y: p.y, z: p.z });
        }
        return true;
    }

    /**
     * Dispose geometries of removed objects that nothing in the scene still uses
     * (factories may share geometries). Batched: one scene traversal per frame.
     */
    _flushDisposals() {
        if (this._pendingDispose.length === 0) return;
        const list = this._pendingDispose;
        this._pendingDispose = [];
        const used = new Set();
        this.scene.traverse(o => { if (o.geometry) used.add(o.geometry); });
        for (const u of this.undoStack) {
            if (u.kind === 'delete') u.entry.object.traverse(o => { if (o.geometry) used.add(o.geometry); });
        }
        for (const g of this.ghostCache.values()) g.object.traverse(o => { if (o.geometry) used.add(o.geometry); });
        const done = new Set();
        for (const obj of list) {
            if (obj.parent) continue; // re-added (undo)
            obj.traverse(o => {
                const g = o.geometry;
                if (g && !used.has(g) && !done.has(g) && !g.userData?.shared) { g.dispose(); done.add(g); }
            });
        }
    }

    clearAll({ silent = false } = {}) {
        this.clearSelection();
        this.cancelPlacement();
        this._setHover(null);
        const list = this.placedObjects.slice();
        const count = list.length;
        list.forEach((e, i) => this._removeEntry(e, { delay: Math.min(0.4, i * 0.01) }));
        this.placedObjects = [];
        this._selectables = null;
        this._clearUndo();
        if (count > 0 && !silent) events.emit('place:remove', { type: 'all', count });
    }

    // =====================================================================
    // Animations
    // =====================================================================
    _popIn(entry, delay = 0, silent = false) {
        const obj = entry.object;
        const p = obj.position;
        const fp = entry.footprint || 2;
        if (isLift(entry.type)) {
            // Lift groups live at the world origin: pop each tower/station in place, staggered
            const parts = obj.children.filter(c => /tower|station/i.test(c.name || ''));
            const start = entry.data?.start;
            parts.sort((a, b) => (start ? a.position.distanceToSquared(start) - b.position.distanceToSquared(start) : 0));
            parts.forEach((c, i) => {
                const base = c.scale.clone();
                c.scale.setScalar(0.0001);
                this.anims.push({
                    entry, object: c, t: 0, dur: 0.3, delay: delay + i * 0.04, kind: 'in', base,
                    restore: () => c.scale.copy(base),
                    onStart: () => {
                        this.puffs.emit(c.position.x, c.position.y, c.position.z, 2.2, 8);
                        if (i === 0 && silent) events.emit('place:pop', { type: entry.type, x: c.position.x, y: c.position.y, z: c.position.z });
                    },
                });
            });
            return;
        }
        const base = obj.scale.clone();
        obj.scale.setScalar(0.0001);
        this.anims.push({
            entry, object: obj, t: 0, dur: 0.28, delay, kind: 'in', base,
            restore: () => obj.scale.copy(base),
            onStart: () => {
                this.puffs.emit(p.x, p.y, p.z, Math.min(8, fp * 0.8), entry.type === 'lodge' ? 36 : 18);
                if (!silent || delay === 0 || entry.type === 'lodge') this._ripple(p, fp * 1.8);
                if (silent && delay > 0) events.emit('place:pop', { type: entry.type, x: p.x, y: p.y, z: p.z });
            },
        });
    }

    _ripple(p, radius, color = null) {
        const r = this.ripples[this._rippleCursor];
        this._rippleCursor = (this._rippleCursor + 1) % this.ripples.length;
        r.userData.t = 0;
        r.userData.radius = Math.max(1.5, radius);
        r.userData.p = (r.userData.p || new THREE.Vector3()).copy(p);
        r.material.uniforms.uColor.value.set(color || (this.isNight ? '#BFD4FF' : '#FFFFFF'));
        r.visible = true;
    }

    _updateRipples(dt) {
        for (const r of this.ripples) {
            if (!r.visible) continue;
            r.userData.t += dt / 0.55;
            const t = r.userData.t;
            if (t >= 1) { r.visible = false; continue; }
            const e = 1 - Math.pow(1 - t, 3);
            this._placeRing(r, r.userData.p, r.userData.radius * (0.35 + 1.0 * e));
            r.material.uniforms.uOpacity.value = 0.9 * (1 - t) * (1 - t);
        }
    }

    _updateAnims(delta) {
        if (this.anims.length === 0) return;
        let write = 0;
        for (let i = 0; i < this.anims.length; i++) {
            const a = this.anims[i];
            if (a.delay > 0) {
                a.delay -= delta;
                if (a.delay > 0) { this.anims[write++] = a; continue; }
            }
            if (a.t === 0 && a.onStart) { a.onStart(); a.onStart = null; }
            a.t += delta / a.dur;
            const t = Math.min(1, a.t);
            const s = a.kind === 'in' ? popCurve(t) : shrinkCurve(t);
            a.object.scale.set(a.base.x * Math.max(s, 0.0001), a.base.y * Math.max(s, 0.0001), a.base.z * Math.max(s, 0.0001));
            if (t >= 1) {
                // Always leave the object at its true scale (removed objects may be undone later)
                a.object.scale.copy(a.base);
                a.onDone?.();
            } else {
                this.anims[write++] = a;
            }
        }
        this.anims.length = write;
    }

    // =====================================================================
    // Environment
    // =====================================================================
    setNightMode(enabled) {
        this.isNight = !!enabled;
        this.skiLift.setNightMode?.(this.isNight);
        this.lodge.setNightMode?.(this.isNight);
        this.decorations.setNightMode?.(this.isNight);
        this.puffs.setNight(this.isNight);
    }

    // =====================================================================
    // Generators
    // =====================================================================
    _uphillYaw(x, z, r = 60) {
        const h = (a, b) => this.mountain.getHeightAt(a, b);
        const gx = h(x + r, z) - h(x - r, z);
        const gz = h(x, z + r) - h(x, z - r);
        if (Math.abs(gx) + Math.abs(gz) < 1e-3) return Math.PI; // default: face -Z (the mountain)
        return Math.atan2(gx, gz); // local +Z (door side) faces uphill
    }

    _downhillYaw(x, z) {
        const n = this.mountain.getNormalAt(x, z);
        return Math.atan2(n.x, n.z);
    }

    _addLift(sx, sz, ex, ez, gondola, delay) {
        const start = new THREE.Vector3(sx, this.mountain.getHeightAt(sx, sz), sz);
        const end = new THREE.Vector3(ex, this.mountain.getHeightAt(ex, ez), ez);
        const lift = this.skiLift.createLift(start, end, gondola);
        if (!lift.parent) this.scene.add(lift);
        const type = gondola ? 'gondola' : 'ski-lift';
        lift.userData.type = type;
        const entry = { type, object: lift, data: { start, end } };
        this.placedObjects.push(entry);
        this._popIn(entry, delay, true);
        return entry;
    }

    /** Lodge with a little village around it: trees behind, benches/rack/snow piles out front. */
    _addLodgeVillage(x, z, variant, delay, rng) {
        const yaw = this._uphillYaw(x, z);
        const lodge = this._spawn('lodge', x, z, { rotY: yaw, opts: { variant }, delay });
        if (!lodge) return delay;
        const fp = lodge.footprint || 6;
        let d = delay + 0.05;
        const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);   // toward uphill (front/deck)
        const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);

        // Front: benches + ski rack facing the slope
        const front = fp * 1.35 + 2;
        const props = [
            ['bench', -fp * 0.55, front],
            ['ski-rack', fp * 0.7, front * 0.95],
            ['bench', fp * 0.05, front + 1.2],
        ];
        props.forEach(([t, side, fwd]) => {
            const px = x + rightX * side + fwdX * fwd;
            const pz = z + rightZ * side + fwdZ * fwd;
            if (this._spawn(t, px, pz, { rotY: yaw + Math.PI + (rng() - 0.5) * 0.3, delay: d })) d += 0.04;
        });

        // Snow piles at the corners
        [-1, 1].forEach(s => {
            const px = x + rightX * s * (fp + 2.5) + fwdX * (fp * 0.6);
            const pz = z + rightZ * s * (fp + 2.5) + fwdZ * (fp * 0.6);
            if (this._spawn('snow-pile', px, pz, { rotY: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.6, delay: d })) d += 0.03;
        });

        // Grove of pines behind and to the sides (arc)
        const n = 5 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) {
            const a = Math.PI * (0.55 + 0.9 * (i / (n - 1))) + (rng() - 0.5) * 0.25; // behind arc
            const r = fp * (1.25 + rng() * 0.55) + 2;
            const lx = Math.sin(a) * r, lz = Math.cos(a) * r; // local coords (+Z = front)
            const px = x + rightX * lx + fwdX * lz;
            const pz = z + rightZ * lx + fwdZ * lz;
            if (this._spawn('pine-tree', px, pz, { rotY: rng() * Math.PI * 2, scale: 0.85 + rng() * 0.6, delay: d })) d += 0.035;
        }
        return d;
    }

    _seededRng(seed = Math.random() * 1e9) {
        let s = seed >>> 0;
        return () => {
            s = (s + 0x6D2B79F5) >>> 0;
            let t = s;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    _addJump(x, z, rot = 0, size = 1, delay = 0) {
        const n = this.mountain.getNormalAt(x, z);
        return this._spawn('jump', x, z, {
            rotY: Math.atan2(n.x, n.z) + rot,
            tiltX: -n.z * 0.3,
            tiltZ: n.x * 0.3,
            scale: size,
            delay,
        });
    }

    _addGates(points, delay, colorFor = (i) => (i % 2 ? 'blue' : 'red')) {
        let d = delay;
        points.forEach((pt, i) => {
            if (this._spawn('flag', pt.x, pt.z, { opts: { color: colorFor(i) }, rotY: pt.rot || 0, delay: d })) d += 0.03;
        });
        return d;
    }

    // Auto-generate a sample resort
    autoGenerate() {
        this.clearAll({ silent: true });
        const rng = this._seededRng();
        let d = 0.15;

        // Lifts running up the mountain
        this._addLift(-400, 500, -200, -600, false, d); d += 0.12;
        this._addLift(500, 400, 300, -500, true, d); d += 0.12;
        this._addLift(0, 300, -100, -800, false, d); d += 0.12;

        // Base village: lodges facing up the slope, each with its own little scene
        d = this._addLodgeVillage(0, 800, 'main', d, rng);
        d = this._addLodgeVillage(-500, 700, 'large', d, rng);
        d = this._addLodgeVillage(600, 750, 'small', d, rng);

        // Gate flags along two runs (alternating red/blue, slaloming)
        const runA = [], runB = [];
        for (let i = 0; i < 5; i++) {
            const z = -450 + i * 190;
            runA.push({ x: -150 + Math.sin(i * 1.1) * 45 + (i % 2 ? 18 : -18), z });
            runB.push({ x: 470 + Math.sin(i * 0.9 + 1) * 50 + (i % 2 ? 18 : -18), z: z - 80 });
        }
        d = this._addGates(runA, d);
        d = this._addGates(runB, d, () => 'blue');

        // Snowmen near the lodges
        [{ x: 125, z: 750 }, { x: -600, z: 650 }, { x: 520, z: 690 }].forEach(p => {
            if (this._spawn('snowman', p.x, p.z, { rotY: this._uphillYaw(p.x, p.z) + (rng() - 0.5) * 0.8, delay: d })) d += 0.05;
        });

        // Jumps along the runs
        [
            { x: -250, z: -200, rot: 0 }, { x: -100, z: 150, rot: 0.2 }, { x: 200, z: -100, rot: -0.3 },
            { x: 400, z: 100, rot: 0.1 }, { x: -350, z: 300, rot: 0.4 }, { x: 50, z: -300, rot: -0.1 },
            { x: 300, z: 350, rot: 0.2 }, { x: -150, z: -500, rot: 0 },
        ].forEach(p => { if (this._addJump(p.x, p.z, p.rot, 1, d)) d += 0.04; });

        this._selectables = null;
        events.emit('place:generate', { kind: 'resort', count: this.placedObjects.length });
    }

    /** Highest terrain point inside the central (skiable) region. */
    _findSummit() {
        const m = this.mountain;
        const hw = Math.min(900, (m.width || 3000) / 2 - 200);
        const hd = Math.min(1500, (m.depth || 4000) / 2 - 200);
        let best = { x: 0, z: -900, y: -Infinity };
        for (let x = -hw; x <= hw; x += 50) {
            for (let z = -hd; z <= hd; z += 50) {
                const y = m.getHeightAt(x, z);
                if (y > best.y) best = { x, z, y };
            }
        }
        return best;
    }

    /** Follow the fall line downhill from (x,z); returns points spaced ~step apart. */
    _traceFallLine(x, z, step = 30, maxLen = 2400) {
        const m = this.mountain;
        const hw = (m.width || 3000) / 2 - 120, hd = (m.depth || 4000) / 2 - 120;
        const pts = [{ x, z, y: m.getHeightAt(x, z) }];
        let dirX = 0, dirZ = 0, stall = 0;
        for (let len = 0; len < maxLen; len += step) {
            const r = 25;
            let gx = m.getHeightAt(x + r, z) - m.getHeightAt(x - r, z);
            let gz = m.getHeightAt(x, z + r) - m.getHeightAt(x, z - r);
            const gl = Math.hypot(gx, gz);
            if (gl < 0.4) break; // flattened out
            gx /= gl; gz /= gl;
            // smooth the heading so the line doesn't zig-zag in gullies
            dirX = dirX * 0.6 - gx * 0.4; dirZ = dirZ * 0.6 - gz * 0.4;
            const dl = Math.hypot(dirX, dirZ) || 1;
            x += (dirX / dl) * step; z += (dirZ / dl) * step;
            if (Math.abs(x) > hw || Math.abs(z) > hd) break;
            // stop once the line stops losing height (basin / circling)
            const y = m.getHeightAt(x, z);
            if (pts.length > 1 && y > pts[pts.length - 1].y - 0.3) {
                if (++stall >= 3) break;
            } else stall = 0;
            pts.push({ x, z, y });
        }
        return pts;
    }

    /** Point on a polyline at arc length s, with its unit heading (dx,dz). */
    _alongLine(pts, s) {
        let acc = 0;
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            const seg = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6;
            if (acc + seg >= s || i === pts.length - 1) {
                const t = Math.max(0, Math.min(1, (s - acc) / seg));
                return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: (b.x - a.x) / seg, dz: (b.z - a.z) / seg };
            }
            acc += seg;
        }
        const p = pts[pts.length - 1];
        return { x: p.x, z: p.z, dx: 0, dz: 1 };
    }

    // Generate a trick park with lots of jumps. Laid along the fall line from the
    // summit so the run actually flows downhill (terrain is random every session);
    // falls back to the fixed layout when the mountain is too flat for a line.
    generateTrickPark() {
        this.clearAll({ silent: true });
        const rng = this._seededRng();
        // Quick cascade (skier may drop in right away; scale settles within ~1s)
        let d = 0.05;
        const step = 0.022;

        // Pick the longest fall line among the high points of the mountain.
        const summit = this._findSummit();
        const lineLen = (pts) => {
            let len = 0;
            for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
            return len;
        };
        let line = this._traceFallLine(summit.x, summit.z);
        let L = lineLen(line);
        const m = this.mountain;
        const hw = Math.min(1100, (m.width || 3000) / 2 - 250), hd = Math.min(1700, (m.depth || 4000) / 2 - 250);
        for (let x = -hw; x <= hw; x += 200) {
            for (let z = -hd; z <= hd; z += 200) {
                if (m.getHeightAt(x, z) < summit.y * 0.55) continue;
                const cand = this._traceFallLine(x, z);
                const cl = lineLen(cand);
                if (cl > L + 150) { line = cand; L = cl; }
            }
        }

        if (L >= 500) {
            // Drop in below the summit crags: first point on the line where the
            // slope is skiable (rise/run < ~0.45, about 24 degrees).
            let s0 = 40;
            for (let s = 40; s < L * 0.5; s += 15) {
                const p = this._alongLine(line, s);
                const r = 12;
                const gx = this.mountain.getHeightAt(p.x + r, p.z) - this.mountain.getHeightAt(p.x - r, p.z);
                const gz = this.mountain.getHeightAt(p.x, p.z + r) - this.mountain.getHeightAt(p.x, p.z - r);
                if (Math.hypot(gx, gz) / (2 * r) < 0.45) { s0 = s; break; }
            }
            const start = this._alongLine(line, s0);
            this.trickParkStart = { x: start.x, z: start.z };

            const lineJumps = [];
            // First kicker comes up quickly (~70 units in) so the run starts with action.
            const first = s0 + 70, last = L - 120;
            let k = 0;
            for (let s = first; s <= last; s += 150 + rng() * 40, k++) {
                const p = this._alongLine(line, s);
                const nx = -p.dz, nz = p.dx;
                const off = Math.sin(k * 1.3) * 10;
                lineJumps.push({ x: p.x + nx * off, z: p.z + nz * off, size: k % 4 === 3 ? 2.4 : 1.5 + rng() * 0.6 });
                if (k % 2 === 1) {
                    const side = (k % 4 === 1 ? 1 : -1) * (55 + rng() * 20);
                    lineJumps.push({ x: p.x + nx * side, z: p.z + nz * side, size: 1.2 + rng() * 0.5 });
                }
            }
            // Enforce spacing: kickers never overlap, even where the line bends back.
            const kept = [];
            const MIN_GAP = 38;
            lineJumps.forEach(j => {
                if (kept.some(o => Math.hypot(o.x - j.x, o.z - j.z) < MIN_GAP)) return;
                kept.push(j);
                if (this._addJump(j.x, j.z, 0, j.size, d)) d += step;
            });

            // Gates sit wide of a ~6-unit corridor (+/-24) so poles frame the
            // line instead of standing in it or filling the chase camera.
            const gate = (p, w) => [{ x: p.x - p.dz * w, z: p.z + p.dx * w }, { x: p.x + p.dz * w, z: p.z - p.dx * w }];
            const endP = this._alongLine(line, Math.max(first + 60, L - 40));
            d = this._addGates([...gate(this._alongLine(line, s0 + 30), 24), ...gate(endP, 24)], d, () => 'red');

            // Base lodge just past the finish, off to the side of the line
            this._addLodgeVillage(endP.x - endP.dz * 80 + endP.dx * 30, endP.z + endP.dx * 80 + endP.dz * 30, 'main', d, rng);

            this._selectables = null;
            events.emit('place:generate', { kind: 'trick-park', count: this.placedObjects.length });
            return;
        }

        this.trickParkStart = { x: 0, z: -900 };
        const jumps = [];
        for (let i = 0; i < 10; i++) {
            jumps.push({ x: Math.sin(i * 0.6) * 200, z: -800 + i * 180, rot: 0, size: 1.5 + rng() * 0.8 });
        }
        for (let i = 0; i < 6; i++) {
            jumps.push({ x: -300 - Math.sin(i * 0.5) * 150, z: -600 + i * 200, rot: 0.4, size: 1.2 + rng() * 0.6 });
            jumps.push({ x: 300 + Math.sin(i * 0.5) * 150, z: -600 + i * 200, rot: -0.4, size: 1.2 + rng() * 0.6 });
        }
        jumps.push(
            { x: 0, z: -500, rot: 0, size: 2.5 },
            { x: -200, z: -250, rot: 0.3, size: 2.2 },
            { x: 200, z: -100, rot: -0.3, size: 2.2 },
            { x: 0, z: 150, rot: 0, size: 2.5 },
        );
        // Top of the mountain first, so the cascade "flows" downhill
        jumps.sort((a, b) => a.z - b.z);
        jumps.forEach(j => { if (this._addJump(j.x, j.z, j.rot, j.size, d)) d += step; });

        // Start gate + run markers
        const flags = [
            { x: -14, z: -720 }, { x: 14, z: -720 },     // start gate
            { x: -400, z: -550 }, { x: 400, z: -550 },
            { x: -14, z: 600 }, { x: 14, z: 600 },       // finish gate
        ];
        d = this._addGates(flags, d, (i) => (i < 2 || i > 3 ? 'red' : 'blue'));

        // Base lodge facing the park
        this._addLodgeVillage(0, 800, 'main', d, rng);

        this._selectables = null;
        events.emit('place:generate', { kind: 'trick-park', count: this.placedObjects.length });
    }

    // =====================================================================
    // Per-frame
    // =====================================================================
    update(delta) {
        const dt = Math.min(0.1, delta || 0.016);
        this.time += dt;

        // Lifts (chair movement)
        for (const obj of this.placedObjects) {
            if (isLift(obj.type)) this.skiLift.update(obj.object, dt);
        }

        this._updateAnims(dt);
        this._updateRipples(dt);
        if (this._beacons) {
            // Rebuild after the pop-in cascade settles (count + anim activity)
            const sig = this.placedObjects.length * 2 + (this.anims.length ? 1 : 0);
            if (sig !== this._beaconSig) { this._beaconSig = sig; this._rebuildBeacons(); }
            this._beacons.visible = !this.skiing;
            this._beacons.material.uniforms.uPx.value = Math.min(window.devicePixelRatio || 1, 2);
        }
        this._flushDisposals();
        // Safety: if ski:end never arrives, unlock editing once ticks stop
        if (this.skiing && this._lastSkiTick > 0 && this.time - this._lastSkiTick > 1.5) this.skiing = false;
        const h = this.domElement.clientHeight || window.innerHeight;
        this.puffs.update(dt, h, this.camera.fov);
        this.brush?.tick?.(dt);

        const camPos = this.camera.position;

        // Ghost
        this.ghostMaterial.uniforms.uTime.value = this.time;
        if (this.mode === 'place' && this.previewObject) {
            const info = this.previewInfo;
            const target = this.ghostValid ? COLOR_VALID : COLOR_INVALID;
            const k = 1 - Math.exp(-dt * 14);
            this._ghostColor.lerp(target, k);
            this.ghostMaterial.uniforms.uColor.value.copy(this._ghostColor);
            this.cableMaterial.color.copy(this._ghostColor).multiplyScalar(0.62);
            this.trackMaterial.uniforms.uColor.value.copy(this._ghostColor).multiplyScalar(0.7);
            this.trackMaterial.uniforms.uTime.value = this.time;
            this.footprintRing.material.uniforms.uColor.value.copy(this._ghostColor);
            this.liftStartRing.material.uniforms.uTime.value = this.time;

            this.ghostSquash += (1 - this.ghostSquash) * (1 - Math.exp(-dt * 12));
            this.ghostShake = Math.max(0, this.ghostShake - dt * 3.5);
            this.ghostMaterial.uniforms.uFlash.value = Math.max(0, this.ghostShake - 0.4);

            if (this.ghostVisible) {
                const g = this.previewObject;
                const bobAmp = Math.min(1.2, info.height * 0.08 + 0.15);
                const bob = (0.5 + 0.5 * Math.sin(this.time * 3.2)) * bobAmp + bobAmp * 0.4;
                const shake = Math.sin(this.time * 60) * this.ghostShake * Math.min(1.5, info.footprint * 0.25);
                g.position.set(this.ghostGround.x + shake * Math.cos(g.rotation.y), this.ghostGround.y + bob, this.ghostGround.z - shake * Math.sin(g.rotation.y));
                const s = this.ghostSquash;
                g.scale.set(info.baseScale.x * (2 - s), info.baseScale.y * s, info.baseScale.z * (2 - s));

                // Footprint ring: conform to terrain normal, keep a minimum on-screen size
                const dist = camPos.distanceTo(this.ghostGround);
                const r = Math.max(info.footprint * 1.35, dist * 0.012);
                this._placeRing(this.footprintRing, this.ghostGround, r);
                this.footprintRing.material.uniforms.uOpacity.value = 0.75 + 0.2 * Math.sin(this.time * 4);
                this.footprintRing.visible = true;
            }

            if (this.liftStartPoint && this.liftStartRing.visible) {
                const dist = camPos.distanceTo(this.liftStartPoint);
                this._placeRing(this.liftStartRing, this.liftStartPoint, Math.max(3, dist * 0.012));
            }

            // Throttled lift preview event
            this._liftPreviewTimer -= dt;
            if (this.liftStartPoint && this._pendingLiftLen != null && this._liftPreviewTimer <= 0) {
                this._liftPreviewTimer = 0.1;
                if (Math.abs(this._pendingLiftLen - this._lastLiftLen) > 0.5) {
                    this._lastLiftLen = this._pendingLiftLen;
                    events.emit('place:lift-preview', { length: Math.round(this._pendingLiftLen) });
                }
                this._pendingLiftLen = null;
            }
        }

        // Hover (select mode, throttled raycast)
        this._hoverTimer -= dt;
        if (this.mode === 'select' && !this.skiing && this._mouseDirty && this._hoverTimer <= 0 && !document.body.classList.contains('sculpt-mode')) {
            this._hoverTimer = 0.06;
            this._mouseDirty = false;
            this._setHover(this.placedObjects.length ? this._pick() : null);
        }
        if (this.hoveredObject && this.hoverRing.visible) {
            const o = this.hoveredObject;
            const p = this._entryCenter(o);
            const dist = camPos.distanceTo(p);
            this._placeRing(this.hoverRing, p, Math.max((o.footprint || 2) * 1.3, dist * 0.01));
        }

        // Selection ring
        if (this.selectedObject) {
            const o = this.selectedObject;
            const p = this._entryCenter(o);
            const dist = camPos.distanceTo(p);
            this._selectT = (this._selectT || 0) + dt;
            const intro = Math.min(1, this._selectT / 0.25);
            const pulse = 1 + 0.06 * Math.sin(this.time * 4.5);
            const r = Math.max((o.footprint || 2) * 1.45, dist * 0.013) * pulse * (0.6 + 0.4 * popCurve(intro));
            this._placeRing(this.selectRing, p, r);
            this.selectRing.material.uniforms.uTime.value = this.time;
            this.selectRing.material.uniforms.uOpacity.value = 0.8 + 0.2 * Math.sin(this.time * 4.5);
            this.selectRing.visible = true;
        }
    }

    _entryCenter(entry) {
        if (isLift(entry.type) && entry.data?.start && entry.data?.end) {
            return this._v2.copy(entry.data.start).add(entry.data.end).multiplyScalar(0.5).setY(
                this.mountain.getHeightAt((entry.data.start.x + entry.data.end.x) / 2, (entry.data.start.z + entry.data.end.z) / 2)
            );
        }
        return entry.object.position;
    }

    _placeRing(ring, p, radius) {
        const n = this.mountain.getNormalAt(p.x, p.z);
        ring.position.set(p.x, this.mountain.getHeightAt(p.x, p.z) + 0.35, p.z);
        this._q.setFromUnitVectors(this._up, n);
        ring.quaternion.copy(this._q);
        ring.scale.setScalar(radius);
    }
}
