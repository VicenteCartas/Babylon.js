import { Observable } from "core/Misc/observable";

import { Easing } from "./easing";
import type { EasingFunction } from "./easing";

/**
 * Represents a tween target — a numeric value interpolated over time.
 */
export interface ITweenTarget {
    /** Starting value */
    from: number;
    /** Ending value */
    to: number;
}

/**
 * Lifecycle state of a tween
 */
export enum TweenState {
    /** Waiting for delay to elapse */
    Pending = 0,
    /** Currently interpolating */
    Running = 1,
    /** Completed (or stopped) */
    Complete = 2,
}

/**
 * A lightweight tween that interpolates one or more numeric values over time.
 *
 * @example
 * ```typescript
 * // Move a sprite from x=0 to x=300 over 0.5 seconds with ease-out
 * const tw = new Tween({ from: 0, to: 300 }, 0.5, Easing.CubicOut)
 *     .onUpdate((value) => { sprite.position.x = value; })
 *     .onComplete(() => { console.log("done"); })
 *     .start();
 *
 * // Each frame:
 * tw.update(deltaTime);
 * ```
 *
 * @example
 * ```typescript
 * // Chain tweens: move right, then move down
 * const tw = new Tween({ from: 0, to: 300 }, 0.5, Easing.QuadOut)
 *     .onUpdate((v) => { sprite.position.x = v; })
 *     .chain(
 *         new Tween({ from: 0, to: 200 }, 0.3, Easing.QuadOut)
 *             .onUpdate((v) => { sprite.position.y = v; })
 *     );
 * tw.start();
 * ```
 */
export class Tween {
    /**
     * Observable triggered each frame with the current interpolated value
     */
    public readonly onUpdateObservable: Observable<number> = new Observable<number>();

    /**
     * Observable triggered when the tween completes
     */
    public readonly onCompleteObservable: Observable<Tween> = new Observable<Tween>();

    private _target: ITweenTarget;
    private _duration: number;
    private _easing: EasingFunction;
    private _delay: number = 0;
    private _elapsed: number = 0;
    private _state: TweenState = TweenState.Pending;
    private _loop: boolean = false;
    private _yoyo: boolean = false;
    private _yoyoReverse: boolean = false;
    private _repeatCount: number = 0;
    private _repeatsDone: number = 0;
    private _updateCallback: ((value: number) => void) | null = null;
    private _completeCallback: (() => void) | null = null;
    private _chainedTween: Tween | null = null;
    private _currentValue: number = 0;

    /**
     * Creates a new Tween
     * @param target - The from/to values to interpolate between
     * @param duration - Duration in seconds
     * @param easing - Easing function (default: Linear)
     */
    constructor(target: ITweenTarget, duration: number, easing: EasingFunction = Easing.Linear) {
        this._target = target;
        this._duration = Math.max(duration, 0);
        this._easing = easing;
        this._currentValue = target.from;
    }

    /**
     * The current lifecycle state
     */
    public get state(): TweenState {
        return this._state;
    }

    /**
     * The current interpolated value
     */
    public get currentValue(): number {
        return this._currentValue;
    }

    /**
     * Normalized progress (0–1)
     */
    public get progress(): number {
        if (this._duration <= 0) {
            return this._state === TweenState.Complete ? 1 : 0;
        }
        return Math.min(Math.max((this._elapsed - this._delay) / this._duration, 0), 1);
    }

    /**
     * Whether this tween has finished
     */
    public get isComplete(): boolean {
        return this._state === TweenState.Complete;
    }

    // ─── Fluent configuration ────────────────────────────────────────

    /**
     * Sets a delay before the tween starts interpolating
     * @param seconds - Delay in seconds
     * @returns this (for chaining)
     */
    public setDelay(seconds: number): this {
        this._delay = Math.max(seconds, 0);
        return this;
    }

    /**
     * Sets the tween to loop indefinitely
     * @param yoyo - If true, alternates direction each loop
     * @returns this (for chaining)
     */
    public setLoop(yoyo: boolean = false): this {
        this._loop = true;
        this._yoyo = yoyo;
        return this;
    }

    /**
     * Sets the tween to repeat a fixed number of times
     * @param count - Number of additional repeats (1 = plays twice total)
     * @param yoyo - If true, alternates direction each repeat
     * @returns this (for chaining)
     */
    public setRepeat(count: number, yoyo: boolean = false): this {
        this._repeatCount = Math.max(count, 0);
        this._yoyo = yoyo;
        return this;
    }

    /**
     * Registers a callback called each frame with the current interpolated value
     * @param callback - Function receiving the current value
     * @returns this (for chaining)
     */
    public onUpdate(callback: (value: number) => void): this {
        this._updateCallback = callback;
        return this;
    }

    /**
     * Registers a callback called when the tween finishes
     * @param callback - Completion callback
     * @returns this (for chaining)
     */
    public onComplete(callback: () => void): this {
        this._completeCallback = callback;
        return this;
    }

    /**
     * Chains another tween to start when this one completes
     * @param tween - The tween to start after this one
     * @returns this (for chaining)
     */
    public chain(tween: Tween): this {
        this._chainedTween = tween;
        return this;
    }

    // ─── Lifecycle ───────────────────────────────────────────────────

    /**
     * Starts the tween. Must be called before update() will do anything.
     * @returns this (for chaining)
     */
    public start(): this {
        this._state = TweenState.Pending;
        this._elapsed = 0;
        this._repeatsDone = 0;
        this._yoyoReverse = false;
        this._currentValue = this._target.from;
        return this;
    }

    /**
     * Advances the tween by deltaTime seconds.
     * @param deltaTime - Time elapsed since last frame in seconds
     */
    public update(deltaTime: number): void {
        if (this._state === TweenState.Complete) {
            return;
        }

        this._elapsed += deltaTime;

        // Still in delay period
        if (this._elapsed < this._delay) {
            return;
        }

        this._state = TweenState.Running;

        const activeTime = this._elapsed - this._delay;

        if (this._duration <= 0) {
            // Instant tween
            this._currentValue = this._target.to;
            this._emitUpdate();
            this._finish();
            return;
        }

        let t = Math.min(activeTime / this._duration, 1);

        // Apply yoyo reversal
        if (this._yoyoReverse) {
            t = 1 - t;
        }

        // Apply easing
        const eased = this._easing(this._yoyoReverse ? 1 - t : t);
        const easedT = this._yoyoReverse ? 1 - eased : eased;

        // Interpolate
        this._currentValue = this._target.from + (this._target.to - this._target.from) * easedT;
        this._emitUpdate();

        // Check completion of this iteration
        if (activeTime >= this._duration) {
            // Snap to exact end value
            this._currentValue = this._yoyoReverse ? this._target.from : this._target.to;
            this._emitUpdate();

            if (this._loop || this._repeatsDone < this._repeatCount) {
                // Restart for next iteration
                this._repeatsDone++;
                this._elapsed = this._delay; // Reset active time but skip delay
                if (this._yoyo) {
                    this._yoyoReverse = !this._yoyoReverse;
                }
            } else {
                this._finish();
            }
        }
    }

    /**
     * Immediately completes the tween, jumping to the final value
     */
    public complete(): void {
        if (this._state === TweenState.Complete) {
            return;
        }
        this._currentValue = this._target.to;
        this._emitUpdate();
        this._finish();
    }

    /**
     * Stops the tween at its current value without triggering onComplete
     */
    public stop(): void {
        this._state = TweenState.Complete;
    }

    /**
     * Disposes the tween and clears all callbacks
     */
    public dispose(): void {
        this._state = TweenState.Complete;
        this._updateCallback = null;
        this._completeCallback = null;
        this._chainedTween = null;
        this.onUpdateObservable.clear();
        this.onCompleteObservable.clear();
    }

    // ─── Internals ───────────────────────────────────────────────────

    private _emitUpdate(): void {
        if (this._updateCallback) {
            this._updateCallback(this._currentValue);
        }
        this.onUpdateObservable.notifyObservers(this._currentValue);
    }

    private _finish(): void {
        this._state = TweenState.Complete;
        if (this._completeCallback) {
            this._completeCallback();
        }
        this.onCompleteObservable.notifyObservers(this);

        // Start chained tween
        if (this._chainedTween) {
            this._chainedTween.start();
        }
    }

    // ─── Static helpers ──────────────────────────────────────────────

    /**
     * Creates and starts a simple value tween
     * @param from - Start value
     * @param to - End value
     * @param duration - Duration in seconds
     * @param easing - Easing function
     * @param onUpdate - Callback with current value each frame
     * @returns The started tween
     */
    public static CreateAsync(from: number, to: number, duration: number, easing: EasingFunction = Easing.Linear, onUpdate?: (value: number) => void): Tween {
        const tween = new Tween({ from, to }, duration, easing);
        if (onUpdate) {
            tween.onUpdate(onUpdate);
        }
        return tween.start();
    }
}

/**
 * Manages a collection of active tweens, updating them each frame.
 * Automatically removes completed tweens.
 *
 * @example
 * ```typescript
 * const manager = new TweenManager();
 *
 * // Add tweens
 * manager.add(new Tween({ from: 0, to: 100 }, 1).onUpdate(v => sprite.alpha = v / 100).start());
 *
 * // In game loop:
 * manager.update(deltaTime);
 * ```
 */
export class TweenManager {
    private _tweens: Tween[] = [];

    /**
     * Number of active (non-complete) tweens
     */
    public get count(): number {
        return this._tweens.length;
    }

    /**
     * Adds a tween to be managed. The tween should already be started.
     * @param tween - The tween to manage
     * @returns The added tween (for chaining)
     */
    public add(tween: Tween): Tween {
        this._tweens.push(tween);
        return tween;
    }

    /**
     * Updates all managed tweens and removes completed ones
     * @param deltaTime - Time elapsed since last frame in seconds
     */
    public update(deltaTime: number): void {
        for (let i = this._tweens.length - 1; i >= 0; i--) {
            const tween = this._tweens[i];
            tween.update(deltaTime);
            if (tween.isComplete) {
                this._tweens.splice(i, 1);
            }
        }
    }

    /**
     * Stops and removes all managed tweens
     */
    public stopAll(): void {
        for (const tween of this._tweens) {
            tween.stop();
        }
        this._tweens.length = 0;
    }

    /**
     * Disposes the manager and all its tweens
     */
    public dispose(): void {
        for (const tween of this._tweens) {
            tween.dispose();
        }
        this._tweens.length = 0;
    }
}
