import { ObjectPool, IPoolable } from "2d/ObjectPool/objectPool";
import { Sprite2D } from "2d/Sprite2D/sprite2D";
import { Scene2D } from "2d/Scene2D/scene2D";
import { NullEngine } from "core/Engines/nullEngine";
import { Node2D } from "2d/Node2D/node2D";

describe("ObjectPool", () => {
    // Simple test object
    class TestObject {
        public x: number = 0;
        public y: number = 0;
        public isActive: boolean = false;

        public reset(): void {
            this.x = 0;
            this.y = 0;
            this.isActive = false;
        }
    }

    // Object with poolable interface
    class PoolableObject implements IPoolable {
        public value: number = 0;
        public acquireCalled: boolean = false;
        public releaseCalled: boolean = false;

        public onAcquire(): void {
            this.acquireCalled = true;
        }

        public onRelease(): void {
            this.releaseCalled = true;
        }

        public reset(): void {
            this.value = 0;
            this.acquireCalled = false;
            this.releaseCalled = false;
        }
    }

    describe("Basic Operations", () => {
        it("should create a pool with factory and reset functions", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            expect(pool).toBeDefined();
            expect(pool.activeCount).toBe(0);
            expect(pool.freeCount).toBe(0);
            expect(pool.totalCreated).toBe(0);

            pool.dispose();
        });

        it("should acquire a new object when pool is empty", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            const obj = pool.acquire();

            expect(obj).toBeDefined();
            expect(pool.activeCount).toBe(1);
            expect(pool.freeCount).toBe(0);
            expect(pool.totalCreated).toBe(1);

            pool.dispose();
        });

        it("should release an object back to the pool", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            const obj = pool.acquire();
            obj.x = 100;
            obj.y = 200;
            obj.isActive = true;

            pool.release(obj);

            expect(pool.activeCount).toBe(0);
            expect(pool.freeCount).toBe(1);
            expect(obj.x).toBe(0); // Should be reset
            expect(obj.y).toBe(0);
            expect(obj.isActive).toBe(false);

            pool.dispose();
        });

        it("should reuse released objects", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            const obj1 = pool.acquire();
            pool.release(obj1);

            const obj2 = pool.acquire();

            expect(obj2).toBe(obj1); // Should be the same object
            expect(pool.totalCreated).toBe(1); // Only created once

            pool.dispose();
        });

        it("should handle multiple acquire and release cycles", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            const objs: TestObject[] = [];

            // Acquire 5 objects
            for (let i = 0; i < 5; i++) {
                objs.push(pool.acquire());
            }

            expect(pool.activeCount).toBe(5);
            expect(pool.totalCreated).toBe(5);

            // Release 3 objects
            for (let i = 0; i < 3; i++) {
                pool.release(objs[i]);
            }

            expect(pool.activeCount).toBe(2);
            expect(pool.freeCount).toBe(3);

            // Acquire 2 more (should reuse from pool)
            pool.acquire();
            pool.acquire();

            expect(pool.activeCount).toBe(4);
            expect(pool.freeCount).toBe(1);
            expect(pool.totalCreated).toBe(5); // Still only 5 total

            pool.dispose();
        });
    });

    describe("Prewarm", () => {
        it("should prewarm the pool with specified number of objects", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            pool.prewarm(10);

            expect(pool.freeCount).toBe(10);
            expect(pool.activeCount).toBe(0);
            expect(pool.totalCreated).toBe(10);

            pool.dispose();
        });

        it("should respect maxPoolSize during prewarm", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
                maxPoolSize: 5,
            });

            pool.prewarm(10); // Try to prewarm 10, but max is 5

            expect(pool.freeCount).toBe(5);
            expect(pool.totalCreated).toBe(5);

            pool.dispose();
        });

        it("should throw when trying to prewarm a disposed pool", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            pool.dispose();

            expect(() => pool.prewarm(5)).toThrow();
        });
    });

    describe("Pool Capacity", () => {
        it("should enforce maxPoolSize", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
                maxPoolSize: 3,
            });

            const objs: TestObject[] = [];

            // Acquire 5 objects
            for (let i = 0; i < 5; i++) {
                objs.push(pool.acquire());
            }

            // Release all 5
            for (const obj of objs) {
                pool.release(obj);
            }

            // Pool should only keep 3 (maxPoolSize)
            expect(pool.freeCount).toBe(3);
            expect(pool.activeCount).toBe(0);

            pool.dispose();
        });

        it("should allow unlimited pool size when maxPoolSize is undefined", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
                // No maxPoolSize
            });

            const objs: TestObject[] = [];

            // Acquire and release 100 objects
            for (let i = 0; i < 100; i++) {
                objs.push(pool.acquire());
            }

            for (const obj of objs) {
                pool.release(obj);
            }

            expect(pool.freeCount).toBe(100);

            pool.dispose();
        });
    });

    describe("IPoolable Interface", () => {
        it("should call onAcquire when object is acquired", () => {
            const pool = new ObjectPool({
                factory: () => new PoolableObject(),
                reset: (obj) => obj.reset(),
            });

            const obj = pool.acquire();

            expect(obj.acquireCalled).toBe(true);

            pool.dispose();
        });

        it("should call onRelease when object is released", () => {
            const pool = new ObjectPool({
                factory: () => new PoolableObject(),
                reset: (obj) => {
                    // Only reset value, not the tracking flags
                    obj.value = 0;
                },
            });

            const obj = pool.acquire();
            pool.release(obj);

            expect(obj.releaseCalled).toBe(true);

            pool.dispose();
        });
    });

    describe("Node2D Integration", () => {
        let engine: NullEngine;
        let scene: Scene2D;

        beforeEach(() => {
            engine = new NullEngine();
            scene = new Scene2D(engine);
        });

        afterEach(() => {
            scene.dispose();
            engine.dispose();
        });

        it("should handle Node2D objects with custom reset that removes parent", () => {
            const pool = new ObjectPool({
                factory: () => new Sprite2D("pooled-sprite", scene),
                reset: (sprite) => {
                    sprite.visible = false;
                    sprite.parent = null; // User must handle parent removal in reset
                },
            });

            const parent = new Node2D("parent", scene);
            const sprite = pool.acquire();
            parent.addChild(sprite);

            expect(sprite.parent).toBe(parent);

            pool.release(sprite);

            expect(sprite.parent).toBeNull();

            pool.dispose();
        });
    });

    describe("Clear and Dispose", () => {
        it("should clear all free objects", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            pool.prewarm(10);
            expect(pool.freeCount).toBe(10);

            pool.clear();

            expect(pool.freeCount).toBe(0);
            expect(pool.activeCount).toBe(0);

            pool.dispose();
        });

        it("should not affect active objects when clearing", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            const obj1 = pool.acquire();
            const obj2 = pool.acquire();
            pool.release(obj1);

            expect(pool.activeCount).toBe(1);
            expect(pool.freeCount).toBe(1);

            pool.clear();

            expect(pool.activeCount).toBe(1);
            expect(pool.freeCount).toBe(0);

            pool.dispose();
        });

        it("should dispose the pool", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            pool.prewarm(5);
            pool.acquire();

            expect(pool.isDisposed).toBe(false);

            pool.dispose();

            expect(pool.isDisposed).toBe(true);
            expect(pool.freeCount).toBe(0);
            expect(pool.activeCount).toBe(0);
        });

        it("should throw when acquiring from disposed pool", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            pool.dispose();

            expect(() => pool.acquire()).toThrow();
        });

        it("should silently ignore release to disposed pool", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            const obj = pool.acquire();
            pool.dispose();

            expect(() => pool.release(obj)).not.toThrow();
        });

        it("should handle multiple dispose calls gracefully", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            pool.dispose();
            pool.dispose(); // Should not throw

            expect(pool.isDisposed).toBe(true);
        });
    });

    describe("Stats and Debugging", () => {
        it("should track activeCount correctly", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            expect(pool.activeCount).toBe(0);

            const obj1 = pool.acquire();
            expect(pool.activeCount).toBe(1);

            const obj2 = pool.acquire();
            expect(pool.activeCount).toBe(2);

            pool.release(obj1);
            expect(pool.activeCount).toBe(1);

            pool.release(obj2);
            expect(pool.activeCount).toBe(0);

            pool.dispose();
        });

        it("should track freeCount correctly", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            expect(pool.freeCount).toBe(0);

            const obj1 = pool.acquire();
            expect(pool.freeCount).toBe(0);

            pool.release(obj1);
            expect(pool.freeCount).toBe(1);

            const obj2 = pool.acquire();
            expect(pool.freeCount).toBe(0);

            pool.dispose();
        });

        it("should track totalCreated correctly", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            expect(pool.totalCreated).toBe(0);

            pool.acquire();
            expect(pool.totalCreated).toBe(1);

            pool.acquire();
            expect(pool.totalCreated).toBe(2);

            pool.acquire();
            expect(pool.totalCreated).toBe(3);

            pool.dispose();
        });

        it("should have a readable name", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
                name: "TestPool",
            });

            expect(pool.name).toBe("TestPool");

            pool.dispose();
        });

        it("should have a default name when not specified", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            expect(pool.name).toBe("ObjectPool");

            pool.dispose();
        });
    });

    describe("Edge Cases", () => {
        it("should handle releasing the same object twice gracefully", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            const obj = pool.acquire();
            pool.release(obj);
            pool.release(obj); // Release again

            expect(pool.activeCount).toBe(0);
            expect(pool.freeCount).toBe(1); // Should still be 1, not 2

            pool.dispose();
        });

        it("should handle releasing an object not from the pool", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            const outsideObj = new TestObject();

            expect(() => pool.release(outsideObj)).not.toThrow();
            expect(pool.freeCount).toBe(0); // Should not be added to pool

            pool.dispose();
        });

        it("should handle empty pool operations", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            expect(() => pool.clear()).not.toThrow();
            expect(() => pool.dispose()).not.toThrow();
        });

        it("should handle releasing objects from a different pool", () => {
            const pool1 = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            const pool2 = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            const obj1 = pool1.acquire();

            // Try to release pool1's object to pool2
            expect(() => pool2.release(obj1)).not.toThrow();
            expect(pool2.freeCount).toBe(0); // Should not be added to pool2
            expect(pool1.activeCount).toBe(1); // Should still be active in pool1

            pool1.dispose();
            pool2.dispose();
        });

        it("should handle maxPoolSize of 0", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
                maxPoolSize: 0,
            });

            const obj = pool.acquire();
            expect(pool.totalCreated).toBe(1);
            expect(pool.activeCount).toBe(1);

            pool.release(obj);

            // With maxPoolSize 0, object should not be pooled
            expect(pool.freeCount).toBe(0);

            pool.dispose();
        });

        it("should handle maxPoolSize of 1", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
                maxPoolSize: 1,
            });

            const obj1 = pool.acquire();
            const obj2 = pool.acquire();

            pool.release(obj1);
            pool.release(obj2);

            // Only one object should be pooled
            expect(pool.freeCount).toBe(1);

            pool.dispose();
        });

        it("should handle clear on disposed pool", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            pool.prewarm(5);
            pool.dispose();

            expect(() => pool.clear()).not.toThrow();
            expect(pool.freeCount).toBe(0);
        });

        it("should handle very large prewarm values", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            // Prewarm with large value (but reasonable for testing)
            pool.prewarm(1000);

            expect(pool.freeCount).toBe(1000);
            expect(pool.totalCreated).toBe(1000);
            expect(pool.activeCount).toBe(0);

            pool.dispose();
        });

        it("should handle very large prewarm with maxPoolSize", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
                maxPoolSize: 50,
            });

            // Try to prewarm more than maxPoolSize
            pool.prewarm(10000);

            // Should be capped at maxPoolSize
            expect(pool.freeCount).toBe(50);
            expect(pool.totalCreated).toBe(50);

            pool.dispose();
        });

        it("should handle reset function that throws errors", () => {
            let throwOnReset = false;
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => {
                    if (throwOnReset) {
                        throw new Error("Reset failed");
                    }
                    obj.reset();
                },
            });

            const obj = pool.acquire();
            throwOnReset = true;

            // Release should propagate the error from reset
            expect(() => pool.release(obj)).toThrow("Reset failed");

            pool.dispose();
        });

        it("should handle factory that throws errors", () => {
            let throwOnCreate = false;
            const pool = new ObjectPool({
                factory: () => {
                    if (throwOnCreate) {
                        throw new Error("Factory failed");
                    }
                    return new TestObject();
                },
                reset: (obj) => obj.reset(),
            });

            // First acquire should work
            const obj1 = pool.acquire();
            expect(obj1).toBeDefined();

            throwOnCreate = true;

            // Next acquire should throw
            expect(() => pool.acquire()).toThrow("Factory failed");

            pool.dispose();
        });
    });

    describe("Stress Testing", () => {
        it("should handle rapid acquire/release cycles", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
                maxPoolSize: 10,
            });

            // Perform 1000 rapid acquire/release cycles
            for (let i = 0; i < 1000; i++) {
                const obj = pool.acquire();
                obj.x = i;
                obj.y = i * 2;
                obj.isActive = true;
                pool.release(obj);
            }

            // Pool should maintain correct state
            expect(pool.freeCount).toBeLessThanOrEqual(10);
            expect(pool.activeCount).toBe(0);

            pool.dispose();
        });

        it("should handle interleaved acquire/release patterns", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
                maxPoolSize: 20,
            });

            const activeObjects: TestObject[] = [];

            // Complex pattern: acquire some, release some, repeat
            for (let cycle = 0; cycle < 100; cycle++) {
                // Acquire 5 objects
                for (let i = 0; i < 5; i++) {
                    activeObjects.push(pool.acquire());
                }

                // Release 3 objects
                for (let i = 0; i < 3; i++) {
                    const obj = activeObjects.shift();
                    if (obj) {
                        pool.release(obj);
                    }
                }
            }

            // Release remaining objects
            for (const obj of activeObjects) {
                pool.release(obj);
            }

            expect(pool.activeCount).toBe(0);
            expect(pool.freeCount).toBeLessThanOrEqual(20);

            pool.dispose();
        });

        it("should maintain stats consistency under stress", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            const maxConcurrent = 50;
            const iterations = 100;
            const activeObjects: TestObject[] = [];

            for (let i = 0; i < iterations; i++) {
                // Acquire objects up to max
                while (activeObjects.length < maxConcurrent) {
                    activeObjects.push(pool.acquire());
                }

                // Verify active count
                expect(pool.activeCount).toBe(maxConcurrent);

                // Release half
                for (let j = 0; j < maxConcurrent / 2; j++) {
                    pool.release(activeObjects.pop()!);
                }

                // Verify counts are consistent
                expect(pool.activeCount + pool.freeCount).toBeLessThanOrEqual(pool.totalCreated);
            }

            // Cleanup
            for (const obj of activeObjects) {
                pool.release(obj);
            }

            expect(pool.activeCount).toBe(0);

            pool.dispose();
        });

        it("should handle high churn rate efficiently", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
                maxPoolSize: 100,
            });

            pool.prewarm(50);
            const startTime = Date.now();

            // High churn: rapid acquire and immediate release
            for (let i = 0; i < 10000; i++) {
                const obj = pool.acquire();
                pool.release(obj);
            }

            const elapsed = Date.now() - startTime;

            // Should complete quickly (under 1 second for 10k cycles)
            expect(elapsed).toBeLessThan(1000);

            // Should have minimal object creation due to pooling
            expect(pool.totalCreated).toBeLessThan(200);

            pool.dispose();
        });
    });

    describe("Lifecycle Hooks", () => {
        it("should call onAcquire and onRelease in correct order", () => {
            const callOrder: string[] = [];

            class TrackedObject implements IPoolable {
                public onAcquire(): void {
                    callOrder.push("acquire");
                }

                public onRelease(): void {
                    callOrder.push("release");
                }
            }

            const pool = new ObjectPool({
                factory: () => new TrackedObject(),
                reset: () => {
                    callOrder.push("reset");
                },
            });

            const obj = pool.acquire();
            expect(callOrder).toEqual(["acquire"]);

            callOrder.length = 0;
            pool.release(obj);

            // Order should be: onRelease, reset
            expect(callOrder).toEqual(["release", "reset"]);

            pool.dispose();
        });

        it("should handle onAcquire throwing errors", () => {
            class ErrorOnAcquire implements IPoolable {
                public onAcquire(): void {
                    throw new Error("Acquire failed");
                }
            }

            const pool = new ObjectPool({
                factory: () => new ErrorOnAcquire(),
                reset: () => {},
            });

            // Should propagate the error
            expect(() => pool.acquire()).toThrow("Acquire failed");

            pool.dispose();
        });

        it("should handle onRelease throwing errors", () => {
            class ErrorOnRelease implements IPoolable {
                public onRelease(): void {
                    throw new Error("Release failed");
                }
            }

            const pool = new ObjectPool({
                factory: () => new ErrorOnRelease(),
                reset: () => {},
            });

            const obj = pool.acquire();

            // Should propagate the error
            expect(() => pool.release(obj)).toThrow("Release failed");

            pool.dispose();
        });

        it("should maintain pool state consistency when onAcquire throws", () => {
            let shouldThrow = false;

            class ConditionalErrorOnAcquire implements IPoolable {
                public onAcquire(): void {
                    if (shouldThrow) {
                        throw new Error("Acquire failed");
                    }
                }
            }

            const pool = new ObjectPool({
                factory: () => new ConditionalErrorOnAcquire(),
                reset: () => {},
            });

            // First acquire should succeed
            const obj1 = pool.acquire();
            expect(pool.activeCount).toBe(1);
            expect(pool.totalCreated).toBe(1);

            // Release it back
            pool.release(obj1);
            expect(pool.activeCount).toBe(0);
            expect(pool.freeCount).toBe(1);

            // Next acquire should throw
            shouldThrow = true;
            expect(() => pool.acquire()).toThrow("Acquire failed");

            // Pool state should remain consistent despite the error
            // The object was added to active set before onAcquire threw
            expect(pool.activeCount).toBe(1);
            expect(pool.freeCount).toBe(0);

            pool.dispose();
        });

        it("should maintain pool state consistency when onRelease throws", () => {
            let shouldThrow = false;

            class ConditionalErrorOnRelease implements IPoolable {
                public onRelease(): void {
                    if (shouldThrow) {
                        throw new Error("Release failed");
                    }
                }
            }

            const pool = new ObjectPool({
                factory: () => new ConditionalErrorOnRelease(),
                reset: () => {},
            });

            const obj = pool.acquire();
            expect(pool.activeCount).toBe(1);

            // First release should succeed
            pool.release(obj);
            expect(pool.activeCount).toBe(0);
            expect(pool.freeCount).toBe(1);

            // Acquire again
            const obj2 = pool.acquire();
            expect(pool.activeCount).toBe(1);
            expect(pool.freeCount).toBe(0);

            // Next release should throw
            shouldThrow = true;
            expect(() => pool.release(obj2)).toThrow("Release failed");

            // Pool state should remain consistent despite the error
            // The object was removed from active set before onRelease threw
            expect(pool.activeCount).toBe(0);

            pool.dispose();
        });

        it("should not call lifecycle hooks for objects without IPoolable", () => {
            class NonPoolable {
                public value: number = 0;
            }

            const pool = new ObjectPool({
                factory: () => new NonPoolable(),
                reset: (obj) => {
                    obj.value = 0;
                },
            });

            // Should not throw even though object doesn't implement IPoolable
            expect(() => {
                const obj = pool.acquire();
                pool.release(obj);
            }).not.toThrow();

            pool.dispose();
        });
    });

    describe("Memory Management", () => {
        it("should properly discard objects exceeding maxPoolSize", () => {
            const createdObjects = new Set<TestObject>();

            const pool = new ObjectPool({
                factory: () => {
                    const obj = new TestObject();
                    createdObjects.add(obj);
                    return obj;
                },
                reset: (obj) => obj.reset(),
                maxPoolSize: 5,
            });

            const objects: TestObject[] = [];

            // Create 10 objects
            for (let i = 0; i < 10; i++) {
                objects.push(pool.acquire());
            }

            expect(createdObjects.size).toBe(10);

            // Release all 10
            for (const obj of objects) {
                pool.release(obj);
            }

            // Only 5 should be in the pool
            expect(pool.freeCount).toBe(5);

            // Acquire 5 objects - should reuse from pool
            const reused: TestObject[] = [];
            for (let i = 0; i < 5; i++) {
                reused.push(pool.acquire());
            }

            // No new objects should have been created
            expect(createdObjects.size).toBe(10);
            expect(pool.totalCreated).toBe(10);

            pool.dispose();
        });

        it("should properly clean up on dispose", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            pool.prewarm(20);
            const obj1 = pool.acquire();
            const obj2 = pool.acquire();

            expect(pool.freeCount).toBe(18);
            expect(pool.activeCount).toBe(2);

            pool.dispose();

            // Everything should be cleared
            expect(pool.freeCount).toBe(0);
            expect(pool.activeCount).toBe(0);
            expect(pool.isDisposed).toBe(true);
        });
    });

    describe("Concurrency Simulation", () => {
        it("should handle stats counters correctly with multiple operations", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            // Simulate multiple "concurrent" operations
            const objects: TestObject[] = [];

            for (let i = 0; i < 5; i++) {
                objects.push(pool.acquire());
            }

            expect(pool.activeCount).toBe(5);
            expect(pool.totalCreated).toBe(5);

            pool.release(objects[0]);
            expect(pool.activeCount).toBe(4);
            expect(pool.freeCount).toBe(1);

            objects.push(pool.acquire()); // Should reuse
            expect(pool.activeCount).toBe(5);
            expect(pool.freeCount).toBe(0);
            expect(pool.totalCreated).toBe(5); // No new creation

            pool.dispose();
        });

        it("should handle rapid state changes correctly", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
                maxPoolSize: 10,
            });

            // Rapidly change between empty and full pool
            for (let cycle = 0; cycle < 50; cycle++) {
                const objects: TestObject[] = [];

                // Fill pool
                for (let i = 0; i < 10; i++) {
                    objects.push(pool.acquire());
                }

                // Verify state
                expect(pool.activeCount).toBe(10);

                // Empty pool
                for (const obj of objects) {
                    pool.release(obj);
                }

                // Verify state
                expect(pool.activeCount).toBe(0);
                expect(pool.freeCount).toBe(10);
            }

            pool.dispose();
        });
    });

    describe("Active Object Iteration", () => {
        it("should iterate over active objects with forEachActive", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            const obj1 = pool.acquire();
            const obj2 = pool.acquire();
            const obj3 = pool.acquire();

            obj1.x = 1;
            obj2.x = 2;
            obj3.x = 3;

            const visited: number[] = [];
            pool.forEachActive((obj) => {
                visited.push(obj.x);
            });

            expect(visited.sort()).toEqual([1, 2, 3]);

            pool.dispose();
        });

        it("should not iterate over released objects", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            const obj1 = pool.acquire();
            const obj2 = pool.acquire();
            const obj3 = pool.acquire();

            obj1.x = 1;
            obj2.x = 2;
            obj3.x = 3;

            pool.release(obj2);

            const visited: number[] = [];
            pool.forEachActive((obj) => {
                visited.push(obj.x);
            });

            expect(visited.sort()).toEqual([1, 3]);

            pool.dispose();
        });

        it("should handle empty pool in forEachActive", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            let callCount = 0;
            pool.forEachActive(() => {
                callCount++;
            });

            expect(callCount).toBe(0);

            pool.dispose();
        });

        it("should return active objects as readonly array", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            const obj1 = pool.acquire();
            const obj2 = pool.acquire();
            const obj3 = pool.acquire();

            obj1.x = 1;
            obj2.x = 2;
            obj3.x = 3;

            const activeObjects = pool.activeObjects;

            expect(activeObjects.length).toBe(3);
            expect(activeObjects).toContain(obj1);
            expect(activeObjects).toContain(obj2);
            expect(activeObjects).toContain(obj3);

            // Verify it's frozen
            expect(Object.isFrozen(activeObjects)).toBe(true);

            pool.dispose();
        });

        it("should return snapshot of active objects", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            const obj1 = pool.acquire();
            const obj2 = pool.acquire();

            const snapshot1 = pool.activeObjects;
            expect(snapshot1.length).toBe(2);

            // Acquire more objects after getting snapshot
            const obj3 = pool.acquire();

            // Original snapshot should not change
            expect(snapshot1.length).toBe(2);

            // New snapshot should reflect current state
            const snapshot2 = pool.activeObjects;
            expect(snapshot2.length).toBe(3);

            pool.dispose();
        });

        it("should return empty array when no active objects", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            const activeObjects = pool.activeObjects;

            expect(activeObjects.length).toBe(0);
            expect(Array.isArray(activeObjects)).toBe(true);

            pool.dispose();
        });

        it("should handle modifications during forEachActive", () => {
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            const obj1 = pool.acquire();
            const obj2 = pool.acquire();
            const obj3 = pool.acquire();

            let count = 0;
            pool.forEachActive((obj) => {
                count++;
                obj.x = count * 10;
            });

            expect(count).toBe(3);
            expect(obj1.x === 10 || obj1.x === 20 || obj1.x === 30).toBe(true);

            pool.dispose();
        });

        it("should allow using activeObjects to track game entities", () => {
            // Common game dev use case: iterate over all active bullets
            const pool = new ObjectPool({
                factory: () => new TestObject(),
                reset: (obj) => obj.reset(),
            });

            // Spawn bullets
            const bullet1 = pool.acquire();
            bullet1.x = 10;
            bullet1.y = 20;

            const bullet2 = pool.acquire();
            bullet2.x = 30;
            bullet2.y = 40;

            const bullet3 = pool.acquire();
            bullet3.x = 50;
            bullet3.y = 60;

            // Update all active bullets (e.g., in game loop)
            pool.forEachActive((bullet) => {
                bullet.x += 1; // Move bullet
            });

            expect(bullet1.x).toBe(11);
            expect(bullet2.x).toBe(31);
            expect(bullet3.x).toBe(51);

            // Remove one bullet
            pool.release(bullet2);

            // Check active bullets
            const activeBullets = pool.activeObjects;
            expect(activeBullets.length).toBe(2);
            expect(activeBullets).toContain(bullet1);
            expect(activeBullets).not.toContain(bullet2);
            expect(activeBullets).toContain(bullet3);

            pool.dispose();
        });
    });
});