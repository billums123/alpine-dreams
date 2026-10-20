/**
 * Sfx - sound effects driven entirely by the event bus.
 *
 * Plays the recorded ElevenLabs pack (assets/audio, decoded into a SampleBank
 * right after the first user gesture). Every sound keeps its synthesized
 * WebAudio version as the fallback for a file that's missing or still loading.
 *
 * Shares Music's AudioContext (never creates its own). Everything routes:
 *   voice -> this.out (sfx volume/mute) -> music.sfxBus -> limiter -> destination
 *
 * Loops: ambient wind bed (always on, low), and in ski mode fast wind (follows
 * speed) + carve (gated by grounded, gain from edge/braking), blizzard layer
 * (env:blizzard), sculpt bed (sculpt:stroke). Loop params are smoothed with
 * setTargetAtTime at ~30Hz, so there's no zipper noise.
 * One-shots are short-lived node graphs disconnected on end, capped at MAX_VOICES
 * (oldest voice is stolen). Repeated samples get a 0.94-1.06 playbackRate spread.
 */

import { events } from '../core/events.js';
import { SampleBank } from './samples.js';

const MAX_VOICES = 24;
const STORAGE_KEY = 'alpineDreams.sfxMuted';

// E minor pentatonic (matches the soundtrack key): E G A B D
const PENTA = [0, 3, 5, 7, 10];
const E5 = 659.25;

// Recorded pack (tools/gen-audio.mjs). Loaded together after the first gesture.
const SAMPLE_NAMES = [
    'wind-loop', 'wind-fast-loop', 'blizzard-loop', 'carve-loop', 'sculpt-loop',
    'snow-spray', 'jump-takeoff', 'land-soft', 'land-hard', 'trick-success', 'combo', 'crash',
    'snowball-throw', 'snowball-hit', 'tree-fall', 'place-object', 'remove-object',
    'ui-click', 'ui-hover', 'lift-chime', 'night-transition',
];

// Mix levels, applied on top of each sample's loudness normalization (-20 dBFS RMS)
const MIX = {
    ambEditor: 0.16,    // wind-loop bed in the editor
    ambSki: 0.1,        // wind-loop under the ski loops
    windFast: 0.5,      // wind-fast-loop at full speed
    carve: 0.5,         // carve-loop at full edge
    blizzard: 0.3,
    sculpt: 0.4,
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const rand = (a, b) => a + Math.random() * (b - a);
const semis = (f, s) => f * Math.pow(2, s / 12);

export class Sfx {
    constructor(music) {
        this.music = music;
        this.ctx = null;
        this.out = null;
        this.volume = 0.8;
        this._muted = false;
        try { this._muted = localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { /* ignore */ }

        this.noise = null;
        this.voices = [];       // { end, gain, sources }
        this.unsubs = [];

        // Loops
        this.wind = null;
        this.carve = null;
        this.gust = null;
        this.rumble = null;
        this.skiing = false;
        this.blizzard = false;
        this.night = false;

        this._lastTickParam = 0;
        this._lastHover = 0;
        this._lastCollide = 0;
        this._lastPlace = 0;
        this._lastSpray = 0;
        this._braking = false;

        // Recorded samples
        this.bank = null;
        this.amb = null;        // always-on wind bed (sample only)
        this.played = {};       // name -> count (debug)
    }

    get isMuted() {
        return this._muted;
    }

    // ------------------------------------------------------------------
    // Setup
    // ------------------------------------------------------------------
    init() {
        const sub = (type, fn) => this.unsubs.push(events.on(type, (p) => {
            if (!this._ensure()) return;
            fn.call(this, p || {});
        }));

        sub('ski:start', this._onSkiStart);
        sub('ski:end', this._onSkiEnd);
        sub('ski:tick', this._onSkiTick);
        sub('ski:jump', this._onJump);
        sub('ski:land', this._onLand);
        sub('ski:trick', this._onTrick);
        sub('ski:crash', this._onCrash);
        sub('ski:collide', this._onCollide);
        sub('ski:tree-knock', this._onTreeKnock);
        sub('ski:recover', () => this._chirp([semis(E5, -5), E5], 0.05, 0.06));

        sub('place:object', this._onPlace);
        sub('place:remove', this._onRemove);
        sub('place:invalid', this._onInvalid);
        sub('place:lift-start', () => this._chirp([E5, semis(E5, 7)], 0.07, 0.09));
        sub('place:undo', () => this._chirp([semis(E5, 7), E5], 0.06, 0.05));
        sub('place:pop', (p) => this._onPlace(p, 0.55));

        sub('sculpt:stroke', this._onSculpt);

        sub('ui:click', this._onClick);
        sub('ui:hover', this._onHover);

        sub('env:night', this._onNight);
        sub('env:blizzard', this._onBlizzard);

        // Track env state even before audio is unlocked so loops start correctly later
        this.unsubs.push(events.on('env:blizzard', (p) => { this.blizzard = !!p?.on; }));
        this.unsubs.push(events.on('env:night', (p) => { this.night = !!p?.night; }));

        // Optional: a snowball throw, if/when the skier emits one
        sub('ski:snowball-throw', this._onSnowballThrow);

        // Bind + start loading samples the moment the context exists (first gesture)
        this.music?.onContext?.(() => this._ensure());
    }

    /** Lazily binds to Music's context once it exists. Returns false until unlocked. */
    _ensure() {
        if (this.ctx) return this.ctx.state !== 'closed';
        const ctx = this.music?.getContext?.();
        if (!ctx || !this.music.sfxBus) return false;
        this.ctx = ctx;
        this.out = ctx.createGain();
        this.out.gain.value = this._muted ? 0 : this.volume;
        this.out.connect(this.music.sfxBus);

        const len = Math.floor(ctx.sampleRate * 2);
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

        // Brown-ish noise for rumbles / wind body
        this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
        const b = this.brown.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) {
            last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
            b[i] = last * 3.5;
        }

        if (this.blizzard) this._setGust(true);

        this.bank = new SampleBank(ctx);
        this.bank.loadAll(SAMPLE_NAMES).then(() => this._onSamplesReady());
        return true;
    }

    /** Swap any running synth loops for their recorded versions and start the ambient bed. */
    _onSamplesReady() {
        if (!this.ctx) return;
        this._updateAmb();
        const swap = (name, has, rebuild) => {
            const loop = this[name];
            if (!loop || loop.sample || !this.bank.has(has)) return;
            this._stopLoop(name, 0.4);
            rebuild();
        };
        if (this.skiing) {
            swap('wind', 'wind-fast-loop', () => this._startLoop('wind', () => this._buildWind()));
            swap('carve', 'carve-loop', () => this._startLoop('carve', () => this._buildCarve()));
        }
        swap('gust', 'blizzard-loop', () => this._setGust(true));
    }

    /** Debug snapshot (window.alpineDreams.sfx.debugInfo()). */
    debugInfo() {
        const loops = {};
        ['amb', 'wind', 'carve', 'gust', 'rumble'].forEach(n => {
            const l = this[n];
            loops[n] = l ? { sample: !!l.sample, gain: +l.gain.gain.value.toFixed(4) } : null;
        });
        return {
            ctx: this.ctx?.state || null,
            muted: this._muted,
            samples: this.bank ? this.bank.stats() : null,
            decoded: this.bank ? [...this.bank.samples.entries()].filter(([, v]) => v).map(([k]) => k) : [],
            voices: this.voices.length,
            loops,
            played: { ...this.played },
        };
    }

    toggleMute() {
        this._muted = !this._muted;
        try { localStorage.setItem(STORAGE_KEY, this._muted ? '1' : '0'); } catch (e) { /* ignore */ }
        if (this.out) {
            const now = this.ctx.currentTime;
            this.out.gain.cancelScheduledValues(now);
            this.out.gain.setTargetAtTime(this._muted ? 0 : this.volume, now, 0.06);
        }
        return this._muted;
    }

    setVolume(v) {
        this.volume = clamp01(v);
        if (this.out && !this._muted) {
            const now = this.ctx.currentTime;
            this.out.gain.cancelScheduledValues(now);
            this.out.gain.setTargetAtTime(this.volume, now, 0.06);
        }
    }

    dispose() {
        this.unsubs.forEach(u => u());
        this.unsubs = [];
        this._stopLoop('wind'); this._stopLoop('carve'); this._stopLoop('gust'); this._stopLoop('rumble'); this._stopLoop('amb');
    }

    // ------------------------------------------------------------------
    // Voice management
    // ------------------------------------------------------------------
    /** Create a voice output gain; returns { t, gain, add(src) }. */
    _voice(duration, level = 1, pan = 0) {
        const ctx = this.ctx;
        const t = ctx.currentTime + 0.005;
        if (this.voices.length >= MAX_VOICES) this._steal();
        const gain = ctx.createGain();
        gain.gain.value = level;
        let tail = gain;
        if (pan && ctx.createStereoPanner) {
            const p = ctx.createStereoPanner();
            p.pan.value = Math.max(-1, Math.min(1, pan));
            gain.connect(p);
            tail = p;
        }
        tail.connect(this.out);
        const voice = { end: t + duration, gain, tail, sources: [], nodes: [] };
        this.voices.push(voice);
        const cleanupAt = (duration + 0.15) * 1000;
        voice.timer = setTimeout(() => this._release(voice), cleanupAt);
        return {
            t,
            gain,
            add: (src, ...nodes) => { voice.sources.push(src); voice.nodes.push(...nodes); return src; },
        };
    }

    _release(voice) {
        clearTimeout(voice.timer);
        const i = this.voices.indexOf(voice);
        if (i >= 0) this.voices.splice(i, 1);
        voice.sources.forEach(s => { try { s.stop(); } catch (e) { /* ignore */ } try { s.disconnect(); } catch (e) { /* ignore */ } });
        voice.nodes.forEach(n => { try { n.disconnect(); } catch (e) { /* ignore */ } });
        try { voice.gain.disconnect(); } catch (e) { /* ignore */ }
        if (voice.tail !== voice.gain) { try { voice.tail.disconnect(); } catch (e) { /* ignore */ } }
    }

    _steal() {
        const oldest = this.voices[0];
        if (!oldest) return;
        const now = this.ctx.currentTime;
        oldest.gain.gain.cancelScheduledValues(now);
        oldest.gain.gain.setTargetAtTime(0, now, 0.01);
        this.voices.shift();
        clearTimeout(oldest.timer);
        setTimeout(() => this._release(oldest), 60);
    }

    // Building blocks -------------------------------------------------
    _tone(v, { type = 'sine', f0, f1 = null, start = 0, dur = 0.2, peak = 0.2, attack = 0.004, dest = null }) {
        const ctx = this.ctx;
        const t = v.t + start;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f0, t);
        if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g);
        g.connect(dest || v.gain);
        o.start(t);
        o.stop(t + dur + 0.03);
        v.add(o, g);
        return o;
    }

    _noiseBurst(v, { start = 0, dur = 0.2, peak = 0.2, attack = 0.004, type = 'bandpass', f0 = 1000, f1 = null, q = 1, buffer = null, dest = null }) {
        const ctx = this.ctx;
        const t = v.t + start;
        const src = ctx.createBufferSource();
        src.buffer = buffer || this.noise;
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.setValueAtTime(f0, t);
        if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f); f.connect(g); g.connect(dest || v.gain);
        src.start(t, Math.random() * 1.5);
        src.stop(t + dur + 0.03);
        v.add(src, f, g);
        return src;
    }

    /**
     * One-shot sample. Returns false (so the caller can synthesize instead) if
     * the sample isn't available. vary: random playbackRate in 0.94..1.06.
     */
    _play(name, { level = 1, rate = null, vary = true, delay = 0, pan = 0 } = {}) {
        const s = this.bank?.get(name);
        if (!s) return false;
        if (this._muted) return true;
        const r = rate ?? (vary ? rand(0.94, 1.06) : 1);
        const dur = (s.buffer.duration - s.start) / r;
        const v = this._voice(dur + delay, level * s.norm, pan);
        const src = this.ctx.createBufferSource();
        src.buffer = s.buffer;
        src.playbackRate.value = r;
        src.connect(v.gain);
        src.start(v.t + delay, s.start);
        v.add(src);
        this.played[name] = (this.played[name] || 0) + 1;
        return true;
    }

    _chirp(freqs, gap = 0.07, level = 0.08) {
        const v = this._voice(gap * freqs.length + 0.3, level);
        freqs.forEach((f, i) => {
            this._tone(v, { type: 'sine', f0: f, start: i * gap, dur: 0.22, peak: 1 });
            this._tone(v, { type: 'triangle', f0: f * 2, start: i * gap, dur: 0.08, peak: 0.15 });
        });
    }

    _poof(level = 1, soft = false) {
        const v = this._voice(0.45, 0.22 * level);
        this._noiseBurst(v, { type: 'bandpass', f0: soft ? 1400 : 2200, f1: 280, q: 0.8, dur: 0.38, peak: 1, attack: 0.012 });
        this._tone(v, { type: 'sine', f0: 220, f1: 110, dur: 0.14, peak: 0.3 });
    }

    // ------------------------------------------------------------------
    // Loops
    // ------------------------------------------------------------------
    _startLoop(name, build) {
        if (this[name]) return this[name];
        const loop = build();
        this[name] = loop;
        return loop;
    }

    _stopLoop(name, fade = 0.25) {
        const loop = this[name];
        if (!loop) return;
        this[name] = null;
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        loop.gain.gain.cancelScheduledValues(now);
        loop.gain.gain.setTargetAtTime(0, now, fade / 3);
        setTimeout(() => {
            loop.sources.forEach(s => { try { s.stop(); } catch (e) { /* ignore */ } try { s.disconnect(); } catch (e) { /* ignore */ } });
            loop.nodes.forEach(n => { try { n.disconnect(); } catch (e) { /* ignore */ } });
        }, fade * 1000 + 200);
    }

    _noiseLoop(buffer, filterType, freq, q, level = 0) {
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.loopStart = 0;
        src.loopEnd = buffer.duration;
        const f = ctx.createBiquadFilter();
        f.type = filterType;
        f.frequency.value = freq;
        f.Q.value = q;
        const gain = ctx.createGain();
        gain.gain.value = level;
        src.connect(f); f.connect(gain); gain.connect(this.out);
        src.start(ctx.currentTime, Math.random() * buffer.duration);
        return { src, filter: f, gain, sources: [src], nodes: [f, gain] };
    }

    /** Looping sample bed: src -> lowpass -> gain(level) -> out. Same shape as _noiseLoop's result. */
    _sampleLoop(name, level = 0, cutoff = 20000) {
        const s = this.bank?.get(name);
        if (!s) return null;
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        src.buffer = s.buffer;
        src.loop = true;
        src.loopStart = s.loopStart;
        src.loopEnd = s.loopEnd;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = cutoff;
        f.Q.value = 0.5;
        const trim = ctx.createGain();
        trim.gain.value = s.norm;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(f); f.connect(trim); trim.connect(gain); gain.connect(this.out);
        src.start(ctx.currentTime, s.loopStart + Math.random() * (s.loopEnd - s.loopStart));
        if (level > 0) gain.gain.setTargetAtTime(level, ctx.currentTime, 0.4);
        this.played[name] = (this.played[name] || 0) + 1;
        return { src, filter: f, gain, sources: [src], nodes: [f, trim, gain], sample: true };
    }

    /** Always-on ambient wind bed: louder in the editor, tucked under the ski loops. */
    _updateAmb() {
        if (!this.ctx) return;
        if (!this.amb) {
            const amb = this._sampleLoop('wind-loop', 0, 6000);
            if (!amb) return;
            this.amb = amb;
        }
        const lvl = (this.skiing ? MIX.ambSki : MIX.ambEditor) * (this.blizzard ? 0.6 : 1);
        this.amb.gain.gain.setTargetAtTime(lvl, this.ctx.currentTime, 0.8);
    }

    _buildWind() {
        const sampled = this._sampleLoop('wind-fast-loop', 0, 900);
        if (sampled) return sampled;
        const ctx = this.ctx;
        const body = this._noiseLoop(this.noise, 'bandpass', 400, 0.9, 0);
        // Slow LFO wobble on the filter for organic gusting
        const lfo = ctx.createOscillator();
        const lfoG = ctx.createGain();
        lfo.frequency.value = 0.23;
        lfoG.gain.value = 90;
        lfo.connect(lfoG); lfoG.connect(body.filter.frequency);
        lfo.start();
        // Low rumble body (brown noise) for speed
        const low = ctx.createBufferSource();
        low.buffer = this.brown;
        low.loop = true;
        const lowF = ctx.createBiquadFilter();
        lowF.type = 'lowpass';
        lowF.frequency.value = 260;
        const lowG = ctx.createGain();
        lowG.gain.value = 0;
        low.connect(lowF); lowF.connect(lowG); lowG.connect(body.gain);
        low.start(ctx.currentTime, Math.random());
        body.sources.push(lfo, low);
        body.nodes.push(lfoG, lowF, lowG);
        body.low = lowG;
        body.gain.gain.setTargetAtTime(0.03, ctx.currentTime, 0.3);
        return body;
    }

    _buildCarve() {
        const sampled = this._sampleLoop('carve-loop', 0);
        if (sampled) return sampled;
        const ctx = this.ctx;
        const loop = this._noiseLoop(this.noise, 'highpass', 1800, 0.7, 0);
        // A resonant peak gives the "shhhk" of edges biting
        const peak = ctx.createBiquadFilter();
        peak.type = 'peaking';
        peak.frequency.value = 3200;
        peak.gain.value = 6;
        peak.Q.value = 1.4;
        loop.filter.disconnect();
        loop.filter.connect(peak);
        peak.connect(loop.gain);
        loop.peak = peak;
        loop.nodes.push(peak);
        return loop;
    }

    _setGust(on) {
        if (!this.ctx) return;
        if (on) {
            this._startLoop('gust', () => {
                const sampled = this._sampleLoop('blizzard-loop', MIX.blizzard, 7000);
                if (sampled) return sampled;
                const ctx = this.ctx;
                const loop = this._noiseLoop(this.noise, 'bandpass', 700, 0.6, 0);
                const lfo = ctx.createOscillator();
                const lfoG = ctx.createGain();
                lfo.frequency.value = 0.17;
                lfoG.gain.value = 0.05;
                // Modulate an intermediate gain so the loop gain can still fade
                const mod = ctx.createGain();
                mod.gain.value = 0.08;
                loop.filter.disconnect();
                loop.filter.connect(mod);
                mod.connect(loop.gain);
                lfo.connect(lfoG); lfoG.connect(mod.gain);
                const lfo2 = ctx.createOscillator();
                const lfo2G = ctx.createGain();
                lfo2.frequency.value = 0.09;
                lfo2G.gain.value = 380;
                lfo2.connect(lfo2G); lfo2G.connect(loop.filter.frequency);
                lfo.start(); lfo2.start();
                loop.sources.push(lfo, lfo2);
                loop.nodes.push(lfoG, mod, lfo2G);
                loop.gain.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
                return loop;
            });
        } else {
            this._stopLoop('gust', 1.5);
        }
    }

    // ------------------------------------------------------------------
    // Ski handlers
    // ------------------------------------------------------------------
    _onSkiStart() {
        this.skiing = true;
        // Light duck only: the ski track is part of the experience, it just needs to sit under wind/carve
        this.music?.setDucked?.(0.2);
        this._startLoop('wind', () => this._buildWind());
        this._startLoop('carve', () => this._buildCarve());
        this._updateAmb();
        // "drop in" swell
        if (!this._play('jump-takeoff', { level: 0.3, rate: 0.8, vary: false })) {
            const v = this._voice(0.8, 0.12);
            this._noiseBurst(v, { type: 'bandpass', f0: 300, f1: 1800, q: 1.2, dur: 0.7, peak: 1, attack: 0.3 });
        }
    }

    _onSkiEnd() {
        this.skiing = false;
        this.music?.setDucked?.(0);
        this.music?.setIntensity?.(0);
        this._stopLoop('wind', 0.8);
        this._stopLoop('carve', 0.3);
        this._braking = false;
        this._updateAmb();
        // Gentle resolve chord
        const v = this._voice(2.2, 0.05);
        [0, 7, 12, 16].forEach((s, i) => this._tone(v, { f0: semis(329.63, s), start: i * 0.06, dur: 1.8, peak: 1, attack: 0.02 }));
    }

    _onSkiTick(p) {
        if (!this.skiing) this._onSkiStart();
        const now = this.ctx.currentTime;
        if (now - this._lastTickParam < 0.033) return; // ~30Hz param updates
        this._lastTickParam = now;

        const s = clamp01(p.speed01 ?? (Math.abs(p.speed || 0) / 60));
        const grounded = !!p.grounded && !p.ragdoll;
        const air = !grounded && !p.ragdoll;
        const tuck = !!p.tucking;

        if (this.wind?.sample) {
            // Recorded rushing wind: fades in with speed, lowpass opens as it gets faster
            const w = this.wind;
            const lvl = MIX.windFast * (0.03 + 0.97 * Math.pow(s, 1.5)) * (tuck ? 1.15 : 1) + (air ? 0.08 : 0);
            w.gain.gain.setTargetAtTime(lvl, now, 0.15);
            w.filter.frequency.setTargetAtTime(700 + 9000 * Math.pow(s, 1.2) + (air ? 1500 : 0), now, 0.2);
            w.src.playbackRate.setTargetAtTime(0.92 + 0.16 * s, now, 0.4);
        } else if (this.wind) {
            const w = this.wind;
            const lvl = 0.025 + 0.26 * Math.pow(s, 1.4) * (tuck ? 1.2 : 1) + (air ? 0.06 : 0);
            w.gain.gain.setTargetAtTime(lvl, now, 0.12);
            w.filter.frequency.setTargetAtTime(320 + 1900 * s + (air ? 500 : 0), now, 0.15);
            w.filter.Q.setTargetAtTime(0.7 + s * 0.8, now, 0.2);
            w.low.gain.setTargetAtTime(0.5 + s * 1.5, now, 0.2);
        }
        const braking = !!p.braking;
        if (this.carve?.sample) {
            const c = this.carve;
            const edge = Math.abs(p.edge || 0);
            let lvl = grounded ? (0.18 + 0.62 * edge + (braking ? 0.4 : 0)) * Math.min(1, s * 1.8) : 0;
            if (s < 0.02) lvl = 0;
            // Quick attack on touchdown, quick release on takeoff; both exponential, so no clicks
            c.gain.gain.setTargetAtTime(Math.min(1.2, lvl) * MIX.carve, now, grounded ? 0.06 : 0.04);
            c.src.playbackRate.setTargetAtTime(0.85 + 0.3 * s + (braking ? 0.12 : 0), now, 0.15);
            c.filter.frequency.setTargetAtTime(braking ? 12000 : 5000 + 9000 * edge, now, 0.1);
        } else if (this.carve) {
            const c = this.carve;
            const edge = Math.abs(p.edge || 0);
            let lvl = grounded ? (0.03 + 0.42 * edge + (braking ? 0.35 : 0)) * Math.min(1, s * 1.6) : 0;
            if (s < 0.02) lvl = 0;
            c.gain.gain.setTargetAtTime(lvl * 0.55, now, grounded ? 0.05 : 0.03);
            c.filter.frequency.setTargetAtTime(braking ? 2600 : 1500 + 900 * edge, now, 0.08);
            c.peak.frequency.setTargetAtTime(braking ? 5200 : 2600 + 1600 * s, now, 0.1);
        }
        // Hockey-stop spray on the rising edge of a brake at speed
        if (braking && !this._braking && grounded && s > 0.2 && now - this._lastSpray > 0.7) {
            this._lastSpray = now;
            this._play('snow-spray', { level: 0.25 + 0.35 * s });
        }
        this._braking = braking;
        this.music?.setIntensity?.(s);
    }

    _onJump(p) {
        const power = clamp01((p.power || 8) / 18);
        if (this._play('jump-takeoff', { level: 0.4 + 0.3 * power })) return;
        const v = this._voice(0.6, 0.14 + 0.12 * power);
        this._noiseBurst(v, { type: 'bandpass', f0: 380, f1: 2600 + 1400 * power, q: 1.6, dur: 0.42, peak: 1, attack: 0.06 });
        this._tone(v, { type: 'sine', f0: 140, f1: 240, dur: 0.18, peak: 0.25 });
    }

    _onLand(p) {
        const imp = clamp01(p.impact ?? 0.4);
        const hard = imp >= 0.55 || (p.airTime || 0) >= 1.4;
        if (this._play(hard ? 'land-hard' : 'land-soft', { level: hard ? 0.5 + 0.35 * imp : 0.35 + 0.4 * imp })) {
            if (hard) this._play('snow-spray', { level: 0.2 + 0.2 * imp, delay: 0.03 });
            return;
        }
        const v = this._voice(0.6, 0.18 + 0.4 * imp);
        // Low thump
        this._tone(v, { type: 'sine', f0: 130 + 40 * imp, f1: 42, dur: 0.22 + 0.1 * imp, peak: 0.9 });
        // Snow crunch
        this._noiseBurst(v, { type: 'lowpass', f0: 2400, f1: 500, q: 0.6, dur: 0.22 + 0.15 * imp, peak: 0.7, attack: 0.003 });
        this._noiseBurst(v, { type: 'highpass', f0: 4000, q: 0.5, dur: 0.09, peak: 0.25 * (0.4 + imp) });
    }

    _onTrick(p) {
        const combo = Math.max(1, p.combo || 1);
        const points = p.points || 0;
        // Recorded chime (pitched up a touch per combo step), combo riser layered on top
        if (this.bank?.has('trick-success')) {
            const up = Math.pow(2, Math.min(combo - 1, 5) / 24); // quarter-tone per step, capped
            this._play('trick-success', { level: 0.45, rate: up * rand(0.98, 1.02), vary: false });
            if (combo >= 2) this._play('combo', { level: 0.22 + 0.04 * Math.min(combo, 6), delay: 0.12 });
            if (points < 1000) return;
        }
        const voices = Math.min(3 + combo, 7);
        const lift = Math.min(combo - 1, 7); // semitones up per combo step
        const v = this._voice(1.6 + voices * 0.07, 0.07);
        for (let i = 0; i < voices; i++) {
            const deg = PENTA[i % PENTA.length] + 12 * Math.floor(i / PENTA.length);
            const f = semis(E5 * 0.5, deg + lift);
            const st = i * 0.055;
            this._tone(v, { type: 'triangle', f0: f, start: st, dur: 0.9, peak: 0.9 });
            this._tone(v, { type: 'sine', f0: f * 2, start: st, dur: 0.6, peak: 0.35 });
        }
        if (points >= 1000) {
            // Sparkle: fast high run + airy shimmer
            for (let i = 0; i < 8; i++) {
                const f = semis(E5 * 2, PENTA[(Math.random() * 5) | 0] + 12 * (i > 4 ? 1 : 0));
                this._tone(v, { type: 'sine', f0: f, start: 0.25 + i * 0.035, dur: 0.5, peak: 0.25 });
            }
            this._noiseBurst(v, { type: 'highpass', f0: 7000, q: 0.5, start: 0.2, dur: 0.9, peak: 0.25, attack: 0.15 });
        }
    }

    _onCrash(p) {
        const s = clamp01((p.speed || 20) / 60);
        if (this._play('crash', { level: 0.5 + 0.35 * s })) {
            this._play('land-hard', { level: 0.3 + 0.3 * s, rate: 0.85 });
            return;
        }
        const v = this._voice(1.2, 0.35 + 0.3 * s);
        this._tone(v, { type: 'sine', f0: 110, f1: 32, dur: 0.4, peak: 1 });
        this._noiseBurst(v, { type: 'lowpass', f0: 3200, f1: 260, q: 0.7, dur: 0.6, peak: 0.9, attack: 0.004 });
        // Tumble: a few smaller crunches
        for (let i = 1; i <= 3; i++) {
            this._noiseBurst(v, { type: 'bandpass', f0: rand(700, 1600), q: 0.9, start: i * rand(0.14, 0.2), dur: 0.14, peak: 0.45 / i });
            this._tone(v, { type: 'sine', f0: 90, f1: 45, start: i * 0.17, dur: 0.12, peak: 0.4 / i });
        }
        // Sad little downward blip
        this._tone(v, { type: 'triangle', f0: 392, f1: 196, start: 0.35, dur: 0.35, peak: 0.12 });
    }

    _onCollide(p) {
        const now = this.ctx.currentTime;
        if (now - this._lastCollide < 0.12) return;
        this._lastCollide = now;
        const type = String(p.type || '').toLowerCase();
        const s = clamp01((p.speed || 15) / 50);
        const v = this._voice(0.4, 0.2 + 0.25 * s);
        if (type.includes('tree')) {
            this._tone(v, { type: 'triangle', f0: 190, f1: 120, dur: 0.16, peak: 0.8 });
            this._noiseBurst(v, { type: 'bandpass', f0: 900, q: 2, dur: 0.08, peak: 0.6 });
        } else if (type.includes('flag')) {
            this._tone(v, { type: 'triangle', f0: 520, f1: 470, dur: 0.35, peak: 0.6 });
            this._tone(v, { type: 'sine', f0: 1040, dur: 0.2, peak: 0.2 });
        } else if (type.includes('snowman')) {
            if (this._play('snowball-hit', { level: 0.6 + 0.3 * s })) return;
            this._noiseBurst(v, { type: 'lowpass', f0: 1800, f1: 300, q: 0.5, dur: 0.3, peak: 1 });
        } else {
            // Bonk
            this._tone(v, { type: 'sine', f0: 240, f1: 140, dur: 0.14, peak: 1 });
            this._tone(v, { type: 'square', f0: 120, f1: 90, dur: 0.05, peak: 0.12 });
        }
    }

    _onTreeKnock() {
        if (this.bank?.has('tree-fall')) {
            this._play('snowball-hit', { level: 0.6 });
            this._play('tree-fall', { level: 0.55, delay: 0.06 });
            return;
        }
        const v = this._voice(1.4, 0.3);
        // Crack: sharp crackles
        for (let i = 0; i < 4; i++) {
            this._noiseBurst(v, { type: 'highpass', f0: rand(1800, 3200), q: 0.8, start: i * rand(0.025, 0.05), dur: 0.035, peak: 0.9 - i * 0.15, attack: 0.001 });
        }
        this._tone(v, { type: 'triangle', f0: 260, f1: 150, dur: 0.12, peak: 0.4 });
        // Creak
        this._tone(v, { type: 'sawtooth', f0: 95, f1: 70, start: 0.15, dur: 0.35, peak: 0.05, attack: 0.08 });
        // Whump as it hits the snow, plus a powder spray
        this._tone(v, { type: 'sine', f0: 85, f1: 34, start: 0.75, dur: 0.35, peak: 0.9 });
        this._noiseBurst(v, { type: 'lowpass', f0: 1600, f1: 200, q: 0.5, start: 0.74, dur: 0.55, peak: 0.6, attack: 0.01 });
    }

    _onSnowballThrow() {
        if (this._play('snowball-throw', { level: 0.4 })) return;
        const v = this._voice(0.4, 0.1);
        this._noiseBurst(v, { type: 'bandpass', f0: 600, f1: 2400, q: 1.4, dur: 0.3, peak: 1, attack: 0.04 });
    }

    // ------------------------------------------------------------------
    // Placement / sculpt
    // ------------------------------------------------------------------
    _onPlace(p, level = 1) {
        const now = this.ctx.currentTime;
        // Bulk generation emits many events: thin them into a pleasant patter
        if (now - this._lastPlace < (level < 1 ? 0.06 : 0.035)) return;
        this._lastPlace = now;
        const type = String(p.type || '');
        const big = type === 'lodge' || type === 'ski-lift' || type === 'gondola';
        const lift = type === 'ski-lift' || type === 'gondola';
        if (this.bank?.has('place-object')) {
            this._play('place-object', { level: (big ? 0.6 : 0.45) * level, rate: (big ? 0.85 : type === 'flag' ? 1.15 : 1) * rand(0.94, 1.06), vary: false });
            if (lift && level >= 1) this._play('lift-chime', { level: 0.35, delay: 0.12 });
            return;
        }
        const pitch = rand(0.88, 1.14) * (big ? 0.7 : type === 'flag' ? 1.4 : 1);
        const v = this._voice(0.45, (big ? 0.32 : 0.24) * level);
        this._tone(v, { type: 'sine', f0: 190 * pitch, f1: 85 * pitch, dur: 0.16, peak: 1 });
        this._noiseBurst(v, { type: 'lowpass', f0: 1200, f1: 400, q: 0.5, dur: 0.1, peak: 0.45 });
        // Little snow sparkle on top
        this._tone(v, { type: 'sine', f0: semis(E5 * 2, PENTA[(Math.random() * 5) | 0]), start: 0.04, dur: 0.25, peak: 0.07 });
        if (big) this._tone(v, { type: 'triangle', f0: 98, f1: 60, start: 0.02, dur: 0.3, peak: 0.4 });
    }

    _onRemove(p) {
        const many = (p.count || 1) > 1;
        if (this._play('remove-object', { level: many ? 0.5 : 0.35 })) {
            if (!many) return;
            const v = this._voice(0.8, 0.14);
            this._noiseBurst(v, { type: 'lowpass', f0: 900, f1: 150, q: 0.4, dur: 0.7, peak: 1, attack: 0.04 });
            return;
        }
        this._poof(many ? 1.6 : 1);
        if (many) {
            const v = this._voice(0.8, 0.14);
            this._noiseBurst(v, { type: 'lowpass', f0: 900, f1: 150, q: 0.4, dur: 0.7, peak: 1, attack: 0.04 });
        }
    }

    _onInvalid() {
        const v = this._voice(0.35, 0.12);
        this._tone(v, { type: 'triangle', f0: 196, dur: 0.1, peak: 1 });
        this._tone(v, { type: 'triangle', f0: 156, start: 0.11, dur: 0.16, peak: 1 });
    }

    _onSculpt(p) {
        if (p.phase === 'start') {
            const mode = p.mode;
            this._stopLoop('rumble', 0.05);
            const sampled = this._sampleLoop('sculpt-loop', 0, mode === 'smooth' ? 4000 : 9000);
            if (sampled) {
                sampled.src.playbackRate.value = mode === 'raise' ? 1.06 : mode === 'lower' ? 0.86 : 1;
                sampled.gain.gain.setTargetAtTime(MIX.sculpt * (mode === 'smooth' ? 0.7 : 1), this.ctx.currentTime, 0.08);
                this.rumble = sampled;
                return;
            }
            const loop = this._noiseLoop(this.brown, 'lowpass', mode === 'raise' ? 380 : mode === 'lower' ? 220 : 520, 0.8, 0);
            loop.gain.gain.setTargetAtTime(mode === 'smooth' ? 0.12 : 0.22, this.ctx.currentTime, 0.08);
            this.rumble = loop;
            const v = this._voice(0.3, 0.1);
            this._tone(v, { type: 'sine', f0: mode === 'lower' ? 140 : 180, f1: mode === 'lower' ? 90 : 260, dur: 0.2, peak: 1 });
        } else {
            const sampled = !!this.rumble?.sample;
            this._stopLoop('rumble', 0.35);
            if (sampled) return;
            const v = this._voice(0.4, 0.12);
            this._tone(v, { type: 'sine', f0: 120, f1: 60, dur: 0.2, peak: 1 });
            this._noiseBurst(v, { type: 'lowpass', f0: 900, f1: 200, dur: 0.25, peak: 0.6 });
        }
    }

    // ------------------------------------------------------------------
    // UI / environment
    // ------------------------------------------------------------------
    _onClick() {
        if (this._play('ui-click', { level: 0.14 })) return;
        const v = this._voice(0.08, 0.05);
        this._tone(v, { type: 'sine', f0: 1800, f1: 1200, dur: 0.035, peak: 1, attack: 0.001 });
        this._noiseBurst(v, { type: 'highpass', f0: 6000, dur: 0.012, peak: 0.4, attack: 0.001 });
    }

    _onHover() {
        const now = this.ctx.currentTime;
        if (now - this._lastHover < 0.09) return;
        this._lastHover = now;
        if (this._play('ui-hover', { level: 0.05 })) return;
        const v = this._voice(0.05, 0.012);
        this._tone(v, { type: 'sine', f0: 3200, dur: 0.02, peak: 1, attack: 0.001 });
    }

    _onNight(p) {
        const night = !!p.night;
        // Shimmer either way; a touch brighter and quieter going back to day
        if (this._play('night-transition', { level: night ? 0.4 : 0.28, rate: night ? 1 : 1.12, vary: false })) return;
        // Soft chime swell: dreamy low chord for night, bright open chord for day
        const root = night ? 246.94 : 329.63;
        const chord = night ? [0, 3, 7, 10, 14] : [0, 4, 7, 11, 14];
        const v = this._voice(3.2, 0.045);
        chord.forEach((s, i) => {
            const f = semis(root, s);
            this._tone(v, { type: 'sine', f0: f, start: i * 0.09, dur: 2.8, peak: 1, attack: 0.5 });
            this._tone(v, { type: 'sine', f0: f * 2.01, start: i * 0.09 + 0.02, dur: 1.4, peak: 0.25, attack: 0.3 });
        });
        this._noiseBurst(v, { type: 'highpass', f0: 6500, dur: 1.6, peak: 0.25, attack: 0.6 });
    }

    _onBlizzard(p) {
        this.blizzard = !!p.on;
        this._setGust(this.blizzard);
        this._updateAmb();
        const v = this._voice(1.4, 0.12);
        this._noiseBurst(v, { type: 'bandpass', f0: this.blizzard ? 300 : 1400, f1: this.blizzard ? 1600 : 300, q: 0.9, dur: 1.2, peak: 1, attack: 0.4 });
    }
}
