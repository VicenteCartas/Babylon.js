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
    /** Push a rectangle scissor/stencil mask */
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
 * Render command: push a rectangle mask.
 * @internal
 */
export interface IPushRectMaskCommand {
    readonly type: RenderCommandType.PushRectMask;
    /** The rectangle mask to push */
    rectMask: RectMask2D;
    /** The node that owns the mask (needed for local-to-world conversion) */
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
    /** The node that owns the mask */
    maskOwner: RenderableNode2D;
}

/**
 * Render command: pop the most recent mask.
 * @internal
 */
export interface IPopMaskCommand {
    readonly type: RenderCommandType.PopMask;
}

/**
 * Union of mask push commands.
 * @internal
 */
export type MaskPushRenderCommand = IPushRectMaskCommand | IPushSpriteMaskCommand;

/**
 * A render command in the 2D render pipeline.
 * Uses a discriminated union for type-safe switch exhaustiveness checking.
 * @internal
 */
export type RenderCommand2D = ISpriteRenderCommand | MaskPushRenderCommand | IPopMaskCommand;
