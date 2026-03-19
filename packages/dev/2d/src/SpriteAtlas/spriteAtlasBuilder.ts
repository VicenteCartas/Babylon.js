import type { AbstractEngine } from "core/Engines/abstractEngine";
import { Constants } from "core/Engines/constants";
import { HtmlElementTexture } from "core/Materials/Textures/htmlElementTexture";
import type { ThinTexture } from "core/Materials/Textures/thinTexture";

import { Rectangle2D } from "../Math/rectangle2D";
import { SpriteSheet } from "../SpriteSheet/spriteSheet";
import type { ISpriteAtlasJsonArray } from "./spriteAtlas";
import { SpriteAtlas } from "./spriteAtlas";

/**
 * The output of a SpriteAtlasBuilder build operation.
 */
export interface ISpriteAtlasBuildResult {
    /** The packed GPU texture. Owned by the result. */
    readonly texture: ThinTexture;
    /** A SpriteSheet wrapping the packed frames in insertion order. */
    readonly sheet: SpriteSheet;
    /** All packed frame keys in insertion order. */
    readonly frameKeys: ReadonlyArray<string>;
    /** Atlas texture width in pixels. */
    readonly width: number;
    /** Atlas texture height in pixels. */
    readonly height: number;

    /**
     * Returns the pixel rectangle of a named frame.
     * @param key - The packed frame key.
     * @param out - Output rectangle.
     * @returns The output rectangle, or null when not found.
     */
    getFrame(key: string, out: Rectangle2D): Rectangle2D | null;

    /**
     * Returns whether the given frame key exists.
     * @param key - The packed frame key.
     * @returns True when the frame exists.
     */
    hasFrame(key: string): boolean;

    /** Dispose the GPU texture. */
    dispose(): void;
}

interface IFrameSource {
    key: string;
    texture: ThinTexture;
    order: number;
}

interface ILoadedFrame {
    key: string;
    width: number;
    height: number;
    canvas: HTMLCanvasElement;
    order: number;
}

interface IRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface IPlacement extends IRect {
    key: string;
    frameX: number;
    frameY: number;
    frameWidth: number;
    frameHeight: number;
    sourceWidth: number;
    sourceHeight: number;
    rotated: boolean;
    canvas: HTMLCanvasElement;
    order: number;
}

interface IScoredRect extends IRect {
    shortSideFit: number;
    longSideFit: number;
    rotated: boolean;
}

interface IReadableTexture extends ThinTexture {
    readPixels(
        faceIndex?: number,
        level?: number,
        buffer?: ArrayBufferView | null,
        flushRenderer?: boolean,
        noDataConversion?: boolean,
        x?: number,
        y?: number,
        width?: number,
        height?: number
    ): Promise<ArrayBufferView> | null;
}

/**
 * Sprite atlas build result returned by {@link SpriteAtlasBuilder.buildAsync}.
 */
export class SpriteAtlasBuildResult extends SpriteAtlas implements ISpriteAtlasBuildResult {
    /** A SpriteSheet wrapping the packed frames in insertion order. */
    public readonly sheet: SpriteSheet;
    /** Atlas texture width in pixels. */
    public readonly width: number;
    /** Atlas texture height in pixels. */
    public readonly height: number;

    /**
     * Creates a new SpriteAtlasBuildResult.
     * @param data - The generated atlas data.
     * @param texture - The packed atlas texture.
     * @param width - Atlas texture width.
     * @param height - Atlas texture height.
     */
    constructor(data: ISpriteAtlasJsonArray, texture: ThinTexture, width: number, height: number) {
        super(data, texture);
        this.sheet = SpriteSheet.fromAtlasJson(texture, data);
        this.width = width;
        this.height = height;
        this._setOwnsTexture(true);
    }

    /**
     * All packed frame keys in insertion order.
     * @returns The packed frame keys.
     */
    public get frameKeys(): ReadonlyArray<string> {
        return this.frameNames;
    }
}

/**
 * Packs loose textures into a single GPU atlas at runtime.
 * Uses a MaxRects bin-packing heuristic for efficient layout.
 */
export class SpriteAtlasBuilder {
    /** Maximum atlas width in pixels. */
    public readonly maxWidth: number;
    /** Maximum atlas height in pixels. */
    public readonly maxHeight: number;
    /** Pixel padding between packed frames. */
    public padding: number;
    /** Whether 90° rotation is allowed during packing. */
    public allowRotation: boolean;

    private readonly _engine: AbstractEngine;
    private readonly _sources: Map<string, IFrameSource> = new Map();
    private _nextOrder: number = 0;

    /**
     * Creates a new SpriteAtlasBuilder.
     * @param engine - Engine used to create the packed atlas texture.
     * @param maxWidth - Optional max atlas width.
     * @param maxHeight - Optional max atlas height.
     */
    constructor(engine: AbstractEngine, maxWidth: number = 2048, maxHeight: number = 2048) {
        this._engine = engine;
        this.maxWidth = maxWidth;
        this.maxHeight = maxHeight;
        this.padding = 1;
        this.allowRotation = false;
    }

    /**
     * Adds a texture to be packed.
     * @param key - Unique identifier for this frame.
     * @param texture - Source texture to pack.
     */
    public add(key: string, texture: ThinTexture): void {
        if (this._sources.has(key)) {
            throw new Error(`Image with key "${key}" already exists in the atlas builder`);
        }

        this._sources.set(key, {
            key,
            texture,
            order: this._nextOrder++,
        });
    }

    /**
     * Removes a frame by key before building.
     * @param key - Frame key to remove.
     */
    public remove(key: string): void {
        this._sources.delete(key);
    }

    /**
     * Returns whether a frame key has been added.
     * @param key - Frame key to look up.
     * @returns True when the key exists.
     */
    public has(key: string): boolean {
        return this._sources.has(key);
    }

    /**
     * Number of frames added.
     * @returns The number of queued frames.
     */
    public get count(): number {
        return this._sources.size;
    }

    /**
     * Packs all added textures into a runtime atlas.
     * @returns A build result containing the atlas texture and frame lookup.
     */
    public async buildAsync(): Promise<SpriteAtlasBuildResult> {
        if (this._sources.size === 0) {
            throw new Error("Cannot build atlas: no images added");
        }

        const loadedFrames = await this._loadSourcesAsync();
        const placements = this._packFrames(loadedFrames);
        const atlasSize = this._calculateAtlasSize(placements);
        const canvas = this._renderAtlasCanvas(atlasSize.width, atlasSize.height, placements);
        const texture = this._createTextureFromCanvas(canvas);
        const orderedPlacements = [...placements].sort((left, right) => left.order - right.order);
        const data: ISpriteAtlasJsonArray = {
            frames: orderedPlacements.map((placement) => ({
                filename: placement.key,
                frame: {
                    x: placement.frameX,
                    y: placement.frameY,
                    w: placement.frameWidth,
                    h: placement.frameHeight,
                },
                rotated: placement.rotated || undefined,
                sourceSize: {
                    w: placement.sourceWidth,
                    h: placement.sourceHeight,
                },
            })),
            meta: {
                image: "",
                size: {
                    w: atlasSize.width,
                    h: atlasSize.height,
                },
            },
        };

        return new SpriteAtlasBuildResult(data, texture, atlasSize.width, atlasSize.height);
    }

    /**
     * Clears all queued frames.
     */
    public clear(): void {
        this._sources.clear();
        this._nextOrder = 0;
    }

    /**
     * Disposes the builder. Source textures are not disposed.
     */
    public dispose(): void {
        this.clear();
    }

    private async _loadSourcesAsync(): Promise<ILoadedFrame[]> {
        const promises: Array<Promise<ILoadedFrame>> = [];

        for (const source of this._sources.values()) {
            promises.push(this._loadSourceAsync(source));
        }

        return Promise.all(promises);
    }

    private async _loadSourceAsync(source: IFrameSource): Promise<ILoadedFrame> {
        const canvas = await this._readTextureToCanvasAsync(source.key, source.texture);
        return {
            key: source.key,
            width: canvas.width,
            height: canvas.height,
            canvas,
            order: source.order,
        };
    }

    private async _readTextureToCanvasAsync(key: string, texture: ThinTexture): Promise<HTMLCanvasElement> {
        const size = texture.getSize();
        if (size.width <= 0 || size.height <= 0) {
            throw new Error(`Cannot read texture data for "${key}" because its size is invalid.`);
        }

        if (texture instanceof HtmlElementTexture) {
            const element = texture.element;
            const isVideoElement = typeof HTMLVideoElement !== "undefined" && element instanceof HTMLVideoElement;
            const width = isVideoElement ? element.videoWidth : element.width;
            const height = isVideoElement ? element.videoHeight : element.height;
            return this._copyElementToCanvas(element, width, height);
        }

        const readableTexture = texture as IReadableTexture;
        if (typeof readableTexture.readPixels !== "function") {
            throw new Error(`Cannot read texture data for "${key}". The texture must expose readable pixels.`);
        }

        const pixelPromise = readableTexture.readPixels();
        if (!pixelPromise) {
            throw new Error(`Cannot read texture data for "${key}". The texture did not provide pixel data.`);
        }

        const pixels = await pixelPromise;
        return this._createCanvasFromPixels(size.width, size.height, pixels);
    }

    private _packFrames(frames: ILoadedFrame[]): IPlacement[] {
        const sortedFrames = [...frames].sort((left, right) => {
            const areaDifference = right.width * right.height - left.width * left.height;
            if (areaDifference !== 0) {
                return areaDifference;
            }

            return right.height - left.height;
        });
        const freeRects: IRect[] = [{ x: 0, y: 0, width: this.maxWidth, height: this.maxHeight }];
        const placements: IPlacement[] = [];
        const padding = Math.max(0, this.padding);

        for (const frame of sortedFrames) {
            const bestRect = this._findBestRect(freeRects, frame.width, frame.height, padding);
            if (!bestRect) {
                throw new Error(
                    `Cannot fit image "${frame.key}" (${frame.width}x${frame.height}) in atlas. ` +
                        `Consider increasing maxWidth/maxHeight or reducing padding.`
                );
            }

            const occupiedRect: IRect = {
                x: bestRect.x,
                y: bestRect.y,
                width: bestRect.width,
                height: bestRect.height,
            };
            this._splitFreeRects(freeRects, occupiedRect);
            this._pruneFreeRects(freeRects);

            const frameWidth = bestRect.rotated ? frame.height : frame.width;
            const frameHeight = bestRect.rotated ? frame.width : frame.height;
            placements.push({
                ...occupiedRect,
                key: frame.key,
                frameX: occupiedRect.x + padding,
                frameY: occupiedRect.y + padding,
                frameWidth,
                frameHeight,
                sourceWidth: frame.width,
                sourceHeight: frame.height,
                rotated: bestRect.rotated,
                canvas: frame.canvas,
                order: frame.order,
            });
        }

        return placements;
    }

    private _findBestRect(freeRects: readonly IRect[], frameWidth: number, frameHeight: number, padding: number): IScoredRect | null {
        let bestRect: IScoredRect | null = null;

        for (const freeRect of freeRects) {
            const uprightRect = this._scoreRect(freeRect, frameWidth + padding * 2, frameHeight + padding * 2, false);
            bestRect = this._selectBetterRect(bestRect, uprightRect);

            if (this.allowRotation && frameWidth !== frameHeight) {
                const rotatedRect = this._scoreRect(freeRect, frameHeight + padding * 2, frameWidth + padding * 2, true);
                bestRect = this._selectBetterRect(bestRect, rotatedRect);
            }
        }

        return bestRect;
    }

    private _scoreRect(freeRect: IRect, width: number, height: number, rotated: boolean): IScoredRect | null {
        if (width > freeRect.width || height > freeRect.height) {
            return null;
        }

        const leftoverHorizontal = freeRect.width - width;
        const leftoverVertical = freeRect.height - height;
        return {
            x: freeRect.x,
            y: freeRect.y,
            width,
            height,
            shortSideFit: Math.min(leftoverHorizontal, leftoverVertical),
            longSideFit: Math.max(leftoverHorizontal, leftoverVertical),
            rotated,
        };
    }

    private _selectBetterRect(currentBest: IScoredRect | null, candidate: IScoredRect | null): IScoredRect | null {
        if (!candidate) {
            return currentBest;
        }

        if (
            !currentBest ||
            candidate.shortSideFit < currentBest.shortSideFit ||
            (candidate.shortSideFit === currentBest.shortSideFit && candidate.longSideFit < currentBest.longSideFit)
        ) {
            return candidate;
        }

        return currentBest;
    }

    private _splitFreeRects(freeRects: IRect[], usedRect: IRect): void {
        for (let index = freeRects.length - 1; index >= 0; index--) {
            const freeRect = freeRects[index];
            if (!this._intersects(freeRect, usedRect)) {
                continue;
            }

            freeRects.splice(index, 1);

            if (usedRect.x > freeRect.x) {
                freeRects.push({
                    x: freeRect.x,
                    y: freeRect.y,
                    width: usedRect.x - freeRect.x,
                    height: freeRect.height,
                });
            }

            if (usedRect.x + usedRect.width < freeRect.x + freeRect.width) {
                freeRects.push({
                    x: usedRect.x + usedRect.width,
                    y: freeRect.y,
                    width: freeRect.x + freeRect.width - (usedRect.x + usedRect.width),
                    height: freeRect.height,
                });
            }

            if (usedRect.y > freeRect.y) {
                freeRects.push({
                    x: freeRect.x,
                    y: freeRect.y,
                    width: freeRect.width,
                    height: usedRect.y - freeRect.y,
                });
            }

            if (usedRect.y + usedRect.height < freeRect.y + freeRect.height) {
                freeRects.push({
                    x: freeRect.x,
                    y: usedRect.y + usedRect.height,
                    width: freeRect.width,
                    height: freeRect.y + freeRect.height - (usedRect.y + usedRect.height),
                });
            }
        }
    }

    private _pruneFreeRects(freeRects: IRect[]): void {
        for (let leftIndex = 0; leftIndex < freeRects.length; leftIndex++) {
            const leftRect = freeRects[leftIndex];

            for (let rightIndex = freeRects.length - 1; rightIndex > leftIndex; rightIndex--) {
                const rightRect = freeRects[rightIndex];
                if (this._contains(leftRect, rightRect)) {
                    freeRects.splice(rightIndex, 1);
                    continue;
                }

                if (this._contains(rightRect, leftRect)) {
                    freeRects.splice(leftIndex, 1);
                    leftIndex--;
                    break;
                }
            }
        }
    }

    private _calculateAtlasSize(placements: readonly IPlacement[]): { width: number; height: number } {
        let width = 0;
        let height = 0;

        for (const placement of placements) {
            width = Math.max(width, placement.x + placement.width);
            height = Math.max(height, placement.y + placement.height);
        }

        if (width > this.maxWidth || height > this.maxHeight) {
            throw new Error("Packed atlas dimensions exceed the configured maximum size.");
        }

        return {
            width: Math.max(1, width),
            height: Math.max(1, height),
        };
    }

    private _renderAtlasCanvas(width: number, height: number, placements: readonly IPlacement[]): HTMLCanvasElement {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("Failed to get 2D context for sprite atlas build.");
        }

        context.clearRect(0, 0, width, height);
        for (const placement of placements) {
            if (!placement.rotated) {
                context.drawImage(placement.canvas, placement.frameX, placement.frameY, placement.frameWidth, placement.frameHeight);
                continue;
            }

            context.save();
            context.translate(placement.frameX + placement.frameWidth, placement.frameY);
            context.rotate(Math.PI * 0.5);
            context.drawImage(placement.canvas, 0, 0, placement.sourceWidth, placement.sourceHeight);
            context.restore();
        }

        return canvas;
    }

    private _createTextureFromCanvas(canvas: HTMLCanvasElement): HtmlElementTexture {
        const texture = new HtmlElementTexture("SpriteAtlas", canvas, {
            generateMipMaps: false,
            samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
            format: Constants.TEXTUREFORMAT_RGBA,
            engine: this._engine,
            scene: null,
        });

        texture.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
        texture.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
        return texture;
    }

    private _copyElementToCanvas(element: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement, width: number, height: number): HTMLCanvasElement {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("Failed to get 2D context for sprite atlas source.");
        }

        context.clearRect(0, 0, width, height);
        context.drawImage(element, 0, 0, width, height);
        return canvas;
    }

    private _createCanvasFromPixels(width: number, height: number, pixels: ArrayBufferView): HTMLCanvasElement {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("Failed to get 2D context for sprite atlas source.");
        }

        const rgbaPixels = this._toUint8ClampedArray(width, height, pixels);
        const imageData = context.createImageData(width, height);
        const rowWidth = width * 4;

        for (let row = 0; row < height; row++) {
            const srcOffset = row * rowWidth;
            const dstOffset = (height - row - 1) * rowWidth;
            imageData.data.set(rgbaPixels.subarray(srcOffset, srcOffset + rowWidth), dstOffset);
        }

        context.putImageData(imageData, 0, 0);
        return canvas;
    }

    private _toUint8ClampedArray(width: number, height: number, pixels: ArrayBufferView): Uint8ClampedArray {
        const expectedLength = width * height * 4;
        if (pixels instanceof Uint8ClampedArray) {
            return pixels.length === expectedLength ? pixels : new Uint8ClampedArray(pixels.buffer.slice(0, expectedLength));
        }

        if (pixels instanceof Uint8Array) {
            return pixels.length === expectedLength ? new Uint8ClampedArray(pixels) : new Uint8ClampedArray(pixels.buffer.slice(0, expectedLength));
        }

        if (pixels instanceof Float32Array) {
            const target = new Uint8ClampedArray(expectedLength);
            const length = Math.min(pixels.length, expectedLength);
            for (let index = 0; index < length; index++) {
                target[index] = Math.min(255, Math.max(0, Math.round(pixels[index] * 255)));
            }

            return target;
        }

        const source = new Uint8Array(pixels.buffer, pixels.byteOffset, Math.min(pixels.byteLength, expectedLength));
        const target = new Uint8ClampedArray(expectedLength);
        target.set(source.subarray(0, expectedLength));
        return target;
    }

    private _intersects(left: IRect, right: IRect): boolean {
        return (
            left.x < right.x + right.width &&
            left.x + left.width > right.x &&
            left.y < right.y + right.height &&
            left.y + left.height > right.y
        );
    }

    private _contains(container: IRect, inner: IRect): boolean {
        return (
            inner.x >= container.x &&
            inner.y >= container.y &&
            inner.x + inner.width <= container.x + container.width &&
            inner.y + inner.height <= container.y + container.height
        );
    }
}



