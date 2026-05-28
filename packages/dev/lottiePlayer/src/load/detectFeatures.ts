import { type LottieFeatureId } from "../features/feature";
import { type LottieFeatureConfig } from "../animationConfiguration";
import { type RawLottieAnimation } from "../parsing/rawTypes";

function HasVisibleLayerOfType(raw: RawLottieAnimation, layerType: number): boolean {
    for (let i = 0; i < raw.layers.length; i++) {
        const layer = raw.layers[i];
        if (layer.hd === true) {
            continue;
        }
        if (layer.ty === layerType) {
            return true;
        }
    }
    return false;
}

/**
 * Detects which Lottie feature modules are required by the raw animation data and engine-free configuration.
 * @param raw Raw Lottie animation data.
 * @param featureConfig Engine-free feature configuration.
 * @returns Stable ordered list of required feature ids.
 */
export function DetectLottieFeatures(raw: RawLottieAnimation, featureConfig: LottieFeatureConfig): LottieFeatureId[] {
    const features: LottieFeatureId[] = [];

    if (featureConfig.compatibility.solidLayerRendering === "spec" && HasVisibleLayerOfType(raw, 1)) {
        features.push("solid");
    }
    if (HasVisibleLayerOfType(raw, 4)) {
        features.push("shape");
    }
    if (HasVisibleLayerOfType(raw, 5)) {
        features.push("text");
    }

    return features;
}

export { DetectLottieFeatures as detectLottieFeatures };
