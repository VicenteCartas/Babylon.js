import { type AnimationInput } from "./types";
import { CreateLocalPlayer, DisposeLocalPlayer, PlayLocalAnimationAsync, type LocalPlayerState } from "./localPlayerRuntime";

/**
 * Allows you to play Lottie animations using Babylon.js.
 * It plays the animations in the main JS thread. Prefer to use Player instead if Offscreen canvas and worker threads are supported.
 * Once instance of this class can only be used to play a single animation. If you want to play multiple animations, create a new instance for each animation.
 *
 * This class is a thin wrapper over the functional runtime in `localPlayerRuntime.ts`
 * (`CreateLocalPlayer`, `PlayLocalAnimationAsync`, `DisposeLocalPlayer`).
 */
export class LocalPlayer {
    private readonly _state: LocalPlayerState;

    /**
     * Creates a new instance of the LottiePlayer.
     */
    public constructor() {
        this._state = CreateLocalPlayer();
    }

    /**
     * Loads and plays a lottie animation.
     * @param input Input parameters required to load and play the animation.
     * @returns True if the animation is successfully set up to play, false if the animation couldn't play.
     */
    public async playAnimationAsync(input: AnimationInput): Promise<boolean> {
        return await PlayLocalAnimationAsync(this._state, input);
    }

    /**
     * Disposes the LottiePlayer instance, cleaning up resources and event listeners.
     */
    public dispose(): void {
        DisposeLocalPlayer(this._state);
    }
}
