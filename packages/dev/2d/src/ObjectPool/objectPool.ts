function isDisposableObject(obj: unknown): obj is { dispose: () => void } {
    return typeof obj === "object" && obj !== null && "dispose" in obj && typeof obj.dispose === "function";
}

/**
 * Compatibility constructor options for creating an ObjectPool.
 * @param factory - Factory function used when the pool is empty.
 * @param reset - Optional reset function called on release.
 * @param initialSize - Optional initial number of objects to prewarm.
 * @param maxPoolSize - Optional maximum number of free objects to retain.
 * @param name - Optional debug label.
 */
export interface IObjectPoolOptions<T> {
    /** Factory function used when the pool is empty. */
    factory: () => T;
    /** Optional reset function called on release. */
    reset?: (obj: T) => void;
    /** Optional initial number of objects to prewarm. */
    initialSize?: number;
    /** Optional maximum number of free objects to retain. */
    maxPoolSize?: number;
    /** Optional debug label. */
    name?: string;
}

/**
 * Generic object pool for reusing allocated objects.
 */
export class ObjectPool<T> {
    private readonly _factory: () => T;
    private readonly _reset: ((obj: T) => void) | undefined;
    private readonly _maxPoolSize: number | undefined;
    private readonly _name: string;
    private readonly _free: T[] = [];
    private _totalCreated: number = 0;
    private _activeCount: number = 0;
    private _isDisposed: boolean = false;

    /**
     * Creates a new ObjectPool.
     * @param optionsOrFactory - Either a configuration object or a factory function.
     * @param reset - Optional reset function when using the positional overload.
     * @param initialSize - Optional initial prewarm count when using the positional overload.
     */
    constructor(optionsOrFactory: IObjectPoolOptions<T> | (() => T), reset?: (obj: T) => void, initialSize?: number) {
        if (typeof optionsOrFactory === "function") {
            this._factory = optionsOrFactory;
            this._reset = reset;
            this._maxPoolSize = undefined;
            this._name = "ObjectPool";
            if ((initialSize ?? 0) > 0) {
                this.prewarm(initialSize!);
            }
            return;
        }

        this._factory = optionsOrFactory.factory;
        this._reset = optionsOrFactory.reset;
        this._maxPoolSize = optionsOrFactory.maxPoolSize;
        this._name = optionsOrFactory.name ?? "ObjectPool";
        if ((optionsOrFactory.initialSize ?? 0) > 0) {
            this.prewarm(optionsOrFactory.initialSize!);
        }
    }

    /**
     * Current number of objects waiting in the pool.
     * @returns The number of available objects.
     */
    public get available(): number {
        return this._free.length;
    }

    /**
     * Total objects ever created by this pool.
     * @returns The total created count.
     */
    public get totalCreated(): number {
        return this._totalCreated;
    }

    /**
     * Compatibility alias for the number of active objects.
     * @returns The active object count.
     */
    public get activeCount(): number {
        return this._activeCount;
    }

    /**
     * Compatibility alias for the number of free objects.
     * @returns The free object count.
     */
    public get freeCount(): number {
        return this.available;
    }

    /**
     * Compatibility debug label.
     * @returns The configured pool name.
     */
    public get name(): string {
        return this._name;
    }

    /**
     * Whether this pool has been disposed.
     * @returns True when disposed.
     */
    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    /**
     * Returns a pooled object or creates a new one.
     * @returns A pooled or newly created object.
     */
    public acquire(): T {
        if (this._isDisposed) {
            throw new Error(`Cannot acquire from disposed pool '${this._name}'`);
        }

        const object = this._free.length > 0 ? this._free.pop()! : this._createObject();
        this._activeCount++;
        return object;
    }

    /**
     * Returns an object to the pool.
     * @param obj - Object to release back to the pool.
     * @returns Nothing.
     */
    public release(obj: T): void {
        if (this._isDisposed) {
            return;
        }

        if (this._activeCount > 0) {
            this._activeCount--;
        }

        this._reset?.(obj);

        if (this._maxPoolSize === undefined || this._free.length < this._maxPoolSize) {
            this._free.push(obj);
        }
    }

    /**
     * Pre-allocates free objects in the pool.
     * @param count - Number of objects to create.
     * @returns Nothing.
     */
    public prewarm(count: number): void {
        if (this._isDisposed) {
            throw new Error(`Cannot prewarm disposed pool '${this._name}'`);
        }

        for (let i = 0; i < count; i++) {
            if (this._maxPoolSize !== undefined && this._free.length >= this._maxPoolSize) {
                break;
            }

            this._free.push(this._createObject());
        }
    }

    /**
     * Clears currently free objects from the pool.
     * @returns Nothing.
     */
    public clear(): void {
        if (this._isDisposed) {
            return;
        }

        this._disposeObjects(this._free);
        this._free.length = 0;
    }

    /**
     * Disposes all currently free pooled objects.
     * @returns Nothing.
     */
    public dispose(): void {
        if (this._isDisposed) {
            return;
        }

        this.clear();
        this._activeCount = 0;
        this._isDisposed = true;
    }

    /**
     * Creates a new object and updates stats.
     * @returns The created object.
     */
    private _createObject(): T {
        const object = this._factory();
        this._totalCreated++;
        return object;
    }

    /**
     * Disposes disposable objects in the provided list.
     * @param objects - Objects to dispose.
     * @returns Nothing.
     */
    private _disposeObjects(objects: readonly T[]): void {
        for (const object of objects) {
            if (isDisposableObject(object)) {
                object.dispose();
            }
        }
    }
}