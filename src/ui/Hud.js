/**
 * SkiHud - the in-run HUD, driven only by ski:* events (DESIGN_BRIEF §3.4).
 * Owned by the UI workstream. DOM lives in index.html under #skier-hud.
 *
 * Writes are change-detected so a 60 Hz ski:tick costs a handful of comparisons.
 */

import { events } from '../core/events.js';

const GAUGE_LEN = 273.3;   // 0.75 * 2*PI*58
const RING_LEN = 169.6;    // 2*PI*27

const fmt = (n) => Math.round(n).toLocaleString('en-US');

export class SkiHud {
    constructor({ onRideAgain = null } = {}) {
        this.onRideAgain = onRideAgain;
        this.el = {};
        this.state = {
            speed: -1,
            gauge: -1,
            speed01: -1,
            maxSpeed: -1,
            air: -1,
            tricks: -1,
            combo: -1,
            scoreTarget: 0,
            scoreShown: 0,
            flags: '',
            trickKey: '',
            trickProgress: -1,
            ragdoll: false,
        };
        this.lastStart = null;
        this.lastTrickAt = 0;
        this._legendTimer = 0;
        this._raf = 0;
        this._lastFrame = 0;
        this._summaryOpen = false;
        this._tickScore = this._tickScore.bind(this);
    }

    init() {
        const $ = (id) => document.getElementById(id);
        this.root = $('skier-hud');
        this.el = {
            speed: $('speed-value'),
            speedBox: this.root?.querySelector('.speed-display'),
            gaugeFill: this.root?.querySelector('.gauge-fill'),
            score: $('score-value'),
            scoreBox: this.root?.querySelector('.score-value'),
            combo: $('combo-value'),
            comboBox: this.root?.querySelector('.combo-display'),
            maxSpeed: $('max-speed-value'),
            air: $('air-time-value'),
            tricks: $('tricks-value'),
            trickLive: $('trick-live'),
            trickLabel: this.root?.querySelector('.trick-live-label'),
            ringFill: this.root?.querySelector('.ring-fill'),
            callouts: $('callouts'),
            prompt: $('ski-prompt'),
            legend: $('ski-legend'),
            vignette: $('crash-vignette'),
            summary: $('run-summary'),
        };
        if (!this.root) return;

        events.on('ski:start', (p) => this.onStart(p));
        events.on('ski:tick', (p) => this.onTick(p));
        events.on('ski:trick', (p) => this.onTrick(p));
        events.on('ski:land', (p) => this.onLand(p));
        events.on('ski:crash', (p) => this.onCrash(p));
        events.on('ski:recover', () => this.hidePrompt());
        events.on('ski:reset', () => { this.hidePrompt(); this.clearTrickLive(); });
        events.on('ski:tree-knock', () => this.callout('Timber!', null, 'air'));
        events.on('ski:end', (p) => this.onEnd(p));

        const sum = this.el.summary;
        if (sum) {
            document.getElementById('run-close')?.addEventListener('click', () => this.hideSummary());
            document.getElementById('run-again')?.addEventListener('click', () => {
                this.hideSummary();
                this.onRideAgain?.(this.lastStart);
            });
            sum.querySelector('.run-timer span')?.addEventListener('animationend', () => this.hideSummary());
        }
    }

    /* -------------------------------- lifecycle -------------------------------- */

    onSkiStart() {
        this.hideSummary(true);
        this.showLegend();
    }

    onSkiStop() {
        this.hidePrompt();
        this.clearTrickLive();
        clearTimeout(this._legendTimer);
    }

    onStart(p) {
        if (p && typeof p.x === 'number') this.lastStart = { x: p.x, z: p.z };
        const s = this.state;
        s.scoreTarget = 0;
        s.scoreShown = 0;
        s.combo = -1;
        s.trickKey = '';
        if (this.el.score) this.el.score.textContent = '0';
        this.el.comboBox?.classList.add('hidden');
        if (this.el.callouts) this.el.callouts.innerHTML = '';
        this.hidePrompt();
        this.hideSummary(true);
        this.showLegend();
    }

    showLegend() {
        const lg = this.el.legend;
        if (!lg) return;
        lg.classList.remove('faded');
        clearTimeout(this._legendTimer);
        this._legendTimer = setTimeout(() => lg.classList.add('faded'), 6000);
    }

    /* ---------------------------------- tick ---------------------------------- */

    onTick(t) {
        if (!t) return;
        const s = this.state;
        const el = this.el;

        const mph = Math.max(0, Math.round(t.speedMph ?? Math.abs(t.speed || 0) * 1.35));
        if (mph !== s.speed) {
            s.speed = mph;
            if (el.speed) el.speed.textContent = String(mph);
        }

        let s01 = t.speed01;
        if (typeof s01 !== 'number') s01 = Math.min(1, Math.abs(t.speed || 0) / 60);
        if (Math.abs(s01 - s.speed01) > 0.004) {
            s.speed01 = s01;
            if (el.gaugeFill) el.gaugeFill.style.strokeDashoffset = String(GAUGE_LEN * (1 - s01));
            el.speedBox?.style.setProperty('--speed01', s01.toFixed(3));
        }

        const flags = `${t.tucking ? 't' : ''}${t.braking ? 'b' : ''}${t.switch ? 's' : ''}${s01 > 0.78 ? 'f' : ''}`;
        if (flags !== s.flags) {
            s.flags = flags;
            const box = el.speedBox;
            if (box) {
                box.classList.toggle('tuck', !!t.tucking);
                box.classList.toggle('brake', !!t.braking);
                box.classList.toggle('switch', !!t.switch);
                box.classList.toggle('fast', s01 > 0.78);
            }
        }

        if (typeof t.maxSpeedMph === 'number') {
            const m = Math.round(t.maxSpeedMph);
            if (m !== s.maxSpeed) { s.maxSpeed = m; if (el.maxSpeed) el.maxSpeed.textContent = String(m); }
        }
        if (typeof t.totalAirTime === 'number') {
            const a = Math.round(t.totalAirTime * 10);
            if (a !== s.air) { s.air = a; if (el.air) el.air.textContent = (a / 10).toFixed(1); }
        }
        if (typeof t.tricksLanded === 'number' && t.tricksLanded !== s.tricks) {
            s.tricks = t.tricksLanded;
            if (el.tricks) el.tricks.textContent = String(t.tricksLanded);
        }

        // Score (animated count-up)
        if (typeof t.score === 'number' && t.score !== s.scoreTarget) {
            s.scoreTarget = t.score;
            if (s.scoreTarget < s.scoreShown) {
                s.scoreShown = s.scoreTarget;
                if (el.score) el.score.textContent = fmt(s.scoreShown);
            } else if (!this._raf) {
                this._lastFrame = performance.now();
                this._raf = requestAnimationFrame(this._tickScore);
            }
        }

        // Combo pill
        if (typeof t.combo === 'number') {
            const c = Math.round(t.combo * 10) / 10;
            if (c !== s.combo) {
                const prev = s.combo;
                s.combo = c;
                if (el.comboBox) {
                    if (c > 1) {
                        el.comboBox.classList.remove('hidden');
                        if (el.combo) el.combo.textContent = `${c.toFixed(1)}x`;
                        if (prev > 0 && c > prev) this._pop(el.comboBox, 'pop');
                    } else {
                        el.comboBox.classList.add('hidden');
                    }
                }
            }
        }

        // Live trick / hint
        const tr = t.trick;
        if (tr && tr.active && tr.label) {
            const key = `T:${tr.label}`;
            if (key !== s.trickKey) {
                s.trickKey = key;
                el.trickLive?.classList.remove('hint-only');
                el.trickLive?.classList.add('show');
                if (el.trickLabel) el.trickLabel.textContent = tr.label;
            }
            const pr = Math.max(0, Math.min(1, tr.progress01 ?? 0));
            if (Math.abs(pr - s.trickProgress) > 0.01) {
                s.trickProgress = pr;
                if (el.ringFill) el.ringFill.style.strokeDashoffset = String(RING_LEN * (1 - pr));
            }
        } else if (t.hint && !t.ragdoll) {
            const key = `H:${t.hint}`;
            if (key !== s.trickKey) {
                s.trickKey = key;
                el.trickLive?.classList.add('hint-only', 'show');
                if (el.trickLabel) el.trickLabel.textContent = t.hint;
            }
        } else if (s.trickKey) {
            this.clearTrickLive();
        }

        // Ragdoll prompt safety (if crash/recover events are missed)
        if (!!t.ragdoll !== s.ragdoll) {
            s.ragdoll = !!t.ragdoll;
            if (s.ragdoll) this.showPrompt();
            else this.hidePrompt();
        }
    }

    _tickScore(now) {
        const s = this.state;
        const dt = Math.min(0.1, (now - this._lastFrame) / 1000);
        this._lastFrame = now;
        const diff = s.scoreTarget - s.scoreShown;
        if (diff <= 0.5) {
            s.scoreShown = s.scoreTarget;
            this._raf = 0;
        } else {
            s.scoreShown += Math.max(1, diff * (1 - Math.exp(-10 * dt)));
            if (s.scoreShown > s.scoreTarget) s.scoreShown = s.scoreTarget;
            this._raf = requestAnimationFrame(this._tickScore);
        }
        if (this.el.score) this.el.score.textContent = fmt(s.scoreShown);
    }

    clearTrickLive() {
        this.state.trickKey = '';
        this.state.trickProgress = -1;
        this.el.trickLive?.classList.remove('show');
    }

    /* --------------------------------- moments --------------------------------- */

    onTrick(p) {
        if (!p) return;
        this.lastTrickAt = performance.now();
        const pts = p.points || 0;
        const tier = pts >= 1000 ? 'big' : pts >= 500 ? 'mid' : '';
        const combo = typeof p.combo === 'number' && p.combo > 1 ? p.combo : null;
        this.callout(p.name || 'Trick', `+${fmt(pts)}`, tier, combo);
        this._pop(this.el.scoreBox, 'bump');
        this.clearTrickLive();
    }

    onLand(p) {
        const air = p?.airTime || 0;
        if (air < 1.4) return;
        const landAt = performance.now();
        setTimeout(() => {
            if (this.lastTrickAt > landAt - 200) return;
            if (this.state.ragdoll) return;
            this.callout(air >= 2.5 ? 'Huge air' : 'Big air', `${air.toFixed(1)}s`, 'air');
        }, 140);
    }

    onCrash(p) {
        const v = this.el.vignette;
        let reduced = false;
        try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* noop */ }
        if (v && !reduced) this._pop(v, 'pulse');
        this.callout('Wipeout', p?.name ? `${p.name} bailed` : null, 'fail');
        this.clearTrickLive();
        this.showPrompt();
    }

    callout(name, pts, tier = '', combo = null) {
        const host = this.el.callouts;
        if (!host) return;
        const c = document.createElement('div');
        c.className = `callout${tier ? ` ${tier}` : ''}`;
        const n = document.createElement('div');
        n.className = 'callout-name';
        n.textContent = name;
        c.appendChild(n);
        if (pts) {
            const pe = document.createElement('div');
            pe.className = 'callout-pts';
            pe.textContent = pts;
            if (combo) {
                const x = document.createElement('span');
                x.className = 'x';
                x.textContent = `\u00d7${combo.toFixed(1)}`;
                pe.appendChild(x);
            }
            c.appendChild(pe);
        }
        host.appendChild(c);
        while (host.children.length > 3) host.firstElementChild.remove();
        c.addEventListener('animationend', () => c.remove(), { once: true });
        setTimeout(() => c.remove(), 2200);
    }

    showPrompt(html = '<kbd>Space</kbd> Get back up') {
        const pr = this.el.prompt;
        if (!pr) return;
        if (pr.classList.contains('hidden')) {
            pr.innerHTML = html;
            pr.classList.remove('hidden');
        }
    }

    hidePrompt() {
        this.state.ragdoll = false;
        this.el.prompt?.classList.add('hidden');
    }

    /* --------------------------------- summary --------------------------------- */

    onEnd(p) {
        this.onSkiStop();
        const sum = this.el.summary;
        if (!sum || !p) return;
        const st = p.stats || {};
        const score = p.score || 0;
        const secs = st.runSeconds ?? 99;
        if (score <= 0 && secs < 3 && !(st.tricksLanded > 0)) return; // trivial run, skip the card

        const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        set('run-score', fmt(score));
        set('run-maxspeed', String(Math.round(st.maxSpeedMph || 0)));
        set('run-air', (st.totalAirTime || 0).toFixed(1));
        set('run-tricks', String(st.tricksLanded || 0));
        set('run-combo', `${(st.bestCombo || 1).toFixed(1)}x`);
        const title = document.getElementById('run-title');
        if (title) {
            title.textContent = score >= 5000 ? 'Legendary run' : score >= 2000 ? 'Great run' : score > 0 ? 'Nice run' : 'Run complete';
        }
        sum.classList.remove('hidden', 'out');
        const bar = sum.querySelector('.run-timer span');
        if (bar) this._pop(bar, null);
        this._summaryOpen = true;
    }

    hideSummary(instant = false) {
        const sum = this.el.summary;
        if (!sum || sum.classList.contains('hidden')) return;
        this._summaryOpen = false;
        if (instant) {
            sum.classList.add('hidden');
            return;
        }
        sum.classList.add('out');
        setTimeout(() => {
            if (!this._summaryOpen) sum.classList.add('hidden');
            sum.classList.remove('out');
        }, 260);
    }

    _pop(el, cls) {
        if (!el) return;
        if (cls) el.classList.remove(cls);
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = '';
        if (cls) el.classList.add(cls);
    }
}
