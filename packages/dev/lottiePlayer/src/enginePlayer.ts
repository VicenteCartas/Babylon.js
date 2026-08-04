import { type Nullable } from "core/types";
import { type LottieEngine, type EngineAnimationInput, type IEnginePlayerOptions } from "./types";
import { type ILottieFile } from "./animation/lottieRaw";
import { GetRawAnimationDataAsync } from "./animation/loadAnimation";
import { AnimationController } from "./rendering/animationController";

/**
 * Plays Lottie animations into a caller-owned Babylon engine and its current backbuffer.
 *
 * The engine is never resized or disposed. The player clears the active backbuffer every frame, so
 * it should use an engine dedicated to the animation rather than one concurrently rendering a scene.
 * Each instance plays at most one animation; create another instance to play a different animation.
 */
export class EnginePlayer {
    private readonly _engine: LottieEngine;
    private readonly _options: IEnginePlayerOptions;
    private _controller: Nullable<AnimationController> = null;
    private _starting = false;
    private _generation = 0;
    private _playing = false;
    private _disposed = false;

    /**
     * Creates a player for a caller-owned engine.
     * @param engine The engine and backbuffer to render into. NativeEngine and ThinNativeEngine are supported through ThinEngine inheritance.
     * Browser ThinEngine instances must have been created with a stencil buffer.
     * @param options Runtime integration options, such as a Native Canvas2D factory for text layers.
     */
    public constructor(engine: LottieEngine, options: IEnginePlayerOptions = {}) {
        this._engine = engine;
        this._options = options;
    }

    /**
     * Loads and plays a Lottie animation on the supplied engine's render loop.
     * @param input Animation data and playback options. No DOM container is required.
     * @returns True when playback starts, or false if this instance is already starting, playing, or disposed.
     */
    public async playAnimationAsync(input: EngineAnimationInput): Promise<boolean> {
        if (this._playing || this._starting || this._disposed) {
            return false;
        }

        this._starting = true;
        const generation = ++this._generation;
        try {
            const animation = typeof input.animationSource === "string" ? await GetRawAnimationDataAsync(input.animationSource) : (input.animationSource as ILottieFile);
            if (this._disposed || generation !== this._generation) {
                return false;
            }
            const controller = await AnimationController.CreateWithEngineAsync(
                this._engine,
                animation,
                input.variables ?? new Map<string, string>(),
                input.configuration ?? {},
                this._options.createTextCanvas,
                input.onFirstRender
            );
            if (this._disposed || generation !== this._generation) {
                controller.dispose();
                return false;
            }
            try {
                controller.playAnimation();
            } catch (error) {
                controller.dispose();
                throw error;
            }
            this._controller = controller;
            this._playing = true;
            return true;
        } finally {
            if (generation === this._generation) {
                this._starting = false;
            }
        }
    }

    /** Stops playback and releases Lottie-owned GPU resources without disposing the supplied engine. */
    public dispose(): void {
        this._generation++;
        this._starting = false;
        if (this._controller) {
            this._controller.dispose();
            this._controller = null;
        }
        this._playing = false;
        this._disposed = true;
    }
}
