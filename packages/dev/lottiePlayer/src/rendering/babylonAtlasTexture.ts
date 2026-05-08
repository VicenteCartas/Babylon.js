import "core/Engines/Extensions/engine.dynamicTexture";

import { type ThinEngine } from "core/Engines/thinEngine";
import { type InternalTexture } from "core/Materials/Textures/internalTexture";
import { ThinTexture } from "core/Materials/Textures/thinTexture";

import { type LottieAtlasCanvas, type LottieAtlasTexture, type LottieAtlasTextureCreationOptions, type LottieAtlasTextureFactory } from "./lottieAtlas";

class BabylonLottieAtlasTexture implements LottieAtlasTexture<ThinTexture> {
    private readonly _engine: ThinEngine;
    private readonly _internalTexture: InternalTexture;

    /** Texture object consumed by Babylon.js sprite rendering. */
    public readonly texture: ThinTexture;

    /**
     * Creates a Babylon.js dynamic texture for one Lottie atlas page.
     * @param engine ThinEngine instance used to allocate and update the dynamic texture.
     * @param options Initial atlas page canvas and dimensions.
     */
    public constructor(engine: ThinEngine, options: LottieAtlasTextureCreationOptions) {
        this._engine = engine;
        this._internalTexture = engine.createDynamicTexture(options.width, options.height, false, 2);
        this._engine.updateDynamicTexture(this._internalTexture, options.canvas, false);

        this.texture = new ThinTexture(this._internalTexture);
        this.texture.wrapU = 0;
        this.texture.wrapV = 0;
    }

    /**
     * Uploads the latest atlas canvas pixels into the Babylon.js dynamic texture.
     * @param canvas Atlas canvas containing the latest page pixels.
     */
    public update(canvas: LottieAtlasCanvas): void {
        this._engine.updateDynamicTexture(this._internalTexture, canvas, false);
    }
}

/**
 * Creates a texture factory that uploads Lottie atlas pages as Babylon.js dynamic textures.
 * @param engine ThinEngine instance used to allocate and update dynamic textures.
 * @returns A Lottie atlas texture factory backed by Babylon.js ThinTexture instances.
 */
export function CreateBabylonLottieAtlasTextureFactory(engine: ThinEngine): LottieAtlasTextureFactory<ThinTexture> {
    return {
        createAtlasTexture: (options) => new BabylonLottieAtlasTexture(engine, options),
    };
}
