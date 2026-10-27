/**
 * Alpine Dreams - Ski Resort Builder
 * Main entry point: constructs every system, wires the event bus and runs the frame loop.
 */

import { events } from './core/events.js';
import { SceneManager } from './scene/SceneManager.js';
import { Lighting } from './scene/Lighting.js';
import { Sky } from './scene/Sky.js';
import { Snow } from './scene/Snow.js';
import { Environment } from './scene/Environment.js';
import { Mountain } from './terrain/Mountain.js';
import { Trees } from './terrain/Trees.js';
import { DistantRanges } from './terrain/DistantRanges.js';
import { ObjectPlacer } from './controls/ObjectPlacer.js';
import { CameraControls } from './controls/CameraControls.js';
import { Skier } from './objects/Skier.js';
import { UI } from './ui/UI.js';
import { TouchControls } from './ui/TouchControls.js';
import { Music } from './audio/Music.js';
import { Sfx } from './audio/Sfx.js';
import { inOverworld, signalReady, exitToOverworld, setBeforeExit, onPauseChange, onHostMute, isPaused, isHostMuted } from './overworld/bridge.js';

if (inOverworld) document.body.classList.add('in-overworld');

const isTyping = (e) => {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

class AlpineDreams {
    constructor() {
        this.sceneManager = null;
        this.lighting = null;
        this.sky = null;
        this.snow = null;
        this.environment = null;
        this.mountain = null;
        this.trees = null;
        this.distantRanges = null;
        this.objectPlacer = null;
        this.cameraControls = null;
        this.skier = null;
        this.ui = null;
        this.music = null;
        this.sfx = null;

        this.isInitialized = false;
        this.isNight = false;
    }

    async init() {
        try {
            this.sceneManager = new SceneManager('canvas');
            await this.sceneManager.init();

            this.lighting = new Lighting(this.sceneManager.scene);
            this.lighting.setup();

            this.sky = new Sky(this.sceneManager.scene);
            this.sky.create();

            this.distantRanges = new DistantRanges(this.sceneManager.scene);
            this.distantRanges.create();

            this.mountain = new Mountain(this.sceneManager.scene);
            this.mountain.generate();

            this.trees = new Trees(this.sceneManager.scene, this.mountain);
            this.trees.populate();

            this.snow = new Snow(this.sceneManager.scene);
            this.snow.create();

            this.cameraControls = new CameraControls(
                this.sceneManager.camera,
                this.sceneManager.renderer.domElement
            );

            this.objectPlacer = new ObjectPlacer(
                this.sceneManager.scene,
                this.sceneManager.camera,
                this.sceneManager.renderer.domElement,
                this.mountain
            );

            this.skier = new Skier(
                this.sceneManager.scene,
                this.mountain,
                this.sceneManager.camera,
                this.cameraControls
            );
            this.skier.trees = this.trees;
            this.skier.objectPlacer = this.objectPlacer;

            // Environment is the single owner of fog / clear colour / exposure / day-night blend.
            this.environment = new Environment({
                sceneManager: this.sceneManager,
                lighting: this.lighting,
                sky: this.sky,
                snow: this.snow,
                distantRanges: this.distantRanges,
                objectPlacer: this.objectPlacer,
            });

            // Audio: Music owns the AudioContext (created on first gesture), Sfx rides on it.
            this.music = new Music();
            this.music.init();
            this.sfx = new Sfx(this.music);
            this.sfx.init();

            this.ui = new UI(this.objectPlacer, this.snow, this.sceneManager, this.mountain, this.skier, this.trees, this.cameraControls);

            this.wireEvents();
            this.ui.init();
            this.touchControls = new TouchControls(this.skier);
            this.syncAudio();
            this.setupOverworld();

            window.addEventListener('keydown', (e) => {
                if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
                if (this.ui?.isTitleOpen) return;
                if (e.code === 'KeyN') this.toggleNightMode();
                else if (e.code === 'KeyM') this.toggleBlizzard();
            });

            this.sceneManager.onUpdate = (delta) => this.update(delta);
            this.sceneManager.start();

            this.isInitialized = true;

            setTimeout(() => {
                document.getElementById('loading-screen')?.classList.add('hidden');
            }, 500);

            // Overworld: playable once the first frame is on screen (no-op standalone).
            requestAnimationFrame(() => requestAnimationFrame(() => signalReady()));
        } catch (error) {
            console.error('Failed to initialize Alpine Dreams:', error);
        }
    }

    wireEvents() {
        events.on('ui:toggle-music', () => { this.music.toggleMute(); this.syncAudio(); });
        events.on('ui:next-track', () => { this.music.toggleTrack(); this.syncAudio(); });
        events.on('ui:toggle-sfx', () => { this.sfx.toggleMute(); this.syncAudio(); });
        events.on('ui:toggle-night', () => this.toggleNightMode());
        events.on('ui:toggle-blizzard', () => this.toggleBlizzard());
        events.on('ui:quality', ({ level } = {}) => { if (level) this.sceneManager.setQuality(level); });
    }

    /**
     * Hestermania Overworld hooks (all no-ops standalone): host pause freezes the
     * sim, render and all audio; host mute is separate from the in-game toggles;
     * the Back button (and the host's request-exit) closes out an active run so
     * it counts, then leaves with the best run as the result card.
     */
    setupOverworld() {
        if (!inOverworld) return;
        let pausedAt = 0;
        const applyPause = (paused) => {
            this.sceneManager.setPaused(paused);
            this.music.setPaused(paused);
            if (paused) {
                pausedAt = performance.now();
                // Drop held keys / touch buttons: their keyup may land while we're frozen.
                if (this.skier?.input) for (const k in this.skier.input) this.skier.input[k] = false;
            } else if (pausedAt) {
                // Run timer and combo window ignore the paused time.
                const gap = performance.now() - pausedAt;
                if (this.skier?.stats?.runStartTime) this.skier.stats.runStartTime += gap;
                if (this.skier?.lastTrickTime) this.skier.lastTrickTime += gap;
                pausedAt = 0;
            }
        };
        onPauseChange(applyPause);
        onHostMute((muted) => this.music.setHostMuted(muted));
        if (isPaused()) applyPause(true);
        if (isHostMuted()) this.music.setHostMuted(true);

        setBeforeExit(() => { if (this.skier?.isActive) this.skier.remove({ instant: true }); });
        const leave = () => exitToOverworld();
        document.getElementById('ow-exit')?.addEventListener('click', leave);
        document.getElementById('title-ow-exit')?.addEventListener('click', leave);
    }

    syncAudio() {
        this.ui?.setAudioState?.({
            musicMuted: !!this.music?.isMuted,
            sfxMuted: !!this.sfx?.isMuted,
            trackName: this.music?.getTrackName?.(),
        });
    }

    toggleNightMode() {
        this.environment.setNight(!this.environment.isNight);
        this.isNight = this.environment.isNight;
    }

    toggleBlizzard() {
        const on = this.snow.toggleBlizzard();
        this.environment.setBlizzard(on);
        this.trees.setWindStrength?.(on ? 2.2 : 1);
        return on;
    }

    update(delta) {
        const camera = this.sceneManager.camera;
        const skiing = !!(this.skier && this.skier.isActive);

        if (skiing) {
            this.skier.update(delta);
        } else {
            this.cameraControls.update(delta);
        }

        this.environment.update(delta);
        // Tight frustum while skiing keeps the skier's own shadow crisp (~0.05 u/texel at 2048).
        this.lighting.setShadowFocus(
            skiing ? this.skier.position : this.cameraControls.controls.target,
            skiing ? 70 : 900
        );

        this.sky.update(delta, camera);
        this.distantRanges.update?.(delta, camera);
        this.mountain.update?.(delta);
        this.trees.update?.(delta);
        this.snow.update(delta, camera);
        this.objectPlacer.update(delta);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new AlpineDreams();
    window.alpineDreams = app;
    window.alpineEvents = events;
    app.init();
});
