# Lottie Player — Tree-Shakable Functional Refactor

> Author: Claude Opus 4.7 (1M ctx) — investigation only, no code changes yet.
> Scope: `packages/dev/lottiePlayer` (in-place refactor). Babylon rendering
> primitives (`ThinEngine`, `ThinSprite`, `SpritePacker`'s GPU upload path,
> `sprites.vertex/fragment`) are **out of scope** and will be addressed
> separately. We only restructure code that lives in this package.

---

## 1. User intent (locked in)

From the up-front Q&A:

| Decision | Choice |
|---|---|
| Location | **In-place refactor** of `packages/dev/lottiePlayer` |
| Public API | **Breaking change** — drop classes, ship only the new functional API |
| Feature-gating axes | Layer types · shape primitives · text rendering · worker vs main-thread |
| Side effects | **Per-feature `register*()` functions** — Babylon-Lite style |

This means: a consumer who only renders a shape animation with rectangles
and a single fill must not pay bytes for text layout, font parsing, gradient
fills, strokes, ellipses, paths, solid layers, or the worker plumbing.

---

## 2. Current state inventory

23 files, ~5.4k LOC. Heaviest modules:

| Lines | File | Role |
|---:|---|---|
| 1001 | `parsing/parser.ts` | Monolithic `Parser` class — parses every layer / transform / property type |
| 946 | `parsing/spritePacker.ts` | Atlas + Canvas2D rasterizer for shapes and text |
| 646 | `parsing/textLayout.ts` | Spec + Babylon8 text metrics + wrapping |
| 513 | `nodes/node.ts` | Scenegraph `Node` class (transforms + animation evaluation) |
| 388 | `rendering/animationController.ts` | Engine init + render loop |
| 339 | `maths/boundingBox.ts` | Shape bounding box accumulator |
| 323 | `player.ts` | Worker-based public `Player` class |
| 311 | `parsing/rawTypes.ts` | JSON schema types (zero-runtime) |
| 175 | `animationConfiguration.ts` | Config defaults + resolution |
| 159 | `messageTypes.ts` | Worker postMessage discriminated union |
| 155 | `worker.ts` | Worker entry — `onmessage` dispatch |
| 138 | `localPlayer.ts` | Main-thread public `LocalPlayer` class |

### Public surface today (`src/index.ts`)
```ts
export type { AnimationConfiguration, LottieCompatibilityMode, LottieCompatibilityOptions };
export { Player };       // OffscreenCanvas + worker
export { LocalPlayer };  // main thread
export type { RawLottieAnimation };
```

### Why nothing tree-shakes today
1. `Parser` is one class whose constructor unconditionally walks `switch(layer.ty)`
   over solid (1), null (3), shape (4), text (5). Even a pure-shape file drags
   in `_parseTextLayer` → `textLayout.ts` → font tables.
2. `SpritePacker` has methods for every primitive: `_drawRectangle`,
   `_drawEllipse`, `_drawPath`, `_drawFill`, `_drawStroke`,
   `_drawGradientFill`, `_drawGradientStroke`, `_drawText`. The class
   instance retains all of them.
3. `AnimationController` constructs `Parser` + `SpritePacker` directly. No
   seam for swapping in a slimmer parser.
4. `Player`/`LocalPlayer` import `AnimationController` eagerly, so picking
   one transport (worker vs main) still pulls in everything from the other
   in shared modules.
5. `Node` carries opacity inheritance, animation arrays, null-layer
   semantics, world/local/global matrices all in one class — even a
   non-animated, non-parented sprite pays for all of it.
6. `compatibility` lives inside `ResolvedAnimationConfiguration`, so
   `MeasureBabylon8LottieText` is statically reachable from
   `MeasureLottieText` even if a consumer only uses `"spec"`.
7. `worker.ts` (and `blobWorkerWrapper`) are imported by `Player` via
   `new URL("./worker", import.meta.url)` — bundlers ship the entire worker
   even when the consumer only uses `LocalPlayer`.

### The "rendering" we are NOT touching (yet)
- `ThinEngine` construction + GL state
- `ThinSprite` + `sprites.vertex/fragment` shader registration
- `InternalTexture` / `ThinTexture` upload in `SpritePacker.updateAtlasTexture`
- `Viewport`, `Matrix` math from `core/Maths`
- `engine.alpha` extension

These remain as opaque dependencies behind the new functional API. The
refactor below is structured so that swapping the GPU backend later is a
local change inside the `render/` module.

---

## 3. Target architecture

### 3.1 Pure-data + functions (Babylon-Lite Pillar 4b/4b′)

Every today-class becomes one of:

- a **plain state interface** (`type Foo = { ... }`) with `_` internal fields, OR
- a **standalone factory function** returning that state (`createFoo(opts): Foo`), OR
- **standalone operation functions** that take the state as their first arg
  (`tickFoo(foo, dt)`, `disposeFoo(foo)`).

No methods on interfaces. This is the only way unused functions ever get
eliminated by Rollup/esbuild/Vite.

### 3.2 Module split

```
packages/dev/lottiePlayer/src/
├─ index.ts                       — re-exports core + a "full" preset (see §3.6)
├─ core/
│   ├─ types.ts                   — Player, AnimationState (pure data)
│   ├─ create-player.ts           — createLottiePlayer(opts)
│   ├─ play.ts                    — playAnimation / pauseAnimation / dispose
│   └─ resize.ts                  — handleResize, calculate-scale (moved from rendering/)
├─ config/
│   ├─ types.ts                   — AnimationConfiguration (already pure)
│   └─ resolve.ts                 — resolveConfiguration(partial, caps) — was UpdateConfiguration
├─ scenegraph/
│   ├─ node.ts                    — Node = pure data; updateNode(node, frame)
│   ├─ control-node.ts            — ControlNode subset
│   ├─ sprite-node.ts             — SpriteNode subset; updateSpriteNode(...)
│   └─ animation.ts               — evaluateScalar / evaluateVector keyframes
├─ math/
│   ├─ matrix.ts                  — already function-friendly; expose as fns
│   ├─ bezier.ts                  — already pure
│   └─ bounding-box.ts            — split into rect / ellipse / path contributors (see §3.3)
├─ parse/
│   ├─ raw-types.ts               — JSON schema (no runtime)
│   ├─ parsed-types.ts            — internal types
│   ├─ animation.ts               — parseAnimation(raw, ctx) — the core orchestrator
│   ├─ layer-registry.ts          — registerLayerParser(ty, fn); core loops over registry
│   ├─ transform.ts               — parseTransform, parseScalarProperty, parseVectorProperty
│   ├─ layout-tree.ts             — reorderLayers (was _reoderLayers)
│   └─ raw-helpers.ts             — already pure
├─ layers/                        — *** each file is opt-in via register* ***
│   ├─ shape-layer.ts             — registerShapeLayer(reg); imports shape-rasterizer
│   ├─ text-layer.ts              — registerTextLayer(reg); imports text-rasterizer + text-layout
│   ├─ solid-layer.ts             — registerSolidLayer(reg)
│   └─ null-layer.ts              — registerNullLayer(reg)        (≈ 30 LOC; always-on candidate)
├─ shapes/                        — *** each shape primitive opt-in ***
│   ├─ shape-registry.ts          — registerShapePrimitive(reg, ty, fn)
│   ├─ rectangle.ts
│   ├─ ellipse.ts
│   ├─ path.ts
│   ├─ fill.ts                    — solid + gradient (gradient gated by sub-flag, see §3.3)
│   ├─ stroke.ts                  — solid + gradient
│   └─ gradient.ts                — gradient stop math, only pulled by gradient-fill/stroke
├─ text/                          — *** entire folder opt-in ***
│   ├─ text-layout.ts             — ResolveLottieText, MeasureSpecLottieText
│   ├─ text-layout-babylon8.ts    — separate file so "babylon8" mode strips out
│   └─ text-rasterizer.ts         — drawText (Canvas2D)
├─ atlas/
│   ├─ types.ts                   — AtlasPage, SpriteAtlasInfo
│   ├─ create-atlas.ts            — createSpriteAtlas(engine, cfg)
│   ├─ pack.ts                    — packShape(atlas, drawFn, bbox)  ← generic; no per-shape knowledge
│   ├─ rasterize-shape.ts         — orchestrator; calls shape-registry entries
│   ├─ extrude-edges.ts
│   └─ upload.ts                  — updateAtlasTextures(atlas)      (touches ThinEngine — replaceable)
├─ render/                        — *** thin layer over Babylon (replaceable) ***
│   ├─ engine.ts                  — createEngine(canvas, cfg)
│   ├─ sprite-renderer.ts         — uses ThinSprite / SpriteRenderer wrapper
│   └─ frame-loop.ts              — startRenderLoop, tickFrame
├─ transport/                     — *** worker vs main, per-entry ***
│   ├─ types.ts                   — shared message contracts
│   ├─ local.ts                   — createLocalTransport()  (zero worker import)
│   ├─ worker-host.ts             — createWorkerTransport() (lives in main thread; imports worker URL)
│   ├─ worker-entry.ts            — runs inside the worker; calls registerXxx() itself
│   └─ blob-wrapper.ts            — moved from src/blobWorkerWrapper.ts
└─ entries/
    ├─ full.ts                    — convenience: registers every layer + every shape primitive + text
    ├─ minimal.ts                 — registers only null + solid + rectangle/ellipse + flat fill
    └─ shapes-only.ts             — null + solid + every shape primitive (no text)
```

### 3.3 Registries (the heart of tree-shaking)

```ts
// parse/layer-registry.ts
export type LayerParser = (
  layer: RawLottieLayer,
  ctx: ParseContext,
  parent: Node
) => Node | undefined;

export interface LayerRegistry {
  parsers: Map<number, LayerParser>;     // keyed by Lottie `ty`
}

export function createLayerRegistry(): LayerRegistry { ... }
export function registerLayerParser(reg: LayerRegistry, ty: number, fn: LayerParser): void { ... }
```

```ts
// layers/shape-layer.ts
import { registerLayerParser } from "../parse/layer-registry.js";
import { rasterizeShapes } from "../atlas/rasterize-shape.js";
// imports SHAPE registry indirectly via the rasterizer
export function registerShapeLayer(reg: LayerRegistry, shapes: ShapeRegistry): void {
  registerLayerParser(reg, 4, (layer, ctx, parent) => parseShapeLayer(layer, ctx, parent, shapes));
}
```

```ts
// shapes/shape-registry.ts
export type ShapeDrawer = (shape: RawShape, bbox: BoundingBox, ctx: DrawingContext) => void;
export interface ShapeRegistry {
  draw: Map<string, ShapeDrawer>;          // "rc" rect, "el" ellipse, "sh" path, "fl" fill, "st" stroke, "gf" gradient fill, "gs" gradient stroke
  bbox: Map<string, BBoxContributor>;
}
```

The orchestrator (`parse/animation.ts`) accepts a `LayerRegistry` and walks
the layers. It has zero `switch (layer.ty)` of its own and zero direct
import of any layer/shape/text module. **That is what unlocks shaking.**

`bounding-box.ts` (today 339 LOC) is split: each shape primitive owns its
own contributor function and registers it. The generic bbox accumulator
only knows "give me a contributor for this shape type."

### 3.4 Node hierarchy without inheritance

Today: `Node` (513 LOC) → `ControlNode`, `SpriteNode`. The base class
contains opacity inheritance, null-layer special-casing, animation array
storage, etc. Many sprites have no animations and no parent.

New shape:

```ts
export interface Node {
  readonly _id: string;
  readonly _kind: "control" | "sprite" | "null";
  _parent?: Node;
  _children: Node[];

  // transforms — always present
  _position: Vector2Property;
  _rotation: ScalarProperty;
  _scale: Vector2Property;
  _opacity: ScalarProperty;
  _worldMatrix: Mat;
  _localMatrix: Mat;
  _globalMatrix: Mat;

  // optional, populated only when needed
  _animations?: ((frame: number) => boolean)[];
  _isVisible: boolean;
}
export interface SpriteNode extends Node { _sprite: ThinSprite; _origW: number; _origH: number; }
```

All behavior in standalone functions: `updateNode(node, frame)`,
`getNodeOpacity(node)`, `appendChild(parent, child)`, etc. The `null`
kind avoids the `_isNullLayer` boolean by checking `_kind === "null"`,
which the bundler can constant-fold per call site if needed.

### 3.5 Worker vs main-thread

Two entry points; **importing one must not pull the other**:

```ts
// src/local.ts          ← public sub-entry "@babylonjs/lottie/local"
export { createLocalLottiePlayer } from "./core/create-player.js";
// internally uses transport/local.ts → render/* directly. Zero worker code.

// src/worker.ts         ← public sub-entry "@babylonjs/lottie/worker"
export { createWorkerLottiePlayer } from "./transport/worker-host.js";
// uses `new URL("./worker-entry.js", import.meta.url)` so bundlers
// emit the worker chunk only when this file is imported.
```

`package.json` exports map:
```json
"exports": {
  ".":        { "import": "./dist/index.js" },
  "./local":  { "import": "./dist/local.js" },
  "./worker": { "import": "./dist/worker.js" },
  "./register/shapes": { "import": "./dist/registers/shapes.js" },
  "./register/text":   { "import": "./dist/registers/text.js" },
  "./register/full":   { "import": "./dist/registers/full.js" }
}
```

### 3.6 Public API after refactor

Minimal API a consumer writes:

```ts
import { createLocalLottiePlayer, registerShapesAll, registerNullLayer }
  from "@babylonjs/lottie/local";

const player = await createLocalLottiePlayer({
  container,
  animationSource: url,
  // explicit feature opt-in — no auto-registration anywhere
  register: (reg) => {
    registerNullLayer(reg);
    registerShapesAll(reg);                // shape layer + every primitive
    // intentionally NOT calling registerText() / registerSolid()
  },
});
await player.play();
// ...
player.dispose();
```

"Full" preset for migration ease:

```ts
import { createLocalLottiePlayer, registerFull } from "@babylonjs/lottie/local";
await createLocalLottiePlayer({ container, animationSource: url, register: registerFull });
```

### 3.7 Side-effect freedom (Pillar 4)

- No module may instantiate `Map`/`Set`/`WeakMap` at module scope. All
  registries are created lazily by `createXxxRegistry()`.
- The current `import "core/Engines/Extensions/engine.alpha"` and
  `import "core/Shaders/sprites.vertex"` etc. are confined to
  `render/sprite-renderer.ts`, the single module any path needs. (They
  themselves are side-effectful; we cannot fix that here without touching
  core. Documented.)
- `package.json` will gain `"sideEffects": ["./dist/render/sprite-renderer.js"]`
  so bundlers preserve those imports but DCE everything else.

### 3.8 Preset taxonomy (ergonomics over the raw register API)

The per-feature `register*` surface is the foundation; on top of it we
ship a small set of curated presets so common cases stay one-liners.

| Preset | Includes | Excludes | Typical consumer |
|---|---|---|---|
| `registerFull` | every layer, every shape primitive, gradients, strokes, text (spec + babylon8) | — | Sandbox, Inspector, viewers, anyone showing arbitrary `.json` |
| `registerShapesAll` | null + solid + shape layers; rect + ellipse + path; flat fills/strokes; gradients | text | App showing designer-supplied shape animations |
| `registerShapesMinimal` | null + shape layers; rect + ellipse; flat fill only | gradients, strokes, paths, text, solid | UI micro-interactions |
| `registerShapesAndText` | `registerShapesAll` + text-layer + text-rasterizer + text-layout (spec) | babylon8 text compat | Marketing pages with typographic Lottie |
| `registerCompat8` | `registerFull` minus spec-only paths + babylon8 text + solid-as-unsupported semantics | — | Apps migrating from Babylon.js 8.x verbatim |

Presets are **just functions** that call the same `register*` primitives a
hand-written setup would. Importing `registerShapesMinimal` reaches only
the modules it actually calls, so the tree-shaker still does its job.

Auto-detection (`registerFromJson(reg, json)`) is intentionally **not**
shipped as a runtime helper: to detect any feature you must import every
detector, which defeats the whole exercise. Auto-detection is exposed
only as build-time analysis (§3.9).

### 3.9 Build-time analyzer + bundler plugins

The cleanest dev experience is: "I import the `.json`, I get a
ready-to-play function with the perfect register set baked in." This is
provided by an optional plugin package built on top of the runtime API —
nothing in the runtime depends on it.

#### Layout

```
packages/tools/lottie-build/
├── core/        @babylonjs/lottie-build-core   ← analyzer + codegen; zero bundler deps
├── plugin/      @babylonjs/lottie-build        ← single unplugin entry, all bundlers
└── (legacy alternative: per-bundler shells if we choose not to use unplugin)
```

`core/` exports two pure functions reusable everywhere (Node, browser,
tests, even runtime if a consumer really wants):

```ts
export interface LottieFeatureSet {
  layers: Set<1 | 3 | 4 | 5>;             // solid/null/shape/text
  shapes: Set<"rc" | "el" | "sh" | "fl" | "st" | "gf" | "gs">;
  hasGradients: boolean;
  hasStrokes: boolean;
  hasText: boolean;
  hasAnimatedProps: boolean;              // → include keyframe interpolators
  needsBabylon8Compat?: boolean;          // opt-in flag
}
export function analyzeLottieJson(json: unknown): LottieFeatureSet;
export function generateRegisterModule(
  features: LottieFeatureSet,
  jsonImportPath: string,
  opts?: { player?: "local" | "worker" }
): string;
```

The analyzer is ~200 LOC of "walk and classify" — much smaller than the
parser because it doesn't materialize anything.

#### Bundler integrations via `unplugin`

We ship a single `unplugin` definition and get Vite, Rollup, webpack 5,
esbuild, Rspack, Parcel, Nuxt, and Astro from the same code:

```ts
import { createUnplugin } from "unplugin";
import { analyzeLottieJson, generateRegisterModule } from "@babylonjs/lottie-build-core";

export default createUnplugin(() => ({
  name: "babylonjs-lottie",
  resolveId(id) { if (/\.json\?lottie(&|$)/.test(id)) return id; },
  async load(id) {
    if (!/\.json\?lottie/.test(id)) return;
    const file = id.split("?")[0];
    this.addWatchFile(file);
    const json = JSON.parse(await fs.readFile(file, "utf8"));
    return generateRegisterModule(analyzeLottieJson(json), file);
  },
}));
```

Consumer-side syntax is identical across every bundler:

```ts
import { play } from "./assets/hero.json?lottie";
await play(container);
```

Generated module (illustrative; uses sub-path imports so DCE is
guaranteed):

```ts
import { createLocalLottiePlayer } from "@babylonjs/lottie/local";
import { registerNullLayer } from "@babylonjs/lottie/local/layers/null";
import { registerShapeLayer } from "@babylonjs/lottie/local/layers/shape";
import { registerRectangle } from "@babylonjs/lottie/local/shapes/rectangle";
import { registerEllipse } from "@babylonjs/lottie/local/shapes/ellipse";
import { registerFlatFill } from "@babylonjs/lottie/local/shapes/fill";
import data from "./hero.json";

export async function play(container, opts = {}) {
  return await createLocalLottiePlayer({
    container,
    animationSource: data,
    register: (reg) => {
      registerNullLayer(reg);
      registerShapeLayer(reg);
      registerRectangle(reg);
      registerEllipse(reg);
      registerFlatFill(reg);
    },
    ...opts,
  });
}
```

#### Bundler-specific notes

| Bundler | How it picks up the plugin | Caveats |
|---|---|---|
| Vite | `plugins: [babylonLottie.vite()]` | HMR works via `addWatchFile` automatically. |
| Rollup | `plugins: [babylonLottie.rollup()]` | Same code path as Vite. |
| webpack 5 | `plugins: [babylonLottie.webpack()]` | Consumer needs production mode (or `usedExports: true`) for tree-shaking — same as any other shake-friendly package. webpack 4 not supported (EOL). |
| esbuild | `plugins: [babylonLottie.esbuild()]` | Direct hook analog. |
| Rspack | `plugins: [babylonLottie.rspack()]` | Uses webpack-compatible loader API. |

Sub-path exports (`@babylonjs/lottie/local/shapes/rectangle`) must be
declared in our `exports` map. webpack 5+, Rollup, Vite, esbuild, Rspack,
and Parcel 2 all honor them.

#### Plugin extras (post-MVP)

- **Build-time validation**: if `analyzeLottieJson` finds an unsupported
  feature, emit a build error instead of a runtime warning.
- **Multi-asset union**: when several `?lottie` imports share a chunk,
  union their feature sets so the register modules dedupe.
- **Bundle-size report**: log `hero.json → shape-only profile, +12 KB gz`.
- **Asset slimming** (opt-in, destructive): strip unsupported fields and
  dead keyframes from the embedded JSON to shrink payload.

#### Runtime fallback

For dynamic / user-uploaded animations where build-time analysis is
impossible, consumers fall back to:

- `registerFull` (one import, ships everything), or
- a `dynamicRegister(reg, json)` helper provided **only** in a separate
  sub-entry (`@babylonjs/lottie/dynamic`) that pulls every detector +
  every feature module behind dynamic `import()`. Largest-flexibility
  path; ships zero bytes unless that sub-entry is imported.

---

## 4. Bundle outcomes (projected)

Rough byte estimates from current LOC, before/after gzip, **excluding
Babylon `ThinEngine` & sprite shader chunks (untouched)**:

| Scenario | Modules pulled (approx) | Status quo | After refactor |
|---|---|---:|---:|
| Shapes only (rect + fill), no animations, single layer | core + parse-min + null/solid/shape layers + rect + flat-fill + atlas + render | ~5.4k LOC | ~1.6k LOC |
| Shapes + ellipse + path + stroke | + ellipse + path + stroke | ~5.4k LOC | ~2.4k LOC |
| Above + gradients | + gradient | ~5.4k LOC | ~2.7k LOC |
| Above + text | + text-layout (spec only) + text-rasterizer | ~5.4k LOC | ~3.7k LOC |
| Above + babylon8 text compat | + text-layout-babylon8 | ~5.4k LOC | ~4.0k LOC |
| Full + worker transport | + worker entry + blob wrapper + message types | ~5.4k LOC | ~5.4k LOC |

The "full + worker" line is intentionally near today's size — anyone who
needs every feature pays the same. The win is for the long tail of
animations that only need a subset.

---

## 5. Migration plan (phased)

Each phase is independently shippable, with the existing class API
removed only at the end.

### Phase 0 — Skeleton & contracts (no behavior change)
- Create `core/`, `parse/`, `layers/`, `shapes/`, `text/`, `atlas/`,
  `render/`, `transport/`, `config/`, `scenegraph/` subfolders.
- Add registry types (`LayerRegistry`, `ShapeRegistry`) as pure data.
- Add empty `registerXxx` placeholders.
- Existing classes keep working; new APIs are not wired yet.

### Phase 1 — Configuration & math
- Move `animationConfiguration.ts` → `config/`; flip `UpdateConfiguration`
  to `resolveConfiguration`.
- Move `maths/` → `math/`; convert `ThinMatrix` from class to
  `Mat = Float32Array` + standalone fns (`matIdentity`, `matMultiply`,
  `matDecompose`). Keep one wrapper-class compatibility shim during the
  transition, deleted at end of Phase 5.
- Split `boundingBox.ts` per shape primitive.

### Phase 2 — Scenegraph
- Convert `Node`/`ControlNode`/`SpriteNode` to pure-data + fns.
- Move animation evaluation (`_animationsFunctions` array) into a
  dedicated `scenegraph/animation.ts` module.

### Phase 3 — Parsing via registries
- Move transform/property parsers to `parse/transform.ts`.
- Split each `_parseXxxLayer` from `parser.ts` into its own
  `layers/<name>-layer.ts` with a `registerXxxLayer(reg)`.
- Same for shapes: each primitive into `shapes/<name>.ts` with
  `registerXxx(shapeReg)`.
- `parse/animation.ts` becomes the orchestrator; it accepts
  `LayerRegistry` + `ShapeRegistry` and has zero per-feature `switch`.
- Text isolated under `text/`, registered via `registerTextLayer` only.
  `babylon8` compat in its own file.

### Phase 4 — Rendering & atlas
- Split `SpritePacker` into `atlas/*` (generic packing + Canvas2D draw
  dispatch) and `render/sprite-renderer.ts` (Babylon-side upload + draw).
- `atlas/rasterize-shape.ts` calls into the `ShapeRegistry` — no direct
  knowledge of rect/ellipse/path/text.

### Phase 5 — Transport & entries
- Split `Player`/`LocalPlayer` into `transport/local.ts` + `transport/worker-host.ts`.
- `worker-entry.ts` registers full feature set inside the worker (worker
  consumers presumably want flexibility; document a way to override).
- Wire `package.json` `exports` map for sub-entries.
- Add `sideEffects` declaration.

### Phase 6 — Breaking-change removal
- Delete `Player`, `LocalPlayer`, the old `index.ts` exports.
- Update CHANGELOG with migration recipes (replacement snippets for the
  two old class APIs).
- Update demos/devhost consumers (`packages/tools/devHost`, etc.).
- Update `packages/dev/lottiePlayer/test/unit/**` to exercise the
  functional API; add a tree-shaking smoke test that asserts certain
  imports do not pull `text/` modules (using a bundler-level fixture).

---

## 6. Risks & open issues

1. **Compatibility option discovery.** Today `compatibility.solidLayerRendering = "babylon8"`
   simply suppresses solid layers. After refactor, the consumer chooses
   *whether to register* the solid layer; the "babylon8" flag becomes
   "don't call `registerSolidLayer()`." We should still expose a config
   field so a runtime preset can hide it without an import-time decision.
2. **Worker preset.** The worker can't easily be told at construction
   which features to register (the consumer is on the main thread). Three
   options: (a) worker always registers "full" — simplest, accepts the
   byte cost inside the worker bundle only; (b) consumer passes a string
   list of feature ids in the init message and worker dynamic-imports;
   (c) worker entry file is generated from the consumer's set. Plan: ship
   (a), document (b) as a follow-up. Either way, the *main* bundle stays
   shake-friendly because only the worker URL is referenced.
3. **`ThinSprite`/`SpriteRenderer` import chain.** Even the slimmest
   profile must register the sprite shader, so `core/Shaders/sprites.*`
   side-effects always ship. Out of scope; flagged as a future Babylon-Lite
   replacement.
4. **`SpritePacker.releaseCanvas` + GC reset (`this._packer = undefined as any`).**
   In the functional version, the parser fn just stops referencing the
   atlas — natural lifetime. Need a unit test confirming raw-JSON memory
   is collectable after parse.
5. **`Node` class field `_animationsFunctions: ((frame: number) => boolean)[]`.**
   This is fine as-is; we keep an array of closures. Property-animation
   evaluators (`evaluateScalarProperty`, `evaluateVectorProperty`)
   themselves should be tree-shakable per-property-type so static-only
   properties don't drag in keyframe interpolation.
6. **Public-facing types.** `RawLottieAnimation` is exported today. Stays
   exported (zero runtime). The other public surface — config types — also
   stays.
7. **Tests today exist only under `test/unit/`** (see `list_dir`). Each
   converted module needs a Vitest spec; the refactor is a good moment
   to add a bundle-size regression check.

---

## 7. Concrete next step

Once you sign off on this plan, I'll start with **Phase 0 + Phase 1**:

- Create the new folder skeleton (empty files with the contracts in
  §3.2/§3.3).
- Move config + math + bbox split into their final form behind a thin
  adapter so existing code keeps compiling.
- Add a `__tests__/bundle-shaking.spec.ts` placeholder that will gate the
  later phases.

No public-API change in those two phases — the breaking removal lands in
Phase 6 once every consumer in this monorepo has been migrated to the
functional API.

Specific questions I'd like resolved before Phase 0:

1. **Confirm worker preset choice** — ship the worker as "full" initially?
2. **`@babylonjs/lottie` sub-entry naming** — is `./local` / `./worker`
   acceptable? Some monorepo tooling prefers explicit filenames
   (`./dist/local.js`). I'll match whatever pattern other Babylon packages
   use; let me know if there's a precedent.
3. **Tree-shaking smoke test mechanism** — OK to add a Rollup-based
   fixture under `test/bundle-size/` that builds a tiny consumer and
   asserts on chunk contents? Or do you prefer relying on the existing
   `scripts/treeshaking/` harness used by `@babylonjs/core`?
