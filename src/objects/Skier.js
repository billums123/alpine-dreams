/**
 * Skier - player-controlled skier: physics, tricks, ragdoll, camera and
 * snow effects. No DOM and no audio here: everything the HUD and Sfx need
 * is published on the event bus (see DESIGN_BRIEF §3.4).
 *
 * Public API (kept): constructor(scene, mountain, camera, cameraControls),
 * place(x, z), remove(), update(delta), isActive, mesh, position,
 * writable `trees` and `objectPlacer` fields.
 */

import * as THREE from 'three';
import { events } from '../core/events.js';
import { getPreset } from '../core/quality.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
// Readout scale: cruising ~30-50 mph, a full tuck tops out around 70.
const MPH = 1.35;

// ---------- small math helpers (frame-rate independent smoothing) ----------
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const dampAngle = (a, b, k, dt) => {
    const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + d * (1 - Math.exp(-k * dt));
};
/** Convert a "per 60fps frame" lerp factor into a dt-correct factor. */
const lerpFactor = (perFrame, dt) => 1 - Math.pow(1 - perFrame, dt * 60);
/** Convert a "per 60fps frame" multiplier into a dt-correct multiplier. */
const frameMul = (perFrame, dt) => Math.pow(perFrame, dt * 60);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const SIDES = [1, -1]; // +1 = left (+X local), -1 = right

// Module temporaries (never escape a method).
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _s1 = new THREE.Vector3();

function prefersReducedMotion() {
    try {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
        return false;
    }
}

// ---------- palette (DESIGN_BRIEF §1.1) ----------
let _materials = null;
function getMaterials() {
    if (_materials) return _materials;
    const M = (color, opts = {}) => new THREE.MeshStandardMaterial({
        color, roughness: 0.72, metalness: 0, flatShading: true, ...opts,
    });
    _materials = {
        jacket: M(0xE8553D, { roughness: 0.62 }),
        jacketDark: M(0xA93A2A, { roughness: 0.7 }),
        pants: M(0x22304A, { roughness: 0.85 }),
        helmet: M(0xF4F6F8, { roughness: 0.32 }),
        goggle: M(0xFFB347, { emissive: 0xFF9A2E, emissiveIntensity: 0.4, roughness: 0.15, metalness: 0.35 }),
        strap: M(0x2B3A55, { roughness: 0.8 }),
        skin: M(0xEDBE98, { roughness: 0.9 }),
        glove: M(0x1D2433, { roughness: 0.85 }),
        boot: M(0xE9EEF4, { roughness: 0.4 }),
        bootCuff: M(0x2B3A55, { roughness: 0.6 }),
        skiTop: M(0x2F6FD6, { roughness: 0.35 }),
        skiStripe: M(0xFFB36B, { roughness: 0.4 }),
        binding: M(0x3A3F4A, { roughness: 0.45, metalness: 0.3 }),
        pole: M(0xAEB7C4, { roughness: 0.3, metalness: 0.55 }),
        basket: M(0xE8553D, { roughness: 0.6 }),
        snow: M(0xF5F8FC, { roughness: 0.95 }),
    };
    return _materials;
}

// ---------- geometry (built once, shared by every clone / exploded part) ----------
let _geo = null;
function getGeometries() {
    if (_geo) return _geo;

    // Ski: side profile extruded across its width, with an upturned tip and tail.
    const skiW = 0.11;
    const p = new THREE.Shape();
    p.moveTo(-0.9, 0.07);
    p.quadraticCurveTo(-0.82, 0.0, -0.68, 0.0);
    p.lineTo(0.68, 0.0);
    p.quadraticCurveTo(0.9, 0.0, 0.99, 0.17);
    p.lineTo(0.965, 0.18);
    p.quadraticCurveTo(0.87, 0.026, 0.68, 0.026);
    p.lineTo(-0.68, 0.026);
    p.quadraticCurveTo(-0.8, 0.026, -0.875, 0.085);
    p.closePath();
    const ski = new THREE.ExtrudeGeometry(p, { depth: skiW, bevelEnabled: false, curveSegments: 5 });
    ski.rotateY(-Math.PI / 2);          // shape x -> world z, extrusion -> world -x
    ski.translate(skiW / 2, 0, 0.06);
    ski.computeVertexNormals();

    _geo = {
        ski,
        skiStripe: new THREE.BoxGeometry(0.034, 0.006, 1.15).translate(0, 0.029, 0.04),
        binding: new THREE.BoxGeometry(0.085, 0.05, 0.34).translate(0, 0.05, 0.0),
        boot: new THREE.BoxGeometry(0.15, 0.2, 0.3, 1, 1, 1).translate(0, 0.1, 0.02),
        bootCuff: new THREE.CylinderGeometry(0.085, 0.09, 0.08, 7).translate(0, 0.22, -0.01),
        shin: new THREE.CapsuleGeometry(0.075, 0.3, 2, 7).translate(0, 0.22, 0),
        thigh: new THREE.CapsuleGeometry(0.095, 0.26, 2, 7).translate(0, 0.22, 0),
        pelvis: new THREE.BoxGeometry(0.32, 0.17, 0.22).translate(0, 0.03, 0),
        jacket: new THREE.CapsuleGeometry(0.2, 0.3, 3, 8).scale(1, 1, 0.84).translate(0, 0.3, 0),
        hem: new THREE.CylinderGeometry(0.2, 0.205, 0.07, 8).scale(1, 1, 0.86).translate(0, 0.03, 0),
        collar: new THREE.CylinderGeometry(0.105, 0.14, 0.11, 8).translate(0, 0.65, 0.0),
        face: new THREE.SphereGeometry(0.15, 8, 6).translate(0, 0.06, 0.015),
        helmet: new THREE.SphereGeometry(0.2, 10, 5, 0, TAU, 0, Math.PI * 0.5).scale(1, 1, 1.06).translate(0, 0.115, -0.005),
        goggles: new THREE.CylinderGeometry(0.207, 0.207, 0.085, 12, 1, true, -1.0, 2.0).translate(0, 0.085, 0),
        strap: new THREE.CylinderGeometry(0.205, 0.205, 0.05, 12, 1, true, 1.0, TAU - 2.0).translate(0, 0.09, 0),
        upperArm: new THREE.CapsuleGeometry(0.068, 0.17, 2, 6).translate(0, -0.13, 0),
        forearm: new THREE.CapsuleGeometry(0.058, 0.16, 2, 6).translate(0, -0.12, 0),
        glove: new THREE.IcosahedronGeometry(0.072, 0),
        poleGrip: new THREE.CylinderGeometry(0.026, 0.022, 0.14, 6).translate(0, -0.03, 0),
        poleShaft: new THREE.CylinderGeometry(0.011, 0.009, 1.1, 5).translate(0, -0.6, 0),
        poleBasket: new THREE.CylinderGeometry(0.055, 0.055, 0.014, 8).translate(0, -1.0, 0),
        snowball: new THREE.IcosahedronGeometry(0.235, 1),
    };
    return _geo;
}

// ---------- shaders for spray + trails ----------
const SPRAY_VERT = /* glsl */`
    attribute float aLife;
    attribute float aSize;
    uniform float uViewportHalfH;
    varying float vLife;
    varying float vNear;
    void main() {
        vLife = aLife;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNear = smoothstep(1.2, 3.5, -mv.z); // fade puffs that brush the lens
        gl_Position = projectionMatrix * mv;
        if (aLife <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
        float grow = 1.0 + (1.0 - aLife) * 0.9;
        gl_PointSize = clamp(aSize * grow * projectionMatrix[1][1] * uViewportHalfH / max(-mv.z, 0.1), 0.0, 64.0);
    }
`;
const SPRAY_FRAG = /* glsl */`
    uniform vec3 uLit;
    uniform vec3 uShade;
    uniform float uOpacity;
    varying float vLife;
    varying float vNear;
    void main() {
        vec2 pc = gl_PointCoord - 0.5;
        float d = length(pc);
        if (d > 0.5) discard;
        float soft = smoothstep(0.5, 0.05, d);
        float fade = smoothstep(0.0, 0.35, vLife);
        // light from the upper side of each puff: warm top, cool underside
        vec3 col = mix(uShade, uLit, clamp(0.85 - pc.y * 1.2 + pc.x * 0.2, 0.0, 1.0));
        gl_FragColor = vec4(col, soft * fade * vNear * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;
const TRAIL_VERT = /* glsl */`
    attribute float aBirth;
    attribute float aEdge;
    uniform float uTime;
    uniform float uLife;
    varying float vAlpha;
    varying float vEdge;
    #include <fog_pars_vertex>
    void main() {
        float age = uTime - aBirth;
        vAlpha = aBirth < -1000.0 ? 0.0 : clamp(1.0 - age / uLife, 0.0, 1.0);
        vEdge = aEdge;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
    }
`;
const TRAIL_FRAG = /* glsl */`
    // Multiply-blended: outputs a linear factor that darkens the snow beneath,
    // so tracks read as soft grooves in both sunlit and shaded snow.
    uniform vec3 uColor;   // groove tint (linear multiplier)
    uniform vec3 uRim;     // edge tint (linear multiplier)
    uniform float uOpacity;
    varying float vAlpha;
    varying float vEdge;
    #include <fog_pars_fragment>
    void main() {
        float e = abs(vEdge * 2.0 - 1.0);            // 0 centre .. 1 edge
        float groove = 1.0 - smoothstep(0.6, 1.0, e);
        vec3 tint = mix(uColor, uRim, smoothstep(0.3, 0.9, e));
        float a = vAlpha * vAlpha * groove * uOpacity;
        if (a < 0.003) discard;
        vec3 f = mix(vec3(1.0), tint, a);
        #ifdef USE_FOG
            #ifdef FOG_EXP2
                float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
            #else
                float fogF = smoothstep(fogNear, fogFar, vFogDepth);
            #endif
            f = mix(f, vec3(1.0), fogF);
        #endif
        gl_FragColor = vec4(f, 1.0);
    }
`;

const DAY_SPRAY = { lit: 0xF7EEDF, shade: 0xB7C8E2, opacity: 0.9 };
const NIGHT_SPRAY = { lit: 0x8EA2CC, shade: 0x2E3D62, opacity: 0.75 };
const DAY_TRAIL = { color: [0.74, 0.81, 0.95], rim: [0.9, 0.93, 0.99], opacity: 0.85 };
const NIGHT_TRAIL = { color: [0.62, 0.68, 0.86], rim: [0.85, 0.88, 0.97], opacity: 0.8 };

// ---------- trick naming (points table unchanged) ----------
const SPIN_POINTS = { 180: 100, 360: 250, 540: 500, 720: 800, 900: 1200, 1080: 1800 };
const FLIP_POINTS = [0, 300, 700, 1200, 2000];

// ---------- air tuning ----------
// Kickers and manual jumps fly on floaty "trick" gravity so a medium kicker gives
// ~1.3s of air (room for a 360 or a flip) and a big hit ~2s (720 / double).
const TRICK_AIR_GRAVITY = 26;
const ROLLER_AIR_GRAVITY = 46;  // natural pops off rollers stay snappy (unplanned air)
const HANG_VY = 3.5;            // |vy| below this = near apex ...
const HANG_GRAVITY_MUL = 0.7;   // ... where gravity eases off for a touch of hang time
const KICKER_LIFT = 0.3;        // vy = speed * lift * scale^0.544  (~12 at 30 u/s on a 1.6 kicker)
const KICKER_VY_MIN = 7, KICKER_VY_MAX = 17;
const KICKER_VY_TERRAIN_MAX = 21; // extra pop allowed when the ground rises after the lip
const SPIN_RATE = 7.8;          // rad/s at full spin (360 in ~0.8s)
const SPIN_ACCEL = 45;
const FLIP_RATE = 7.2;          // rad/s (one flip in ~0.9s) ...
const FLIP_RATE_MAX = 11;       // ... sped up on short air so a tapped flip can still come round
const SPIN_LAND_TOL = 50;       // degrees off a 180 multiple still counted clean (auto-corrected)
const FLIP_LAND_TOL = 1.2;      // radians off a whole flip still counted clean (auto-corrected)
function nameTrick(spinDeg, flips, flipDir) {
    const spin = spinDeg >= 180 ? spinDeg : 0;
    if (flips > 0) {
        const mult = flips === 1 ? '' : flips === 2 ? 'Double ' : flips === 3 ? 'Triple ' : 'Quad ';
        if (!spin) return mult + (flipDir > 0 ? 'Frontflip' : 'Backflip');
        if (flipDir > 0) return `${mult}Misty ${spin}`;
        return `${mult}${(spin / 180) % 2 === 1 ? 'Rodeo' : 'Cork'} ${spin}`;
    }
    return spin ? `${spin} Spin` : '';
}

export class Skier {
    constructor(scene, mountain, camera, cameraControls) {
        this.scene = scene;
        this.mountain = mountain;
        this.camera = camera;
        this.cameraControls = cameraControls;

        // Skier mesh
        this.mesh = null;
        this.rig = null;
        this.isActive = false;

        // Physics state
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.rotation = 0;      // facing (radians)
        this.edgeAngle = 0;     // -1..1 lean / turn input (smoothed)
        this.turnMomentum = 0;  // smoothed turn rate

        // Physics constants (tuned at 60fps; applied dt-correctly)
        this.gravity = 45;
        this.airGravity = 50;
        this._airG = this.airGravity; // gravity for the current flight (set at takeoff)
        this.airFriction = 0.0012; // low: long kicker flights shouldn't bleed much speed
        this.turnSpeed = 1.6;
        this.maxSpeed = 120;
        this.brakeForce = 0.94;
        this.jumpForce = 4.6;

        this.startPosition = new THREE.Vector3();
        this.startRotation = 0;

        this.lastJumpRampTime = 0;
        this.lastTerrainSlope = 0;
        this.lastSlopeChangeTime = 0;

        this.isGrounded = true;
        this.isJumping = false;
        this.verticalVelocity = 0;
        this.currentSpeed = 0;
        this.isTucking = false;
        this.isBraking = false;

        // Flip / spin
        this.flipRotation = 0;
        this.flipVelocity = 0;
        this._flipRate = FLIP_RATE;
        this.isFlipping = false;
        this.flipDirection = 0;
        this.trickLanded = false;
        this.spinRotation = 0;
        this.spinVelocity = 0;
        this.isSpinning = false;
        this.totalSpinDegrees = 0;

        // Scoring
        this.score = 0;
        this.comboMultiplier = 1;
        this.comboTimer = 0;
        this.lastTrickTime = 0;
        this.stats = this._freshStats();
        this.currentTrick = { spinDegrees: 0, hasFlip: false, flipDirection: 0, numFlips: 0, startTime: 0 };

        this.airHintCount = 0;
        this.maxAirHints = 3;
        this.crashHintCount = 0;
        this.maxCrashHints = 3;

        // Rig references (kept for compatibility with older callers)
        this.bodyParts = {
            torso: null, head: null, leftArm: null, rightArm: null, leftLeg: null, rightLeg: null,
        };
        this.skiMeshes = [];

        // Pose state (smoothed each frame)
        this.pose = {
            shinLean: 0.42, torsoLean: 0.32, torsoRoll: 0, torsoTwist: 0, headPitch: -0.2,
            legDiff: 0, squash: 0, bob: 0,
            arms: {
                1: { sx: -0.55, sz: 0.3, elbow: -0.75, prx: 0.55, prz: 0.1 },
                [-1]: { sx: -0.55, sz: -0.3, elbow: -0.75, prx: 0.55, prz: -0.1 },
            },
        };
        this._plant = { 1: 0, [-1]: 0 };
        this._prevAbsEdge = 0;
        this._time = 0;

        // Snow spray (single Points system)
        this.snowSprayParticles = null;
        this.maxSnowParticles = 0;
        this._spray = null;
        this._sprayAccum = 0;
        this._brakeAccum = 0;

        // Ski trails
        this._trails = null;

        // Input
        this.input = { forward: false, backward: false, left: false, right: false, jump: false, tuck: false };

        // Ragdoll
        this.isRagdolling = false;
        this.ragdollTimer = 0;
        this.ragdollDuration = 999;
        this.ragdollVelocity = new THREE.Vector3();
        this.ragdollAngularVel = new THREE.Vector3();
        this.detachedSkis = [];
        this.bodyPartVelocities = {};
        this.detachedBodyParts = [];
        this.headSnowball = null;
        this.headSnowballSize = 1;
        this._fallingTrees = [];
        this._pendingCrashName = null;

        // Camera rig
        this.cameraOffset = new THREE.Vector3(0, 2.7, 7.4); // (height, distance) baseline
        this.cameraLookAhead = 2.5;
        this.cameraYaw = 0;
        this._camOffset = new THREE.Vector3();
        this._lookOffset = new THREE.Vector3();
        this._camAnchorY = 0;
        this._camRoll = 0;
        this._camFov = 60;
        this._trauma = 0;
        this._camAir = 0;
        this._shakeT = 0;
        this._reducedMotion = prefersReducedMotion();
        this.savedCameraPosition = null;
        this.savedCameraTarget = null;
        this._savedFov = 60;

        // Slow motion (scales physics delta only)
        this.timeScale = 1;
        this._slowmo = 0;

        // Collision bookkeeping
        this._lastCollideTime = 0;
        this._fallbackCollidables = null;
        this._fallbackCollidablesTime = 0;
        this._colliderCache = new WeakMap();

        // External systems (set by main.js)
        this.trees = null;
        this.objectPlacer = null;

        // Re-usable event payloads
        this._tickTrick = { active: true, label: '', progress01: 0 };
        this._tick = {
            speed: 0, speedMph: 0, speed01: 0, maxSpeedMph: 0, grounded: true, tucking: false,
            braking: false, switch: false, edge: 0, airTime: 0, totalAirTime: 0, score: 0, combo: 1,
            tricksLanded: 0, ragdoll: false, trick: null, hint: null,
        };
        this._liveTrickKey = '';
        this._pendingLand = null;

        // Night tint for effects
        this._night = false;
        events.on('env:night', (p) => this._applyNight(!!(p && p.night)));

        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
    }

    _freshStats() {
        return {
            maxSpeed: 0, totalAirTime: 0, currentAirTime: 0, tricksLanded: 0, tricksFailed: 0,
            totalSpins: 0, totalFlips: 0, bestCombo: 0, runStartTime: performance.now(),
        };
    }

    // =====================================================================
    // MESH
    // =====================================================================
    createMesh() {
        const mat = getMaterials();
        const geo = getGeometries();
        const mesh = (g, m, name) => {
            const o = new THREE.Mesh(g, m);
            if (name) o.name = name;
            o.castShadow = true;
            o.receiveShadow = true;
            return o;
        };

        const skier = new THREE.Group();
        skier.name = 'skier';

        // Skis live on the root so the landing squash doesn't flatten them.
        this.skiMeshes = [];
        [1, -1].forEach((side) => {
            const g = new THREE.Group();
            g.name = side === 1 ? 'leftSki' : 'rightSki';
            g.position.set(side * 0.13, 0, 0);
            g.add(mesh(geo.ski, mat.skiTop, 'skiBody'));
            g.add(mesh(geo.skiStripe, mat.skiStripe, 'skiStripe'));
            g.add(mesh(geo.binding, mat.binding, 'binding'));
            skier.add(g);
            this.skiMeshes.push(g);
        });

        // Everything else hangs off the rig (squash / stretch target).
        const rig = new THREE.Group();
        rig.name = 'skierRig';
        skier.add(rig);
        this.rig = rig;

        // Legs: ankle -> shin pivot -> knee pivot -> thigh.
        const legs = {};
        [1, -1].forEach((side) => {
            const root = new THREE.Group();
            root.position.set(side * 0.13, 0.03, 0);
            root.add(mesh(geo.boot, mat.boot, 'boot'));
            root.add(mesh(geo.bootCuff, mat.bootCuff, 'bootCuff'));
            const shinPivot = new THREE.Group();
            shinPivot.position.set(0, 0.18, -0.01);
            const shin = mesh(geo.shin, mat.pants, side === 1 ? 'leftShin' : 'rightShin');
            shinPivot.add(shin);
            const kneePivot = new THREE.Group();
            kneePivot.position.set(0, 0.44, 0);
            const thigh = mesh(geo.thigh, mat.pants, side === 1 ? 'leftThigh' : 'rightThigh');
            kneePivot.add(thigh);
            shinPivot.add(kneePivot);
            root.add(shinPivot);
            rig.add(root);
            legs[side] = { root, shinPivot, kneePivot, shin, thigh };
        });
        this._legs = legs;

        // Torso (pivot at the hip)
        const torso = new THREE.Group();
        torso.name = 'torso';
        torso.add(mesh(geo.pelvis, mat.pants, 'pelvis'));
        torso.add(mesh(geo.jacket, mat.jacket, 'jacket'));
        torso.add(mesh(geo.hem, mat.jacketDark, 'hem'));
        torso.add(mesh(geo.collar, mat.jacketDark, 'collar'));
        rig.add(torso);

        // Head
        const head = new THREE.Group();
        head.name = 'head';
        head.position.set(0, 0.72, 0.02);
        const face = mesh(geo.face, mat.skin, 'face');
        const helmet = mesh(geo.helmet, mat.helmet, 'helmet');
        const goggles = mesh(geo.goggles, mat.goggle, 'goggles');
        const strap = mesh(geo.strap, mat.strap, 'strap');
        goggles.castShadow = false;
        strap.castShadow = false;
        head.add(face, helmet, goggles, strap);
        torso.add(head);

        // Arms: shoulder pivot -> elbow pivot -> hand
        const arms = {};
        [1, -1].forEach((side) => {
            const shoulder = new THREE.Group();
            shoulder.position.set(side * 0.235, 0.52, 0.0);
            const upperArm = mesh(geo.upperArm, mat.jacket, side === 1 ? 'leftUpperArm' : 'rightUpperArm');
            shoulder.add(upperArm);
            const elbow = new THREE.Group();
            elbow.position.set(0, -0.27, 0);
            const forearm = mesh(geo.forearm, mat.jacket, side === 1 ? 'leftForearm' : 'rightForearm');
            elbow.add(forearm);
            const hand = new THREE.Group();
            hand.position.set(0, -0.26, 0);
            const glove = mesh(geo.glove, mat.glove, side === 1 ? 'leftGlove' : 'rightGlove');
            hand.add(glove);
            elbow.add(hand);
            shoulder.add(elbow);
            torso.add(shoulder);
            arms[side] = { shoulder, elbow, hand, upperArm, forearm, glove };
        });
        this._arms = arms;

        // Poles: children of the rig, glued to the hands each frame.
        const poles = {};
        [1, -1].forEach((side) => {
            const pole = new THREE.Group();
            pole.name = side === 1 ? 'leftPole' : 'rightPole';
            pole.add(mesh(geo.poleGrip, mat.glove, 'poleGrip'));
            pole.add(mesh(geo.poleShaft, mat.pole, 'poleShaft'));
            pole.add(mesh(geo.poleBasket, mat.basket, 'poleBasket'));
            rig.add(pole);
            poles[side] = pole;
        });
        this._poles = poles;

        this._torso = torso;
        this._head = head;
        this.bodyParts = {
            torso, head, helmet, goggles, strap,
            leftThigh: legs[1].thigh, rightThigh: legs[-1].thigh,
            leftShin: legs[1].shin, rightShin: legs[-1].shin,
            leftLeg: legs[1], rightLeg: legs[-1],
            leftArm: { upperArm: arms[1].upperArm, forearm: arms[1].forearm, glove: arms[1].glove },
            rightArm: { upperArm: arms[-1].upperArm, forearm: arms[-1].forearm, glove: arms[-1].glove },
            leftPole: poles[1], rightPole: poles[-1],
        };

        // Meshes that fly apart on a crash (head is handled as the snowball).
        this._explodeMeshes = [];
        rig.traverse((o) => {
            if (o.isMesh && o.parent !== head) this._explodeMeshes.push(o);
        });

        this.mesh = skier;
        this.resetBodyParts();
        return skier;
    }

    // =====================================================================
    // SNOW SPRAY (one Points draw call, soft round puffs)
    // =====================================================================
    createSnowSpray() {
        const preset = getPreset();
        const N = Math.max(40, Math.min(300, preset.sprayParticles | 0 || 200));
        if (this._spray && this._spray.N === N) return;
        if (this._spray) this._disposeSpray();

        const geometry = new THREE.BufferGeometry();
        const pos = new Float32Array(N * 3);
        const life01 = new Float32Array(N);
        const size = new Float32Array(N);
        const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
        const lifeAttr = new THREE.BufferAttribute(life01, 1).setUsage(THREE.DynamicDrawUsage);
        const sizeAttr = new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('position', posAttr);
        geometry.setAttribute('aLife', lifeAttr);
        geometry.setAttribute('aSize', sizeAttr);

        const tint = this._night ? NIGHT_SPRAY : DAY_SPRAY;
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uViewportHalfH: { value: 450 },
                uLit: { value: new THREE.Color(tint.lit) },
                uShade: { value: new THREE.Color(tint.shade) },
                uOpacity: { value: tint.opacity },
            },
            vertexShader: SPRAY_VERT,
            fragmentShader: SPRAY_FRAG,
            transparent: true,
            depthWrite: false,
        });

        const points = new THREE.Points(geometry, material);
        points.name = 'skierSnowSpray';
        points.frustumCulled = false;
        points.renderOrder = 2;

        this._spray = {
            N, points, geometry, material, pos, life01, size, posAttr, lifeAttr, sizeAttr,
            vel: new Float32Array(N * 3),
            life: new Float32Array(N),
            maxLife: new Float32Array(N),
            cursor: 0,
            alive: 0,
        };
        this.snowSprayParticles = points;
        this.maxSnowParticles = N;
    }

    _disposeSpray() {
        const s = this._spray;
        if (!s) return;
        if (s.points.parent) s.points.parent.remove(s.points);
        s.geometry.dispose();
        s.material.dispose();
        this._spray = null;
        this.snowSprayParticles = null;
    }

    _emitParticle(x, y, z, vx, vy, vz, life, size) {
        const s = this._spray;
        if (!s) return;
        const i = s.cursor;
        s.cursor = (s.cursor + 1) % s.N;
        const i3 = i * 3;
        s.pos[i3] = x; s.pos[i3 + 1] = y; s.pos[i3 + 2] = z;
        s.vel[i3] = vx; s.vel[i3 + 1] = vy; s.vel[i3 + 2] = vz;
        s.life[i] = life;
        s.maxLife[i] = life;
        s.size[i] = size;
        s.life01[i] = 1;
        s.alive = Math.max(s.alive, 1);
    }

    /** Back-compat: spray in `direction` from `position` with 0..1+ intensity. */
    emitSnowSpray(position, direction, intensity) {
        const n = Math.max(1, Math.round(intensity * 5));
        for (let k = 0; k < n; k++) {
            const sp = 2 + Math.random() * 3 * intensity;
            this._emitParticle(
                position.x, position.y + 0.1, position.z,
                direction.x * sp + this.velocity.x * 0.5, 1.5 + Math.random() * 2, direction.z * sp + this.velocity.z * 0.5,
                0.5 + Math.random() * 0.4, 0.25 + Math.random() * 0.3,
            );
        }
    }

    /** Radial burst of snow (landing, crash, collisions, tree knock). */
    sprayBurst(x, y, z, count, power = 1, inheritVel = 0.3) {
        const s = this._spray;
        if (!s) return;
        count = Math.min(count | 0, s.N >> 1);
        for (let k = 0; k < count; k++) {
            const a = Math.random() * TAU;
            const r = (1.5 + Math.random() * 3.5) * power;
            this._emitParticle(
                x + Math.cos(a) * 0.3, y + 0.08, z + Math.sin(a) * 0.3,
                Math.cos(a) * r + this.velocity.x * inheritVel,
                (1.2 + Math.random() * 2.6) * Math.sqrt(power),
                Math.sin(a) * r + this.velocity.z * inheritVel,
                0.55 + Math.random() * 0.6, 0.22 + Math.random() * 0.28 * Math.min(power, 1.2),
            );
        }
    }

    updateSnowSpray(delta) {
        const s = this._spray;
        if (!s || s.alive === 0) return;

        const drag = Math.exp(-1.6 * delta);
        const g = 9;
        let alive = 0;
        for (let i = 0; i < s.N; i++) {
            if (s.life[i] <= 0) {
                if (s.life01[i] !== 0) s.life01[i] = 0;
                continue;
            }
            s.life[i] -= delta;
            const i3 = i * 3;
            s.vel[i3] *= drag;
            s.vel[i3 + 2] *= drag;
            s.vel[i3 + 1] = s.vel[i3 + 1] * drag - g * delta;
            s.pos[i3] += s.vel[i3] * delta;
            s.pos[i3 + 1] += s.vel[i3 + 1] * delta;
            s.pos[i3 + 2] += s.vel[i3 + 2] * delta;
            // settle on the snow instead of sinking through it
            if (s.vel[i3 + 1] < 0) {
                const gy = this.mountain.getHeightAt(s.pos[i3], s.pos[i3 + 2]) + 0.05;
                if (s.pos[i3 + 1] < gy) {
                    s.pos[i3 + 1] = gy;
                    s.vel[i3] *= 0.4; s.vel[i3 + 1] = 0; s.vel[i3 + 2] *= 0.4;
                    s.life[i] = Math.min(s.life[i], 0.25);
                }
            }
            s.life01[i] = s.life[i] > 0 ? s.life[i] / s.maxLife[i] : 0;
            if (s.life[i] > 0) alive++;
        }
        s.alive = alive;
        s.posAttr.needsUpdate = true;
        s.lifeAttr.needsUpdate = true;
        s.sizeAttr.needsUpdate = true;

        const pr = Math.min(window.devicePixelRatio || 1, getPreset().pixelRatioCap || 2);
        s.material.uniforms.uViewportHalfH.value = (window.innerHeight * pr) * 0.5;
    }

    // =====================================================================
    // CONTACT SHADOW: a soft blob under the boots so the skier always reads as
    // planted (the low sun throws the real shadow well off to the side).
    // =====================================================================
    _createContactShadow() {
        if (this._contact) return;
        const size = 64;
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, size, size);
        const tex = new THREE.CanvasTexture(c);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x1b2742, map: tex, transparent: true, opacity: 0.32,
            depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
        });
        const geo = new THREE.PlaneGeometry(1.5, 2.4);
        geo.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(geo, mat);
        m.name = 'skierContactShadow';
        m.renderOrder = 1;
        m.frustumCulled = false;
        m.userData.isDecal = true;
        const up = new THREE.Vector3(0, 1, 0);
        const qN = new THREE.Quaternion();
        const qY = new THREE.Quaternion();
        const n = new THREE.Vector3();
        m.onBeforeRender = () => {
            const ragdoll = this.isRagdolling && this.headSnowball;
            const p = ragdoll ? this.headSnowball.mesh.position : this.position;
            const gy = this.mountain.getHeightAt(p.x, p.z);
            const h = Math.max(0, p.y - gy);
            const k = Math.max(0, 1 - h / 6);           // fades as the skier gets air
            this._sampleNormal(p.x, p.z, n);
            qN.setFromUnitVectors(up, n);
            qY.setFromAxisAngle(up, this.rotation);
            m.quaternion.copy(qN).multiply(qY);
            m.position.set(p.x, gy + 0.06, p.z);
            const sc = (ragdoll ? 1.4 : 1) * (0.7 + 0.3 * k);
            m.scale.set(sc, 1, sc);
            mat.opacity = 0.32 * k * (this.mesh && this.mesh.visible ? 1 : ragdoll ? 0.8 : 0);
            m.updateMatrixWorld();
        };
        this._contact = m;
    }

    // =====================================================================
    // SKI TRAILS (two fading ribbons pressed into the snow)
    // =====================================================================
    _createTrails() {
        if (this._trails) return;
        const N = 300;
        const tint = this._night ? NIGHT_TRAIL : DAY_TRAIL;
        const material = new THREE.ShaderMaterial({
            uniforms: THREE.UniformsUtils.merge([
                THREE.UniformsLib.fog,
                {
                    uTime: { value: 0 },
                    uLife: { value: 16 },
                    uColor: { value: new THREE.Color().setRGB(...tint.color) },
                    uRim: { value: new THREE.Color().setRGB(...tint.rim) },
                    uOpacity: { value: tint.opacity },
                },
            ]),
            vertexShader: TRAIL_VERT,
            fragmentShader: TRAIL_FRAG,
            transparent: true,
            depthWrite: false,
            fog: true,
            toneMapped: false,
            blending: THREE.CustomBlending,
            blendEquation: THREE.AddEquation,
            blendSrc: THREE.DstColorFactor,
            blendDst: THREE.ZeroFactor,
            blendSrcAlpha: THREE.ZeroFactor,
            blendDstAlpha: THREE.OneFactor,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
        });

        // Static index: segment i joins point i and i+1 (point = 2 verts).
        const idx = new Uint16Array((N - 1) * 6);
        for (let i = 0; i < N - 1; i++) {
            const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
            idx.set([a, c, b, b, c, d], i * 6);
        }
        const edge = new Float32Array(N * 2);
        for (let i = 0; i < N; i++) { edge[i * 2] = 0; edge[i * 2 + 1] = 1; }

        const ribbons = [1, -1].map((side) => {
            const geometry = new THREE.BufferGeometry();
            const pos = new Float32Array(N * 2 * 3);
            const birth = new Float32Array(N * 2).fill(-1e6);
            const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
            const birthAttr = new THREE.BufferAttribute(birth, 1).setUsage(THREE.DynamicDrawUsage);
            geometry.setAttribute('position', posAttr);
            geometry.setAttribute('aBirth', birthAttr);
            geometry.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
            geometry.setIndex(new THREE.BufferAttribute(idx, 1));
            geometry.setDrawRange(0, 0);
            const m = new THREE.Mesh(geometry, material);
            m.name = 'skiTrail';
            m.frustumCulled = false;
            m.renderOrder = 1;
            return { side, geometry, pos, birth, posAttr, birthAttr, mesh: m, count: 0, lastX: 0, lastZ: 0, broken: true };
        });

        this._trails = { N, material, ribbons, time: 0 };
    }

    _clearTrails() {
        const t = this._trails;
        if (!t) return;
        for (const r of t.ribbons) {
            r.count = 0;
            r.broken = true;
            r.birth.fill(-1e6);
            r.geometry.setDrawRange(0, 0);
            r.birthAttr.needsUpdate = true;
        }
    }

    _trailWritePoint(r, i, cx, cz, sx, sz, birth) {
        const hw = 0.07;
        const lx = cx - sx * hw, lz = cz - sz * hw;
        const rx = cx + sx * hw, rz = cz + sz * hw;
        const o = i * 6;
        r.pos[o] = lx; r.pos[o + 1] = this.mountain.getHeightAt(lx, lz) + 0.045; r.pos[o + 2] = lz;
        r.pos[o + 3] = rx; r.pos[o + 4] = this.mountain.getHeightAt(rx, rz) + 0.045; r.pos[o + 5] = rz;
        r.birth[i * 2] = birth;
        r.birth[i * 2 + 1] = birth;
    }

    _trailPush(r, cx, cz, sx, sz, birth) {
        const N = this._trails.N;
        if (r.count >= N) {
            // shift everything one point toward the start (oldest drops off)
            r.pos.copyWithin(0, 6);
            r.birth.copyWithin(0, 2);
            r.count = N - 1;
        }
        this._trailWritePoint(r, r.count, cx, cz, sx, sz, birth);
        r.count++;
    }

    updateTrails(delta) {
        const t = this._trails;
        if (!t) return;
        t.time += delta;
        t.material.uniforms.uTime.value = t.time;

        const onSnow = this.isGrounded && !this.isRagdolling && Math.abs(this.currentSpeed) > 1.5;
        // Lateral (left) vector of the skis, and motion direction
        const fx = Math.sin(this.rotation), fz = Math.cos(this.rotation);
        const lx = fz, lz = -fx; // +X local == left
        const spacing = 0.7;

        for (const r of t.ribbons) {
            if (!onSnow) {
                r.broken = true;
                continue;
            }
            const cx = this.position.x + lx * 0.13 * r.side - fx * 0.15;
            const cz = this.position.z + lz * 0.13 * r.side - fz * 0.15;
            if (r.broken || r.count === 0) {
                if (r.count > 0) {
                    // Break: an invisible bridge so separate strips never connect.
                    const last = (r.count - 1) * 6;
                    const px = (r.pos[last] + r.pos[last + 3]) * 0.5;
                    const pz = (r.pos[last + 2] + r.pos[last + 5]) * 0.5;
                    this._trailPush(r, px, pz, lx, lz, -1e6);
                    this._trailPush(r, cx, cz, lx, lz, -1e6);
                }
                this._trailPush(r, cx, cz, lx, lz, t.time);
                this._trailPush(r, cx, cz, lx, lz, t.time); // live head point
                r.lastX = cx; r.lastZ = cz;
                r.broken = false;
            } else {
                const dx = cx - r.lastX, dz = cz - r.lastZ;
                if (dx * dx + dz * dz > spacing * spacing) {
                    this._trailPush(r, cx, cz, lx, lz, t.time);
                    r.lastX = cx; r.lastZ = cz;
                } else {
                    // keep the head glued to the ski
                    this._trailWritePoint(r, r.count - 1, cx, cz, lx, lz, t.time);
                }
            }
            r.geometry.setDrawRange(0, Math.max(0, r.count - 1) * 6);
            r.posAttr.needsUpdate = true;
            r.birthAttr.needsUpdate = true;
        }
    }

    _applyNight(night) {
        this._night = night;
        // Night readability: hi-vis gear glows faintly (reflective trim) and the
        // goggles catch the light, so the skier never reads as a flat silhouette.
        const mats = getMaterials();
        ['jacket', 'jacketDark', 'helmet', 'skiTop', 'skiStripe', 'basket', 'boot'].forEach((k) => {
            const m = mats[k];
            if (!m) return;
            if (night) m.emissive.copy(m.color).multiplyScalar(0.28);
            else m.emissive.setRGB(0, 0, 0);
        });
        mats.goggle.emissiveIntensity = night ? 1.4 : 0.4;
        const st = night ? NIGHT_SPRAY : DAY_SPRAY;
        if (this._spray) {
            const u = this._spray.material.uniforms;
            u.uLit.value.setHex(st.lit);
            u.uShade.value.setHex(st.shade);
            u.uOpacity.value = st.opacity;
        }
        const tt = night ? NIGHT_TRAIL : DAY_TRAIL;
        if (this._trails) {
            const u = this._trails.material.uniforms;
            u.uColor.value.setRGB(...tt.color);
            u.uRim.value.setRGB(...tt.rim);
            u.uOpacity.value = tt.opacity;
        }
    }

    // =====================================================================
    // LIFECYCLE
    // =====================================================================
    place(x, z) {
        if (this.isActive) this.remove({ instant: true });
        if (!this.mesh) this.createMesh();

        const y = this.mountain.getHeightAt(x, z);
        this.position.set(x, y, z);
        this.mesh.position.copy(this.position);
        this.mesh.visible = true;
        this.skiMeshes.forEach((s) => { s.visible = true; });

        const n = this._sampleNormal(x, z, _v1);
        this.rotation = Math.atan2(n.x, n.z);
        this.mesh.rotation.set(0, this.rotation, 0);

        this.startPosition.set(x, y, z);
        this.startRotation = this.rotation;

        this._resetMotion();

        this.score = 0;
        this.comboMultiplier = 1;
        this.lastTrickTime = 0;
        this.stats = this._freshStats();
        this.timeScale = 1;
        this._slowmo = 0;

        this.scene.add(this.mesh);

        this.createSnowSpray();
        this.scene.add(this._spray.points);
        this._createContactShadow();
        this.scene.add(this._contact);
        this._createTrails();
        this._clearTrails();
        this._trails.ribbons.forEach((r) => this.scene.add(r.mesh));

        // Camera: save the editor view, then swoop in from it.
        // If the camera is still flying back from a previous run, save the
        // flight's destination (the real editor view), not a mid-flight frame.
        const dest = this.cameraControls.flightDestination ? this.cameraControls.flightDestination() : null;
        if (dest) {
            this.savedCameraPosition = dest.position.clone();
            this.savedCameraTarget = dest.target.clone();
            this._savedFov = dest.fov ?? this._savedFov ?? 60;
            this.cameraControls.cancelFly();
        } else {
            this.savedCameraPosition = this.camera.position.clone();
            this.savedCameraTarget = this.cameraControls.controls.target.clone();
            this._savedFov = this.camera.fov || 60;
        }
        this._camFov = this._savedFov;
        this._camOffset.copy(this.camera.position).sub(this.position);
        this._lookOffset.copy(this.cameraControls.controls.target).sub(this.position);
        this._camAnchorY = this.position.y;
        this._camRoll = 0;
        this._trauma = 0;
        this._camAir = 0;
        this.cameraControls.setEnabled(false);

        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);

        this.isActive = true;
        events.emit('ski:start', { x, z });
        return this.mesh;
    }

    _resetMotion() {
        this.velocity.set(0, 0, 0);
        this.verticalVelocity = 0;
        this.currentSpeed = 0;
        this.isGrounded = true;
        this.isJumping = false;
        this.edgeAngle = 0;
        this.turnMomentum = 0;
        this.cameraYaw = this.rotation;
        this.flipRotation = 0;
        this.flipVelocity = 0;
        this._flipRate = FLIP_RATE;
        this.isFlipping = false;
        this.spinRotation = 0;
        this.spinVelocity = 0;
        this.isSpinning = false;
        this.totalSpinDegrees = 0;
        this.lastTerrainSlope = 0;
        this._airG = this.airGravity;
        this._spinArmed = true;
        this._noSteerTime = 0;
        this.isTucking = false;
        this.isBraking = false;
        this.currentTrick = { spinDegrees: 0, hasFlip: false, flipDirection: 0, numFlips: 0, startTime: 0 };
        this.stats.currentAirTime = 0;
        this._pendingLand = null;
        for (const k in this.input) this.input[k] = false;
    }

    _clearRagdoll() {
        this.detachedBodyParts.forEach((p) => this.scene.remove(p.mesh));
        this.detachedBodyParts = [];
        this.detachedSkis.forEach((s) => this.scene.remove(s.mesh));
        this.detachedSkis = [];
        if (this.headSnowball) {
            this.scene.remove(this.headSnowball.mesh);
            this.headSnowball = null;
        }
        this.isRagdolling = false;
    }

    remove(opts = {}) {
        if (!this.isActive) return;
        this.isActive = false;

        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);

        this._clearRagdoll();
        this._finishFallingTrees();

        if (this.mesh) this.scene.remove(this.mesh);
        if (this._spray) this.scene.remove(this._spray.points);
        if (this._contact) this.scene.remove(this._contact);
        if (this._trails) this._trails.ribbons.forEach((r) => this.scene.remove(r.mesh));

        const runSeconds = (performance.now() - this.stats.runStartTime) / 1000;
        events.emit('ski:end', {
            score: this.score,
            stats: {
                maxSpeedMph: Math.round(this.stats.maxSpeed * MPH),
                totalAirTime: this.stats.totalAirTime,
                tricksLanded: this.stats.tricksLanded,
                tricksFailed: this.stats.tricksFailed,
                bestCombo: this.stats.bestCombo,
                runSeconds,
            },
        });

        // Restore the editor camera with an eased flight (FOV eases back too).
        this.cameraControls.setEnabled(true);
        if (this.savedCameraPosition && this.savedCameraTarget) {
            if (!opts.instant && typeof this.cameraControls.flyTo === 'function') {
                this.cameraControls.flyTo(this.savedCameraPosition, this.savedCameraTarget, 1.4, { fov: this._savedFov });
            } else {
                this.camera.position.copy(this.savedCameraPosition);
                this.cameraControls.controls.target.copy(this.savedCameraTarget);
                this.camera.fov = this._savedFov;
                this.camera.updateProjectionMatrix();
            }
        } else {
            this.camera.fov = this._savedFov;
            this.camera.updateProjectionMatrix();
        }
        this.timeScale = 1;
    }

    resetToStart() {
        this._clearRagdoll();
        if (!this.mesh) return;
        this.skiMeshes.forEach((s) => { s.visible = true; });
        this.mesh.visible = true;

        const y = this.mountain.getHeightAt(this.startPosition.x, this.startPosition.z);
        this.position.set(this.startPosition.x, y, this.startPosition.z);
        this.rotation = this.startRotation;
        this._resetMotion();
        this.headSnowballSize = 1;
        this.mesh.position.copy(this.position);
        this.mesh.rotation.set(0, this.rotation, 0);
        this._baseQuatValid = false;
        this.resetBodyParts();
        this._clearTrails();
        this._camAnchorY = this.position.y;
        events.emit('ski:reset', {});
    }

    // =====================================================================
    // INPUT
    // =====================================================================
    onKeyDown(e) {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
        let handled = true;
        switch (e.code) {
            case 'KeyW':
            case 'ArrowUp':
            {
                // Flips need a fresh press after takeoff: held keys / OS auto-repeat
                // while tucking over a roller must never start one.
                const fresh = !e.repeat && !this.input.forward;
                this.input.forward = true;
                this.input.tuck = true;
                if (fresh && this._canStartFlip()) this.startFlip(1);
                break;
            }
            case 'KeyS':
            case 'ArrowDown':
            {
                const fresh = !e.repeat && !this.input.backward;
                if (fresh && this.isGrounded && Math.abs(this.currentSpeed) > 12) this._brakeBurst = true;
                this.input.backward = true;
                if (fresh && this._canStartFlip()) this.startFlip(-1);
                break;
            }
            case 'KeyA':
            case 'ArrowLeft':
                this.input.left = true;
                break;
            case 'KeyD':
            case 'ArrowRight':
                this.input.right = true;
                break;
            case 'Space':
                if (this.isRagdolling) this.recoverFromRagdoll();
                else if (this.isGrounded && !this.isJumping) this.input.jump = true;
                break;
            case 'Escape':
                this.remove();
                break;
            case 'KeyR':
                this.resetToStart();
                break;
            default:
                handled = false;
        }
        if (handled) e.preventDefault();
    }

    onKeyUp(e) {
        let handled = true;
        switch (e.code) {
            case 'KeyW':
            case 'ArrowUp':
                this.input.forward = false;
                this.input.tuck = false;
                break;
            case 'KeyS':
            case 'ArrowDown':
                this.input.backward = false;
                break;
            case 'KeyA':
            case 'ArrowLeft':
                this.input.left = false;
                break;
            case 'KeyD':
            case 'ArrowRight':
                this.input.right = false;
                break;
            case 'Space':
                this.input.jump = false;
                break;
            default:
                handled = false;
        }
        if (handled) e.preventDefault();
    }

    // =====================================================================
    // TRICKS
    // =====================================================================
    /** Flips start on a fresh press while rising or just past the apex. */
    _canStartFlip() {
        return !this.isGrounded && !this.isFlipping && !this.isRagdolling && this.verticalVelocity > -2;
    }

    startFlip(direction) {
        this.isFlipping = true;
        this.flipDirection = direction;
        this.flipRotation = 0;
        // Arcade assist: time the flip to the (flat-ground) estimate of the air left.
        const g = this._airG, vy = this.verticalVelocity;
        const h = Math.max(0, this.position.y - this.mountain.getHeightAt(this.position.x, this.position.z));
        const tLeft = (vy + Math.sqrt(vy * vy + 2 * g * h)) / g;
        this._flipRate = THREE.MathUtils.clamp(TAU / Math.max(tLeft * 0.85, 0.01), FLIP_RATE, FLIP_RATE_MAX);
        this.flipVelocity = direction * this._flipRate;
        this.trickLanded = false;
    }

    /**
     * Tap W/S = one flip that completes itself; hold to keep rotating. On release the
     * flip settles onto the next whole rotation (backing up at most ~45 degrees).
     */
    updateFlip(delta) {
        if (!this.isFlipping) return;

        if (!this.isGrounded) {
            const held = this.flipDirection > 0 ? this.input.forward : this.input.backward;
            if (held) {
                this.flipVelocity = this.flipDirection * this._flipRate;
            } else {
                const turns = Math.max(1, Math.ceil(Math.abs(this.flipRotation) / TAU - 0.12));
                const dist = this.flipDirection * turns * TAU - this.flipRotation;
                this.flipVelocity = Math.abs(dist) < 0.004 ? 0 : Math.sign(dist) * Math.min(this._flipRate, Math.abs(dist) * 10 + 1);
                if (this.flipVelocity === 0) this.flipRotation = this.flipDirection * turns * TAU;
            }
            this.flipRotation += this.flipVelocity * delta;
            if (Math.abs(this.flipRotation) >= TAU && !this.trickLanded) this.trickLanded = true;
            return;
        }

        // Landed: forgive a residual of up to FLIP_LAND_TOL off a whole rotation.
        const turnsF = Math.abs(this.flipRotation) / TAU;
        const numFlips = Math.round(turnsF);
        const residual = Math.abs(turnsF - numFlips) * TAU;
        const cleanLanding = residual < FLIP_LAND_TOL;

        if (numFlips > 0) {
            this.currentTrick.hasFlip = true;
            this.currentTrick.flipDirection = this.flipDirection;
            this.currentTrick.numFlips = numFlips;
        }

        if (!cleanLanding) {
            this.awardTrickPoints(false);
            this.startRagdoll();
            return;
        } else if (numFlips > 0 && !this.isSpinning) {
            this.awardTrickPoints(true);
        }

        // Keep the airborne pose so the residual eases out instead of snapping.
        if (residual > 0.01 && this._baseQuat && !this.isSpinning) this._baseQuat.copy(this.mesh.quaternion);
        this.isFlipping = false;
        this.flipRotation = 0;
        this.flipVelocity = 0;
    }

    /**
     * A/D in the air spins at SPIN_RATE; on release the spin settles onto the
     * nearest 180 ahead (backing up at most ~36 degrees).
     */
    _updateAirSpin(steer, delta) {
        if (steer !== 0) {
            if (!this.isSpinning) {
                this.isSpinning = true;
                this.spinRotation = 0;
                this.totalSpinDegrees = 0;
            }
            const target = steer * SPIN_RATE;
            const dv = target - this.spinVelocity;
            this.spinVelocity += Math.sign(dv) * Math.min(Math.abs(dv), SPIN_ACCEL * delta);
        } else if (this.isSpinning) {
            const dir = Math.sign(this.spinRotation) || Math.sign(this.spinVelocity) || 1;
            const halves = Math.max(0, Math.ceil(Math.abs(this.spinRotation) / Math.PI - 0.2));
            const dist = dir * halves * Math.PI - this.spinRotation;
            this.spinVelocity = Math.abs(dist) < 0.004 ? 0 : Math.sign(dist) * Math.min(SPIN_RATE, Math.abs(dist) * 9 + 0.8);
            if (this.spinVelocity === 0) this.spinRotation = dir * halves * Math.PI;
        }
        if (this.isSpinning) {
            this.spinRotation += this.spinVelocity * delta;
            this.totalSpinDegrees = Math.abs(this.spinRotation) / DEG;
        }
    }

    updateSpin(delta) {
        if (this.isSpinning && this.isGrounded) {
            const spinDegrees = Math.abs(this.spinRotation) / DEG;
            const nearestHalf = Math.round(spinDegrees / 180) * 180;
            const landingError = Math.abs(spinDegrees - nearestHalf);
            const cleanLanding = landingError < SPIN_LAND_TOL;

            if (spinDegrees >= 180) this.currentTrick.spinDegrees = nearestHalf;

            if (!cleanLanding && spinDegrees > 90) {
                this.awardTrickPoints(false);
                this.startRagdoll();
                return;
            } else if (nearestHalf >= 180 || this.currentTrick.hasFlip) {
                this.awardTrickPoints(true);
            }

            // Auto-correct: land square to the travel line (forwards or switch).
            const preSpinVelX = this.velocity.x;
            const preSpinVelZ = this.velocity.z;
            this.rotation += Math.sign(this.spinRotation) * nearestHalf * DEG;
            this.currentSpeed = preSpinVelX * Math.sin(this.rotation) + preSpinVelZ * Math.cos(this.rotation);
            this.velocity.x = preSpinVelX;
            this.velocity.z = preSpinVelZ;

            this.isSpinning = false;
            this.spinRotation = 0;
            this.spinVelocity = 0;
            this.totalSpinDegrees = 0;
            // Ease from the airborne pose to the new heading rather than snapping.
            if (this._baseQuat && this._baseQuatValid) this._baseQuat.copy(this.mesh.quaternion);
            else this._baseQuatValid = false;
        }
    }

    awardTrickPoints(cleanLanding) {
        let points = 0;
        const spinDegrees = this.currentTrick.spinDegrees || 0;
        if (spinDegrees >= 180) {
            points += SPIN_POINTS[spinDegrees] || spinDegrees * 2;
            this.stats.totalSpins++;
        }
        const numFlips = this.currentTrick.hasFlip ? (this.currentTrick.numFlips || 1) : 0;
        if (numFlips) {
            points += FLIP_POINTS[Math.min(numFlips, 4)];
            this.stats.totalFlips++;
        }
        const trickName = nameTrick(spinDegrees, numFlips, this.currentTrick.flipDirection);

        if (points > 0) {
            if (cleanLanding) {
                const now = performance.now();
                if (now - this.lastTrickTime < 3000) {
                    this.comboMultiplier = Math.min(this.comboMultiplier + 0.5, 4);
                } else {
                    this.comboMultiplier = 1;
                }
                this.lastTrickTime = now;

                points = Math.round(points * 1.2 * this.comboMultiplier);
                this.score += points;
                this.stats.tricksLanded++;
                this.stats.bestCombo = Math.max(this.stats.bestCombo, this.comboMultiplier);

                events.emit('ski:trick', {
                    name: trickName,
                    points,
                    combo: this.comboMultiplier,
                    spinDegrees,
                    flips: numFlips,
                    flipDirection: this.currentTrick.flipDirection || 0,
                });
                if (points >= 1000) this._slowmo = 0.42; // brief bullet-time on big landings
                this._addTrauma(0.15);
            } else {
                this.comboMultiplier = 1;
                this.stats.tricksFailed++;
                this._pendingCrashName = trickName;
            }
        }

        this.currentTrick = { spinDegrees: 0, hasFlip: false, flipDirection: 0, numFlips: 0, startTime: 0 };
    }

    // =====================================================================
    // UPDATE
    // =====================================================================
    _sampleNormal(x, z, out) {
        const e = 2.0;
        const h = this.mountain.getHeightAt(x, z);
        const hx = this.mountain.getHeightAt(x + e, z);
        const hz = this.mountain.getHeightAt(x, z + e);
        return out.set(h - hx, e, h - hz).normalize();
    }

    _updateTimeScale(rawDelta) {
        if (this._slowmo > 0) {
            this._slowmo -= rawDelta;
            // ease 1 -> 0.6 -> 1 over the window
            const t = clamp01(this._slowmo / 0.42);
            const w = Math.sin(t * Math.PI);
            this.timeScale = 1 - 0.4 * Math.min(1, w * 1.6);
        } else {
            this.timeScale = damp(this.timeScale, 1, 10, rawDelta);
        }
    }

    update(delta) {
        if (!this.isActive || !this.mesh) return;

        const rawDelta = Math.min(delta, 0.05);
        this._updateTimeScale(rawDelta);
        delta = rawDelta * this.timeScale;
        this._time += delta;

        this._updateFallingTrees(delta);

        if (this.isRagdolling) {
            this.updateRagdoll(delta);
            this.updateCamera(rawDelta);
            this.updateSnowSpray(delta);
            this.updateTrails(delta);
            this._emitTick();
            return;
        }

        // Stats
        const absSpeed = Math.abs(this.currentSpeed);
        if (absSpeed > this.stats.maxSpeed) this.stats.maxSpeed = absSpeed;
        if (!this.isGrounded) {
            this.stats.currentAirTime += delta;
        } else if (this.stats.currentAirTime > 0) {
            this.stats.totalAirTime += this.stats.currentAirTime;
            this.stats.currentAirTime = 0;
            this.airHintCount++;
        }

        const terrainHeight = this.mountain.getHeightAt(this.position.x, this.position.z);
        const terrainNormal = this._sampleNormal(this.position.x, this.position.z, _v1);
        const slopeSteepness = Math.sqrt(terrainNormal.x * terrainNormal.x + terrainNormal.z * terrainNormal.z);

        const slopeDir = _v2.set(terrainNormal.x, 0, terrainNormal.z);
        if (slopeDir.lengthSq() > 0.0001) slopeDir.normalize();

        const fwdX = Math.sin(this.rotation);
        const fwdZ = Math.cos(this.rotation);

        // Turning: two-stage smoothing; controls stay camera-relative when switch
        const isSwitch = this.currentSpeed < -0.5;
        const rawEdge = this.input.left ? 1.0 : (this.input.right ? -1.0 : 0);
        const targetEdge = isSwitch ? -rawEdge : rawEdge;
        const edgeLerp = targetEdge !== 0 ? 0.04 : 0.06;
        this.edgeAngle = THREE.MathUtils.lerp(this.edgeAngle, targetEdge, lerpFactor(edgeLerp, delta));

        if (Math.abs(this.edgeAngle) > 0.01 && this.isGrounded) {
            const speedMult = 0.5 + Math.min(this.currentSpeed / 30, 1.5);
            const targetTurnRate = this.edgeAngle * this.turnSpeed * speedMult;
            this.turnMomentum = THREE.MathUtils.lerp(this.turnMomentum, targetTurnRate, lerpFactor(0.06, delta));
            this.rotation += this.turnMomentum * delta;
        } else {
            this.turnMomentum *= frameMul(0.92, delta);
        }

        if (this.isGrounded) {
            const downhillAlignment = fwdX * slopeDir.x + fwdZ * slopeDir.z;
            const gravityAccel = this.gravity * slopeSteepness * downhillAlignment;

            if (Math.abs(this.currentSpeed) < 5 && this.currentSpeed >= 0 && slopeSteepness > 0.02 && slopeDir.lengthSq() > 0.0001) {
                const fallLineAngle = Math.atan2(slopeDir.x, slopeDir.z);
                const diff = Math.atan2(Math.sin(fallLineAngle - this.rotation), Math.cos(fallLineAngle - this.rotation));
                this.rotation += diff * 0.5 * delta;
            }

            // Hands-off fall-line assist: after ~0.6s without steering, ease the heading
            // toward the broad downhill direction so a passive rider never stalls on a
            // traverse or flat. Sampled wide (+/-12) so bumps don't steer it.
            this._noSteerTime = rawEdge === 0 ? this._noSteerTime + delta : 0;
            if (this._noSteerTime > 0.6 && this.currentSpeed > 0.5) {
                const r = 12, px = this.position.x, pz = this.position.z, m = this.mountain;
                const gx = m.getHeightAt(px - r, pz) - m.getHeightAt(px + r, pz);
                const gz = m.getHeightAt(px, pz - r) - m.getHeightAt(px, pz + r);
                if (gx * gx + gz * gz > 0.04) {
                    const diff = Math.atan2(Math.sin(Math.atan2(gx, gz) - this.rotation), Math.cos(Math.atan2(gx, gz) - this.rotation));
                    if (Math.abs(diff) < 1.9) this.rotation += diff * Math.min(1, (this._noSteerTime - 0.6) * 2) * 0.3 * delta;
                }
            }

            const minAccel = slopeSteepness * 12;
            const effectiveAccel = Math.abs(this.currentSpeed) < 5 ? Math.max(gravityAccel, minAccel) : gravityAccel;
            this.currentSpeed += effectiveAccel * delta;

            if (downhillAlignment < -0.1) {
                this.currentSpeed += this.gravity * slopeSteepness * downhillAlignment * delta * 0.5;
            }

            this.isTucking = this.input.tuck && Math.abs(this.edgeAngle) < 0.3;

            const baseFriction = this.isTucking ? 0.0005 : 0.002;
            const turnFriction = Math.abs(this.edgeAngle) * 0.02;
            // Quadratic drag sets a terminal speed (~47 u/s tucked, ~38 carving on
            // a steep pitch) so runs stay readable instead of rocketing past 100 mph.
            const airDrag = this.isTucking ? 0.00007 : 0.00012;
            const speedDrag = Math.abs(this.currentSpeed) * airDrag;
            this.currentSpeed *= frameMul(1 - baseFriction - turnFriction - speedDrag, delta);

            this.isBraking = this.input.backward && !this.isTucking;
            if (this.isBraking) this.currentSpeed *= frameMul(this.brakeForce, delta);

            const effectiveMaxSpeed = this.isTucking ? this.maxSpeed * 1.3 : this.maxSpeed;
            this.currentSpeed = THREE.MathUtils.clamp(this.currentSpeed, -effectiveMaxSpeed, effectiveMaxSpeed);

            this.velocity.x = fwdX * this.currentSpeed;
            this.velocity.z = fwdZ * this.currentSpeed;

            if (this.input.jump) {
                const nextH = this.mountain.getHeightAt(this.position.x + this.velocity.x * delta, this.position.z + this.velocity.z * delta);
                const upcomingDrop = terrainHeight - nextH;
                // ~0.5s of air on the flat; a little extra popping off a lip at speed.
                let jumpBoost = this.jumpForce;
                if (upcomingDrop > 0.2 && this.currentSpeed > 10) jumpBoost += this.currentSpeed * 0.04;
                this.verticalVelocity = Math.min(jumpBoost, 7.5);
                this._airG = TRICK_AIR_GRAVITY;
                this._spinArmed = true;
                this.isGrounded = false;
                this.isJumping = true;
                this.input.jump = false;
                events.emit('ski:jump', { source: 'manual', power: this.verticalVelocity, speed: Math.abs(this.currentSpeed) });
            }
        } else {
            this.isBraking = false;
            const hang = Math.abs(this.verticalVelocity) < HANG_VY && this._airG === TRICK_AIR_GRAVITY ? HANG_GRAVITY_MUL : 1;
            this.verticalVelocity -= this._airG * hang * delta;
            const af = frameMul(1 - this.airFriction, delta);
            this.velocity.x *= af;
            this.velocity.z *= af;
            this.currentSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);

            // Spins read the keys directly (no edge smoothing) so they respond instantly.
            // A carve held over a roller pop doesn't spin until re-pressed; it just steers.
            if (rawEdge === 0) this._spinArmed = true;
            if (this._spinArmed || this.isSpinning) this._updateAirSpin(rawEdge, delta);
            else this.rotation += this.edgeAngle * 0.5 * delta;
        }

        this.position.x += this.velocity.x * delta;
        this.position.z += this.velocity.z * delta;

        const newTerrainHeight = this.mountain.getHeightAt(this.position.x, this.position.z);

        if (this.isGrounded && !this.isJumping) {
            const lookAheadDist = 3.0;
            const aheadHeight = this.mountain.getHeightAt(this.position.x + fwdX * lookAheadDist, this.position.z + fwdZ * lookAheadDist);
            const currentSlope = (aheadHeight - terrainHeight) / lookAheadDist;
            const slopeChange = currentSlope - this.lastTerrainSlope;
            const now = performance.now();

            if (slopeChange < -0.15 && this.currentSpeed > 12 && now - this.lastSlopeChangeTime > 500) {
                const inflectionStrength = Math.min(Math.abs(slopeChange) * 3, 1.5);
                this.verticalVelocity = Math.min(this.currentSpeed * 0.08 * inflectionStrength + 1, 5);
                this._airG = ROLLER_AIR_GRAVITY;
                this._spinArmed = rawEdge === 0;
                this.isGrounded = false;
                this.isJumping = true;
                this.lastSlopeChangeTime = now;
                this.position.y = terrainHeight;
                events.emit('ski:jump', { source: 'natural', power: this.verticalVelocity, speed: this.currentSpeed });
            } else {
                this.position.y = newTerrainHeight;
                this.verticalVelocity = 0;
            }
            this.lastTerrainSlope = currentSlope;
        } else {
            this.position.y += this.verticalVelocity * delta;
            if (this.position.y <= newTerrainHeight) {
                // Impact relative to the slope: landing on a downslope is soft.
                const descent = delta > 0 ? Math.max(0, (terrainHeight - newTerrainHeight) / delta) : 0;
                const impactVel = -this.verticalVelocity - descent * 0.85;
                this.position.y = newTerrainHeight;
                this.verticalVelocity = 0;
                this.isGrounded = true;
                this.isJumping = false;
                // Re-baseline the roller detector on the landing slope; the pre-takeoff
                // slope would read as a fresh lip and chain-pop the rider straight back up.
                {
                    const lfx = Math.sin(this.rotation), lfz = Math.cos(this.rotation);
                    this.lastTerrainSlope = (this.mountain.getHeightAt(this.position.x + lfx * 3, this.position.z + lfz * 3) - newTerrainHeight) / 3;
                    this.lastSlopeChangeTime = performance.now();
                }
                this._pendingLand = {
                    airTime: this.stats.currentAirTime,
                    impact: clamp01((impactVel - 5) / 42), // big kicker landings ~0.4-0.6
                };
            }
        }

        const halfWidth = this.mountain.width / 2 - 5;
        const halfDepth = this.mountain.depth / 2 - 5;
        this.position.x = THREE.MathUtils.clamp(this.position.x, -halfWidth, halfWidth);
        this.position.z = THREE.MathUtils.clamp(this.position.z, -halfDepth, halfDepth);

        this.checkCollisions(delta);

        this.mesh.position.copy(this.position);

        this.updateFlip(delta);
        if (!this.isRagdolling) this.updateSpin(delta);

        if (this.isRagdolling) {
            this._pendingLand = null;
        } else {
            if (this._pendingLand) {
                const L = this._pendingLand;
                this._pendingLand = null;
                if (L.airTime > 0.06) {
                    events.emit('ski:land', { airTime: L.airTime, impact: L.impact, speed: Math.abs(this.currentSpeed) });
                    this.pose.squash = Math.max(this.pose.squash, 0.35 + L.impact * 0.65);
                    this._addTrauma(0.12 + L.impact * 0.45);
                    if (L.airTime > 0.2) this.sprayBurst(this.position.x, this.position.y, this.position.z, 10 + L.impact * 35, 0.7 + L.impact * 0.6, 0.45);
                }
            }

            this.alignToTerrain(terrainNormal, delta);
            this.animateBody(delta);
            this._emitSkiSpray(delta);
        }

        this.updateCamera(rawDelta);
        this.updateSnowSpray(delta);
        this.updateTrails(delta);
        this._emitTick();
    }

    _emitSkiSpray(delta) {
        if (!this.isGrounded || !this._spray) return;
        const speed = Math.abs(this.currentSpeed);
        const speed01 = clamp01(speed / 60);
        const fx = Math.sin(this.rotation), fz = Math.cos(this.rotation);
        const lx = fz, lz = -fx;
        const absEdge = Math.abs(this.edgeAngle);

        // Carve spray from the downhill (outside) ski edge
        if (absEdge > 0.12 && speed > 3) {
            this._sprayAccum += delta * (absEdge * (0.25 + speed01) * 190);
            const out = this.edgeAngle > 0 ? -1 : 1; // outside of the turn
            while (this._sprayAccum >= 1) {
                this._sprayAccum -= 1;
                const ox = lx * out, oz = lz * out;
                const along = -0.5 + Math.random() * 0.9;
                const sp = 1.5 + speed * (0.08 + Math.random() * 0.1);
                this._emitParticle(
                    this.position.x + ox * 0.22 + fx * along,
                    this.position.y + 0.06,
                    this.position.z + oz * 0.22 + fz * along,
                    this.velocity.x * 0.62 + ox * sp + (Math.random() - 0.5),
                    1.2 + Math.random() * (1.5 + speed01 * 3),
                    this.velocity.z * 0.62 + oz * sp + (Math.random() - 0.5),
                    0.45 + Math.random() * 0.5,
                    0.18 + Math.random() * 0.22 + speed01 * 0.25,
                );
            }
        } else {
            this._sprayAccum = 0;
        }

        // Snowplow: big burst on hard brake, then a steady plume
        if (this._brakeBurst) {
            this._brakeBurst = false;
            for (let k = 0; k < 26; k++) {
                const side = k % 2 ? 1 : -1;
                const sp = 2 + Math.random() * 4 + speed * 0.06;
                this._emitParticle(
                    this.position.x + lx * side * 0.25 + fx * 0.6, this.position.y + 0.08, this.position.z + lz * side * 0.25 + fz * 0.6,
                    this.velocity.x * 0.5 + (fx * 0.8 + lx * side * 0.6) * sp, 1.5 + Math.random() * 2.5,
                    this.velocity.z * 0.5 + (fz * 0.8 + lz * side * 0.6) * sp,
                    0.6 + Math.random() * 0.5, 0.3 + Math.random() * 0.35,
                );
            }
        }
        if (this.isBraking && speed > 4) {
            this._brakeAccum += delta * (40 + speed01 * 160);
            while (this._brakeAccum >= 1) {
                this._brakeAccum -= 1;
                const side = Math.random() < 0.5 ? 1 : -1;
                const sp = 1 + Math.random() * 2 + speed * 0.05;
                this._emitParticle(
                    this.position.x + lx * side * 0.25 + fx * 0.5, this.position.y + 0.06, this.position.z + lz * side * 0.25 + fz * 0.5,
                    this.velocity.x * 0.6 + (fx * 0.6 + lx * side * 0.8) * sp, 0.8 + Math.random() * 1.6,
                    this.velocity.z * 0.6 + (fz * 0.6 + lz * side * 0.8) * sp,
                    0.4 + Math.random() * 0.4, 0.2 + Math.random() * 0.25,
                );
            }
        } else {
            this._brakeAccum = 0;
        }
    }

    _emitTick() {
        const t = this._tick;
        const hv = this.isRagdolling && this.headSnowball ? this.headSnowball.velocity : null;
        const speed = hv ? Math.sqrt(hv.x * hv.x + hv.z * hv.z) : Math.abs(this.currentSpeed);
        t.speed = speed;
        t.speedMph = Math.round(speed * MPH);
        t.speed01 = clamp01(speed / 60);
        t.maxSpeedMph = Math.round(this.stats.maxSpeed * MPH);
        t.grounded = this.isGrounded;
        t.tucking = this.isTucking && this.isGrounded;
        t.braking = this.isBraking;
        t.switch = this.currentSpeed < -0.5;
        t.edge = this.edgeAngle;
        t.airTime = this.stats.currentAirTime;
        t.totalAirTime = this.stats.totalAirTime;
        t.score = this.score;
        t.combo = this.comboMultiplier;
        t.tricksLanded = this.stats.tricksLanded;
        t.ragdoll = this.isRagdolling;

        if (!this.isRagdolling && !this.isGrounded && (this.isFlipping || this.isSpinning)) {
            const spinDeg = Math.round(this.totalSpinDegrees / 180) * 180;
            const flips = this.isFlipping ? Math.floor(Math.abs(this.flipRotation) / TAU) + 1 : 0; // flip in progress
            const key = `${spinDeg}|${flips}|${this.flipDirection}`;
            if (key !== this._liveTrickKey) {
                this._liveTrickKey = key;
                this._tickTrick.label = nameTrick(spinDeg, flips, this.flipDirection) || 'Spin';
            }
            this._tickTrick.progress01 = this.isFlipping
                ? (Math.abs(this.flipRotation) % TAU) / TAU
                : (this.totalSpinDegrees % 180) / 180;
            t.trick = this._tickTrick;
        } else {
            t.trick = null;
        }

        if (this.isRagdolling) {
            t.hint = this.crashHintCount < this.maxCrashHints ? 'Space to recover' : null;
        } else if (!this.isGrounded && !t.trick && this.airHintCount < this.maxAirHints && this.stats.currentAirTime > 0.12) {
            t.hint = 'A/D spin · W/S flip';
        } else {
            t.hint = null;
        }
        events.emit('ski:tick', t);
    }

    // =====================================================================
    // COLLISIONS
    // =====================================================================
    _collidables() {
        const list = this.objectPlacer && this.objectPlacer.placedObjects;
        if (list) return list;
        // Fallback (no ObjectPlacer wired): cached scan, refreshed at most once a second.
        const now = performance.now();
        if (!this._fallbackCollidables || now - this._fallbackCollidablesTime > 1000) {
            const arr = [];
            this.scene.traverse((obj) => {
                if (obj.userData && obj.userData.placedObject && obj !== this.mesh && !(obj.parent && obj.parent.userData && obj.parent.userData.placedObject)) {
                    arr.push({ type: obj.name, object: obj });
                }
            });
            this._fallbackCollidables = arr;
            this._fallbackCollidablesTime = now;
        }
        return this._fallbackCollidables;
    }

    /** Child colliders (e.g. lift towers) for a placed root, cached until it moves. */
    _childColliders(obj) {
        let c = this._colliderCache.get(obj);
        const px = obj.position.x, pz = obj.position.z, ry = obj.rotation.y, cnt = obj.children.length;
        if (!c || c.px !== px || c.pz !== pz || c.ry !== ry || c.cnt !== cnt) {
            const pts = [];
            obj.updateMatrixWorld(true);
            obj.traverse((o) => {
                if (o !== obj && o.userData && o.userData.placedObject) {
                    pts.push({ pos: o.getWorldPosition(new THREE.Vector3()), radius: o.userData.collisionRadius ?? this.getCollisionRadius(o) });
                }
            });
            c = { px, pz, ry, cnt, pts };
            this._colliderCache.set(obj, c);
        }
        return c.pts;
    }

    checkCollisions(delta) {
        const list = this._collidables();
        if (!list || list.length === 0) return;

        const sx = this.position.x, sy = this.position.y + 0.5, sz = this.position.z;
        const fwdX = Math.sin(this.rotation), fwdZ = Math.cos(this.rotation);
        const skierSpeed = this.currentSpeed;

        for (let i = 0; i < list.length; i++) {
            const obj = list[i] && list[i].object;
            if (!obj || !obj.parent || obj === this.mesh) continue;

            if (obj.userData.isJump) {
                const jumpScale = obj.scale.x || 1;
                const jumpRadius = 3.5 * jumpScale;
                const dx = sx - obj.position.x;
                const dz = sz - obj.position.z;
                const d2 = Math.sqrt(dx * dx + dz * dz);
                if (d2 < jumpRadius) {
                    const ja = obj.rotation.y;
                    const jfx = Math.sin(ja), jfz = Math.cos(ja);
                    const inv = d2 > 1e-6 ? 1 / d2 : 0;
                    const approachAngle = jfx * dx * inv + jfz * dz * inv;
                    const movementAlignment = fwdX * jfx + fwdZ * jfz;
                    const now = performance.now();
                    if (d2 < jumpRadius * 0.7 && approachAngle < 0.5 && movementAlignment > -0.3 &&
                        this.isGrounded && skierSpeed > 5 && now - this.lastJumpRampTime > 800) {
                        // Pop scales with speed and kicker size: ~1.3s air on a medium
                        // kicker at cruising speed, ~2s on the big ones (capped).
                        let vy = THREE.MathUtils.clamp(
                            skierSpeed * KICKER_LIFT * Math.pow(jumpScale, 0.544), KICKER_VY_MIN, KICKER_VY_MAX);
                        // Fit the flight to the terrain ahead: pop harder if the ground rises and
                        // would cut it short, softer if it falls away into a huge (>2.1s) drop.
                        const tWant = THREE.MathUtils.clamp(skierSpeed * 0.035 * Math.sqrt(jumpScale), 1.0, 1.9);
                        for (let k = 0; k < 6; k++) {
                            const t = this._predictAirTime(vy, TRICK_AIR_GRAVITY);
                            if (t < tWant && vy < KICKER_VY_TERRAIN_MAX) vy = Math.min(vy + 1.5, KICKER_VY_TERRAIN_MAX);
                            else if (t > 2.1 && vy > 4) vy = Math.max(vy - 2, 4);
                            else break;
                        }
                        this.verticalVelocity = vy;
                        this._airG = TRICK_AIR_GRAVITY;
                        this._spinArmed = true;
                        this.isGrounded = false;
                        this.isJumping = true;
                        this.lastJumpRampTime = now;
                        events.emit('ski:jump', { source: 'ramp', power: this.verticalVelocity, speed: skierSpeed });
                        this.sprayBurst(sx, this.position.y, sz, 14, 0.6, 0.6);
                    }
                }
                continue;
            }

            const kids = this._childColliders(obj);
            if (kids.length) {
                for (let k = 0; k < kids.length; k++) {
                    const c = kids[k];
                    this._collideWith(c.pos.x, c.pos.y, c.pos.z, c.radius, sx, sy, sz, obj, list[i].type);
                }
            } else {
                const r = obj.userData.collisionRadius ?? this.getCollisionRadius(obj);
                this._collideWith(obj.position.x, obj.position.y, obj.position.z, r, sx, sy, sz, obj, list[i].type);
            }
        }
    }

    /** Coarse flight sim from the current state against the terrain (launch-time only). */
    _predictAirTime(vy, g) {
        const dt = 1 / 30;
        let x = this.position.x, z = this.position.z, y = this.position.y;
        const vx = this.velocity.x, vz = this.velocity.z;
        for (let t = dt; t < 3; t += dt) {
            x += vx * dt; z += vz * dt; y += vy * dt;
            vy -= g * (Math.abs(vy) < HANG_VY ? HANG_GRAVITY_MUL : 1) * dt;
            if (y <= this.mountain.getHeightAt(x, z)) return t;
        }
        return 3;
    }

    _collideWith(ox, oy, oz, radius, sx, sy, sz, obj, type) {
        const dx = sx - ox, dy = sy - oy, dz = sz - oz;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist >= radius + 0.5) return;
        const inv = dist > 1e-6 ? 1 / dist : 0;
        const impactSpeed = Math.abs(this.currentSpeed);
        this.position.x += dx * inv * 0.5;
        this.position.z += dz * inv * 0.5;
        this.currentSpeed *= 0.3;
        this.velocity.multiplyScalar(0.3);

        const now = performance.now();
        if (now - this._lastCollideTime > 350) {
            this._lastCollideTime = now;
            events.emit('ski:collide', { type: type || obj.name || 'object', speed: impactSpeed });
            if (impactSpeed > 4) {
                this._addTrauma(Math.min(0.6, 0.2 + impactSpeed / 80));
                this.pose.squash = Math.max(this.pose.squash, 0.5);
                this.sprayBurst(this.position.x, this.position.y + 0.3, this.position.z, 18, 0.8, 0.1);
            }
        }
    }

    getCollisionRadius(obj) {
        const name = (obj.name || '').toLowerCase();
        if (name.includes('lodge') || name.includes('cabin')) {
            const fp = obj.userData && obj.userData.footprint;
            return typeof fp === 'number' ? Math.max(3, fp * 0.8) * (obj.scale.x || 1) : 3;
        }
        if (name.includes('tree')) return 0.5;
        if (name.includes('snowman')) return 0.6;
        if (name.includes('flag')) return 0.2;
        if (name.includes('lift') || name.includes('gondola')) return 1;
        return 1;
    }

    // =====================================================================
    // ORIENTATION + BODY ANIMATION
    // =====================================================================
    alignToTerrain(terrainNormal, delta = 1 / 60) {
        const up = this.isGrounded ? _v3.copy(terrainNormal).normalize() : _v3.set(0, 1, 0);
        const forward = _v4.set(Math.sin(this.rotation), 0, Math.cos(this.rotation));
        forward.addScaledVector(up, -forward.dot(up)).normalize();
        const right = _s1.crossVectors(up, forward).normalize();
        forward.crossVectors(right, up).normalize();
        _m1.makeBasis(right, up, forward);
        _q1.setFromRotationMatrix(_m1);

        // Edge lean, stronger with speed
        const leanScale = 0.25 + 0.4 * Math.min(Math.abs(this.currentSpeed) / 30, 1);
        if (Math.abs(this.edgeAngle) > 0.01) {
            _q2.setFromAxisAngle(forward, -this.edgeAngle * leanScale);
            _q1.multiply(_q2);
        }

        // Smooth the terrain-following orientation (kills jitter on bumpy snow)
        if (!this._baseQuat) this._baseQuat = new THREE.Quaternion();
        if (!this._baseQuatValid) {
            this._baseQuat.copy(_q1);
            this._baseQuatValid = true;
        } else {
            this._baseQuat.slerp(_q1, 1 - Math.exp(-16 * delta));
        }
        this.mesh.quaternion.copy(this._baseQuat);

        const tricking = !this.isGrounded && (this.isFlipping || this.isSpinning);
        if (tricking) {
            if (this.isFlipping) {
                _v2.set(Math.cos(this.rotation), 0, -Math.sin(this.rotation));
                _q2.setFromAxisAngle(_v2, this.flipRotation);
                this.mesh.quaternion.premultiply(_q2);
            }
            if (this.isSpinning) {
                _q2.setFromAxisAngle(_up, this.spinRotation);
                this.mesh.quaternion.premultiply(_q2);
            }
            // Rotate about the body's centre instead of the feet.
            const cy = 0.8;
            _v2.set(0, cy, 0).applyQuaternion(this._baseQuat);
            _s1.set(0, cy, 0).applyQuaternion(this.mesh.quaternion);
            this.mesh.position.copy(this.position).add(_v2).sub(_s1);
        }
    }

    resetBodyParts() {
        const p = this.pose;
        p.shinLean = 0.42; p.torsoLean = 0.32; p.torsoRoll = 0; p.torsoTwist = 0; p.headPitch = -0.2;
        p.legDiff = 0; p.squash = 0;
        for (const side of [1, -1]) {
            const a = p.arms[side];
            a.sx = -0.55; a.sz = side * 0.3; a.elbow = -0.75; a.prx = 0.55; a.prz = side * 0.1;
            this._plant[side] = 0;
        }
        this._baseQuatValid = false;
        if (this.rig) this._applyPose();
    }

    animateBody(delta) {
        if (!this.rig) return;
        const p = this.pose;
        const speed = Math.abs(this.currentSpeed);
        const speed01 = clamp01(speed / 60);
        const edge = this.edgeAngle;
        const absEdge = Math.abs(edge);
        const grounded = this.isGrounded;
        const tuck = this.isTucking && grounded;

        // ---- pole plants on hard turn initiation
        if (grounded && speed > 6 && absEdge > 0.55 && this._prevAbsEdge <= 0.55) {
            const inside = edge > 0 ? 1 : -1;
            this._plant[inside] = 0.42;
        }
        this._prevAbsEdge = absEdge;
        for (const s of SIDES) if (this._plant[s] > 0) this._plant[s] = Math.max(0, this._plant[s] - delta);

        // ---- targets
        let shin = 0.42 + speed01 * 0.12 + absEdge * 0.24;
        let lean = 0.3 + speed01 * 0.16 + absEdge * 0.08;
        let headPitch = -0.2;
        let legDiff = edge * 0.14; // inside leg bends more
        let roll = edge * 0.2 * Math.min(speed / 25, 1); // angulation (upper body stays level)
        let twist = -edge * 0.12;

        if (grounded && speed < 1.2 && !tuck) {
            shin = 0.3 + Math.sin(this._time * 2.2) * 0.015; // idle breathing
            lean = 0.2;
        }
        if (tuck) { shin = 0.98; lean = 1.12; headPitch = -0.95; legDiff *= 0.3; }
        if (this.isBraking && grounded) { shin = 0.6; lean = 0.18; legDiff = 0; }
        if (!grounded) {
            shin = 0.66; lean = 0.38; legDiff = 0; roll = 0; twist = 0;
            if (this.isFlipping) { shin = 1.2; lean = 1.0; headPitch = -0.6; }
            else if (this.isSpinning) { shin = 0.82; lean = 0.5; }
        }
        headPitch = Math.min(headPitch, -lean * 0.72);

        // landing squash decays (~120ms to mostly recover)
        p.squash *= Math.exp(-9 * delta);
        shin += p.squash * 0.5;

        const k = 12;
        p.shinLean = damp(p.shinLean, shin, k, delta);
        p.torsoLean = damp(p.torsoLean, lean, 9, delta);
        p.headPitch = damp(p.headPitch, headPitch, 9, delta);
        p.legDiff = damp(p.legDiff, legDiff, 8, delta);
        p.torsoRoll = damp(p.torsoRoll, roll, 7, delta);
        p.torsoTwist = damp(p.torsoTwist, twist, 6, delta);

        // ---- arms + poles
        for (const side of SIDES) {
            const a = p.arms[side];
            let sx = -0.55, sz = side * 0.3, el = -0.75, prx = 0.55, prz = side * 0.1;
            const swing = edge * side; // + = inside arm
            if (grounded && !tuck) {
                sx += swing * 0.3;
                sz += side * absEdge * 0.12;
                if (this._plant[side] > 0) {
                    const t = this._plant[side] / 0.42;
                    const reach = Math.sin(t * Math.PI);
                    sx -= 0.45 * reach;
                    prx = THREE.MathUtils.lerp(0.55, -0.35, reach);
                    prz = side * (0.1 + 0.15 * reach);
                }
                if (speed < 1.2) { sx = -0.35; sz = side * 0.22; el = -0.5; prx = 0.25; }
            }
            if (tuck) { sx = -1.25; sz = side * 0.1; el = -1.4; prx = 1.42; prz = side * 0.05; }
            if (this.isBraking && grounded) { sx = -0.75; sz = side * 0.45; el = -0.6; prx = 0.2; prz = side * 0.35; }
            if (!grounded) {
                sx = -0.35; sz = side * 0.85; el = -0.45; prx = 0.85; prz = side * 0.45;
                if (this.isFlipping) { sx = -1.15; sz = side * 0.18; el = -1.65; prx = 1.3; prz = side * 0.1; }
                else if (this.isSpinning) { sx = -0.9; sz = side * 0.35; el = -1.1; prx = 1.0; prz = side * 0.3; }
            }
            a.sx = damp(a.sx, sx, k, delta);
            a.sz = damp(a.sz, sz, k, delta);
            a.elbow = damp(a.elbow, el, k, delta);
            a.prx = damp(a.prx, prx, k, delta);
            a.prz = damp(a.prz, prz, k, delta);
        }

        this._applyPose();
    }

    /** Write the pose state onto the rig (legs -> hip -> torso -> arms -> poles). */
    _applyPose() {
        const p = this.pose;
        const Ls = 0.44, Lt = 0.44;
        let hipY = 0, hipZ = 0;
        for (const side of SIDES) {
            const leg = this._legs[side];
            const a = p.shinLean + p.legDiff * side * 0.5;
            const b = a * 0.92;
            leg.shinPivot.rotation.x = a;
            leg.kneePivot.rotation.x = -(a + b);
            hipY += 0.03 + 0.18 + Ls * Math.cos(a) + Lt * Math.cos(b);
            hipZ += -0.01 + Ls * Math.sin(a) - Lt * Math.sin(b);
        }
        hipY *= 0.5;
        hipZ *= 0.5;

        const torso = this._torso;
        torso.position.set(0, hipY - 0.04, hipZ);
        torso.rotation.set(p.torsoLean, p.torsoTwist, p.torsoRoll, 'YXZ');
        this._head.rotation.x = p.headPitch;

        for (const side of SIDES) {
            const arm = this._arms[side];
            const a = p.arms[side];
            arm.shoulder.rotation.set(a.sx, 0, a.sz);
            arm.elbow.rotation.x = a.elbow;
        }

        const s = p.squash;
        this.rig.scale.set(1 + 0.06 * s, 1 - 0.12 * s, 1 + 0.06 * s);

        // Glue poles to the hands (rig space).
        this.mesh.updateMatrixWorld(true);
        for (const side of SIDES) {
            const pole = this._poles[side];
            const hand = this._arms[side].hand;
            hand.getWorldPosition(_v2);
            this.rig.worldToLocal(_v2);
            pole.position.copy(_v2);
            const a = p.arms[side];
            pole.rotation.set(a.prx, 0, a.prz);
        }
    }

    // =====================================================================
    // CAMERA
    // =====================================================================
    _addTrauma(amount) {
        this._trauma = Math.min(1, this._trauma + amount);
    }

    updateCamera(dt) {
        const cam = this.camera;
        let fx, fy, fz;          // focus point
        let dist, height, lookAhead, yaw;
        let posK = 4.5, lookK = 8;
        let targetFov = this._savedFov;
        let targetRoll = 0;

        if (this.isRagdolling && this.headSnowball) {
            const head = this.headSnowball;
            const hp = head.mesh.position;
            const vx = head.velocity.x, vz = head.velocity.z;
            if (vx * vx + vz * vz > 0.25) this.cameraYaw = dampAngle(this.cameraYaw, Math.atan2(vx, vz), 2.2, dt);
            yaw = this.cameraYaw;
            fx = hp.x; fz = hp.z;
            fy = this.mountain.getHeightAt(hp.x, hp.z) + head.size * 0.3;
            // Pulled back and raised so the tumble is framed against the slope
            // rather than the slope filling the bottom of the frame.
            dist = 10 + head.size * 1.3;
            height = 6.5 + head.size * 0.9;
            lookAhead = 0;
            posK = 3; lookK = 6;
            targetFov = this._savedFov + 4;
        } else {
            const vx = this.velocity.x, vz = this.velocity.z;
            if (vx * vx + vz * vz > 1) this.cameraYaw = dampAngle(this.cameraYaw, Math.atan2(vx, vz), 2.45, dt);
            yaw = this.cameraYaw;
            const speed01 = clamp01(Math.abs(this.currentSpeed) / 60);
            const tuck = this.isTucking && this.isGrounded ? 1 : 0;
            const ground = this.mountain.getHeightAt(this.position.x, this.position.z);
            const hAir = Math.max(0, this.position.y - ground);

            fx = this.position.x; fz = this.position.z;
            // In the air, the anchor rides only partway up so big air reads as height.
            fy = this.isGrounded ? this.position.y : ground + hAir * 0.55;
            // Real air (not roller chatter) eases the camera back and up so the
            // whole rotation stays in frame; it settles back after landing.
            const bigAir = !this.isGrounded && this.stats.currentAirTime > 0.15 ? 1 : 0;
            this._camAir = damp(this._camAir, bigAir, bigAir ? 2.5 : 1.8, dt);
            const air = this._camAir;
            dist = this.cameraOffset.z + speed01 * 1.8 - tuck * 1.3 + Math.min(hAir * 0.3, 6) + air * 2.4;
            height = this.cameraOffset.y + speed01 * 0.5 - tuck * 0.75 + Math.min(hAir * 0.3, 6) + air * 1.6;
            lookAhead = this.cameraLookAhead + speed01 * 7 - air * 2;
            posK = this.isGrounded ? 4.5 : 3.2;
            targetFov = this._savedFov + speed01 * 14 + tuck * 3 + air * 4;
            if (this.isGrounded) targetRoll = this.edgeAngle * 4 * DEG * Math.min(Math.abs(this.currentSpeed) / 25, 1);
        }

        const sinY = Math.sin(yaw), cosY = Math.cos(yaw);

        // Smoothed anchor height; x/z track exactly so speed never lets the skier slip out of frame.
        this._camAnchorY = damp(this._camAnchorY, fy, 7, dt);

        // Desired offset (relative to the anchor) -> damped
        _v2.set(-sinY * dist, height, -cosY * dist);
        this._camOffset.x = damp(this._camOffset.x, _v2.x, posK, dt);
        this._camOffset.y = damp(this._camOffset.y, _v2.y, posK, dt);
        this._camOffset.z = damp(this._camOffset.z, _v2.z, posK, dt);

        const base = _v3.set(fx + this._camOffset.x, this._camAnchorY + this._camOffset.y, fz + this._camOffset.z);
        const minY = this.mountain.getHeightAt(base.x, base.z) + 1.4;
        if (base.y < minY) {
            this._camOffset.y += minY - base.y;
            base.y = minY;
        }
        // Keep the view ray clear of the terrain: sample its midpoint too.
        {
            const mx = (base.x + fx) * 0.5, mz = (base.z + fz) * 0.5;
            const midY = (base.y + this._camAnchorY) * 0.5;
            const need = this.mountain.getHeightAt(mx, mz) + 1.2 - midY;
            if (need > 0) {
                this._camOffset.y += need * 2;
                base.y += need * 2;
            }
        }

        // Look target
        const lookY = this.isRagdolling ? 0.4 + (this.headSnowball ? this.headSnowball.size * 0.35 : 0) : (this.isGrounded ? 1.0 : 1.0 + (this.position.y - this._camAnchorY) * 0.45);
        _v2.set(sinY * lookAhead, lookY, cosY * lookAhead);
        this._lookOffset.x = damp(this._lookOffset.x, _v2.x, lookK, dt);
        this._lookOffset.y = damp(this._lookOffset.y, _v2.y, lookK, dt);
        this._lookOffset.z = damp(this._lookOffset.z, _v2.z, lookK, dt);
        const look = _v4.set(fx + this._lookOffset.x, this._camAnchorY + this._lookOffset.y, fz + this._lookOffset.z);

        // Trauma shake (squared falloff), position + roll noise
        this._trauma = Math.max(0, this._trauma - dt * 1.5);
        this._shakeT += dt;
        let shakeRoll = 0;
        if (this._trauma > 0 && !this._reducedMotion) {
            const s = this._trauma * this._trauma;
            const t = this._shakeT * 30;
            base.x += (Math.sin(t * 1.13) + Math.sin(t * 2.71 + 1.3) * 0.5) * 0.22 * s;
            base.y += (Math.sin(t * 1.37 + 2.1) + Math.sin(t * 3.07) * 0.5) * 0.18 * s;
            base.z += (Math.sin(t * 0.97 + 4.2) + Math.sin(t * 2.33 + 0.7) * 0.5) * 0.22 * s;
            shakeRoll = (Math.sin(t * 1.71 + 0.5) + Math.sin(t * 3.3) * 0.4) * 2.2 * DEG * s;
        }

        cam.position.copy(base);
        cam.lookAt(look);
        this._camRoll = damp(this._camRoll, targetRoll, 4, dt);
        const roll = this._camRoll + shakeRoll;
        if (roll !== 0) cam.rotateZ(roll);

        this._camFov = damp(this._camFov, targetFov, 3, dt);
        if (Math.abs(cam.fov - this._camFov) > 0.01) {
            cam.fov = this._camFov;
            cam.updateProjectionMatrix();
        }
    }

    // =====================================================================
    // RAGDOLL
    // =====================================================================
    startRagdoll() {
        if (this.isRagdolling) return;
        this.isRagdolling = true;
        this.ragdollTimer = this.ragdollDuration;

        const crashSpeed = Math.abs(this.currentSpeed);
        const crashIntensity = Math.max(1, crashSpeed / 15);

        this.mesh.updateMatrixWorld(true);
        this.detachSkis();
        this.explodeBodyParts(crashIntensity);
        this.createHeadSnowball(crashIntensity);
        this.mesh.visible = false;

        this.isFlipping = false;
        this.isSpinning = false;
        this.flipRotation = 0;
        this.spinRotation = 0;

        this._addTrauma(0.9);
        this.sprayBurst(this.position.x, this.position.y, this.position.z, 60, 1.4, 0.4);

        events.emit('ski:crash', { name: this._pendingCrashName || null, speed: crashSpeed });
        this._pendingCrashName = null;
    }

    explodeBodyParts(intensity) {
        this.detachedBodyParts.forEach((part) => this.scene.remove(part.mesh));
        this.detachedBodyParts = [];

        for (const src of this._explodeMeshes) {
            const m = new THREE.Mesh(src.geometry, src.material);
            src.matrixWorld.decompose(m.position, m.quaternion, m.scale);
            m.castShadow = true;
            if (!src.geometry.boundingSphere) src.geometry.computeBoundingSphere();
            const r = src.geometry.boundingSphere.radius;
            const mass = Math.max(0.2, r * 6);

            const explosionForce = 8 + Math.random() * 12 * intensity;
            const velocity = new THREE.Vector3(
                this.velocity.x * 0.5 + (Math.random() - 0.5) * explosionForce,
                3 + Math.random() * 8 * intensity,
                this.velocity.z * 0.5 + (Math.random() - 0.5) * explosionForce,
            ).multiplyScalar(1 / Math.sqrt(mass));
            const angularVel = new THREE.Vector3(
                (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20,
            );
            this.scene.add(m);
            this.detachedBodyParts.push({ mesh: m, velocity, angularVel, mass, radius: Math.min(0.2, r) });
        }
    }

    createHeadSnowball(intensity) {
        if (this.headSnowball) this.scene.remove(this.headSnowball.mesh);

        const group = new THREE.Group();
        group.name = 'headSnowball';
        for (const child of this._head.children) {
            if (!child.isMesh) continue;
            const m = new THREE.Mesh(child.geometry, child.material);
            m.position.copy(child.position).y -= 0.08;
            m.castShadow = child.castShadow;
            group.add(m);
        }
        const coating = new THREE.Mesh(getGeometries().snowball, getMaterials().snow);
        coating.visible = false;
        coating.castShadow = true;
        group.add(coating);

        this._head.getWorldPosition(group.position);
        group.position.y += 0.08;
        this._head.getWorldQuaternion(group.quaternion);
        this.scene.add(group);

        const velocity = new THREE.Vector3(
            this.velocity.x * 0.6 + (Math.random() - 0.5) * 4,
            2 + Math.random() * 2 * intensity,
            this.velocity.z * 0.6 + (Math.random() - 0.5) * 4,
        );
        this.headSnowball = {
            mesh: group, velocity, angularVel: new THREE.Vector3(), snowCoating: coating, size: 1, distanceRolled: 0,
        };
        this.headSnowballSize = 1;
    }

    detachSkis() {
        this.detachedSkis.forEach((s) => this.scene.remove(s.mesh));
        this.detachedSkis = [];

        const crashIntensity = Math.max(1, Math.abs(this.currentSpeed) / 15);
        this.skiMeshes.forEach((src, index) => {
            const side = index === 0 ? 1 : -1;
            const g = src.clone(true);
            src.matrixWorld.decompose(g.position, g.quaternion, g.scale);
            g.position.y += 0.05;
            g.visible = true;
            const velocity = new THREE.Vector3(
                this.velocity.x * 0.5 + side * (5 + Math.random() * 8) * crashIntensity,
                4 + Math.random() * 8 * crashIntensity,
                this.velocity.z * 0.5 + (Math.random() - 0.5) * 8 * crashIntensity,
            );
            const angularVel = new THREE.Vector3(
                (Math.random() - 0.5) * 20 * crashIntensity,
                (Math.random() - 0.5) * 15 * crashIntensity,
                (Math.random() - 0.5) * 20 * crashIntensity,
            );
            this.scene.add(g);
            this.detachedSkis.push({ mesh: g, velocity, angularVel });
            src.visible = false;
        });
    }

    updateRagdoll(delta) {
        if (!this.isRagdolling) return;
        const gravity = 20;
        const spinDecay = frameMul(0.98, delta);

        for (const part of this.detachedBodyParts) {
            part.velocity.y -= gravity * delta;
            part.mesh.position.addScaledVector(part.velocity, delta);
            const th = this.mountain.getHeightAt(part.mesh.position.x, part.mesh.position.z);
            const pr = part.radius || 0.2;
            if (part.mesh.position.y < th + pr) {
                const hitSpeed = Math.abs(part.velocity.y);
                part.mesh.position.y = th + pr;
                part.velocity.y = hitSpeed * 0.4;
                part.velocity.x *= 0.85;
                part.velocity.z *= 0.85;
                part.angularVel.x += part.velocity.z * 0.5;
                part.angularVel.z -= part.velocity.x * 0.5;
                if (hitSpeed > 4 && Math.random() < 0.5) {
                    this.sprayBurst(part.mesh.position.x, th, part.mesh.position.z, 3, 0.4, 0);
                }
            }
            part.mesh.rotation.x += part.angularVel.x * delta;
            part.mesh.rotation.y += part.angularVel.y * delta;
            part.mesh.rotation.z += part.angularVel.z * delta;
            part.angularVel.multiplyScalar(spinDecay);
        }

        for (const ski of this.detachedSkis) {
            ski.velocity.y -= gravity * delta;
            ski.mesh.position.addScaledVector(ski.velocity, delta);
            const th = this.mountain.getHeightAt(ski.mesh.position.x, ski.mesh.position.z);
            if (ski.mesh.position.y < th + 0.05) {
                ski.mesh.position.y = th + 0.05;
                ski.velocity.y = Math.abs(ski.velocity.y) * 0.3;
                ski.velocity.x *= 0.85;
                ski.velocity.z *= 0.85;
            }
            ski.mesh.rotation.x += ski.angularVel.x * delta;
            ski.mesh.rotation.y += ski.angularVel.y * delta;
            ski.mesh.rotation.z += ski.angularVel.z * delta;
            ski.angularVel.multiplyScalar(spinDecay);
        }

        const head = this.headSnowball;
        if (head) {
            const hp = head.mesh.position;
            const terrainHeight = this.mountain.getHeightAt(hp.x, hp.z);
            const headRadius = 0.2 * head.size;
            const isOnGround = hp.y <= terrainHeight + headRadius + 0.1;
            const normal = this._sampleNormal(hp.x, hp.z, _v2);

            const steerForce = isOnGround ? 25 : 5;
            const moveAngle = Math.atan2(head.velocity.x, head.velocity.z);
            if (this.input.left) {
                head.velocity.x += Math.cos(moveAngle) * steerForce * delta;
                head.velocity.z -= Math.sin(moveAngle) * steerForce * delta;
            }
            if (this.input.right) {
                head.velocity.x -= Math.cos(moveAngle) * steerForce * delta;
                head.velocity.z += Math.sin(moveAngle) * steerForce * delta;
            }

            head.velocity.y -= gravity * delta;
            if (isOnGround) {
                head.velocity.x += normal.x * 35 * delta;
                head.velocity.z += normal.z * 35 * delta;
            }

            hp.addScaledVector(head.velocity, delta);

            if (hp.y < terrainHeight + headRadius) {
                hp.y = terrainHeight + headRadius;
                head.velocity.y = 0;
                const roll = frameMul(0.995, delta);
                head.velocity.x *= roll;
                head.velocity.z *= roll;

                const speed = Math.sqrt(head.velocity.x * head.velocity.x + head.velocity.z * head.velocity.z);
                head.angularVel.x = head.velocity.z / headRadius * 0.8;
                head.angularVel.z = -head.velocity.x / headRadius * 0.8;

                head.distanceRolled += speed * delta;
                const newSize = 1 + head.distanceRolled * 0.12;
                if (newSize > head.size) {
                    head.size = Math.min(newSize, 8);
                    head.mesh.scale.setScalar(head.size);
                    if (head.size > 1.15 && head.snowCoating) {
                        head.snowCoating.visible = true;
                        head.snowCoating.scale.setScalar(THREE.MathUtils.lerp(0.92, 1.08, clamp01((head.size - 1.15) / 0.8)));
                    }
                }
                // little puffs kicked up by the rolling ball
                if (speed > 6 && Math.random() < delta * 20) {
                    this.sprayBurst(hp.x, terrainHeight, hp.z, 2, 0.3 + head.size * 0.08, 0.2);
                }
            }

            head.mesh.rotation.x += head.angularVel.x * delta;
            head.mesh.rotation.z += head.angularVel.z * delta;

            if (head.size >= 2) this.checkSnowballTreeCollision(head);

            const k = 1 - Math.exp(-20 * delta);
            this.position.lerp(hp, k);
        }
    }

    checkSnowballTreeCollision(head) {
        const snowballRadius = head.size * 0.5;
        const sp = head.mesh.position;

        if (this.trees && this.trees.treeData) {
            const data = this.trees.treeData;
            for (let i = 0; i < data.length; i++) {
                const entry = data[i];
                if (entry.knockedDown || entry.culled) continue;
                const dx = sp.x - entry.position.x;
                const dz = sp.z - entry.position.z;
                const reach = snowballRadius + (entry.radius ?? 0.5 * entry.scale);
                if (dx * dx + dz * dz < reach * reach) {
                    entry.knockedDown = true;
                    this.trees.hideInstance(entry);
                    const fallTree = this.trees.createFallbackTree(entry);
                    if (fallTree) this.knockDownTree(fallTree, head);
                }
            }
        }

        // Standalone (manually placed) trees
        const placed = this.objectPlacer && this.objectPlacer.placedObjects;
        if (placed) {
            for (let i = 0; i < placed.length; i++) {
                const e = placed[i];
                const obj = e && e.object;
                if (!obj || !obj.parent) continue;
                if (!(e.type === 'pine-tree' || obj.userData.isTree)) continue;
                this._tryKnockStandalone(obj, sp, snowballRadius, head);
            }
        } else {
            for (const obj of this._collidables()) {
                const o = obj.object;
                if (o && o.userData.isTree) this._tryKnockStandalone(o, sp, snowballRadius, head);
            }
        }
    }

    _tryKnockStandalone(obj, sp, snowballRadius, head) {
        if (obj.userData.knockedDown) return;
        const dx = sp.x - obj.position.x;
        const dz = sp.z - obj.position.z;
        const reach = snowballRadius + (obj.userData.collisionRadius ?? 0.5 * (obj.scale.x || 1));
        if (dx * dx + dz * dz < reach * reach) this.knockDownTree(obj, head);
    }

    knockDownTree(tree, head) {
        tree.userData.knockedDown = true;
        const fallDir = _v2.set(head.velocity.x, 0, head.velocity.z);
        if (fallDir.lengthSq() > 0.01) fallDir.normalize(); else fallDir.set(0, 0, 1);

        this._fallingTrees.push({
            tree,
            axis: new THREE.Vector3(-fallDir.z, 0, fallDir.x),
            baseQuat: tree.quaternion.clone(),
            originalY: tree.position.y,
            angle: 0,
            angVel: 0.6 + Math.random() * 0.4,
            done: false,
        });

        head.velocity.x += fallDir.x * 2;
        head.velocity.z += fallDir.z * 2;

        this._addTrauma(0.18);
        this.sprayBurst(tree.position.x, tree.position.y, tree.position.z, 22, 1.0, 0);
        events.emit('ski:tree-knock', { x: tree.position.x, y: tree.position.y, z: tree.position.z });
    }

    _updateFallingTrees(delta) {
        if (this._fallingTrees.length === 0) return;
        for (const f of this._fallingTrees) {
            if (f.done) continue;
            // accelerate like a toppling trunk, small bounce at the end
            f.angVel += (2.5 + Math.sin(f.angle) * 9) * delta;
            f.angle += f.angVel * delta;
            if (f.angle >= Math.PI / 2) {
                f.angle = Math.PI / 2;
                if (f.angVel > 1.2) {
                    f.angVel *= -0.22;
                    this.sprayBurst(
                        f.tree.position.x - f.axis.z * 4, f.originalY, f.tree.position.z + f.axis.x * 4, 10, 0.8, 0,
                    );
                } else {
                    f.done = true;
                }
            }
            _q1.setFromAxisAngle(f.axis, f.angle);
            f.tree.quaternion.copy(f.baseQuat).premultiply(_q1);
            f.tree.position.y = f.originalY - f.angle * 0.5;
        }
        if (this._fallingTrees.every((f) => f.done)) this._fallingTrees.length = 0;
    }

    _finishFallingTrees() {
        for (const f of this._fallingTrees) {
            if (f.done) continue;
            _q1.setFromAxisAngle(f.axis, Math.PI / 2);
            f.tree.quaternion.copy(f.baseQuat).premultiply(_q1);
            f.tree.position.y = f.originalY - (Math.PI / 2) * 0.5;
        }
        this._fallingTrees.length = 0;
    }

    recoverFromRagdoll() {
        this.crashHintCount++;
        if (this.headSnowball) this.position.copy(this.headSnowball.mesh.position);
        this._clearRagdoll();

        this.skiMeshes.forEach((s) => { s.visible = true; });
        this.mesh.visible = true;

        this.position.y = this.mountain.getHeightAt(this.position.x, this.position.z);
        const n = this._sampleNormal(this.position.x, this.position.z, _v1);
        this.rotation = Math.atan2(n.x, n.z);
        this.mesh.rotation.set(0, this.rotation, 0);
        this.mesh.position.copy(this.position);

        this._resetMotion();
        this.resetBodyParts();
        this.pose.squash = 0.6; // pop back up
        this.headSnowballSize = 1;
        this.sprayBurst(this.position.x, this.position.y, this.position.z, 24, 0.7, 0);

        events.emit('ski:recover', {});
    }
}
