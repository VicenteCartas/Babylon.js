import { type Nullable } from "core/types";
import { type ILottieFile as RawLottieAnimation } from "./animation/lottieRaw";
import { type AnimationConfiguration } from "./animationConfiguration";
import { type ThinEngine } from "core/Engines/thinEngine";

/**
 * Input parameters required to load and play an animation
 */
export type AnimationInput = {
    /** The container where the canvas that displays the animation is rendered */
    container: HTMLDivElement;
    /** The source of the animation data, either a URL or the raw JSON data */
    animationSource: string | RawLottieAnimation;
    /** A map of variables to be used in the animation */
    variables: Nullable<Map<string, string>>;
    /** Configuration options for the animation */
    configuration: Nullable<Partial<AnimationConfiguration>>;
    /** Callback invoked after the first frame of the animation has been rendered. Not serialized to workers. */
    onFirstRender?: () => void;
};

/**
 * A mutable 2D canvas accepted by the caller-owned engine's `updateDynamicTexture` method.
 * Its context must implement the Canvas2D text measurement and drawing operations.
 */
export interface ILottieTextCanvas {
    /** Canvas width in physical pixels. */
    width: number;
    /** Canvas height in physical pixels. */
    height: number;
    /** Gets the mutable 2D drawing context used to measure and rasterize text. */
    getContext(contextId?: "2d"): unknown;
}

/** Options for {@link EnginePlayer}. */
export interface IEnginePlayerOptions {
    /**
     * Overrides the engine's 2D canvas factory used to rasterize text layers. Browsers and Babylon
     * Native normally provide this through engine.createCanvas(). The returned canvas must be
     * accepted by the same engine's `updateDynamicTexture` method.
     */
    createTextCanvas?: () => ILottieTextCanvas;
}

/** Input for a caller-owned-engine player. Rendering targets the engine's current backbuffer. */
export type EngineAnimationInput = Omit<AnimationInput, "container">;

/** Engine type accepted by {@link EnginePlayer}. NativeEngine and ThinNativeEngine inherit from it. */
export type LottieEngine = ThinEngine;
