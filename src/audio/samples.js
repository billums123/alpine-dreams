/**
 * SampleBank - fetch + decodeAudioData loader for the ElevenLabs sound pack
 * (assets/audio/*.mp3) on the shared AudioContext.
 *
 * Each decoded sample is analysed once:
 *   norm       gain that brings it to a common RMS (capped so peaks stay < -1 dBFS),
 *              so per-sound mix levels in Sfx are relative and files can be regenerated
 *   start      first audible sample (skips encoder padding / leading silence)
 *   loopStart / loopEnd   trimmed loop points for seamless beds
 *
 * Missing or undecodable files resolve as null; callers fall back to synthesis.
 */

export const AUDIO_BASE = new URL('../../assets/audio/', import.meta.url).href;

const TARGET_RMS = 0.1;         // -20 dBFS
const PEAK_CEIL = 0.89;         // -1 dBFS
const SILENCE = 0.0015;         // ~ -56 dBFS

function decode(ctx, data) {
    // Promise form everywhere modern; callback form for old Safari
    return new Promise((resolve, reject) => {
        const p = ctx.decodeAudioData(data, resolve, reject);
        if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
}

function analyse(buffer) {
    const chans = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
    const len = buffer.length;
    let sum = 0, peak = 0, first = -1, last = -1;
    for (let i = 0; i < len; i++) {
        let m = 0;
        for (let c = 0; c < chans.length; c++) {
            const v = chans[c][i];
            sum += v * v;
            const a = v < 0 ? -v : v;
            if (a > m) m = a;
        }
        if (m > peak) peak = m;
        if (m > SILENCE) {
            if (first < 0) first = i;
            last = i;
        }
    }
    const rms = Math.sqrt(sum / Math.max(1, len * chans.length));
    const sr = buffer.sampleRate;
    if (first < 0) { first = 0; last = len - 1; }
    const norm = rms > 1e-6 ? Math.min(TARGET_RMS / rms, PEAK_CEIL / Math.max(peak, 1e-6)) : 1;
    return {
        norm,
        start: first / sr,
        loopStart: first / sr,
        loopEnd: (last + 1) / sr,
        rms,
        peak,
    };
}

export class SampleBank {
    constructor(ctx, base = AUDIO_BASE) {
        this.ctx = ctx;
        this.base = base;
        this.samples = new Map();   // name -> { buffer, norm, start, loopStart, loopEnd } | null
        this.pending = new Map();   // name -> Promise
    }

    /** Sample record, or null if not (yet) loaded / failed. */
    get(name) {
        return this.samples.get(name) || null;
    }

    has(name) {
        return !!this.samples.get(name);
    }

    load(name) {
        if (this.pending.has(name)) return this.pending.get(name);
        const p = fetch(this.base + name + '.mp3')
            .then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.arrayBuffer();
            })
            .then(data => decode(this.ctx, data))
            .then(buffer => {
                const rec = { name, buffer, ...analyse(buffer) };
                this.samples.set(name, rec);
                return rec;
            })
            .catch(err => {
                console.info(`[audio] sample "${name}" unavailable, using synth fallback (${err?.message || err})`);
                this.samples.set(name, null);
                return null;
            });
        this.pending.set(name, p);
        return p;
    }

    loadAll(names) {
        return Promise.all(names.map(n => this.load(n)));
    }

    stats() {
        let loaded = 0, failed = 0;
        for (const v of this.samples.values()) v ? loaded++ : failed++;
        return { loaded, failed, pending: this.pending.size - loaded - failed };
    }
}
