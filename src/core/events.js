/**
 * events - tiny synchronous pub/sub bus shared by all modules.
 *
 * API is FROZEN (see DESIGN_BRIEF.md section 3). Event names and payloads
 * are documented in the brief's event catalogue.
 *
 *   import { events } from '../core/events.js';
 *   const off = events.on('ski:land', (p) => { ... });
 *   events.emit('ski:land', { airTime: 1.2, impact: 0.6, clean: true });
 *   off();
 */

const listeners = new Map(); // type -> Set<fn>

export function on(type, fn) {
    let set = listeners.get(type);
    if (!set) {
        set = new Set();
        listeners.set(type, set);
    }
    set.add(fn);
    return () => off(type, fn);
}

export function off(type, fn) {
    const set = listeners.get(type);
    if (set) set.delete(fn);
}

export function once(type, fn) {
    const wrapper = (payload) => {
        off(type, wrapper);
        fn(payload);
    };
    return on(type, wrapper);
}

/**
 * Emit synchronously. A throwing handler is logged and does not stop
 * other handlers or the emitter (a broken HUD must never break physics).
 * Payload objects for high-frequency events (e.g. 'ski:tick') may be
 * reused by the emitter: copy the fields you need, never keep the reference.
 */
export function emit(type, payload) {
    const set = listeners.get(type);
    if (!set || set.size === 0) return;
    for (const fn of Array.from(set)) {
        try {
            fn(payload);
        } catch (err) {
            console.error(`[events] handler for "${type}" threw:`, err);
        }
    }
}

export function listenerCount(type) {
    const set = listeners.get(type);
    return set ? set.size : 0;
}

export const events = { on, off, once, emit, listenerCount };
export default events;
