/**
 * Optional interface for objects that want lifecycle hooks when acquired or released from a pool.
 * Objects implementing this interface will have their onAcquire/onRelease methods called automatically.
 */
export interface IPoolable {
    /**
     * Called when the object is acquired from the pool.
     * Use this to initialize or reset state for reuse.
     */
    onAcquire?(): void;

    /**
     * Called when the object is released back to the pool.
     * Use this to clean up state before recycling.
     */
    onRelease?(): void;
}

/**
 * Type guard to check if an object implements the IPoolable interface.
 * @param obj The object to check
 * @returns True if the object implements IPoolable
 */
function isPoolable(obj: unknown): obj is IPoolable {
    return typeof obj === "object" && obj !== null && ("onAcquire" in obj || "onRelease" in obj);
}

/**
 * Type guard to check if an object has a settable parent property (like Node2D).
 * Uses duck-typing to avoid coupling ObjectPool to Node2D directly.
 */
function hasParent(obj: unknown): obj is { parent: unknown | null } {
    return typeof obj === "object" && obj !== null && "parent" in obj;
}

/**
 * Configuration options for creating an ObjectPool.
 */
export interface IObjectPoolOptions<T> {
    /**
     * Factory function that creates a new instance of T.
     * Called when the pool is empty and needs to create a new object.
     */
    factory: () => T;

    /**
     * Function that resets an object to its initial state when released back to the pool.
     * This is called on release, so objects are ready to use immediately when acquired.
     * @param obj The object to reset
     */
    reset: (obj: T) => void;

    /**
     * Maximum number of objects to keep in the pool.
     * If undefined, the pool has no size limit.
     * When the pool is at capacity, excess released objects are discarded.
     */
    maxPoolSize?: number;

    /**
     * Optional name for debugging purposes
     */
    name?: string;
}

/**
 * Generic object pool to avoid GC spikes in action games.
 * Useful for frequently created/destroyed objects like bullets, particles, enemies, etc.
 *
 * @example
 * ```typescript
 * // Create a pool for bullets
 * const bulletPool = new ObjectPool({
 *     factory: () => new Bullet(),
 *     reset: (bullet) => {
 *         bullet.position.set(0, 0);
 *         bullet.velocity.set(0, 0);
 *         bullet.visible = false;
 *     },
 *     maxPoolSize: 100
 * });
 *
 * // Pre-warm the pool
 * bulletPool.prewarm(20);
 *
 * // Acquire a bullet from the pool
 * const bullet = bulletPool.acquire();
 * bullet.position.set(playerX, playerY);
 * bullet.visible = true;
 *
 * // When done, release it back
 * bulletPool.release(bullet);
 * ```
 */
export class ObjectPool<T> {
    private _factory: () => T;
    private _reset: (obj: T) => void;
    private _maxPoolSize: number | undefined;
    private _name: string;
    private _freeObjects: T[] = [];
    private _activeObjects: Set<T> = new Set();
    private _totalCreated: number = 0;
    private _isDisposed: boolean = false;

    /**
     * Creates a new ObjectPool instance.
     * @param options Configuration options for the pool
     */
    constructor(options: IObjectPoolOptions<T>) {
        this._factory = options.factory;
        this._reset = options.reset;
        this._maxPoolSize = options.maxPoolSize;
        this._name = options.name || "ObjectPool";
    }

    /**
     * Gets the number of currently active objects (acquired but not released).
     */
    public get activeCount(): number {
        return this._activeObjects.size;
    }

    /**
     * Gets the number of free objects available in the pool.
     */
    public get freeCount(): number {
        return this._freeObjects.length;
    }

    /**
     * Gets the total number of objects ever created by this pool.
     */
    public get totalCreated(): number {
        return this._totalCreated;
    }

    /**
     * Gets the name of this pool (for debugging).
     */
    public get name(): string {
        return this._name;
    }

    /**
     * Gets a readonly array of all currently active (acquired) objects.
     * Returns a snapshot of active objects at the time of the call.
     * @returns A readonly array of active objects
     */
    public get activeObjects(): readonly T[] {
        return Object.freeze([...this._activeObjects]);
    }

    /**
     * Pre-allocates a specified number of objects in the pool.
     * Useful to avoid allocation spikes during gameplay.
     * @param count Number of objects to pre-allocate
     */
    public prewarm(count: number): void {
        if (this._isDisposed) {
            throw new Error(`Cannot prewarm disposed pool '${this._name}'`);
        }

        for (let i = 0; i < count; i++) {
            // Respect max pool size during prewarm
            if (this._maxPoolSize !== undefined && this._freeObjects.length >= this._maxPoolSize) {
                break;
            }
            const obj = this._factory();
            this._totalCreated++;
            this._freeObjects.push(obj);
        }
    }

    /**
     * Iterates over all currently active (acquired) objects.
     * @param callback Function to call for each active object
     */
    public forEachActive(callback: (obj: T) => void): void {
        for (const obj of this._activeObjects) {
            callback(obj);
        }
    }

    /**
     * Acquires an object from the pool.
     * If the pool is empty, a new object is created.
     * If the object implements IPoolable, its onAcquire method is called.
     * @returns An object from the pool
     */
    public acquire(): T {
        if (this._isDisposed) {
            throw new Error(`Cannot acquire from disposed pool '${this._name}'`);
        }

        let obj: T;

        if (this._freeObjects.length > 0) {
            obj = this._freeObjects.pop()!;
        } else {
            obj = this._factory();
            this._totalCreated++;
        }

        this._activeObjects.add(obj);

        // Call onAcquire if the object implements IPoolable
        if (isPoolable(obj) && obj.onAcquire) {
            try {
                obj.onAcquire();
            } catch (error) {
                // Pool state is already consistent (object added to active set)
                // Re-throw the error so caller knows acquisition failed
                throw error;
            }
        }

        return obj;
    }

    /**
     * Releases an object back to the pool.
     * The reset function is called to clean up the object's state.
     * If the object implements IPoolable, its onRelease method is called.
     * If the pool is at capacity, the object is discarded instead of pooled.
     * @param obj The object to release
     */
    public release(obj: T): void {
        if (this._isDisposed) {
            // Silently ignore releases to disposed pools
            return;
        }

        if (!this._activeObjects.has(obj)) {
            // Object wasn't acquired from this pool or was already released
            return;
        }

        this._activeObjects.delete(obj);

        // Call onRelease if the object implements IPoolable
        if (isPoolable(obj) && obj.onRelease) {
            try {
                obj.onRelease();
            } catch (error) {
                // Pool state is already consistent (object removed from active set)
                // Re-throw the error so caller knows release hook failed
                throw error;
            }
        }

        // Auto-remove from scene graph if the object has a parent (e.g. Node2D)
        if (hasParent(obj) && obj.parent != null) {
            obj.parent = null;
        }

        // Reset the object to initial state
        this._reset(obj);

        // Check if we can add to the pool or should discard
        if (this._maxPoolSize === undefined || this._freeObjects.length < this._maxPoolSize) {
            this._freeObjects.push(obj);
        }
        // Otherwise, let it be garbage collected
    }

    /**
     * Clears all free objects from the pool.
     * Active objects are not affected.
     */
    public clear(): void {
        if (this._isDisposed) {
            return;
        }

        this._freeObjects.length = 0;
    }

    /**
     * Disposes the pool and clears all objects.
     * After disposal, the pool cannot be used.
     */
    public dispose(): void {
        if (this._isDisposed) {
            return;
        }

        this._isDisposed = true;
        this._freeObjects.length = 0;
        this._activeObjects.clear();
    }

    /**
     * Gets whether this pool has been disposed.
     */
    public get isDisposed(): boolean {
        return this._isDisposed;
    }
}
