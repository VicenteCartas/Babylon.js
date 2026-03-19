import type { AbstractEngine } from "core/Engines/abstractEngine";
import { Constants } from "core/Engines/constants";
import { Logger } from "core/Misc/logger";

import { Rectangle2D } from "../Math/rectangle2D";

/** @internal Typed interface for engines that support scissor test */
interface IScissorEngine {
    enableScissor(x: number, y: number, width: number, height: number): void;
    disableScissor(): void;
}

/**
 * Manages the GPU mask state (scissor and stencil) during 2D rendering.
 * Maintains a stack of active masks and applies/removes GPU state as needed.
 *
 * This is an internal helper used by Scene2D — not part of the public API.
 * @internal
 */
export class MaskStateManager {
    private _engine: AbstractEngine | null;
    /** Stack tracking which mask backend was pushed (for correct pop behavior). */
    private _maskTypeStack: ("rect" | "stencil")[] = [];
    /** Stack of stencil inversion flags for restoring parent stencil state. */
    private _stencilInversionStack: boolean[] = [];
    private _stencilLevel: number = 0;
    /** Stack of active scissor rects in viewport pixels (Y-down). */
    private _scissorRectStack: Rectangle2D[] = [];
    /** Reusable scissor rect instances to avoid per-frame allocations. */
    private _scissorRectPool: Rectangle2D[] = [];
    /** Viewport height — needed for Y-down → GL-Y-up conversion in scissor calls. */
    private _viewportHeight: number = 0;
    /** Engine scissor support, when available. */
    private _scissorEngine: IScissorEngine | null;
    /** Whether a stencil unavailability warning has been shown. */
    private _stencilWarnShown: boolean = false;

    /**
     * Creates a new mask state manager.
     * @param engine - The engine whose GPU mask state will be managed.
     */
    constructor(engine: AbstractEngine) {
        this._engine = engine;
        this._scissorEngine = this._getScissorEngine(engine);
    }

    /**
     * Whether any mask is currently active.
     * @returns True when any mask is active.
     */
    public get hasMasks(): boolean {
        return this._maskTypeStack.length > 0;
    }

    /**
     * Current stencil nesting depth (0 = no stencil masks active).
     * @returns The active stencil nesting depth.
     */
    public get stencilLevel(): number {
        return this._stencilLevel;
    }

    /**
     * Sets the viewport height for scissor Y-flip calculations.
     * Must be called before any push operations each frame.
     * @param height - Viewport height in pixels.
     * @returns Nothing.
     */
    public setViewportHeight(height: number): void {
        this._viewportHeight = height;
    }

    /**
     * Pushes a rectangle mask.
     * Non-inverted rect masks use the scissor stack; inverted rect masks use stencil.
     * @param rect - The rectangle in viewport pixels (Y-down).
     * @param inverted - Whether the mask is inverted.
     * @returns Nothing.
     */
    public pushRectMask(rect: Rectangle2D, inverted: boolean): void {
        if (inverted) {
            this._pushStencilMask(true);
            this._maskTypeStack.push("stencil");
            return;
        }

        const effectiveRect = this._acquireScissorRect();
        if (this._scissorRectStack.length > 0) {
            this._scissorRectStack[this._scissorRectStack.length - 1].intersectToRef(rect, effectiveRect);
        } else {
            effectiveRect.copyFrom(rect);
        }

        this._scissorRectStack.push(effectiveRect);
        this._maskTypeStack.push("rect");
        this._applyScissor(effectiveRect);
    }

    /**
     * Pushes a sprite stencil mask. The caller must already have flushed the batch
     * and rendered the mask shape into the stencil buffer.
     * @param inverted - Whether the mask is inverted.
     * @returns Nothing.
     */
    public pushSpriteMask(inverted: boolean): void {
        this._pushStencilMask(inverted);
        this._maskTypeStack.push("stencil");
    }

    /**
     * Pops the most recent mask and restores the previous GPU mask state.
     * @returns Nothing.
     */
    public popMask(): void {
        if (this._maskTypeStack.length === 0) {
            return;
        }

        const maskType = this._maskTypeStack.pop()!;
        if (maskType === "rect") {
            const rect = this._scissorRectStack.pop();
            if (rect) {
                this._scissorRectPool.push(rect);
            }

            if (this._scissorRectStack.length > 0) {
                this._applyScissor(this._scissorRectStack[this._scissorRectStack.length - 1]);
            } else {
                this._disableScissor();
            }
            return;
        }

        this._stencilInversionStack.pop();
        this._stencilLevel--;

        const engine = this._engine;
        if (!engine) {
            return;
        }

        if (this._stencilLevel > 0) {
            this._applyStencilContentState(this._stencilLevel, this._stencilInversionStack[this._stencilInversionStack.length - 1]);
        } else {
            engine.setStencilBuffer(false);
        }
    }

    /**
     * Configures stencil state for writing the next mask shape into stencil.
     * Nested mask writes are clipped by the current stencil-visible region.
     * @returns Nothing.
     * @internal
     */
    public beginStencilMaskWrite(): void {
        const engine = this._engine;
        if (!engine) {
            return;
        }

        this._warnIfStencilUnavailable();

        engine.setStencilBuffer(true);
        engine.setStencilMask(0xff);

        if (this._stencilLevel > 0) {
            engine.setStencilFunction(this._stencilInversionStack[this._stencilInversionStack.length - 1] ? Constants.NOTEQUAL : Constants.EQUAL);
            engine.setStencilFunctionReference(this._stencilLevel);
        } else {
            engine.setStencilFunction(Constants.ALWAYS);
            engine.setStencilFunctionReference(0);
        }

        engine.setStencilOperationPass(Constants.INCR);
        engine.setStencilOperationFail(Constants.KEEP);
        engine.setStencilOperationDepthFail(Constants.KEEP);
    }

    /**
     * Configures stencil state for erasing the current mask shape from stencil.
     * @returns Nothing.
     * @internal
     */
    public beginStencilMaskErase(): void {
        const engine = this._engine;
        if (!engine) {
            return;
        }

        this._warnIfStencilUnavailable();

        engine.setStencilBuffer(true);
        engine.setStencilMask(0xff);
        engine.setStencilFunction(Constants.EQUAL);
        engine.setStencilFunctionReference(this._stencilLevel);
        engine.setStencilOperationPass(Constants.DECR);
        engine.setStencilOperationFail(Constants.KEEP);
        engine.setStencilOperationDepthFail(Constants.KEEP);
    }

    /**
     * Resets all mask state. Called at the start of each frame.
     * @returns Nothing.
     */
    public reset(): void {
        this._maskTypeStack.length = 0;
        this._stencilInversionStack.length = 0;
        while (this._scissorRectStack.length > 0) {
            this._scissorRectPool.push(this._scissorRectStack.pop()!);
        }
        this._stencilLevel = 0;
        this._disableScissor();

        const engine = this._engine;
        if (!engine) {
            return;
        }

        engine.setStencilBuffer(false);
    }

    /**
     * Disposes and releases references.
     * @returns Nothing.
     */
    public dispose(): void {
        this.reset();
        this._engine = null;
        this._scissorEngine = null;
    }

    private _pushStencilMask(inverted: boolean): void {
        this._warnIfStencilUnavailable();
        this._stencilInversionStack.push(inverted);
        this._stencilLevel++;
        this._applyStencilContentState(this._stencilLevel, inverted);
    }

    private _applyStencilContentState(level: number, inverted: boolean): void {
        const engine = this._engine;
        if (!engine) {
            return;
        }

        engine.setStencilBuffer(true);
        engine.setStencilMask(0x00);
        engine.setStencilFunction(inverted ? Constants.NOTEQUAL : Constants.EQUAL);
        engine.setStencilFunctionReference(level);
        engine.setStencilOperationPass(Constants.KEEP);
        engine.setStencilOperationFail(Constants.KEEP);
        engine.setStencilOperationDepthFail(Constants.KEEP);
    }

    private _applyScissor(rect: Rectangle2D): void {
        if (!this._scissorEngine) {
            return;
        }

        const glY = this._viewportHeight - rect.y - rect.height;
        this._scissorEngine.enableScissor(rect.x, glY, rect.width, rect.height);
    }

    private _disableScissor(): void {
        if (!this._scissorEngine) {
            return;
        }

        this._scissorEngine.disableScissor();
    }

    private _acquireScissorRect(): Rectangle2D {
        return this._scissorRectPool.pop() ?? new Rectangle2D();
    }

    private _warnIfStencilUnavailable(): void {
        const engine = this._engine;
        if (!engine || this._stencilWarnShown || engine.isStencilEnable) {
            return;
        }

        Logger.Warn("2D masking requires a stencil buffer for SpriteMask2D and inverted RectMask2D. Enable stencil in the engine options.");
        this._stencilWarnShown = true;
    }

    private _getScissorEngine(engine: AbstractEngine): IScissorEngine | null {
        const scissorEngine = engine as AbstractEngine & Partial<IScissorEngine>;
        if (typeof scissorEngine.enableScissor !== "function" || typeof scissorEngine.disableScissor !== "function") {
            return null;
        }

        return scissorEngine as AbstractEngine & IScissorEngine;
    }
}
