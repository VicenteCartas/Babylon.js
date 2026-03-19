import type { ThinTexture } from "core/Materials/Textures/thinTexture";
import { Texture } from "core/Materials/Textures/texture";
import { Color4 } from "core/Maths/math.color";
import { Constants } from "core/Engines/constants";

import { RenderableNode2D } from "../Node2D/renderableNode2D";
import { Rectangle2D } from "../Math/rectangle2D";
import type { ISprite2DRenderData } from "../Rendering/spriteBatchRenderer";
import type { Scene2D } from "../Scene2D/scene2D";
import { getSpriteSheetFrameMetadata } from "../SpriteSheet/spriteSheet";

/**
 * A 2D sprite that renders a textured quad.
 */
export class Sprite2D extends RenderableNode2D {
    private static _uvScratch: [number, number, number, number] = [0, 0, 1, 1];
    private _compatRenderDataPool: ISprite2DRenderData[] = [];
    private _resolvedSourceRect: Rectangle2D = new Rectangle2D();

    /**
     * The texture to render.
     */
    public texture: ThinTexture | null = null;

    /**
     * Source rectangle within the texture in pixels.
     */
    public sourceRect: Rectangle2D | null = null;

    /**
     * Color tint applied to the sprite.
     */
    public tint: Color4 = new Color4(1, 1, 1, 1);

    /**
     * Whether to flip the sprite horizontally.
     */
    public flipX: boolean = false;

    /**
     * Whether to flip the sprite vertically.
     */
    public flipY: boolean = false;

    /**
     * Alpha blending mode. Uses Babylon Constants.ALPHA_* values.
     */
    public alphaMode: number = Constants.ALPHA_COMBINE;

    /**
     * Display width of the sprite in pixels.
     */
    public width: number = 0;

    /**
     * Display height of the sprite in pixels.
     */
    public height: number = 0;

    /**
     * Creates a new Sprite2D.
     * @param name - Name of the sprite.
     * @param scene - Optional Scene2D. If omitted, uses the last created Scene2D.
     */
    constructor(name: string, scene?: Scene2D | null) {
        super(name, scene);
    }

    /**
     * Gets the effective display width.
     * @returns The display width in pixels.
     */
    public getDisplayWidth(): number {
        if (this.width > 0) {
            return this.width;
        }
        if (this.texture && this.sourceRect) {
            const resolvedSourceRect = this._getResolvedSourceRectToRef(this.texture, this._resolvedSourceRect);
            return getSpriteSheetFrameMetadata(this.sourceRect)?.sourceWidth ?? resolvedSourceRect.width;
        }
        if (this.texture) {
            return this.texture.getSize().width;
        }
        return 1;
    }

    /**
     * Gets the effective display height.
     * @returns The display height in pixels.
     */
    public getDisplayHeight(): number {
        if (this.height > 0) {
            return this.height;
        }
        if (this.texture && this.sourceRect) {
            const resolvedSourceRect = this._getResolvedSourceRectToRef(this.texture, this._resolvedSourceRect);
            return getSpriteSheetFrameMetadata(this.sourceRect)?.sourceHeight ?? resolvedSourceRect.height;
        }
        if (this.texture) {
            return this.texture.getSize().height;
        }
        return 1;
    }

    /**
     * Gets the source UV rectangle in normalized texture coordinates.
     * @returns An array of [u, v, uWidth, vHeight].
     */
    public getSourceUV(): [number, number, number, number] {
        const result: [number, number, number, number] = [0, 0, 1, 1];
        this.getSourceUVToRef(result);
        return result;
    }

    /**
     * Writes the source UV rectangle in normalized texture coordinates into the provided array.
     * @param result - A 4-element tuple to write [u, v, uWidth, vHeight] into.
     */
    public getSourceUVToRef(result: [number, number, number, number]): void {
        const texture = this.texture;
        if (!texture || !this.sourceRect) {
            result[0] = 0;
            result[1] = 0;
            result[2] = 1;
            result[3] = 1;
            return;
        }

        const size = texture.getSize();
        if (size.width === 0 || size.height === 0) {
            result[0] = 0;
            result[1] = 0;
            result[2] = 1;
            result[3] = 1;
            return;
        }

        const resolvedSourceRect = this._getResolvedSourceRectToRef(texture, this._resolvedSourceRect);
        result[0] = resolvedSourceRect.x / size.width;
        result[1] = resolvedSourceRect.y / size.height;
        result[2] = resolvedSourceRect.width / size.width;
        result[3] = resolvedSourceRect.height / size.height;
    }


/**
 * Resolves this sprite's logical local bounds for RectMask2D owner fallback.
 * @param out - Rectangle receiving the bounds.
 * @returns True when bounds were written.
 * @internal
 */
public override _getMaskLocalBounds(out: Rectangle2D): boolean {
    const width = this.getDisplayWidth();
    const height = this.getDisplayHeight();
    if (width <= 0 || height <= 0) {
        return false;
    }

    out.set(-width * 0.5, -height * 0.5, width, height);
    return true;
}

/**
 * Collects render data for this sprite into the provided list.
     * @param list - Array to push render data into.
     * @param fallbackTexture - White texture fallback when sprite has no texture.
     * @internal
     */
    public override _collectRenderData(list: ISprite2DRenderData[], fallbackTexture: ThinTexture): void {
        let renderData = this._compatRenderDataPool[list.length];
        if (!renderData) {
            renderData = {} as ISprite2DRenderData;
            this._compatRenderDataPool[list.length] = renderData;
        }

        if (!this._writeRenderDataTo(renderData, fallbackTexture, this.worldAlpha, this.worldScrollFactorX, this.worldScrollFactorY, this.worldZIndex, 0)) {
            return;
        }

        list.push(renderData);
    }

    /**
     * Writes this sprite's render data into a reusable struct.
     * @param target - The render-data struct to populate.
     * @param fallbackTexture - White fallback texture.
     * @param worldAlpha - Resolved world alpha.
     * @param worldScrollFactorX - Resolved world scroll factor X.
     * @param worldScrollFactorY - Resolved world scroll factor Y.
     * @param worldZIndex - Resolved world z-index.
     * @param insertionOrder - Stable insertion-order tiebreaker.
     * @returns True when render data was written.
     * @internal
     */
    public _writeRenderDataTo(
        target: ISprite2DRenderData,
        fallbackTexture: ThinTexture,
        worldAlpha: number,
        worldScrollFactorX: number,
        worldScrollFactorY: number,
        worldZIndex: number,
        insertionOrder: number
    ): boolean {
        const texture = this.texture ?? fallbackTexture;
        const textureSize = texture.getSize();
        const sourceRect = this.texture ? this._getResolvedSourceRectToRef(texture, this._resolvedSourceRect) : null;
        const frameMetadata = this.sourceRect ? getSpriteSheetFrameMetadata(this.sourceRect) : null;
        const logicalWidth = frameMetadata?.sourceWidth ?? sourceRect?.width ?? textureSize.width;
        const logicalHeight = frameMetadata?.sourceHeight ?? sourceRect?.height ?? textureSize.height;
        const displayWidth = this.width > 0 ? this.width : logicalWidth;
        const displayHeight = this.height > 0 ? this.height : logicalHeight;
        if (displayWidth <= 0 || displayHeight <= 0) {
            return false;
        }

        const scaleX = logicalWidth > 0 ? displayWidth / logicalWidth : 1;
        const scaleY = logicalHeight > 0 ? displayHeight / logicalHeight : 1;
        const trimX = frameMetadata?.trimX ?? 0;
        const trimY = frameMetadata?.trimY ?? 0;
        const trimWidth = frameMetadata?.trimWidth ?? sourceRect?.width ?? textureSize.width;
        const trimHeight = frameMetadata?.trimHeight ?? sourceRect?.height ?? textureSize.height;
        const localLeft = (-logicalWidth * 0.5 + trimX) * scaleX;
        const localTop = (-logicalHeight * 0.5 + trimY) * scaleY;
        const localRight = localLeft + trimWidth * scaleX;
        const localBottom = localTop + trimHeight * scaleY;

        let uvOriginU = 0;
        let uvOriginV = 0;
        let uvAxisXU = 1;
        let uvAxisXV = 0;
        let uvAxisYU = 0;
        let uvAxisYV = 1;
        const uv = Sprite2D._uvScratch;
        uv[0] = 0;
        uv[1] = 0;
        uv[2] = 1;
        uv[3] = 1;

        if (this.texture && sourceRect && textureSize.width > 0 && textureSize.height > 0) {
            this.getSourceUVToRef(uv);
            const u0 = uv[0];
            const u1 = uv[0] + uv[2];
            const storedTopV = texture instanceof Texture ? 1 - uv[1] : uv[1];
            const storedBottomV = texture instanceof Texture ? storedTopV - uv[3] : storedTopV + uv[3];
            const rotated = frameMetadata?.rotated === true;
            let topLeftU = rotated ? u1 : u0;
            let topLeftV = rotated ? storedTopV : storedTopV;
            let topRightU = rotated ? u1 : u1;
            let topRightV = rotated ? storedBottomV : storedTopV;
            let bottomRightU = rotated ? u0 : u1;
            let bottomRightV = rotated ? storedBottomV : storedBottomV;
            let bottomLeftU = rotated ? u0 : u0;
            let bottomLeftV = rotated ? storedTopV : storedBottomV;

            if (this.flipX) {
                const swappedTopLeftU = topRightU;
                const swappedTopLeftV = topRightV;
                const swappedTopRightU = topLeftU;
                const swappedTopRightV = topLeftV;
                const swappedBottomLeftU = bottomRightU;
                const swappedBottomLeftV = bottomRightV;
                const swappedBottomRightU = bottomLeftU;
                const swappedBottomRightV = bottomLeftV;
                topLeftU = swappedTopLeftU;
                topLeftV = swappedTopLeftV;
                topRightU = swappedTopRightU;
                topRightV = swappedTopRightV;
                bottomLeftU = swappedBottomLeftU;
                bottomLeftV = swappedBottomLeftV;
                bottomRightU = swappedBottomRightU;
                bottomRightV = swappedBottomRightV;
            }
            if (this.flipY) {
                const swappedTopLeftU = bottomLeftU;
                const swappedTopLeftV = bottomLeftV;
                const swappedTopRightU = bottomRightU;
                const swappedTopRightV = bottomRightV;
                const swappedBottomLeftU = topLeftU;
                const swappedBottomLeftV = topLeftV;
                const swappedBottomRightU = topRightU;
                const swappedBottomRightV = topRightV;
                topLeftU = swappedTopLeftU;
                topLeftV = swappedTopLeftV;
                topRightU = swappedTopRightU;
                topRightV = swappedTopRightV;
                bottomLeftU = swappedBottomLeftU;
                bottomLeftV = swappedBottomLeftV;
                bottomRightU = swappedBottomRightU;
                bottomRightV = swappedBottomRightV;
            }

            uvOriginU = topLeftU;
            uvOriginV = topLeftV;
            uvAxisXU = topRightU - topLeftU;
            uvAxisXV = topRightV - topLeftV;
            uvAxisYU = bottomLeftU - topLeftU;
            uvAxisYV = bottomLeftV - topLeftV;
        }

        const color: [number, number, number, number] = target.color ?? [1, 1, 1, 1];
        color[0] = this.tint.r;
        color[1] = this.tint.g;
        color[2] = this.tint.b;
        color[3] = this.tint.a * worldAlpha;

        const packedUvs: [number, number, number, number] = target.uvs ?? [0, 0, 1, 1];
        packedUvs[0] = uvOriginU;
        packedUvs[1] = uvOriginV;
        packedUvs[2] = uvOriginU + uvAxisXU + uvAxisYU;
        packedUvs[3] = uvOriginV + uvAxisXV + uvAxisYV;

        const scene = this.scene;
        target.worldTransform = this.worldTransform;
        target.texture = texture;
        target.uvs = packedUvs;
        target.color = color;
        target.width = displayWidth;
        target.height = displayHeight;
        target.alphaMode = this.alphaMode;
        target.sortKey = (this.sortingLayer << 16) | (worldZIndex & 0xffff);
        target.insertionOrder = insertionOrder;
        target.lit = scene !== null && scene.lightingManager !== null && this.sortingLayer < scene.unlitSortingLayerMin;
        target.scrollFactorX = worldScrollFactorX;
        target.scrollFactorY = worldScrollFactorY;
        target.localLeft = localLeft;
        target.localTop = localTop;
        target.localRight = localRight;
        target.localBottom = localBottom;
        target.uvOriginU = uvOriginU;
        target.uvOriginV = uvOriginV;
        target.uvAxisXU = uvAxisXU;
        target.uvAxisXV = uvAxisXV;
        target.uvAxisYU = uvAxisYU;
        target.uvAxisYV = uvAxisYV;
        return true;
    }

    /**
     * Resolves the active source rectangle, clamped to the texture bounds.
     * @param texture - The texture providing the bounds.
     * @param out - Output rectangle.
     * @returns The resolved rectangle.
     * @internal
     */
    public _getResolvedSourceRectToRef(texture: ThinTexture, out: Rectangle2D): Rectangle2D {
        const size = texture.getSize();
        const textureWidth = size.width;
        const textureHeight = size.height;
        const sourceRect = this.sourceRect;

        if (!sourceRect) {
            out.x = 0;
            out.y = 0;
            out.width = textureWidth;
            out.height = textureHeight;
            return out;
        }

        const left = Math.min(Math.max(sourceRect.x, 0), textureWidth);
        const top = Math.min(Math.max(sourceRect.y, 0), textureHeight);
        const right = Math.min(Math.max(sourceRect.x + Math.max(sourceRect.width, 0), 0), textureWidth);
        const bottom = Math.min(Math.max(sourceRect.y + Math.max(sourceRect.height, 0), 0), textureHeight);

        out.x = left;
        out.y = top;
        out.width = Math.max(0, right - left);
        out.height = Math.max(0, bottom - top);
        return out;
    }
}




