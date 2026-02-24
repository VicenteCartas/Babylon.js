/**
 * Example: Object Pooling for Bullets
 *
 * This example demonstrates how to use ObjectPool to manage bullets in a shooter game,
 * avoiding GC spikes from frequent creation and destruction.
 */

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene2D } from "@babylonjs/2d/Scene2D/scene2D";
import { Sprite2D } from "@babylonjs/2d/Sprite2D/sprite2D";
import { ObjectPool } from "@babylonjs/2d/ObjectPool/objectPool";
import { Vector2 } from "@babylonjs/core/Maths/math.vector";

// Custom Bullet class
class Bullet extends Sprite2D {
    public velocity: Vector2 = Vector2.Zero();
    public damage: number = 10;
    public lifetime: number = 0;
    public maxLifetime: number = 5.0; // seconds

    public update(deltaTime: number): void {
        // Move bullet
        this.position.x += this.velocity.x * deltaTime;
        this.position.y += this.velocity.y * deltaTime;

        // Update lifetime
        this.lifetime += deltaTime;
    }

    public isExpired(): boolean {
        return this.lifetime >= this.maxLifetime;
    }
}

// Initialize engine and scene
const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const engine = new Engine(canvas);
const scene = new Scene2D(engine);

// Create bullet pool
const bulletPool = new ObjectPool({
    factory: () => new Bullet("bullet", scene),
    reset: (bullet) => {
        // Reset bullet to initial state
        bullet.position.set(0, 0);
        bullet.velocity.set(0, 0);
        bullet.rotation = 0;
        bullet.alpha = 1;
        bullet.visible = false;
        bullet.lifetime = 0;
        bullet.damage = 10;
    },
    maxPoolSize: 100, // Keep up to 100 bullets in reserve
    name: "BulletPool",
});

// Pre-warm the pool during loading
bulletPool.prewarm(20);

// Track active bullets
const activeBullets: Bullet[] = [];

// Spawn bullet function
function spawnBullet(x: number, y: number, angle: number, speed: number): void {
    const bullet = bulletPool.acquire();

    bullet.position.set(x, y);
    bullet.velocity.set(Math.cos(angle) * speed, Math.sin(angle) * speed);
    bullet.rotation = angle;
    bullet.visible = true;

    activeBullets.push(bullet);

    console.log(`Bullets active: ${bulletPool.activeCount}, in pool: ${bulletPool.freeCount}`);
}

// Update loop
scene.onBeforeRender.add((deltaTime) => {
    // Update all active bullets
    for (let i = activeBullets.length - 1; i >= 0; i--) {
        const bullet = activeBullets[i];
        bullet.update(deltaTime);

        // Check if bullet should be removed
        if (bullet.isExpired() || isOutOfBounds(bullet)) {
            // Release bullet back to pool
            bulletPool.release(bullet);
            activeBullets.splice(i, 1);
        }
    }
});

// Helper function
function isOutOfBounds(bullet: Bullet): boolean {
    const margin = 100;
    return (
        bullet.position.x < -margin ||
        bullet.position.x > scene.camera.viewport.width + margin ||
        bullet.position.y < -margin ||
        bullet.position.y > scene.camera.viewport.height + margin
    );
}

// Example: Fire bullets on key press
canvas.addEventListener("click", (event) => {
    const playerX = scene.camera.viewport.width / 2;
    const playerY = scene.camera.viewport.height / 2;

    // Fire bullet towards mouse position
    const mouseX = event.clientX;
    const mouseY = event.clientY;
    const angle = Math.atan2(mouseY - playerY, mouseX - playerX);

    spawnBullet(playerX, playerY, angle, 500);
});

// Render loop
engine.runRenderLoop(() => {
    scene.render();
});

// Cleanup on exit
window.addEventListener("beforeunload", () => {
    bulletPool.dispose();
    scene.dispose();
    engine.dispose();
});

// Debug: Log pool stats every 5 seconds
setInterval(() => {
    console.log("Pool Stats:", {
        active: bulletPool.activeCount,
        free: bulletPool.freeCount,
        totalCreated: bulletPool.totalCreated,
    });
}, 5000);