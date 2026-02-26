import type { AbstractEngine } from "core/Engines/abstractEngine";
import type { RenderTargetWrapper } from "core/Engines/renderTargetWrapper";
import type { RenderTargetCreationOptions } from "core/Materials/Textures/textureCreationOptions";
import type { ThinEngine } from "core/Engines/thinEngine";
import { ThinTexture } from "core/Materials/Textures/thinTexture";
import { Constants } from "core/Engines/constants";

import type { Scene2D } from "../Scene2D/scene2D";

/**
 * Options for creating a RenderTexture2D
 */
export interface IRenderTexture2DOptions {
    /**
     * Whether to generate mip maps for the render texture.
     * Default: false
     */
    generateMipMaps?: boolean;

    /**
     * Sampling mode for the render texture.
     * Default: Constants.TEXTURE_BILINEAR_SAMPLINGMODE
     */
    samplingMode?: number;

    /**
     * Texture format.
     * Default: Constants.TEXTUREFORMAT_RGBA
     */
    format?: number;

    /**
     * Texture type.
     * Default: Constants.TEXTURETYPE_UNSIGNED_BYTE
     */
    type?: number;

    /**
     * Whether to generate a depth buffer.
     * Default: false
     */
    generateDepthBuffer?: boolean;

    /**
     * Whether to generate a stencil buffer.
     * Default: false
     */
    generateStencilBuffer?: boolean;
}

/**
 * Renders a Scene2D's content to an offscreen texture.
 *
 * The resulting texture can be used as a sprite texture in the rendering
 * pipeline — for example, minimaps, reflections, or transition effects.
 *
 * @example
 * ```typescript
 * const rt = new RenderTexture2D("minimap", engine, 256, 256);
 * rt.renderScene(minimapScene);
 * mySprite.texture = rt.texture; // use as sprite source
 * ```
 */
export class RenderTexture2D {
    /**
     * Display name of this render texture (for debugging)
     */
    public readonly name: string;

    private _engine: AbstractEngine;
    private _width: number;
    private _height: number;
    private _options: IRenderTexture2DOptions;
    private _renderTarget: RenderTargetWrapper;
    private _thinTexture: ThinTexture | null = null;
    private _isDisposed: boolean = false;

    /**
     * Creates a new RenderTexture2D
     * @param name - Display name for debugging
     * @param engine - The Babylon.js engine instance
     * @param width - Width of the render texture in pixels
     * @param height - Height of the render texture in pixels
     * @param options - Optional creation options
     */
    constructor(name: string, engine: AbstractEngine, width: number, height: number, options?: IRenderTexture2DOptions) {
        this.name = name;
        this._engine = engine;
        this._width = width;
        this._height = height;
        this._options = options ?? {};
        this._renderTarget = this._createRenderTarget();
    }

    /**
     * Gets the width of the render texture in pixels
     */
    public get width(): number {
        return this._width;
    }

    /**
     * Gets the height of the render texture in pixels
     */
    public get height(): number {
        return this._height;
    }

    /**
     * Gets the underlying RenderTargetWrapper for low-level access
     */
    public get renderTarget(): RenderTargetWrapper {
        return this._renderTarget;
    }

    /**
     * Gets a ThinTexture that wraps the render target, suitable for
     * use as a sprite texture in the 2D rendering pipeline.
     *
     * The ThinTexture is created once and cached. Wrap modes are
     * set to CLAMP to prevent bleeding at texture edges.
     */
    public get texture(): ThinTexture {
        if (!this._thinTexture) {
            this._thinTexture = new ThinTexture(this._renderTarget);
            this._thinTexture.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
            this._thinTexture.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
        }
        return this._thinTexture;
    }

    /**
     * Whether this render texture has been disposed
     */
    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    /**
     * Renders a Scene2D's content into this offscreen texture.
     *
     * Binds the framebuffer, delegates to the scene's render pipeline
     * (which handles viewport, clearing, sprite collection, sorting,
     * and batching), and restores the default framebuffer.
     *
     * @param scene - The Scene2D to render
     * @param clear - Whether to clear the render target before rendering. Default: true.
     */
    public renderScene(scene: Scene2D, clear: boolean = true): void {
        if (this._isDisposed) {
            return;
        }

        const engine = this._engine;

        // Unbind all textures before binding the FBO to prevent WebGL feedback
        // loops. If a previous frame rendered a sprite using this RT as its
        // texture, the InternalTexture may still be bound on a texture unit.
        // WebGL raises GL_INVALID_OPERATION when drawing to a framebuffer whose
        // color attachment is simultaneously bound as a texture source.
        (engine as ThinEngine).unbindAllTextures();

        engine.bindFramebuffer(this._renderTarget);
        try {
            scene.renderContent(clear);
        } finally {
            engine.restoreDefaultFramebuffer();
        }
    }

    /**
     * Resizes the render texture to new dimensions.
     *
     * Disposes the old render target and cached ThinTexture, then creates
     * new ones with the specified dimensions.
     *
     * @param width - New width in pixels
     * @param height - New height in pixels
     */
    public resize(width: number, height: number): void {
        if (width === this._width && height === this._height) {
            return;
        }

        this._disposeInternal();

        this._width = width;
        this._height = height;

        this._renderTarget = this._createRenderTarget();
    }

    /**
     * Reads the pixel data from the render texture asynchronously.
     *
     * Binds the framebuffer, reads pixels, then restores the default
     * framebuffer. The returned buffer contains RGBA pixel data.
     *
     * @returns A promise that resolves with the pixel data as an ArrayBufferView
     */
    public async readPixelsAsync(): Promise<ArrayBufferView> {
        if (this._isDisposed) {
            throw new Error(`Cannot read pixels from disposed RenderTexture2D '${this.name}'`);
        }

        const engine = this._engine;

        engine.bindFramebuffer(this._renderTarget);
        try {
            return await engine.readPixels(0, 0, this._width, this._height, true, true);
        } finally {
            engine.restoreDefaultFramebuffer();
        }
    }

    /**
     * Disposes the render texture and releases all GPU resources.
     *
     * After calling dispose, the render texture cannot be used again.
     */
    public dispose(): void {
        if (this._isDisposed) {
            return;
        }

        this._disposeInternal();
        this._isDisposed = true;
    }

    /**
     * Creates the underlying render target wrapper with the configured options.
     * @returns A new RenderTargetWrapper
     */
    private _createRenderTarget(): RenderTargetWrapper {
        const opts: RenderTargetCreationOptions = {
            generateMipMaps: this._options.generateMipMaps ?? false,
            samplingMode: this._options.samplingMode ?? Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
            format: this._options.format ?? Constants.TEXTUREFORMAT_RGBA,
            type: this._options.type ?? Constants.TEXTURETYPE_UNSIGNED_BYTE,
            generateDepthBuffer: this._options.generateDepthBuffer ?? false,
            generateStencilBuffer: this._options.generateStencilBuffer ?? false,
            label: this.name,
        };

        return this._engine.createRenderTargetTexture({ width: this._width, height: this._height }, opts);
    }

    /**
     * Disposes the render target and cached thin texture without marking as disposed.
     * Used internally by both resize() and dispose().
     */
    private _disposeInternal(): void {
        if (this._thinTexture) {
            // Only release the ThinTexture wrapper — the underlying InternalTexture
            // is owned by the RenderTargetWrapper and will be disposed with it.
            this._thinTexture = null;
        }

        if (this._renderTarget) {
            this._renderTarget.dispose();
        }
    }
}
