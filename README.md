# Alpine Dreams - Ski Resort Builder

A browser-based 3D ski resort builder and skiing simulator built with Three.js.

![Alpine Dreams](https://img.shields.io/badge/Three.js-black?style=flat&logo=three.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)

## Features

### Resort Building
- **Terrain Sculpting** - Raise, lower, and smooth terrain to create your perfect mountain
- **Random Cliffs** - Procedurally generated cliff formations add visual interest
- **Place Objects** - Add ski lifts, gondolas, lodges, trees, flags, snowmen, and jump ramps
- **Object Rotation** - Use arrow keys to adjust pitch/yaw of placed objects
- **Auto-Generate** - One-click resort generation with trees and terrain

### Skiing Simulation
- **Realistic Physics** - Gravity-based acceleration, carving turns, and speed control
- **Tuck for Speed** - Hold W to enter an aerodynamic tuck position and go faster (30% speed boost)
- **Natural Launches** - Hit ramps at high speed and automatically go airborne at inflection points
- **Trick System** - Perform flips, spins, and combo tricks off jumps
  - **Backflip/Frontflip** - W/S while airborne
  - **Spin Tricks** - A/D while airborne (180°, 360°, 540°, etc.)
  - **Combo Tricks** - Combine spins and flips for moves like "360° Backflip"
- **Animated Skier** - Full body animation with natural skiing stance
  - Arms bend realistically with poles
  - Deep tuck position when holding W
  - Body leans into turns
  - Head, helmet, and goggles move together
- **Snow Spray** - Particles kick up when carving turns
- **Collision Detection** - Interact with placed objects and launch off jumps
- **Timed Jumps** - Press jump at ramp lips for bonus height

### Environment
- **Dynamic Weather** - Toggleable snowfall
- **Procedural Terrain** - Randomized mountain generation with gentle slopes
- **Tree Population** - Thousands of low-poly pine trees across the terrain
- **Atmospheric Effects** - Fog and sky gradient for depth

## Controls

### Editor Mode
| Key | Action |
|-----|--------|
| Click | Place selected object |
| Arrow Keys | Rotate object (pitch/yaw) |
| T | Reset object rotation |
| Del | Remove object |
| Scroll | Zoom |
| Drag | Rotate camera |
| 1-7 | Quick select objects |
| Q/W/E | Sculpt tools (raise/lower/smooth) |

### Ski Mode
| Key | Action |
|-----|--------|
| A/D | Turn left/right |
| W | Tuck (speed boost) |
| S | Brake |
| Space | Jump |
| **While Airborne:** | |
| A/D | Spin (180°, 360°, 540°...) |
| W | Backflip |
| S | Frontflip |
| R | Reset to start position |
| ESC | Exit ski mode |

### Trick Tips
- **Natural Launch**: Hit any ramp or terrain lip at speed (12+) to automatically go airborne
- **Timed Jump**: Press Space right before a drop for extra height
- **Clean Landing**: Land within 30° of a 180° increment for spins, or complete your flip rotation
- **Combo Tricks**: Hold A/D while pressing W/S to spin and flip simultaneously

## Getting Started

1. Clone the repository
   ```bash
   git clone https://github.com/billums123/alpine-dreams.git
   cd alpine-dreams
   ```

2. Serve the files with any static web server:
   ```bash
   # Using Python
   python -m http.server 8000

   # Using Node.js
   npx serve
   ```

3. Open `http://localhost:8000` in your browser

## Tech Stack

- **Three.js** - 3D rendering and scene management
- **Vanilla JavaScript** - ES6 modules, no build step required
- **CSS3** - Modern styling with glassmorphism UI
- **Web Audio API** - Procedural ski sounds

## Project Structure

```
├── index.html          # Main HTML file
├── styles/
│   └── main.css        # All styles
└── src/
    ├── main.js         # Application entry point
    ├── scene/          # Scene setup, lighting, sky, snow
    ├── terrain/        # Mountain generation, trees
    ├── objects/        # Skier, decorations, lodges
    ├── controls/       # Camera, object placer
    └── ui/             # User interface controller
```

## License

MIT
