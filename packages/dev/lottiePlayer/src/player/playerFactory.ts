// Parses a Lottie document, installs the base fill renderer, then loads optional renderer chunks
// for the layer kinds present in that document.

import { type ThinEngine } from "core/Engines/thinEngine";

import { type ILottieFile } from "../animation/lottieRaw";
import { type ILayerRenderer } from "../rendering/vector/layerRenderer";
import { ParseAnimation, type ILottiePlayerOptions, type IParsedAnimation } from "../animation/parse";
import { CreateFillRenderer } from "../rendering/vector/fillRenderer";
import { BuildPlayer, type ILottiePlayer } from "./playerCore";
import { IsNativeEngine } from "../rendering/vector/nativeEngineAdapter";

/**
 * Validates renderer features that differ across engine backends.
 * @param engine The target engine.
 * @param animation The parsed animation.
 */
export function ValidateEngineFeatures(engine: ThinEngine, animation: IParsedAnimation): void {
    if (!IsNativeEngine(engine)) {
        if (!engine.isStencilEnable) {
            throw new Error("Lottie vector rendering requires an engine created with stencil enabled.");
        }
        return;
    }
    for (const layer of animation.layers) {
        if ((layer.masks?.length ?? 0) > 0 || layer.matteMode || layer.matteOnly) {
            throw new Error("Lottie masks and track mattes are not currently supported by Babylon Native.");
        }
    }
}

/**
 * Creates a player for a Lottie document. The fill renderer is always available; text and image
 * renderer chunks load only when those layer kinds are present.
 * @param engine The engine to render with, from `CreateVectorEngine`.
 * @param file The raw Lottie document.
 * @param options Player options. `variables` substitutes text-layer content at load time for
 * localization (whole-string key match); `backgroundColor` sets the per-frame clear color.
 * @returns The player handle once all required renderer chunks have loaded.
 */
export async function CreateLottiePlayerAsync(engine: ThinEngine, file: ILottieFile, options?: ILottiePlayerOptions): Promise<ILottiePlayer> {
    const anim = ParseAnimation(file, options?.variables);
    ValidateEngineFeatures(engine, anim);
    const renderers = new Map<number, ILayerRenderer>();
    let hasText = false;
    let hasImages = false;
    for (const layer of anim.layers) {
        hasText ||= layer.kind === 5 && !!layer.text?.text;
        hasImages ||= layer.kind === 2 && layer.image !== undefined;
    }

    renderers.set(4, CreateFillRenderer(engine));
    try {
        const [textModule, imageModule] = await Promise.all([
            hasText ? import("../rendering/vector/textRenderer") : Promise.resolve(null),
            hasImages ? import("../rendering/vector/imageRenderer") : Promise.resolve(null),
        ]);

        if (textModule) {
            renderers.set(
                5,
                textModule.CreateTextRenderer(
                    engine,
                    anim.layers.filter((l) => l.kind === 5)
                )
            );
        }
        if (imageModule) {
            renderers.set(2, imageModule.CreateImageRenderer(engine, anim.assets));
        }
    } catch (error) {
        for (const renderer of renderers.values()) {
            renderer.dispose();
        }
        throw error;
    }

    return BuildPlayer(engine, anim, renderers, options?.backgroundColor);
}
