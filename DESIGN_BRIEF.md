# Alpine Dreams: Facelift Design Brief

Art direction, ownership, contracts and task lists for the six parallel workstreams.
Repo: `/Users/hestermani/Dev/alpine-dreams/.claude/worktrees/facelift` (work only here, do not commit, the lead commits).

---

## 0. Diagnosis of the current build (baseline `shots/before-editor.png`)

| Problem | Root cause | Owner |
|---|---|---|
| Palette overlaps the title. Emoji icons look dated and render differently on each OS | Vertical palette with `top:50%` collides with `#title-bar`. Emoji in all buttons | D |
| Distant mountains are flat translucent cones | `Sky.createDistantMountains` uses `MeshBasicMaterial` ConeGeometry rings | B (moves to `DistantRanges.js`), A deletes from Sky |
| Terrain reads as a pale, speckled rectangle with a hard edge | Per-vertex hash color noise at high frequency, ground plane `0xe8f0f5` doesn't match the terrain edge, no apron | B |
| Trees read as black specks | Trees are only 7–15 units tall on a 3000×4000 terrain, spread uniformly instead of in groves, flat dark green | B |
| Flat, grey, overcast lighting | Sun at a high angle (300,500,200) plus strong ambient/hemi/fill/rim flatten everything. Fog is a cold grey-blue | A |
| Shadows only exist within ±600 of the origin | Fixed shadow camera frustum | A |
| Sky dome can be outside the camera (zoom max 5000 > dome 5000) | Dome is fixed at the origin | A |
| Clouds are white sphere blobs | `SphereGeometry` puffs | A |
| HUD and points popups use inline styles. `confirm()` dialog | Skier writes DOM directly | D + E |
| Each landing/crash creates a **new AudioContext** (it leaks, and browsers cap the count) | `Skier.playLandingSound/playCrashSound` | E removes, F reimplements |
| `scene.traverse` every frame in `Skier.checkCollisions` and in the snowball tree check | No collidable registry | E |
| Blizzard overwrites the night fog density, and night overwrites the blizzard | Fog is written from both `Snow.toggleBlizzard` and `main.toggleNightMode` | A (`Environment.js`), B stops touching fog |

---

## 1. Art direction: "Alpenglow"

**One look:** a stylized, low-poly, faceted world under a **late-afternoon golden-hour sun**: warm light, cool blue shadows, a painterly haze that fades to peach toward the sun and periwinkle away from it. Think vintage Swiss travel poster crossed with a modern cozy sim (A Short Hike, Alto's Odyssey, Lonely Mountains: Snow Riders). Use faceted `flatShading` on props, rocks and trees. Use smooth shading on snow. Night mode is **"Blue Hour / Moonlit"**: deep indigo sky, stars, a moon disc, moonlit snow, and **warm glowing windows and lift lights** that bloom.

Principles:
1. **Warm light, cool shadow.** Every lit snow surface leans cream. Every shadowed one leans blue. This single contrast does most of the beauty.
2. **Readable silhouettes at every scale.** Trees in dark groves against bright snow. Structures carry one saturated accent (red roof, red gondola) so they read from the editor camera at 4000 units.
3. **Depth through atmosphere.** Aerial perspective: near is saturated, far fades to haze color. Layered distant ranges get progressively lighter and bluer.
4. **Restraint in post.** Bloom only on the sun, glints, windows and lights. No blown-out snow. Grading is subtle.
5. **Motion everywhere, gently.** Drifting snow, swaying flags, moving lifts, camera easing, UI micro-motion. Nothing snaps.

### 1.1 Palette (linear-authored hex; tune by eye after tone mapping)

**World: day (Alpenglow)**
| Token | Hex | Use |
|---|---|---|
| sky.zenith | `#3D6FB6` | top of dome |
| sky.mid | `#8FB6E0` | 30–60° elevation |
| sky.horizonCool | `#C9D7EA` | horizon away from sun |
| sky.horizonWarm | `#F4C9A0` | horizon band toward sun azimuth |
| sun.glow | `#FFC27A` | Mie-like halo around sun |
| sun.disc | `#FFF4DE` | sun disc (HDR >1 so it blooms) |
| fog / haze | `#C4D2E4` | `FogExp2` color, must equal sky at h≈0 away from sun |
| light.sun | `#FFD9A8` | key DirectionalLight |
| light.skyFill | `#9DB8E6` | Hemisphere sky color |
| light.ground | `#C7D3E2` | Hemisphere ground (bright snow bounce) |
| snow.lit | `#FFF8EF` | vertex color, sun-facing flats |
| snow.mid | `#E7EEF6` | |
| snow.shade | `#B8C9E0` | shaded/steeper snow (light adds more blue) |
| snow.ice | `#CFE4F4` | high-altitude wind-scoured snow |
| snow.groomed | `#F2F4F8` | (could) piste corridors |
| rock.dark | `#4E5260` | |
| rock.light | `#868A96` | |
| rock.warm | `#7A6E62` | strata/lichen variation |
| pine.deep | `#1C3A31` | lower tiers / shadow side |
| pine.mid | `#2C5545` | |
| pine.tip | `#4A7A5A` | upper tiers |
| trunk | `#4A3426` | |
| distant.range1 | `#8EA3C0` | nearest distant ridge (before fog) |
| distant.range2 | `#A9BAD2` | |
| distant.range3 | `#C0CDE0` | farthest, nearly fog |
| distant.snowcap | `#F2F0F0` | |

**World: night (Blue Hour)**
| Token | Hex |
|---|---|
| sky.zenith | `#050B1E` |
| sky.horizon | `#1A2A4C` |
| moon.disc / light.moon | `#DCE6FF` / `#9FB8E8` |
| fog | `#0F1A30` |
| hemi sky / ground | `#22335A` / `#18223A` |
| snow under moon | cool `#AFC2E6` (comes from the lighting, not vertex colors) |
| warm.window | `#FFB04D` emissive (intensity ×2.5 at night, bloomed) |
| warm.lamp | `#FFC870` |

**Structure accents**
| Token | Hex |
|---|---|
| timber | `#8A5A3B` |
| timber.dark | `#5A3A28` |
| stone | `#7D7A76` |
| roof.red | `#A23A2C` (lodges) |
| roof.slate | `#3D4A5C` (cabins) |
| lift.steel | `#8C96A3` |
| lift.chair | `#2B3A55` |
| gondola.cabin | `#D9452B` |
| flag.red / flag.blue | `#E0473A` / `#2F6FD6` |
| jump.lip | `#FF7A1A` |
| skier.jacket | `#E8553D` |
| skier.pants | `#22304A` |
| skier.helmet | `#F4F6F8` |
| skier.goggle | amber mirror `#FFB347` (emissive 0.4) |

**UI**
| Token | Hex / value |
|---|---|
| --ink | `#0E1726` |
| --glass | `rgba(14, 23, 38, 0.52)` + `backdrop-filter: blur(18px) saturate(140%)` |
| --glass-light | `rgba(255,255,255,0.10)` (hover fill) |
| --stroke | `rgba(255,255,255,0.14)` 1px inner border |
| --text | `#F4F7FB` |
| --text-muted | `#A9B6C8` |
| --accent (glacier) | `#7CC4FF` |
| --accent-warm (alpenglow) | `#FFB36B` |
| --success | `#6EE7B7` |
| --danger | `#FF7A7A` |
| --radius | 16px panels, 12px buttons, 999px pills |
| --shadow | `0 10px 30px rgba(6,12,24,.35), 0 1px 0 rgba(255,255,255,.06) inset` |

### 1.2 Lighting and atmosphere
- **Sun direction (day):** normalized `(-0.62, 0.42, -0.66)`, so the sun is low (~25° elevation), from the back-left of the default editor view. It side-lights slopes and throws long shadows toward the camera. The sun disc and glow in the sky shader use the **same** vector (`Environment` passes it to Sky and Lighting).
- **Light rig (day):** sun DirectionalLight `#FFD9A8`, roughly 2.4. HemisphereLight sky `#9DB8E6`, ground `#C7D3E2`, roughly 0.9. **Remove** the separate ambient, fill and rim lights, or drop them under 0.15. They flatten the image. A weak cool back-fill (`#8FB0FF`, ~0.25, opposite the sun) is allowed. A tunes the final numbers by eye with tone mapping on.
- **Night:** moon DirectionalLight `#9FB8E8` ~0.6 from `(0.4, 0.75, 0.3)`, hemi `#22335A`/`#18223A` ~0.5, exposure ~0.85. Stars and moon are visible. Warm emissives come from C.
- **Shadows:** keep **2048 PCFShadowMap** (high/medium; low = 1024). The shadow camera **follows a focus point** (orbit target in the editor, skier in ski mode) with texel snapping to avoid shimmer. Frustum half-size is about 140 in ski mode (crisp) and about 900 in the editor (soft but present). The terrain still does **not** cast shadows.
- **Fog:** `FogExp2`. Day `#C4D2E4` at ~0.00016. Night `#0F1A30` at ~0.0002. Blizzard is about 0.00045–0.0006, lerped. A picks the final value so the editor view still shows the resort silhouette while ski-mode visibility drops dramatically. **Only `Environment` writes `scene.fog` and clear color.**
- **Tone mapping:** `ACESFilmicToneMapping` (punchier, stylized saturation; AgX greys out the snow), exposure 1.0 day and 0.85 night. With post enabled, tone mapping and sRGB happen in `OutputPass`. Without post (low tier), the renderer does it.

### 1.3 Post-processing plan (`src/scene/PostFX.js`, A)
Chain on **high/medium**:
1. `RenderPass` into a HalfFloat target (`samples: 4` on high, so MSAA comes free with WebGL2).
2. `UnrealBloomPass`: strength ≈0.35, radius ≈0.55, threshold ≈0.9 (on linear HDR, so only the sun disc, sparkles, windows and lamps bloom). Resolution = canvas × `bloomResolutionScale`.
3. `OutputPass`: tone mapping and sRGB conversion.
4. `ShaderPass(GradeShader)` in display space: lift/gamma/gain, split-toning (shadows toward `#3A5A9A`, highlights toward `#FFD8A8`, both ~8%), saturation 1.05, vignette 0.25, faint grain (0.02, animated). It also takes uniforms `uSpeed` (0..1 radial streak/vignette tighten for ski speed), `uFlash` (crash red/white flash) and `uNight` (night grade: cooler with a slight lift in the blacks).
5. `ShaderPass(FXAAShader)` on medium only (uniform `resolution` updated on resize).

**Low** tier: no composer. Use `renderer.render()` directly with the context's `antialias: true`. Everything must look correct, just plainer. **Fallback rule:** if composer creation throws, or HalfFloat targets are unsupported, drop to low silently and log once.

### 1.4 Typography (one Google Fonts request)
```
https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,800&family=Manrope:wght@400;500;600;700&family=Barlow+Condensed:ital,wght@0,600;0,700;1,700;1,800&display=swap
```
- **Fraunces 600/800**: wordmark "Alpine Dreams", title-screen headings, run-summary title. Soft serif with a vintage-poster warmth.
- **Manrope 400–700**: all UI body, labels, tooltips, toasts.
- **Barlow Condensed** (`font-variant-numeric: tabular-nums`): HUD numerals (speed, score) and **italic 800 uppercase** for trick callouts ("BACKFLIP 360°").

### 1.5 UI style
- **Frosted-glass panels** (`--glass`, blur 18px, 1px `--stroke`, soft shadow). Panels float with a 16px margin and never touch the edges.
- **Icons:** an inline SVG sprite (`<svg style="display:none"><symbol id="i-…">`) in index.html, 24×24, `stroke-width:1.75`, round caps and joins, `stroke: currentColor`, no fill. **No emoji anywhere in the UI.** Needed icons: raise, lower, smooth, chairlift, gondola, lodge, pine, flag, snowman, jump, skier, sparkle (auto-gen), park, mountain (new terrain), trash, camera, snowflake, moon/sun, wind (blizzard), music, music-off, next-track, speaker/sfx, close, help, quality/gear.
- **Layout:** compact wordmark top-left. Top-right action cluster plus environment toggles. **Bottom-center tool dock** (Terrain | Build | Ride, with groups separated by hairline dividers and the Ride button as an accent pill). Bottom-right audio cluster. Mode chip top-center. A contextual shortcut hint sits above the dock (only the keys relevant to the current mode). A `?` key or button opens a full shortcuts sheet.
- **Motion:** 160–240ms `cubic-bezier(.2,.8,.2,1)`. Buttons get hover lift (translateY -1px, brighten), active press (scale .96), and a selected state with an accent ring and soft glow. Toasts slide and fade. Trick callouts scale-pop (1.25 to 1 with overshoot) then rise and fade. Honor `prefers-reduced-motion`.
- **Accessibility:** every button gets `aria-label` and a tooltip showing its hotkey. Visible focus ring (`--accent`). Hit targets ≥ 40px (44 on touch). Toggles use `aria-pressed`.

---

## 2. Workstreams and file ownership (disjoint)

| WS | Name | Owns (edit only these; new files allowed inside the area) |
|---|---|---|
| **A** | render | `src/scene/SceneManager.js`, `src/scene/Lighting.js`, `src/scene/Sky.js`, **new** `src/scene/PostFX.js`, **new** `src/scene/Environment.js`, `src/core/quality.js` (already created, see §3) |
| **B** | terrain | `src/terrain/Mountain.js`, `src/terrain/Trees.js`, `src/scene/Snow.js`, **new** `src/terrain/DistantRanges.js` |
| **C** | structures | `src/objects/Lodge.js`, `src/objects/SkiLift.js`, `src/objects/Decorations.js` |
| **D** | ui | `index.html`, `styles/main.css`, `src/ui/UI.js` (new files under `src/ui/` allowed, e.g. `src/ui/Hud.js`, `src/ui/icons.js`) |
| **E** | skier | `src/objects/Skier.js`, `src/controls/CameraControls.js`, `src/core/events.js` (already created, API frozen) |
| **F** | audio+placement | `src/audio/Music.js`, **new** `src/audio/Sfx.js`, `src/controls/ObjectPlacer.js`, **new** `src/controls/BrushCursor.js` |
| — | integrator (lead) | `src/main.js`, `README.md` (nobody else touches these during the build) |

Rules:
- Do **not** edit a file you don't own. If you need something from another workstream, depend on the contract in §3 and guard it (`obj.method?.()`, `typeof x === 'function'`). Never `import { name }` a symbol that another workstream hasn't shipped yet unless the brief says the file already exists. Use `import * as M` plus a feature check when you're unsure.
- Keep every existing export, class name, constructor signature and public method listed in §3.2. Additions are fine.
- Three.js stays at **r0.161.0** via the importmap. Addons come from `three/addons/...`. No build step and no new CDNs besides Google Fonts.
- `console.error` / page errors = 0 in the harness. Remove noisy `console.log` spam (keep at most one init log line).

---

## 3. Integration contracts

### 3.1 New shared modules (already created by the lead, so import them freely)

**`src/core/events.js`** (owner E; API frozen)
```js
export function on(type, fn): () => void   // returns unsubscribe
export function off(type, fn): void
export function once(type, fn): () => void
export function emit(type, payload?): void // sync; handler errors are caught + logged
export function listenerCount(type): number
export const events = { on, off, once, emit, listenerCount }; export default events;
```

**`src/core/quality.js`** (owner A)
```js
export const QUALITY_LEVELS = ['low','medium','high'];
export const QUALITY_PRESETS = { low:{…}, medium:{…}, high:{…} };
// preset fields: pixelRatioCap, post, msaaSamples, fxaa, bloom, bloomResolutionScale, grade,
//                shadowMapSize, snowCount, treeDensity, sprayParticles, terrainDetail
export function getQuality(): 'low'|'medium'|'high'
export function getPreset(level = current): object
export function setQuality(level, { persist = true } = {}): string  // emits 'quality:change' {level, preset}
```
Initial level: `?quality=` URL param, then localStorage `alpineDreams.quality`, then a heuristic. Read the preset **at construction or populate time**. Listen to `quality:change` only for things that are cheap to change live (pixel ratio, post passes, shadow map size, snow count via draw range).

### 3.2 Existing public APIs that main.js, UI and others rely on (MUST keep their names and signatures)

| Module | Must keep |
|---|---|
| `SceneManager` | `constructor(canvasId)`. `async init()`. Fields `scene`, `camera` (PerspectiveCamera), `renderer`, `clock`, `onUpdate` (callback `(delta)`). `start()`, `onResize()`, `screenshot()` (must capture the **post-processed** frame), `getSceneCenter()`. `scene.fog` must stay a `FogExp2` |
| `Lighting` | `constructor(scene)`, `setup()`, `setNightMode(bool)`, `lights.sun` (DirectionalLight with castShadow) |
| `Sky` | `constructor(scene)`, `create()`, `setNightMode(bool)`, `update(delta)` |
| `Snow` | `constructor(scene)`, `create()`, `update(delta, camera)`, `toggle(): bool(enabled)`, `toggleBlizzard(): bool(isBlizzard)`, `setNightMode(bool)`, fields `enabled`, `isBlizzard` |
| `Mountain` | `constructor(scene)`, `generate()`, `regenerate(seed?)`, `getHeightAt(x,z)`, `getNormalAt(x,z)` (THREE.Vector3), `getSlopeAt(x,z)`, `sculpt(x,z,mode,delta)`, `finalizeSculpt()`, `raycast(raycaster)` (returns intersection or null), fields `width`(3000), `depth`(4000), `maxHeight`(280), `mesh`, `sculptRadius`. World scale is unchanged |
| `Trees` | `constructor(scene, mountain)`, `populate()`, `clear()`, `treeData[]` entries `{variant, instanceIndex, mesh, position:Vector3, scale, knockedDown}` (**add** `radius` = trunk collision radius in world units), `hideInstance(entry)`, `createFallbackTree(entry)` (returns Group added to scene, `userData.isTree=true`), `createTreeMesh(type)`, `addTree(x,z,type)`, `treeGroup`, `instancedMeshes` |
| `ObjectPlacer` | `constructor(scene, camera, domElement, mountain)`, `setPlacementMode(type): string(displayName)`, `cancelPlacement()`, `clearAll()`, `autoGenerate()`, `generateTrickPark()`, `update(delta)`, `placedObjects[]` entries `{type, object, data?}`, `mode`, `selectedObject`, `deleteSelected()`. Types: `ski-lift, gondola, lodge, pine-tree, flag, snowman, jump` |
| `CameraControls` | `constructor(camera, domElement)`, `controls` (OrbitControls; Skier reads `controls.target`), `update()`, `setEnabled(bool)`, `setSculptMode(bool)`, `reset()`, `setView(name)`, `focusOn(pos, dist)` |
| `Skier` | `constructor(scene, mountain, camera, cameraControls)`, `place(x,z)`, `remove()`, `update(delta)`, `isActive`, writable `trees` field, `mesh` |
| `UI` | `constructor(objectPlacer, snow, sceneManager, mountain, skier, trees, cameraControls)`, `init()`, `showNotification(msg, duration?)` |
| `Music` | `constructor()`, `init()`, `toggleMute(): bool(muted)`, `toggleTrack()`, `getTrackName(): string`, `setVolume(v)`, `stop()` |
| `SkiLift` | `constructor(scene, mountain)`, `createTower(height=8)`, `createLift(start:Vector3, end:Vector3, isGondola)` (Group, `name` 'skiLift'/'gondola', `userData.placedObject`, `userData.isGondola`), `update(liftGroup, delta)` |
| `Lodge` | `constructor(scene, mountain)`, `create(type='main'|'small'|'large')` (Group named containing 'lodge'/'Lodge'/'Cabin', `userData.placedObject=true`) |
| `Decorations` | `constructor(scene, mountain)`, `createFlag(color='red'|'blue')` (name 'markerFlag'), `createSnowman()` ('snowman'), `createTree(variant)` ('pineTree', `userData.isTree` must be set **true** for snowball knockdown), `createJump()` ('snowJump', `userData.isJump=true`), `createBench()`, `createSkiRack()`, `createSnowPile()`. Every returned root has `userData.placedObject=true` |

**Gameplay-critical geometry contracts:**
- **Jump ramp** (C): keep the footprint at scale 1 to width 3 and length 4, lip height 1.5, **high lip toward local −Z** exactly as now, origin at ground center. Skier ramp detection uses `obj.rotation.y`, `obj.scale.x`, radius 3.5×scale. Do not change this behavior.
- **Object names** drive `Skier.getCollisionRadius` (lodge 3, tree 0.5, snowman 0.6, flag 0.2, lift 1). Keep the substrings `lodge|Lodge`, `tree|Tree`, `snowman`, `flag`, `lift|Lift`. Note that `markerFlag` contains `Flag`, not `flag`. E should make the match case-insensitive.
- **Lift carriers** (C internal): `SkiLift.update` drives `lift.userData.carriers[]` with `curvePosition/curve/returnCurve/isReturn/gripHeight` and `lift.userData.speed`. C may restructure this freely because only `SkiLift.update` reads it.
- **Shared materials:** factories must reuse material instances across objects (one per factory), because night mode flips emissive on shared materials. `ObjectPlacer` clones materials for preview/highlight. That's fine.

### 3.3 New cross-module APIs (exact signatures)

**A: `src/scene/Environment.js`** (the only writer of fog, clear color and exposure)
```js
export class Environment {
  constructor({ sceneManager, lighting, sky, snow = null, distantRanges = null, objectPlacer = null, postFX = null })
  setNight(enabled: boolean, { instant = false } = {}): void  // animated ~1.2s blend; emits 'env:night' {night}
  setBlizzard(enabled: boolean): void                         // fog/visibility blend; emits 'env:blizzard' {on}
  update(delta: number): void                                 // drives blends; call every frame
  get isNight(): boolean
  get isBlizzard(): boolean
  sunDirection: THREE.Vector3                                 // unit vector toward the sun/moon (shared by Sky + Lighting)
}
```
During a blend, Environment calls `lighting.setNightMode(b)` / `sky.setNightMode(b)` (or A's internal `applyBlend(t)` helpers) and calls `snow?.setNightMode(b)`, `distantRanges?.setNightMode(b)` and `objectPlacer?.setNightMode?.(b)` once at the blend midpoint.

**A: `Lighting` additions:** `setShadowFocus(target: Vector3, halfSize?: number): void` keeps the shadow camera centered on the target with texel snapping. `setSunDirection(dir: Vector3): void`.
**A: `Sky` additions:** `setSunDirection(dir: Vector3): void`. Sky dome, stars and clouds follow the camera position each frame (`update(delta, camera?)`, with camera optional for back-compat).
**A: `SceneManager` additions:** `postFX` field (PostFX or null), `setQuality(level)` (applies the preset and rebuilds post), and an internal auto-tune: after load, if the average frame time stays above 24ms for 4s, step down one tier (at most twice, persisted, toast via `events.emit('ui:toast', {text})`). The render loop uses `postFX.render(delta)` when present and `renderer.render` otherwise.
**A: `PostFX`:** `constructor(renderer, scene, camera, preset)`, `render(delta)`, `setSize(w,h)`, `setPreset(preset)`, `dispose()`, `setSpeed(0..1)`, `flash(color='#ffffff', strength=1)`, `setNight(bool)`. PostFX subscribes itself to `ski:tick` (speed), `ski:crash` (flash red) and `ski:land` (tiny flash on big impacts).

**B: `src/terrain/DistantRanges.js`**
```js
export class DistantRanges {
  constructor(scene)
  create(): void              // 3 layered ridge rings (≥ 3500 radius), merged into ≤ 3 draw calls
  setNightMode(enabled): void
  update(delta, camera?): void // optional: keep centered on camera x/z
}
```
B also adds `Trees.update?(delta)` (if wind sway uses a time uniform) and `Mountain.update?(delta)` (if the sparkle shader needs time). Both are optional and the integrator guards the calls.
**B: shared tree builder for C:** `export function createStandaloneTree(variant = 'pine', scale = 1): THREE.Group` exported from `Trees.js`. It returns the same look as the instanced trees (1–2 meshes), named `'pineTree'`, with `userData.isTree = true`. C calls it via `import * as TreesModule from '../terrain/Trees.js'` with a feature check and a fallback.
**B: `Snow.toggleBlizzard()`** must **stop writing `scene.fog`**. It only changes particles and wind. Environment owns fog.

**C: night lights:** each factory (`SkiLift`, `Lodge`, `Decorations`) adds `setNightMode(enabled: boolean)`, which updates **shared** emissive materials (windows, lanterns, tower lamps, string lights). **No `PointLight`/`SpotLight` instances.** Fake light with emissive + bloom + additive glow sprites or ground "light pool" decals. Adding real lights changes shader programs and costs every material.

**F: `ObjectPlacer` additions:** `setNightMode(enabled)` forwards to `skiLift/lodge/decorations.setNightMode?.()`. `brush` is a BrushCursor instance created in the constructor. Emits `place:*` events (below).
**F: `src/controls/BrushCursor.js`**
```js
export class BrushCursor {
  constructor(scene, mountain)
  setMode(mode: 'raise'|'lower'|'smooth'|null): void  // null hides
  update(point: Vector3|null, radius: number, active: boolean): void // conforms ring to terrain
  pulse(): void
  dispose(): void
}
```
D drives it from UI.js sculpt handlers with `this.objectPlacer.brush?.setMode(...)` / `.update(...)`. D shows it on hover in sculpt mode, not only while dragging.
**F: `src/audio/Sfx.js`**
```js
export class Sfx {
  constructor(music)            // shares music's AudioContext; never creates its own
  init(): void                  // subscribes to events; safe before audio unlock (events ignored until ctx exists)
  toggleMute(): boolean         // returns muted
  setVolume(v: number): void
  get isMuted(): boolean
}
```
**F: `Music` additions:** `getContext(): AudioContext|null`, `output` (master GainNode) and a separate `sfxBus` GainNode, both feeding a gentle `DynamicsCompressor` limiter. `setDucked(amount 0..1)` (a lowpass/duck when in ski mode or at high speed, so wind and carve read). Crossfade on `toggleTrack()`.

**E: `CameraControls` additions:** `update(delta?)` (optional delta), `setAutoRotate(enabled: boolean, speed = 0.25)` (title-screen orbit), `flyTo(position: Vector3, target: Vector3, duration = 1.2): Promise<void>` (eased). `reset()` and `setView()` animate via flyTo.
**E: `Skier` additions:** writable field `objectPlacer`. Collisions iterate `this.objectPlacer?.placedObjects` (fall back to the current traverse if it's null). No per-frame `scene.traverse`. Snowball-vs-tree uses `entry.radius ?? 0.5*entry.scale`, and standalone trees come from `placedObjects` with `type==='pine-tree'`. **Skier no longer touches the DOM**: delete `updateHUD` DOM writes, `showPointsPopup` and the palette show/hide. **Skier no longer creates AudioContexts**: delete `initAudio/createSkiSound/updateAudio/playLandingSound/playCrashSound` and emit events instead. **Transitional safety:** until D lands, missing DOM is harmless because E removes the DOM calls entirely.

### 3.4 Event catalogue (names and payloads are the contract)

Emitters must emit exactly these. Subscribers must tolerate missing optional fields. Speeds are **internal units/s**. `mph = units × 2.24` (the existing HUD conversion). `speed01 = clamp(|speed| / 60, 0, 1)`.

| Event | Emitter | When | Payload |
|---|---|---|---|
| `ski:start` | E | end of `place()` | `{ x, z }` |
| `ski:end` | E | in `remove()` | `{ score, stats:{maxSpeedMph, totalAirTime, tricksLanded, tricksFailed, bestCombo, runSeconds} }` |
| `ski:reset` | E | `resetToStart()` | `{}` |
| `ski:tick` | E | every active frame (reused object, don't store it) | `{ speed, speedMph, speed01, maxSpeedMph, grounded, tucking, braking, switch, edge (-1..1), airTime (current), totalAirTime, score, combo, tricksLanded, ragdoll, trick:{ active, label, progress01 } \| null, hint: string\|null }` |
| `ski:jump` | E | leaving the ground | `{ source:'manual'\|'ramp'\|'natural', power (vertical velocity), speed }` |
| `ski:land` | E | air→ground transition (not ragdoll) | `{ airTime, impact (0..1 from vertical velocity), speed }` |
| `ski:trick` | E | clean award in `awardTrickPoints(true)` | `{ name, points, combo, spinDegrees, flips, flipDirection }` |
| `ski:crash` | E | `awardTrickPoints(false)` or `startRagdoll()` (once per crash) | `{ name: string\|null, speed }` |
| `ski:recover` | E | `recoverFromRagdoll()` | `{}` |
| `ski:collide` | E | body collision with a placed object | `{ type, speed }` |
| `ski:tree-knock` | E | snowball knocks a tree | `{ x, y, z }` |
| `place:mode` | F | placement mode enter/exit | `{ active: bool, type: string\|null }` |
| `place:object` | F | object placed (incl. lift completion) | `{ type, x, y, z }` |
| `place:lift-start` | F | first lift click | `{ type, x, y, z }` |
| `place:lift-preview` | F | while picking the lift end (throttled ~10Hz) | `{ length }` |
| `place:select` | F | selection change | `{ type: string\|null }` |
| `place:remove` | F | delete / clearAll | `{ type, count }` |
| `place:invalid` | F | click on an invalid spot | `{ reason }` |
| `sculpt:stroke` | D | sculpt mousedown / mouseup | `{ mode, phase:'start'\|'end' }` |
| `env:night` | A (Environment) | night toggled | `{ night }` |
| `env:blizzard` | A (Environment) | blizzard toggled | `{ on }` |
| `quality:change` | A (quality.js) | tier change | `{ level, preset }` |
| `ui:click` | D | any UI button press | `{ id }` |
| `ui:hover` | D | pointerenter on dock buttons (throttled) | `{ id }` |
| `ui:toast` | anyone | request a toast | `{ text, kind?: 'info'\|'success'\|'warn', duration? }` |
| `ui:toggle-night` | D | night button | `{}`. The integrator wires it to `environment.setNight(!isNight)` |
| `ui:toggle-blizzard` | D | blizzard button | `{}`. Integrator: `environment.setBlizzard(snow.toggleBlizzard())` |
| `ui:toggle-music` / `ui:next-track` / `ui:toggle-sfx` | D | audio buttons | `{}`. The integrator calls Music/Sfx, then `ui.setAudioState(...)` |
| `ui:quality` | D | quality picker | `{ level }`. Integrator: `sceneManager.setQuality(level)` |

Subscribers:
- **D (UI/HUD):** `ski:*` (all of the HUD), `place:*` (mode chip, toasts), `env:*` (toggle states), `ui:toast`, `quality:change`.
- **F (Sfx):** `ski:tick` (wind and carve loops), `ski:jump/land/trick/crash/collide/tree-knock`, `place:object/remove/invalid/lift-start`, `sculpt:stroke`, `ui:click/hover`, `env:night/blizzard`, `ski:start/end` (music duck).
- **A (PostFX):** `ski:tick`, `ski:crash`, `ski:land`, `ski:end` (reset).

**UI additions (D)** used by the integrator: `ui.setAudioState({ musicMuted, sfxMuted, trackName })`, `ui.dismissTitle()` (programmatic; used by the test harness), `ui.isTitleOpen` getter.

### 3.5 What the integrator will change in main.js (for awareness; don't pre-empt it)
1. Construct `Environment` after Lighting, Sky, Snow, DistantRanges and ObjectPlacer. Replace `toggleNightMode` body → `environment.setNight(...)`. M key → `environment.setBlizzard(snow.toggleBlizzard())`.
2. Create `DistantRanges` (B). Sky no longer creates distant mountains.
3. `skier.objectPlacer = objectPlacer`. Create `Sfx(music)` and `sfx.init()`.
4. Remove emoji `textContent` writes on music buttons and use `ui.setAudioState` instead. Wire `ui:*` events.
5. Update loop: `environment.update(delta)`, `sky.update(delta, camera)`, `trees.update?.(delta)`, `mountain.update?.(delta)`, `distantRanges.update?.(delta, camera)`, `cameraControls.update(delta)`, `lighting.setShadowFocus(skier.isActive ? skier.position : cameraControls.controls.target, skier.isActive ? 140 : 900)`.
6. Loading screen: keep hiding `#loading-screen` via the `.hidden` class. D's title screen appears after that.
7. Expose `window.alpineDreams` (already) and `window.alpineEvents = events` for debugging.

---

## 4. Per-workstream task lists

Priority: **MUST** (ship-blocking), **SHOULD** (expected), **COULD** (if time allows, without risking MUST).

### A: render (SceneManager, Lighting, Sky, PostFX, Environment, quality)
MUST
- Renderer: ACESFilmic, `outputColorSpace` sRGB, `powerPreference:'high-performance'`, pixel ratio from the preset cap. Keep `shadowMap` PCF and 2048 on high/medium.
- `PostFX.js` per §1.3, with a low-tier bypass and graceful fallback. Resize handling. `screenshot()` captures the composited frame (render once through post, then `toDataURL`. Add `preserveDrawingBuffer` only if needed).
- Lighting rig per §1.2: low warm sun, hemisphere bounce, ambient/fill/rim removed or minimized. Shadow camera follows the focus (`setShadowFocus`) with texel snapping. Night rig.
- Sky shader rewrite: zenith→mid→horizon gradient with **azimuth-dependent warm horizon** toward the sun, sun disc (HDR) and glow, a subtle horizon haze band that **matches the fog color exactly**. Night: indigo gradient, moon disc and glow, the existing star field (fade in, not pop). The dome follows the camera and renders behind everything (`depthWrite:false`, `renderOrder` -1, `fog:false`).
- Delete `createDistantMountains` from Sky (B owns ranges now).
- `Environment.js` per §3.3 with smooth 1.2s day/night blend (colors, intensities, fog, exposure, sky uniforms) and a blizzard blend. It is the only writer of fog, clear color and exposure.
- `quality.js` wiring: `setQuality`, auto-tune downgrade, live updates for pixel ratio, post and shadow size.
MUST NOT: add real-time lights beyond sun/moon + hemi (+ optional weak back-fill), enable `castShadow` on terrain, or exceed 2048 shadow maps.
SHOULD
- Clouds: replace sphere blobs with soft stylized clouds, either billboard cards with a procedural canvas texture (soft-edged, lit top/shaded bottom, tinted by sun and night) or flat-bottomed low-poly puffs with vertex shading. ≤ 3 draw calls total, slow drift, fade by distance.
- GradeShader extras: `uSpeed` radial vignette tightening and streaks at speed, `uFlash` for crashes, night grade.
- Sun glints: bloom tuned so B's snow sparkle and C's windows bloom while plain snow does not.
COULD
- Subtle animated aurora ribbon at night (one mesh, additive, low alpha).
- God-rays-lite: a screen-space sun glow when the sun is on-screen (in GradeShader using the projected sun position).
- Slow time-of-day drift on the title screen.

### B: terrain (Mountain, Trees, Snow, DistantRanges)
MUST
- **Terrain color rework** (`applyVertexColors`): replace the high-frequency per-vertex hash with low-frequency value/FBM noise (no salt-and-pepper). Palette per §1.1. Rock on slopes (normalY < ~0.72) with strata banding by height. A wind-scoured icy tint at altitude. **Forest-floor tint** (slightly darker, bluer snow) where tree density is high, so groves read from far away. Must stay allocation-free (reuse temp colors) and fast enough for `finalizeSculpt`.
- **Kill the hard rectangle edge:** replace the flat ground plane with an outer "apron" (large low-res plane, e.g. 64×64 segments, with gentle noise hills rising toward the distant ranges, vertex-colored to match `snow.mid`, `receiveShadow` true, castShadow false). Blend seamlessly with the terrain edge height (0) and color. Terrain edge falloff should feel natural.
- **Trees:** bigger and more beautiful. Real pine scale: template ~10–12 units tall, instance scale 0.8–1.7 (so 8–20 units). Skier ≈ 1.8, lodge ≈ 10. Silhouettes have 5–7 drooping tiers (7–8 sided cones), snow-laden tier tops, slightly irregular. 3 variants (pine, tall spruce, snow-heavy). Per-instance color variation via `instanceColor` (±8% value). **Grove distribution** from a low-frequency density noise (dense forests below ~60% maxHeight thinning toward the tree line, open meadows for runs), with total count about 4000 × `preset.treeDensity`. Keep InstancedMesh (≤ 4 draw calls, castShadow true, receiveShadow false). Keep the `treeData` contract and add `radius`. Keep `hideInstance` / `createFallbackTree` (fallback must match the new look). Export `createStandaloneTree`.
- **DistantRanges.js:** 3 concentric rings of jagged ridge silhouettes (ridged noise along a long strip, extruded to a peaky ring mesh, flat-shaded), with snowcaps above a noisy snowline and per-layer aerial-perspective vertex colors (`distant.range1..3`). Fog enabled. Merged, ≤ 3 draw calls. Must look good from both the editor camera (height 2000, 4000 back) and the ski camera (6 above ground). Night colors.
- **Snow.js:** GPU-animated particles (ShaderMaterial; positions computed in the vertex shader from time, seed and wind uniforms, so zero per-frame CPU loops), soft round flakes with size variation and depth fade, count from `preset.snowCount`. Blizzard: 2.5× density/speed, strong slanted wind, streak-stretched flakes. `toggle()` / `toggleBlizzard()` / `setNightMode()` contracts kept. `toggleBlizzard` no longer touches fog.
SHOULD
- Terrain material detail (`preset.terrainDetail`): `onBeforeCompile` adds world-space detail noise (soft wind ripples/sastrugi) and **sun sparkle** (tiny hash glints scaled by N·H, HDR so they bloom). Keep it cheap: one noise lookup, no textures, or a single 256² generated DataTexture.
- Tree wind sway: vertex shader bend by height with a `uTime` uniform (`Trees.update(delta)`). Knocked-down fallback trees are excluded.
COULD
- Groomed piste corridors (a lighter, smoother color band) along common lift lines, or a cheap "corduroy" stripe pattern in the detail shader.
- Ski tracks on the terrain from the skier (coordinate with E: E would emit positions; skip unless both have time).
- Rock outcrop props (instanced faceted boulders on cliffs, 1 draw call).

### C: structures (Lodge, SkiLift, Decorations)
MUST
- **Lodge:** a characterful alpine chalet: stone base, timber walls with visible beam ends, steep roof (roof.red) with deep overhangs and **thick snow layer with drips/icicles**, gable balcony, stone chimney, warm windows with mullions (shared emissive `warm.window`), door lamp. 'small' cabin (slate roof) and 'large' lodge variants. Merge static geometry by material (≤ 6 draw calls per lodge).
- **SkiLift:** tapered lattice-feel towers (box truss + crossarm + sheave assemblies), **bottom and top terminal stations** (small housed bullwheel with a roof), sagging cables (catenary sag proportional to span), detachable chairs (2–4 seats, safety bar, footrest; chair color `lift.chair`), gondola cabins (rounded, red with window band and roof hanger). Tower lamps for night. Carriers stay animated and correctly oriented. Keep `createTower(height)` for the preview, and its visual must match the new towers.
- **Decorations:** snowman with personality (3 balls slightly squashed, coal eyes and smile, carrot nose, stick arms, scarf in `skier.jacket` red, beanie). Flag as a proper race/slalom gate pole with a fabric banner (vertex-animated waving is a COULD). Jump as a **single smooth curved kicker** (ExtrudeGeometry from a 2D profile with a concave transition and flat top) plus an orange lip stripe and side marker poles, footprint and orientation per §3.2. Placed tree via `createStandaloneTree` (fallback: own matching look).
- `setNightMode(enabled)` on all three factories (emissive boost on shared materials). Everything uses the §1.1 palette and `flatShading` facets.
- Shadows: `castShadow` on main masses only (not tiny details). `receiveShadow` on big surfaces.
SHOULD
- Chimney smoke: one small Points system per lodge, or better, one shared system updated by `Lodge.update?(delta)` (tell the integrator if you add it).
- Lift station details: loading carpet, ticket booth, small trail-map sign. Benches and ski racks around lodges (exist as factories; give them the new look).
- Warm "light pool" decal (additive radial gradient plane) under lodge windows/lamps that only shows at night.
COULD
- String lights on lodge eaves (InstancedMesh of tiny emissive spheres).
- Flag banner waving via vertex shader time.
- Snowman variants (top hat, different scarf colors), chosen randomly.

### D: ui (index.html, main.css, UI.js)
MUST
- Full redesign per §1.4–1.5 with fonts, glass, SVG sprite and layout. No emoji anywhere. Fix the overlap.
- **Loading screen:** branded wordmark, an animated line-drawn mountain or snowflake SVG, and a soft progress shimmer. Keep the `#loading-screen` + `.hidden` contract (main.js hides it).
- **Title screen** (`#title-screen`, shown after loading): large Fraunces wordmark over the live scene (camera slow orbit via `cameraControls.setAutoRotate?.(true)`), tagline "Build your mountain. Then ride it.", buttons **Start Building** (dismiss) and **Quick Ride** (dismiss → `objectPlacer.generateTrickPark()` → place the skier near the top of the park, e.g. `skier.place(0, -700)`), plus a small shortcuts link. Dismiss with Enter/Escape/click. `ui.dismissTitle()` public.
- **Editor chrome:** bottom tool dock (Terrain: Raise/Lower/Smooth · Build: Lift, Gondola, Lodge, Tree, Flag, Snowman, Jump · Ride: Skier accent pill), each with an icon, label and hotkey badge. Top-right actions: Auto-generate, Trick park, New terrain, Clear (custom confirm popover, **not** `confirm()`), Screenshot. Environment toggles: Snow, Night, Blizzard (`aria-pressed` synced from `env:*`). Bottom-right audio: Music, Next track (tooltip shows the track name), SFX. Quality picker (low/med/high) in a small settings popover.
- Keep the DOM hooks: `#canvas`, `#ui-overlay` (pointer-events none, children auto), `#loading-screen`, `#mode-indicator` + `.mode-text` + `#cancel-placement`, `#btn-clear`, `#btn-random`, `#btn-trick-park`, `#btn-screenshot`, `#btn-toggle-snow`, `#btn-new-terrain`, `#btn-toggle-music`, `#btn-switch-track`, `.palette-item[data-object=…]`, `.palette-item[data-sculpt=…]`. Also keep elements with ids `skier-hud`, `object-palette`, `quick-actions`, `controls-hint`, `speed-value`, `score-value`, `combo-value`, `max-speed-value`, `air-time-value`, `tricks-value`, `trick-status` (they may be restyled, nested or repurposed, but must exist so nothing throws during the transition).
- **Hotkeys:** keep 1–7 (7 = skier) and Q/W/E sculpt. **Add 8 = jump.** Add `?` for the shortcuts sheet. Hotkeys ignore typing in inputs and are disabled while skiing or while the title is open (except Enter/Esc).
- **Ski HUD driven only by events** (§3.4). Speedometer bottom-left: big Barlow numerals plus an SVG arc gauge filled by `speed01`, glowing warm at high speed, with a TUCK indicator. Score top-center with a combo pill that pops on change. **Trick callouts:** center stack, italic uppercase name with "+points", scale-pop then rise/fade, color by size (≥1000 gets the warm glow). Live trick label and progress ring while airborne. Crash: red edge vignette pulse and a "SPACE to get up" prompt. Stats chip bottom-right. Controls legend fades after 6s (reappears on `?`). An "ESC exit" chip. **Run summary card** on `ski:end` (score, max speed, air time, tricks, best combo) that auto-dismisses after 5s. Toggle `body.is-skiing` on `ski:start/end` to hide editor chrome with a fade.
- **Toasts:** a stacked toast region (top-center, below the mode chip) replacing inline-style notifications. `showNotification` stays as a wrapper. Subscribe to `ui:toast`.
- **Sculpt:** drive F's brush (`objectPlacer.brush?.setMode/update`) on hover and drag. Emit `sculpt:stroke`.
- **Responsive:** ≥1280 full labels; 900–1280 compact dock; <900 icon-only dock that scrolls horizontally, HUD scaled down; touch targets 44px. `prefers-reduced-motion`.
- Emit `ui:click` / `ui:hover` / `ui:toggle-*` per §3.4. Implement `setAudioState`.
SHOULD
- Cursor states styled for `body.placing-mode`, `.hovering-object` and `.sculpt-mode` (custom SVG cursors).
- Lift placement helper text ("Click to set the top station · 412 m") from `place:lift-preview`.
- Mode chip with icon, instruction text and Esc hint.
COULD
- Brush size slider (writes `mountain.sculptRadius`) with a `[`/`]` hotkey.
- Mini compass or north indicator. Photo mode (H hides all UI).

### E: skier (Skier.js, CameraControls.js, events.js)
MUST
- **Event emission** per §3.4 at the exact transition points: manual jump (`input.jump` branch), natural launch (inflection branch), ramp launch (`checkCollisions`), landing (air→ground in the vertical block), trick award / crash, ragdoll recover, collisions, tree knock, place/remove/reset. `ski:tick` every frame from a reused object.
- **Remove all DOM and AudioContext code** from Skier (§3.3). HUD and sound move to D and F.
- **Perf:** no `scene.traverse` in the per-frame path (use `objectPlacer.placedObjects`). Hoist per-frame `new THREE.Vector3()` / `.clone()` to reusable temporaries in `update`, `checkCollisions`, `updateCamera` and `alignToTerrain`. Collision-name match is case-insensitive.
- **Skier look:** stylized character matching §1.1 (jacket `#E8553D`, navy pants, white helmet, amber mirrored goggles, gloves, poles with baskets, skis with bright top sheets). Faceted and chunky-cute proportions. Keep the `bodyParts` structure and ragdoll/explode behavior working with the new mesh. `castShadow` on.
- **Game feel:**
  - FOV 60 → up to ~74 with speed (+3 when tucking), smoothly lerped. Restore 60 and `updateProjectionMatrix()` on `remove()`.
  - Trauma-based screen shake (position and roll noise, decays): landing by impact, crash big, collision medium. Respects reduced motion (`matchMedia`).
  - Camera: frame-rate-independent damping (`1 - exp(-k·dt)`) instead of fixed lerp factors. Slight roll into carves (≤ 4°). Lower and closer when tucking. Look-ahead grows with speed. Pull back on big air so the skier stays framed.
  - Body: squash on landing (0.88 y for ~120ms), deeper knee bend while carving, arm swing in turns, tuck pose, poles plant on hard turns.
  - Snow spray: soft round sprite particles (sun-tinted, depth fade), emitted from the downhill ski edge proportional to `|edge|·speed`, plus a burst on landing and a big burst on hard braking. Count ≤ `preset.sprayParticles`, using one Points system.
- **CameraControls:** `update(delta?)`, `setAutoRotate`, eased `flyTo`, animated `reset`/`setView`. Editor feel: damping 0.06, zoom to cursor (`zoomToCursor` exists in r161 OrbitControls), polar limits kept, distance 20–5000.
SHOULD
- Brief slow-motion (0.6× for 250ms, eased) on landing a trick worth ≥ 1000. Clamp so physics stays stable (scale delta only).
- Ski trails: two fading ribbon meshes (ring buffer of ~300 points each, one BufferGeometry each) pressed slightly into the snow, only while grounded.
- Speed wind streak particles near the camera at high speed (or rely on A's PostFX `uSpeed`, so coordinate via `ski:tick` only).
COULD
- Trick names with more flavor (e.g. "Rodeo 540", "Misty Flip", "Cork 720") as long as the points table is unchanged.
- Camera "photo finish" orbit on `ski:end` before restoring the editor view (use `flyTo`).

### F: audio + placement (Music.js, Sfx.js, ObjectPlacer.js, BrushCursor.js)
MUST
- **Single AudioContext** owned by Music (created on the first gesture as now). `getContext()`, `sfxBus`, master limiter. Sfx never creates a context.
- **Sfx.js** synthesized with WebAudio (no samples):
  - Wind bed: looped filtered noise, bandpass center and gain rising with `speed01`, faint even when idle in ski mode, + blizzard gust layer on `env:blizzard`.
  - Carve: highpassed noise loop gated by `grounded`, gain from `|edge|·speed01`, brighter when braking.
  - Jump whoosh. Landing thump (low sine drop + noise burst, scaled by impact). Trick chime (pentatonic arpeggio, pitch and voices rising with combo; extra sparkle ≥ 1000 pts). Crash (thud + crunchy snow). Collision bonk. Tree crack and whump.
  - Placement: soft "thunk" with pitch variance on `place:object`, "poof" on remove, low "nope" on `place:invalid`, two-note chirp on `place:lift-start`.
  - UI: subtle tick on `ui:click`, ultra-quiet hover tick (throttled), soft chime swell on `env:night`.
  - All one-shots are short-lived nodes disconnected on end. ≤ 24 concurrent voices (voice-steal oldest).
- **Music polish:** crossfade on track switch (~1.5s), duck/lowpass in ski mode (`ski:start/end`) so sfx read, mute ramps without clicks. Fix any timer leaks in `stop()`.
- **Placement ghost:** the preview renders as a tinted glass ghost (shared translucent material, glacier blue `#7CC4FF` valid / `#FF7A7A` invalid: off-terrain, slope > ~0.75, or overlapping another placed object) with a soft ground footprint ring under it. The ghost bobs gently. Invalid clicks don't place, and they emit `place:invalid`.
- **Placement feedback:** new objects pop in (scale 0→1.08→1, easeOutBack ~280ms) with a small snow-puff particle burst (shared pooled Points). Delete shrinks and poofs. Selection uses a pulsing glacier ring on the ground plus a light emissive tint, without leaking cloned materials (dispose clones on deselect).
- **Lift placement:** after the first click, show a live preview of the whole lift (catenary cable curve from the start to the cursor plus ghost towers at the would-be spacing), emitting `place:lift-preview`. Replace the dashed `LineDashedMaterial` line.
- `setNightMode(enabled)` forwarding, the `brush` BrushCursor (terrain-conforming ring, color per mode: raise warm, lower glacier, smooth white, pulse on stroke), and `place:*` events.
- Keep `autoGenerate` / `generateTrickPark` working and better looking: place trees, benches and racks near lodges. Lodges face the slope rather than a random rotation.
SHOULD
- Hover highlight in select mode (thin ring) and a cursor class.
- Undo last placement (Ctrl/Cmd+Z, a single-level stack is fine). Tell the lead so D can add it to the shortcuts sheet.
COULD
- Adaptive music layer: a hi-hat/shimmer layer whose gain follows `speed01`.
- Spatialized one-shots (PannerNode by object position relative to camera).

---

## 5. Performance budget and quality rules

Reference: the default editor view after **Auto-generate**, plus ski mode on the trick park, at 1440×900.

| Metric | Budget (high) |
|---|---|
| Frame time on a dev laptop GPU | ≤ 16.7ms (60fps). Medium ≤ 16.7ms on integrated graphics |
| Draw calls, editor (`renderer.info.render.calls`) | ≤ 250 typical, ≤ 400 worst case |
| Draw calls, ski mode | ≤ 200 |
| Triangles | ≤ 1.5M |
| JS update per frame (`onUpdate`) | ≤ 3ms (no per-frame `scene.traverse`, no per-frame allocations in hot loops) |
| Post-processing cost | ≤ 3ms on high (bloom at ½ res) |
| Shadow map | 2048 PCF (high/medium), 1024 (low). Only sun/moon casts |
| Real-time lights | sun/moon DirectionalLight + HemisphereLight (+ optional weak back-fill DirectionalLight). **No point or spot lights** |
| Trees | InstancedMesh, ≤ 4 draw calls, ~4000 instances (× treeDensity) |
| Particles | snow GPU-animated (no CPU loop); spray ≤ 300; puffs pooled |
| Placed-object cost | ≤ 8 draw calls per lodge, ≤ 6 per decoration, lift ≤ 10 + carriers (InstancedMesh for carriers is a COULD) |
| Startup (generate + populate) | ≤ 1.5s on a dev laptop |

Rules:
1. Regressions in the existing perf work (InstancedMesh trees, 2048 PCF shadows, terrain not casting shadows) are rejected at integration.
2. Read `getPreset()` for every scalable cost. The low tier must be visibly simpler but still coherent (same palette, no post).
3. Shader changes go through `onBeforeCompile` or a `ShaderMaterial` created once. Never toggle defines or material flags per frame (causes recompiles).
4. Dispose geometries, materials and textures you replace (regenerate, clear, delete, preview swap).
5. Use the harness after every meaningful change: no new console errors, FPS not lower than baseline, screenshot reviewed.
6. Measure draw calls with `--eval "alpineDreams.objectPlacer.autoGenerate()" --after 1500` and `console.log(alpineDreams.sceneManager.renderer.info.render.calls)`.

### Harness recipes (run with cwd `/Users/hestermani/.claude/jobs/db3078ca/tmp`)
```
SHOT="node /Users/hestermani/.claude/jobs/db3078ca/tmp/shot.mjs /Users/hestermani/Dev/alpine-dreams/.claude/worktrees/facelift"
OUT=/Users/hestermani/.claude/jobs/db3078ca/tmp/shots
# editor with a generated resort (save as <ws>-editor.png)
$SHOT $OUT/A-editor.png --wait 5000 --eval "alpineDreams.ui.dismissTitle?.(); alpineDreams.objectPlacer.autoGenerate()" --after 1500
# night
$SHOT $OUT/A-night.png --wait 5000 --eval "alpineDreams.ui.dismissTitle?.(); alpineDreams.objectPlacer.autoGenerate(); alpineDreams.toggleNightMode()" --after 2500
# ski mode, tuck downhill then jump
$SHOT $OUT/E-ski.png --wait 5000 --eval "alpineDreams.ui.dismissTitle?.(); alpineDreams.objectPlacer.generateTrickPark(); alpineDreams.skier.place(0,-700)" --keys "KeyW:2500,Space:100" --after 400
# low tier: there is no URL param in the harness, so set it via eval before reload if needed:
#   --eval "localStorage.setItem('alpineDreams.quality','low'); location.reload()"
```
Name screenshots `<WS letter>-<topic>.png` so they don't collide.

---

## 6. Definition of done (each workstream)
1. Every feature in the project brief still works (editor sculpt/place/rotate/T/Del/hotkeys/auto-gen/clear/screenshot/snow/N/M/music/sfx; ski carve/W/S/Space/flips/spins/combos/switch/spray/collisions/snowball knockdown/camera).
2. Harness runs with **zero** console errors and page errors for your recipes.
3. Your contracts from §3 are implemented exactly. List any deviation, and anything main.js must do, in your final report.
4. Before/after screenshots for your area, and the FPS reading versus baseline.
