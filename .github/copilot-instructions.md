# Babylon.js Copilot Instructions

## Repository Overview

This is the **Babylon.js monorepo** (`@babylonjs/root`), a 3D rendering engine written in TypeScript. It uses **npm workspaces** with **Lerna** and **Nx** for orchestration. The repo contains the engine source, editor tools, and published packages.

Alongside it, the `BabylonDocumentation` directory contains the documentation website (Next.js/MDX).

## Golden Rules

All contributions must follow these inviolable rules:

1. **Never break backward compatibility** — existing APIs must continue to work
2. **Never degrade rendering performance** — every code path is performance-critical
3. **Keep APIs simple** — if a design feels complex, simplify it before shipping

## Build & Test Commands

### Build

```bash
npm run build:dev          # Build dev packages (most common during development)
npm run build:source       # TypeScript compilation only (faster, no assets)
npm run build:es6          # Build ES6 packages (libs + tools)
npm run build:umd          # Build UMD packages
```

### Test

```bash
# Unit tests (Jest)
npm run test:unit                                    # All unit tests
npx jest --selectProjects=unit -- --testPathPattern="babylon.mesh"  # Single test file pattern

# Visualization tests (Playwright)
npm run test:visualization                           # All visualization tests
npx playwright test -c ./playwright.config.ts --grep "TestName"  # Single visualization test

# Integration tests
npm run test:integration
```

### Lint & Format

```bash
npm run lint:check         # ESLint (uses flat config)
npm run format:check       # Prettier check
npm run format:fix         # Prettier auto-fix
```

### Dev Server

```bash
npm run start              # Watch mode + dev server (babylon-server)
npm run start:devhost      # Alternative dev host
```

## Monorepo Package Structure

Source code lives in `packages/` with three tiers:

- **`packages/dev/`** — Primary source packages (edit code here)
  - `core` — The engine: scene graph, rendering, math, physics, XR, etc.
  - `gui` — 2D GUI system
  - `loaders` — File format loaders (glTF, OBJ, STL, etc.)
  - `materials` — Material library
  - `serializers` — Scene serialization
  - `inspector` / `inspector-v2` — Debugging tools
  - `sharedUiComponents` — Shared React components for editors
  - `smartFilters` / `smartFilterBlocks` — Smart filter system

- **`packages/public/`** — Generated ES6 packages published to npm as `@babylonjs/*` (do not edit directly)

- **`packages/lts/`** — LTS versions of core packages (generated, do not edit directly)

- **`packages/tools/`** — Editor tools, test utilities, build plugins
  - `nodeEditor`, `guiEditor`, etc. — Visual editors
  - `tests` — Playwright visualization test infrastructure
  - `testTools` — Shared test utilities
  - `eslintBabylonPlugin` — Custom ESLint rules
  - `babylonServer` — Dev server for testing

## Import Conventions

### In source code (`packages/dev/`)

Use **relative imports** within the same package:

```typescript
import type { Nullable } from "../types";
import { Observable } from "../Misc/observable";
import { Vector3 } from "../Maths/math.vector";
```

Side-effect imports for extensions:

```typescript
import "./Extensions/engine.alpha";
```

### In test code

Use **path-alias imports** (mapped in tsconfig.json):

```typescript
import { NullEngine } from "core/Engines";
import { Scene } from "core/scene";
import { MeshBuilder } from "core/Meshes";
```

### Import rules (enforced by ESLint)

- **Never import from index files** — import from the specific module file
- **No cross-package relative imports** — use package aliases
- **No directory barrel imports** in dev packages — import specific files
- **Use `import type` for type-only imports** (enforced: `consistent-type-imports` with `separate-type-imports`)

## Naming Conventions (ESLint-enforced)

| Element | Convention | Example |
|---|---|---|
| Classes | `StrictPascalCase` | `class MeshBuilder` |
| Interfaces | `StrictPascalCase` with `I` prefix | `interface IMeshOptions` |
| Public members | `strictCamelCase` | `mesh.position` |
| Private/protected members | `strictCamelCase` with `_` prefix | `private _engine` |
| Public static members | `StrictPascalCase` or `UPPER_CASE` | `Mesh.FRONTSIDE` |
| Private static members | `StrictPascalCase`/`UPPER_CASE` with `_` prefix | `private static _DefaultValue` |
| Async functions/methods | Must end with `Async` suffix | `loadSceneAsync()` |
| Exported global const/function | `StrictPascalCase` | `export const CreateBox = ...` |
| Enum members | `StrictPascalCase` or `UPPER_CASE` | `TextureFormat.RGBA` |

Domain abbreviations (XR, PBR, HDR, GLSL, WGSL, GPU, LOD, etc.) are exempt from strict casing rules.

## Shader Files

- GLSL shaders: `packages/dev/core/src/Shaders/` (`.fragment.ts`, `.vertex.ts`)
- WGSL shaders: `packages/dev/core/src/ShadersWGSL/`
- Shader files are **auto-generated** from `.fx` source files — do not edit the `.ts` outputs directly
- Build shaders: `npm run build:shaders`

## Test Structure

### Unit tests (Jest)

- Location: `packages/dev/<package>/test/unit/`
- Naming: `babylon.<feature>.test.ts` (e.g., `babylon.mesh.bake.test.ts`)
- Tests mirror the source directory structure
- Test file pattern: `/test/unit/.*test\.[tj]sx?$/`

### Visualization tests (Playwright)

- Test configs: `packages/tools/tests/test/playwright/`
- Reference images: `packages/tools/tests/test/visualization/ReferenceImages/`
- Tests use minimal wrapper files that delegate to shared utility functions

## Documentation (JSDoc/TSDoc)

- All public classes, interfaces, methods, and properties **must** have JSDoc comments
- `@param` tags are required for function parameters
- `@returns` tags are required for functions with return values
- Getters don't need `@returns`; constructors don't need `@returns`

## GUI Controls

In `packages/dev/gui/src/2D/controls/`, `context.save()` must be called before `_applyStates()` (enforced by custom ESLint rule).

## Key Technical Details

- **Node.js**: >=20.11.0, <23.0.0
- **TypeScript**: ~5.9.x with strict settings (`strictNullChecks`, `noImplicitAny`, `noImplicitOverride`)
- **Prettier**: 4-space tabs, 180 char print width, ES5 trailing commas
- **`console.log` is forbidden** — only `console.time`, `console.timeEnd`, `console.trace` are allowed
- **No `.then()` on promises** — use `async`/`await` (enforced by `github/no-then`)
- **Curly braces always required** for control flow statements
