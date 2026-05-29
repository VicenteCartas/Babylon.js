import { type LottieShapeLayerFeature } from "./layers/shapeLayer";
import { type LottieSolidLayerFeature } from "./layers/solidLayer";
import { type LottieTextLayerFeature } from "./layers/textLayer";

/**
 * Identifies an independently loadable Lottie feature module.
 */
export type LottieFeatureId = "solid" | "shape" | "text";

/**
 * Describes a Lottie feature that has been explicitly loaded for an animation.
 */
export type LottieFeature = {
    /** Unique feature identifier. */
    id: LottieFeatureId;
    /** Lottie layer types owned by this feature. */
    layerTypes: readonly number[];
    /** Solid layer behavior, present only on the solid feature. */
    solidLayer?: LottieSolidLayerFeature;
    /** Shape layer behavior, present only on the shape feature. */
    shapeLayer?: LottieShapeLayerFeature;
    /** Text layer behavior, present only on the text feature. */
    textLayer?: LottieTextLayerFeature;
};

/**
 * Explicit set of Lottie features selected for one animation parse.
 */
export type LottieFeatureSet = {
    /** Stable feature ids in detection order. */
    ids: readonly LottieFeatureId[];
    /** Loaded feature modules in detection order. */
    features: readonly LottieFeature[];
};
