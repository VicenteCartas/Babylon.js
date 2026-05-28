import { type LottieFeature, type LottieFeatureId, type LottieFeatureSet } from "../features/feature";
import { type LottieFeatureConfig } from "../animationConfiguration";
import { type RawLottieAnimation } from "../parsing/rawTypes";
import { DetectLottieFeatures } from "./detectFeatures";

type LottieFeatureModule = { default: LottieFeature };
type LottieFeatureLoader = {
    id: LottieFeatureId;
    loadAsync: () => Promise<LottieFeatureModule>;
};

const FeatureLoaders: readonly LottieFeatureLoader[] = [
    { id: "solid", loadAsync: async () => await import("../features/solid") },
    { id: "shape", loadAsync: async () => await import("../features/shape") },
    { id: "text", loadAsync: async () => await import("../features/text") },
];

function GetFeatureLoader(id: LottieFeatureId): LottieFeatureLoader {
    for (let i = 0; i < FeatureLoaders.length; i++) {
        const loader = FeatureLoaders[i];
        if (loader.id === id) {
            return loader;
        }
    }
    throw new Error(`No Lottie feature loader registered for ${id}`);
}

/**
 * Loads the feature modules required by one animation using explicit runtime detection.
 * @param raw Raw Lottie animation data.
 * @param featureConfig Engine-free feature configuration.
 * @returns Loaded feature set in detection order.
 */
export async function LoadLottieFeatures(raw: RawLottieAnimation, featureConfig: LottieFeatureConfig): Promise<LottieFeatureSet> {
    const ids = DetectLottieFeatures(raw, featureConfig);
    const featurePromises: Promise<LottieFeatureModule>[] = [];

    for (let i = 0; i < ids.length; i++) {
        featurePromises.push(GetFeatureLoader(ids[i]).loadAsync());
    }

    const modules = await Promise.all(featurePromises);
    const features = modules.map((module) => module.default);
    return { ids, features };
}

export { LoadLottieFeatures as loadLottieFeatures };
