/**
 * TouchControls - on-screen ski controls for touch devices (coarse pointer).
 *
 * Left thumb: steer left / right. Right thumb: tuck (W), brake (S), jump (Space).
 * Each button forwards to Skier.onKeyDown/onKeyUp with the matching key code,
 * so tucking / braking in the air flips exactly like the keyboard (fresh press
 * only). Visible only while skiing (body.is-skiing) on coarse pointers.
 */

const BUTTONS = [
    { id: 'left', code: 'KeyA', zone: 'steer', label: 'Steer left', glyph: 'M15 5 L8 12 L15 19' },
    { id: 'right', code: 'KeyD', zone: 'steer', label: 'Steer right', glyph: 'M9 5 L16 12 L9 19' },
    { id: 'brake', code: 'KeyS', zone: 'act', label: 'Brake / back flip', text: 'Brake' },
    { id: 'tuck', code: 'KeyW', zone: 'act', label: 'Tuck / front flip', text: 'Tuck' },
    { id: 'jump', code: 'Space', zone: 'act', label: 'Jump', text: 'Jump', big: true },
];

export class TouchControls {
    constructor(skier) {
        this.skier = skier;
        this.root = null;
        this._down = new Map(); // pointerId -> code
        let coarse = false;
        try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch (e) { /* ignore */ }
        this.enabled = coarse;
        if (!this.enabled) return;
        document.body.classList.add('touch-ui');
        this._build();
    }

    _send(type, code) {
        const k = this.skier;
        if (!k || !k.isActive) return;
        const ev = { code, key: code, repeat: false, target: null, preventDefault() {} };
        if (type === 'down') k.onKeyDown(ev); else k.onKeyUp(ev);
    }

    _build() {
        const root = document.createElement('div');
        root.id = 'touch-ski';
        root.setAttribute('aria-hidden', 'false');
        const steer = document.createElement('div');
        steer.className = 'touch-zone steer';
        const act = document.createElement('div');
        act.className = 'touch-zone act';

        for (const b of BUTTONS) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `touch-btn glass ${b.id}${b.big ? ' big' : ''}`;
            btn.setAttribute('aria-label', b.label);
            btn.innerHTML = b.glyph
                ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${b.glyph}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
                : `<span>${b.text}</span>`;
            btn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
                this._down.set(e.pointerId, b.code);
                btn.classList.add('active');
                this._send('down', b.code);
            });
            const up = (e) => {
                if (!this._down.has(e.pointerId)) return;
                this._down.delete(e.pointerId);
                btn.classList.remove('active');
                // A tap can be shorter than one frame: let the physics step see
                // the jump before it is released.
                if (b.code === 'Space') setTimeout(() => this._send('up', b.code), 120);
                else this._send('up', b.code);
            };
            btn.addEventListener('pointerup', up);
            btn.addEventListener('pointercancel', up);
            btn.addEventListener('lostpointercapture', up);
            btn.addEventListener('contextmenu', (e) => e.preventDefault());
            (b.zone === 'steer' ? steer : act).appendChild(btn);
        }

        const exit = document.createElement('button');
        exit.type = 'button';
        exit.className = 'touch-btn glass exit';
        exit.setAttribute('aria-label', 'Exit run');
        exit.innerHTML = '<span>Exit</span>';
        exit.addEventListener('click', () => this._send('down', 'Escape'));

        root.append(steer, act, exit);
        (document.getElementById('ui-overlay') || document.body).appendChild(root);
        this.root = root;

        // Keyboard legend -> touch wording
        const legend = document.getElementById('ski-legend');
        if (legend) {
            legend.innerHTML = '<span>&#9664; &#9654; Carve / spin</span><span>Tuck: front flip in air</span><span>Brake: back flip in air</span><span>Jump</span>';
        }
    }
}
