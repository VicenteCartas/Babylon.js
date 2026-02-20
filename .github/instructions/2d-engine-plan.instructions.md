# 2D Game Engine Plan

This file describes the ongoing implementation of `@babylonjs/2d`, a full 2D game engine package for Babylon.js. Reference this plan when working on any 2D engine task.

## Architectural Decisions

- **Package**: `@babylonjs/2d` at `packages/dev/2d`, published via `packages/public/@babylonjs/2d`. Separate from core — zero bundle impact for users who don't import it.
- **Class hierarchy**: Independent 2D scene graph (`Scene2D`, `Node2D`, `Sprite2D`, `Camera2D`). Does NOT extend core's Scene/TransformNode. Shares core's `Engine` for WebGL/WebGPU rendering and GPU resources.
- **Coordinate system**: Y-down, top-left origin, pixel coordinates. Matches Phaser/PixiJS/Excalibur (differs from Babylon 3D's Y-up).
- **Physics**: Plugin architecture via `IPhysicsEngine2D` interface (mirrors 3D Havok/Ammo pattern). Default backend: Planck.js. Optional: Box2D-WASM.
- **Naming**: Use Babylon naming where equivalent concepts exist (`Observable`, `dispose`, `alphaMode`, `lockedTarget`). Use 2D industry standard names otherwise (`SpriteSheet`, `Camera2D`, `InputMap2D`).
- **Documentation**: Every feature gets a doc page in `BabylonDocumentation/content/features/featuresDeepDive/2d/`.

## Core API Classes

### Scene2D
- Owns the 2D render pipeline (sprite batching, z-sort, draw calls)
- Properties: `engine: Engine`, `rootNodes: Node2D[]`, `camera: Camera2D`, `backgroundColor: Color4`
- Lifecycle: `onBeforeRender`, `onAfterRender` observables
- Methods: `render()`, `update(deltaTime)`, `getNodeById()`, `getNodesByTag()`, `pick()`

### Node2D (base for all 2D entities)
- Transform: `position: Vector2`, `rotation: number`, `scale: Vector2`, `pivot: Vector2`
- Hierarchy: `parent`, `children`, `addChild()`, `removeChild()`
- Rendering: `zIndex: number`, `visible: boolean`, `alpha: number`
- Lifecycle: `onUpdate?()`, `onReady?()`, `onDestroy?()`
- Computed: `worldTransform: Matrix2D`, `worldPosition: Vector2`
- Utilities: `localToWorld()`, `worldToLocal()`, `dispose()`

### Sprite2D extends Node2D
- `texture`, `sourceRect`, `tint: Color4`, `flipX`, `flipY`, `alphaMode`, `width`, `height`

### AnimatedSprite2D extends Sprite2D
- `spriteSheet: SpriteSheet`, `play()`, `stop()`, `pause()`, `speed`
- Events: `onAnimationEnd`, `onFrameChange`

### SpriteSheet
- `fromGrid(texture, frameWidth, frameHeight)`, `fromAtlas(texture, atlasData)`
- `defineAnimation(name, frames, frameRate)`, `getFrame(index)`

### Camera2D
- `position`, `zoom`, `rotation`, viewport dimensions
- Follow: `lockedTarget: Node2D | null`, `followOffset`, `lerpSpeed`
- Bounds: `bounds: Rectangle | null`
- Effects: `shake(intensity, duration)`
- Coordinates: `screenToWorld()`, `worldToScreen()`

### Tilemap2D
- `fromTiled(data, textures)` — loads .tmj (Tiled JSON)
- `getLayer()`, `getTileAt()`, `setTileAt()`, `isSolid()`, `getCollisionTiles()`
- `TilemapLayer2D extends Node2D` for rendering individual tile layers

### Collision2D
- Shapes: `BoxCollider2D`, `CircleCollider2D`, `PolygonCollider2D`
- `Collider2D` component with `layer`/`mask` bitmask filtering
- Scene queries: `overlapPoint()`, `overlapBox()`, `overlapCircle()`, `raycast()`
- Spatial partitioning (grid or quadtree) for broad-phase

### InputMap2D
- `defineAction(name, ...bindings)` — keyboard/mouse/gamepad
- `isActionDown()`, `isActionPressed()`, `isActionReleased()`, `getAxis()`
- `pointerScreenPosition`, `pointerWorldPosition` (via Camera2D)

### IPhysicsEngine2D (plugin interface)
- `addBody()`, `removeBody()`, `step()`, `setGravity()`, `raycast()`
- Default backend: `PlanckPhysicsEngine`

### AStarPathfinder
- `findPath(startCol, startRow, endCol, endRow)` — A* with diagonal + weighted costs
- `getReachableCells(col, row, maxCost)` — Movement range for turn-based games
- `hasLineOfSight(startCol, startRow, endCol, endRow)` — Bresenham line check

### Grid2D
- Square, HexFlatTop, HexPointyTop topologies
- `cellToWorld()`, `worldToCell()` — Coordinate conversion
- `getNeighbors()`, `distance()`, `getCellsInRange()` — Grid queries

### Tween / Easing
- `Easing` — Static class with 16 standard easing curves (Linear, Quad, Cubic, Sine, Expo, Back, Elastic, Bounce — In/Out/InOut variants)
- `Tween` — Interpolates numeric values over time with fluent API
  - `new Tween({ from, to }, duration, easing)` → `.onUpdate(v => ...)` → `.start()`
  - `.setDelay()`, `.setLoop(yoyo)`, `.setRepeat(count, yoyo)`, `.chain(tween)`
  - `.complete()`, `.stop()`, `.dispose()`
  - `Tween.CreateAsync(from, to, duration, easing, onUpdate)` — static factory
- `TweenManager` — Batch-updates active tweens, auto-removes completed
  - `.add(tween)`, `.update(dt)`, `.stopAll()`, `.dispose()`

## Implementation Progress

### Completed (49/49 tasks — ALL PHASES DONE):
- Phase 1: Package scaffold, Scene2D, Node2D, Matrix2D, Rectangle2D, SpriteBatchRenderer, Sprite2D — ✅
- Phase 2: SpriteSheet, AnimatedSprite2D, Camera2D — ✅
- Phase 3: Tilemap2D, TilemapLayer2D, Tiled .tmj loader, collision queries — ✅
- Phase 4: Collision shapes (Box/Circle/Polygon), SpatialGrid, InputMap2D — ✅
- Phase 5: IPhysicsEngine2D interface, PlanckPhysicsEngine — ✅
- Phase 6: Side-scroller demo with player controller, enemy AI, camera follow, parallax — ✅
- Phase 7: Light2D + LightingManager2D, ParticleHelper2D (core ParticleSystem bridge) — ✅
- Phase 8: AStarPathfinder, Grid2D (square + hex), tests — ✅
- Phase 9: IsometricGrid (diamond + staggered), isometric demo — ✅
- Phase 10: Turn-based tactics demo — ✅
- Render pipeline wired: Scene2D.render() → SpriteBatchRenderer — ✅
- StateMachine2D (generic FSM for AI + animation) — ✅
- Tween/Easing system (16 easings, Tween class, TweenManager) — ✅
- Tactics demo uses Tween for smooth unit movement — ✅
- Public package: `packages/public/@babylonjs/2d` ready for npm publishing — ✅
- Documentation: 17 pages — ✅
- Tests: 315 passing across 15 test suites
- Demos: 3 games + 1 test at devHost (?exp=sidescroller, ?exp=isometric, ?exp=tactics, ?exp=test2d)

### Render pipeline bugs fixed this session:
1. **gl.viewport not set** — Added `engine.setViewport({x:0,y:0,width:1,height:1})` in Scene2D.render(). Without this, rendering went to a tiny default viewport region.
2. **engine.beginFrame()/endFrame() missing** — Added to Scene2D.render(). Fixes FPS measurement and gl.flush().
3. **engine.clear() not clearing depth** — Changed to `clear(color, true, true, false)`.
4. **Node2D worldTransform stale** — Position/rotation are plain public fields; mutating them didn't re-dirty the cached worldTransform. Fixed by always recomputing in the getter (TODO: optimize later with proper change tracking).
5. **Camera2D design resolution** — Added `setDesignResolution(w, h, ScaleMode)` + `ScaleMode` enum (FIT/FILL/STRETCH) for resolution-independent rendering.
6. **Camera bounds when viewport > level** — Centers on level instead of clamping to invalid range.
7. **Parallax z-ordering broken** — `Scene2D._collectSprites()` used each sprite's own `zIndex` for sorting, but parallax child sprites had default zIndex=0 despite their parent having negative zIndex. Added `Node2D.worldZIndex` (accumulated additively through parent chain, like `worldAlpha`). Scene2D now sorts by `worldZIndex`.
8. **Parallax backgrounds static** — `createParallaxLayers()` return value was discarded, no scrolling code existed. Now stores layers and offsets each parent's position per-frame: `layer.parent.position.x = -camX * (1 - factor)`.
9. **Node2D worldTransform perf** — Was recomputing on every getter access (~5k matrix ops/frame for static scenes). Implemented proper dirty tracking: scalar properties (`rotation`, `alpha`, `zIndex`) use setter-based dirty flagging; Vector2 fields (`position`, `scale`, `pivot`) use snapshot comparison (6 float comparisons). Static nodes now skip recomputation entirely.
10. **Sprite/physics misalignment** — SpriteBatchRenderer drew quads from (0,0)→(w,h) treating position as top-left, but Planck physics centers bodies at position ±(w/2,h/2). Physics bodies were above the visible sprites, causing invisible collisions, player overlapping ground, and broken ground detection. Fixed by centering quad vertices: `(corner - 0.5) * size`. Position now means "center of sprite" matching physics and all 2D engine conventions.

### Known remaining bugs (to fix next session):
- May need to tune design resolution values per demo

### Completed in QA/hardening session:
- **Pathfinder start-cell bug** — `getReachableCells` rejected start cell as unwalkable when a unit occupied it. Fixed by skipping walkability check on start cell.
- **Tactics attack-without-moving** — Added ability to attack adjacent enemies during move phase without needing to move first.
- **HiDPI pointer coordinates** — InputMap2D now scales CSS mouse coords to canvas buffer pixels for correct screenToWorld on retina displays.
- **Test coverage** — Added tests for Sprite2D, AnimatedSprite2D, Scene2D, InputMap2D, Text2D. Total: 315 tests across 15 suites.
- **Demo overlay info** — Each demo now shows which 2D features it showcases and their source file paths.
- **Text2D** — New `Text2D extends Sprite2D` for in-world text rendering via canvas rasterization.
- **InputMap2D refactor** — Replaced manual DOM event listeners with core DeviceSourceManager for mouse/touch/gamepad. Constructor now takes `engine` instead of `canvas`. Touch input works automatically via unified pointer handling.
- **ParticleHelper2D** — Replaced CPU-only `ParticleEmitter2D` with a bridge to core's GPU-accelerated `ParticleSystem`. Creates a core Scene with orthographic camera synced to Camera2D (Y-down). Users get full particle features + Node Particle Editor support.
- **Camera2D.effectiveScale** — Exposed as public getter for external systems (e.g., ParticleHelper2D ortho sync).
- **Test count** — 307 tests across 16 suites.
- **TypeScript cleanup** — Fixed InputMap2D type casts (IPointerEvent, PointerButtonInput union) and Text2D canvas context cast.
- **SpriteBatchRenderer optimizations** — GPU instancing (4× less data), multi-texture batching (8 textures/draw call), pixel-perfect mode (fwidth), VAO caching, partial buffer uploads.
- **Documentation updated** — particles.md rewritten for ParticleHelper2D, input-mapping.md updated for engine constructor + touch, sprites doc updated with renderer perf notes.

## Roadmap

### 🔴 Tier 1 — High Impact / Core Gaps
1. ~~**9-Slice Sprites**~~ ✅ — `NineSliceSprite2D` with border insets, auto-clamping, 9-quad rendering.
2. ~~**Scene Transitions**~~ ✅ — Fade and slide transitions via `SceneTransition2D`. Also added `Scene2D.renderContent()` for multi-scene compositing.
3. ~~**Tilemap Animated Tiles**~~ ✅ — Tiled animation parsing, `update(dt)` frame cycling, `getDisplayTileId()` resolver, `addTileAnimation()` for programmatic use.

### 🟡 Tier 2 — Developer Experience
4. **Debug Rendering** — Wireframe overlays for collision shapes, spatial grid cells, pathfinding grids, physics bodies. Toggle with a flag.
5. **Sprite Atlas Builder** — Auto-pack multiple images into a single texture atlas at load time. Maximizes multi-texture batching.
6. **Object Pooling** — Generic pool for bullets, particles, enemies. Avoids GC spikes in action games.

### 🟢 Tier 3 — Advanced Features
7. **Shader Effects for Sprites** — Outline, glow, dissolve, palette swap via custom fragment shaders. Core has post-processes we could adapt.
8. **Render-to-Texture / Offscreen Layers** — Render Scene2D to a texture for minimaps, reflections, transition effects.
9. **Auto-Tiling** — Automatic tile selection based on neighbors (RPG Maker-style).
10. **Save/Load System** — Serialize/deserialize Scene2D state for game saves.
11. **Networking/multiplayer support**

### ✅ Completed (moved from roadmap)
- ~~Documentation~~ — All 17 doc pages written and updated for API changes.
- ~~Fix TypeScript Errors~~ — InputMap2D type casts, Text2D interface members cleaned up.

## Implementation Phases

### Phase 1: Package Scaffold + Core Primitives
- Create `packages/dev/2d` package structure
- `Scene2D`, `Node2D`, `Matrix2D`
- Sprite batch renderer
- `Sprite2D`
- Unit tests + "Introduction to 2D" doc

### Phase 2: Animation + Camera
- `SpriteSheet`, `AnimatedSprite2D`, `Camera2D`
- Unit tests + docs

### Phase 3: Tilemaps + Tiled
- `Tilemap2D`, `TilemapLayer2D`, Tiled .tmj loader, collision queries
- Unit tests + docs

### Phase 4: Collision + Input
- Collision shapes, spatial partitioning, queries
- `InputMap2D`
- Unit tests + docs

### Phase 5: Physics2D
- `IPhysicsEngine2D` interface + Planck.js backend
- Unit tests + docs

### Phase 6: Side-Scroller Demo (first demo game)
- Player controller, enemy AI, Tiled level, camera follow, parallax
- Hosted from `packages/tools/devHost`

### Phase 7: 2D Lighting + Particles
- Normal-mapped sprites, `Light2D`, `ParticleHelper2D` (bridge to core ParticleSystem)
- Integrate into side-scroller demo + docs

### Phase 8: Pathfinding + Grid System
- A* on grid, hex/square grid utilities
- Unit tests + docs

### Phase 9: Isometric Demo ("Micro City")
- Isometric tilemap rendering + depth sorting
- Demo with pathfinding + camera pan/zoom

### Phase 10: Turn-Based Demo ("Tactics Grid")
- Grid-based tactics game, turn management, AI, GUI HUD

## Demo Games
1. **Side-scroller** (Phase 6): Platformer proving sprites, animation, camera, physics, tilemaps, input
2. **Isometric** (Phase 9): City/RPG proving isometric rendering, pathfinding, z-sorting
3. **Turn-based** (Phase 10): Tactics game proving grid system, turn management, GUI integration

## Key Constraints
- Babylon golden rules: no backward-compat breaks, no perf regressions, keep APIs simple
- All public classes/methods need JSDoc comments
- Async methods must end with `Async` suffix
- Private/protected members prefixed with `_`
- Interfaces prefixed with `I`
- Use `import type` for type-only imports
