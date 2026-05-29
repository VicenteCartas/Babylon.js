import { type AnimationInput } from "./types";
import { CreatePlayer, DisposePlayer, PlayAnimationAsync, PreWarmPlayerAsync, type PlayerState } from "./playerRuntime";

/**
 * Allows you to play Lottie animations using Babylon.js.
 * It plays the animations in a worker thread using OffscreenCanvas.
 * Once instance of this class can only be used to play a single animation. If you want to play multiple animations, create a new instance for each animation.
 *
 * This class is a thin wrapper over the functional runtime in `playerRuntime.ts`
 * (`CreatePlayer`, `PreWarmPlayerAsync`, `PlayAnimationAsync`, `DisposePlayer`).
 */
export class Player {
    private readonly _state: PlayerState;

    /**
     * Creates a new instance of the LottiePlayer.
     * If OffscreenCanvas is not supported by the browser, the animation will not play. Try using LocalLottiePlayer instead.
     * @throws Error if OffscreenCanvas is not supported
     */
    public constructor() {
        this._state = CreatePlayer();
    }

    /**
     * Pre-warms the worker by loading necessary code ahead of time.
     * This promise resolves when the worker has loaded all the code required to play an animation.
     * @returns A Promise that resolves to this Player instance when the worker is ready
     * @throws Error if the player is already playing or disposed
     */
    public async preWarmPlayerAsync(): Promise<Player> {
        await PreWarmPlayerAsync(this._state);
        return this;
    }

    /**
     * Loads and plays a lottie animation using a webworker and offscreen canvas.
     * @param input Input parameters required to load and play the animation.
     * @returns True if the animation is successfully set up to play, false if the animation couldn't play.
     */
    public async playAnimationAsync(input: AnimationInput): Promise<boolean> {
        return await PlayAnimationAsync(this._state, input);
    }

    /**
     * Disposes the LottiePlayer instance, cleaning up resources and event listeners.
     */
    public dispose(): void {
        DisposePlayer(this._state);
    }
}
