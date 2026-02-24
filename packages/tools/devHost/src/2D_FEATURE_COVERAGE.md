# 2D Engine Feature Coverage — Demo Games

This document tracks which engine features are exercised by each of the three demo games.

**Goal**: Every system should appear in at least 2 games to prove it works in different contexts.

---

## Feature Coverage Matrix

| Engine System | Side-Scroller | Isometric | Tactics | Status |
|---|---|---|---|---|
| **Scene2D** | ✅ | ✅ | ✅ | ✅ Full Coverage |
| **Node2D** | ✅ | ✅ | ✅ | ✅ Full Coverage |
| **Sprite2D** | ✅ | ✅ | ✅ | ✅ Full Coverage |
| **AnimatedSprite2D** | 🔲 | 🔲 | 🔲 | ⚠️ Not used yet |
| **Camera2D (follow)** | ✅ | — | — | ⚠️ Only 1 game |
| **Camera2D (pan/zoom)** | — | ✅ | 🔲 | ⚠️ Only 1 game |
| **Camera2D (design res)** | ✅ | ✅ | ✅ | ✅ Full Coverage |
| **InputMap2D** | ✅ | ✅ | ✅ | ✅ Full Coverage |
| **PlanckPhysicsEngine** | ✅ | 🔲 | — | ⚠️ Only 1 game |
| **Collision2D** | 🔲 | 🔲 | — | ⚠️ Not used yet |
| **StateMachine2D** | ✅ | 🔲 | ✅ | ✅ Full Coverage |
| **Grid2D** | — | 🔲 | ✅ | ⚠️ Only 1 game |
| **IsometricGrid** | — | ✅ | — | ⚠️ Only 1 game |
| **AStarPathfinder** | — | ✅ | ✅ | ✅ Full Coverage |
| **Tilemap2D** | 🔲 | ✅ | 🔲 | ⚠️ Only 1 game |
| **Tween / Easing** | 🔲 | ✅ | ✅ | ✅ Full Coverage |
| **Text2D** | ✅ | ✅ | ✅ | ✅ Full Coverage |
| **NineSliceSprite2D** | ✅ | 🔲 | ✅ | ✅ Full Coverage |
| **LightingManager2D** | ✅ | 🔲 | 🔲 | ⚠️ Only 1 game |
| **Particles2D** | 🔲 | 🔲 | 🔲 | ⚠️ Not used yet |
| **Audio** | 🔲 | 🔲 | 🔲 | ⚠️ Not used yet |
| **SceneTransition2D** | 🔲 | 🔲 | 🔲 | ⚠️ Not used yet |
| **SpriteSheet** | 🔲 | 🔲 | 🔲 | ⚠️ Not used yet |
| **Rectangle2D** | ✅ | 🔲 | 🔲 | ⚠️ Only 1 game |
| **ObjectPool** | ✅ | 🔲 | 🔲 | ⚠️ Only 1 game |
| **DebugRenderer2D** | ✅ | ✅ | ✅ | ✅ Full Coverage |
| **SpriteAtlasBuilder** | ✅ **NEW** | 🔲 | 🔲 | ⚠️ Only 1 game |

**Legend:**
- ✅ = Currently used
- 🔲 = Planned / should add
- — = Not applicable to this genre
- ⚠️ = Needs more coverage

---

## Coverage Summary

### ✅ Full Coverage (Used in 2+ games)
1. Scene2D (3/3)
2. Node2D (3/3)
3. Sprite2D (3/3)
4. Camera2D — design resolution (3/3)
5. InputMap2D (3/3)
6. StateMachine2D (2/3)
7. AStarPathfinder (2/3)
8. Tween/Easing (2/3)
9. Text2D (3/3)
10. NineSliceSprite2D (2/3)
11. DebugRenderer2D (3/3)

### ⚠️ Single Game Only (Needs 1 more)
1. Camera2D — follow (Side-Scroller only)
2. Camera2D — pan/zoom (Isometric only)
3. PlanckPhysicsEngine (Side-Scroller only)
4. Grid2D (Tactics only)
5. IsometricGrid (Isometric only)
6. Tilemap2D (Isometric only)
7. LightingManager2D (Side-Scroller only)
8. Rectangle2D (Side-Scroller only)
9. ObjectPool (Side-Scroller only)
10. **SpriteAtlasBuilder (Side-Scroller only)** ← NEW

### ⚠️ Not Used Yet
1. AnimatedSprite2D
2. Collision2D
3. Particles2D
4. Audio
5. SceneTransition2D
6. SpriteSheet (standalone usage)

---

## Priority Additions

To achieve full coverage, prioritize:

### Side-Scroller
1. **AnimatedSprite2D** — Player run/jump animations
2. **Particles2D** — Dust, impacts, dash effect
3. **SceneTransition2D** — Room transitions

### Isometric
1. **Physics** (or keep it intentional no-physics)
2. **NineSliceSprite2D** — Dialog boxes
3. **LightingManager2D** — Day/night cycle
4. **Particles2D** — Torches, magic effects
5. **SpriteAtlasBuilder** — Pack terrain and NPC sprites

### Tactics
1. **Camera2D pan/zoom** — Minimap or tactical overview
2. **Tilemap2D** — Map layers for varied terrain
3. **Particles2D** — Attack effects, spell casts
4. **LightingManager2D** — Spell glows, fire
5. **SpriteAtlasBuilder** — Pack unit classes and abilities

---

## Latest Update: SpriteAtlasBuilder Integration

**Date**: 2026-02-23

Added **SpriteAtlasBuilder** to the **Side-Scroller** demo:
- Packs 10 sprite types (terrain variants, player, enemy, collectible, bullet, parallax layers) into a single atlas
- Demonstrates runtime asset packing
- Reduces draw calls by enabling SpriteBatchRenderer batching
- Shows production-ready asset loading pattern

**Before**: ~1680 sprites, no shared texture
**After**: ~1680 sprites, all share 1 atlas texture (256×256 or similar)

See sideScroller/SPRITE_ATLAS_INTEGRATION.md for full details.

---

## Next Steps

1. **Expand SpriteAtlasBuilder** to Isometric and Tactics demos
2. **Add AnimatedSprite2D** to Side-Scroller (player run cycle)
3. **Add Particles2D** to all three demos (universal visual polish)
4. **Add Audio** to all three demos (SFX + music)
5. **Add SceneTransition2D** to Side-Scroller (room transitions)

---

**Maintained by**: 2D Game Developer Agent
**Last Updated**: 2026-02-23 20:26
