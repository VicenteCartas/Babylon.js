import type { ThinEngine } from "core/Engines/thinEngine";
import type { BaseTexture } from "core/Materials/Textures/baseTexture";
import { HtmlElementTexture } from "core/Materials/Textures/htmlElementTexture";
import { Constants } from "core/Engines/constants";
import { Tools } from "core/Misc/tools";

import { Rectangle2D } from "../Math/rectangle2D";
import { SpriteSheet } from "../SpriteSheet/spriteSheet";

/**
 * A single frame descriptor in a sprite atlas
 */
export interface ISpriteAtlasFrame {
    /** Frame rectangle within the atlas texture */
    frame: { x: number; y: number; w: number; h: number };
}

/**
 * JSON Hash atlas format — frames keyed by name
 */
export interface ISpriteAtlasJsonHash {
    /** Map of frame names to frame descriptors */
    frames: Record<string, ISpriteAtlasFrame>;
}

/**
 * JSON Array atlas format — frames as array with filename property
 */
export interface ISpriteAtlasJsonArray {
    /** Array of frame entries with filename and frame descriptor */
    frames: Array<ISpriteAtlasFrame & { filename: string }>;
}

/**
 * Atlas data in either JSON Hash or JSON Array format
 */
export type SpriteAtlasData = ISpriteAtlasJsonHash | ISpriteAtlasJsonArray;

/**
 * Result of a sprite atlas build operation.
 * Contains the packed texture, a compatible SpriteSheet, and frame lookup by key.
 * 
 * @example
 * ```typescript
 * const atlas = await builder.buildAsync();
 * 
 * // Get frame data by key
 * const playerFrame = atlas.getFrame("player");
 * if (playerFrame) {
 *     console.log(`Player is at (${playerFrame.x}, ${playerFrame.y})`);
 * }
 * 
 * // Check if frame exists
 * if (atlas.hasFrame("enemy")) {
 *     const enemySprite = new Sprite2D("enemy", scene);
 *     enemySprite.texture = atlas.texture;
 *     enemySprite.sourceRect = atlas.getFrame("enemy");
 * }
 * 
 * // Get all available frames
 * const allKeys = atlas.getFrameKeys();
 * console.log(`Atlas contains ${allKeys.length} frames:`, allKeys);
 * ```
 */
export class SpriteAtlas {
    /**
     * The packed atlas texture
     */
    public readonly texture: BaseTexture;

    /**
     * A SpriteSheet created from the atlas data
     */
    public readonly spriteSheet: SpriteSheet;

    /**
     * Map of image keys to their frame rectangles
     */
    private readonly _frames: Map<string, Rectangle2D>;

    /**
     * Creates a new SpriteAtlas
     * @param texture - The packed atlas texture
     * @param spriteSheet - A SpriteSheet created from the atlas
     * @param frames - Map of image keys to frame rectangles
     */
    constructor(texture: BaseTexture, spriteSheet: SpriteSheet, frames: Map<string, Rectangle2D>) {
        this.texture = texture;
        this.spriteSheet = spriteSheet;
        this._frames = frames;
    }

    /**
     * Gets the frame rectangle for a specific image by key
     * @param key - The image key provided when adding the image
     * @returns The frame rectangle, or undefined if not found
     */
    public getFrame(key: string): Rectangle2D | undefined {
        return this._frames.get(key);
    }

    /**
     * Gets all frame keys in the atlas
     * @returns Array of all image keys
     */
    public getFrameKeys(): string[] {
        return Array.from(this._frames.keys());
    }

    /**
     * Checks if the atlas contains a frame with the given key
     * @param key - The image key to check
     * @returns True if the frame exists
     */
    public hasFrame(key: string): boolean {
        return this._frames.has(key);
    }

    /**
     * Creates a SpriteAtlas from already-parsed JSON data and an existing texture.
     * Supports both TexturePacker JSON Hash and JSON Array formats.
     * Useful when atlas data is already loaded or embedded in code.
     *
     * @example
     * ```typescript
     * // JSON Hash format
     * const data = { frames: { "player": { frame: { x: 0, y: 0, w: 32, h: 48 } } } };
     * const atlas = SpriteAtlas.FromJson(data, myTexture);
     *
     * // JSON Array format
     * const data2 = { frames: [{ filename: "player", frame: { x: 0, y: 0, w: 32, h: 48 } }] };
     * const atlas2 = SpriteAtlas.FromJson(data2, myTexture);
     * ```
     *
     * @param atlasData - The parsed JSON atlas data containing a frames property (Hash or Array)
     * @param texture - The atlas texture
     * @returns A new SpriteAtlas
     */
    public static FromJson(atlasData: SpriteAtlasData, texture: BaseTexture): SpriteAtlas {
        const frames = new Map<string, Rectangle2D>();
        const rawFrames = atlasData.frames;

        if (!rawFrames) {
            throw new Error("Invalid atlas data: missing 'frames' property");
        }

        if (Array.isArray(rawFrames)) {
            // JSON Array format: frames is an array of { filename, frame: {x,y,w,h}, ... }
            for (const entry of rawFrames) {
                const f = entry.frame;
                frames.set(entry.filename, new Rectangle2D(f.x, f.y, f.w, f.h));
            }
        } else {
            // JSON Hash format: frames is { key: { frame: {x,y,w,h}, ... }, ... }
            for (const key of Object.keys(rawFrames)) {
                const f = rawFrames[key].frame;
                frames.set(key, new Rectangle2D(f.x, f.y, f.w, f.h));
            }
        }

        const spriteSheet = SpriteSheet.FromAtlas(texture, atlasData);
        return new SpriteAtlas(texture, spriteSheet, frames);
    }

    /**
     * Creates a SpriteAtlas from an already-parsed XML document and an existing texture.
     * Supports Starling/Sparrow XML atlas format with {@link https://en.wikipedia.org/wiki/Sparrow_Framework | SubTexture} elements.
     *
     * @example
     * ```typescript
     * const xml = new DOMParser().parseFromString(xmlString, "text/xml");
     * const atlas = SpriteAtlas.FromXml(xml, myTexture);
     * const frame = atlas.getFrame("player_idle_0");
     * ```
     *
     * @param xmlDoc - The parsed XML document containing TextureAtlas/SubTexture elements
     * @param texture - The atlas texture
     * @returns A new SpriteAtlas
     */
    public static FromXml(xmlDoc: Document, texture: BaseTexture): SpriteAtlas {
        const frames = new Map<string, Rectangle2D>();
        const subTextures = xmlDoc.getElementsByTagName("SubTexture");

        // Build a JSON Hash-compatible object so SpriteSheet.FromAtlas can reuse its parser
        const atlasData: { frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> } = { frames: {} };

        for (let i = 0; i < subTextures.length; i++) {
            const sub = subTextures[i];
            const name = sub.getAttribute("name") || `frame_${i}`;
            const x = parseInt(sub.getAttribute("x") || "0", 10);
            const y = parseInt(sub.getAttribute("y") || "0", 10);
            const width = parseInt(sub.getAttribute("width") || "0", 10);
            const height = parseInt(sub.getAttribute("height") || "0", 10);

            frames.set(name, new Rectangle2D(x, y, width, height));
            atlasData.frames[name] = { frame: { x, y, w: width, h: height } };
        }

        const spriteSheet = SpriteSheet.FromAtlas(texture, atlasData);
        return new SpriteAtlas(texture, spriteSheet, frames);
    }

    /**
     * Loads a SpriteAtlas from a TexturePacker JSON file (supports both JSON Hash and JSON Array formats).
     *
     * @example
     * ```typescript
     * const atlas = await SpriteAtlas.LoadJsonAsync(
     *     "assets/spritesheet.json",
     *     "assets/spritesheet.png",
     *     engine
     * );
     * const playerFrame = atlas.getFrame("player_idle_0");
     * ```
     *
     * @param jsonUrl - URL to the JSON atlas descriptor
     * @param textureUrl - URL to the atlas texture image
     * @param engine - The engine instance for texture creation
     * @returns Promise resolving to a SpriteAtlas
     */
    public static async LoadJsonAsync(jsonUrl: string, textureUrl: string, engine: ThinEngine): Promise<SpriteAtlas> {
        const [atlasData, texture] = await Promise.all([SpriteAtlas._fetchJsonAsync(jsonUrl), SpriteAtlas._loadTextureAsync(textureUrl, engine)]);

        return SpriteAtlas.FromJson(atlasData, texture);
    }

    /**
     * Loads a SpriteAtlas from a TexturePacker/Starling XML file.
     *
     * @example
     * ```typescript
     * const atlas = await SpriteAtlas.LoadXmlAsync(
     *     "assets/spritesheet.xml",
     *     "assets/spritesheet.png",
     *     engine
     * );
     * const frame = atlas.getFrame("player_idle_0");
     * ```
     *
     * @param xmlUrl - URL to the XML atlas descriptor
     * @param textureUrl - URL to the atlas texture image
     * @param engine - The engine instance for texture creation
     * @returns Promise resolving to a SpriteAtlas
     */
    public static async LoadXmlAsync(xmlUrl: string, textureUrl: string, engine: ThinEngine): Promise<SpriteAtlas> {
        const [xmlDoc, texture] = await Promise.all([SpriteAtlas._fetchXmlAsync(xmlUrl), SpriteAtlas._loadTextureAsync(textureUrl, engine)]);

        return SpriteAtlas.FromXml(xmlDoc, texture);
    }

    /**
     * @internal
     * Fetches and parses a JSON atlas descriptor from a URL.
     * Uses Babylon.js file loading utilities for consistency with custom file loaders.
     * @param url - URL to the JSON file
     * @returns Promise resolving to parsed JSON data
     */
    private static async _fetchJsonAsync(url: string): Promise<SpriteAtlasData> {
        const text = await Tools.LoadFileAsync(url, false);
        return JSON.parse(text);
    }

    /**
     * @internal
     * Fetches and parses an XML atlas descriptor from a URL.
     * Uses Babylon.js file loading utilities for consistency with custom file loaders.
     * @param url - URL to the XML file
     * @returns Promise resolving to parsed XML Document
     */
    private static async _fetchXmlAsync(url: string): Promise<Document> {
        const text = await Tools.LoadFileAsync(url, false);
        const doc = new DOMParser().parseFromString(text, "text/xml");
        const errorNode = doc.querySelector("parsererror");
        if (errorNode) {
            throw new Error(`Failed to parse XML atlas: ${url} — ${errorNode.textContent}`);
        }
        return doc;
    }

    /**
     * @internal
     * Loads an image from a URL and creates a GPU texture via HtmlElementTexture.
     * Draws the image onto an intermediate canvas since HtmlElementTexture requires
     * a canvas or video element.
     * @param url - URL to the texture image
     * @param engine - The engine instance for texture creation
     * @returns Promise resolving to the created texture
     */
    private static _loadTextureAsync(url: string, engine: ThinEngine): Promise<HtmlElementTexture> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    reject(new Error("Failed to get 2D canvas context for atlas texture"));
                    return;
                }
                ctx.drawImage(img, 0, 0);

                const texture = new HtmlElementTexture("SpriteAtlas", canvas, {
                    generateMipMaps: false,
                    samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
                    format: Constants.TEXTUREFORMAT_RGBA,
                    engine: engine,
                    scene: null,
                });
                texture.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
                texture.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;

                // Release canvas memory now that texture is uploaded to GPU
                canvas.width = 0;
                canvas.height = 0;

                resolve(texture);
            };
            img.onerror = () => {
                reject(new Error(`Failed to load atlas texture image: ${url}`));
            };
            img.src = url;
        });
    }
}
