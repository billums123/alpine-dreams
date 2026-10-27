/*!
 * overworld-sdk.js: contract v1 client for games that live in the Overworld.
 *
 * Drop it in with a plain script tag, before your game code:
 *   <script src="overworld-sdk.js"></script>
 *
 * It does nothing when the game runs on its own. Inside the Overworld it
 * answers the handshake automatically on page load. Add
 * data-manual-ready to the tag and call Overworld.ready() yourself if you
 * want the Overworld's loading veil to stay up until your assets are in.
 *
 * Everything else is optional:
 *   Overworld.exit({ score: 120, won: true, summary: "Escaped the loop" })
 *   Overworld.save({ level: 3 });  const data = await Overworld.load();
 *   Overworld.achievement("first-blood", { title: "First candy" })
 *   Overworld.progress(0.5)
 *   Overworld.on("pause" | "resume" | "mute" | "request-exit", fn)
 */
(function () {
  "use strict";
  var CONTRACT = 1;
  var SDK_VERSION = "1.0.0";
  var TAG = "__ow";
  var MAX_SAVE_BYTES = 64 * 1024;

  var script = typeof document !== "undefined" ? document.currentScript : null;
  var manualReady = !!(script && script.hasAttribute("data-manual-ready"));
  var inOverworld = typeof window !== "undefined" && window.parent && window.parent !== window;

  var parentOrigin = "*"; // pinned to the host's origin once it welcomes us
  var welcomed = false;
  var welcome = null;
  var readySent = false;
  var retry = null;
  var listeners = {};
  var welcomeWaiters = [];

  function post(type, payload) {
    if (!inOverworld) return;
    var msg = { type: type };
    msg[TAG] = CONTRACT;
    if (payload) for (var k in payload) msg[k] = payload[k];
    try { window.parent.postMessage(msg, parentOrigin); } catch (e) { /* host gone */ }
  }

  function emit(name, data) {
    (listeners[name] || []).slice().forEach(function (fn) {
      try { fn(data); } catch (e) { console.error("[overworld-sdk] listener for " + name + " threw", e); }
    });
  }

  function onMessage(ev) {
    if (ev.source !== window.parent) return;
    var m = ev.data;
    if (!m || m[TAG] !== CONTRACT || typeof m.type !== "string") return;
    switch (m.type) {
      case "welcome":
        if (welcomed) return;
        welcomed = true;
        welcome = m;
        parentOrigin = ev.origin || "*";
        clearInterval(retry);
        welcomeWaiters.splice(0).forEach(function (fn) { fn(m); });
        emit("welcome", m);
        if (m.muted) emit("mute", { muted: true });
        break;
      case "pause": emit("pause"); break;
      case "resume": emit("resume"); break;
      case "mute": emit("mute", { muted: !!m.muted }); break;
      case "request-exit":
        // If nobody handles it, leave straight away.
        if ((listeners["request-exit"] || []).length) emit("request-exit");
        else api.exit();
        break;
    }
  }

  function waitWelcome() {
    if (!inOverworld) return Promise.resolve(null);
    if (welcomed) return Promise.resolve(welcome);
    return new Promise(function (res) { welcomeWaiters.push(res); });
  }

  var api = {
    contract: CONTRACT,
    version: SDK_VERSION,
    /** True when running inside the Overworld. */
    inOverworld: inOverworld,

    /** Tell the Overworld the game is ready to play. Called automatically unless data-manual-ready. */
    ready: function () {
      if (!inOverworld || readySent) return;
      readySent = true;
      var send = function () {
        post("ready", { sdk: SDK_VERSION, contract: CONTRACT, title: document.title });
      };
      send();
      // Resend until welcomed in case the host attached its listener late.
      var tries = 0;
      retry = setInterval(function () {
        if (welcomed || ++tries > 20) return clearInterval(retry);
        send();
      }, 750);
    },

    /** Optional loading progress 0..1 for the host's veil (before ready). */
    progress: function (value) {
      if (!readySent) post("loading", { sdk: SDK_VERSION, contract: CONTRACT });
      post("progress", { value: Math.max(0, Math.min(1, Number(value) || 0)) });
    },

    /** Leave the game and return to the Overworld, optionally with a result card. */
    exit: function (result) {
      if (!inOverworld) return;
      var r;
      if (result && typeof result === "object") {
        r = {};
        if (typeof result.score === "number") r.score = result.score;
        if (typeof result.won === "boolean") r.won = result.won;
        if (typeof result.summary === "string") r.summary = result.summary.slice(0, 120);
      }
      post("exit", r ? { result: r } : null);
    },

    /** Persist up to 64 KB of JSON for this world, kept by the Overworld per player. */
    save: function (data) {
      var json = JSON.stringify(data === undefined ? null : data);
      if (json.length > MAX_SAVE_BYTES) throw new Error("[overworld-sdk] save data exceeds 64 KB");
      if (welcome) welcome.save = JSON.parse(json);
      post("save", { data: JSON.parse(json) });
    },

    /** Resolve with what this world last saved (null if nothing, or when standalone). */
    load: function () {
      return waitWelcome().then(function (w) { return w ? (w.save === undefined ? null : w.save) : null; });
    },

    /** Resolve with { name, color } of the player (null when standalone). */
    player: function () {
      return waitWelcome().then(function (w) { return w ? w.player : null; });
    },

    /** Award an achievement. It is stamped into the player's passport. */
    achievement: function (id, info) {
      if (typeof id !== "string" || !/^[\w-]{1,40}$/.test(id)) throw new Error("[overworld-sdk] achievement id must be 1-40 word chars");
      info = info || {};
      post("achievement", { id: id, title: String(info.title || id).slice(0, 60), description: info.description ? String(info.description).slice(0, 120) : undefined });
    },

    /** Free-form analytics-ish event. The host may log or ignore it. */
    event: function (name, data) {
      post("event", { name: String(name).slice(0, 40), data: data === undefined ? null : data });
    },

    on: function (name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
      return function () { api.off(name, fn); };
    },
    off: function (name, fn) {
      var l = listeners[name] || [];
      var i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
  };

  if (inOverworld) {
    window.addEventListener("message", onMessage);

    // Holding Escape for ~0.8 s always leaves. The host's on-screen Leave button
    // covers touch devices; this covers keyboard players whose focus is inside the iframe.
    var escTimer = null;
    window.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || e.repeat || escTimer) return;
      escTimer = setTimeout(function () { api.exit(); }, 800);
    }, true);
    window.addEventListener("keyup", function (e) {
      if (e.key === "Escape") { clearTimeout(escTimer); escTimer = null; }
    }, true);

    // Tell the host we're alive and loading, so heavy games get more time to become ready.
    var sayLoading = function () { if (!readySent) post("loading", { sdk: SDK_VERSION, contract: CONTRACT }); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sayLoading);
    else sayLoading();

    if (!manualReady) {
      if (document.readyState === "complete") api.ready();
      else window.addEventListener("load", function () { api.ready(); });
    }
  }

  window.Overworld = api;
})();
