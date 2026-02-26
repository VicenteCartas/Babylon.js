import type { ThinTexture } from "core/Materials/Textures/thinTexture";
import { Texture } from "core/Materials/Textures/texture";
import { Color4 } from "core/Maths/math.color";
import { Constants } from "core/Engines/constants";

import { Node2D } from "../Node2D/node2D";
import { Rectangle2D } from "../Math/rectangle2D";
import type { ISprite2DRenderData } from "../Rendering/spriteBatchRenderer";
import type { Scene2D } from "../Scene2D/scene2D";

/**
 * A 2D sprite that renders a textured quad.
 * Extends Node2D with texture, tint, flip, and alpha blending properties.
 */
export class Sprite2D extends Node2D {
    private static _uvScratch: [number, number, number, number] = [0, 0, 1, 1];

    /**
     * The texture to render.
     * Accepts any ThinTexture subclass (BaseTexture, HtmlElementTexture, etc.)
     * or a raw ThinTexture (e.g. from RenderTexture2D).
     */
    public texture: ThinTexture | null = null;

    /**
     * Source rectangle within the texture in pixels.
     * If null, the entire texture is used.
     */
    public sourceRect: Rectangle2D | null = null;

    /**
     * Color tint applied to the sprite (multiplied with texture color)
     */
    public tint: Color4 = new Color4(1, 1, 1, 1);

    /**
     * Whether to flip the sprite horizontally
     */
    public flipX: boolean = false;

    /**
     * Whether to flip the sprite vertically
     */
    public flipY: boolean = false;

    /**
     * Alpha blending mode. Uses Babylon's Constants.ALPHA_* values.
     * Default is ALPHA_COMBINE (standard transparency).
     */
    public alphaMode: number = Constants.ALPHA_COMBINE;

    /**
     * Display width of the sprite in pixels.
     * If 0, uses the texture width (or sourceRect width).
     */
    public width: number = 0;

    /**
     * Display height of the sprite in pixels.
     * If 0, uses the texture height (or sourceRect height).
     */
    public height: number = 0;

    /**
     * Creates a new Sprite2D
     * @param name - Name of the sprite
     * @param scene - Optional Scene2D. If omitted, uses the last created Scene2D.
     */
    constructor(name: string, scene?: Scene2D | null) {
        super(name, scene);
    }

    /**
     * Gets the effective display width (accounting for sourceRect and texture size)
     * @returns The display width in pixels
     */
    public getDisplayWidth(): number {
        if (this.width > 0) {
            return this.width;
        }
        if (this.sourceRect) {
            return this.sourceRect.width;
        }
        if (this.texture) {
            const size = this.texture.getSize();
            return size.width;
        }
        return 0;
    }

    /**
     * Gets the effective display height (accounting for sourceRect and texture size)
     * @returns The display height in pixels
     */
    public getDisplayHeight(): number {
        if (this.height > 0) {
            return this.height;
        }
        if (this.sourceRect) {
            return this.sourceRect.height;
        }
        if (this.texture) {
            const size = this.texture.getSize();
            return size.height;
        }
        return 0;
    }

    /**
     * Gets the source UV rectangle in normalized texture coordinates [u, v, uWidth, vHeight].
     * If sourceRect is null, returns [0, 0, 1, 1] (entire texture).
     * @returns An array of [u, v, uWidth, vHeight]
     */
    public getSourceUV(): [number, number, number, number] {
        if (!this.sourceRect || !this.texture) {
            return [0, 0, 1, 1];
        }
        const size = this.texture.getSize();
        if (size.width === 0 || size.height === 0) {
            return [0, 0, 1, 1];
        }
        return [this.sourceRect.x / size.width, this.sourceRect.y / size.height, this.sourceRect.width / size.width, this.sourceRect.height / size.height];
    }

    /**
     * Writes the source UV rectangle in normalized texture coordinates into the provided array.
     * If sourceRect is null, writes [0, 0, 1, 1] (entire texture).
     * This is the allocation-free alternative to {@link getSourceUV}.
     * @param result - A 4-element tuple to write [u, v, uWidth, vHeight] into
     */
    public getSourceUVToRef(result: [number, number, number, number]): void {
        if (!this.sourceRect || !this.texture) {
            result[0] = 0;
            result[1] = 0;
            result[2] = 1;
            result[3] = 1;
            return;
        }
        const size = this.texture.getSize();
        if (size.width === 0 || size.height === 0) {
            result[0] = 0;
            result[1] = 0;
            result[2] = 1;
            result[3] = 1;
            return;
        }
        result[0] = this.sourceRect.x / size.width;
        result[1] = this.sourceRect.y / size.height;
        result[2] = this.sourceRect.width / size.width;
        result[3] = this.sourceRect.height / size.height;
    }

    /**
     * Collects render data for this sprite into the provided list.
     * Override in subclasses (e.g., NineSliceSprite2D) to emit multiple quads.
     * @param list - Array to push render data into
     * @param fallbackTexture - White texture fallback when sprite has no texture
     * @internal
     */
    public _collectRenderData(list: ISprite2DRenderData[], fallbackTexture: ThinTexture): void {
        const w = this.getDisplayWidth();
        const h = this.getDisplayHeight();
        if (w <= 0 || h <= 0) {
            return;
        }
        const uv = Sprite2D._uvScratch;
        this.getSourceUVToRef(uv);
        list.push({
            worldTransform: this.worldTransform,
            width: w,
            height: h,
            r: this.tint.r,
            g: this.tint.g,
            b: this.tint.b,
            a: this.tint.a * this.worldAlpha,
            cellU: uv[0],
            cellV: uv[1],
            cellW: uv[2],
            cellH: uv[3],
            flipX: this.flipX,
            flipY: this.flipY,
            invertY: this.texture instanceof Texture ? this.texture.invertY : true,
            texture: this.texture ?? fallbackTexture,
            zIndex: this.worldZIndex,
            sortingLayer: this.sortingLayer,
            scrollFactorX: this.worldScrollFactorX,
            scrollFactorY: this.worldScrollFactorY,
        });
    }
}
