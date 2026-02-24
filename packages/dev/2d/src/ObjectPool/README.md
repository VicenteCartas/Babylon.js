# ObjectPool

Generic object pool implementation to avoid GC spikes in action games.

## Overview

The `ObjectPool<T>` class provides a reusable pool of objects to minimize allocations during gameplay. This is particularly useful for frequently created and destroyed objects like bullets, particles, enemies, pickups, etc.

## Features

- **Generic**: Works with any object type
- **Factory pattern**: Provide factory and reset functions
- **Lifecycle hooks**: Optional `IPoolable` interface for `onAcquire()` and `onRelease()` callbacks
- **Capacity control**: Optional `maxPoolSize` to limit memory usage
- **Pre-warming**: Allocate objects upfront to avoid runtime spikes
- **Stats**: Track `activeCount`, `freeCount`, and `totalCreated` for debugging
- **Node2D integration**: Automatically removes nodes from parent on release

## Basic Usage

```typescript
import { ObjectPool } from "@babylonjs/2d";

// Define your object type
class Bullet extends Sprite2D {
    public velocity: Vector2 = Vector2.Zero();
    public damage: number = 10;
}

// Create a pool
const bulletPool = new ObjectPool({
    factory: () => new Bullet("bullet", scene),
    reset: (bullet) => {
        bullet.position.set(0, 0);
        bullet.velocity.set(0, 0);
        bullet.visible = false;
        bullet.rotation = 0;
    },
    maxPoolSize: 100,
    name: "BulletPool"
});

// Pre-warm the pool (optional)
bulletPool.prewarm(20);

// Acquire a bullet
const bullet = bulletPool.acquire();
bullet.position.copyFrom(player.position);
bullet.velocity.set(Math.cos(angle) * speed, Math.sin(angle) * speed);
bullet.visible = true;

// Release when done (e.g., on collision or out of bounds)
bulletPool.release(bullet);

// Clean up
bulletPool.dispose();
```

## IPoolable Interface

Objects can implement the `IPoolable` interface to receive lifecycle callbacks:

```typescript
import { ObjectPool, IPoolable } from "@babylonjs/2d";

class Enemy extends Sprite2D implements IPoolable {
    private _aiController: AIController;

    public onAcquire(): void {
        // Called when acquired from pool
        this._aiController.start();
        this.playAnimation("spawn");
    }

    public onRelease(): void {
        // Called when released to pool
        this._aiController.stop();
        this.playAnimation("death");
    }
}

const enemyPool = new ObjectPool({
    factory: () => new Enemy("enemy", scene),
    reset: (enemy) => {
        enemy.health = 100;
        enemy.visible = false;
    }
});
```

## Configuration Options

```typescript
interface IObjectPoolOptions<T> {
    // Required: Factory function to create new objects
    factory: () => T;

    // Required: Reset function called on release
    reset: (obj: T) => void;

    // Optional: Maximum pool size (unlimited if undefined)
    maxPoolSize?: number;

    // Optional: Name for debugging
    name?: string;
}
```

## API Reference

### Properties

- **`activeCount: number`** - Currently acquired objects
- **`freeCount: number`** - Available objects in pool
- **`totalCreated: number`** - Total objects ever created
- **`name: string`** - Pool name (for debugging)
- **`isDisposed: boolean`** - Whether the pool has been disposed

### Methods

- **`acquire(): T`** - Get an object from the pool (creates new if empty)
- **`release(obj: T): void`** - Return an object to the pool
- **`prewarm(count: number): void`** - Pre-allocate objects
- **`clear(): void`** - Remove all free objects (doesn't affect active)
- **`dispose(): void`** - Clean up and prevent further use

## Performance Tips

1. **Pre-warm during loading**: Allocate objects during level load, not during gameplay
2. **Set reasonable maxPoolSize**: Balance memory vs. allocation frequency
3. **Keep reset functions simple**: Complex reset logic can impact performance
4. **Track stats during development**: Monitor `activeCount` and `totalCreated` to tune pool size

## Example: Particle System

```typescript
class Particle extends Sprite2D {
    public velocity: Vector2 = Vector2.Zero();
    public lifetime: number = 0;
}

const particlePool = new ObjectPool({
    factory: () => new Particle("particle", scene),
    reset: (p) => {
        p.position.set(0, 0);
        p.velocity.set(0, 0);
        p.alpha = 1;
        p.scale.set(1, 1);
        p.visible = false;
    },
    maxPoolSize: 500
});

// Pre-warm for particle bursts
particlePool.prewarm(100);

// Emit particles
function emitParticles(x: number, y: number, count: number) {
    for (let i = 0; i < count; i++) {
        const particle = particlePool.acquire();
        particle.position.set(x, y);
        particle.velocity.set(
            (Math.random() - 0.5) * 200,
            (Math.random() - 0.5) * 200
        );
        particle.visible = true;
        particle.lifetime = 2.0;
    }
}

// Update and release
scene.onBeforeRender.add((deltaTime) => {
    // Update active particles and release when expired
    // (actual implementation would track active particles)
});
```

## Node2D Integration

When pooling `Node2D` subclasses (like `Sprite2D`), the pool automatically removes nodes from their parent on release:

```typescript
const spritePool = new ObjectPool({
    factory: () => new Sprite2D("sprite", scene),
    reset: (sprite) => {
        sprite.visible = false;
    }
});

const parent = new Node2D("container", scene);
const sprite = spritePool.acquire();
parent.addChild(sprite); // Add to scene graph

spritePool.release(sprite); // Automatically removes from parent
```

## When to Use Object Pooling

**Good candidates:**
- Bullets, projectiles
- Particles, effects
- Enemies in wave-based games
- UI elements that appear/disappear frequently
- Collectibles, pickups

**Not recommended for:**
- One-time objects (static scenery)
- Objects with complex initialization
- Objects that are rarely reused
- Very lightweight objects (pooling overhead may exceed GC cost)