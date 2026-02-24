import type { ThinEngine } from "core/Engines/thinEngine";
import type { BaseTexture } from "core/Materials/Textures/baseTexture";
import { HtmlElementTexture } from "core/Materials/Textures/htmlElementTexture";
import { Constants } from "core/Engines/constants";

import { Rectangle2D } from "../Math/rectangle2D";
import { SpriteSheet } from "../SpriteSheet/spriteSheet";
import { SpriteAtlas } from "./spriteAtlas";

/**
 * Configuration options for the sprite atlas builder
 */
export interface ISpriteAtlasBuilderOptions {
    /**
     * Maximum width of the atlas texture in pixels (default: 2048)
     */
    maxWidth?: number;

    /**
     * Maximum height of the atlas texture in pixels (default: 2048)
     */
    maxHeight?: number;

    /**
     * Padding between sprites in pixels (default: 1)
     */
    padding?: number;

    /**
     * Whether to constrain atlas size to power-of-two dimensions (default: true)
     */
    powerOfTwo?: boolean;
}

/**
 * Image source that can be added to the atlas builder
 */
type ImageSource = string | HTMLImageElement | BaseTexture;

/**
 * Internal representation of an image to be packed
 */
interface IPackImage {
    key: string;
    width: number;
    height: number;
    source: HTMLImageElement | HTMLCanvasElement;
}

/**
 * Rectangle placement in the atlas
 */
interface IPackedRect {
    key: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Shelf in the shelf-packing algorithm
 */
interface IShelf {
    y: number;
    height: number;
    usedWidth: number;
}

/**
 * Auto-pack multiple images into a single texture atlas at load time.
 * Maximizes multi-texture batching by reducing the number of textures needed.
 * 
 * @example
 * ```typescript
 * // Create atlas builder with custom options
 * const builder = new SpriteAtlasBuilder(engine, {
 *     maxWidth: 2048,
 *     maxHeight: 2048,
 *     padding: 2,
 *     powerOfTwo: true
 * });
 * 
 * // Add images from URLs
 * builder.addImage("player", "assets/player.png");
 * builder.addImage("enemy", "assets/enemy.png");
 * builder.addImage("bullet", "assets/bullet.png");
 * 
 * // Or add existing textures
 * builder.addImage("powerup", existingTexture);
 * 
 * // Build the atlas asynchronously
 * const atlas = await builder.buildAsync();
 * 
 * // Use with Sprite2D
 * const sprite = new Sprite2D("player", scene);
 * sprite.texture = atlas.texture;
 * sprite.sourceRect = atlas.getFrame("player");
 * 
 * // Or get the SpriteSheet for animations
 * const sheet = atlas.spriteSheet;
 * const animatedSprite = new AnimatedSprite2D("character", sheet, scene);
 * ```
 */
export class SpriteAtlasBuilder {
    private readonly _engine: ThinEngine;
    private readonly _options: Required<ISpriteAtlasBuilderOptions>;
    private readonly _images: Map<string, ImageSource> = new Map();

    /**
     * Creates a new SpriteAtlasBuilder
     * @param engine - The Babylon.js engine
     * @param options - Optional configuration options
     */
    constructor(engine: ThinEngine, options?: ISpriteAtlasBuilderOptions) {
        this._engine = engine;
        this._options = {
            maxWidth: options?.maxWidth ?? 2048,
            maxHeight: options?.maxHeight ?? 2048,
            padding: options?.padding ?? 1,
            powerOfTwo: options?.powerOfTwo ?? true,
        };
    }

    /**
     * Adds an image to the atlas builder
     * @param key - Unique identifier for the image
     * @param source - Image source (URL string, HTMLImageElement, or Texture)
     */
    public addImage(key: string, source: ImageSource): void {
        if (this._images.has(key)) {
            throw new Error(`Image with key "${key}" already exists in the atlas builder`);
        }
        this._images.set(key, source);
    }

    /**
     * Packs all added images into a single atlas texture
     * @returns Promise that resolves to a SpriteAtlas containing the packed texture and frame data
     */
    public async buildAsync(): Promise<SpriteAtlas> {
        if (this._images.size === 0) {
            throw new Error("Cannot build atlas: no images added");
        }

        // Load all images
        const loadedImages = await this._loadAllImagesAsync();

        // Pack rectangles using shelf algorithm
        const packedRects = this._packRectangles(loadedImages);

        // Determine final atlas size
        const atlasSize = this._calculateAtlasSize(packedRects);

        // Create canvas and composite images
        const canvas = this._createCompositeCanvas(atlasSize.width, atlasSize.height, loadedImages, packedRects);

        // Create Babylon.js texture from canvas
        const texture = this._createTextureFromCanvas(canvas);

        // Release canvas memory now that texture is uploaded to GPU
        canvas.width = 0;
        canvas.height = 0;

        // Create SpriteSheet compatible atlas data
        const frames = new Map<string, Rectangle2D>();
        const atlasData: { frames: any } = { frames: {} };

        for (const rect of packedRects) {
            const frame = new Rectangle2D(rect.x, rect.y, rect.width, rect.height);
            frames.set(rect.key, frame);
            atlasData.frames[rect.key] = {
                frame: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
            };
        }

        const spriteSheet = SpriteSheet.FromAtlas(texture, atlasData);

        return new SpriteAtlas(texture, spriteSheet, frames);
    }

    /**
     * Loads all added images and prepares them for packing
     * @returns Promise that resolves to array of loaded images
     */
    private async _loadAllImagesAsync(): Promise<IPackImage[]> {
        const promises: Promise<IPackImage>[] = [];

        for (const [key, source] of this._images) {
            promises.push(this._loadImageAsync(key, source));
        }

        return Promise.all(promises);
    }

    /**
     * Loads a single image from its source
     * @param key - Image key
     * @param source - Image source
     * @returns Promise that resolves to packed image data
     */
    private async _loadImageAsync(key: string, source: ImageSource): Promise<IPackImage> {
        if (typeof source === "string") {
            // Load from URL
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => {
                    resolve({
                        key,
                        width: img.width,
                        height: img.height,
                        source: img,
                    });
                };
                img.onerror = () => {
                    reject(new Error(`Failed to load image: ${source}`));
                };
                img.src = source;
            });
        } else if (source instanceof HTMLImageElement) {
            // Use existing image element
            return {
                key,
                width: source.width,
                height: source.height,
                source,
            };
        } else {
            // Extract from Babylon.js texture
            const textureSource = source as BaseTexture;

            // Safely check for a url property without unsafe casts
            const textureUrl = "url" in textureSource && typeof (textureSource as { url: unknown }).url === "string"
                ? (textureSource as { url: string }).url
                : undefined;
            if (textureUrl) {
                // Load from URL if available
                return new Promise((resolve, reject) => {
                    const img = new Image();
                    img.crossOrigin = "anonymous";
                    img.onload = () => {
                        resolve({
                            key,
                            width: img.width,
                            height: img.height,
                            source: img,
                        });
                    };
                    img.onerror = () => {
                        reject(new Error(`Failed to load texture from URL: ${textureUrl}`));
                    };
                    img.src = textureUrl;
                });
            }

            // No URL available — cannot extract pixel data from GPU-only textures
            throw new Error(
                `Cannot extract texture data for "${key}". ` +
                `The texture has no source URL. Please provide a URL string or HTMLImageElement instead.`
            );
        }
    }

    /**
     * Packs rectangles using a shelf-first-fit algorithm.
     * Images are sorted by height (descending) then placed on the first shelf
     * that fits. A new shelf is created when no existing shelf can accommodate
     * the image. This is a simple O(n log n) algorithm that works well for
     * sprites of similar sizes. For highly varied sizes, a MaxRects algorithm
     * would give better packing efficiency.
     * @param images - Array of images to pack
     * @returns Array of packed rectangles with positions
     */
    private _packRectangles(images: IPackImage[]): IPackedRect[] {
        // Sort images by height (descending) for better packing
        const sorted = [...images].sort((a, b) => b.height - a.height);

        const packed: IPackedRect[] = [];
        const shelves: IShelf[] = [];
        const padding = this._options.padding;

        for (const img of sorted) {
            const rectWidth = img.width + padding * 2;
            const rectHeight = img.height + padding * 2;

            let placed = false;

            // Try to place on existing shelves
            for (const shelf of shelves) {
                if (shelf.usedWidth + rectWidth <= this._options.maxWidth && rectHeight <= shelf.height) {
                    // Place on this shelf
                    packed.push({
                        key: img.key,
                        x: shelf.usedWidth + padding,
                        y: shelf.y + padding,
                        width: img.width,
                        height: img.height,
                    });
                    shelf.usedWidth += rectWidth;
                    placed = true;
                    break;
                }
            }

            if (!placed) {
                // Create a new shelf
                const shelfY = shelves.reduce((sum, s) => sum + s.height, 0);

                if (shelfY + rectHeight > this._options.maxHeight) {
                    throw new Error(
                        `Cannot fit image "${img.key}" (${img.width}x${img.height}) in atlas. ` +
                        `Consider increasing maxWidth/maxHeight or reducing padding.`
                    );
                }

                const newShelf: IShelf = {
                    y: shelfY,
                    height: rectHeight,
                    usedWidth: rectWidth,
                };

                shelves.push(newShelf);

                packed.push({
                    key: img.key,
                    x: padding,
                    y: shelfY + padding,
                    width: img.width,
                    height: img.height,
                });
            }
        }

        return packed;
    }

    /**
     * Calculates the final atlas size based on packed rectangles
     * @param rects - Array of packed rectangles
     * @returns Atlas size with width and height properties
     */
    private _calculateAtlasSize(rects: IPackedRect[]): { width: number; height: number } {
        let maxX = 0;
        let maxY = 0;
        const padding = this._options.padding;

        for (const rect of rects) {
            maxX = Math.max(maxX, rect.x + rect.width + padding);
            maxY = Math.max(maxY, rect.y + rect.height + padding);
        }

        let width = maxX;
        let height = maxY;

        // Round up to power of two if required
        if (this._options.powerOfTwo) {
            width = this._nextPowerOfTwo(width);
            height = this._nextPowerOfTwo(height);
        }

        return { width, height };
    }

    /**
     * Rounds up to the next power of two.
     * Uses Math.log2 for O(1) computation without risk of infinite loop on large values.
     * @param value - Input value (must be positive)
     * @returns Next power of two greater than or equal to value
     */
    private _nextPowerOfTwo(value: number): number {
        if (value <= 1) {
            return 1;
        }
        return Math.pow(2, Math.ceil(Math.log2(value)));
    }

    /**
     * Creates a composite canvas with all images drawn at their packed positions
     * @param width - Atlas width
     * @param height - Atlas height
     * @param images - Array of loaded images
     * @param rects - Array of packed rectangles
     * @returns Canvas with composite image
     */
    private _createCompositeCanvas(
        width: number,
        height: number,
        images: IPackImage[],
        rects: IPackedRect[]
    ): HTMLCanvasElement {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
            throw new Error("Failed to get 2D context for atlas canvas");
        }

        // Clear to transparent
        ctx.clearRect(0, 0, width, height);

        // Draw each image at its packed position
        const imageMap = new Map<string, IPackImage>();
        for (const img of images) {
            imageMap.set(img.key, img);
        }

        for (const rect of rects) {
            const img = imageMap.get(rect.key);
            if (img) {
                ctx.drawImage(img.source, rect.x, rect.y, rect.width, rect.height);
            }
        }

        return canvas;
    }

    /**
     * Creates a Babylon.js texture from a canvas element
     * @param canvas - Source canvas
     * @returns Babylon.js texture
     */
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
}