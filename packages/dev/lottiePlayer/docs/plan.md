# Lottie Player Functional Tree-Shaking Plan

## Status

This document is the canonical plan for moving `packages/dev/lottiePlayer` toward a Babylon-Lite-style architecture. It supersedes the exploratory notes in `findings_gpt.md`, `findings_opus.md`, and `findings_comparison.md` for implementation planning.

The plan combines:

- the safe incremental migration and runtime feature detection from `findings_gpt.md`,
- the explicit feature registry, sub-entry packaging, presets, and build-time plugin ideas from `findings_opus.md`, and
- the synthesized direction from `findings_comparison.md`.

## Scope

In scope:

- Lottie package-owned parsing, feature detection, atlas preparation, text/shape/solid handling, node graph evaluation, player orchestration, worker/local transport organization, and public/internal API shape.

Out of scope for this plan:

- Replacing Babylon rendering primitives. The current renderer may continue using `ThinEngine`, `ThinSprite`, `SpriteRenderer`, dynamic textures, and sprite shaders behind a quarantined adapter. That backend can be replaced later without changing the parser/runtime architecture.

## Non-Negotiable Goals

1. **Pay for what the animation uses.** An animation with no text must not fetch or execute text parsing, text layout, text measurement, or text rasterization code.
2. **Worker is the production path.** Worker and local playback must support the same feature-loading model. The local player is a debugging convenience, not the reduced-capability path.
3. **No day-one public API break.** Keep `Player` and `LocalPlayer` working during the migration. Add functional APIs alongside them later.
4. **No hidden feature side effects.** Do not rely on `import "./feature"` to mutate global registries. Feature loading must be explicit in data flow.
5. **Plain data plus standalone functions.** Move internals away from class-owned behavior toward pure state objects, typed arrays where useful, and standalone functions.
6. **Renderer-agnostic parser/runtime.** Parsing should produce plain animation and sprite data. The Babylon renderer should be an adapter, not a dependency of parsing.
7. **Measure runtime-fetched bytes.** Emitted-but-unfetched chunks are acceptable. Bundle tests should measure JS bytes actually loaded at runtime.

## Current Architecture Summary

The current Lottie player is a monolithic sprite-atlas renderer built around classes:

- `Player` manages worker playback, DOM canvas setup, resize, and messages.
- `LocalPlayer` manages main-thread playback.
- `AnimationController` creates `ThinEngine`, `SpritePacker`, `RenderingManager`, and `Parser`, then owns frame advancement and render-loop state.
- `Parser` walks raw Lottie layers, builds a class-based node tree, asks `SpritePacker` to rasterize sprites, and writes directly into `RenderingManager`.
- `SpritePacker` owns canvas atlas pages, rasterizes shapes and text into atlas textures, and uploads dynamic textures through Babylon core.
- `Node`, `ControlNode`, and `SpriteNode` form a mutable class hierarchy that owns animation state, matrices, parent/child relationships, and sprite updates.
- `RenderingManager` owns Babylon `SpriteRenderer` and ThinSprite batching.

This works, but parsing, rasterization, animation graph construction, and render registration are interleaved. That makes feature code hard to remove from bundles.

## Main Tree-Shaking Blockers

### Package-level side effects

`packages/dev/lottiePlayer/package.json` currently uses blanket side effects:

```json
"sideEffects": true
```

The target is a precise allow-list or `sideEffects: false` once Babylon rendering side-effect imports are quarantined.

### Rendering side-effect imports are too broad

Examples today:

- `rendering/animationController.ts` imports `core/Engines/Extensions/engine.alpha` and sprite shaders at module scope.
- `rendering/renderingManager.ts` imports `core/Engines/Extensions/engine.dynamicBuffer` and sprite shaders at module scope.
- `parsing/spritePacker.ts` imports `core/Engines/Extensions/engine.dynamicTexture` at module scope.

Parser, detection, feature, and data modules must not import these.

### Text is eagerly imported

`SpritePacker` imports text layout/rasterization helpers directly, and `boundingBox.ts` imports text layout helpers for `GetTextBoundingBox`. Therefore shape-only and solid-only animations still pay for text layout, fonts, wrapping, metrics, compatibility paths, and Canvas text drawing.

Text is the first and highest-value split.

### Shape rasterization is monolithic

`SpritePacker` contains atlas allocation, shape drawing, fills, strokes, gradients, text drawing, edge extrusion, and dynamic texture upload. This prevents text-only and solid-only animations from avoiding shape/path/gradient/stroke code.

### Parser hardcodes layer types

`Parser._parseLayer` directly handles solid, null, shape, and text. The parser should become a small feature dispatcher over parse state.

### Parser creates Babylon rendering objects

`Parser` imports `ThinSprite`, creates sprites, and calls `RenderingManager.addSprite`. Parsing should produce renderer-agnostic sprite records, and the Babylon adapter should translate those records into `ThinSprite` for now.

### Runtime graph is class-based

`Node`, `ControlNode`, and `SpriteNode` attach behavior through inheritance and methods. The target is plain graph data and standalone update/evaluation functions with typed-array track storage where it improves runtime behavior.

## Chosen Architecture

### Three feature-loading tiers

The final design should support three complementary ways to choose features:

1. **Runtime automatic feature loading by default.** The player scans raw Lottie JSON, detects required features, and dynamically imports them. This is the default for viewers, editors, Sandbox, and user-uploaded animations.
2. **Explicit feature override for advanced callers.** Callers may provide an explicit feature set or registry for SSR, tests, custom bundlers, or avoiding dynamic-import waterfalls.
3. **Build-time JSON analysis for static app assets.** A future `?lottie` plugin analyzes known JSON at build time and generates exact static imports/registration code.

Runtime automatic loading is not classic static tree-shaking; it is runtime pay-for-use through fetched chunks. That is the correct default metric for arbitrary Lottie playback.

### Feature detection model

Follow Babylon Lite's glTF loader pattern: cheap predicates plus dynamic imports.

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

Feature modules should export feature objects/functions. They must not mutate global registries at import time.

Compatibility participates in detection. For example, `needsSolidLayers` returns false when `compatibility.solidLayerRendering === "babylon8"`.

### Configuration is split for detection

Today's config is finalized inside `AnimationController` after `ThinEngine` is constructed, because `maxTextureSize` is read from engine caps. Feature detection must run *before* any renderer exists, so configuration is split into two layers:

- `LottieFeatureConfig` (engine-free): compatibility flags, loop, easing steps, stop frame, anything detection needs. Resolved synchronously from user input + defaults, with zero dependency on `ThinEngine`.
- `LottieRendererConfig` (engine-bound): atlas dimensions, device pixel ratio, anything that needs GPU caps. Resolved after engine creation.

Detectors only accept `LottieFeatureConfig`. The renderer-bound config is consumed later by the atlas/render layers.

### Side-effect allow-list (named)

The `package.json` `sideEffects` field is a precise allow-list with exactly **one** entry: the rendering side-effect shim.

- `rendering/babylonSideEffects.ts` — the **only** module allowed to import `core/Engines/Extensions/engine.alpha`, `core/Engines/Extensions/engine.dynamicBuffer`, `core/Engines/Extensions/engine.dynamicTexture`, and the sprite shader modules. Imported once by `rendering/babylonSpriteAdapter.ts`.
- Every other module in the package is treated as side-effect-free. Any new Babylon side-effect import must be added to this shim — never to a feature or parser module.

A lint rule (or Phase 1 exit check) enforces that no file outside `rendering/babylonSideEffects.ts` imports from `core/Engines/Extensions/*` or `core/Shaders/sprites.*`.

### Worker and local feature loading

Worker and local playback use the same feature detection and loading pipeline.

- If the worker fetches JSON from a URL, the worker detects features and dynamically imports required feature chunks inside the worker.
- If raw JSON is supplied by the main thread and passed to the worker, the worker can still run the same detection before parsing.
- Local debug playback runs the same detection/loading functions on the main thread.
- `preWarmPlayerAsync()` should initially prewarm core worker/runtime code only. A future option may accept a feature profile for prewarming text/shape/solid chunks.

Do not make the worker "full" by default. Production uses the worker, so the worker path must be as lean as the local path.

### Explicit features and registries

Internally, explicit registries are still useful. The automatic runtime path can detect and build them, while advanced/public APIs can eventually accept them directly.

```ts
interface LottieFeatureSet {
    layerHandlers: readonly LottieLayerFeature[];
    shapeHandlers: readonly LottieShapeFeature[];
    text?: LottieTextFeature;
}
```

This avoids global registration and keeps all feature choices explicit in function arguments.

### Parser output

The parser should output plain records, not Babylon objects:

```ts
type LottieSpriteRecord = {
    atlasIndex: number;
    uOffset: number;
    vOffset: number;
    uSize: number;
    vSize: number;
    width: number;
    height: number;
    nodeIndex: number;
    layerOrder: number;
};
```

The Babylon render adapter translates these into `ThinSprite` until the renderer is replaced.

### Public API strategy

Keep public classes initially:

- `Player`
- `LocalPlayer`

Internally, move them to wrappers around functional runtime state and functions. Later, add a functional public API alongside classes:

```ts
export async function createLottieAnimationAsync(input: LottieCreateOptions): Promise<LottieAnimationHandle>;
export function playLottieAnimation(handle: LottieAnimationHandle): void;
export function stopLottieAnimation(handle: LottieAnimationHandle): void;
export function disposeLottieAnimation(handle: LottieAnimationHandle): void;
```

Class deprecation/removal is optional and must be a separate future decision.

## Proposed Module Layout

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
    layers/
      nullLayer.ts
      solidLayer.ts
      shapeLayer.ts
      textLayer.ts
      textLayout.ts
    shapes/
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
  transport/
    workerHost.ts
    workerEntry.ts
    localTransport.ts
```

## Phased Implementation Plan

### Phase 0 - Baselines and fetched-byte harness

- Add fixture animations:
    - solid-only
    - shape-only
    - text-only
    - mixed solid + shape + text
    - no-text realistic fixture (pick a concrete existing fixture or pinned public CDN URL; do not leave "realistic" subjective)
- Capture a visual golden per fixture (worker and local paths) from current `main`. These goldens are the regression baseline for every later phase.
- Add a Playwright or Rollup/Vite harness that records runtime-fetched JS bytes for the root entry. Sub-entry measurements are added later when sub-entries land; the harness is designed for easy expansion.
- Assert feature chunks are not fetched when not needed (vacuously true today; the assertion shape is what matters).
- Keep existing unit and visual behavior green.

### Phase 1 - Isolate rendering side effects

- Create `rendering/babylonSideEffects.ts` as the single allow-listed module (see *Side-effect allow-list* above).
- Move every Babylon engine/shader side-effect import there.
- **Exit criterion (enforced)**: no file outside `rendering/babylonSideEffects.ts` imports from `core/Engines/Extensions/*` or `core/Shaders/sprites.*`. This is verified by a script/lint rule, not by inspection.
- Update `package.json` `sideEffects` to the precise allow-list.
- Without this exit criterion holding, the sub-entry split (new Phase 4) would not actually quarantine anything — Phase 1 is the prerequisite for everything that follows.

### Phase 2 - Split configuration

- Split `AnimationConfiguration` into `LottieFeatureConfig` (engine-free) and `LottieRendererConfig` (engine-bound). See *Configuration is split for detection*.
- Resolve `LottieFeatureConfig` synchronously up front; resolve `LottieRendererConfig` after engine creation as today.
- No detection or feature code added yet; this phase just preps the function signatures Phase 3 will consume.

### Phase 3 - Feature detection and dynamic loading infrastructure

- Add `detectLottieFeatures(raw, featureConfig)`.
- Add `loadLottieFeatures(raw, featureConfig)`.
- Add `parseAnimationAsync(raw, features, featureConfig, rendererConfig)`.
- **Detection/loader modules must not import anything from `transport/`** — this keeps the same pipeline reusable from both `./local` and `./worker` sub-entries (added in Phase 4) with zero refactor.
- **Worker dynamic-import spike** (mandatory sub-task before Phase 4): build a minimal worker that dynamic-imports one feature chunk and verify chunk emission + runtime fetch in **at least Vite and webpack 5**. If bundler chunk resolution fails inside the worker, fall back to: main thread detects → posts feature list → worker imports a generated bundle. The spike result determines whether the worker path uses the same detector or a generated entry. Do not start Phase 4 until this is decided.
- Keep existing `Player`/`LocalPlayer` wrappers.

### Phase 4 - Sub-entry packaging for local and worker

- Moved from its earlier position so it lands *after* Phase 1 (side effects quarantined) and Phase 3 (transport-agnostic loaders proven). Without those two, sub-entries shift code around without delivering bundle wins.
- Add `./local` and `./worker` sub-entries via `package.json` `exports`. Root exports stay unchanged for back-compat.
- Expand the Phase 0 fetched-bytes harness with one entry per sub-entry. Re-baseline.
- Verify local consumers do not pull the worker URL/chunk unless they import the worker path.
- Scope is exports map + harness expansion + smoke test. No consumer migration in this phase.

### Phase 5 - Extract text feature

- Move text parsing, layout, text bounding box, and text rasterization into a text feature under `features/layers/`.
- Remove text imports from `SpritePacker` and generic `boundingBox.ts`. **`GetTextBoundingBox` is deleted from `boundingBox.ts` and absorbed into the text feature** — the text feature owns text-layer bbox internally so no caller outside the feature ever needs it. Generic `boundingBox.ts` keeps only shape-primitive contributors.
- Preserve text compatibility behavior inside the text feature.
- Split Babylon 8 text compatibility into its own module/chunk if measurements justify it.
- Add tests proving non-text animations fetch **zero bytes** from text chunks (literal CI assertion, not just "tests prove").
- Text is extracted first because it is the only caller that crosses the bbox seam; doing other extractions first would force a more painful refactor here.

### Phase 6 - Extract solid feature

- Move CSS color parsing, solid atlas entry generation, and solid sprite record generation into a solid feature.
- Preserve center-UV solid sampling. (Link to the originating PR/commit when implementing so future maintainers know what they are preserving.)
- Gate on `compatibility.solidLayerRendering === "spec"`.
- Add tests proving Babylon 8 solid compatibility does not load solid feature chunks.

### Phase 7 - Extract shape feature

- Move shape-layer traversal and Canvas2D vector rasterization into a shape feature under `features/layers/` + `features/shapes/`.
- Keep atlas allocation generic: it allocates cells and exposes draw targets but does not know how to draw text or shapes.
- Add per-primitive/decorator sub-splits only when fetched-byte measurements justify them.

### Phase 8 - Retire the monolithic parser

- Once text/solid/shape extractions are complete, delete `parsing/parser.ts` (or what remains of it) and the `Parser` class.
- All layer-type dispatch lives in the feature loaders by this point; the lingering monolith only invites drift.
- Update `Player`/`LocalPlayer` wrappers to call `parseAnimationAsync` directly.

### Phase 9 - Pure-data node graph

- Replace `Node` / `ControlNode` / `SpriteNode` inheritance with plain graph data and a `_kind` discriminator.
- Replace method dispatch with standalone update functions.
- Mechanical, shape-only refactor. No storage-format change yet — `_animationsFunctions` closures are kept as-is.
- Gate: focused fixture visual goldens unchanged, unit tests pass.

### Phase 10 - Typed-array tracks (perf-gated)

- Replace `_animationsFunctions` closures with numeric track metadata and direct evaluators.
- Store keyframes/tracks in typed arrays for zero-allocation per-frame updates.
- **Perf gate**: measure per-frame allocations (Chrome DevTools allocation timeline or equivalent) before and after. If allocations do not drop materially on the mixed fixture, pause and reassess.
- This is structurally larger than the text/solid/shape extractions; keeping it separate from Phase 9 means a regression here does not block earlier wins.

### Phase 11 - Functional API alongside classes

- Add functional public API beside `Player` and `LocalPlayer`.
- Convert classes to thin wrappers around functional runtime state.
- Do not deprecate classes in this phase.

### Phase 12 - Build-time plugin

- Add a single `@babylonjs/lottie-build` package (using `unplugin` for Vite/Rollup/webpack/esbuild/Rspack).
- **No third package.** The build plugin depends directly on `@babylonjs/lottie`'s runtime detectors (`load/detectFeatures.ts`) — the same code the runtime auto-loader uses. The plugin only adds analyzer glue, code generation, and the bundler shim. This guarantees the runtime and the build-time analyzer can never drift apart.
- Support syntax such as:

```ts
import { play } from "./hero.json?lottie";
```

- Generated code imports exactly the needed features.

### Phase 13 - Optional class deprecation/removal

- Decide separately whether to deprecate or remove class wrappers.
- Only consider this after functional API, sub-entries, tests, docs, and monorepo consumers are migrated.

## Testing Strategy

### Unit tests

- Keep existing parser, text layout, bounding box, rendering manager, and configuration tests during migration.
- Add feature detection tests for text, solid, shape, gradients, strokes, and compatibility modes.
- Add tests for explicit compatibility defaults, including explicit `undefined` fields.

### Browser/integration tests

- Render solid-only, text-only, shape-only, and mixed fixtures.
- Verify first-frame readiness and nonblank canvas.
- For simple fixtures, sample known pixels.

### Bundle tests

Fixture-specific entries should assert runtime-fetched chunks:

- solid-only does not fetch text chunks.
- shape-only does not fetch text chunks.
- text-only does not fetch shape chunks once shape splitting lands.
- Babylon 8 solid compatibility does not fetch solid chunks.
- mixed fetches all required chunks.

## Measurement Gates

After each feature split, stop and measure:

- raw fetched JS bytes
- gzip fetched JS bytes
- worker path bytes
- local debug path bytes
- first-frame readiness timing if practical
- **focused visual goldens match pre-refactor baselines** within tolerance for fixtures affected by the phase, in both worker and local paths when the phase touches shared parsing/rasterization behavior
- per-frame allocations after Phase 10

If a split adds complexity without measurable runtime-byte or performance improvement, pause before continuing.

## Checklist: Adding a New Feature

When adding any feature module after Phase 3, all of the following must be done in the same PR:

1. Implement the feature module under `features/layers/` or `features/shapes/`.
2. Add the `[needs, () => import(...)]` tuple to the central feature-loader registry consumed by `loadLottieFeatures`.
3. Ensure the worker entry can reach the same feature-loader registry/chunk mapping so the worker bundle can resolve and fetch the new chunk. Easy to forget because worker chunk resolution is bundler-sensitive, even though the feature-loading capability must match local playback.
4. Add a fixture exercising the feature if no existing fixture covers it.
5. Add fetched-bytes assertions: feature chunks are fetched when the fixture needs them, and not otherwise.
6. Add or update focused visual goldens for the affected fixtures.

## Open Decisions

1. Final public functional API shape — settle in Phase 11 with a written API spec.
2. Exact sub-entry names and package export map — settle in Phase 4.
3. Bundle harness location: Lottie package-specific vs shared monorepo utility — settle in Phase 0.
4. Whether advanced explicit feature registries become public immediately or remain internal until the build plugin needs them — **default position: internal** until Phase 12 demonstrates concrete need. Public surface is forever.
5. Whether `preWarmPlayerAsync()` eventually accepts a feature profile — **defer**; today's prewarm targets engine boot, not feature code. Revisit only if a real use case appears.

## Recommendation

Use this combined path:

- runtime automatic feature detection by default,
- same feature loading in worker and local paths,
- explicit feature registries internally,
- build-time plugin later for static JSON and perfect bundles,
- no public API break until the functional API has proven itself.

The first implementation milestone should be baseline measurement plus text extraction. Text is the biggest low-risk win because non-text animations currently pay for text layout and Canvas text rasterization.