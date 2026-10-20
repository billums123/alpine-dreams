/**
 * quality - global render-quality tier ('low' | 'medium' | 'high').
 *
 * Owned by workstream A (render). Others READ presets; only SceneManager
 * (auto-tune) and the UI settings control call setQuality().
 * Resolution order on load: URL ?quality=low|medium|high > localStorage > device heuristic.
 * Changing quality emits 'quality:change' { level, preset }.
 */

import { events } from './events.js';

export const QUALITY_LEVELS = ['low', 'medium', 'high'];

export const QUALITY_PRESETS = {
    low: {
        pixelRatioCap: 1,
        post: false,            // render straight to screen, no composer
        msaaSamples: 0,
        fxaa: false,
        bloom: false,
        bloomResolutionScale: 0,
        grade: false,
        shadowMapSize: 1024,
        snowCount: 1200,
        treeDensity: 0.6,       // read once by Trees.populate()
        sprayParticles: 120,
        terrainDetail: false,   // skip per-fragment terrain detail/sparkle
    },
    medium: {
        pixelRatioCap: 1.5,
        post: true,
        msaaSamples: 0,
        fxaa: true,
        bloom: true,
        bloomResolutionScale: 0.25,
        grade: true,
        shadowMapSize: 2048,
        snowCount: 2200,
        treeDensity: 1,
        sprayParticles: 200,
        terrainDetail: true,
    },
    high: {
        pixelRatioCap: 2,
        post: true,
        msaaSamples: 4,         // WebGL2 multisampled composer render target
        fxaa: false,
        bloom: true,
        bloomResolutionScale: 0.5,
        grade: true,
        shadowMapSize: 2048,
        snowCount: 3000,
        treeDensity: 1,
        sprayParticles: 300,
        terrainDetail: true,
    },
};

const STORAGE_KEY = 'alpineDreams.quality';

function detectDefault() {
    try {
        const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        const cores = navigator.hardwareConcurrency || 4;
        if (coarse || cores <= 4) return 'medium';
    } catch (e) { /* ignore */ }
    return 'high';
}

function resolveInitial() {
    try {
        const q = new URLSearchParams(window.location.search).get('quality');
        if (QUALITY_LEVELS.includes(q)) return q;
    } catch (e) { /* ignore */ }
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (QUALITY_LEVELS.includes(stored)) return stored;
    } catch (e) { /* ignore */ }
    return detectDefault();
}

let current = resolveInitial();

export function getQuality() {
    return current;
}

export function getPreset(level = current) {
    return QUALITY_PRESETS[level] || QUALITY_PRESETS.high;
}

export function setQuality(level, { persist = true } = {}) {
    if (!QUALITY_LEVELS.includes(level) || level === current) return current;
    current = level;
    if (persist) {
        try { localStorage.setItem(STORAGE_KEY, level); } catch (e) { /* ignore */ }
    }
    events.emit('quality:change', { level, preset: getPreset(level) });
    return current;
}
