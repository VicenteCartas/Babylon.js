import type { Sprite2D } from "../Sprite2D/sprite2D";
import type { IMask2D } from "./iMask2D";

/**
 * A stencil-based mask that uses a Sprite2D's rendered alpha to define
 * the visible region. Pixels where the mask sprite's alpha exceeds the
 * threshold are visible; pixels below the threshold are clipped.
 *
 * Use cases: health bars, shaped cutouts, reveal effects, fog-of-war borders.
 *
 * The mask sprite can be animated (e.g., sliding a gradient texture to create
 * a wipe reveal). The mask sprite does NOT need to be added to the scene's
 * display list — it can exist solely as a mask.
 *
 * If using an AnimatedSprite2D as the mask sprite with scene=null, you must
 * call maskSprite.update(deltaTime) manually to tick the animation.
 *
 * Supports nesting: nested SpriteMask2D instances increment the stencil
 * reference value, allowing up to 255 levels of nesting (8-bit stencil).
 *
 * @example
 * ```typescript
 * const maskSprite = new Sprite2D("mask", null);
 * maskSprite.texture = circleTexture;
 *
 * const container = new Node2D("masked", scene);
 * container.mask = new SpriteMask2D(maskSprite);
 * container.addChild(contentSprite);
 * ```
 */
export class SpriteMask2D implements IMask2D {
    /**
     * Whether this mask is currently enabled
     */
    public enabled: boolean = true;

    /**
     * Whether to invert the mask.
     * When inverted, pixels where the mask sprite IS opaque become hidden.
     */
    public inverted: boolean = false;

    /**
     * The sprite whose rendered alpha defines the mask shape.
     * This sprite's texture, transform, and alpha are all used.
     * The sprite does NOT need to be in the scene's display list.
     */
    public sprite: Sprite2D;

    /**
     * Alpha threshold (0–1). Mask pixels with alpha >= threshold pass the
     * stencil test; pixels below are clipped. Default: 0.5.
     *
     * Lower values = more permissive mask (semi-transparent areas visible).
     * Higher values = stricter mask (only fully opaque areas visible).
     */
    public alphaThreshold: number = 0.5;

    /**
     * Creates a new SpriteMask2D.
     * @param sprite - The Sprite2D to use as the mask shape
     * @param alphaThreshold - Alpha cutoff for the stencil test (default: 0.5)
     */
    constructor(sprite: Sprite2D, alphaThreshold: number = 0.5) {
        this.sprite = sprite;
        this.alphaThreshold = alphaThreshold;
    }

    /**
     * Disposes this mask and clears the sprite reference.
     * Does NOT dispose the sprite itself (the caller owns it).
     */
    public dispose(): void {
        this.sprite = null!;
    }
}
