/**
 * PostFX - post-processing chain for the medium/high quality tiers.
 *
 *   RenderPass (HalfFloat HDR target, MSAA on high)
 *   -> UnrealBloomPass (threshold on linear HDR: only sun, glints, windows, lamps)
 *   -> OutputPass (ACES tone mapping + sRGB)
 *   -> GradePass (display space: lift/gamma/gain, split-tone, saturation,
 *                 vignette, grain, speed streaks, crash flash, night grade, sun glow)
 *   -> FXAA (medium only)
 *
 * Subscribes to ski:tick (speed), ski:crash (red flash), ski:land (impact flash), ski:end (reset).
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { events } from '../core/events.js';

const reduceMotion = (() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
})();

export const GradeShader = {
    name: 'AlpineGradeShader',
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uSpeed: { value: 0 },
        uFlash: { value: 0 },
        uFlashColor: { value: new THREE.Color(1, 1, 1) },
        uNight: { value: 0 },
        uVignette: { value: 0.25 },
        uGrain: { value: 0.02 },
        uSaturation: { value: 1.08 },
        uShadowTint: { value: new THREE.Color(0x3a5a9a) },
        uHighlightTint: { value: new THREE.Color(0xffe4c0) },
        uSplit: { value: 0.1 },
        uSunScreen: { value: new THREE.Vector3(0.5, 0.5, 0) }, // xy uv, z visibility (0..1)
        uSunColor: { value: new THREE.Color(1.0, 0.82, 0.6) },
        uAspect: { value: 1 },
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform vec2 uResolution;
        uniform float uSpeed;
        uniform float uFlash;
        uniform vec3 uFlashColor;
        uniform float uNight;
        uniform float uVignette;
        uniform float uGrain;
        uniform float uSaturation;
        uniform vec3 uShadowTint;
        uniform vec3 uHighlightTint;
        uniform float uSplit;
        uniform vec3 uSunScreen;
        uniform vec3 uSunColor;
        uniform float uAspect;
        varying vec2 vUv;

        float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
        float hash12(vec2 p) {
            vec3 p3 = fract(vec3(p.xyx) * 0.1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
        }

        void main() {
            vec2 uv = vUv;
            vec2 fromCenter = uv - 0.5;
            vec2 aspectVec = vec2(fromCenter.x * uAspect, fromCenter.y);
            float r = length(aspectVec);
            vec3 c = texture2D(tDiffuse, uv).rgb;

            // --- speed streaks: short radial blur that only affects the edges
            if (uSpeed > 0.02) {
                float edge = smoothstep(0.25, 0.85, r) * uSpeed;
                vec2 dir = fromCenter * 0.045 * edge;
                vec3 acc = c;
                float jitter = hash12(gl_FragCoord.xy + uTime) * 0.5;
                for (int i = 1; i <= 5; i++) {
                    float t = (float(i) + jitter) / 5.0;
                    acc += texture2D(tDiffuse, uv - dir * t).rgb;
                }
                c = mix(c, acc / 6.0, clamp(edge * 1.6, 0.0, 1.0));
            }

            // --- sun glow (god-rays lite): soft warm bloom around the projected sun,
            //     gated by how bright the frame is at the sun (terrain occludes it)
            if (uSunScreen.z > 0.001) {
                vec2 sd = vec2((uv.x - uSunScreen.x) * uAspect, uv.y - uSunScreen.y);
                float d = length(sd);
                vec2 sp = clamp(uSunScreen.xy, vec2(0.001), vec2(0.999));
                vec2 o = vec2(0.006, 0.006 * uAspect);
                float occ = luma(texture2D(tDiffuse, sp).rgb)
                          + luma(texture2D(tDiffuse, sp + vec2(o.x, 0.0)).rgb)
                          + luma(texture2D(tDiffuse, sp - vec2(o.x, 0.0)).rgb)
                          + luma(texture2D(tDiffuse, sp + vec2(0.0, o.y)).rgb)
                          + luma(texture2D(tDiffuse, sp - vec2(0.0, o.y)).rgb);
                occ = smoothstep(0.55, 0.92, occ / 5.0);
                float glow = exp(-d * 7.0) * 0.1 + exp(-d * 22.0) * 0.12;
                c += uSunColor * glow * occ * uSunScreen.z;
            }

            // --- lift / gamma / gain (very gentle) + a soft S-curve for snow contrast
            c = c * 1.02 + 0.004;
            c = pow(max(c, 0.0), vec3(0.98));
            // (stronger by day: the wide editor view is mostly bright snow and read milky)
            c = mix(c, c * c * (3.0 - 2.0 * c), mix(0.26, 0.14, uNight));

            // --- split toning: cool shadows, warm highlights (luma preserving offsets)
            float l = luma(c);
            vec3 sT = uShadowTint - luma(uShadowTint);
            vec3 hT = uHighlightTint - luma(uHighlightTint);
            c += sT * uSplit * (1.0 - smoothstep(0.0, 0.55, l));
            c += hT * uSplit * smoothstep(0.45, 1.0, l);

            // --- night grade: cooler, slightly lifted blacks
            if (uNight > 0.001) {
                vec3 nightC = c * vec3(0.9, 0.96, 1.08) + vec3(0.012, 0.016, 0.03);
                c = mix(c, nightC, uNight);
            }

            // --- saturation
            l = luma(c);
            c = mix(vec3(l), c, uSaturation + uSpeed * 0.06);

            // --- vignette (tightens with speed)
            float vig = uVignette + uSpeed * 0.3;
            float vstart = 0.45 - uSpeed * 0.12;
            c *= 1.0 - vig * smoothstep(vstart, 1.05, r);

            // --- crash / impact flash, strongest at the edges
            if (uFlash > 0.001) {
                float fe = 0.35 + 0.65 * smoothstep(0.1, 0.8, r);
                c = mix(c, uFlashColor, clamp(uFlash * fe, 0.0, 1.0));
            }

            // --- film grain
            float g = hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 811.0) - 0.5;
            c += g * uGrain * (0.6 + 0.4 * (1.0 - l));

            gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }
    `,
};

const _proj = new THREE.Vector3();
const _camDir = new THREE.Vector3();

export class PostFX {
    /** True when HalfFloat colour targets can be rendered to. */
    static isSupported(renderer) {
        try {
            const caps = renderer.capabilities;
            if (!caps.isWebGL2) {
                return renderer.extensions.has('OES_texture_half_float') &&
                    renderer.extensions.has('EXT_color_buffer_half_float');
            }
            return renderer.extensions.has('EXT_color_buffer_float') ||
                renderer.extensions.has('EXT_color_buffer_half_float');
        } catch (e) {
            return false;
        }
    }

    constructor(renderer, scene, camera, preset) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.preset = preset;

        this.composer = null;
        this.renderPass = null;
        this.bloomPass = null;
        this.outputPass = null;
        this.gradePass = null;
        this.fxaaPass = null;

        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.time = 0;

        // Animated state
        this.speedTarget = 0;
        this.speed = 0;
        this.flashAmount = 0;
        this.flashColor = new THREE.Color(1, 1, 1);
        this.isNight = false;
        this.night = 0;
        this.sunDirection = new THREE.Vector3(-0.62, 0.42, -0.66).normalize();
        this.sunVisibility = 1; // fades out at night

        this._build();

        this._unsubs = [
            events.on('ski:tick', (p) => {
                if (!p) return;
                let s = typeof p.speed01 === 'number' ? p.speed01 : Math.min(Math.abs(p.speed || 0) / 60, 1);
                if (p.tucking) s = Math.min(1, s * 1.12);
                // Effect only kicks in at real speed
                this.speedTarget = THREE.MathUtils.smoothstep(s, 0.35, 1.0);
            }),
            events.on('ski:crash', () => this.flash('#ff4a3a', 0.55)),
            events.on('ski:land', (p) => {
                const impact = p && typeof p.impact === 'number' ? p.impact : 0;
                if (impact > 0.55) this.flash('#ffffff', 0.18 * impact);
            }),
            events.on('ski:end', () => { this.speedTarget = 0; this.speed = 0; this.flashAmount = 0; }),
            events.on('ski:start', () => { this.speedTarget = 0; }),
        ];
    }

    _build() {
        const p = this.preset;
        const renderer = this.renderer;
        const pr = renderer.getPixelRatio();
        const size = renderer.getSize(new THREE.Vector2());
        this.width = size.x || window.innerWidth;
        this.height = size.y || window.innerHeight;

        const samples = renderer.capabilities.isWebGL2 ? (p.msaaSamples || 0) : 0;
        const target = new THREE.WebGLRenderTarget(
            Math.max(1, Math.floor(this.width * pr)),
            Math.max(1, Math.floor(this.height * pr)),
            { type: THREE.HalfFloatType, samples, colorSpace: THREE.LinearSRGBColorSpace }
        );
        this.composer = new EffectComposer(renderer, target);
        this.composer.setPixelRatio(pr);
        this.composer.setSize(this.width, this.height);

        this.renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(this.renderPass);

        if (p.bloom) {
            const scale = p.bloomResolutionScale || 0.5;
            this.bloomPass = new UnrealBloomPass(
                new THREE.Vector2(this.width * pr * scale * 2, this.height * pr * scale * 2),
                0.35, 0.55, 1.25
            );
            // UnrealBloomPass halves internally; feed it a scaled size.
            const origSetSize = this.bloomPass.setSize.bind(this.bloomPass);
            this.bloomPass.setSize = (w, h) => origSetSize(
                Math.max(2, Math.round(w * scale * 2)),
                Math.max(2, Math.round(h * scale * 2))
            );
            this.composer.addPass(this.bloomPass);
        }

        this.outputPass = new OutputPass();
        this.composer.addPass(this.outputPass);

        if (p.grade) {
            this.gradePass = new ShaderPass(GradeShader);
            this.gradePass.material.name = 'GradePass';
            if (reduceMotion) this.gradePass.uniforms.uGrain.value = 0.012;
            this.composer.addPass(this.gradePass);
        }

        if (p.fxaa) {
            this.fxaaPass = new ShaderPass(FXAAShader);
            this.composer.addPass(this.fxaaPass);
        }

        this._updateResolutionUniforms();
    }

    _updateResolutionUniforms() {
        const pr = this.renderer.getPixelRatio();
        if (this.fxaaPass) {
            this.fxaaPass.material.uniforms.resolution.value.set(
                1 / Math.max(1, this.width * pr),
                1 / Math.max(1, this.height * pr)
            );
        }
        if (this.gradePass) {
            this.gradePass.uniforms.uResolution.value.set(this.width * pr, this.height * pr);
            this.gradePass.uniforms.uAspect.value = this.width / Math.max(1, this.height);
        }
    }

    setSize(w, h) {
        this.width = w;
        this.height = h;
        if (!this.composer) return;
        this.composer.setPixelRatio(this.renderer.getPixelRatio());
        this.composer.setSize(w, h);
        this._updateResolutionUniforms();
    }

    setPreset(preset) {
        this.preset = preset;
        this._disposeChain();
        this._build();
    }

    setSpeed(v) {
        this.speedTarget = THREE.MathUtils.clamp(v || 0, 0, 1);
    }

    flash(color = '#ffffff', strength = 1) {
        if (reduceMotion) strength *= 0.4;
        this.flashColor.set(color);
        this.flashAmount = Math.max(this.flashAmount, THREE.MathUtils.clamp(strength, 0, 1));
        if (this.gradePass) this.gradePass.uniforms.uFlashColor.value.copy(this.flashColor);
    }

    setNight(enabled, { instant = false } = {}) {
        this.isNight = !!enabled;
        if (instant) this.night = this.isNight ? 1 : 0;
    }

    /** Direction toward the sun (world). Used for the screen-space sun glow. */
    setSunDirection(dir) {
        if (dir) this.sunDirection.copy(dir).normalize();
    }

    /** 0..1 strength of the screen-space sun glow (Environment fades it at night/blizzard). */
    setSunVisibility(v) {
        this.sunVisibility = THREE.MathUtils.clamp(v, 0, 1);
    }

    render(delta = 0) {
        const dt = Math.min(delta, 0.1);
        this.time += dt;

        // Ease animated values (frame-rate independent)
        this.speed += (this.speedTarget - this.speed) * (1 - Math.exp(-4 * dt));
        this.flashAmount *= Math.exp(-5.5 * dt);
        if (this.flashAmount < 0.002) this.flashAmount = 0;
        const nightTarget = this.isNight ? 1 : 0;
        this.night += (nightTarget - this.night) * (1 - Math.exp(-3 * dt));

        if (this.gradePass) {
            const u = this.gradePass.uniforms;
            u.uTime.value = this.time;
            u.uSpeed.value = reduceMotion ? this.speed * 0.4 : this.speed;
            u.uFlash.value = this.flashAmount;
            u.uNight.value = this.night;
            u.uVignette.value = 0.25 + this.night * 0.08;
            this._updateSunScreen(u);
        }
        if (this.bloomPass) {
            // A touch more glow at night so windows and lamps sing
            this.bloomPass.strength = 0.35 + this.night * 0.35;
            this.bloomPass.threshold = 1.25 - this.night * 0.55;
        }

        this.composer.render(dt);
    }

    _updateSunScreen(u) {
        const cam = this.camera;
        cam.getWorldDirection(_camDir);
        const facing = _camDir.dot(this.sunDirection);
        let vis = this.sunVisibility * THREE.MathUtils.smoothstep(facing, 0.2, 0.6);
        if (vis > 0.001) {
            _proj.copy(this.sunDirection).multiplyScalar(5000).add(cam.position).project(cam);
            const x = _proj.x * 0.5 + 0.5;
            const y = _proj.y * 0.5 + 0.5;
            // fade as the sun leaves the frame
            const edge = Math.min(x + 0.15, 1.15 - x, y + 0.15, 1.15 - y);
            vis *= THREE.MathUtils.clamp(edge / 0.15, 0, 1);
            u.uSunScreen.value.set(x, y, vis);
        } else {
            u.uSunScreen.value.z = 0;
        }
    }

    _disposeChain() {
        if (!this.composer) return;
        for (const pass of this.composer.passes) {
            try { pass.dispose?.(); } catch (e) { /* ignore */ }
        }
        try {
            this.composer.renderTarget1.dispose();
            this.composer.renderTarget2.dispose();
        } catch (e) { /* ignore */ }
        this.composer = null;
        this.renderPass = this.bloomPass = this.outputPass = this.gradePass = this.fxaaPass = null;
    }

    dispose() {
        this._disposeChain();
        if (this._unsubs) this._unsubs.forEach((off) => off());
        this._unsubs = [];
    }
}
