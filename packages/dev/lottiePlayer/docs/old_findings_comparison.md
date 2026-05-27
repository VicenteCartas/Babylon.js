# findings_opus vs findings_gpt — comparison

Two analyses, same goal (tree-shakable Lottie player aligned with
Babylon-Lite philosophy), notably different in how they get there. This
doc compares them axis-by-axis and proposes a synthesis.

## At-a-glance

| Axis | **findings_opus** | **findings_gpt** |
|---|---|---|
| Public API change | Breaking — drop `Player`/`LocalPlayer`, ship only functional API | Keep `Player`/`LocalPlayer` as compat wrappers; refactor internals |
| Feature opt-in mechanism | **Explicit** `register*(reg)` calls by consumer + presets + build-time plugin | **Automatic** — scan JSON, dynamic-import detected features |
| Side-effect strategy | Pure functions everywhere; `sideEffects` allow-list only for sprite shader module | Same end goal; cautions against flipping `sideEffects:false` until rendering is isolated |
| Sub-entry packaging | `./local`, `./worker`, `./register/*` exports map | Not addressed |
| Build-time JSON analysis | Yes — `unplugin` for Vite/Rollup/webpack/esbuild/Rspack; `?lottie` query | Not addressed |
| Node graph plan | Pure-data + functions, `_kind` discriminator, optional `_animations` | Same direction; explicitly proposes typed-array tracks for zero-alloc per-frame |
| Atlas/rasterizer | Shape registry indexed by Lottie shape `ty` (`rc`/`el`/`sh`/...) | Shape feature with possible later geometry/decorator split, gated by measurement |
| Bundle measurement | Projected LOC table; mentions tree-shake smoke test | Concrete fixture-driven harness measuring **runtime-fetched bytes** (matches Lite practice) |
| Compatibility (`babylon8`) | Separate file (`text-layout-babylon8.ts`) + preset (`registerCompat8`) | Detector folds compat into `needs*()` so unused branches never load |
| Worker handling | Sub-entries quarantine worker URL; worker auto-registers "full" (with future override) | Worker bundle measured separately; uncertain if worker chunk resolution needs build support |
| Phasing | 6 (or 8) phases, breaking change at end | 7 phases, all internal, no breaking change |
| Risk surface | Bigger PR end-to-end; consumers must migrate; richer dev-time ergonomics | Smaller incremental PRs; lower migration cost; ergonomics limited to "it just works" |

## Where each is stronger

### findings_opus is stronger on

1. **Dev ergonomics for app developers.** The `?lottie` + `unplugin`
   build path is genuinely novel for this package and gives the best
   possible bundle for the common "app ships a known JSON" case — with
   zero runtime detection cost and zero manual register list.
2. **Bundler portability.** Multi-bundler matrix and the `unplugin`
   choice are concrete shippable plans, not aspirations.
3. **Sub-entry packaging.** `./local` vs `./worker` is the cleanest way
   to keep the worker URL out of main-thread bundles. `findings_gpt`
   doesn't address this and would still ship worker code to LocalPlayer
   consumers.
4. **Preset taxonomy.** Named compositions of `register*` give the long
   tail of consumers (`registerShapesAll`, `registerCompat8`) a one-line
   on-ramp without losing shaking.
5. **Final-state clarity.** A specific functional API surface that the
   project converges on, instead of "wrappers indefinitely."

### findings_gpt is stronger on

1. **Automatic feature detection.** The dynamic-import-on-detect pattern
   means **viewers, editors, the Sandbox, and anyone playing
   user-uploaded animations** get the bundle win automatically — no
   manual `register*` enumeration, no build plugin required, no need to
   ship `registerFull`. This is a meaningful runtime-shake win that
   `findings_opus` only offers via a quarantined `@babylonjs/lottie/dynamic`
   sub-entry it didn't fully develop.
2. **Faithful mirror of the Babylon-Lite glTF feature pattern.** The
   `[needs(json), () => import(...)]` tuple registry comes straight from
   `load-gltf.ts` and is the proven Lite idiom. This is much closer to
   the patterns Lite already validates in production-equivalent code.
3. **Migration safety.** Keeping `Player`/`LocalPlayer` as wrappers
   throughout means every intermediate phase ships; no big-bang break.
   The breaking-change removal in opus's Phase 6 is the riskiest single
   step in that plan.
4. **Measurement discipline.** Calls out **fetched bytes** (matching
   Lite's bundle-size test in `tests/bundle-size.test.ts`) rather than
   emitted-chunk size or projected LOC. Emitted-but-unfetched chunks are
   fine; that's the right metric.
5. **Concrete fixtures.** Names them (`lottie-solid-only`,
   `lottie-shape-only`, `lottie-text-only`, `lottie-mixed`) and ties
   each to a bundle assertion. Less hand-wave than opus's smoke test.
6. **Compat-aware detection.** `needsSolidLayers` returns false when
   `solidLayerRendering === "babylon8"`. Cleaner than shipping a separate
   `registerCompat8` preset.
7. **Parser/renderer decoupling explicit.** Calls out that the parser
   currently constructs `ThinSprite` directly and proposes a
   renderer-agnostic sprite record + Babylon adapter. opus mentions
   render isolation but doesn't elevate this to a phase.
8. **Per-track typed-array storage** for zero-alloc frame updates is a
   real perf concern opus skipped over.

## Where they agree (no contest)

- Move from classes to pure-data + standalone functions.
- Split text out first; it's the biggest single win.
- Keep the Babylon rendering primitives (`ThinEngine`, `ThinSprite`,
  sprite shader imports) as a quarantined adapter for now.
- `package.json` `sideEffects` must be a precise allow-list, not blanket
  `true`/`false`.
- Compatibility (`babylon8`) lives in its own module so the spec path
  doesn't drag it in.

## Where they conflict, and which to pick

### 1. Explicit `register*` vs automatic detection

**Pick: automatic by default (gpt), explicit available (opus).**

- The Lite glTF pattern proves the automatic model works in a real
  shipping engine and gives runtime-shake wins to viewers/editors that
  the explicit model cannot.
- The detector functions themselves are tiny (`needsTextLayers = (j) => j.layers.some(l => l.ty === 5)`),
  and `[needs, load]` tuples are statically reachable but the *feature
  module* is dynamic-imported, so unused features cost only their tuple
  entry (~50 bytes) in the main bundle.
- Explicit `register*` then becomes an **opt-in performance / SSR
  override** for app authors who want zero dynamic-import waterfall:
  pass `{ features: [SolidFeature, ShapeFeature] }` instead of letting
  the player detect.
- The build-time `?lottie` plugin (opus §3.9) then becomes the **third
  tier**: it pre-resolves the feature set at build time and emits a
  module that imports each feature statically, eliminating both the
  dynamic import and the detector cost. Stacks cleanly on top.

### 2. Breaking public API vs compat wrappers

**Pick: compat wrappers through migration (gpt), evaluate breaking change later as a separate decision.**

- Keeping `Player`/`LocalPlayer` working through every phase decouples
  the architectural rewrite from the API-design discussion.
- Once the internals are pure-data + functions, adding a public
  functional API alongside the wrappers is one PR. Deprecating the
  wrappers is a separate PR done on its own timeline.
- This also de-risks Phase 6 in opus's plan, which is currently the
  whole-monorepo-consumer migration.

### 3. Sub-entries (`./local`, `./worker`)

**Adopt opus's approach.** gpt doesn't address it and the status quo
(`Player` importing `new URL("./worker", ...)`) means any consumer of
the package gets the worker bundle. Splitting into two sub-entries via
`exports` is mostly mechanical and a strict win regardless of which
feature-loading model we pick.

### 4. Build-time `unplugin` integration

**Adopt opus's §3.9 unchanged.** gpt doesn't conflict; it just doesn't
cover it. Worth shipping as its own package after the runtime is stable.

### 5. Node graph

**Adopt gpt's typed-array track storage.** opus's pure-data sketch is
fine but keeps closure arrays. gpt's explicit `LottieScalarTrack` +
`updateScalarTrack(track, keyframes, frame)` is what Lite's
`animation/evaluate.ts` actually does and avoids per-property closure
allocation.

### 6. Bundle measurement

**Adopt gpt's fetched-bytes harness.** Match Lite's
`tests/bundle-size.test.ts` style: Playwright intercepts network, sums
fetched JS, subtracts asset payloads. The projected-LOC table in opus
is a planning estimate; the fetched-bytes test is what we'd actually
gate CI on.

### 7. Compatibility (`babylon8`)

**Use gpt's detector approach** (`needsSolidLayers` returns false in
`babylon8` mode) as the primary mechanism, **plus** opus's split file
(`text-layout-babylon8.ts`) so even when the text feature loads, the
compat branch is its own dynamic-import sub-chunk. Belt and suspenders.

## Synthesized plan (recommended)

Take gpt's phasing as the spine (it's lower-risk, ships incrementally),
graft opus's packaging + build-plugin work onto the end.

```
Phase 0 — Baseline & guardrails                              [gpt]
  fixtures + fetched-bytes harness + keep existing tests green

Phase 1 — Isolate rendering side effects                     [gpt]
  move engine/shader side-effect imports behind render adapter
  parser/feature/data modules: no core/Engines/Extensions imports

Phase 2 — Detection + dynamic-load infrastructure            [gpt]
  detectLottieFeatures(raw, cfg)
  loadLottieFeatures(raw, cfg) -> dynamic imports
  parser becomes feature-driven

Phase 3 — Extract text feature (biggest win first)           [gpt]

Phase 4 — Extract solid feature                              [gpt]
  detector consumes compatibility.solidLayerRendering

Phase 5 — Extract shape feature                              [gpt]
  shape primitives sub-split if measurements justify
  (this is where opus's per-primitive registry can land
   internally; it doesn't have to be the public API)

Phase 6 — Pure-data node graph + typed-array tracks          [gpt]
  zero-alloc per-frame updates

Phase 7 — Sub-entry packaging                                [opus]
  @babylonjs/lottie/local  vs  @babylonjs/lottie/worker
  package.json exports map; sideEffects allow-list finalized
  (worker quarantine is independent of any earlier phase)

Phase 8 — Functional public API alongside classes            [opus]
  createLottieAnimationAsync(...) etc.
  classes become thin wrappers (still public)

Phase 9 — Build-time unplugin                                [opus §3.9]
  @babylonjs/lottie-build-core (analyzer + codegen)
  @babylonjs/lottie-build (unplugin for Vite/Rollup/webpack/esbuild/Rspack)
  import { play } from "./hero.json?lottie"

Phase 10 — (optional, separate decision)
  Deprecate / remove the class wrappers if/when consumers have migrated
```

This gives:

- **Runtime tree-shaking by default** (gpt's detection) — viewers,
  editors, and the Sandbox automatically pay only for what they render.
- **Build-time perfection** (opus's plugin) for app authors who want
  every byte stripped without dynamic-import waterfall.
- **Explicit override** (opus's `register*` API) for unusual cases
  (SSR, tests, custom bundlers).
- **Zero day-one breaking change** (gpt's wrappers) so PRs can land
  one-at-a-time without a flag day.

## Open items either plan still leaves unanswered

1. **Worker feature loading.** Both plans wave at this. We need to
   decide: worker auto-detects + dynamic-imports inside the worker, OR
   the main thread runs detection and sends the feature list to the
   worker, OR the worker just imports "full." Probably the first; needs
   a spike to confirm bundler chunk-resolution works inside the worker.
2. **Public functional API shape.** Both sketch it; neither commits.
   Should be settled in Phase 8 with a written API spec before any
   class deprecation is even considered.
3. **Fetched-bytes harness location.** Lite has its own; we can either
   port it into `packages/dev/lottiePlayer/test/bundle/` or share a
   harness across the Babylon.js monorepo. Either is fine; pick one
   before Phase 0 lands.
