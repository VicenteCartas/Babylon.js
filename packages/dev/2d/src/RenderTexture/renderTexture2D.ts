import "core/Engines/Extensions/engine.readTexture";
import "core/Engines/WebGPU/Extensions/engine.readTexture";

import type { AbstractEngine } from "core/Engines/abstractEngine";
import type { RenderTargetWrapper } from "core/Engines/renderTargetWrapper";
import type { ThinEngine } from "core/Engines/thinEngine";
import { Constants } from "core/Engines/constants";
import type { InternalTexture } from "core/Materials/Textures/internalTexture";
import { ThinTexture } from "core/Materials/Textures/thinTexture";
import type { RenderTargetCreationOptions } from "core/Materials/Textures/textureCreationOptions";
import { Color4 } from "core/Maths/math.color";

import type { Node2D } from "../Node2D/node2D";
import type { Scene2D } from "../Scene2D/scene2D";

interface IRenderTextureReadPixelsEngine extends AbstractEngine {
    _readTexturePixelsSync(
        texture: InternalTexture,
        width: number,
        height: number,
        faceIndex?: number,
        level?: number,
        buffer?: ArrayBufferView | null,
        flushRenderer?: boolean,
        noDataConversion?: boolean,
        x?: number,
        y?: number
    ): ArrayBufferView;
}

/**
 * Options for creating a RenderTexture2D.
 */
export interface IRenderTexture2DOptions {
    /**
     * Whether to generate mip maps for the render texture.
     * Default: false.
     */
    generateMipMaps?: boolean;

    /**
     * Sampling mode for the render texture.
     * Default: Constants.TEXTURE_BILINEAR_SAMPLINGMODE.
     */
    samplingMode?: number;

    /**
     * Texture format.
     * Default: Constants.TEXTUREFORMAT_RGBA.
     */
    format?: number;

    /**
     * Texture type.
     * Default: Constants.TEXTURETYPE_UNSIGNED_BYTE.
     */
    type?: number;

    /**
     * Whether to generate a depth buffer.
     * Default: false.
     */
    generateDepthBuffer?: boolean;

    /**
     * Whether to generate a stencil buffer.
     * Default: false.
     */
    generateStencilBuffer?: boolean;
}

/**
 * An offscreen render target for Scene2D content.
 *
 * Renders a Scene2D to a GPU texture on demand. The resulting texture can be
 * assigned to any Sprite2D for minimaps, portals, transition effects, and
 * other render-to-texture workflows.
 */
export class RenderTexture2D {
    /**
     * Name of this render texture, useful for debugging.
     */
    public readonly name: string;

    /**
     * Clear color used when autoClear is enabled or clear() is called.
     */
    public clearColor: Color4 = new Color4(0, 0, 0, 0);

    /**
     * Whether to clear the render target before each render call.
     * Default: true.
     */
    public autoClear: boolean = true;

    private readonly _engine: AbstractEngine;
    private _width: number;
    private _height: number;
    private readonly _options: IRenderTexture2DOptions;
    private _renderTarget: RenderTargetWrapper;
    private _thinTexture: ThinTexture | null = null;
    private _isDisposed: boolean = false;

    /**
     * Creates a new RenderTexture2D.
     * @param name - Display name for debugging.
     * @param engine - The Babylon.js engine instance.
     * @param width - Width of the render texture in pixels.
     * @param height - Height of the render texture in pixels.
     * @param options - Optional creation options.
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
     * Gets the width of the render texture in pixels.
     * @returns The width in pixels.
     */
    public get width(): number {
        return this._width;
    }

    /**
     * Gets the height of the render texture in pixels.
     * @returns The height in pixels.
     */
    public get height(): number {
        return this._height;
    }

    /**
     * Gets the underlying render target wrapper for low-level access.
     * @returns The underlying render target wrapper.
     */
    public get renderTarget(): RenderTargetWrapper {
        return this._renderTarget;
    }

    /**
     * Gets a ThinTexture wrapper suitable for Sprite2D.texture.
     * @returns The wrapped render target texture.
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
     * Whether dispose() has been called.
     * @returns True when disposed.
     */
    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    /**
     * Renders the given Scene2D into this texture.
     *
     * The scene's camera is used for the view transform. When updateScene is
     * true, the scene update pass and camera update are also executed.
     *
     * @param scene - The Scene2D to render.
     * @param deltaTime - Time since last frame in seconds.
     * @param updateScene - Whether to update the scene before rendering. Default: false.
     */
    public renderScene(scene: Scene2D, deltaTime?: number, updateScene: boolean = false): void {
        if (this._isDisposed) {
            return;
        }

        if (scene.camera) {
            if (updateScene) {
                scene.camera.update(deltaTime ?? 0, this._width, this._height);
            } else {
                scene.camera.setViewport(this._width, this._height);
            }
        }

        if (updateScene) {
            scene.update(deltaTime ?? 0);
        }

        this._withBoundRenderTarget(() => {
            if (this.autoClear) {
                this._clearBoundRenderTarget();
            }
            scene._renderContentDirect(false, false);
        });
    }

    /**
     * Renders a single Node2D subtree into this texture.
     * @param node - Root node to render.
     * @param viewportOffsetX - Horizontal offset in pixels. Default: 0.
     * @param viewportOffsetY - Vertical offset in pixels. Default: 0.
     */
    public renderNode(node: Node2D, viewportOffsetX: number = 0, viewportOffsetY: number = 0): void {
        if (this._isDisposed) {
            return;
        }

        const scene = node.scene;
        if (!scene) {
            throw new Error(`Cannot render node '${node.name}' without an owning Scene2D.`);
        }

        if (scene.camera) {
            scene.camera.setViewport(this._width, this._height);
        }

        this._withBoundRenderTarget(() => {
            if (this.autoClear) {
                this._clearBoundRenderTarget();
            }
            scene._renderSubtreeContent(node, false, viewportOffsetX, viewportOffsetY);
        });
    }

    /**
     * Clears the render texture using clearColor.
     */
    public clear(): void {
        if (this._isDisposed) {
            return;
        }

        this._withBoundRenderTarget(() => {
            this._clearBoundRenderTarget();
        });
    }

    /**
     * Reads back the texture pixels.
     * Expensive: GPU readback stalls the pipeline.
     *
     * Only unsigned-byte render textures can be read through this API.
     * @param out - Optional pre-allocated output buffer.
     * @returns A Uint8Array view of the pixel data.
     */
    public readPixels(out?: Uint8Array): Uint8Array {
        if (this._isDisposed) {
            throw new Error(`Cannot read pixels from disposed RenderTexture2D '${this.name}'.`);
        }

        const textureType = this._options.type ?? Constants.TEXTURETYPE_UNSIGNED_BYTE;
        if (textureType !== Constants.TEXTURETYPE_UNSIGNED_BYTE) {
            throw new Error(`RenderTexture2D.readPixels() only supports TEXTURETYPE_UNSIGNED_BYTE render textures. '${this.name}' was created with type ${textureType}.`);
        }

        const requiredLength = this._width * this._height * 4;
        if (out && out.length < requiredLength) {
            throw new Error(`RenderTexture2D.readPixels() expected an output buffer of at least ${requiredLength} bytes for '${this.name}', but received ${out.length}.`);
        }

        const texture = this._renderTarget.texture;
        if (!texture) {
            throw new Error(`RenderTexture2D '${this.name}' does not have an underlying render texture to read from.`);
        }

        const engine = this._engine as IRenderTextureReadPixelsEngine;

        try {
            const result = engine._readTexturePixelsSync(texture, this._width, this._height, -1, 0, out ?? null, true, false, 0, 0);
            if (!(result instanceof Uint8Array)) {
                throw new Error(`Expected Uint8Array pixel data but received ${result.constructor.name}.`);
            }
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Cannot synchronously read pixels from RenderTexture2D '${this.name}': ${message}`);
        }
    }

    /**
     * Resizes the render texture.
     * @param width - New width in pixels.
     * @param height - New height in pixels.
     */
    public resize(width: number, height: number): void {
        if (this._isDisposed) {
            return;
        }

        if (width === this._width && height === this._height) {
            return;
        }

        this._disposeInternal();

        this._width = width;
        this._height = height;
        this._renderTarget = this._createRenderTarget();
    }

    /**
     * Disposes the render texture and its GPU resources.
     */
    public dispose(): void {
        if (this._isDisposed) {
            return;
        }

        this._disposeInternal();
        this._isDisposed = true;
    }

    /**
     * Creates the underlying render target wrapper.
     * @returns The created render target wrapper.
     */
    private _createRenderTarget(): RenderTargetWrapper {
        const options: RenderTargetCreationOptions = {
            generateMipMaps: this._options.generateMipMaps ?? false,
            samplingMode: this._options.samplingMode ?? Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
            format: this._options.format ?? Constants.TEXTUREFORMAT_RGBA,
            type: this._options.type ?? Constants.TEXTURETYPE_UNSIGNED_BYTE,
            generateDepthBuffer: this._options.generateDepthBuffer ?? false,
            generateStencilBuffer: this._options.generateStencilBuffer ?? false,
            label: this.name,
        };

        return this._engine.createRenderTargetTexture({ width: this._width, height: this._height }, options);
    }

    /**
     * Executes work while this render target is bound.
     * @param action - Action to execute.
     */
    private _withBoundRenderTarget(action: () => void): void {
        const engine = this._engine as ThinEngine;
        engine.unbindAllTextures();
        this._engine.bindFramebuffer(this._renderTarget);
        try {
            action();
        } finally {
            this._engine.restoreDefaultFramebuffer();
        }
    }

    /**
     * Clears the currently bound render target.
     */
    private _clearBoundRenderTarget(): void {
        this._engine.clear(
            this.clearColor,
            true,
            this._options.generateDepthBuffer ?? false,
            this._options.generateStencilBuffer ?? false
        );
    }

    /**
     * Disposes the render target and cached thin texture without changing isDisposed.
     */
    private _disposeInternal(): void {
        this._thinTexture = null;
        this._renderTarget.dispose();
    }
}
