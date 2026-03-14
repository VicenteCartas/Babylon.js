import type { ISprite2DRenderData } from "../Rendering/spriteBatchRenderer";
import type { RenderableNode2D } from "../Node2D/renderableNode2D";
import type { RectMask2D } from "./rectMask2D";
import type { SpriteMask2D } from "./spriteMask2D";

/**
 * Types of render commands in the 2D render pipeline.
 * @internal
 */
export const enum RenderCommandType {
    /** Draw a sprite quad */
    Sprite = 0,
    /** Push a rectangle scissor mask */
    PushRectMask = 1,
    /** Push a stencil-based sprite mask */
    PushSpriteMask = 2,
    /** Pop the most recent mask */
    PopMask = 3,
}

/**
 * Render command: draw a sprite quad.
 * @internal
 */
export interface ISpriteRenderCommand {
    readonly type: RenderCommandType.Sprite;
    /** The sprite's render data */
    spriteData: ISprite2DRenderData;
}

/**
 * Render command: push a rectangle scissor mask.
 * @internal
 */
export interface IPushRectMaskCommand {
    readonly type: RenderCommandType.PushRectMask;
    /** The rectangle mask to push */
    rectMask: RectMask2D;
    /** The node that owns the mask (needed for world transform → viewport rect) */
    maskOwner: RenderableNode2D;
}

/**
 * Render command: push a stencil-based sprite mask.
 * @internal
 */
export interface IPushSpriteMaskCommand {
    readonly type: RenderCommandType.PushSpriteMask;
    /** The sprite mask to push */
    spriteMask: SpriteMask2D;
    /** The node that owns the mask (needed for world transform context) */
    maskOwner: RenderableNode2D;
}

/**
 * Render command: pop the most recent mask.
 * Carries the original push command so the stencil buffer can
 * be restored (sprite masks need DECR re-render on pop).
 * @internal
 */
export interface IPopMaskCommand {
    readonly type: RenderCommandType.PopMask;
    /** The push command that opened this mask (for stencil DECR on sprite masks) */
    pushCommand: IPushRectMaskCommand | IPushSpriteMaskCommand;
}

/**
 * A render command in the 2D render pipeline.
 * Uses a discriminated union for type-safe switch exhaustiveness checking.
 * @internal
 */
export type RenderCommand2D = ISpriteRenderCommand | IPushRectMaskCommand | IPushSpriteMaskCommand | IPopMaskCommand;

