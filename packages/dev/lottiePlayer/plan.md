# Lottie Player Functional Tree-Shaking Plan

## Status

This document is the canonical plan for moving `packages/dev/lottiePlayer` toward a Babylon-Lite-style architecture. It supersedes the exploratory notes in `findings_gpt.md`, `findings_opus.md`, and `findings_comparison.md` for implementation planning.

The plan combines:

- the safe incremental migration and runtime feature detection from `findings_gpt.md`,
- the explicit feature registry, sub-entry packaging, presets, and build-time plugin ideas from `findings_opus.md`, and
- the synthesized direction from `findings_comparison.md`.

Implementation progress:

- Phases 0-9 are implemented.
- Phase 3 is implemented for the current wrapper architecture: `DetectLottieFeatures`, `LoadLottieFeatures`, and `ParseAnimationAsync` exist, and `Player`/`LocalPlayer` both route through the same dynamic feature-loading path before parsing.
- Phase 3 worker dynamic-import spike is complete: Vite/devhost worker playback fetches only the required feature chunks, and a temporary webpack 5 `target: "webworker"` spike emitted and runtime-fetched a dynamic import chunk from inside a worker.
- Phase 4 is implemented: `./local` and `./worker` sub-entries exist in the public/dev package export maps, the internal worker script moved to `workerEntry`, and the Phase 0 fetched-byte harness exercises the local and worker sub-entries.
- Phase 5 is implemented: text parsing, layout, bounding box, and rasterization live behind the dynamically loaded text feature; generic atlas/bounding-box code no longer imports text implementation code; non-text fetched-byte fixtures assert zero bytes from text feature chunks.
- Phase 6 is implemented: solid CSS color parsing, atlas cell generation, center-UV sprite creation, and compatibility-gated parsing live behind the dynamically loaded solid feature; Babylon 8 solid compatibility asserts zero bytes from solid feature chunks.
- Phase 7 is implemented: parsing and feature modules emit renderer-agnostic `LottieSpriteRecord`s and build the node graph; `SpriteNode` no longer takes a `ThinSprite` (it takes original dimensions plus an `attachSprite` hook); a single `rendering/babylonSpriteAdapter.ts` (`MaterializeSpriteRecords`) translates records into `ThinSprite`, attaches them, registers them, and finalizes the rendering manager. An exit-criterion test enforces that no module under `features/**` or `parsing/parser.ts` imports `core/Sprites/thinSprite` or calls `RenderingManager.addSprite`.
- Phase 8 is implemented: shape-layer traversal (`features/layers/shapeLayer.ts`) and Canvas2D vector rasterization (`features/shapes/drawShape.ts`) live behind the dynamically loaded shape feature, emitting `LottieSpriteRecord`s; `SpritePacker` keeps only generic cell allocation, page management, edge extrusion, and dynamic-texture upload (no shape/gradient/stroke drawing). The Phase 0 fetched-byte harness asserts both directions: shape-using fixtures fetch a non-trivial-byte `/features/shape` chunk, and shape-free fixtures fetch zero bytes from it.
- Phase 9 is implemented: the monolithic `parsing/parser.ts` and the `Parser` class are deleted. A standalone `parsing/buildAnimation.ts` (`BuildAnimation`) dispatches layers and returns `{ animationInfo, spriteRecords, diagnostics }`. The parser-feature callback inversion is gone: shared helpers now live in standalone modules (`parsing/nullLayer.ts`, `parsing/rasterization.ts`, `parsing/transform.ts`, `parsing/diagnostics.ts`) that both the dispatcher and the features import directly. A single `features/layerTypes.ts` `LayerTypeFeatureTable` is the one source of truth for `layerType -> featureId`, consumed by both `DetectLottieFeatures` and the dispatcher so detection and dispatch cannot drift. `GetRawAnimationDataAsync` moved to `parsing/rawAnimation.ts`; `LocalPlayer` and the worker import it from there. `ParseAnimation`/`ParseAnimationAsync` keep their signatures and now call `BuildAnimation` directly, emitting debug diagnostics when configured.

Phases 7 onward were re-sequenced after a review of the Phase 0-6 implementation. The renderer-agnostic sprite record was pulled forward to **Phase 7** (was deferred to old Phase 8+) so the largest feature, shape, is extracted renderer-agnostic from the start; shape extraction is now **Phase 8**. Later phases shifted by one. See the _Reality check before Phase 7_ note for rationale: the measurable bundle win for shape-free animations does not arrive until shape is extracted, because vector rasterization is still imported eagerly today.

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
type LottieFeatureLoader = [needs: (animation: RawLottieAnimation, config: ResolvedAnimationConfiguration) => boolean, load: () => Promise<{ default: LottieFeature }>];

const featureLoaders: LottieFeatureLoader[] = [
    [needsSolidLayers, () => import("./features/solidLayer")],
    [needsShapeLayers, () => import("./features/shapeLayer")],
    [needsTextLayers, () => import("./features/textLayer")],
];
```

Feature modules should export feature objects/functions. They must not mutate global registries at import time.

Compatibility participates in detection. For example, `needsSolidLayers` returns false when `compatibility.solidLayerRendering === "babylon8"`.

### Configuration is split for detection

Today's config is finalized inside `AnimationController` after `ThinEngine` is constructed, because `maxTextureSize` is read from engine caps. Feature detection must run _before_ any renderer exists, so configuration is split into two layers:

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

- Create `rendering/babylonSideEffects.ts` as the single allow-listed module (see _Side-effect allow-list_ above).
- Move every Babylon engine/shader side-effect import there.
- **Exit criterion (enforced)**: no file outside `rendering/babylonSideEffects.ts` imports from `core/Engines/Extensions/*` or `core/Shaders/sprites.*`. This is verified by a script/lint rule, not by inspection.
- Update `package.json` `sideEffects` to the precise allow-list.
- Without this exit criterion holding, the sub-entry split (new Phase 4) would not actually quarantine anything — Phase 1 is the prerequisite for everything that follows.

### Phase 2 - Split configuration

- Split `AnimationConfiguration` into `LottieFeatureConfig` (engine-free) and `LottieRendererConfig` (engine-bound). See _Configuration is split for detection_.
- Resolve `LottieFeatureConfig` synchronously up front; resolve `LottieRendererConfig` after engine creation as today.
- No detection or feature code added yet; this phase just preps the function signatures Phase 3 will consume.

### Phase 3 - Feature detection and dynamic loading infrastructure

- Add `DetectLottieFeatures(raw, featureConfig)`.
- Add `LoadLottieFeatures(raw, featureConfig)`.
- Add `ParseAnimationAsync(raw, features, featureConfig, rendererConfig)`.
- **Detection/loader modules must not import anything from `transport/`** — this keeps the same pipeline reusable from both `./local` and `./worker` sub-entries (added in Phase 4) with zero refactor.
- **Worker dynamic-import spike** (mandatory sub-task before Phase 4): build a minimal worker that dynamic-imports one feature chunk and verify chunk emission + runtime fetch in **at least Vite and webpack 5**. If bundler chunk resolution fails inside the worker, fall back to: main thread detects → posts feature list → worker imports a generated bundle. The spike result determines whether the worker path uses the same detector or a generated entry. Do not start Phase 4 until this is decided.
- Keep existing `Player`/`LocalPlayer` wrappers.

### Phase 4 - Sub-entry packaging for local and worker

- Moved from its earlier position so it lands _after_ Phase 1 (side effects quarantined) and Phase 3 (transport-agnostic loaders proven). Without those two, sub-entries shift code around without delivering bundle wins.
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

### Reality check before Phase 7 (read first)

Phases 5-6 extracted the **small** features. Solid color parsing and text layout are real wins for those specific animations, but they are not where most of the bundle lives. By code volume the dominant cost is still **shape vector rasterization** in `parsing/spritePacker.ts` (`_drawVectorShape`, `_drawRectangle`, `_drawEllipse`, `_drawPath`, `_drawFill`, `_drawStroke`, `_applyStrokeStyle`, `_drawGradient*`, plus the bezier math), and it is currently imported eagerly by the parser. Until Phase 7 lands, a solid-only or text-only animation still pays for all shape/path/gradient/stroke code.

Two consequences drive the re-sequencing below:

1. **Shape is the real byte win.** Do not treat Phases 5-6 as the payoff. The first measurable drop in fetched bytes for shape-free animations happens in Phase 7.
2. **The renderer seam must land before shape extraction, not after.** The features written so far (`solidLayer.ts`, `textLayer.ts`) bake in the Babylon renderer directly — they `new ThinSprite()` and call `renderingManager.addSprite(...)`, exactly like `Parser._parseShapes`. If shape is extracted the same way, the future lightweight renderer will have to rewrite every feature module. Introduce the renderer-agnostic sprite record (originally deferred to Phase 8+) as **new Phase 7**, retrofit solid/text onto it cheaply, and only then extract shape so the biggest feature is renderer-agnostic from day one.

### Phase 7 - Renderer-agnostic sprite records (new; was deferred to Phase 8+)

Pulled forward because every feature extracted after this point should emit plain data, and shape (Phase 8) is the largest such feature. Doing this after shape extraction would mean rewriting the shape feature a second time.

- Introduce `LottieSpriteRecord` (plain data: atlas index, UV offset/size, pixel width/height, center, layer order, invertV, and any center-UV sampling flags) and `atlas/rasterTypes.ts` for the rasterization callback contract.
- Parser and features produce `LottieSpriteRecord[]` plus the node graph. They no longer construct `ThinSprite` or call `RenderingManager.addSprite`.
- Add a single `rendering/babylonSpriteAdapter.ts` that translates `LottieSpriteRecord` into `ThinSprite` and registers them with `RenderingManager`. This is the only module that knows the current Babylon sprite API. The future lightweight renderer replaces just this adapter.
- Retrofit `solidLayer.ts` and `textLayer.ts` to emit records. Preserve solid center-UV sampling by carrying the offset adjustment in the record (link commit `89da7c8994` / PR #18402), not by touching `ThinSprite` directly.
- **Exit criterion (enforced)**: no file under `features/**` or `parsing/parser.ts` imports `core/Sprites/thinSprite` or references `RenderingManager.addSprite`. Verify by test, same shape as the Phase 1 side-effect check.
- Focused visual goldens for solid/text/mixed fixtures must be unchanged in both worker and local paths.

### Phase 8 - Extract shape feature

- Move shape-layer traversal and Canvas2D vector rasterization into a shape feature under `features/layers/` + `features/shapes/`. The shape feature emits `LottieSpriteRecord` from Phase 7 — it never sees `ThinSprite`.
- Keep atlas allocation generic: `SpritePacker` allocates cells and exposes draw targets but does not know how to draw text or shapes. Shape-specific drawing moves into the shape feature; the packer keeps only generic cell allocation, atlas page management, edge extrusion, and dynamic-texture upload.
- The empty `features/shape.ts` stub gets its real implementation here. Until now "detecting shape" loads a near-empty chunk; this phase moves the actual rasterization bytes behind that chunk.
- Add per-primitive/decorator sub-splits (rect/ellipse/path/fill/stroke/gradient) only when fetched-byte measurements justify them — do not pre-split speculatively.
- **Tests must assert moved bytes, not just chunk presence.** A shape fixture must fetch a distinct shape chunk URL whose JS bytes are non-trivial (i.e. the rasterizer actually moved), and a shape-free fixture must fetch zero bytes from that chunk. Asserting only that a shape-chunk URL appears would pass even if the chunk were a husk.

### Phase 9 - Retire the monolithic parser and the callback inversion

- Once text/solid/shape extractions are complete, delete `parsing/parser.ts` (or what remains of it) and the `Parser` class.
- All layer-type dispatch lives in the feature loaders by this point; the lingering monolith only invites drift.
- **Explicitly flatten the parser-feature callback inversion.** During Phases 5-8 the parser passes large context objects with callbacks (`parseNullLayer`, `getRasterizationFrame`, `getRasterizationScale`, `pushUnsupported`) into features that call back in. This circular coupling must not survive Phase 9. Move the shared helpers (null/anchor node construction, rasterization frame/scale, unsupported reporting) into standalone functions in `load/` or `runtime/` that both the dispatcher and features import directly — no callbacks passed through context.
- Layer detection and dispatch share one `layerType -> featureId` table (see _Single source of truth_ below) so the detector and feature handlers cannot drift.
- Update `Player`/`LocalPlayer` wrappers to call `ParseAnimationAsync` directly.

### Phase 10 - Pure-data node graph

- Replace `Node` / `ControlNode` / `SpriteNode` inheritance with plain graph data and a `_kind` discriminator.
- Replace method dispatch with standalone update functions.
- Mechanical, shape-only refactor. No storage-format change yet — `_animationsFunctions` closures are kept as-is.
- Gate: focused fixture visual goldens unchanged, unit tests pass.

### Phase 11 - Typed-array tracks (perf-gated)

- Replace `_animationsFunctions` closures with numeric track metadata and direct evaluators.
- Store keyframes/tracks in typed arrays for zero-allocation per-frame updates.
- **Perf gate**: measure per-frame allocations (Chrome DevTools allocation timeline or equivalent) before and after. If allocations do not drop materially on the mixed fixture, pause and reassess.
- This is structurally larger than the text/solid/shape extractions; keeping it separate from Phase 10 means a regression here does not block earlier wins.

### Phase 12 - Functional API alongside classes

- Add functional public API beside `Player` and `LocalPlayer`.
- Convert classes to thin wrappers around functional runtime state.
- Do not deprecate classes in this phase.

### Phase 13 - Build-time plugin

- Add a single `@babylonjs/lottie-build` package (using `unplugin` for Vite/Rollup/webpack/esbuild/Rspack).
- **No third package.** The build plugin depends directly on `@babylonjs/lottie`'s runtime detectors (`load/detectFeatures.ts`) — the same code the runtime auto-loader uses. The plugin only adds analyzer glue, code generation, and the bundler shim. This guarantees the runtime and the build-time analyzer can never drift apart.
- Support syntax such as:

```ts
import { play } from "./hero.json?lottie";
```

- Generated code imports exactly the needed features.

### Phase 14 - Optional class deprecation/removal

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

The fetched-byte harness must have **positive** teeth, not only negative ones. Asserting that an unneeded feature chunk contributes zero bytes is necessary but not sufficient: if a bundler inlines a feature into the main entry, the feature-chunk URL simply never appears, the zero-byte check stays vacuously green, and a regressed split passes. Every split therefore needs both directions:

Negative (chunk absent / zero bytes when not needed):

- solid-only does not fetch text chunks.
- shape-only does not fetch text chunks.
- text-only does not fetch shape chunks once shape splitting lands.
- Babylon 8 solid compatibility does not fetch solid chunks.

Positive (chunk present with non-trivial bytes when needed):

- text-only fetches a distinct text chunk whose JS bytes exceed a floor (proves the layout/rasterization code actually moved out of the main entry), in both worker and local paths.
- shape-only fetches a distinct shape chunk above a byte floor once Phase 8 lands.
- mixed fetches all required chunks, each above its floor.

Pick floors from the post-split baseline, not zero, so an accidental husk chunk fails the test.

## Measurement Gates

After each feature split, stop and measure:

- raw fetched JS bytes
- gzip fetched JS bytes
- worker path bytes
- local debug path bytes
- first-frame readiness timing if practical
- **focused visual goldens match pre-refactor baselines** within tolerance for fixtures affected by the phase, in both worker and local paths when the phase touches shared parsing/rasterization behavior
- per-frame allocations after Phase 11

If a split adds complexity without measurable runtime-byte or performance improvement, pause before continuing.

## Checklist: Adding a New Feature

When adding any feature module after Phase 3, all of the following must be done in the same PR:

1. Implement the feature module under `features/layers/` or `features/shapes/`.
2. Add the `[needs, () => import(...)]` tuple to the central feature-loader registry consumed by `LoadLottieFeatures`.
3. Ensure the worker entry can reach the same feature-loader registry/chunk mapping so the worker bundle can resolve and fetch the new chunk. Easy to forget because worker chunk resolution is bundler-sensitive, even though the feature-loading capability must match local playback.
4. Add a fixture exercising the feature if no existing fixture covers it.
5. Add fetched-bytes assertions in **both** directions: the feature chunk is fetched above a byte floor when the fixture needs it, and contributes zero bytes when it does not. A chunk-present-but-empty husk must fail.
6. Add or update focused visual goldens for the affected fixtures.
7. After Phase 7, the feature emits `LottieSpriteRecord` only — it must not import `core/Sprites/thinSprite` or call `RenderingManager.addSprite`.
8. Register the feature's layer type in the single `layerType -> featureId` table (see _Single source of truth_) rather than hardcoding the type number in the detector.

## Single source of truth: layer-type to feature mapping

The detector (`load/detectFeatures.ts`) currently hardcodes layer type numbers `1/4/5` while each feature module also declares `layerTypes`. That is two sources of truth for the same fact and reintroduces the "parser hardcodes layer types" anti-goal inside the detector. Consolidate into one `layerType -> featureId` table that both detection and dispatch consume, so a new feature is added in exactly one place and the two can never disagree. Solid's compatibility gate (`solidLayerRendering === "babylon8"` suppresses the solid feature) stays in the detector as a post-lookup filter, not as a second copy of the type number.

## Open Decisions

1. Final public functional API shape — settle in Phase 12 with a written API spec.
2. Exact sub-entry names and package export map — settle in Phase 4.
3. Bundle harness location: Lottie package-specific vs shared monorepo utility — settle in Phase 0.
4. Whether advanced explicit feature registries become public immediately or remain internal until the build plugin needs them — **default position: internal** until Phase 13 demonstrates concrete need. Public surface is forever.
5. Whether `preWarmPlayerAsync()` eventually accepts a feature profile — **defer**; today's prewarm targets engine boot, not feature code. Revisit only if a real use case appears.

## Recommendation

Use this combined path:

- runtime automatic feature detection by default,
- same feature loading in worker and local paths,
- explicit feature registries internally,
- build-time plugin later for static JSON and perfect bundles,
- no public API break until the functional API has proven itself.

The remaining implementation milestones, in order: land the renderer-agnostic sprite record (Phase 7) so no feature is bound to `ThinSprite`, then extract the shape feature (Phase 8) — the largest single bundle win, since shape-free animations still pay for all vector rasterization today. Solid and text (Phases 5-6) were the small, low-risk extractions; do not mistake them for the payoff.
