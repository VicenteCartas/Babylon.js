# Lottie Player Functional Tree-Shaking Investigation

## Context

The goal is to move `packages/dev/lottiePlayer` toward the Babylon Lite architecture style: smaller runtime bundles, better tree-shaking, less object-oriented coupling, and feature code that is paid for only when an animation actually needs it.

I read the Babylon Lite guidance and source, especially `GUIDANCE.md`, `philosophy.md`, `docs/architecture/00-overview.md`, `docs/architecture/20-animation.md`, `docs/architecture/26-sprites.md`, and representative files such as `load-gltf.ts`, `gltf-feature.ts`, `animation/evaluate.ts`, `sprite-2d.ts`, and `sprite-renderer.ts`.

The relevant Lite principles are:

- Public and internal state should be plain data.
- Behavior should be standalone functions that accept state as input.
- Optional features should be detected cheaply and dynamically imported only when needed.
- Avoid hidden module-level side effects, global registration, and broad package side-effect flags.
- Validate bundle wins by measuring runtime-fetched bytes, not just emitted chunks.

## Current Lottie Architecture

The current Lottie player is a monolithic sprite-atlas renderer built around classes:

- `Player` manages worker playback, DOM canvas setup, resize, and messages.
- `LocalPlayer` manages main-thread playback.
- `AnimationController` creates `ThinEngine`, `SpritePacker`, `RenderingManager`, and `Parser`, then owns frame advancement and render-loop state.
- `Parser` walks raw Lottie layers, builds a class-based node tree, asks `SpritePacker` to rasterize sprites, and writes directly into `RenderingManager`.
- `SpritePacker` owns canvas atlas pages, rasterizes shapes and text into atlas textures, and uploads dynamic textures through Babylon core.
- `Node`, `ControlNode`, and `SpriteNode` form a mutable class hierarchy that owns animation state, world matrices, parent/child relationships, and sprite updates.
- `RenderingManager` owns Babylon `SpriteRenderer` and ThinSprite batching.

This design works, but parsing, rasterization, animation graph construction, and render registration are interleaved. That makes feature code hard to remove from bundles.

## Tree-Shaking Blockers

### Package-level side effects

`packages/dev/lottiePlayer/package.json` currently has:

```json
"sideEffects": true
```

That makes bundlers conservative. We should not simply flip it to `false` until rendering side-effect imports are isolated, but the end state should be either `sideEffects: false` or a precise allow-list for rendering-only setup modules.

### Babylon side-effect imports are broad

Examples:

- `rendering/animationController.ts` imports `core/Engines/Extensions/engine.alpha` and sprite shaders at module scope.
- `rendering/renderingManager.ts` imports `core/Engines/Extensions/engine.dynamicBuffer` and sprite shaders at module scope.
- `parsing/spritePacker.ts` imports `core/Engines/Extensions/engine.dynamicTexture` at module scope.

The rendering backend can remain Babylon-backed for now, but parser and feature modules should not import these side-effect modules.

### Text is always in the import graph

`SpritePacker` imports text helpers directly, and `boundingBox.ts` imports text layout helpers for `GetTextBoundingBox`. Any animation that uses the packer pays for text layout, font resolution, paragraph wrapping, tracking, baseline logic, compatibility logic, and drawing helpers even when there are no `ty: 5` text layers.

This is the highest-value first split.

### Shape rasterization is monolithic

`SpritePacker` contains atlas packing plus rectangle, ellipse, path, fill, stroke, gradient fill, gradient stroke, edge extrusion, text drawing, and dynamic texture upload. Text-only and solid-only animations still import path/gradient/stroke code.

Shape should eventually split into a shape feature, and later into smaller geometry/decorator features if bundle measurements justify it.

### Parser hardcodes layer types

`Parser._parseLayer` directly handles solid, null, shape, and text layers. Because these are methods on one class, bundlers cannot drop text parsing because a particular animation has no text. The parser should become a small feature dispatcher over plain parse state.

### Parser creates Babylon rendering objects

The parser imports `ThinSprite`, creates sprites, and calls `RenderingManager.addSprite`. That couples Lottie JSON parsing to Babylon rendering. Parsing should produce renderer-agnostic sprite records, and a Babylon render adapter should translate them to `ThinSprite` for now.

### Runtime animation graph is class-based

`Node`, `ControlNode`, and `SpriteNode` attach behavior through methods and inheritance. Each node can allocate closure arrays for animated properties. Lite's direction suggests plain state plus standalone functions for interpolation, graph updates, sprite syncing, reset, and visibility.

## Target Architecture

Keep the public API stable first. `Player` and `LocalPlayer` can remain public compatibility wrappers while the internals move to functions and plain data.

The target internal flow should be:

1. Fetch or receive `RawLottieAnimation`.
2. Resolve configuration.
3. Scan the raw animation once to detect features.
4. Dynamically import only required feature modules.
5. Parse into plain `LottieAnimationData`.
6. Rasterize required atlas entries through feature-provided atlas writers.
7. Create a Babylon-backed render adapter from plain sprite records.
8. Runtime loop calls standalone functions such as `advanceLottieFrame`, `updateLottieNodeTree`, `syncLottieSprites`, and `renderLottieFrame`.

### Feature loading model

Follow Babylon Lite's glTF pattern: explicit feature detectors and dynamic imports. Do not use side-effect registration.

```ts
type LottieFeatureLoader = [
    needs: (animation: RawLottieAnimation, config: ResolvedAnimationConfiguration) => boolean,
    load: () => Promise<{ default: LottieFeature }>,
];

const featureLoaders: LottieFeatureLoader[] = [
    [needsSolidLayers, () => import("./features/solidLayer")],
    [needsShapeLayers, () => import("./features/shapeLayer")],
    [needsTextLayers, () => import("./features/textLayer")],
];
```

Feature modules should export feature objects/functions. They should not mutate global registries at import time.

Compatibility should participate in detection. For example, if `solidLayerRendering === "babylon8"`, `needsSolidLayers` should return false so solid support is not fetched.

## Suggested Module Layout

```text
src/
  animationConfiguration.ts
  player.ts
  localPlayer.ts
  worker.ts
  load/
    getRawAnimationData.ts
    detectFeatures.ts
    loadFeatures.ts
    parseAnimation.ts
    parseState.ts
  features/
    feature.ts
    nullLayer.ts
    solidLayer.ts
    shapeLayer.ts
    textLayer.ts
    textLayout.ts
    shapeGeometryRect.ts
    shapeGeometryEllipse.ts
    shapeGeometryPath.ts
    shapeDecoratorFill.ts
    shapeDecoratorStroke.ts
    shapeDecoratorGradient.ts
  runtime/
    animationData.ts
    tracks.ts
    nodeTree.ts
    frame.ts
  atlas/
    atlasTypes.ts
    canvasAtlas.ts
    rasterTypes.ts
  rendering/
    babylonSpriteAdapter.ts
    babylonSideEffects.ts
```

## Migration Plan

### Phase 0 - Baseline and guardrails

- Add fixtures for solid-only, shape-only, text-only, mixed, and no-text animations.
- Measure worker and local-player bundle paths separately.
- Add a bundle harness that records chunks fetched at runtime.
- Keep existing unit and visual behavior green before refactoring.

### Phase 1 - Isolate rendering side effects

- Move Babylon engine/shader side-effect imports behind a rendering-only boundary.
- Ensure parser, feature detection, text layout, and data modules have no Babylon side-effect imports.
- Prepare package metadata to move away from blanket `sideEffects: true`.

### Phase 2 - Add async feature detection infrastructure

- Add `detectLottieFeatures(rawAnimation, config)`.
- Add `loadLottieFeatures(rawAnimation, config)` with dynamic imports.
- Add `parseAnimationAsync(rawAnimation, features, config)`.
- Keep `Player` and `LocalPlayer` public APIs stable. They are already async, so the internal parse can become async.

### Phase 3 - Extract text first

Text is the clearest and largest win.

- Move text parsing, text layout, text bounding box, and text rasterization into a text feature.
- Remove text imports from `SpritePacker` and generic `boundingBox.ts`.
- Preserve text compatibility behavior inside the text feature.
- Add tests proving non-text animations do not fetch/import the text feature.

### Phase 4 - Extract solid layer support

- Move CSS color parsing, solid atlas entry generation, and solid sprite record generation into a solid feature.
- Keep the recent center-UV sampling behavior.
- Gate the feature on `compatibility.solidLayerRendering === "spec"`.
- Add tests proving Babylon 8 compatibility does not import the solid feature.

### Phase 5 - Split shape support

- Move shape-layer traversal and Canvas2D vector rasterization into a shape feature.
- Keep the atlas allocator generic: it should allocate cells and expose drawing targets, but not know how to draw text or shapes.
- Later split shape internals into geometry and decorator modules if measurements justify it.

### Phase 6 - Convert node graph to plain data

- Replace `Node` / `ControlNode` / `SpriteNode` inheritance with plain graph data.
- Replace per-node method dispatch with standalone update functions.
- Replace `_animationsFunctions` closures with numeric track metadata and direct evaluators.
- Use scratch objects or typed arrays to avoid per-frame allocation.

Example direction:

```ts
export type LottieScalarTrack = {
    startValue: number;
    currentValue: number;
    keyframeOffset: number;
    keyframeCount: number;
    currentKeyframeIndex: number;
};

export function updateScalarTrack(track: LottieScalarTrack, keyframes: ScalarKeyframeData, frame: number): boolean;
export function updateNodeTree(data: LottieAnimationData, frame: number): void;
export function resetNodeTree(data: LottieAnimationData): void;
```

### Phase 7 - Add functional runtime APIs internally

Keep public classes as wrappers, but internally move toward:

```ts
export async function createLottieAnimationAsync(input: LottieCreateOptions): Promise<LottieAnimationHandle>;
export function playLottieAnimation(handle: LottieAnimationHandle): void;
export function stopLottieAnimation(handle: LottieAnimationHandle): void;
export function disposeLottieAnimation(handle: LottieAnimationHandle): void;
```

This allows an eventual public functional API without forcing that public API change in the first migration.

## Testing Strategy

### Unit tests

- Keep existing parser, text layout, bounding box, and rendering manager tests during migration.
- Add feature detection tests for text, solid, shape, gradients, and strokes.
- Add tests for explicit compatibility defaults, including explicit `undefined` fields.

### Integration tests

- Add browser tests for solid-only, text-only, shape-only, and mixed fixtures.
- Verify first-frame readiness and nonblank canvas.
- For simple fixtures, sample known canvas pixels.

### Bundle tests

Add fixture-specific browser entries and assert fetched chunks:

- `lottie-solid-only`
- `lottie-shape-only`
- `lottie-text-only`
- `lottie-mixed`

Assertions should prove:

- solid-only does not fetch text feature chunks.
- shape-only does not fetch text feature chunks.
- text-only does not fetch shape feature chunks once shape splitting lands.
- mixed fetches all required chunks.

## Risks

- Dynamic feature imports make parsing async. Public player APIs are already async, but tests and constructors need adaptation.
- Worker blob/chunk resolution must be verified. Worker feature chunks may need build support.
- Text depends on canvas metrics and fonts, so both main-thread and worker/offscreen paths need tests.
- Dynamic chunks may still be emitted by the build. That is fine if they are not fetched; tests must measure runtime fetches.
- Public API should stay stable at first. Treat this as an internal rewrite before exposing new functions.

## Open Questions

1. Should the public API remain class-first indefinitely, or should we add functional APIs once the internals are functional?
2. Should feature loading always be automatic from JSON detection, or should users be able to provide an explicit feature set for maximum bundle control?
3. Should omitted/disabled features warn, throw, or silently no-op? Current behavior tends toward warnings via `debug()`.
4. How important is worker bundle size compared with main-thread bundle size?
5. Should `preWarmPlayerAsync()` prewarm only core runtime code, or accept an optional feature profile?

## Recommendation

Do not attempt a full rewrite in one PR. Start with measurement and feature detection, then split text first. Text is the biggest low-risk win because non-text animations currently pay for text layout and Canvas text rasterization. After that, extract solid and shape support, then convert the runtime graph from classes to plain data plus standalone evaluators.

The long-term target is a renderer-agnostic Lottie parser/runtime that produces plain sprite and animation data, with the current Babylon sprite renderer kept behind an adapter until the rendering backend is replaced.