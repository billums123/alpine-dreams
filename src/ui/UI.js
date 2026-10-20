/**
 * UI - editor chrome, title screen, toasts, popovers and the event-driven ski HUD.
 *
 * Public API (contract, see DESIGN_BRIEF §3.2 / §3.4):
 *   new UI(objectPlacer, snow, sceneManager, mountain, skier, trees, cameraControls)
 *   init()
 *   showNotification(msg, duration?)
 *   setAudioState({ musicMuted, sfxMuted, trackName })
 *   dismissTitle()
 *   get isTitleOpen
 */

import * as THREE from 'three';
import { events } from '../core/events.js';
import * as Quality from '../core/quality.js';
import { SkiHud } from './Hud.js';

const OBJECT_KEYS = {
    '1': 'ski-lift',
    '2': 'gondola',
    '3': 'lodge',
    '4': 'pine-tree',
    '5': 'flag',
    '6': 'snowman',
    '7': 'skier',
    '8': 'jump',
};
const SCULPT_KEYS = { q: 'raise', w: 'lower', e: 'smooth' };

const OBJECT_INFO = {
    'ski-lift': { name: 'Chairlift', icon: 'i-chairlift' },
    'gondola': { name: 'Gondola', icon: 'i-gondola' },
    'lodge': { name: 'Lodge', icon: 'i-lodge' },
    'pine-tree': { name: 'Pine tree', icon: 'i-pine' },
    'flag': { name: 'Slalom flag', icon: 'i-flag' },
    'snowman': { name: 'Snowman', icon: 'i-snowman' },
    'jump': { name: 'Kicker jump', icon: 'i-jump' },
    'skier': { name: 'Skier', icon: 'i-skier' },
};
const SCULPT_INFO = {
    raise: { name: 'Raise terrain', icon: 'i-raise' },
    lower: { name: 'Lower terrain', icon: 'i-lower' },
    smooth: { name: 'Smooth terrain', icon: 'i-smooth' },
};

const HINTS = {
    idle: [[['Drag'], 'Orbit'], [['Right drag'], 'Pan'], [['Scroll'], 'Zoom'], [['1-8'], 'Build', 'opt'], [['Q', 'W', 'E'], 'Sculpt', 'opt'], [['N'], 'Night', 'opt'], [['?'], 'Shortcuts']],
    place: [[['Click'], 'Place'], [['\u2190', '\u2192'], 'Rotate'], [['\u2191', '\u2193'], 'Tilt', 'opt'], [['T'], 'Reset', 'opt'], [['Esc'], 'Cancel']],
    lift: [[['Click'], 'Bottom station, then top station'], [['\u2190', '\u2192'], 'Rotate', 'opt'], [['Esc'], 'Cancel']],
    select: [[['\u2190', '\u2192'], 'Rotate'], [['\u2191', '\u2193'], 'Tilt', 'opt'], [['T'], 'Reset'], [['Del'], 'Remove'], [['Esc'], 'Deselect']],
    sculpt: [[['Drag'], 'Sculpt'], [['Right drag'], 'Orbit'], [['[', ']'], 'Brush size'], [['Esc'], 'Done']],
    ride: [[['Click'], 'Drop in on any slope'], [['Esc'], 'Cancel']],
};

const prefersReducedMotion = () => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
};

export class UI {
    constructor(objectPlacer, snow, sceneManager, mountain, skier, trees, cameraControls) {
        this.objectPlacer = objectPlacer;
        this.snow = snow;
        this.sceneManager = sceneManager;
        this.mountain = mountain;
        this.skier = skier;
        this.trees = trees;
        this.cameraControls = cameraControls;

        // DOM elements
        this.modeIndicator = null;
        this.modeText = null;
        this.paletteItems = [];
        this.sculptItems = [];
        this.activeItem = null;

        // Sculpting state
        this.sculptMode = null;
        this.isSculpting = false;
        this.ctrlPressed = false;

        // Raycaster for terrain sculpting / skier drop
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this._pendingPointer = null;
        this._pointerRaf = 0;
        this._brushPoint = new THREE.Vector3();

        // State
        this._titleOpen = true;
        this._hintKey = null;
        this._skierClickHandler = null;
        this._isSkiing = false;
        this._audio = { musicMuted: false, sfxMuted: false, trackName: '' };
        this._lastHoverEmit = 0;
        this._liftLength = null;
        this._modeKind = null;

        // Bind methods
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onMouseLeave = this.onMouseLeave.bind(this);
        this.onKeyDownGlobal = this.onKeyDownGlobal.bind(this);
        this.onKeyUpGlobal = this.onKeyUpGlobal.bind(this);
        this._processPointer = this._processPointer.bind(this);
    }

    get isTitleOpen() {
        return this._titleOpen;
    }

    init() {
        const $ = (id) => document.getElementById(id);

        this.modeIndicator = $('mode-indicator');
        this.modeText = this.modeIndicator.querySelector('.mode-text');
        this.modeSub = this.modeIndicator.querySelector('.mode-sub');
        this.modeIconUse = this.modeIndicator.querySelector('.mode-icon use');
        this.modeBrush = this.modeIndicator.querySelector('.mode-brush');
        this.brushInput = $('brush-size');
        this.hintEl = $('controls-hint');
        this.toastRegion = $('toast-region');
        this.tooltip = $('tooltip');
        this.titleScreen = $('title-screen');
        this.sheet = $('shortcuts-sheet');
        this.settingsPop = $('settings-popover');
        this.confirmPop = $('confirm-popover');

        // Ski HUD (event driven)
        this.hud = new SkiHud({
            onRideAgain: (pos) => this._rideAgain(pos),
        });
        this.hud.init();

        // Palette
        this.paletteItems = document.querySelectorAll('.palette-item[data-object]');
        this.setupPaletteEvents();
        this.sculptItems = document.querySelectorAll('.palette-item[data-sculpt]');
        this.setupSculptEvents();

        this.setupQuickActions();
        this.setupEnvironmentToggles();
        this.setupAudioButtons();
        this.setupPopovers();
        this.setupTooltips();
        this.setupUiEventEmitters();
        this.setupTitleScreen();
        this.setupBrushSlider();
        this.setupKeyboardShortcuts();
        this.subscribeEvents();

        $('cancel-placement').addEventListener('click', () => {
            this.cancelPlacement();
            this.cancelSculptMode();
            this.objectPlacer.clearSelection?.();
            this.hideModeIndicator();
            this.updateHint();
        });

        // Sculpting / brush pointer events
        const canvas = this.sceneManager.renderer.domElement;
        canvas.addEventListener('mousemove', this.onMouseMove);
        canvas.addEventListener('mousedown', this.onMouseDown);
        window.addEventListener('mouseup', this.onMouseUp);
        canvas.addEventListener('mouseleave', this.onMouseLeave);

        window.addEventListener('keydown', this.onKeyDownGlobal);
        window.addEventListener('keyup', this.onKeyUpGlobal);

        // Undo row only if the placer supports it
        if (typeof this.objectPlacer.undo !== 'function' && typeof this.objectPlacer.undoLast !== 'function') {
            const dts = this.sheet?.querySelectorAll('dt') || [];
            dts.forEach((dt) => {
                if (dt.textContent.includes('Z')) { dt.nextElementSibling?.remove(); dt.remove(); }
            });
        }

        this.buildGaugeTicks();
        this.updateHint();
        this.syncQuality(Quality.getQuality?.());

        // Light-weight state poll: keeps toggles / skiing state correct even if an
        // emitter is missing (keys handled in main.js, legacy Skier, etc).
        this._syncTimer = setInterval(() => this.syncState(), 250);
    }

    /* ================================================================== */
    /* Keyboard                                                            */
    /* ================================================================== */

    onKeyDownGlobal(e) {
        if (e.key === 'Control') this.ctrlPressed = true;
    }

    onKeyUpGlobal(e) {
        if (e.key === 'Control') this.ctrlPressed = false;
    }

    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            const tag = e.target && e.target.tagName;
            if (tag === 'INPUT' && e.target.type !== 'range') return;
            if (tag === 'TEXTAREA' || e.target?.isContentEditable) return;

            // Title screen: only Enter / Escape
            if (this._titleOpen) {
                if (e.key === 'Enter' || e.key === 'Escape') {
                    e.preventDefault();
                    this.dismissTitle();
                }
                return;
            }

            // Shortcuts sheet: Esc or ? closes
            if (!this.sheet.classList.contains('hidden')) {
                if (e.key === 'Escape' || e.key === '?') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    this.toggleSheet(false);
                }
                return;
            }

            // Photo mode toggle (works everywhere)
            if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey) {
                this.togglePhotoMode();
                return;
            }
            if (document.body.classList.contains('photo-mode') && e.key === 'Escape') {
                this.togglePhotoMode(false);
                return;
            }

            // While skiing only "?" (bring back the legend)
            if (this.skier && this.skier.isActive) {
                if (e.key === '?') this.hud.showLegend();
                return;
            }

            if (e.key === '?') {
                this.toggleSheet(true);
                return;
            }

            if (e.key === 'Escape') {
                if (this.closePopovers()) return;
                if (e._placerHandled) { this.updateHint(); return; }
                this.cancelPlacement();
                this.cancelSculptMode();
                this.updateHint();
                return;
            }

            if (e.ctrlKey || e.metaKey || e.altKey) return;

            // Brush size
            if (this.sculptMode && (e.key === '[' || e.key === ']')) {
                this.adjustBrush(e.key === ']' ? 1 : -1);
                return;
            }

            const objectType = OBJECT_KEYS[e.key];
            if (objectType) {
                const item = document.querySelector(`.palette-item[data-object="${objectType}"]`);
                if (item) this.activateObjectItem(item, { fromKey: true });
                return;
            }

            const sculptType = SCULPT_KEYS[e.key.toLowerCase()];
            if (sculptType) {
                const item = document.querySelector(`.palette-item[data-sculpt="${sculptType}"]`);
                if (item) this.activateSculptItem(item, { fromKey: true });
            }
        });
    }

    /* ================================================================== */
    /* Palette                                                             */
    /* ================================================================== */

    setupPaletteEvents() {
        this.paletteItems.forEach((item) => {
            item.addEventListener('click', () => this.activateObjectItem(item));
        });
    }

    setupSculptEvents() {
        this.sculptItems.forEach((item) => {
            item.addEventListener('click', () => this.activateSculptItem(item));
        });
    }

    activateObjectItem(item, { fromKey = false } = {}) {
        const objectType = item.dataset.object;
        this.cancelSculptMode();

        if (objectType === 'skier') {
            this.handleSkierSelection(item);
            return;
        }

        if (this.activeItem === item && !fromKey) {
            this.cancelPlacement();
            this.updateHint();
            return;
        }

        this._clearSkierPick();
        this.selectPaletteItem(item);
        const objectName = this.objectPlacer.setPlacementMode(objectType) || OBJECT_INFO[objectType]?.name || objectType;
        const isLift = objectType === 'ski-lift' || objectType === 'gondola';
        this._liftLength = null;
        this.showModeIndicator(`Placing ${objectName}`, {
            icon: OBJECT_INFO[objectType]?.icon,
            sub: isLift ? 'Click to set the bottom station' : 'Click the terrain to place',
            kind: 'place',
        });
        this.updateHint(isLift ? 'lift' : 'place');
    }

    activateSculptItem(item, { fromKey = false } = {}) {
        const sculptType = item.dataset.sculpt;
        this.cancelPlacement();

        if (this.activeItem === item && !fromKey) {
            this.cancelSculptMode();
            this.updateHint();
            return;
        }

        this.selectPaletteItem(item);
        this.sculptMode = sculptType;
        document.body.classList.add('sculpt-mode');
        this.cameraControls?.setSculptMode?.(true);
        this.objectPlacer.brush?.setMode?.(sculptType);

        this.showModeIndicator(SCULPT_INFO[sculptType].name, {
            icon: SCULPT_INFO[sculptType].icon,
            sub: 'Drag to sculpt',
            kind: `sculpt-${sculptType}`,
            brush: true,
        });
        this.updateHint('sculpt');
    }

    handleSkierSelection(item) {
        if (this.activeItem === item) {
            this.cancelPlacement();
            this.updateHint();
            return;
        }

        this.objectPlacer.cancelPlacement();
        this._clearSkierPick();
        this.selectPaletteItem(item);
        document.body.classList.add('ride-pick');
        this.showModeIndicator('Drop in', {
            icon: 'i-skier',
            sub: 'Click a slope to start your run',
            kind: 'ride',
        });
        this.updateHint('ride');

        const canvas = this.sceneManager.renderer.domElement;
        let downX = 0;
        let downY = 0;
        const downHandler = (e) => { downX = e.clientX; downY = e.clientY; };
        const clickHandler = (e) => {
            if (e.target !== canvas) return;
            // Ignore clicks that were really orbit drags
            if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;

            this._setMouseFromEvent(e);
            this.raycaster.setFromCamera(this.mouse, this.sceneManager.camera);
            const intersect = this.mountain.raycast(this.raycaster);
            if (intersect) {
                this._clearSkierPick();
                this.cancelPlacement();
                this.skier.place(intersect.point.x, intersect.point.z);
                this.setSkiing(true);
            }
        };
        canvas.addEventListener('pointerdown', downHandler);
        canvas.addEventListener('click', clickHandler);
        this._skierClickHandler = { click: clickHandler, down: downHandler };
    }

    _clearSkierPick() {
        if (this._skierClickHandler) {
            const canvas = this.sceneManager.renderer.domElement;
            canvas.removeEventListener('click', this._skierClickHandler.click);
            canvas.removeEventListener('pointerdown', this._skierClickHandler.down);
            this._skierClickHandler = null;
        }
        document.body.classList.remove('ride-pick');
    }

    selectPaletteItem(item) {
        if (this.activeItem) {
            this.activeItem.classList.remove('active');
            this.activeItem.setAttribute('aria-pressed', 'false');
        }
        this.activeItem = item;
        if (item) {
            item.classList.add('active');
            item.setAttribute('aria-pressed', 'true');
        }
    }

    showModeIndicator(text, { icon = null, sub = '', kind = 'place', brush = false } = {}) {
        if (!this.modeIndicator || !this.modeText) return;
        this.modeText.textContent = text;
        if (this.modeSub) this.modeSub.innerHTML = sub;
        if (icon && this.modeIconUse) this.modeIconUse.setAttribute('href', `#${icon}`);
        this.modeIndicator.dataset.kind = kind;
        this._modeKind = kind;
        this.modeBrush?.classList.toggle('hidden', !brush);
        if (brush) this.syncBrushSlider();
        const wasHidden = this.modeIndicator.classList.contains('hidden');
        this.modeIndicator.classList.remove('hidden');
        if (wasHidden) {
            this.modeIndicator.classList.remove('shake');
            this._restartAnim(this.modeIndicator, null);
        }
    }

    hideModeIndicator() {
        this.modeIndicator?.classList.add('hidden');
        this._modeKind = null;
    }

    cancelPlacement() {
        this.objectPlacer.cancelPlacement();
        this._clearSkierPick();
        if (this.activeItem && this.activeItem.dataset.object) this.selectPaletteItem(null);
        if (!this.sculptMode) this.hideModeIndicator();
        this._liftLength = null;
        this.cameraControls?.setEnabled?.(true);
    }

    cancelSculptMode() {
        const wasSculpting = !!this.sculptMode;
        if (this.isSculpting) this.onMouseUp();
        this.sculptMode = null;
        this.isSculpting = false;
        document.body.classList.remove('sculpt-mode');
        this.objectPlacer.brush?.setMode?.(null);
        if (this.activeItem && this.activeItem.dataset.sculpt) this.selectPaletteItem(null);
        if (wasSculpting) this.hideModeIndicator();
        this.cameraControls?.setSculptMode?.(false);
    }

    /* ================================================================== */
    /* Sculpting + brush                                                   */
    /* ================================================================== */

    _setMouseFromEvent(e) {
        const rect = this.sceneManager.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    onMouseMove(e) {
        if (!this.sculptMode) return;
        this._pendingPointer = { clientX: e.clientX, clientY: e.clientY };
        if (!this._pointerRaf) this._pointerRaf = requestAnimationFrame(this._processPointer);
    }

    _processPointer() {
        this._pointerRaf = 0;
        const p = this._pendingPointer;
        if (!p || !this.sculptMode) return;
        this._setMouseFromEvent(p);
        this.raycaster.setFromCamera(this.mouse, this.sceneManager.camera);
        const intersect = this.mountain.raycast(this.raycaster);
        if (intersect) {
            if (this.isSculpting) {
                this.mountain.sculpt(intersect.point.x, intersect.point.z, this.sculptMode, 0.5);
            }
            this._brushPoint.copy(intersect.point);
            this.objectPlacer.brush?.update?.(this._brushPoint, this.mountain.sculptRadius, this.isSculpting);
        } else {
            this.objectPlacer.brush?.update?.(null, this.mountain.sculptRadius, false);
        }
    }

    onMouseDown(e) {
        if (!this.sculptMode || e.button !== 0) return;
        if (e.ctrlKey || this.ctrlPressed) return; // ctrl-drag orbits
        if (e.target.closest && e.target.closest('#ui-overlay')) return;

        this.isSculpting = true;
        events.emit('sculpt:stroke', { mode: this.sculptMode, phase: 'start' });
        this.objectPlacer.brush?.pulse?.();

        this._setMouseFromEvent(e);
        this.raycaster.setFromCamera(this.mouse, this.sceneManager.camera);
        const intersect = this.mountain.raycast(this.raycaster);
        if (intersect) {
            this.mountain.sculpt(intersect.point.x, intersect.point.z, this.sculptMode, 1);
            this._brushPoint.copy(intersect.point);
            this.objectPlacer.brush?.update?.(this._brushPoint, this.mountain.sculptRadius, true);
        }
    }

    onMouseUp() {
        if (!this.isSculpting) return;
        this.isSculpting = false;
        this.mountain.finalizeSculpt();
        events.emit('sculpt:stroke', { mode: this.sculptMode, phase: 'end' });
        if (this._pendingPointer) this._processPointer();
    }

    onMouseLeave() {
        if (this.sculptMode) this.objectPlacer.brush?.update?.(null, this.mountain.sculptRadius, false);
    }

    setupBrushSlider() {
        if (!this.brushInput) return;
        this.brushInput.addEventListener('input', () => {
            this.mountain.sculptRadius = Number(this.brushInput.value);
            this.syncBrushSlider();
            if (this._pendingPointer) this._processPointer();
        });
        // Don't let the slider steal keyboard focus from hotkeys after use
        this.brushInput.addEventListener('change', () => this.brushInput.blur());
    }

    adjustBrush(dir) {
        const min = Number(this.brushInput?.min || 40);
        const max = Number(this.brushInput?.max || 400);
        const r = Math.round(this.mountain.sculptRadius || 150);
        const step = r >= 200 ? 25 : 15;
        this.mountain.sculptRadius = Math.max(min, Math.min(max, r + dir * step));
        this.syncBrushSlider();
        this.objectPlacer.brush?.pulse?.();
        if (this._pendingPointer) this._processPointer();
    }

    syncBrushSlider() {
        if (!this.brushInput) return;
        const r = this.mountain.sculptRadius || 150;
        this.brushInput.value = String(Math.round(r));
        const min = Number(this.brushInput.min);
        const max = Number(this.brushInput.max);
        this.brushInput.style.setProperty('--fill', `${((r - min) / (max - min)) * 100}%`);
    }

    /* ================================================================== */
    /* Actions                                                             */
    /* ================================================================== */

    setupQuickActions() {
        const $ = (id) => document.getElementById(id);

        $('btn-clear').addEventListener('click', (e) => {
            e.stopPropagation();
            this.openPopover(this.confirmPop, $('btn-clear'));
            setTimeout(() => $('confirm-cancel')?.focus({ preventScroll: true }), 30);
        });
        $('confirm-cancel').addEventListener('click', () => this.closePopovers());
        $('confirm-ok').addEventListener('click', () => {
            const count = this.objectPlacer.placedObjects?.length || 0;
            this.objectPlacer.clearAll();
            this.cancelPlacement();
            this.closePopovers();
            this.updateHint();
            this.toast(count ? `Cleared ${count} object${count === 1 ? '' : 's'}` : 'Nothing to clear', { kind: 'info' });
        });

        $('btn-random').addEventListener('click', () => {
            this.cancelPlacement();
            this.cancelSculptMode();
            this.objectPlacer.autoGenerate();
            this.updateHint();
            this.toast('Resort generated', { kind: 'success', icon: 'i-sparkle' });
            this._frameResort();
        });

        $('btn-trick-park')?.addEventListener('click', () => {
            this.cancelPlacement();
            this.cancelSculptMode();
            this.objectPlacer.generateTrickPark();
            this.updateHint();
            this.toast('Trick park built. Press 7 to ride it', { kind: 'success', icon: 'i-park' });
        });

        $('btn-screenshot').addEventListener('click', () => this.takeScreenshot());

        $('btn-new-terrain')?.addEventListener('click', () => {
            this.cancelPlacement();
            this.cancelSculptMode();
            this.objectPlacer.clearAll();
            this.trees?.clear?.();
            this.mountain.regenerate();
            this.trees?.populate?.();
            this.updateHint();
            this.toast('Fresh terrain shaped', { kind: 'success', icon: 'i-mountain' });
        });

        $('btn-photo-mode')?.addEventListener('click', () => {
            this.closePopovers();
            this.togglePhotoMode(true);
        });
    }

    takeScreenshot() {
        const flash = document.getElementById('shutter-flash');
        // Capture first so the flash doesn't end up in the image (overlay is DOM, not canvas anyway)
        try {
            this.sceneManager.screenshot();
        } catch (err) {
            console.error('Screenshot failed', err);
            this.toast('Screenshot failed', { kind: 'warn' });
            return;
        }
        if (flash && !prefersReducedMotion()) this._restartAnim(flash, 'go');
        this.toast('Screenshot saved', { kind: 'success', icon: 'i-camera' });
    }

    setupEnvironmentToggles() {
        const $ = (id) => document.getElementById(id);

        $('btn-toggle-snow').addEventListener('click', () => {
            const enabled = this.snow.toggle();
            this.setPressed('btn-toggle-snow', enabled);
            this.toast(enabled ? 'Snowfall on' : 'Snowfall off', { icon: 'i-snowflake' });
        });

        $('btn-toggle-night').addEventListener('click', () => {
            if (events.listenerCount('ui:toggle-night') > 0) {
                events.emit('ui:toggle-night', {});
            } else {
                window.alpineDreams?.toggleNightMode?.();
            }
            // Fallback sync in case no env:night event arrives
            setTimeout(() => this.syncState(), 30);
        });

        $('btn-toggle-blizzard').addEventListener('click', () => {
            if (events.listenerCount('ui:toggle-blizzard') > 0) {
                events.emit('ui:toggle-blizzard', {});
            } else {
                this.snow.toggleBlizzard?.();
            }
            setTimeout(() => this.syncState(), 30);
        });
    }

    setupAudioButtons() {
        const $ = (id) => document.getElementById(id);
        // main.js owns Music. These only emit; the integrator calls Music/Sfx and then setAudioState().
        $('btn-toggle-music')?.addEventListener('click', () => events.emit('ui:toggle-music', {}));
        $('btn-switch-track')?.addEventListener('click', () => events.emit('ui:next-track', {}));
        $('btn-toggle-sfx')?.addEventListener('click', () => events.emit('ui:toggle-sfx', {}));
    }

    /**
     * Sync audio buttons. Any field may be omitted.
     */
    setAudioState({ musicMuted, sfxMuted, trackName } = {}) {
        if (typeof musicMuted === 'boolean') this._audio.musicMuted = musicMuted;
        if (typeof sfxMuted === 'boolean') this._audio.sfxMuted = sfxMuted;
        if (typeof trackName === 'string') this._audio.trackName = trackName;

        const music = document.getElementById('btn-toggle-music');
        if (music) {
            const muted = this._audio.musicMuted;
            this._setIcon(music, muted ? 'i-music-off' : 'i-music');
            music.setAttribute('aria-pressed', String(!muted));
            music.setAttribute('aria-label', muted ? 'Unmute music' : 'Mute music');
            music.dataset.tip = muted ? 'Music off' : 'Music on';
        }
        const sfx = document.getElementById('btn-toggle-sfx');
        if (sfx) {
            const muted = this._audio.sfxMuted;
            this._setIcon(sfx, muted ? 'i-speaker-off' : 'i-speaker');
            sfx.setAttribute('aria-pressed', String(!muted));
            sfx.setAttribute('aria-label', muted ? 'Unmute sound effects' : 'Mute sound effects');
            sfx.dataset.tip = muted ? 'Sound effects off' : 'Sound effects on';
        }
        const track = document.getElementById('btn-switch-track');
        if (track) {
            const name = this._audio.trackName;
            track.dataset.tip = name ? `Next track · Now: ${name}` : 'Next track';
            track.setAttribute('aria-label', name ? `Next track. Now playing ${name}` : 'Next track');
        }
        if (typeof trackName === 'string' && trackName && this._audioToastReady) {
            this.toast(`Now playing: ${trackName}`, { icon: 'i-music', duration: 1800 });
        }
        this._audioToastReady = true;
        this._refreshTooltip();
    }

    _setIcon(btn, id) {
        const use = btn.querySelector('svg use');
        if (use) {
            use.setAttribute('href', `#${id}`);
        } else {
            // Something overwrote the button content (legacy textContent writes); restore the icon
            btn.innerHTML = `<svg><use href="#${id}"/></svg>`;
        }
    }

    setPressed(id, on) {
        const el = document.getElementById(id);
        if (el) el.setAttribute('aria-pressed', String(!!on));
    }

    /* ================================================================== */
    /* Popovers / sheet / photo mode                                       */
    /* ================================================================== */

    setupPopovers() {
        const $ = (id) => document.getElementById(id);
        const settingsBtn = $('btn-settings');
        settingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!this.settingsPop.classList.contains('hidden')) {
                this.closePopovers();
            } else {
                this.openPopover(this.settingsPop, settingsBtn);
            }
        });
        this.settingsPop.querySelectorAll('[data-quality]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const level = btn.dataset.quality;
                if (events.listenerCount('ui:quality') > 0) {
                    events.emit('ui:quality', { level });
                } else if (typeof this.sceneManager.setQuality === 'function') {
                    this.sceneManager.setQuality(level);
                } else {
                    Quality.setQuality?.(level);
                }
                this.syncQuality(level);
            });
        });

        $('btn-help').addEventListener('click', () => this.toggleSheet(true));
        $('sheet-close').addEventListener('click', () => this.toggleSheet(false));
        this.sheet.addEventListener('click', (e) => {
            if (e.target === this.sheet) this.toggleSheet(false);
        });

        // Click outside closes popovers
        document.addEventListener('pointerdown', (e) => {
            if (!e.target.closest) return;
            if (e.target.closest('.popover') || e.target.closest('#btn-settings') || e.target.closest('#btn-clear')) return;
            this.closePopovers();
        });
        window.addEventListener('resize', () => this.closePopovers());
    }

    openPopover(pop, anchor) {
        this.closePopovers();
        pop.classList.remove('hidden');
        const r = anchor.getBoundingClientRect();
        const w = pop.offsetWidth || 280;
        const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w + 6));
        pop.style.left = `${left}px`;
        pop.style.top = `${r.bottom + 10}px`;
        pop.style.transformOrigin = `${r.left + r.width / 2 - left}px top`;
        anchor.setAttribute('aria-expanded', 'true');
        this.hideTooltip();
    }

    /** Swoop the editor camera to a 3/4 view of everything that's placed. */
    _frameResort() {
        const cc = this.cameraControls;
        const list = this.objectPlacer?.placedObjects;
        if (!cc?.frameBox || !list?.length) return;
        const box = new THREE.Box3();
        const p = new THREE.Vector3();
        for (const e of list) {
            if (e.data?.start && e.data?.end) { box.expandByPoint(e.data.start); box.expandByPoint(e.data.end); }
            else if (e.object) box.expandByPoint(e.object.getWorldPosition(p));
        }
        cc.frameBox(box);
    }

    closePopovers() {
        let closed = false;
        [this.settingsPop, this.confirmPop].forEach((p) => {
            if (p && !p.classList.contains('hidden')) {
                p.classList.add('hidden');
                closed = true;
            }
        });
        document.querySelectorAll('[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
        return closed;
    }

    toggleSheet(open) {
        const show = open ?? this.sheet.classList.contains('hidden');
        this.closePopovers();
        this.sheet.classList.toggle('hidden', !show);
        if (show) setTimeout(() => document.getElementById('sheet-close')?.focus({ preventScroll: true }), 30);
    }

    togglePhotoMode(force) {
        const on = force ?? !document.body.classList.contains('photo-mode');
        document.body.classList.toggle('photo-mode', on);
        if (on) this.toast('Photo mode. Press H to show the UI', { icon: 'i-eye-off', duration: 2200 });
    }

    syncQuality(level) {
        if (!this.settingsPop || !level) return;
        this.settingsPop.querySelectorAll('[data-quality]').forEach((b) => {
            b.setAttribute('aria-checked', String(b.dataset.quality === level));
        });
    }

    /* ================================================================== */
    /* Tooltips + ui:* emitters                                            */
    /* ================================================================== */

    setupTooltips() {
        const overlay = document.getElementById('ui-overlay');
        overlay.addEventListener('pointerover', (e) => {
            const el = e.target.closest && e.target.closest('[data-tip]');
            if (!el || el === this._tipTarget) return;
            if (e.pointerType === 'touch') return;
            this.showTooltip(el);
        });
        overlay.addEventListener('pointerout', (e) => {
            const el = e.target.closest && e.target.closest('[data-tip]');
            if (!el) return;
            if (e.relatedTarget && el.contains(e.relatedTarget)) return;
            this.hideTooltip();
        });
        overlay.addEventListener('focusin', (e) => {
            const el = e.target.closest && e.target.closest('[data-tip]');
            if (el && el.matches(':focus-visible')) this.showTooltip(el);
        });
        overlay.addEventListener('focusout', () => this.hideTooltip());
        overlay.addEventListener('pointerdown', () => this.hideTooltip());
    }

    showTooltip(el) {
        this._tipTarget = el;
        clearTimeout(this._tipTimer);
        this._tipTimer = setTimeout(() => {
            if (this._tipTarget !== el) return;
            this._renderTooltip(el);
        }, 280);
    }

    _renderTooltip(el) {
        const tip = this.tooltip;
        if (!tip || !el.isConnected) return;
        tip.textContent = el.dataset.tip;
        if (el.dataset.key) {
            const k = document.createElement('kbd');
            k.textContent = el.dataset.key;
            tip.appendChild(k);
        }
        const r = el.getBoundingClientRect();
        tip.style.transform = '';
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        // Prefer above for bottom chrome, below for top chrome
        const below = r.top < window.innerHeight / 2;
        let x = r.left + r.width / 2 - tw / 2;
        x = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
        const y = below ? r.bottom + 10 : r.top - th - 10;
        tip.style.left = `${Math.round(x)}px`;
        tip.style.top = `${Math.round(y)}px`;
        tip.classList.add('show');
    }

    _refreshTooltip() {
        if (this._tipTarget && this.tooltip?.classList.contains('show')) this._renderTooltip(this._tipTarget);
    }

    hideTooltip() {
        clearTimeout(this._tipTimer);
        this._tipTarget = null;
        this.tooltip?.classList.remove('show');
    }

    setupUiEventEmitters() {
        const idOf = (btn) => btn.id || (btn.dataset.object && `object:${btn.dataset.object}`) ||
            (btn.dataset.sculpt && `sculpt:${btn.dataset.sculpt}`) ||
            (btn.dataset.quality && `quality:${btn.dataset.quality}`) || 'button';

        document.addEventListener('click', (e) => {
            const btn = e.target.closest && e.target.closest('button');
            if (!btn) return;
            events.emit('ui:click', { id: idOf(btn) });
        }, true);

        const dock = document.getElementById('object-palette');
        const hoverables = document.querySelectorAll('#object-palette button, .cluster button, .cta');
        hoverables.forEach((btn) => {
            btn.addEventListener('pointerenter', (e) => {
                if (e.pointerType === 'touch') return;
                const now = performance.now();
                if (now - this._lastHoverEmit < 70) return;
                this._lastHoverEmit = now;
                events.emit('ui:hover', { id: idOf(btn) });
            });
        });
        // Mark dock for the scroll hint on narrow screens
        if (dock) dock.setAttribute('tabindex', '-1');
    }

    /* ================================================================== */
    /* Title screen                                                        */
    /* ================================================================== */

    setupTitleScreen() {
        if (!this.titleScreen) {
            this._titleOpen = false;
            document.body.classList.remove('title-open');
            return;
        }
        document.body.classList.add('title-open');
        this.cameraControls?.setAutoRotate?.(true, 0.08);

        const $ = (id) => document.getElementById(id);
        $('title-start').addEventListener('click', (e) => {
            e.stopPropagation();
            this.dismissTitle();
        });
        $('title-ride').addEventListener('click', (e) => {
            e.stopPropagation();
            this.quickRide();
        });
        $('title-shortcuts').addEventListener('click', (e) => {
            e.stopPropagation();
            this.dismissTitle();
            this.toggleSheet(true);
        });
        this.titleScreen.addEventListener('click', (e) => {
            if (e.target.closest('.title-inner button')) return;
            this.dismissTitle();
        });
    }

    dismissTitle(opts = {}) {
        if (!this._titleOpen) return;
        this._titleOpen = false;
        document.body.classList.remove('title-open');
        this.cameraControls?.setAutoRotate?.(false);
        if (!opts.keepCamera && typeof this.cameraControls?.flyTo === 'function') {
            try { this.cameraControls.reset?.(); } catch (e) { /* camera reset is cosmetic */ }
        }
        const ts = this.titleScreen;
        if (ts) {
            ts.classList.add('closing');
            setTimeout(() => ts.classList.add('gone'), 650);
        }
        this.updateHint();
    }

    quickRide() {
        this.dismissTitle({ keepCamera: true });
        this.cancelPlacement();
        this.cancelSculptMode();
        try {
            this.objectPlacer.generateTrickPark();
            const s = this.objectPlacer.trickParkStart || { x: 0, z: -900 };
            this.skier.place(s.x, s.z);
            this.setSkiing(true);
        } catch (err) {
            console.error('Quick ride failed', err);
        }
    }

    _rideAgain(pos) {
        if (this.skier.isActive) return;
        const x = pos?.x ?? 0;
        const z = pos?.z ?? -900;
        this.skier.place(x, z);
        this.setSkiing(true);
    }

    /* ================================================================== */
    /* Event subscriptions                                                 */
    /* ================================================================== */

    subscribeEvents() {
        events.on('ui:toast', (p) => {
            if (!p) return;
            this.toast(p.text, { kind: p.kind, duration: p.duration });
        });

        events.on('env:night', (p) => {
            const night = !!p?.night;
            this.setPressed('btn-toggle-night', night);
            this._setIcon(document.getElementById('btn-toggle-night'), 'i-moon');
            this._lastNight = night;
        });
        events.on('env:blizzard', (p) => {
            this.setPressed('btn-toggle-blizzard', !!p?.on);
            this._lastBlizzard = !!p?.on;
        });
        events.on('quality:change', (p) => {
            if (p?.level) this.syncQuality(p.level);
        });

        events.on('ski:start', () => this.setSkiing(true));
        events.on('ski:end', () => this.setSkiing(false));

        // Placement feedback
        events.on('place:mode', (p) => {
            if (p && !p.active) {
                if (this.activeItem && this.activeItem.dataset.object && this.activeItem.dataset.object !== 'skier') {
                    this.selectPaletteItem(null);
                    if (!this.sculptMode) this.hideModeIndicator();
                    this.updateHint();
                }
            }
        });
        events.on('place:lift-start', (p) => {
            const name = p?.type === 'gondola' ? 'gondola' : 'lift';
            this._liftLength = 0;
            this.showModeIndicator(`Placing ${name === 'gondola' ? 'Gondola' : 'Chairlift'}`, {
                icon: name === 'gondola' ? 'i-gondola' : 'i-chairlift',
                sub: 'Now click to set the top station',
                kind: 'place',
            });
        });
        events.on('place:lift-preview', (p) => {
            if (!this.modeSub || !p || typeof p.length !== 'number') return;
            const m = Math.round(p.length);
            if (m === this._liftLength) return;
            this._liftLength = m;
            this.modeSub.innerHTML = `Click to set the top station · <b>${m.toLocaleString()} m</b>`;
        });
        events.on('place:object', (p) => {
            if (p && (p.type === 'ski-lift' || p.type === 'gondola')) {
                this._liftLength = null;
                if (this.modeSub && this._modeKind === 'place') this.modeSub.textContent = 'Click to set the bottom station';
            }
        });
        events.on('place:invalid', (p) => {
            if (!this.modeIndicator.classList.contains('hidden')) {
                this._restartAnim(this.modeIndicator, 'shake');
                clearTimeout(this._shakeTimer);
                this._shakeTimer = setTimeout(() => this.modeIndicator.classList.remove('shake'), 420);
            }
            const now = performance.now();
            if (now - (this._lastInvalidToast || 0) > 1400) {
                this._lastInvalidToast = now;
                this.toast(p?.reason ? `Can't place here: ${p.reason}` : "Can't place here", { kind: 'warn', duration: 1600 });
            }
        });
        events.on('place:select', (p) => {
            if (this.sculptMode || (this.activeItem && this.activeItem.dataset.object)) return;
            if (p && p.type) {
                const info = OBJECT_INFO[p.type] || { name: p.type, icon: 'i-hammer' };
                this.showModeIndicator(`${info.name} selected`, {
                    icon: info.icon,
                    sub: 'Arrows rotate · Del removes',
                    kind: 'select',
                });
                this.updateHint('select');
            } else {
                this.hideModeIndicator();
                this.updateHint();
            }
        });
        events.on('place:undo', (p) => {
            const info = p?.type ? OBJECT_INFO[p.type] : null;
            this.toast(info ? `Undid ${info.name.toLowerCase()}` : 'Undone', { icon: 'i-redo', duration: 1400 });
        });
        events.on('place:remove', (p) => {
            if (p && p.count === 1 && p.type) {
                const info = OBJECT_INFO[p.type];
                this.toast(`${info ? info.name : 'Object'} removed`, { duration: 1400 });
            }
        });
    }

    setSkiing(on) {
        on = !!on;
        if (this._isSkiing === on) return;
        this._isSkiing = on;
        document.body.classList.toggle('is-skiing', on);
        if (on) {
            this.closePopovers();
            this.hideTooltip();
            this.cancelSculptMode();
            this._clearSkierPick();
            if (this.activeItem) this.selectPaletteItem(null);
            this.hideModeIndicator();
            this.hud.onSkiStart();
        } else {
            this.hud.onSkiStop();
            this.updateHint();
        }
    }

    /* ================================================================== */
    /* State sync (cheap 4 Hz poll, also a safety net for missing events)  */
    /* ================================================================== */

    syncState() {
        const app = window.alpineDreams;

        // Skiing
        const active = !!(this.skier && this.skier.isActive);
        if (active !== this._isSkiing) this.setSkiing(active);

        // Night / blizzard / snow
        const env = app?.environment;
        const night = env ? !!env.isNight : !!app?.isNight;
        if (night !== this._lastNight) {
            this._lastNight = night;
            this.setPressed('btn-toggle-night', night);
        }
        const blizzard = env ? !!env.isBlizzard : !!this.snow?.isBlizzard;
        if (blizzard !== this._lastBlizzard) {
            this._lastBlizzard = blizzard;
            this.setPressed('btn-toggle-blizzard', blizzard);
        }
        if (this.snow && typeof this.snow.enabled === 'boolean') {
            this.setPressed('btn-toggle-snow', this.snow.enabled);
        }

        // Placement ended elsewhere (e.g. lift completed, Esc handled by ObjectPlacer)
        if (this.activeItem && this.activeItem.dataset.object && this.activeItem.dataset.object !== 'skier' &&
            this.objectPlacer.mode !== 'place') {
            this.selectPaletteItem(null);
            if (!this.sculptMode) this.hideModeIndicator();
            this.updateHint();
        }

        // Selection without place:select events
        if (!this.activeItem && !this.sculptMode && !this._isSkiing) {
            const sel = this.objectPlacer.selectedObject;
            const selType = sel ? (sel.type || null) : null;
            if (selType !== this._lastSelType) {
                this._lastSelType = selType;
                if (selType) {
                    const info = OBJECT_INFO[selType] || { name: selType, icon: 'i-hammer' };
                    this.showModeIndicator(`${info.name} selected`, { icon: info.icon, sub: 'Arrows rotate · Del removes', kind: 'select' });
                    this.updateHint('select');
                } else if (this._modeKind === 'select') {
                    this.hideModeIndicator();
                    this.updateHint();
                }
            }
        }

        // Audio button safety: legacy main.js writes emoji textContent; restore SVG icons
        ['btn-toggle-music', 'btn-switch-track', 'btn-toggle-sfx'].forEach((id) => {
            const b = document.getElementById(id);
            if (b && !b.querySelector('svg')) {
                if (id === 'btn-toggle-music') {
                    const muted = (b.textContent || '').includes('\u{1F507}');
                    this._audio.musicMuted = muted;
                }
                this.setAudioState({});
                if (id === 'btn-switch-track') this._setIcon(b, 'i-next');
            }
        });
    }

    /* ================================================================== */
    /* Hint bar                                                            */
    /* ================================================================== */

    updateHint(key) {
        if (!this.hintEl) return;
        if (!key) {
            if (this.sculptMode) key = 'sculpt';
            else if (this.objectPlacer.mode === 'place') key = 'place';
            else if (this.objectPlacer.selectedObject) key = 'select';
            else key = 'idle';
        }
        if (key === this._hintKey) return;
        this._hintKey = key;
        const items = HINTS[key] || HINTS.idle;
        this.hintEl.innerHTML = '';
        for (const [keys, label, opt] of items) {
            const span = document.createElement('span');
            span.className = opt ? 'hint opt' : 'hint';
            keys.forEach((k) => {
                const kbd = document.createElement('kbd');
                kbd.textContent = k;
                span.appendChild(kbd);
            });
            span.appendChild(document.createTextNode(label));
            this.hintEl.appendChild(span);
        }
        this._restartAnim(this.hintEl, 'swap');
    }

    buildGaugeTicks() {
        const svg = document.querySelector('#skier-hud .gauge');
        const old = svg?.querySelector('.gauge-ticks');
        if (!svg || !old) return;
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'gauge-tickset');
        const n = 12;
        for (let i = 0; i <= n; i++) {
            const a = (i / n) * Math.PI * 1.5; // 270 degrees, gauge is rotated 135deg via CSS
            const major = i % 3 === 0;
            const r1 = major ? 45 : 47.5;
            const r2 = 51;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', String(70 + Math.cos(a) * r1));
            line.setAttribute('y1', String(70 + Math.sin(a) * r1));
            line.setAttribute('x2', String(70 + Math.cos(a) * r2));
            line.setAttribute('y2', String(70 + Math.sin(a) * r2));
            line.setAttribute('stroke', major ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.2)');
            line.setAttribute('stroke-width', major ? '2' : '1.5');
            g.appendChild(line);
        }
        old.replaceWith(g);
    }

    /* ================================================================== */
    /* Toasts                                                              */
    /* ================================================================== */

    toast(text, { kind = 'info', duration = 2200, icon = null } = {}) {
        if (!this.toastRegion || !text) return;
        // De-duplicate identical consecutive toasts
        const last = this.toastRegion.lastElementChild;
        if (last && last.dataset.text === text && !last.classList.contains('out')) {
            clearTimeout(last._timer);
            last._timer = setTimeout(() => this._dismissToast(last), duration);
            return;
        }
        const el = document.createElement('div');
        el.className = `toast ${kind}`;
        el.dataset.text = text;
        const iconId = icon || (kind === 'success' ? 'i-check' : kind === 'warn' ? 'i-alert' : 'i-info');
        el.innerHTML = `<span class="t-icon"><svg><use href="#${iconId}"/></svg></span><span class="t-text"></span>`;
        el.querySelector('.t-text').textContent = text;
        this.toastRegion.appendChild(el);
        while (this.toastRegion.children.length > 4) this.toastRegion.firstElementChild.remove();
        el._timer = setTimeout(() => this._dismissToast(el), duration);
    }

    _dismissToast(el) {
        if (!el.isConnected) return;
        el.classList.add('out');
        el.addEventListener('animationend', () => el.remove(), { once: true });
        setTimeout(() => el.remove(), 400);
    }

    showNotification(message, duration = 2000) {
        this.toast(message, { duration });
    }

    _restartAnim(el, cls) {
        if (!el) return;
        if (cls) el.classList.remove(cls);
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = '';
        if (cls) el.classList.add(cls);
    }

    // Kept for compatibility
    update() {}
}
