/** Canvas source used by the Lottie atlas packer before the rendering adapter uploads it to an engine texture. */
export type LottieAtlasCanvas = OffscreenCanvas | HTMLCanvasElement;

/** Options used when creating an engine texture for a Lottie atlas page. */
export type LottieAtlasTextureCreationOptions = {
    /** Atlas canvas containing the initial page pixels. */
    canvas: LottieAtlasCanvas;
    /** Atlas page width in pixels. */
    width: number;
    /** Atlas page height in pixels. */
    height: number;
};

/** Engine-owned texture wrapper for one Lottie atlas page. */
export type LottieAtlasTexture<TextureType = unknown> = {
    /** Texture object consumed by the sprite rendering adapter. */
    readonly texture: TextureType;
    /** Uploads the latest atlas canvas pixels into the engine texture. */
    update(canvas: LottieAtlasCanvas): void;
};

/** Adapter surface used by the atlas packer to create engine textures without depending on a specific engine. */
export type LottieAtlasTextureFactory<TextureType = unknown> = {
    /** Creates an engine texture for a newly allocated atlas page and uploads the initial canvas pixels. */
    createAtlasTexture(options: LottieAtlasTextureCreationOptions): LottieAtlasTexture<TextureType>;
};
