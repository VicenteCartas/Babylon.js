# Babylon.js 2D Package — Copilot Instructions

This session is focused on **`@babylonjs/2d`**, a 2D game engine package within the Babylon.js monorepo. See `.github/instructions/2d-engine-plan.instructions.md` for the full design plan, API reference, implementation history, and roadmap.

## Golden Rules

1. **Never break backward compatibility** — existing APIs must continue to work
2. **Never degrade rendering performance** — every code path is performance-critical
3. **Keep APIs simple** — if a design feels complex, simplify it before shipping

## Build & Test Commands

```bash
# From repo root:
npm run build:dev                                    # Build all dev packages (includes 2d)
npm run build:source                                 # TypeScript only (faster, no assets)

# From packages/dev/2d/:
npm run build                                        # Build 2d package only
npm run watch                                        # Watch mode for 2d package

# Unit tests (from repo root):
npm run test:unit                                    # All unit tests
npx jest --selectProjects=unit -- --testPathPattern="babylon.scene2d"  # Single 2D test

# Dev server with demos:
npm run start:devhost                                # Then visit ?exp=sidescroller, ?exp=isometric, ?exp=tactics, ?exp=test2d

# Lint & format:
npm run lint:check && npm run format:check
npm run format:fix                                   # Auto-fix formatting
```

## Package Layout

```
packages/dev/2d/                    ← Source (edit here)
  src/
    Scene2D/                        ← Root scene, render loop, node registry
    Node2D/                         ← Base entity class (transform, hierarchy, dirty tracking)
    Sprite2D/                       ← Static sprite rendering
    AnimatedSprite2D/               ← Spritesheet-driven animation
    SpriteSheet/                    ← Frame definitions (grid + JSON atlas)
    Camera2D/                       ← Viewport, follow, zoom, shake, design resolution
    Tilemap/                        ← Tiled .tmj loader, layers, animated tiles
    Collision/                      ← Box/Circle/Polygon colliders, SpatialGrid
    Physics/                        ← IPhysicsEngine2D interface + PlanckPhysicsEngine
    Input/                          ← InputMap2D (action bindings via DeviceSourceManager)
    Rendering/                      ← SpriteBatchRenderer (GPU instancing, multi-texture)
    Lighting/                       ← Light2D + LightingManager2D
    Particles/                      ← ParticleHelper2D (bridge to core ParticleSystem)
    Pathfinding/                    ← AStarPathfinder (A*, line-of-sight, reachable cells)
    Grid/                           ← Grid2D (square + hex), coordinate conversion
    Isometric/                      ← IsometricGrid (diamond + staggered)
    Tween/                          ← Tween, TweenManager, Easing (16 curves)
    StateMachine/                   ← Generic FSM for AI and animation
    Text2D/                         ← Canvas-rasterized in-world text
    NineSlice/                      ← NineSliceSprite2D with border insets
    Transition/                     ← SceneTransition2D (fade, slide)
    Math/                           ← Matrix2D, Rectangle2D, Vector2 utilities
  test/unit/                        ← 15+ test suites, 315 tests

packages/public/@babylonjs/2d/      ← Published npm package (generated, do not edit)
```

## Architecture

- **Coordinate system**: Y-down, top-left origin, pixel units. Matches Phaser/PixiJS convention (differs from Babylon 3D's Y-up).
- **Scene graph**: `Scene2D` → `Node2D` tree. Independent from core's `Scene`/`TransformNode`. Does NOT extend core classes.
- **Engine sharing**: Reuses `@babylonjs/core`'s `AbstractEngine` for WebGL/WebGPU rendering and GPU resources. The 2D package depends on core but not vice versa.
- **Render pipeline**: `Scene2D.render()` → collects `Sprite2D` instances → `SpriteBatchRenderer` (GPU instancing, multi-texture batching up to 8 textures/draw call, pixel-perfect mode).
- **Physics**: Plugin pattern via `IPhysicsEngine2D` interface. Default backend: **Planck.js** (Box2D port). Bodies centered at sprite position.
- **Transform dirty tracking**: Node2D uses setter-based dirty flagging for scalars (`rotation`, `alpha`, `zIndex`) and snapshot comparison for Vector2 fields (`position`, `scale`, `pivot`). Static nodes skip recomputation.

## Naming Conventions

Follow standard Babylon.js conventions (ESLint-enforced):

| Element | Convention | Example |
|---|---|---|
| Classes | `StrictPascalCase` | `class Sprite2D` |
| Interfaces | `I` prefix | `interface IPhysicsEngine2D` |
| Public members | `strictCamelCase` | `node.position` |
| Private/protected | `_` prefix | `private _engine` |
| Async methods | `Async` suffix | `loadTiledMapAsync()` |
| Enum members | `StrictPascalCase` or `UPPER_CASE` | `ScaleMode.FIT` |

## Import Conventions

Within `packages/dev/2d/src/`, use **relative imports**:

```typescript
import type { IDisposable } from "../interfaces";
import { Node2D } from "../Node2D/node2D";
import { SpriteBatchRenderer } from "../Rendering/spriteBatchRenderer";
```

For core engine types, import from `"core/..."` with the full subpath:

```typescript
import type { AbstractEngine } from "core/Engines/abstractEngine";
import { Color4 } from "core/Maths/math.color";
```

In test files, use **path aliases**:

```typescript
import { Scene2D } from "2d/Scene2D/scene2D";
import { Node2D } from "2d/Node2D/node2D";
```

Rules: **No index file imports**, **no cross-package relative imports**, **use `import type` for type-only imports**.

## Test Patterns

- Location: `packages/dev/2d/test/unit/`
- Naming: `babylon.<feature>.test.ts` (e.g., `babylon.scene2d.test.ts`)
- Use a **mock engine object** `{}` — no NullEngine needed for most 2D tests since rendering is mocked
- `describe()` / `it()` blocks with Arrange-Act-Assert
- Test file pattern: `/test/unit/.*test\.[tj]sx?$/`

## Documentation

- All public classes/methods **must** have JSDoc comments with `@param` and `@returns`
- Use `@internal` for non-public APIs
- Every new 2D feature gets a doc page in `BabylonDocumentation/content/features/featuresDeepDive/2d/`
- `console.log` is forbidden — use `console.time`/`console.timeEnd`/`console.trace` only
- No `.then()` — use `async`/`await`
- Curly braces always required for control flow

## Demos

Three demo games are hosted from the dev server (`npm run start:devhost`):

| Demo | URL param | Features demonstrated |
|---|---|---|
| Side-scroller | `?exp=sidescroller` | Sprites, animation, camera follow, physics, tilemaps, parallax, input |
| Isometric | `?exp=isometric` | Isometric grid, pathfinding, z-sorting, camera pan/zoom |
| Turn-based tactics | `?exp=tactics` | Grid2D, turn management, A* pathfinding, tweened movement |
| Test scene | `?exp=test2d` | Basic rendering validation |

## Roadmap (Next Steps)

See the plan file for the full roadmap. High-priority remaining items:
- **Debug Rendering** — Wireframe overlays for collision shapes, physics bodies, pathfinding grids
- **Sprite Atlas Builder** — Auto-pack textures at load time
- **Object Pooling** — Generic pool to avoid GC spikes
- **Shader Effects** — Outline, glow, dissolve, palette swap for sprites
