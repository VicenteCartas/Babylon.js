import type { ThinTexture } from "core/Materials/Textures/thinTexture";

import type { ISpriteAtlasFrame, SpriteAtlasData } from "../SpriteAtlas/spriteAtlas";
import { Rectangle2D } from "../Math/rectangle2D";

/**
 * Additional atlas metadata associated with a frame rectangle.
 */
export interface ISpriteSheetFrameMetadata {
    /** Whether the frame is stored rotated 90° clockwise inside the atlas texture. */
    readonly rotated: boolean;
    /** The logical source width before trimming. */
    readonly sourceWidth: number;
    /** The logical source height before trimming. */
    readonly sourceHeight: number;
    /** The X offset of the trimmed content within the logical source bounds. */
    readonly trimX: number;
    /** The Y offset of the trimmed content within the logical source bounds. */
    readonly trimY: number;
    /** The visible content width before any runtime scaling. */
    readonly trimWidth: number;
    /** The visible content height before any runtime scaling. */
    readonly trimHeight: number;
}

interface IFrameRecord {
    rect: Rectangle2D;
    metadata: ISpriteSheetFrameMetadata | null;
}

const _spriteSheetFrameMetadata = new WeakMap<Rectangle2D, ISpriteSheetFrameMetadata>();

/**
 * Returns the atlas metadata associated with a frame rectangle, when present.
 * @param rect - The rectangle to query.
 * @returns The associated metadata, or null when the rectangle is a plain grid frame.
 */
export function getSpriteSheetFrameMetadata(rect: Rectangle2D | null | undefined): ISpriteSheetFrameMetadata | null {
    if (!rect) {
        return null;
    }

    return _spriteSheetFrameMetadata.get(rect) ?? null;
}

/**
 * Associates atlas metadata with a rectangle returned by SpriteSheet or SpriteAtlas APIs.
 * @param rect - The rectangle receiving the metadata.
 * @param metadata - The metadata to associate, or null to clear it.
 * @internal
 */
export function setSpriteSheetFrameMetadata(rect: Rectangle2D, metadata: ISpriteSheetFrameMetadata | null): void {
    if (metadata) {
        _spriteSheetFrameMetadata.set(rect, metadata);
        return;
    }

    _spriteSheetFrameMetadata.delete(rect);
}

/**
 * Creates normalized runtime metadata from a TexturePacker atlas frame entry.
 * @param frame - The atlas frame entry.
 * @returns Runtime metadata, or null when the frame does not need special handling.
 */
export function createSpriteSheetFrameMetadata(frame: ISpriteAtlasFrame): ISpriteSheetFrameMetadata | null {
    const rotated = frame.rotated === true;
    const trimWidth = frame.spriteSourceSize?.w ?? (rotated ? frame.frame.h : frame.frame.w);
    const trimHeight = frame.spriteSourceSize?.h ?? (rotated ? frame.frame.w : frame.frame.h);
    const sourceWidth = frame.sourceSize?.w ?? trimWidth;
    const sourceHeight = frame.sourceSize?.h ?? trimHeight;
    const trimX = frame.spriteSourceSize?.x ?? 0;
    const trimY = frame.spriteSourceSize?.y ?? 0;

    if (!rotated && trimX === 0 && trimY === 0 && sourceWidth === trimWidth && sourceHeight === trimHeight) {
        return null;
    }

    return {
        rotated,
        sourceWidth,
        sourceHeight,
        trimX,
        trimY,
        trimWidth,
        trimHeight,
    };
}

/**
 * Defines frame rectangles within a sprite-sheet texture.
 * Supports both uniform grid sheets and JSON atlas data.
 */
export class SpriteSheet {
    /**
     * The backing texture.
     */
    public readonly texture: ThinTexture;

    private _frames: IFrameRecord[] = [];
    private _namedFrameIndices: Map<string, number> = new Map();

    /**
     * Creates a new SpriteSheet.
     * @param texture - The backing texture.
     */
    constructor(texture: ThinTexture) {
        this.texture = texture;
    }

    /**
     * Total number of frames.
     */
    public get frameCount(): number {
        return this._frames.length;
    }

    /**
     * Creates a uniform grid spritesheet.
     * @param texture - The backing texture.
     * @param frameWidth - Width of each frame in pixels.
     * @param frameHeight - Height of each frame in pixels.
     * @param margin - Outer margin around the grid in pixels.
     * @param spacing - Spacing between grid cells in pixels.
     * @returns The created SpriteSheet.
     */
    public static fromGrid(texture: ThinTexture, frameWidth: number, frameHeight: number, margin: number = 0, spacing: number = 0): SpriteSheet {
        const sheet = new SpriteSheet(texture);
        if (frameWidth <= 0 || frameHeight <= 0) {
            return sheet;
        }

        const size = texture.getSize();
        if (size.width <= 0 || size.height <= 0) {
            return sheet;
        }

        const stepX = frameWidth + spacing;
        const stepY = frameHeight + spacing;
        const maxX = size.width - margin;
        const maxY = size.height - margin;

        for (let y = margin; y + frameHeight <= maxY; y += stepY) {
            for (let x = margin; x + frameWidth <= maxX; x += stepX) {
                sheet._frames.push({
                    rect: new Rectangle2D(x, y, frameWidth, frameHeight),
                    metadata: null,
                });
            }
        }

        return sheet;
    }

    /**
     * Creates a spritesheet from TexturePacker-style JSON atlas data.
     * @param texture - The backing texture.
     * @param data - The parsed atlas data.
     * @returns The created SpriteSheet.
     */
    public static fromAtlasJson(texture: ThinTexture, data: SpriteAtlasData): SpriteSheet {
        const sheet = new SpriteSheet(texture);
        const frames = data.frames;

        if (Array.isArray(frames)) {
            for (let i = 0; i < frames.length; i++) {
                const entry = frames[i];
                sheet._namedFrameIndices.set(entry.filename, sheet._frames.length);
                sheet._frames.push(SpriteSheet._createFrameRecord(entry));
            }
            return sheet;
        }

        for (const frameName of Object.keys(frames)) {
            const entry = frames[frameName];
            sheet._namedFrameIndices.set(frameName, sheet._frames.length);
            sheet._frames.push(SpriteSheet._createFrameRecord(entry));
        }

        return sheet;
    }

    /**
     * Backward-compatible alias for {@link SpriteSheet.fromGrid}.
     * @param texture - The backing texture.
     * @param frameWidth - Width of each frame in pixels.
     * @param frameHeight - Height of each frame in pixels.
     * @param margin - Outer margin around the grid in pixels.
     * @param spacing - Spacing between grid cells in pixels.
     * @returns The created SpriteSheet.
     */
    public static FromGrid(texture: ThinTexture, frameWidth: number, frameHeight: number, margin: number = 0, spacing: number = 0): SpriteSheet {
        return SpriteSheet.fromGrid(texture, frameWidth, frameHeight, margin, spacing);
    }

    /**
     * Backward-compatible alias for {@link SpriteSheet.fromAtlasJson}.
     * @param texture - The backing texture.
     * @param data - The parsed atlas data.
     * @returns The created SpriteSheet.
     */
    public static FromAtlas(texture: ThinTexture, data: SpriteAtlasData): SpriteSheet {
        return SpriteSheet.fromAtlasJson(texture, data);
    }

    /**
     * Writes the frame rectangle for the given frame index into `out`.
     * @param frameIndex - The frame index.
     * @param out - Output rectangle.
     * @returns The output rectangle.
     */
    public getFrameRect(frameIndex: number, out: Rectangle2D): Rectangle2D {
        const frame = this._frames[frameIndex];
        if (!frame) {
            out.x = 0;
            out.y = 0;
            out.width = 0;
            out.height = 0;
            setSpriteSheetFrameMetadata(out, null);
            return out;
        }

        out.x = frame.rect.x;
        out.y = frame.rect.y;
        out.width = frame.rect.width;
        out.height = frame.rect.height;
        setSpriteSheetFrameMetadata(out, frame.metadata);
        return out;
    }

    /**
     * Writes the rectangle for the given named frame into `out`.
     * @param frameName - The atlas frame name.
     * @param out - Output rectangle.
     * @returns The output rectangle, or null when the frame name is unknown.
     */
    public getNamedFrameRect(frameName: string, out: Rectangle2D): Rectangle2D | null {
        const frameIndex = this._namedFrameIndices.get(frameName);
        if (frameIndex === undefined) {
            out.x = 0;
            out.y = 0;
            out.width = 0;
            out.height = 0;
            setSpriteSheetFrameMetadata(out, null);
            return null;
        }

        return this.getFrameRect(frameIndex, out);
    }

    private static _createFrameRecord(entry: ISpriteAtlasFrame): IFrameRecord {
        const rect = new Rectangle2D(entry.frame.x, entry.frame.y, entry.frame.w, entry.frame.h);
        const metadata = createSpriteSheetFrameMetadata(entry);
        setSpriteSheetFrameMetadata(rect, metadata);
        return {
            rect,
            metadata,
        };
    }
}
