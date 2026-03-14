import type { BaseTexture } from "core/Materials/Textures/baseTexture";
import type { ThinTexture } from "core/Materials/Textures/thinTexture";
import { Texture } from "core/Materials/Textures/texture";

import { Matrix2D } from "../Math/matrix2D";
import type { ISprite2DRenderData } from "../Rendering/spriteBatchRenderer";
import { Sprite2D } from "../Sprite2D/sprite2D";

/**
 * A 9-slice (9-patch) sprite that can be resized without distorting its borders.
 */
export class NineSliceSprite2D extends Sprite2D {
    /** Left border width in source pixels. */
    public borderLeft: number = 0;
    /** Right border width in source pixels. */
    public borderRight: number = 0;
    /** Top border height in source pixels. */
    public borderTop: number = 0;
    /** Bottom border height in source pixels. */
    public borderBottom: number = 0;

    /**
     * Pre-allocated transform matrices for the 9 slices (avoids per-frame allocation).
     */
    private _sliceTransforms: Matrix2D[] = Array.from({ length: 9 }, () => Matrix2D.Identity());
    private _compatSliceRenderDataPool: ISprite2DRenderData[] = [];

    /**
     * Creates a new NineSliceSprite2D.
     * @param name - Node name.
     * @param texture - The texture containing the 9-slice source graphic.
     */
    constructor(name: string, texture?: BaseTexture) {
        super(name);
        if (texture) {
            this.texture = texture;
        }
    }

    /**
     * Sets all four border insets at once.
     * @param left - Left border width in source pixels.
     * @param right - Right border width in source pixels.
     * @param top - Top border height in source pixels.
     * @param bottom - Bottom border height in source pixels.
     * @returns This instance for chaining.
     */
    public setBorders(left: number, right: number, top: number, bottom: number): this {
        this.borderLeft = left;
        this.borderRight = right;
        this.borderTop = top;
        this.borderBottom = bottom;
        return this;
    }

    /**
     * Sets uniform border insets (same on all sides).
     * @param size - Border size in source pixels.
     * @returns This instance for chaining.
     */
    public setUniformBorders(size: number): this {
        this.borderLeft = size;
        this.borderRight = size;
        this.borderTop = size;
        this.borderBottom = size;
        return this;
    }

    /** @internal */
    public override _collectRenderData(list: ISprite2DRenderData[], fallbackTexture: ThinTexture): void {
        const startIndex = list.length;
        this._appendRenderData(list, fallbackTexture, this.worldAlpha, this.worldScrollFactorX, this.worldScrollFactorY, this.worldZIndex, 0, (index) => {
            const poolIndex = startIndex + index;
            let renderData = this._compatSliceRenderDataPool[poolIndex];
            if (!renderData) {
                renderData = {} as ISprite2DRenderData;
                this._compatSliceRenderDataPool[poolIndex] = renderData;
            }
            list.push(renderData);
            return renderData;
        });
    }

    /**
     * Appends this sprite's nine-slice quads into reusable render-data structs.
     * @param list - Output list.
     * @param fallbackTexture - White fallback texture.
     * @param worldAlpha - Resolved world alpha.
     * @param worldScrollFactorX - Resolved world scroll factor X.
     * @param worldScrollFactorY - Resolved world scroll factor Y.
     * @param worldZIndex - Resolved world z-index.
     * @param insertionOrderStart - Starting insertion-order value.
     * @param allocator - Allocator for reusable render-data entries.
     * @returns Number of emitted quads.
     * @internal
     */
    public _appendRenderData(
        list: ISprite2DRenderData[],
        fallbackTexture: ThinTexture,
        worldAlpha: number,
        worldScrollFactorX: number,
        worldScrollFactorY: number,
        worldZIndex: number,
        insertionOrderStart: number,
        allocator: (index: number) => ISprite2DRenderData
    ): number {
        const displayWidth = this.getDisplayWidth();
        const displayHeight = this.getDisplayHeight();
        if (displayWidth <= 0 || displayHeight <= 0) {
            return 0;
        }

        const texture = this.texture ?? fallbackTexture;
        const textureSize = this.texture ? this.texture.getSize() : { width: 1, height: 1 };
        const textureWidth = textureSize.width;
        const textureHeight = textureSize.height;

        const sourceX = this.sourceRect ? this.sourceRect.x : 0;
        const sourceY = this.sourceRect ? this.sourceRect.y : 0;
        const sourceWidth = this.sourceRect ? this.sourceRect.width : textureWidth;
        const sourceHeight = this.sourceRect ? this.sourceRect.height : textureHeight;

        let borderLeft = this.borderLeft;
        let borderRight = this.borderRight;
        let borderTop = this.borderTop;
        let borderBottom = this.borderBottom;

        const horizontalScale = borderLeft + borderRight > displayWidth ? displayWidth / (borderLeft + borderRight) : 1;
        const verticalScale = borderTop + borderBottom > displayHeight ? displayHeight / (borderTop + borderBottom) : 1;
        borderLeft *= horizontalScale;
        borderRight *= horizontalScale;
        borderTop *= verticalScale;
        borderBottom *= verticalScale;

        const centerWidth = Math.max(0, displayWidth - borderLeft - borderRight);
        const middleHeight = Math.max(0, displayHeight - borderTop - borderBottom);

        const sourceLeft = this.borderLeft;
        const sourceRight = this.borderRight;
        const sourceTop = this.borderTop;
        const sourceBottom = this.borderBottom;
        const sourceCenterWidth = Math.max(0, sourceWidth - sourceLeft - sourceRight);
        const sourceMiddleHeight = Math.max(0, sourceHeight - sourceTop - sourceBottom);

        const worldTransform = this.worldTransform.m;
        const tintR = this.tint.r;
        const tintG = this.tint.g;
        const tintB = this.tint.b;
        const tintA = this.tint.a * worldAlpha;
        const sortingLayer = this.sortingLayer;
        const invertY = this.texture instanceof Texture ? this.texture.invertY : true;

        const columns = [
            { x: -displayWidth / 2 + borderLeft / 2, width: borderLeft, sourceX, sourceWidth: sourceLeft },
            { x: -displayWidth / 2 + borderLeft + centerWidth / 2, width: centerWidth, sourceX: sourceX + sourceLeft, sourceWidth: sourceCenterWidth },
            { x: displayWidth / 2 - borderRight / 2, width: borderRight, sourceX: sourceX + sourceWidth - sourceRight, sourceWidth: sourceRight },
        ];
        const rows = [
            { y: -displayHeight / 2 + borderTop / 2, height: borderTop, sourceY, sourceHeight: sourceTop },
            { y: -displayHeight / 2 + borderTop + middleHeight / 2, height: middleHeight, sourceY: sourceY + sourceTop, sourceHeight: sourceMiddleHeight },
            { y: displayHeight / 2 - borderBottom / 2, height: borderBottom, sourceY: sourceY + sourceHeight - sourceBottom, sourceHeight: sourceBottom },
        ];

        let emittedCount = 0;
        let sliceIndex = 0;
        for (const row of rows) {
            for (const column of columns) {
                if (column.width <= 0 || row.height <= 0) {
                    sliceIndex++;
                    continue;
                }

                const cx = column.x;
                const cy = row.y;
                const sliceTransform = this._sliceTransforms[sliceIndex];
                sliceTransform.m[0] = worldTransform[0];
                sliceTransform.m[1] = worldTransform[1];
                sliceTransform.m[2] = worldTransform[2];
                sliceTransform.m[3] = worldTransform[3];
                sliceTransform.m[4] = worldTransform[0] * cx + worldTransform[2] * cy + worldTransform[4];
                sliceTransform.m[5] = worldTransform[1] * cx + worldTransform[3] * cy + worldTransform[5];

                const renderData = allocator(emittedCount);
                renderData.worldTransform = sliceTransform;
                renderData.width = column.width;
                renderData.height = row.height;
                renderData.r = tintR;
                renderData.g = tintG;
                renderData.b = tintB;
                renderData.a = tintA;
                renderData.cellU = textureWidth > 0 ? column.sourceX / textureWidth : 0;
                renderData.cellV = textureHeight > 0 ? row.sourceY / textureHeight : 0;
                renderData.cellW = textureWidth > 0 ? column.sourceWidth / textureWidth : 0;
                renderData.cellH = textureHeight > 0 ? row.sourceHeight / textureHeight : 0;
                renderData.flipX = this.flipX;
                renderData.flipY = this.flipY;
                renderData.invertY = invertY;
                renderData.texture = texture;
                renderData.zIndex = worldZIndex;
                renderData.sortingLayer = sortingLayer;
                renderData.scrollFactorX = worldScrollFactorX;
                renderData.scrollFactorY = worldScrollFactorY;
                renderData.insertionOrder = insertionOrderStart + emittedCount;
                emittedCount++;
                sliceIndex++;
            }
        }

        return emittedCount;
    }
}
