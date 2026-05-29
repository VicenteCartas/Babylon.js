import "../rendering/babylonSideEffects";

import { type ThinEngine } from "core/Engines/thinEngine";
import { type InternalTexture } from "core/Materials/Textures/internalTexture";
import { type IVector2Like } from "core/Maths/math.like";
import { ThinTexture } from "core/Materials/Textures/thinTexture";

import { type BoundingBox } from "../maths/boundingBox";

import { type LottieRendererConfig } from "../animationConfiguration";

/**
 * Type alias for the 2D drawing context used by the sprite packer.
 */
export type SpritePackerDrawingContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/**
 * Canvas context and atlas cell placement for a sprite rasterization callback.
 */
export type SpritePackerRasterizationContext = {
    /** Atlas page drawing context. */
    context: SpritePackerDrawingContext;
    /** X coordinate of the allocated atlas cell in pixels. */
    x: number;
    /** Y coordinate of the allocated atlas cell in pixels. */
    y: number;
    /** Width of the allocated atlas cell in pixels. */
    cellWidth: number;
    /** Height of the allocated atlas cell in pixels. */
    cellHeight: number;
};

/**
 * Information about a sprite in the sprite atlas.
 */
export type SpriteAtlasInfo = {
    /**
     * Offset in the x axis of the sprite in the atlas.
     * Normalized between 0 and 1, left to right.
     */
    uOffset: number;
    /**
     * Offset in the y axis of the sprite in the atlas.
     * Normalized between 0 and 1, top to bottom.
     */
    vOffset: number;

    /**
     * Width of the sprite in the atlas.
     * In pixels.
     */
    cellWidth: number;

    /**
     * Height of the sprite in the atlas.
     * In pixels.
     */
    cellHeight: number;

    /**
     * Width of the sprite in the screen.
     * In pixels.
     */
    widthPx: number;
    /**
     * Height of the sprite in the screen.
     * In pixels.
     */
    heightPx: number;

    /**
     * X coordinate of the center of the sprite bounding box, used for final positioning in the screen
     */
    centerX: number;

    /**
     * Y coordinate of the center of the sprite bounding box, used for final positioning in the screen
     */
    centerY: number;

    /**
     * Index of the atlas page this sprite belongs to.
     * Used when the animation has more sprites than fit in a single atlas texture.
     */
    atlasIndex: number;
};

/**
 * Represents a single page in the sprite atlas. When sprites exceed the capacity of one
 * texture, additional pages are created automatically.
 */
type AtlasPage = {
    canvas: OffscreenCanvas | HTMLCanvasElement;
    context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
    internalTexture: InternalTexture;
    texture: ThinTexture;
    isDirty: boolean;
    currentX: number;
    currentY: number;
    maxRowHeight: number;
};

/**
 * SpritePacker is a class that handles the packing of sprites into a texture atlas.
 * If sprites exceed the capacity of a single atlas texture, additional atlas pages are created.
 */
export class SpritePacker {
    private readonly _engine: ThinEngine;
    private readonly _isHtmlCanvas: boolean;
    private _atlasScale: number;
    private readonly _variables: Map<string, string>;
    private readonly _rendererConfiguration: LottieRendererConfig;

    private _pages: AtlasPage[];

    // Variable to avoid allocations
    private _spriteAtlasInfo: SpriteAtlasInfo;

    // Generic diagnostic channel for issues encountered while rasterizing into the atlas. Surfaced via
    // the public getter so the parser can include these entries in its debug() output.
    private readonly _unsupportedFeatures: string[] = [];

    /**
     * Gets the textures for all atlas pages.
     * @returns An array of textures, one per atlas page.
     */
    public get textures(): ThinTexture[] {
        return this._pages.map((p) => p.texture);
    }

    /**
     * Gets the list of unsupported features encountered while rasterizing shapes into the atlas.
     * Each unknown shape type is reported only once.
     */
    public get unsupportedFeatures(): readonly string[] {
        return this._unsupportedFeatures;
    }

    /**
     * Gets the variables map used by feature-owned rasterizers.
     * @returns The variables map for this animation.
     */
    public get variables(): Map<string, string> {
        return this._variables;
    }

    /**
     * Gets a canvas context that feature-owned rasterizers can use for measurement before allocation.
     * @returns The current atlas page drawing context.
     */
    public get measurementContext(): SpritePackerDrawingContext {
        return this._pages[this._pages.length - 1].context;
    }

    /**
     * Creates a new instance of SpritePacker.
     * @param engine Engine that will render the sprites.
     * @param isHtmlCanvas Whether we should render the atlas in an HTMLCanvasElement or an OffscreenCanvas.
     * @param atlasScale The atlas scale factor to apply to the sprites (always \>= 1 to keep sprites crisp).
     * @param variables Map of variables to replace in the animation file.
     * @param rendererConfiguration Renderer-bound configuration for atlas and raster settings.
     */
    public constructor(engine: ThinEngine, isHtmlCanvas: boolean, atlasScale: number, variables: Map<string, string>, rendererConfiguration: LottieRendererConfig) {
        this._engine = engine;
        this._isHtmlCanvas = isHtmlCanvas;
        this._atlasScale = atlasScale;
        this._variables = variables;
        this._rendererConfiguration = rendererConfiguration;

        this._pages = [this._createPage()];

        this._spriteAtlasInfo = {
            uOffset: 0,
            vOffset: 0,
            cellWidth: 0,
            cellHeight: 0,
            widthPx: 0,
            heightPx: 0,
            centerX: 0,
            centerY: 0,
            atlasIndex: 0,
        };
    }

    /**
     * Adds a feature-owned rasterized sprite to the atlas.
     * @param kind Kind of sprite being rasterized, used for diagnostics.
     * @param boundingBox Source bounding box in lottie coordinates, before any scaling.
     * @param scalingFactor The scaling factor to apply while drawing into the atlas. Mutated with the effective atlas scale.
     * @param drawSprite Callback that draws into the allocated atlas cell.
     * @param debugName Optional human-readable identifier (e.g. owning layer name) included in oversize warnings.
     * @returns The information on how to find the sprite in the atlas.
     */
    public addRasterizedSprite(
        kind: "shape" | "text" | "solid",
        boundingBox: BoundingBox,
        scalingFactor: IVector2Like,
        drawSprite: (context: SpritePackerRasterizationContext) => void,
        debugName?: string
    ): SpriteAtlasInfo {
        const layerScaleX = scalingFactor.x;
        const layerScaleY = scalingFactor.y;
        this._applyAtlasScaleAndFit(kind, debugName, boundingBox, scalingFactor, layerScaleX, layerScaleY);

        // Calculate the size of the sprite in the atlas in pixels
        // This takes into account the scaling factor so in the draw callback the canvas will be scaled when rendering
        this._spriteAtlasInfo.cellWidth = this._getAtlasCellDimension(boundingBox.width * scalingFactor.x);
        this._spriteAtlasInfo.cellHeight = this._getAtlasCellDimension(boundingBox.height * scalingFactor.y);

        // Get (or create) the page that has room for this sprite
        const page = this._getPageWithRoom(this._spriteAtlasInfo.cellWidth, this._spriteAtlasInfo.cellHeight);

        // Draw the sprite in the canvas
        drawSprite({ context: page.context, x: page.currentX, y: page.currentY, cellWidth: this._spriteAtlasInfo.cellWidth, cellHeight: this._spriteAtlasInfo.cellHeight });
        this._extrudeSpriteEdges(page, page.currentX, page.currentY, this._spriteAtlasInfo.cellWidth, this._spriteAtlasInfo.cellHeight);
        page.isDirty = true;

        // Get the rest of the sprite information required to render the shape
        this._spriteAtlasInfo.uOffset = page.currentX / this._rendererConfiguration.spriteAtlasWidth;
        this._spriteAtlasInfo.vOffset = page.currentY / this._rendererConfiguration.spriteAtlasHeight;

        this._spriteAtlasInfo.widthPx = boundingBox.width;
        this._spriteAtlasInfo.heightPx = boundingBox.height;

        this._spriteAtlasInfo.centerX = boundingBox.offsetX;
        this._spriteAtlasInfo.centerY = boundingBox.offsetY;

        this._spriteAtlasInfo.atlasIndex = this._pages.indexOf(page);

        // Advance the current position for the next sprite
        page.currentX += this._spriteAtlasInfo.cellWidth + this._rendererConfiguration.gapSize; // Add a gap between sprites to avoid bleeding
        page.maxRowHeight = Math.max(page.maxRowHeight, this._spriteAtlasInfo.cellHeight);

        return this._spriteAtlasInfo;
    }

    /**
     * Updates all dirty atlas page textures with the latest canvas content.
     */
    public updateAtlasTexture(): void {
        for (const page of this._pages) {
            if (!page.isDirty) {
                continue;
            }
            this._engine.updateDynamicTexture(page.internalTexture, page.canvas, false);
            page.isDirty = false;
        }
    }

    /**
     * Releases the canvases and their contexts to allow garbage collection.
     */
    public releaseCanvas(): void {
        for (const page of this._pages) {
            page.context = undefined as any;
            page.canvas = undefined as any;
        }
    }

    private _createPage(): AtlasPage {
        let canvas: OffscreenCanvas | HTMLCanvasElement;
        let context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

        if (this._isHtmlCanvas) {
            canvas = document.createElement("canvas");
            canvas.width = this._rendererConfiguration.spriteAtlasWidth;
            canvas.height = this._rendererConfiguration.spriteAtlasHeight;
            context = canvas.getContext("2d") as CanvasRenderingContext2D;
        } else {
            canvas = new OffscreenCanvas(this._rendererConfiguration.spriteAtlasWidth, this._rendererConfiguration.spriteAtlasHeight);
            context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
        }

        const internalTexture = this._engine.createDynamicTexture(this._rendererConfiguration.spriteAtlasWidth, this._rendererConfiguration.spriteAtlasHeight, false, 2);
        this._engine.updateDynamicTexture(internalTexture, canvas, false);

        const texture = new ThinTexture(internalTexture);
        texture.wrapU = 0;
        texture.wrapV = 0;

        return {
            canvas,
            context,
            internalTexture,
            texture,
            isDirty: false,
            currentX: this._rendererConfiguration.gapSize,
            currentY: this._rendererConfiguration.gapSize,
            maxRowHeight: 0,
        };
    }

    /**
     * Returns a page with room for a sprite of the given size. Wraps to the next row if needed,
     * and creates a new page if the current page is full.
     * @param cellWidth The width of the sprite cell in pixels.
     * @param cellHeight The height of the sprite cell in pixels.
     * @returns An atlas page with enough room for the sprite.
     */
    private _getPageWithRoom(cellWidth: number, cellHeight: number): AtlasPage {
        let page = this._pages[this._pages.length - 1];

        // Defensive clamp: _applyAtlasScaleAndFit should have already downscaled oversized cells
        // to fit on a single page. This handles the rounding edge case where ceil() pushes a cell
        // a single pixel past the limit.
        const maxCellWidth = this._rendererConfiguration.spriteAtlasWidth - 2 * this._rendererConfiguration.gapSize;
        const maxCellHeight = this._rendererConfiguration.spriteAtlasHeight - 2 * this._rendererConfiguration.gapSize;
        if (cellWidth > maxCellWidth || cellHeight > maxCellHeight) {
            this._spriteAtlasInfo.cellWidth = Math.min(cellWidth, maxCellWidth);
            this._spriteAtlasInfo.cellHeight = Math.min(cellHeight, maxCellHeight);
            cellWidth = this._spriteAtlasInfo.cellWidth;
            cellHeight = this._spriteAtlasInfo.cellHeight;
        }

        // Check if the sprite fits in the current row
        if (page.currentX + cellWidth > this._rendererConfiguration.spriteAtlasWidth) {
            // Move to the next row
            page.currentX = this._rendererConfiguration.gapSize;
            page.currentY += page.maxRowHeight + this._rendererConfiguration.gapSize;
            page.maxRowHeight = 0;
        }

        // Check if the sprite fits vertically on this page
        if (page.currentY + cellHeight > this._rendererConfiguration.spriteAtlasHeight) {
            // Current page is full — create a new one
            page = this._createPage();
            this._pages.push(page);
        }

        return page;
    }

    private _getAtlasCellDimension(size: number): number {
        return Math.max(1, Math.ceil(size));
    }

    /**
     * Combines the layer-side scale with the global atlas scale and devicePixelRatio, then
     * automatically downscales the result if the rasterized cell would not fit on a single
     * atlas page. The on-screen size of the sprite is unaffected (it is sourced from the raw
     * lottie bounding box), only the atlas resolution of this particular sprite is reduced.
     *
     * Mutates `scalingFactor` in place with the final effective scale to use when drawing
     * into the atlas canvas. When a downscale is applied, emits a warning that identifies the
     * offending layer and the scale factors involved so the source can be diagnosed.
     * @param kind Kind of sprite being rasterized, used for diagnostics.
     * @param debugName Optional human-readable identifier (typically the owning layer name).
     * @param boundingBox Source bounding box in lottie coordinates, before any scaling.
     * @param scalingFactor Layer-side scale on input; receives the final effective scale on output.
     * @param layerScaleX Original layer-side X scale (preserved for the warning message).
     * @param layerScaleY Original layer-side Y scale (preserved for the warning message).
     */
    private _applyAtlasScaleAndFit(
        kind: "shape" | "text" | "solid",
        debugName: string | undefined,
        boundingBox: BoundingBox,
        scalingFactor: IVector2Like,
        layerScaleX: number,
        layerScaleY: number
    ): void {
        const atlasW = this._rendererConfiguration.spriteAtlasWidth;
        const atlasH = this._rendererConfiguration.spriteAtlasHeight;
        const maxCellWidth = atlasW - 2 * this._rendererConfiguration.gapSize;
        const maxCellHeight = atlasH - 2 * this._rendererConfiguration.gapSize;

        let effectiveScaleX = scalingFactor.x * this._atlasScale * this._rendererConfiguration.devicePixelRatio;
        let effectiveScaleY = scalingFactor.y * this._atlasScale * this._rendererConfiguration.devicePixelRatio;

        const projectedWidth = boundingBox.width * effectiveScaleX;
        const projectedHeight = boundingBox.height * effectiveScaleY;

        // Auto-fit: if the projected cell exceeds an atlas page on either axis, scale uniformly
        // down by the worst-axis ratio so the sprite still fits at the highest resolution we can
        // afford. Uniform scaling preserves the sprite's aspect ratio in the atlas.
        // Use the ceiled projected dimensions so that after the caller re-applies Math.ceil to
        // size the cell, the result is provably <= maxCellWidth/maxCellHeight and the defensive
        // clamp in _getPageWithRoom is not triggered by sub-pixel rounding.
        const ceiledProjectedWidth = projectedWidth > 0 ? Math.ceil(projectedWidth) : 0;
        const ceiledProjectedHeight = projectedHeight > 0 ? Math.ceil(projectedHeight) : 0;
        const fitScale = Math.min(1, ceiledProjectedWidth > 0 ? maxCellWidth / ceiledProjectedWidth : 1, ceiledProjectedHeight > 0 ? maxCellHeight / ceiledProjectedHeight : 1);

        if (fitScale < 1) {
            effectiveScaleX *= fitScale;
            effectiveScaleY *= fitScale;

            const dpr = this._rendererConfiguration.devicePixelRatio;
            const atlasScale = this._atlasScale;
            const rawW = boundingBox.width.toFixed(2);
            const rawH = boundingBox.height.toFixed(2);
            const lsx = layerScaleX.toFixed(3);
            const lsy = layerScaleY.toFixed(3);
            const name = debugName ?? "<unknown>";
            const finalW = Math.max(1, Math.ceil(boundingBox.width * effectiveScaleX));
            const finalH = Math.max(1, Math.ceil(boundingBox.height * effectiveScaleY));
            const gap = this._rendererConfiguration.gapSize;
            // eslint-disable-next-line no-console
            console.warn(
                `[SpritePacker] ${kind} sprite for layer "${name}" would produce a ${ceiledProjectedWidth}x${ceiledProjectedHeight}px cell that exceeds the usable ${maxCellWidth}x${maxCellHeight}px atlas area ` +
                    `(within a ${atlasW}x${atlasH}px page with ${gap}px reserved on each side). ` +
                    `Auto-downscaled by ${fitScale.toFixed(3)} to ${finalW}x${finalH}px (on-screen size unchanged; sprite will appear softer than the rest of the atlas). ` +
                    `Source bounding box: ${rawW}x${rawH}px at lottie scale ${lsx}x${lsy} \u00d7 atlasScale ${atlasScale} \u00d7 devicePixelRatio ${dpr}.`
            );
        }

        scalingFactor.x = effectiveScaleX;
        scalingFactor.y = effectiveScaleY;
    }

    private _extrudeSpriteEdges(page: AtlasPage, x: number, y: number, width: number, height: number): void {
        const padding = Math.min(2, Math.floor(this._rendererConfiguration.gapSize / 2));
        const pixelX = Math.floor(x);
        const pixelY = Math.floor(y);
        const pixelWidth = Math.ceil(width);
        const pixelHeight = Math.ceil(height);

        if (padding <= 0 || pixelWidth <= 0 || pixelHeight <= 0) {
            return;
        }

        for (let offset = 1; offset <= padding; offset++) {
            // Left edge
            if (pixelX - offset >= 0) {
                page.context.drawImage(page.canvas, pixelX, pixelY, 1, pixelHeight, pixelX - offset, pixelY, 1, pixelHeight);
            }

            // Right edge
            if (pixelX + pixelWidth - 1 + offset < this._rendererConfiguration.spriteAtlasWidth) {
                page.context.drawImage(page.canvas, pixelX + pixelWidth - 1, pixelY, 1, pixelHeight, pixelX + pixelWidth - 1 + offset, pixelY, 1, pixelHeight);
            }

            // Top edge
            if (pixelY - offset >= 0) {
                page.context.drawImage(page.canvas, pixelX, pixelY, pixelWidth, 1, pixelX, pixelY - offset, pixelWidth, 1);
            }

            // Bottom edge
            if (pixelY + pixelHeight - 1 + offset < this._rendererConfiguration.spriteAtlasHeight) {
                page.context.drawImage(page.canvas, pixelX, pixelY + pixelHeight - 1, pixelWidth, 1, pixelX, pixelY + pixelHeight - 1 + offset, pixelWidth, 1);
            }

            // Top-left corner
            if (pixelX - offset >= 0 && pixelY - offset >= 0) {
                page.context.drawImage(page.canvas, pixelX, pixelY, 1, 1, pixelX - offset, pixelY - offset, 1, 1);
            }

            // Top-right corner
            if (pixelX + pixelWidth - 1 + offset < this._rendererConfiguration.spriteAtlasWidth && pixelY - offset >= 0) {
                page.context.drawImage(page.canvas, pixelX + pixelWidth - 1, pixelY, 1, 1, pixelX + pixelWidth - 1 + offset, pixelY - offset, 1, 1);
            }

            // Bottom-left corner
            if (pixelX - offset >= 0 && pixelY + pixelHeight - 1 + offset < this._rendererConfiguration.spriteAtlasHeight) {
                page.context.drawImage(page.canvas, pixelX, pixelY + pixelHeight - 1, 1, 1, pixelX - offset, pixelY + pixelHeight - 1 + offset, 1, 1);
            }

            // Bottom-right corner
            if (
                pixelX + pixelWidth - 1 + offset < this._rendererConfiguration.spriteAtlasWidth &&
                pixelY + pixelHeight - 1 + offset < this._rendererConfiguration.spriteAtlasHeight
            ) {
                page.context.drawImage(
                    page.canvas,
                    pixelX + pixelWidth - 1,
                    pixelY + pixelHeight - 1,
                    1,
                    1,
                    pixelX + pixelWidth - 1 + offset,
                    pixelY + pixelHeight - 1 + offset,
                    1,
                    1
                );
            }
        }
    }
}
