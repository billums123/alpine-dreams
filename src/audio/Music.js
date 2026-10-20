/**
 * Music - generative soundtrack for Alpine Dreams.
 *
 * Owns the app's ONLY AudioContext (Sfx shares it via getContext()).
 *
 * Graph:
 *   track bus (fader) ─┐
 *   track bus (fader) ─┴─> musicIn ─> duckFilter ─> output (volume/mute) ─┐
 *                                                    sfxBus (Sfx owns gain) ┴─> limiter ─> masterOut ─> destination
 *
 * Tracks are step sequencers (16th notes) driven by a look-ahead scheduler on
 * the audio clock, so timing stays tight even when the main thread is busy.
 * Switching tracks crossfades (~1.5s). setDucked() lowpasses and dips the
 * music so wind/carve sfx read while skiing. setIntensity() drives an
 * adaptive hi-hat/shimmer layer (speed-reactive).
 */

const LOOKAHEAD_S = 0.14;       // how far ahead we schedule notes
const SCHEDULER_MS = 30;        // how often the scheduler wakes up
const CROSSFADE_S = 1.5;
const STORAGE_KEY = 'alpineDreams.musicMuted';

const TRACKS = [
    { id: 1, name: 'Shimmer Drive', bpm: 110, level: 1.0 },
    { id: 2, name: 'Deep Ambient', bpm: 85, level: 1.8 },
    { id: 3, name: 'Golden Hour', bpm: 88, level: 1.05 },
];

function readStoredBool(key) {
    try { return localStorage.getItem(key) === '1'; } catch (e) { return false; }
}
function writeStoredBool(key, v) {
    try { localStorage.setItem(key, v ? '1' : '0'); } catch (e) { /* ignore */ }
}

export class Music {
    constructor() {
        this.audioContext = null;
        this.output = null;        // music master (volume + mute)
        this.masterGain = null;    // back-compat alias of output
        this.sfxBus = null;        // Sfx connects here
        this.limiter = null;
        this.masterOut = null;
        this.duckFilter = null;
        this.duckGain = null;
        this.musicIn = null;

        this.isPlaying = false;
        this.isMuted = readStoredBool(STORAGE_KEY);
        this.volume = 0.55;
        this.currentTrack = 1;
        this.bpm = TRACKS[0].bpm;
        this.beatTime = 60 / this.bpm;

        this.ducked = 0;
        this.intensity = 0;

        this.bus = null;           // active track bus
        this.fadingBuses = new Set();
        this.schedulerId = null;
        this.noiseBuffer = null;
        this.impulse = null;

        // Kept for back-compat (older code inspected these)
        this.intervals = [];
        this.timeouts = [];

        this._unlock = this._unlock.bind(this);
        this._onVisibility = this._onVisibility.bind(this);
    }

    /** Arms the first-gesture unlock. Never creates a context without a gesture. */
    init() {
        const opts = { capture: true };
        ['pointerdown', 'keydown', 'touchstart'].forEach(t => document.addEventListener(t, this._unlock, opts));
        document.addEventListener('visibilitychange', this._onVisibility);
    }

    _unlock() {
        ['pointerdown', 'keydown', 'touchstart'].forEach(t => document.removeEventListener(t, this._unlock, { capture: true }));
        this.tryStart();
    }

    _onVisibility() {
        if (!this.audioContext) return;
        if (document.hidden) {
            this.audioContext.suspend?.().catch(() => {});
        } else {
            this.audioContext.resume?.().catch(() => {});
            // Don't try to "catch up" on missed steps
            if (this.bus) this.bus.nextTime = Math.max(this.bus.nextTime, this.audioContext.currentTime + 0.05);
        }
    }

    /** The shared AudioContext (null until the first user gesture). */
    getContext() {
        return this.audioContext;
    }

    tryStart() {
        if (this.audioContext) {
            if (this.audioContext.state === 'suspended') this.audioContext.resume().catch(() => {});
            return;
        }
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        try {
            const ctx = new Ctx({ latencyHint: 'interactive' });
            this.audioContext = ctx;

            this.limiter = ctx.createDynamicsCompressor();
            this.limiter.threshold.value = -8;
            this.limiter.knee.value = 8;
            this.limiter.ratio.value = 10;
            this.limiter.attack.value = 0.004;
            this.limiter.release.value = 0.22;

            this.masterOut = ctx.createGain();
            this.masterOut.gain.value = 0.95;
            this.limiter.connect(this.masterOut);
            this.masterOut.connect(ctx.destination);

            this.output = ctx.createGain();
            this.output.gain.value = 0;
            this.output.gain.setTargetAtTime(this.isMuted ? 0 : this.volume, ctx.currentTime, 0.6);
            this.output.connect(this.limiter);
            this.masterGain = this.output;

            this.duckFilter = ctx.createBiquadFilter();
            this.duckFilter.type = 'lowpass';
            this.duckFilter.frequency.value = 20000;
            this.duckFilter.Q.value = 0.5;
            this.duckGain = ctx.createGain();
            this.duckGain.gain.value = 1;
            this.duckFilter.connect(this.duckGain);
            this.duckGain.connect(this.output);

            this.musicIn = ctx.createGain();
            this.musicIn.connect(this.duckFilter);

            this.sfxBus = ctx.createGain();
            this.sfxBus.gain.value = 1;
            this.sfxBus.connect(this.limiter);

            this.noiseBuffer = this._makeNoise(2);
            this.impulse = this._makeImpulse(3.2, 2.6);

            if (ctx.state === 'suspended') ctx.resume().catch(() => {});

            this.setDucked(this.ducked);
            this.play();
        } catch (e) {
            console.warn('Could not start music:', e);
        }
    }

    // ==========================================
    // BUFFERS
    // ==========================================
    _makeNoise(seconds) {
        const ctx = this.audioContext;
        const len = Math.floor(ctx.sampleRate * seconds);
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        return buf;
    }

    /** Synthetic stereo hall impulse: decaying, slightly lowpassed noise. */
    _makeImpulse(seconds, decay) {
        const ctx = this.audioContext;
        const len = Math.floor(ctx.sampleRate * seconds);
        const buf = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = buf.getChannelData(c);
            let lp = 0;
            for (let i = 0; i < len; i++) {
                const t = i / len;
                const n = Math.random() * 2 - 1;
                lp += (n - lp) * (0.35 - 0.25 * t); // darker tail
                const pre = i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1;
                d[i] = lp * Math.pow(1 - t, decay) * pre * 1.6;
            }
        }
        return buf;
    }

    // ==========================================
    // TRACK BUS + SCHEDULER
    // ==========================================
    _createBus(trackId) {
        const ctx = this.audioContext;
        const track = TRACKS.find(t => t.id === trackId) || TRACKS[0];
        const beat = 60 / track.bpm;

        const fader = ctx.createGain();
        fader.gain.value = 0;
        fader.connect(this.musicIn);

        const dry = ctx.createGain();
        dry.connect(fader);

        // Ping-pong-ish delay (dotted eighth), filtered feedback
        const delay = ctx.createDelay(2);
        delay.delayTime.value = beat * 0.75;
        const fb = ctx.createGain();
        fb.gain.value = trackId === 2 ? 0.45 : 0.38;
        const dlp = ctx.createBiquadFilter();
        dlp.type = 'lowpass';
        dlp.frequency.value = 2800;
        const delayOut = ctx.createGain();
        delayOut.gain.value = 0.55;
        delay.connect(dlp);
        dlp.connect(fb);
        fb.connect(delay);
        dlp.connect(delayOut);
        const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        if (panner) {
            panner.pan.value = 0.35;
            delayOut.connect(panner);
            panner.connect(fader);
        } else {
            delayOut.connect(fader);
        }

        // Shared-IR convolution reverb (one per bus, only two buses ever overlap)
        const reverbIn = ctx.createGain();
        const convolver = ctx.createConvolver();
        convolver.buffer = this.impulse;
        const reverbOut = ctx.createGain();
        reverbOut.gain.value = trackId === 2 ? 0.75 : 0.55;
        reverbIn.connect(convolver);
        convolver.connect(reverbOut);
        reverbOut.connect(fader);

        // Adaptive layer (hi-hats / shimmer) follows intensity
        const adaptive = ctx.createGain();
        adaptive.gain.value = this.intensity * 0.9;
        adaptive.connect(dry);
        adaptive.connect(reverbIn);

        return {
            trackId, beat, fader, dry, delay, reverbIn, adaptive,
            nodes: [fader, dry, delay, fb, dlp, delayOut, panner, reverbIn, convolver, reverbOut, adaptive].filter(Boolean),
            step: 0,
            nextTime: ctx.currentTime + 0.08,
            alive: true,
            state: {},
        };
    }

    _disposeBus(bus) {
        bus.alive = false;
        bus.nodes.forEach(n => { try { n.disconnect(); } catch (e) { /* ignore */ } });
        this.fadingBuses.delete(bus);
    }

    _startScheduler() {
        if (this.schedulerId) return;
        this.schedulerId = setInterval(() => this._schedule(), SCHEDULER_MS);
    }

    _stopScheduler() {
        if (this.schedulerId) clearInterval(this.schedulerId);
        this.schedulerId = null;
    }

    _schedule() {
        const ctx = this.audioContext;
        if (!ctx) return;
        const horizon = ctx.currentTime + LOOKAHEAD_S;
        const buses = this.bus ? [this.bus, ...this.fadingBuses] : [...this.fadingBuses];
        for (const bus of buses) {
            if (!bus.alive) continue;
            // If we fell far behind (tab throttled), skip ahead instead of bursting
            if (bus.nextTime < ctx.currentTime - 0.25) bus.nextTime = ctx.currentTime + 0.03;
            const sixteenth = bus.beat / 4;
            while (bus.nextTime < horizon) {
                this._playStep(bus, bus.step, bus.nextTime);
                bus.step++;
                bus.nextTime += sixteenth;
            }
        }
        if (!this.bus && this.fadingBuses.size === 0) this._stopScheduler();
    }

    _playStep(bus, step, t) {
        if (bus.trackId === 1) this._stepShimmerDrive(bus, step, t);
        else if (bus.trackId === 2) this._stepDeepAmbient(bus, step, t);
        else this._stepGoldenHour(bus, step, t);
    }

    play() {
        if (this.isPlaying || !this.audioContext) return;
        this.isPlaying = true;
        this.bus = this._createBus(this.currentTrack);
        const now = this.audioContext.currentTime;
        this.bus.fader.gain.setValueAtTime(0, now);
        const level = (TRACKS.find(t => t.id === this.currentTrack) || TRACKS[0]).level || 1;
        this.bus.fader.gain.linearRampToValueAtTime(level, now + CROSSFADE_S);
        this._startScheduler();
    }

    toggleTrack() {
        const idx = TRACKS.findIndex(t => t.id === this.currentTrack);
        this.currentTrack = TRACKS[(idx + 1) % TRACKS.length].id;
        this.bpm = TRACKS.find(t => t.id === this.currentTrack).bpm;
        this.beatTime = 60 / this.bpm;

        if (!this.audioContext) return this.currentTrack;

        // Crossfade: old bus fades out (keeps playing during the fade), new fades in
        const now = this.audioContext.currentTime;
        if (this.bus) {
            const old = this.bus;
            this.fadingBuses.add(old);
            const g = old.fader.gain;
            g.cancelScheduledValues(now);
            g.setValueAtTime(g.value, now);
            g.linearRampToValueAtTime(0, now + CROSSFADE_S);
            // Stop sequencing at fade end; let tails ring, then disconnect
            old.fadeTimer = setTimeout(() => {
                old.alive = false;
                old.killTimer = setTimeout(() => this._disposeBus(old), 4000);
            }, CROSSFADE_S * 1000 + 50);
            this.bus = null;
        }
        this.isPlaying = false;
        this.play();
        return this.currentTrack;
    }

    getTrackName() {
        return (TRACKS.find(t => t.id === this.currentTrack) || TRACKS[0]).name;
    }

    // ==========================================
    // VOICES
    // ==========================================
    _osc(type, freq, t, dur, dest, gainPeak, { attack = 0.005, release = null, detune = 0, curve = 'exp' } = {}) {
        const ctx = this.audioContext;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (detune) o.detune.setValueAtTime(detune, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(gainPeak, t + attack);
        if (curve === 'exp') {
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        } else {
            const rel = release ?? dur * 0.4;
            g.gain.setValueAtTime(gainPeak, t + Math.max(attack, dur - rel));
            g.gain.linearRampToValueAtTime(0.0001, t + dur);
        }
        o.connect(g);
        const dests = Array.isArray(dest) ? dest : [dest];
        dests.forEach(d => d && g.connect(d));
        o.start(t);
        o.stop(t + dur + 0.05);
        o.onended = () => { try { g.disconnect(); } catch (e) { /* ignore */ } };
        return { o, g };
    }

    _pluck(bus, freq, t, vel = 1, { dur = 0.9, bright = 4200, type = 'triangle', sendDelay = true, sendVerb = 0.6 } = {}) {
        const ctx = this.audioContext;
        const o = ctx.createOscillator();
        const o2 = ctx.createOscillator();
        const f = ctx.createBiquadFilter();
        const g = ctx.createGain();
        const send = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        o2.type = 'sine';
        o2.frequency.setValueAtTime(freq * 2, t);
        const o2g = ctx.createGain();
        o2g.gain.value = 0.18;
        f.type = 'lowpass';
        f.frequency.setValueAtTime(bright, t);
        f.frequency.exponentialRampToValueAtTime(Math.max(400, bright * 0.3), t + dur * 0.5);
        f.Q.value = 1.2;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.12 * vel, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(f);
        o2.connect(o2g);
        o2g.connect(f);
        f.connect(g);
        g.connect(bus.dry);
        if (sendDelay) g.connect(bus.delay);
        send.gain.value = sendVerb;
        g.connect(send);
        send.connect(bus.reverbIn);
        o.start(t); o2.start(t);
        o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
        o.onended = () => { try { g.disconnect(); send.disconnect(); o2g.disconnect(); } catch (e) { /* ignore */ } };
    }

    _pad(bus, freqs, t, dur, level = 0.04, { cutoff = 900, attack = 2, release = 2, type = 'sine', spread = 0.004 } = {}) {
        const ctx = this.audioContext;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(cutoff * 0.6, t);
        f.frequency.linearRampToValueAtTime(cutoff, t + attack);
        f.frequency.linearRampToValueAtTime(cutoff * 0.7, t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(level, t + attack);
        g.gain.setValueAtTime(level, t + Math.max(attack, dur - release));
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        f.connect(g);
        g.connect(bus.reverbIn);
        const dryG = ctx.createGain();
        dryG.gain.value = 0.6;
        g.connect(dryG);
        dryG.connect(bus.dry);
        const oscs = [];
        freqs.forEach(freq => {
            [-1, 1].forEach(side => {
                const o = ctx.createOscillator();
                o.type = type;
                o.frequency.setValueAtTime(freq * (1 + side * spread * 0.5), t);
                o.connect(f);
                o.start(t);
                o.stop(t + dur + 0.1);
                oscs.push(o);
            });
        });
        oscs[0].onended = () => { try { f.disconnect(); g.disconnect(); dryG.disconnect(); } catch (e) { /* ignore */ } };
    }

    _kick(bus, t, level = 0.42) {
        const ctx = this.audioContext;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(95, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(level, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
        o.connect(g);
        g.connect(bus.dry);
        o.start(t);
        o.stop(t + 0.36);
        o.onended = () => { try { g.disconnect(); } catch (e) { /* ignore */ } };
    }

    _noiseHit(bus, t, { dur = 0.05, level = 0.05, hp = 7000, lp = 14000, dest = null } = {}) {
        const ctx = this.audioContext;
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const h = ctx.createBiquadFilter();
        h.type = 'highpass';
        h.frequency.value = hp;
        const l = ctx.createBiquadFilter();
        l.type = 'lowpass';
        l.frequency.value = lp;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(level, t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(h); h.connect(l); l.connect(g);
        g.connect(dest || bus.dry);
        const off = Math.random() * 1.5;
        src.start(t, off);
        src.stop(t + dur + 0.02);
        src.onended = () => { try { g.disconnect(); } catch (e) { /* ignore */ } };
    }

    _bass(bus, freq, t, dur, level = 0.28, cutoff = 320) {
        const ctx = this.audioContext;
        const o = ctx.createOscillator();
        const o2 = ctx.createOscillator();
        const f = ctx.createBiquadFilter();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(freq, t);
        o2.type = 'triangle';
        o2.frequency.setValueAtTime(freq * 1.002, t);
        f.type = 'lowpass';
        f.frequency.setValueAtTime(cutoff, t);
        f.Q.value = 0.9;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(level, t + 0.06);
        g.gain.setValueAtTime(level, t + dur * 0.6);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
        const mix = ctx.createGain();
        mix.gain.value = 0.6;
        o.connect(mix); o2.connect(mix); mix.connect(f); f.connect(g); g.connect(bus.dry);
        o.start(t); o2.start(t);
        o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
        o.onended = () => { try { g.disconnect(); mix.disconnect(); } catch (e) { /* ignore */ } };
    }

    _bell(bus, freq, t, level = 0.025) {
        [1, 2.4, 4.1, 5.9].forEach((h, i) => {
            this._osc('sine', freq * h, t, 4 - i * 0.7, [bus.delay, bus.reverbIn, bus.dry], level / (i + 1), { attack: 0.003 });
        });
    }

    // ==========================================
    // TRACK 1: SHIMMER DRIVE (110 bpm, E minor)
    // ==========================================
    _stepShimmerDrive(bus, step, t) {
        const beat = bus.beat;
        const bar = Math.floor(step / 16);
        const s16 = step % 16;

        // Kick on every beat, enters bar 1
        if (s16 % 4 === 0 && bar >= 1) this._kick(bus, t, 0.38);

        // Bass: half notes, E E A G, enters after 4 beats
        if (step >= 16 && step % 8 === 0) {
            const notes = [82.41, 82.41, 110, 98];
            this._bass(bus, notes[Math.floor(step / 8) % 4], t, beat * 1.8);
        }

        // Plucked melody on 8ths
        if (s16 % 2 === 0) {
            const pattern = [
                [659.25, 1], [493.88, 0.7], [587.33, 0.8], [493.88, 0.6],
                [659.25, 0.9], [587.33, 0.7], [493.88, 0.8], [440, 0.6],
            ];
            // Variation every 4th bar: lift the top note
            const p = pattern[(s16 / 2) | 0];
            let freq = p[0];
            if (bar % 4 === 3 && s16 === 8) freq = 783.99;
            this._pluck(bus, freq, t, p[1], { dur: 0.8, bright: 4000 });
        }

        // Pad every 2 bars, enters bar 2
        if (step >= 32 && step % 32 === 0) {
            const chords = [
                [164.81, 246.94, 329.63],
                [164.81, 246.94, 329.63],
                [220, 329.63, 440],
                [196, 293.66, 392],
            ];
            this._pad(bus, chords[Math.floor(step / 32) % 4], t, beat * 8, 0.035);
        }

        // High shimmer every bar from bar 3
        if (bar >= 3 && s16 === 0) {
            const notes = [1318.51, 1567.98, 1975.53, 2349.32];
            for (let i = 0; i < 2; i++) {
                const d = Math.random() * beat * 3;
                this._osc('sine', notes[(Math.random() * 4) | 0], t + d, 2.5, [bus.delay, bus.reverbIn], 0.014, { attack: 0.1 });
            }
        }

        // Adaptive: offbeat hats + 16th ghost hats at high intensity
        if (s16 % 4 === 2) this._noiseHit(bus, t, { dur: 0.045, level: 0.05, dest: bus.adaptive });
        else if (s16 % 2 === 1) this._noiseHit(bus, t, { dur: 0.025, level: 0.018, dest: bus.adaptive });
    }

    // ==========================================
    // TRACK 2: DEEP AMBIENT (85 bpm, A aeolian, no drums)
    // ==========================================
    _stepDeepAmbient(bus, step, t) {
        const beat = bus.beat;

        // Drone every 16 beats
        if (step % 64 === 0) {
            const roots = [55, 49, 55, 41.2];
            const root = roots[Math.floor(step / 64) % 4];
            [-1, 0, 1].forEach(d => {
                this._osc('sine', root * (1 + d * 0.002), t, beat * 12 + 4, bus.dry, 0.1, { attack: 5, curve: 'lin', release: 4 });
            });
        }

        // Slow plucks every half note (30% rests)
        if (step >= 8 && step % 8 === 0 && Math.random() < 0.72) {
            const notes = [329.63, 493.88, 440, 392, 329.63, 587.33, 493.88, 440];
            this._pluck(bus, notes[Math.floor(step / 8) % 8], t, 0.7, { dur: 2.2, bright: 2400, sendVerb: 0.9 });
        }

        // Pad every 12 beats
        if (step % 48 === 0) {
            const chords = [
                [220, 329.63, 493.88],
                [196, 293.66, 440],
                [174.61, 261.63, 392],
                [196, 293.66, 440],
            ];
            this._pad(bus, chords[Math.floor(step / 48) % 4], t, beat * 8 + 4, 0.05, { cutoff: 1200, attack: 3, release: 4, type: 'triangle' });
        }

        // Bells every 8 beats (60%)
        if (step >= 24 && step % 32 === 8 && Math.random() < 0.6) {
            const notes = [659.25, 783.99, 987.77, 1174.66, 1318.51];
            this._bell(bus, notes[(Math.random() * notes.length) | 0], t);
        }

        // Sub swell every 24 beats
        if (step >= 24 && step % 96 === 24) {
            this._osc('sine', 36, t, beat * 20, bus.dry, 0.12, { attack: beat * 6, curve: 'lin', release: beat * 6 });
        }

        // Adaptive: airy shimmer grains
        if (step % 4 === 2 && Math.random() < 0.6) {
            const n = [1318.51, 1479.98, 1760, 1975.53][(Math.random() * 4) | 0];
            this._osc('sine', n, t, 0.6, bus.adaptive, 0.03, { attack: 0.02 });
        }
    }

    // ==========================================
    // TRACK 3: GOLDEN HOUR (88 bpm, D major lo-fi keys)
    // ==========================================
    _stepGoldenHour(bus, step, t) {
        const beat = bus.beat;
        const bar = Math.floor(step / 16);
        const s16 = step % 16;
        // Dmaj7 - Bm9 - Gmaj7 - A6/9
        const chords = [
            [146.83, 220, 277.18, 369.99],
            [123.47, 185, 293.66, 369.99, 554.37],
            [98, 196, 246.94, 369.99],
            [110, 220, 277.18, 329.63, 493.88],
        ];
        const roots = [73.42, 61.74, 49, 55];
        const ci = bar % 4;

        // Rhodes-ish chord stabs: beat 1 and the "and" of 2 (swing)
        const swing = (s16 % 2 === 1) ? beat * 0.06 : 0;
        if (s16 === 0 || s16 === 6) {
            const lvl = s16 === 0 ? 0.03 : 0.02;
            chords[ci].forEach((f, i) => {
                this._osc('sine', f, t + swing + i * 0.012, beat * (s16 === 0 ? 2.2 : 1.4), [bus.dry, bus.reverbIn], lvl, { attack: 0.01 });
                this._osc('triangle', f * 2.001, t + swing + i * 0.012, 0.35, bus.dry, lvl * 0.25, { attack: 0.003 });
            });
        }

        // Soft round bass
        if (bar >= 1 && (s16 === 0 || s16 === 10)) {
            this._bass(bus, roots[ci] * (s16 === 10 ? 1.5 : 1), t, beat * (s16 === 0 ? 2.2 : 1.2), 0.24, 260);
        }

        // Felt kick + brushed snare
        if (bar >= 2) {
            if (s16 === 0 || s16 === 10) this._kick(bus, t, 0.26);
            if (s16 === 4 || s16 === 12) this._noiseHit(bus, t + beat * 0.02, { dur: 0.16, level: 0.045, hp: 1400, lp: 6000 });
        }

        // Pentatonic melody: gentle random walk, enters bar 4
        if (bar >= 4 && s16 % 2 === 0) {
            const st = bus.state;
            if (st.mel === undefined) st.mel = 4;
            if (Math.random() < 0.42) {
                const scale = [587.33, 659.25, 739.99, 880, 987.77, 1174.66, 1318.51, 1479.98];
                st.mel = Math.max(0, Math.min(scale.length - 1, st.mel + ((Math.random() * 5) | 0) - 2));
                this._pluck(bus, scale[st.mel], t + swing, 0.55, { dur: 1.1, bright: 3000, type: 'sine', sendVerb: 0.8 });
            }
        }

        // Adaptive: shaker 16ths
        if (bar >= 2) this._noiseHit(bus, t + swing, { dur: 0.03, level: s16 % 4 === 2 ? 0.04 : 0.02, hp: 5000, dest: bus.adaptive });
    }

    // ==========================================
    // CONTROLS
    // ==========================================
    setVolume(vol) {
        this.volume = Math.max(0, Math.min(1, vol));
        if (this.output) {
            const now = this.audioContext.currentTime;
            this.output.gain.cancelScheduledValues(now);
            this.output.gain.setTargetAtTime(this.isMuted ? 0 : this.volume, now, 0.08);
        }
    }

    mute() {
        this.isMuted = true;
        writeStoredBool(STORAGE_KEY, true);
        if (this.output) {
            const now = this.audioContext.currentTime;
            this.output.gain.cancelScheduledValues(now);
            this.output.gain.setTargetAtTime(0, now, 0.12);
        }
    }

    unmute() {
        this.isMuted = false;
        writeStoredBool(STORAGE_KEY, false);
        if (!this.audioContext) this.tryStart();
        if (this.output) {
            const now = this.audioContext.currentTime;
            this.output.gain.cancelScheduledValues(now);
            this.output.gain.setTargetAtTime(this.volume, now, 0.25);
        }
    }

    toggleMute() {
        if (this.isMuted) this.unmute();
        else this.mute();
        return this.isMuted;
    }

    /**
     * Duck the music (0 = full, 1 = heavily ducked): lowpass + level dip so
     * skiing sfx (wind, carve) read clearly.
     */
    setDucked(amount = 0) {
        this.ducked = Math.max(0, Math.min(1, amount));
        if (!this.duckFilter) return;
        const now = this.audioContext.currentTime;
        const freq = 20000 * Math.pow(900 / 20000, this.ducked);
        this.duckFilter.frequency.cancelScheduledValues(now);
        this.duckFilter.frequency.setTargetAtTime(freq, now, 0.35);
        this.duckGain.gain.cancelScheduledValues(now);
        this.duckGain.gain.setTargetAtTime(1 - 0.45 * this.ducked, now, 0.35);
    }

    /** Adaptive layer level (0..1), e.g. skier speed01. Cheap to call often. */
    setIntensity(v = 0) {
        const next = Math.max(0, Math.min(1, v));
        if (Math.abs(next - this.intensity) < 0.02) return;
        this.intensity = next;
        if (!this.bus) return;
        const now = this.audioContext.currentTime;
        this.bus.adaptive.gain.setTargetAtTime(next * 0.9, now, 0.25);
    }

    stop() {
        this.isPlaying = false;
        this.intervals.forEach(i => clearInterval(i));
        this.timeouts.forEach(t => clearTimeout(t));
        this.intervals = [];
        this.timeouts = [];
        const buses = this.bus ? [this.bus, ...this.fadingBuses] : [...this.fadingBuses];
        this.bus = null;
        const ctx = this.audioContext;
        buses.forEach(b => {
            clearTimeout(b.fadeTimer);
            clearTimeout(b.killTimer);
            b.alive = false;
            if (ctx) {
                const now = ctx.currentTime;
                b.fader.gain.cancelScheduledValues(now);
                b.fader.gain.setTargetAtTime(0, now, 0.08);
                b.killTimer = setTimeout(() => this._disposeBus(b), 600);
                this.fadingBuses.add(b);
            } else {
                this._disposeBus(b);
            }
        });
        this._stopScheduler();
    }
}
