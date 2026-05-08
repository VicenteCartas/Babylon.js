import { type LottieVector2Like } from "../maths/lottieMathTypes";
import { type RawElement, type RawFont, type RawTextData } from "./rawTypes";

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
     * X coordinate of the center of the sprite bounding box, used for final positioning in the screen.
     */
    centerX: number;

    /**
     * Y coordinate of the center of the sprite bounding box, used for final positioning in the screen.
     */
    centerY: number;

    /**
     * Index of the atlas page this sprite belongs to.
     * Used when the animation has more sprites than fit in a single atlas texture.
     */
    atlasIndex: number;
};

/** Adapter surface used by the parser to pack Lottie content into atlas textures without depending on a concrete packer implementation. */
export type LottieSpriteAtlasPacker<TextureType = unknown> = {
    /**
     * Sets the fonts that will be used to render text in the sprite atlas.
     * @param rawFonts A map of font names to RawFont objects.
     */
    setRawFonts(rawFonts: Map<string, RawFont>): void;
    /**
     * Adds a vector shape that comes from Lottie data to the sprite atlas.
     * @param rawElements The raw elements that contain the paths and fills to add to the atlas.
     * @param scalingFactor The scaling factor to apply to the shape.
     * @param debugName Optional human-readable identifier included in oversize warnings.
     * @returns The information on how to find the sprite in the atlas.
     */
    addLottieShape(rawElements: RawElement[], scalingFactor: LottieVector2Like, debugName?: string): SpriteAtlasInfo;
    /**
     * Adds a text element that comes from Lottie data to the sprite atlas.
     * @param textData The raw text data to add to the atlas.
     * @param scalingFactor The scaling factor to apply to the text.
     * @param debugName Optional human-readable identifier included in oversize warnings.
     * @returns The information on how to find the sprite in the atlas, or undefined when the text cannot be rasterized.
     */
    addLottieText(textData: RawTextData, scalingFactor: LottieVector2Like, debugName?: string): SpriteAtlasInfo | undefined;
    /** Updates all dirty atlas page textures with the latest canvas content. */
    updateAtlasTexture(): void;
    /** Releases any temporary canvas resources owned by the packer. */
    releaseCanvas(): void;
    /** Textures for all atlas pages, one entry per page. */
    readonly textures: TextureType[];
    /** Unsupported features encountered while rasterizing content into the atlas. */
    readonly unsupportedFeatures: readonly string[];
};
