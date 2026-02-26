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
    /** Stack tracking which type of mask was pushed (for correct pop behavior) */
    private _maskTypeStack: ("rect" | "sprite")[] = [];
    private _stencilLevel: number = 0;
    /** Stack of active scissor rects in viewport pixels (Y-down) */
    private _scissorRectStack: Rectangle2D[] = [];
    /** Viewport height — needed for Y-down → GL-Y-up conversion in scissor calls */
    private _viewportHeight: number = 0;
    /** Whether the engine supports scissor test */
    private _hasScissor: boolean;
    /** Whether a stencil unavailability warning has been shown */
    private _stencilWarnShown: boolean = false;
    /** Reusable scratch Rectangle2D to avoid per-frame allocations */
    private _tempRect: Rectangle2D = new Rectangle2D();

    constructor(engine: AbstractEngine) {
        this._engine = engine;
        this._hasScissor = "enableScissor" in engine;
    }

    /**
     * Whether any mask is currently active (used for fast-path branching)
     */
    public get hasMasks(): boolean {
        return this._maskTypeStack.length > 0;
    }

    /**
     * Current stencil nesting depth (0 = no stencil masks active)
     */
    public get stencilLevel(): number {
        return this._stencilLevel;
    }

    /**
     * Sets the viewport height for scissor Y-flip calculations.
     * Must be called before any push operations each frame.
     * @param height - Viewport height in pixels
     */
    public setViewportHeight(height: number): void {
        this._viewportHeight = height;
    }

    /**
     * Push a rectangle mask. Enables scissor test with the intersection
     * of the new rect and any currently active scissor rect.
     * @param rect - The rectangle in viewport pixels (Y-down)
     * @param inverted - Whether the mask is inverted (falls back to stencil)
     */
    public pushRectMask(rect: Rectangle2D, inverted: boolean): void {
        if (inverted) {
            // Inverted rect masks use stencil (scissor can't clip AWAY from a rect)
            this._pushStencilMask(inverted);
            this._maskTypeStack.push("sprite"); // Uses stencil path for pop
            return;
        }

        // Compute the effective scissor rect (intersection with current stack top)
        let effectiveRect: Rectangle2D;
        if (this._scissorRectStack.length > 0) {
            Rectangle2D.IntersectToRef(this._scissorRectStack[this._scissorRectStack.length - 1], rect, this._tempRect);
            effectiveRect = this._tempRect.clone();
        } else {
            effectiveRect = rect.clone();
        }

        this._scissorRectStack.push(effectiveRect);
        this._maskTypeStack.push("rect");

        // Apply the scissor rect (convert Y-down to GL Y-up)
        this._applyScissor(effectiveRect);
    }

    /**
     * Push a sprite stencil mask. Expects the caller to have already:
     * 1. Flushed the current sprite batch
     * 2. Rendered the mask sprite into the stencil buffer with INCR
     *
     * This method configures stencil state for the subsequent masked content.
     * @param inverted - Whether the mask is inverted
     */
    public pushSpriteMask(inverted: boolean): void {
        this._pushStencilMask(inverted);
        this._maskTypeStack.push("sprite");
    }

    /**
     * Pop the most recent mask. The caller must flush the sprite batch
     * before calling this. For sprite masks, the caller must also
     * re-render the mask sprite with DECR before calling this.
     */
    public popMask(): void {
        if (this._maskTypeStack.length === 0) {
            return;
        }

        const maskType = this._maskTypeStack.pop()!;

        if (maskType === "rect") {
            this._scissorRectStack.pop();
            if (this._scissorRectStack.length > 0) {
                // Restore the parent scissor rect
                this._applyScissor(this._scissorRectStack[this._scissorRectStack.length - 1]);
            } else {
                // No more scissor masks — disable
                this._disableScissor();
            }
        } else {
            // Sprite mask — decrement stencil level
            this._stencilLevel--;
            const engine = this._engine!;
            if (this._stencilLevel > 0) {
                // Restore stencil test for the parent mask level
                engine.setStencilBuffer(true);
                engine.setStencilMask(0x00);
                engine.setStencilFunction(Constants.EQUAL);
                engine.setStencilFunctionReference(this._stencilLevel);
                engine.setStencilOperationPass(Constants.KEEP);
                engine.setStencilOperationFail(Constants.KEEP);
                engine.setStencilOperationDepthFail(Constants.KEEP);
            } else {
                // No more stencil masks — disable stencil test
                engine.setStencilBuffer(false);
            }
        }
    }

    /**
     * Configure stencil state for rendering a mask sprite INTO the stencil buffer.
     * Call this BEFORE rendering the mask sprite. After rendering, call pushSpriteMask().
     * @internal
     */
    public beginStencilMaskWrite(): void {
        const engine = this._engine!;

        // Check stencil buffer availability
        if (!this._stencilWarnShown && !(engine as any).isStencilEnable) {
            Logger.Warn("SpriteMask2D requires a stencil buffer. Enable stencil in the engine options.");
            this._stencilWarnShown = true;
        }

        engine.setStencilBuffer(true);
        engine.setStencilFunctionReference(this._stencilLevel);
        engine.setStencilFunction(Constants.ALWAYS);
        engine.setStencilOperationPass(Constants.INCR);
        engine.setStencilOperationFail(Constants.KEEP);
        engine.setStencilOperationDepthFail(Constants.KEEP);
        engine.setStencilMask(0xff);
    }

    /**
     * Configure stencil state for erasing a mask sprite FROM the stencil buffer.
     * Call this BEFORE re-rendering the mask sprite on pop. The stencil operation
     * uses DECR to undo the INCR from the original write.
     * @internal
     */
    public beginStencilMaskErase(): void {
        const engine = this._engine!;
        engine.setStencilBuffer(true);
        engine.setStencilFunctionReference(this._stencilLevel);
        engine.setStencilFunction(Constants.ALWAYS);
        engine.setStencilOperationPass(Constants.DECR);
        engine.setStencilOperationFail(Constants.KEEP);
        engine.setStencilOperationDepthFail(Constants.KEEP);
        engine.setStencilMask(0xff);
    }

    /**
     * Reset all mask state. Called at the start of each frame.
     */
    public reset(): void {
        this._maskTypeStack.length = 0;
        this._scissorRectStack.length = 0;
        this._stencilLevel = 0;
        this._disableScissor();
        this._engine!.setStencilBuffer(false);
    }

    /**
     * Dispose and release references.
     */
    public dispose(): void {
        this._maskTypeStack.length = 0;
        this._scissorRectStack.length = 0;
        this._stencilLevel = 0;
        this._engine = null;
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    private _pushStencilMask(inverted: boolean): void {
        this._stencilLevel++;
        const engine = this._engine!;
        engine.setStencilBuffer(true);
        engine.setStencilMask(0x00); // Don't write during content rendering
        if (inverted) {
            engine.setStencilFunction(Constants.NOTEQUAL);
        } else {
            engine.setStencilFunction(Constants.EQUAL);
        }
        engine.setStencilFunctionReference(this._stencilLevel);
        engine.setStencilOperationPass(Constants.KEEP);
        engine.setStencilOperationFail(Constants.KEEP);
        engine.setStencilOperationDepthFail(Constants.KEEP);
    }

    private _applyScissor(rect: Rectangle2D): void {
        if (!this._hasScissor) {
            return;
        }
        // Convert Y-down viewport coords to GL Y-up
        const glY = this._viewportHeight - rect.y - rect.height;
        (this._engine as unknown as IScissorEngine).enableScissor(rect.x, glY, rect.width, rect.height);
    }

    private _disableScissor(): void {
        if (!this._hasScissor) {
            return;
        }
        (this._engine as unknown as IScissorEngine).disableScissor();
    }
}
