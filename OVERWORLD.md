# Alpine Dreams in the Hestermania Overworld

Alpine Dreams can run as a world inside the **Hestermania Overworld**, a three.js hub
where players walk, drive or fly between Tanner's games and play each one in a
sandboxed iframe. This file covers what the integration does and how to test it.

The game works exactly as before when you open it on its own. Everything below is
inactive unless the page is running inside the Overworld's iframe.

- Overworld contract: `contract/CONTRACT.md` in the overworld repo (contract v1)
- World id: `alpine-dreams`
- Release status in the Overworld: **beta**

## Files

| File | What it does |
|---|---|
| `overworld-sdk.js` | The Overworld game-side SDK (a copy of `sdk/overworld-sdk.js` from the overworld repo). Loaded by the first `<script>` in `index.html` with `data-manual-ready`. Defines `window.Overworld`, which does nothing standalone. |
| `src/overworld/bridge.js` | The game's only contact with the SDK: ready, pause/resume, mute, saves, achievements, run results and exit. It listens on the event bus (`src/core/events.js`), so game code never calls the SDK. Outside the Overworld it subscribes to nothing and every export returns early. |
| `src/main.js` `setupOverworld()` | Wires the bridge's pause and mute into `SceneManager.setPaused()` and `Music.setPaused()` / `Music.setHostMuted()`, and hooks up the Back to Hestermania buttons. |
| `vendor/three/` | three.js r161 (`three.module.js`) and every addon the game imports: `controls/OrbitControls`, `utils/BufferGeometryUtils`, `postprocessing/` (EffectComposer, RenderPass, ShaderPass, OutputPass, UnrealBloomPass, plus their Pass and MaskPass) and `shaders/` (FXAA, Copy, LuminosityHighPass, Output). They are byte-identical to the jsDelivr files the game used to load, so the world needs no CDN. MIT licence in `vendor/three/LICENSE`. |

## The handshake and every message

All messages are `{ "__ow": 1, "type": "...", ... }` and are handled by `overworld-sdk.js`.

### Sent by Alpine Dreams

| Message | When | Payload |
|---|---|---|
| `loading` | Automatically at `DOMContentLoaded` (SDK). Gives the game up to 45 s to become ready. | `{ sdk, contract }` |
| `ready` | Once every system is built and the first frame has been drawn (`signalReady()` in `src/main.js`, two animation frames after `sceneManager.start()`). The SDK resends it every 750 ms until welcomed. | `{ sdk, contract, title }` |
| `achievement` | The first time a player earns one (see the table below). Earned ids are kept in the save, so each is sent once per player. | `{ id, title, description }` |
| `event` `"run"` | At the end of every run (see "Runs and results"). Informational; the host may log or ignore it. | `{ score, maxSpeedMph, airTime, tricksLanded, tricksFailed, bestCombo, seconds, newBest }` |
| `save` | After each run, after each new achievement, and just before every `exit`. | `{ data: { v: 1, best: { score, tricks, maxSpeedMph } \| null, runs, achievements: [ids] } }` (well under 64 KB) |
| `exit` | When the player presses **Back to Hestermania**, or when the host sends `request-exit`. | `{ result: { score, summary } }` for the best run this session, or no result if the player didn't finish a run. |

### Handled by Alpine Dreams

| Message | What the game does |
|---|---|
| `welcome` | Reads the player's save (`Overworld.load()`): best run, run count, achievements already earned. Anything earned before the welcome arrived is merged in. If the host says `muted: true`, it is treated like a `mute`. |
| `pause` | Freezes the game. `SceneManager` stops simulating and rendering (the rAF loop keeps ticking but does nothing). `Music.setPaused(true)` suspends the one shared AudioContext, which stops the synth tracks and every Sfx loop and one-shot, and pauses the recorded music `<audio>` elements, which play outside the context's clock. Held keys and touch buttons are released. A tap or key press while paused does not wake the audio. |
| `resume` | Picks up where it left off. The paused time is dropped from the frame clock, the run timer and the combo window, so the skier doesn't jump and the run's `seconds` doesn't count the pause. The context resumes and the current recorded track plays again (unless the player muted music). |
| `mute` `{ muted }` | Host-wide mute through `Music.setHostMuted()`: the `masterOut` gain after the limiter goes to 0, so music and sfx both go silent, and come back when unmuted. This is separate from the in-game music and sound-effect toggles: the game is silent if either is muted, and the host's mute never changes or stores the player's own settings. |
| `request-exit` | Closes out an active run (so it counts), saves, then calls `exit()` with the result card, well inside the host's 1.5 s grace period. |

Holding **Esc** for 0.8 s also leaves the Overworld (built into the SDK). A short Esc
press still ends the current ski run, as before.

## Runs and results

A **run** lasts from dropping the skier on the mountain (`ski:start`) to leaving ski mode
(`ski:end`: Esc, the Exit button, or leaving the Overworld mid-run, which removes the
skier first). Restarting from the top (R, or Reset on touch) is part of the same run: the
score keeps counting, as it always has. Runs shorter than 3 seconds with no points are
ignored.

Each run is reported with an `event` and saved. When the player leaves, the exit card
shows the **best run of this visit**: its score, plus a summary such as
`Best run: 4 tricks · top speed 61 mph · 3.2s air`.

## Achievements

All come straight off the event bus in `src/overworld/bridge.js`.

| id | Title | Earned by | Event |
|---|---|---|---|
| `first-run` | Fresh Tracks | Finishing a run | `ski:end` |
| `first-trick` | Stomped It | Landing any trick cleanly | `ski:trick` |
| `first-flip` | Head Over Skis | Landing a frontflip or backflip | `ski:trick` with `flips > 0` |
| `spin-720` | Seven-Twenty | Landing a 720 or bigger | `ski:trick` with `spinDegrees >= 720` |
| `combo-3x` | On Fire | Reaching a 3x combo | `ski:trick` with `combo >= 3` |
| `score-5000` | Pro Model | Scoring 5,000 points in one run | `ski:end` |
| `yard-sale` | Yard Sale | Crashing hard enough to explode into pieces | `ski:crash` (the full ragdoll) |
| `resort-owner` | Resort Owner | Placing 10 things by hand in one visit | `place:object` (auto-generate and the trick park don't emit it) |

## Saves and storage

Inside the Overworld the run history uses `Overworld.save()` and `Overworld.load()`,
which the host keeps per player. The game does not save your resort layout; that is the
same as standalone.

The game keeps three settings in `localStorage`: `alpineDreams.quality`,
`alpineDreams.musicMuted` and `alpineDreams.sfxMuted`. All bundled worlds share one
origin, so every key must start with the game's name; any new key should follow the
same `alpineDreams.` prefix. The host's mute is never written to storage.

## Back to Hestermania

Inside the Overworld (`body.in-overworld`, set in `src/main.js`), a **Back to Hestermania**
pill appears under the wordmark (`#ow-exit`) and as a link on the title screen
(`#title-ow-exit`). Both call `exitToOverworld()`. The host draws its own Leave pill in the
top-left corner, so inside the Overworld the wordmark, the ski-mode Esc chip and the touch
Reset button move down 40 px to make room. The pill belongs to the editor chrome, so it
hides while skiing; end the run and it comes back.

## Touch and phones

The touch layout is the facelift's own (`src/ui/TouchControls.js`, coarse pointer →
`body.touch-ui`, plus the phone dock in `styles/main.css`). On top of it:

- **Ski mode:** steer ◀ ▶ (spin in the air), Tuck (frontflip in the air), Brake (backflip
  in the air), Jump (also gets back up after a crash; the prompt says "Tap Jump"),
  **Reset** (back to the start, top left) and Exit (ends the run, top right).
- **Placing:** a tap places (`ObjectPlacer`, pointer events), while a one-finger drag
  still orbits and two fingers pinch. The mouse events a browser synthesizes after a tap
  are ignored, so a tap never places twice. The mode chip gets a **Rotate** button (R).
- **Selecting:** tap a placed object to select it. The chip gets **Rotate** and
  **Remove** (Del). Lifts follow their stations and don't rotate.
- **Sculpting:** pointer events, so one finger sculpts; a second finger stops the
  stroke and orbits / pinches instead.
- Day/night and blizzard already have buttons in the environment cluster.
- **Layout:** `#app` is `position: fixed; inset: 0`, so it fills the iframe exactly.
  `SceneManager` resizes on `resize`, `orientationchange` (re-checked after 250 ms) and
  `visualViewport` resize, and redraws the frozen frame if a resize lands while paused.
  The viewport meta disables pinch-zoom of the page. `#ui-overlay` is inset by the
  safe-area insets, so every panel clears notches and home bars.
- **Pixel ratio** is capped at 1.5 on coarse-pointer devices at every quality tier.
- **Audio** unlocks on the first gesture (`pointerdown`, `touchstart`, `touchend`,
  `click` or `keydown`) and keeps listening until the context is really running, because
  mobile Safari only honours some of those. No audio starts before the player's first
  input, standalone or in the Overworld.

## Testing

### 1. Standalone (should behave exactly as before)

```bash
cd ~/Dev/alpine-dreams
python3 -m http.server 8000      # or: npx serve
# open http://localhost:8000
```

`Overworld.inOverworld` is `false`, no Back to Hestermania button appears, and nothing
is posted. In Chrome DevTools device mode (reload after switching) the touch controls
appear.

All paths are relative (`./vendor/...`, `src/...`, and audio resolves from
`import.meta.url`), so the game also works from a subfolder, which is how the Overworld
serves it.

### 2. In the contract harness

From the overworld repo:

```bash
npm run harness          # opens /harness.html on :5180
```

Pick `alpine-dreams` from the list, or open `/harness.html?world=alpine-dreams`. It is
loaded in the same sandboxed iframe the Overworld uses, and the harness ticks off each
part of the contract. To exercise them:

- **ready / welcome:** these happen on load.
- **Achievement:** drop the skier and land any trick, or crash for Yard Sale.
- **Save:** leave ski mode (Exit or Esc) after a run of at least 3 seconds.
- **Save handed back:** reload the world after saving.
- **pause · resume · mute:** use the harness buttons. The game freezes and resumes, and
  everything goes silent.
- **exit after request-exit / result card:** press request-exit.

`npm run validate -- alpine-dreams` runs the same handshake headless after an import.

### 3. Inside the Overworld

```bash
npm run dev              # in the overworld repo, then open /?at=alpine-dreams
```

Walk through the gate, play, then use **Back to Hestermania** and check the result card.

## Shipping to Hestermania (automatic)

Every push to `main` goes live in Hestermania within a few minutes. The "Update Hestermania"
Action (`.github/workflows/hestermania.yml`) rebuilds the Railway services. The overworld
build runs `tools/sync-remote-worlds.mjs` (driven by `remote-worlds.json` in the overworld repo), which downloads this repo's latest `main` and
re-imports it with `world:import`, writing `game/source.json`. To see what's live, open `<worlds origin>/worlds/alpine-dreams/game/source.json`;
it shows the `repo`, `ref`, `sha` and `syncedAt` of the imported build. The Action needs the repo secret `RAILWAY_TOKEN`,
a project token for hestermania's production environment.

So `main` must always stay Overworld-compatible: relative paths, no CDN, the bridge intact.
Test risky changes on a branch, using the manual import below, before merging.

## Re-importing after changes (manual, for local testing)

The Overworld bundles a copy of this repo in `worlds/alpine-dreams/game/`. To test a
change locally before merging, from the overworld repo run:

```bash
npm run world:import -- ~/Dev/alpine-dreams --id alpine-dreams --bump
npm run validate -- alpine-dreams
# optional, if the look changed:
npm run cover -- alpine-dreams --wait 6000
```

The import replaces `game/` and keeps `world.json`, the cover and any props. `--bump`
raises the patch version. The importer also copies the latest `overworld-sdk.js` over
this repo's copy in the bundle. To update the copy in this repo as well, run
`cp <overworld>/sdk/overworld-sdk.js ./overworld-sdk.js`.

Keep all paths relative (`./vendor/...`, `src/...`). Root-absolute paths like
`/src/main.js` would 404 inside the Overworld.
