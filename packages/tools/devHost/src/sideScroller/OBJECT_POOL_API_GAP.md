# ObjectPool API Gap Report

**Game:** Side-Scroller (Metroidvania)  
**Feature implemented:** Bullet shooting system with ObjectPool  
**Date:** 2025-02-23  
**Status:** ✅ Working with workaround

---

## Summary

Successfully integrated `ObjectPool<T>` into the sidescroller demo for bullet management. The pool works correctly for:
- ✅ Creating bullets on-demand (factory)
- ✅ Resetting state (reset callback)
- ✅ Lifecycle hooks (IPoolable.onAcquire / onRelease)
- ✅ Pre-warming (prewarm)
- ✅ Max pool size enforcement
- ✅ Pool statistics (activeCount, freeCount, totalCreated)

**Result:** Zero-GC bullet shooting with visible pool stats in HUD.

---

## API Gap Discovered

### Missing: Iterate over active pooled objects

**What's needed:** A way to iterate over all currently active (acquired) objects in the pool.

**Current workaround:**  
We maintain a separate `activeBullets: IBullet[]` array alongside the pool, manually adding bullets on `acquire()` and removing on `release()`. This defeats part of the purpose of the pool abstraction.

**Why it's needed:**  
In game loops, we need to update all active pooled objects each frame:
```typescript
// Current workaround:
const { bulletPool, activeBullets } = createBulletPool(...);
// ...
bulletPool.acquire(); 
activeBullets.push(bullet); // Manual tracking

// Game loop:
for (const bullet of activeBullets) {
    bullet.update(dt);
}
```

**Suggested API shape:**
```typescript
class ObjectPool<T> {
    // Option A: Iterator
    public *activeObjects(): IterableIterator<T> {
        for (const obj of this._activeObjects) {
            yield obj;
        }
    }

    // Option B: forEach callback
    public forEachActive(callback: (obj: T) => void): void {
        for (const obj of this._activeObjects) {
            callback(obj);
        }
    }

    // Option C: Array getter (simplest, but exposes internals)
    public get active(): ReadonlyArray<T> {
        return Array.from(this._activeObjects);
    }
}

// Usage:
for (const bullet of bulletPool.activeObjects()) {
    bullet.update(dt);
}

// Or:
bulletPool.forEachActive(b => b.update(dt));
```

**Recommendation:** Option A (iterator) is most flexible and idiomatic TypeScript. Option B is functional style. Option C is simplest but creates a new array each call.

---

## Impact

**All 3 games would benefit:**
- ✅ **Side-Scroller:** Bullets, particle systems, enemy spawners
- ✅ **Isometric:** NPCs, loot drops, spell effects
- ✅ **Tactics:** Damage numbers, status effect icons, projectile abilities

Without iteration support, every game needs manual tracking arrays, which reduces the ergonomics of the pool API.

---

## Current Implementation Notes

The bullet system demonstrates all other pool features perfectly:

1. **Pre-warming:** `pool.prewarm(20)` allocates bullets upfront
2. **Factory:** Creates Sprite2D + physics body + light per bullet
3. **Reset:** Moves sprites offscreen, disables physics/lights
4. **IPoolable hooks:** `onAcquire()` / `onRelease()` automatically called
5. **Stats:** HUD shows `Pool: 3/20` (active / total created)
6. **Collision:** Bullets hit enemies and get released back to pool
7. **Lifetime:** Bullets expire after 2s and return to pool

The pool prevents GC spikes during rapid shooting, which is critical for 60fps gameplay.

---

## Recommendation for Feature Implementer

Add `activeObjects()` iterator or `forEachActive()` method to `ObjectPool<T>` class. This is a small addition that significantly improves API ergonomics for game developers.

See `packages/tools/devHost/src/sideScroller/main.ts` lines 720-825 for the full bullet pooling implementation.