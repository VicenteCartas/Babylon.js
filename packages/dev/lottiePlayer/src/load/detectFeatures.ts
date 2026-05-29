import { type LottieFeatureId } from "../features/feature";
import { LayerTypeFeatureTable } from "../features/layerTypes";
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

    for (let i = 0; i < LayerTypeFeatureTable.length; i++) {
        const { layerType, featureId } = LayerTypeFeatureTable[i];
        if (!HasVisibleLayerOfType(raw, layerType)) {
            continue;
        }
        // Solid layers only render through the spec-mode feature; babylon8 compat leaves them to legacy handling.
        if (featureId === "solid" && featureConfig.compatibility.solidLayerRendering !== "spec") {
            continue;
        }
        features.push(featureId);
    }

    return features;
}

export { DetectLottieFeatures as detectLottieFeatures };
