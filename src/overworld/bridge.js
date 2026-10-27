/**
 * Overworld bridge (Hestermania Overworld, contract v1).
 *
 * overworld-sdk.js is loaded by a plain <script data-manual-ready> tag in
 * index.html and defines window.Overworld. Outside the Overworld it is a
 * no-op, and so is everything in this file: nothing subscribes, nothing is
 * posted and every export returns early, so Alpine Dreams behaves exactly as
 * before when it is opened on its own.
 *
 * The game never calls the SDK directly. This module listens on the event bus
 * (ski:start / ski:trick / ski:crash / ski:end / place:object) for runs and
 * achievements, and main.js wires pause / mute into SceneManager and Music via
 * onPauseChange() / onHostMute().
 *
 * See OVERWORLD.md for the full list of messages sent and handled.
 */

import { events } from '../core/events.js';

const ow = window.Overworld;

/** True only when running inside the Overworld's iframe. */
export const inOverworld = !!(ow && ow.inOverworld);

// Host state the game reads.
const state = {
    paused: false,
    hostMuted: false,
};

// What we keep across sessions via Overworld.save() (≤ 64 KB, per player).
// Inside the Overworld this remembers the best run and the achievements
// already stamped, so they are not re-sent every visit. Standalone, nothing.
let saveData = { v: 1, best: null, runs: 0, achievements: [] };
let bestThisSession = null;
let manuallyPlaced = 0;
let beforeExit = null;

const pauseListeners = new Set();
const muteListeners = new Set();

export function isPaused() { return state.paused; }
export function isHostMuted() { return state.hostMuted; }

/** fn(paused: boolean) is called when the host pauses or resumes the game. */
export function onPauseChange(fn) { pauseListeners.add(fn); return () => pauseListeners.delete(fn); }
/** fn(muted: boolean) is called when the host's global mute changes. */
export function onHostMute(fn) { muteListeners.add(fn); return () => muteListeners.delete(fn); }

function setPaused(p) {
    if (state.paused === p) return;
    state.paused = p;
    pauseListeners.forEach((fn) => { try { fn(p); } catch (e) { console.error(e); } });
}
function setHostMuted(m) {
    if (state.hostMuted === m) return;
    state.hostMuted = m;
    muteListeners.forEach((fn) => { try { fn(m); } catch (e) { console.error(e); } });
}

const ACHIEVEMENTS = {
    'first-run':    { title: 'Fresh Tracks',   description: 'Finished your first run in Alpine Dreams' },
    'first-trick':  { title: 'Stomped It',     description: 'Landed your first trick' },
    'first-flip':   { title: 'Head Over Skis', description: 'Landed a frontflip or backflip' },
    'spin-720':     { title: 'Seven-Twenty',   description: 'Landed a 720 or bigger' },
    'combo-3x':     { title: 'On Fire',        description: 'Built a 3x trick combo' },
    'score-5000':   { title: 'Pro Model',      description: 'Scored 5,000 points in one run' },
    'yard-sale':    { title: 'Yard Sale',      description: 'Crashed hard enough to lose your skis' },
    'resort-owner': { title: 'Resort Owner',   description: 'Placed 10 things on your mountain' },
};

function persist() {
    if (!inOverworld) return;
    try { ow.save(saveData); } catch (e) { console.warn('[alpine-dreams] save failed', e); }
}

/** Stamp an achievement into the player's Passport (once per player). */
export function award(id) {
    if (!inOverworld || !ACHIEVEMENTS[id]) return;
    if (saveData.achievements.includes(id)) return;
    saveData.achievements.push(id);
    try { ow.achievement(id, ACHIEVEMENTS[id]); } catch (e) { console.warn(e); }
    persist();
}

/**
 * Report a finished run. Updates the session / all-time best, sends a `run`
 * event, stamps achievements and saves.
 * `run` = { score, maxSpeedMph, airTime, tricksLanded, tricksFailed, bestCombo, seconds }
 */
export function reportRun(run) {
    if (!inOverworld) return;
    saveData.runs++;
    if (!bestThisSession || run.score > bestThisSession.score) bestThisSession = run;
    const newBest = !saveData.best || run.score > saveData.best.score;
    if (newBest) saveData.best = { score: run.score, tricks: run.tricksLanded, maxSpeedMph: run.maxSpeedMph };
    try { ow.event('run', { ...run, newBest }); } catch (e) { /* ignore */ }
    award('first-run');
    if (run.score >= 5000) award('score-5000');
    persist();
}

function summaryFor(run) {
    const bits = [`${run.tricksLanded} trick${run.tricksLanded === 1 ? '' : 's'}`];
    if (run.maxSpeedMph > 0) bits.push(`top speed ${run.maxSpeedMph} mph`);
    if (run.airTime >= 1) bits.push(`${run.airTime.toFixed(1)}s air`);
    return `Best run: ${bits.join(' · ')}`;
}

/** Tell the host the mountain is built and the game is playable. */
export function signalReady() {
    if (inOverworld) ow.ready();
}

/** Register a hook that runs just before leaving (main.js uses it to close out an active run). */
export function setBeforeExit(fn) { beforeExit = fn; }

/** Leave Alpine Dreams for the Overworld gate, carrying this session's best run as the result card. */
export function exitToOverworld() {
    if (!inOverworld) return false;
    // Count a run that is still in progress before we go (it emits ski:end -> reportRun).
    if (beforeExit) { try { beforeExit(); } catch (e) { console.error(e); } }
    persist(); // always leave with the latest save in the host's hands
    const run = bestThisSession;
    if (run) ow.exit({ score: run.score, summary: summaryFor(run) });
    else ow.exit();
    return true;
}

if (inOverworld) {
    ow.on('pause', () => setPaused(true));
    ow.on('resume', () => setPaused(false));
    ow.on('mute', (e) => setHostMuted(!!(e && e.muted)));
    // The host is about to tear the iframe down: save, then leave with our card.
    ow.on('request-exit', () => exitToOverworld());
    ow.load().then((data) => {
        if (data && typeof data === 'object' && data.v === 1) {
            saveData = {
                v: 1,
                best: data.best || null,
                // Keep runs counted before the welcome arrived.
                runs: (Number(data.runs) || 0) + saveData.runs,
                // Keep anything stamped before the welcome arrived.
                achievements: [...new Set([...(Array.isArray(data.achievements) ? data.achievements.slice(0, 50) : []), ...saveData.achievements])],
            };
        }
    });

    // Passport stamps, straight off the event bus.
    events.on('ski:trick', (p) => {
        if (!p) return;
        award('first-trick');
        if (p.flips > 0) award('first-flip');
        if (p.spinDegrees >= 720) award('spin-720');
        if (p.combo >= 3) award('combo-3x');
    });
    // ski:crash is the full ragdoll: skis off, body parts everywhere.
    events.on('ski:crash', () => award('yard-sale'));
    // place:object fires only for hand placement (auto-generate and trick park spawn silently).
    events.on('place:object', () => {
        manuallyPlaced++;
        if (manuallyPlaced >= 10) award('resort-owner');
    });

    // A run lasts from dropping the skier to leaving ski mode (Esc, Exit, or leaving
    // the Overworld mid-run). R / reset is part of the same run. Runs shorter than
    // 3 s with no points are ignored.
    events.on('ski:end', (p) => {
        if (!p) return;
        const s = p.stats || {};
        const seconds = Number(s.runSeconds) || 0;
        const score = Math.round(Number(p.score) || 0);
        if (seconds < 3 && score === 0) return;
        reportRun({
            score,
            maxSpeedMph: Math.round(Number(s.maxSpeedMph) || 0),
            airTime: Math.round((Number(s.totalAirTime) || 0) * 10) / 10,
            tricksLanded: s.tricksLanded | 0,
            tricksFailed: s.tricksFailed | 0,
            bestCombo: Number(s.bestCombo) || 1,
            seconds: Math.round(seconds),
        });
    });
}
