/** Vector shape used by the engine-neutral Lottie sprite state. */
export type LottieSpriteVector3 = {
    /** X coordinate. */
    x: number;
    /** Y coordinate. */
    y: number;
    /** Z coordinate. */
    z: number;
};

/** Color shape used by the engine-neutral Lottie sprite state. */
export type LottieSpriteColor4 = {
    /** Red channel, normalized between 0 and 1. */
    r: number;
    /** Green channel, normalized between 0 and 1. */
    g: number;
    /** Blue channel, normalized between 0 and 1. */
    b: number;
    /** Alpha channel, normalized between 0 and 1. */
    a: number;
};

/** Engine-neutral sprite state updated by the Lottie scene graph. */
export type LottieSprite = {
    /** Sprite center position in animation space. */
    position: LottieSpriteVector3;
    /** Sprite tint and opacity. */
    color: LottieSpriteColor4;
    /** Sprite width in animation pixels. */
    width: number;
    /** Sprite height in animation pixels. */
    height: number;
    /** Sprite rotation in radians. */
    angle: number;
};

/** Immutable atlas placement and initial display data for a Lottie sprite. */
export type LottieSpriteCreationOptions = {
    /** Horizontal texture atlas offset, normalized between 0 and 1. */
    uOffset: number;
    /** Vertical texture atlas offset, normalized between 0 and 1. */
    vOffset: number;
    /** Atlas cell width in pixels. */
    cellWidth: number;
    /** Atlas cell height in pixels. */
    cellHeight: number;
    /** Initial on-screen width in animation pixels. */
    widthPx: number;
    /** Initial on-screen height in animation pixels. */
    heightPx: number;
    /** Whether the sprite samples the atlas with inverted V coordinates. */
    invertV: boolean;
};

/** Adapter surface used by the parser to create and order sprites without knowing the rendering engine. */
export type LottieSpriteRenderer<TextureType = unknown> = {
    /** Creates a sprite in the rendering adapter and returns the state object updated by the Lottie node graph. */
    createSprite(options: LottieSpriteCreationOptions, layerIndex: number, atlasIndex: number): LottieSprite;
    /** Finalizes sprite ordering and texture ownership after parsing has packed every sprite. */
    ready(spriteTextures: TextureType[]): void;
};
