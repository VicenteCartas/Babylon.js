import type { ThinTexture } from "core/Materials/Textures/thinTexture";
import { Texture } from "core/Materials/Textures/texture";

import { Rectangle2D } from "../Math/rectangle2D";
import { Matrix2D } from "../Math/matrix2D";
import type { ISprite2DRenderData } from "../Rendering/spriteBatchRenderer";
import type { Scene2D } from "../Scene2D/scene2D";
import { Sprite2D } from "../Sprite2D/sprite2D";

/**
 * A 9-slice sprite that can be resized without distorting its borders.
 */
export class NineSliceSprite2D extends Sprite2D {
    /** Left slice width in source pixels. */
    public sliceLeft: number = 0;
    /** Right slice width in source pixels. */
    public sliceRight: number = 0;
    /** Top slice height in source pixels. */
    public sliceTop: number = 0;
    /** Bottom slice height in source pixels. */
    public sliceBottom: number = 0;

    /** @internal */
    public get borderLeft(): number {
        return this.sliceLeft;
    }

    public set borderLeft(value: number) {
        this.sliceLeft = value;
    }

    /** @internal */
    public get borderRight(): number {
        return this.sliceRight;
    }

    public set borderRight(value: number) {
        this.sliceRight = value;
    }

    /** @internal */
    public get borderTop(): number {
        return this.sliceTop;
    }

    public set borderTop(value: number) {
        this.sliceTop = value;
    }

    /** @internal */
    public get borderBottom(): number {
        return this.sliceBottom;
    }

    public set borderBottom(value: number) {
        this.sliceBottom = value;
    }

    private _sliceTransforms: Matrix2D[] = Array.from({ length: 9 }, () => Matrix2D.Identity());
    private _compatSliceRenderDataPool: ISprite2DRenderData[] = [];
    private _nineSliceResolvedSourceRect: Rectangle2D = new Rectangle2D();
    private _columnCenters: Float32Array = new Float32Array(3);
    private _columnWidths: Float32Array = new Float32Array(3);
    private _columnSourceXs: Float32Array = new Float32Array(3);
    private _columnSourceWidths: Float32Array = new Float32Array(3);
    private _rowCenters: Float32Array = new Float32Array(3);
    private _rowHeights: Float32Array = new Float32Array(3);
    private _rowSourceYs: Float32Array = new Float32Array(3);
    private _rowSourceHeights: Float32Array = new Float32Array(3);

    /**
     * Creates a new NineSliceSprite2D.
     * @param name - Node name.
     * @param texture - The texture containing the 9-slice source graphic.
     * @param scene - Optional owning scene.
     */
    constructor(name: string, texture?: ThinTexture, scene?: Scene2D | null) {
        super(name, scene);
        if (texture) {
            this.texture = texture;
        }
    }

    /**
     * Sets all four slice insets at once.
     * @param left - Left slice width.
     * @param right - Right slice width.
     * @param top - Top slice height.
     * @param bottom - Bottom slice height.
     */
    public setSlices(left: number, right: number, top: number, bottom: number): void {
        this.sliceLeft = left;
        this.sliceRight = right;
        this.sliceTop = top;
        this.sliceBottom = bottom;
    }

    /**
     * Sets uniform slice insets.
     * @param inset - The uniform inset size.
     */
    public setUniformSlices(inset: number): void {
        this.sliceLeft = inset;
        this.sliceRight = inset;
        this.sliceTop = inset;
        this.sliceBottom = inset;
    }

    /** @internal */
    public setBorders(left: number, right: number, top: number, bottom: number): this {
        this.setSlices(left, right, top, bottom);
        return this;
    }

    /** @internal */
    public setUniformBorders(inset: number): this {
        this.setUniformSlices(inset);
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
        const textureSize = texture.getSize();
        const textureWidth = textureSize.width;
        const textureHeight = textureSize.height;
        const resolvedSourceRect = this._getResolvedSourceRectToRef(texture, this._nineSliceResolvedSourceRect);
        const sourceX = resolvedSourceRect.x;
        const sourceY = resolvedSourceRect.y;
        const sourceWidth = resolvedSourceRect.width;
        const sourceHeight = resolvedSourceRect.height;

        let displayLeft = this.sliceLeft;
        let displayRight = this.sliceRight;
        let displayTop = this.sliceTop;
        let displayBottom = this.sliceBottom;

        const displayHorizontalTotal = displayLeft + displayRight;
        if (displayHorizontalTotal > displayWidth && displayHorizontalTotal > 0) {
            const scale = displayWidth / displayHorizontalTotal;
            displayLeft *= scale;
            displayRight *= scale;
        }

        const displayVerticalTotal = displayTop + displayBottom;
        if (displayVerticalTotal > displayHeight && displayVerticalTotal > 0) {
            const scale = displayHeight / displayVerticalTotal;
            displayTop *= scale;
            displayBottom *= scale;
        }

        let sourceLeft = this.sliceLeft;
        let sourceRight = this.sliceRight;
        let sourceTop = this.sliceTop;
        let sourceBottom = this.sliceBottom;

        const sourceHorizontalTotal = sourceLeft + sourceRight;
        if (sourceHorizontalTotal > sourceWidth && sourceHorizontalTotal > 0) {
            const scale = sourceWidth / sourceHorizontalTotal;
            sourceLeft *= scale;
            sourceRight *= scale;
        }

        const sourceVerticalTotal = sourceTop + sourceBottom;
        if (sourceVerticalTotal > sourceHeight && sourceVerticalTotal > 0) {
            const scale = sourceHeight / sourceVerticalTotal;
            sourceTop *= scale;
            sourceBottom *= scale;
        }

        const centerWidth = Math.max(0, displayWidth - displayLeft - displayRight);
        const middleHeight = Math.max(0, displayHeight - displayTop - displayBottom);
        const sourceCenterWidth = Math.max(0, sourceWidth - sourceLeft - sourceRight);
        const sourceMiddleHeight = Math.max(0, sourceHeight - sourceTop - sourceBottom);

        const columnCenters = this._columnCenters;
        const columnWidths = this._columnWidths;
        const columnSourceXs = this._columnSourceXs;
        const columnSourceWidths = this._columnSourceWidths;
        columnWidths[0] = displayLeft;
        columnWidths[1] = centerWidth;
        columnWidths[2] = displayRight;
        columnCenters[0] = -displayWidth / 2 + displayLeft / 2;
        columnCenters[1] = -displayWidth / 2 + displayLeft + centerWidth / 2;
        columnCenters[2] = displayWidth / 2 - displayRight / 2;
        columnSourceXs[0] = sourceX;
        columnSourceXs[1] = sourceX + sourceLeft;
        columnSourceXs[2] = sourceX + sourceWidth - sourceRight;
        columnSourceWidths[0] = sourceLeft;
        columnSourceWidths[1] = sourceCenterWidth;
        columnSourceWidths[2] = sourceRight;

        const rowCenters = this._rowCenters;
        const rowHeights = this._rowHeights;
        const rowSourceYs = this._rowSourceYs;
        const rowSourceHeights = this._rowSourceHeights;
        rowHeights[0] = displayTop;
        rowHeights[1] = middleHeight;
        rowHeights[2] = displayBottom;
        rowCenters[0] = -displayHeight / 2 + displayTop / 2;
        rowCenters[1] = -displayHeight / 2 + displayTop + middleHeight / 2;
        rowCenters[2] = displayHeight / 2 - displayBottom / 2;
        rowSourceYs[0] = sourceY;
        rowSourceYs[1] = sourceY + sourceTop;
        rowSourceYs[2] = sourceY + sourceHeight - sourceBottom;
        rowSourceHeights[0] = sourceTop;
        rowSourceHeights[1] = sourceMiddleHeight;
        rowSourceHeights[2] = sourceBottom;

        const worldTransform = this.worldTransform.m;
        const tintR = this.tint.r;
        const tintG = this.tint.g;
        const tintB = this.tint.b;
        const tintA = this.tint.a * worldAlpha;
        const sortingLayer = this.sortingLayer;
        const sortKey = (sortingLayer << 16) | (worldZIndex & 0xffff);
        const invertY = texture instanceof Texture ? texture.invertY : true;
        const scene = this.scene;
        const lit = scene !== null && scene.lightingManager !== null && sortingLayer < scene.unlitSortingLayerMin;

        let emittedCount = 0;
        for (let rowIndex = 0; rowIndex < 3; rowIndex++) {
            const rowHeight = rowHeights[rowIndex];
            if (rowHeight <= 0) {
                continue;
            }

            const cy = rowCenters[rowIndex];
            const sourceRowY = rowSourceYs[rowIndex];
            const sourceRowHeight = rowSourceHeights[rowIndex];
            for (let columnIndex = 0; columnIndex < 3; columnIndex++) {
                const columnWidth = columnWidths[columnIndex];
                if (columnWidth <= 0) {
                    continue;
                }

                const cx = columnCenters[columnIndex];
                const sliceIndex = rowIndex * 3 + columnIndex;
                const sliceTransform = this._sliceTransforms[sliceIndex];
                sliceTransform.m[0] = worldTransform[0];
                sliceTransform.m[1] = worldTransform[1];
                sliceTransform.m[2] = worldTransform[2];
                sliceTransform.m[3] = worldTransform[3];
                sliceTransform.m[4] = worldTransform[0] * cx + worldTransform[2] * cy + worldTransform[4];
                sliceTransform.m[5] = worldTransform[1] * cx + worldTransform[3] * cy + worldTransform[5];

                let u0 = textureWidth > 0 ? columnSourceXs[columnIndex] / textureWidth : 0;
                let u1 = textureWidth > 0 ? (columnSourceXs[columnIndex] + columnSourceWidths[columnIndex]) / textureWidth : 1;
                let v0 = 0;
                let v1 = 1;
                if (textureHeight > 0) {
                    const sourceTop = sourceRowY / textureHeight;
                    const sourceBottom = (sourceRowY + sourceRowHeight) / textureHeight;
                    if (invertY) {
                        v0 = 1 - sourceTop;
                        v1 = 1 - sourceBottom;
                    } else {
                        v0 = sourceTop;
                        v1 = sourceBottom;
                    }
                }
                if (this.flipX) {
                    const temp = u0;
                    u0 = u1;
                    u1 = temp;
                }
                if (this.flipY) {
                    const temp = v0;
                    v0 = v1;
                    v1 = temp;
                }

                const renderData = allocator(emittedCount);
                const color: [number, number, number, number] = renderData.color ?? [1, 1, 1, 1];
                color[0] = tintR;
                color[1] = tintG;
                color[2] = tintB;
                color[3] = tintA;

                const packedUvs: [number, number, number, number] = renderData.uvs ?? [0, 0, 1, 1];
                packedUvs[0] = u0;
                packedUvs[1] = v0;
                packedUvs[2] = u1;
                packedUvs[3] = v1;

                renderData.worldTransform = sliceTransform;
                renderData.texture = texture;
                renderData.uvs = packedUvs;
                renderData.color = color;
                renderData.width = columnWidth;
                renderData.height = rowHeight;
                renderData.alphaMode = this.alphaMode;
                renderData.sortKey = sortKey;
                renderData.insertionOrder = insertionOrderStart + emittedCount;
                renderData.lit = lit;
                renderData.scrollFactorX = worldScrollFactorX;
                renderData.scrollFactorY = worldScrollFactorY;
                emittedCount++;
            }
        }

        return emittedCount;
    }
}
