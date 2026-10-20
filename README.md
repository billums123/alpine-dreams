# Alpine Dreams

**Build your mountain. Then ride it.**

Alpine Dreams is a cozy 3D ski-resort builder and skiing game that runs in the browser. You sculpt a mountain, set up lifts, lodges and a terrain park, and then drop in and carve, jump and flip your way down. It is built on Three.js with plain ES modules, so there is no build step.

![Three.js](https://img.shields.io/badge/Three.js-r161-black?style=flat&logo=three.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES%20modules-F7DF1E?style=flat&logo=javascript&logoColor=black)

## The experience

### Look and feel ("Alpenglow")
- **Golden-hour lighting.** A low warm sun throws long shadows, a cool sky bounce fills the shade, and the rendering is tone-mapped with soft bloom, colour grading and atmospheric haze toward the sun.
- **Faceted low-poly world.** Snow-laden conifers sway in the wind, faceted rock outcrops sit on the steep faces, and layered distant ranges and an outer apron of foothills mean the world never ends at a hard edge.
- **Snow up close.** Near the camera the slopes show wind-sculpted ripples and occasional sun glints that fade with distance.
- **Night mode.** Press N for a raking moonlit night. Lodge windows and lift stations glow warm and bloom, and they stay visible as beacons from far away. The skier's hi-vis gear picks up the light.
- **Blizzard.** Press M for wind-driven snow streaks, heavy fog and stronger tree sway. Visibility drops a lot more while you ride than in the editor.
- **Premium UI.** The interface uses frosted-glass panels, custom icons, a title screen, toasts, tooltips with shortcut hints, a shortcuts sheet (?), a settings popover and a photo mode (H) that hides all the chrome.

### Building
- **Sculpt the terrain** with Raise, Lower and Smooth. A live brush cursor shows the area, and [ and ] change its size.
- **Place objects:** chairlifts and gondolas (click the bottom station, then the top), lodges, pine trees, slalom flags, snowmen and kicker jumps. A ghost preview shows whether the spot is valid, and objects pop in with a puff of snow.
- **Select and edit** placed objects. Rotate them with the arrow keys or R, reset with T, delete with Del or Backspace, and undo with Ctrl/Cmd+Z.
- **Auto-generate** a complete resort (lifts, lodge villages, slalom runs, snowmen and jumps). The camera then swoops to a 3/4 view of what was built.
- **Trick park:** builds a run of kickers along the mountain's longest fall line, with gates and a base lodge.
- **New terrain**, **Clear all** (asks for confirmation) and **Screenshot**.

### Skiing
- **Carve** with a two-stage turning model, **tuck** for speed, and **brake** with a snow-spray burst. Ride **switch** by going backwards: the camera follows your movement and the controls stay relative to the camera.
- **Air:** jump with Space, launch off kickers, or catch natural air over rollers.
- **Tricks:** spin with A/D and flip with W/S while airborne. Spins and flips combine, landing tricks in a row builds a combo multiplier, and a big landing triggers a short slow-motion beat.
- **Crashes:** a bad landing or hitting a lodge, lift or snowman sends you into a ragdoll tumble. Roll a snowball through the trees to knock them over, then press Space to get back up.
- **HUD:** an analog speedometer (about 30-50 mph cruising, near 70 in a full tuck), score, live trick callouts, air time and a run summary with **Ride again**.
- **Touch devices** get on-screen controls: steer left and right, Brake, Tuck, Jump and Exit.

### Audio
- Procedural music with several tracks (play/pause and next track).
- Sound effects for carving, wind, landings, tricks, placement and the UI. Music and sound effects can be muted separately.

### Performance
- Trees are drawn as spatially chunked `InstancedMesh` groups, so whole groves are frustum-culled and shadow-culled per chunk.
- The shadow map is 2048 PCF and follows the camera target (tight around the skier while riding), and the terrain does not cast shadows.
- There are three quality tiers (Low, Medium, High) in the settings popover. You can also pass `?quality=low|medium|high` in the URL. Changing the tier at runtime also thins the forest and turns the terrain detail shading on or off.
- If the frame rate stays low, auto-tune lowers the tier for the current session only. Only a tier you pick yourself is remembered.

## Controls

### Editor
| Input | Action |
|-------|--------|
| Drag / Right-drag / Scroll | Orbit / Pan / Zoom |
| Click | Place the selected object, or select a placed one |
| 1-6, 8 | Chairlift, Gondola, Lodge, Tree, Flag, Snowman, Jump |
| 7 | Drop in a skier and ride |
| Q / W / E | Sculpt: Raise / Lower / Smooth |
| [ / ] | Brush size (sculpt mode) |
| Arrow keys | Rotate the preview or selection (yaw / pitch) |
| R | Rotate 45° |
| T | Reset rotation |
| Del / Backspace | Delete the selection |
| Ctrl/Cmd + Z | Undo |
| Esc | Back out of the lift's second click, then cancel placement / clear selection |
| N / M | Night / Blizzard |
| H | Photo mode |
| ? | Shortcuts sheet |

### Ski mode
| Input | Action |
|-------|--------|
| A / D | Carve left / right (spin while airborne) |
| W | Tuck (front flip when pressed in the air) |
| S | Brake (back flip when pressed in the air) |
| Space | Jump / get back up after a crash |
| R | Restart from the drop-in point |
| Esc | Exit the run (shows the run summary) |
| ? | Show the controls legend again |

Flips start only on a new press of W or S after takeoff. Holding tuck over a roller never flips you by accident.

### Trick tips
- Hit a kicker at speed, or press Space just before a drop, for more air.
- To land cleanly, finish near a whole half-turn for spins and near upright for flips.
- Chain tricks quickly to grow the combo multiplier.

## Getting started

```bash
git clone https://github.com/billums123/alpine-dreams.git
cd alpine-dreams
python3 -m http.server 8000   # or: npx serve
```

Then open `http://localhost:8000`. Three.js loads from a CDN through an import map, so nothing needs to be installed.

## Project structure

```
index.html            Markup, import map, SVG icon sprite
styles/main.css       All UI styling (glass panels, dock, HUD, responsive and touch)
DESIGN_BRIEF.md       Art direction and palette for the facelift
src/
  main.js             App bootstrap and per-frame update
  core/               Event bus (events.js), quality tiers (quality.js)
  scene/              SceneManager, PostFX, Environment (day/night/blizzard), Lighting, Sky, Snow
  terrain/            Mountain (heightmap, colours, detail shader, rocks, apron), Trees, DistantRanges
  objects/            Skier, SkiLift, Lodge, Decorations, StructureKit (shared parts, night glow)
  controls/           CameraControls (fly-to), ObjectPlacer (placement, generators, beacons), BrushCursor
  ui/                 UI (editor chrome), Hud (ski HUD), TouchControls (mobile ski input)
  audio/              Music, Sfx
```

## License

MIT
