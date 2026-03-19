import type { AbstractEngine } from "core/Engines/abstractEngine";
import { Constants } from "core/Engines/constants";
import { HtmlElementTexture } from "core/Materials/Textures/htmlElementTexture";
import type { ThinTexture } from "core/Materials/Textures/thinTexture";
import { Tools } from "core/Misc/tools";

import { Rectangle2D } from "../Math/rectangle2D";
import { SpriteSheet, createSpriteSheetFrameMetadata, getSpriteSheetFrameMetadata, setSpriteSheetFrameMetadata } from "../SpriteSheet/spriteSheet";

/**
 * A single frame in a TexturePacker JSON atlas.
 */
export interface ISpriteAtlasFrame {
    /** Frame rectangle within the atlas texture. */
    frame: { x: number; y: number; w: number; h: number };
    /** Whether the frame was rotated 90° in the atlas. */
    rotated?: boolean;
    /** Whether whitespace was trimmed from the frame. */
    trimmed?: boolean;
    /** Source size before trimming. */
    sourceSize?: { w: number; h: number };
    /** Offset of the trimmed frame within the source rect. */
    spriteSourceSize?: { x: number; y: number; w: number; h: number };
}

/**
 * TexturePacker JSON Hash format (frames keyed by name).
 */
export interface ISpriteAtlasJsonHash {
    /** Frames keyed by frame name. */
    frames: Record<string, ISpriteAtlasFrame>;
    /** Optional atlas metadata. */
    meta?: { image: string; size: { w: number; h: number } };
}

/**
 * TexturePacker JSON Array format (frames as array with filename).
 */
export interface ISpriteAtlasJsonArray {
    /** Frames stored in array order. */
    frames: Array<ISpriteAtlasFrame & { filename: string }>;
    /** Optional atlas metadata. */
    meta?: { image: string; size: { w: number; h: number } };
}

/**
 * Atlas data in either TexturePacker JSON Hash or JSON Array format.
 */
export type SpriteAtlasData = ISpriteAtlasJsonHash | ISpriteAtlasJsonArray;

interface IParsedFrame {
    rect: Rectangle2D;
    entry: ISpriteAtlasFrame & { filename: string };
}

/**
 * Wraps a TexturePacker JSON atlas (Hash or Array format).
 * Provides frame lookup by name and produces SpriteSheet subsets.
 */
export class SpriteAtlas {
    /** The atlas texture. */
    public readonly texture: ThinTexture;

    private readonly _frames: Map<string, IParsedFrame>;
    private readonly _frameNames: ReadonlyArray<string>;
    private _ownsTexture: boolean;

    /**
     * Creates a SpriteAtlas from parsed atlas data and an already loaded texture.
     * @param data - Atlas JSON data.
     * @param texture - Atlas texture.
     */
    constructor(data: SpriteAtlasData, texture: ThinTexture) {
        const parsed = SpriteAtlas._parseAtlasData(data);
        this.texture = texture;
        this._frames = parsed.frames;
        this._frameNames = parsed.frameNames;
        this._ownsTexture = false;
    }

    /**
     * All frame names in atlas order.
     * @returns The atlas frame names.
     */
    public get frameNames(): ReadonlyArray<string> {
        return this._frameNames;
    }

    /**
     * Total frame count.
     * @returns The total number of frames.
     */
    public get frameCount(): number {
        return this._frameNames.length;
    }

    /**
     * Loads a SpriteAtlas from a TexturePacker JSON file and the texture referenced by `meta.image`.
     * @param jsonUrl - URL to the atlas JSON file.
     * @param engine - Engine used to create the atlas texture.
     * @param baseUrl - Optional base URL for resolving `meta.image`.
     * @returns Promise resolving to the loaded SpriteAtlas.
     */
    public static async loadAsync(jsonUrl: string, engine: AbstractEngine, baseUrl?: string): Promise<SpriteAtlas> {
        const atlasData = await SpriteAtlas._fetchJsonAsync(jsonUrl);
        const imageName = atlasData.meta?.image;
        if (!imageName) {
            throw new Error(`Sprite atlas JSON is missing meta.image: ${jsonUrl}`);
        }

        const resolvedBaseUrl = baseUrl ?? SpriteAtlas._getDirectoryUrl(jsonUrl);
        const textureUrl = SpriteAtlas._resolveUrl(resolvedBaseUrl, imageName);
        const texture = await SpriteAtlas._loadTextureAsync(textureUrl, engine);
        const atlas = new SpriteAtlas(atlasData, texture);
        atlas._ownsTexture = true;
        return atlas;
    }

    /**
     * Returns the pixel rectangle for a named frame.
     * @param name - Frame name.
     * @returns The stored frame rectangle, or undefined when not found.
     */
    public getFrame(name: string): Rectangle2D | undefined;
    /**
     * Returns the pixel rectangle for a named frame without allocating.
     * @param name - Frame name.
     * @param out - Output rectangle.
     * @returns The output rectangle, or null when not found.
     */
    public getFrame(name: string, out: Rectangle2D): Rectangle2D | null;
    public getFrame(name: string, out?: Rectangle2D): Rectangle2D | undefined | null {
        const frame = this._frames.get(name);
        if (!frame) {
            if (out) {
                out.x = 0;
                out.y = 0;
                out.width = 0;
                out.height = 0;
                setSpriteSheetFrameMetadata(out, null);
                return null;
            }

            return undefined;
        }

        if (!out) {
            return frame.rect;
        }

        out.x = frame.rect.x;
        out.y = frame.rect.y;
        out.width = frame.rect.width;
        out.height = frame.rect.height;
        setSpriteSheetFrameMetadata(out, getSpriteSheetFrameMetadata(frame.rect));
        return out;
    }

    /**
     * Returns true if the atlas contains a frame with the given name.
     * @param name - Frame name.
     * @returns True when the frame exists.
     */
    public hasFrame(name: string): boolean {
        return this._frames.has(name);
    }

    /**
     * Returns all frame names matching a prefix.
     * @param prefix - Prefix to match.
     * @returns Matching frame names in atlas order.
     */
    public getFramesWithPrefix(prefix: string): string[] {
        return this._frameNames.filter((frameName) => frameName.startsWith(prefix));
    }

    /**
     * Creates a SpriteSheet containing the given atlas frames in the provided order.
     * @param frameNames - Ordered frame names to include.
     * @returns A SpriteSheet subset.
     */
    public toSpriteSheet(frameNames: string[]): SpriteSheet {
        const frames: Array<ISpriteAtlasFrame & { filename: string }> = [];

        for (const frameName of frameNames) {
            const frame = this._frames.get(frameName);
            if (!frame) {
                throw new Error(`Frame "${frameName}" was not found in the sprite atlas.`);
            }

            frames.push({
                filename: frame.entry.filename,
                frame: {
                    x: frame.entry.frame.x,
                    y: frame.entry.frame.y,
                    w: frame.entry.frame.w,
                    h: frame.entry.frame.h,
                },
                rotated: frame.entry.rotated,
                trimmed: frame.entry.trimmed,
                sourceSize: frame.entry.sourceSize ? { w: frame.entry.sourceSize.w, h: frame.entry.sourceSize.h } : undefined,
                spriteSourceSize: frame.entry.spriteSourceSize
                    ? {
                          x: frame.entry.spriteSourceSize.x,
                          y: frame.entry.spriteSourceSize.y,
                          w: frame.entry.spriteSourceSize.w,
                          h: frame.entry.spriteSourceSize.h,
                      }
                    : undefined,
            });
        }

        return SpriteSheet.fromAtlasJson(this.texture, { frames });
    }

    /**
     * Creates a SpriteSheet from all frames matching a prefix, sorted by name.
     * @param prefix - Prefix to match.
     * @returns A sorted SpriteSheet subset.
     */
    public toSpriteSheetFromPrefix(prefix: string): SpriteSheet {
        const frameNames = this.getFramesWithPrefix(prefix).sort();
        return this.toSpriteSheet(frameNames);
    }

    /**
     * Disposes the atlas texture when owned by this atlas.
     */
    public dispose(): void {
        if (!this._ownsTexture) {
            return;
        }

        this.texture.dispose();
        this._ownsTexture = false;
    }

    /**
     * @internal
     */
    protected _setOwnsTexture(ownsTexture: boolean): void {
        this._ownsTexture = ownsTexture;
    }

    private static _parseAtlasData(data: SpriteAtlasData): { frameNames: string[]; frames: Map<string, IParsedFrame> } {
        const frames = new Map<string, IParsedFrame>();
        const frameNames: string[] = [];

        if (Array.isArray(data.frames)) {
            for (const entry of data.frames) {
                const rect = new Rectangle2D(entry.frame.x, entry.frame.y, entry.frame.w, entry.frame.h);
                setSpriteSheetFrameMetadata(rect, createSpriteSheetFrameMetadata(entry));
                frames.set(entry.filename, {
                    rect,
                    entry: {
                        filename: entry.filename,
                        frame: { x: entry.frame.x, y: entry.frame.y, w: entry.frame.w, h: entry.frame.h },
                        rotated: entry.rotated,
                        trimmed: entry.trimmed,
                        sourceSize: entry.sourceSize ? { w: entry.sourceSize.w, h: entry.sourceSize.h } : undefined,
                        spriteSourceSize: entry.spriteSourceSize
                            ? {
                                  x: entry.spriteSourceSize.x,
                                  y: entry.spriteSourceSize.y,
                                  w: entry.spriteSourceSize.w,
                                  h: entry.spriteSourceSize.h,
                              }
                            : undefined,
                    },
                });
                frameNames.push(entry.filename);
            }

            return { frameNames, frames };
        }

        for (const frameName of Object.keys(data.frames)) {
            const entry = data.frames[frameName];
            const rect = new Rectangle2D(entry.frame.x, entry.frame.y, entry.frame.w, entry.frame.h);
            setSpriteSheetFrameMetadata(rect, createSpriteSheetFrameMetadata(entry));
            frames.set(frameName, {
                rect,
                entry: {
                    filename: frameName,
                    frame: { x: entry.frame.x, y: entry.frame.y, w: entry.frame.w, h: entry.frame.h },
                    rotated: entry.rotated,
                    trimmed: entry.trimmed,
                    sourceSize: entry.sourceSize ? { w: entry.sourceSize.w, h: entry.sourceSize.h } : undefined,
                    spriteSourceSize: entry.spriteSourceSize
                        ? {
                              x: entry.spriteSourceSize.x,
                              y: entry.spriteSourceSize.y,
                              w: entry.spriteSourceSize.w,
                              h: entry.spriteSourceSize.h,
                          }
                        : undefined,
                },
            });
            frameNames.push(frameName);
        }

        return { frameNames, frames };
    }

    private static async _fetchJsonAsync(url: string): Promise<SpriteAtlasData> {
        const text = await Tools.LoadFileAsync(url, false);
        return JSON.parse(text);
    }

    private static _loadTextureAsync(url: string, engine: AbstractEngine): Promise<HtmlElementTexture> {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = "anonymous";
            image.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = image.width;
                canvas.height = image.height;
                const context = canvas.getContext("2d");
                if (!context) {
                    reject(new Error("Failed to get 2D canvas context for atlas texture."));
                    return;
                }

                context.drawImage(image, 0, 0);
                const texture = new HtmlElementTexture("SpriteAtlas", canvas, {
                    generateMipMaps: false,
                    samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
                    format: Constants.TEXTUREFORMAT_RGBA,
                    engine,
                    scene: null,
                });
                texture.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
                texture.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
                resolve(texture);
            };
            image.onerror = () => {
                reject(new Error(`Failed to load atlas texture image: ${url}`));
            };
            image.src = url;
        });
    }

    private static _getDirectoryUrl(url: string): string {
        const lastSlashIndex = Math.max(url.lastIndexOf("/"), url.lastIndexOf("\\"));
        if (lastSlashIndex < 0) {
            return "";
        }

        return url.slice(0, lastSlashIndex + 1);
    }

    private static _resolveUrl(baseUrl: string, relativeUrl: string): string {
        if (/^(?:[a-z]+:)?\/\//i.test(relativeUrl) || relativeUrl.startsWith("data:")) {
            return relativeUrl;
        }

        if (!baseUrl) {
            return relativeUrl;
        }

        try {
            return new URL(relativeUrl, baseUrl).toString();
        } catch {
            if (baseUrl.endsWith("/") || baseUrl.endsWith("\\")) {
                return `${baseUrl}${relativeUrl}`;
            }

            return `${baseUrl}/${relativeUrl}`;
        }
    }
}

