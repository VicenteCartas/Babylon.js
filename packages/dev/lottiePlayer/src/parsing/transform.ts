import { type IVector2Like } from "core/Maths/math.like";

import { BezierCurve } from "../maths/bezier";
import { type ScalarKeyframe, type ScalarProperty, type Transform, type Vector2Keyframe, type Vector2Property } from "./parsedTypes";
import { type RawScalarProperty, type RawTransform, type RawVectorKeyframe, type RawVectorProperty } from "./rawTypes";
import { type ParseDiagnostics } from "./diagnostics";

/**
 * Type of the vector properties in the Lottie animation. It determines how the vector values are interpreted in Babylon.js.
 */
type VectorType = "Scale" | "Position" | "AnchorPoint";
/**
 * Type of the scalar properties in the Lottie animation. It determines how the scalar values are interpreted in Babylon.js.
 */
type ScalarType = "Rotation" | "Opacity";

/**
 * Default scale value for the scale property of a Lottie transform.
 */
const DefaultScale: IVector2Like = { x: 1, y: 1 };

/**
 * Default position value for the position property of a Lottie transform.
 */
const DefaultPosition: IVector2Like = { x: 0, y: 0 };

/**
 * Per-parse context required to convert raw lottie transform properties into Babylon transforms.
 */
export type TransformParseContext = {
    /** Number of subdivision steps used when sampling keyframe easing curves. */
    easingSteps: number;
    /** Name of the layer currently being parsed, used in diagnostics. */
    layerName: string | undefined;
    /** Original array index of the layer currently being parsed, used as a diagnostic dedup key. */
    layerOriginalIndex: number;
    /** Collector for unsupported-feature diagnostics. */
    diagnostics: ParseDiagnostics;
};

/**
 * Converts a raw lottie transform into the Babylon transform representation used by the node graph.
 * @param transform The raw lottie transform.
 * @param context Per-parse context (easing resolution, layer identity, diagnostics).
 * @returns The parsed transform.
 */
export function ParseTransform(transform: RawTransform, context: TransformParseContext): Transform {
    return {
        opacity: FromLottieScalarToBabylonScalar(transform.o, "Opacity", 1, context),
        rotation: FromLottieScalarToBabylonScalar(transform.r, "Rotation", 0, context),
        scale: FromLottieVector2ToBabylonVector2(transform.s, "Scale", DefaultScale, context),
        position: FromLottieVector2ToBabylonVector2(transform.p, "Position", DefaultPosition, context),
        anchorPoint: FromLottieVector2ToBabylonVector2(transform.a, "AnchorPoint", DefaultPosition, context),
    };
}

function FromLottieScalarToBabylonScalar(property: RawScalarProperty | undefined, scalarType: ScalarType, defaultValue: number, context: TransformParseContext): ScalarProperty {
    if (!property) {
        return {
            startValue: defaultValue,
            currentValue: defaultValue,
            currentKeyframeIndex: 0,
        };
    }

    if (property.a === 0) {
        let startValue = property.k as number;

        if (scalarType === "Opacity") {
            startValue = startValue / 100;
        }

        if (scalarType === "Rotation") {
            startValue = (-1 * (startValue * Math.PI)) / 180; // Lottie uses degrees for rotation, convert to radians
        }

        return {
            startValue: startValue,
            currentValue: startValue,
            currentKeyframeIndex: 0,
        };
    }

    const keyframes: ScalarKeyframe[] = [];
    const rawKeyFrames = property.k as RawVectorKeyframe[];
    let i: number;
    for (i = 0; i < rawKeyFrames.length; i++) {
        let easeFunction: BezierCurve | undefined = undefined;
        if (rawKeyFrames[i].o !== undefined && rawKeyFrames[i].i !== undefined) {
            if (Array.isArray(rawKeyFrames[i].o!.x)) {
                // Value is an array
                easeFunction = new BezierCurve(
                    (rawKeyFrames[i].o!.x as number[])[0],
                    (rawKeyFrames[i].o!.y as number[])[0],
                    (rawKeyFrames[i].i!.x as number[])[0],
                    (rawKeyFrames[i].i!.y as number[])[0],
                    context.easingSteps
                );
            } else {
                // Value is a number
                easeFunction = new BezierCurve(
                    rawKeyFrames[i].o!.x as number,
                    rawKeyFrames[i].o!.y as number,
                    rawKeyFrames[i].i!.x as number,
                    rawKeyFrames[i].i!.y as number,
                    context.easingSteps
                );
            }
        }

        let value = rawKeyFrames[i].s[0];

        if (scalarType === "Opacity") {
            value = value / 100;
        }

        if (scalarType === "Rotation") {
            value = (value * Math.PI) / 180; // Lottie uses degrees for rotation, convert to radians
        }

        keyframes.push({
            value: value,
            time: rawKeyFrames[i].t,
            easeFunction: easeFunction!, // We assume that the ease function is always defined if we have keyframes
        });
    }

    let startValue = rawKeyFrames[0].s[0];

    if (scalarType === "Opacity") {
        startValue = startValue / 100;
    }

    if (scalarType === "Rotation") {
        startValue = (-1 * (startValue * Math.PI)) / 180; // Lottie uses degrees for rotation, convert to radians
    }

    return {
        startValue: startValue,
        currentValue: startValue,
        keyframes: keyframes,
        currentKeyframeIndex: 0,
    };
}

function FromLottieVector2ToBabylonVector2(
    property: RawVectorProperty | undefined,
    vectorType: VectorType,
    defaultValue: IVector2Like,
    context: TransformParseContext
): Vector2Property {
    if (!property) {
        return {
            startValue: defaultValue,
            currentValue: defaultValue,
            currentKeyframeIndex: 0,
        };
    }

    if (property.l !== undefined && property.l !== 2) {
        context.diagnostics.push(`Invalid Vector2 Length - Length: ${property.l}`);
        return {
            startValue: defaultValue,
            currentValue: defaultValue,
            currentKeyframeIndex: 0,
        };
    }

    // The Lottie spec says `l` is optional and defaults to the array length, but in practice
    // some exporters omit it on `[x, y, 0]` triples (e.g. After Effects emits 3D-style transforms
    // even on 2D layers). We silently treat those as 2D using indices 0/1, but flag the case so
    // we don't keep accepting unexpected component counts unnoticed.
    if (property.l === undefined) {
        const sampleLength = property.a === 0 ? (property.k as number[]).length : ((property.k as RawVectorKeyframe[])[0]?.s?.length ?? 2);
        if (sampleLength !== 2) {
            // Include the original layer index in the dedup key so two layers that happen to share `nm`
            // each get their own warning instead of collapsing to a single message.
            context.diagnostics.pushOnce(
                `Vector2 missing 'l' with ${sampleLength}-component value (expected 2) - Layer: ${context.layerName ?? "<unknown>"} - LayerIdx: ${context.layerOriginalIndex} - VectorType: ${vectorType}. Using x/y components.`
            );
        }
    }

    if (property.a === 0) {
        const values = property.k as number[];
        const value = CalculateFinalVector(values[0], values[1], vectorType);
        return {
            startValue: value,
            currentValue: value,
            currentKeyframeIndex: 0,
        };
    }

    const keyframes: Vector2Keyframe[] = [];
    const rawKeyFrames = property.k as RawVectorKeyframe[];
    let i: number;
    for (i = 0; i < rawKeyFrames.length; i++) {
        let easeFunction1: BezierCurve | undefined = undefined;
        if (rawKeyFrames[i].o !== undefined && rawKeyFrames[i].i !== undefined) {
            if (Array.isArray(rawKeyFrames[i].o!.x)) {
                // Value is an array
                easeFunction1 = new BezierCurve(
                    (rawKeyFrames[i].o!.x as number[])[0],
                    (rawKeyFrames[i].o!.y as number[])[0],
                    (rawKeyFrames[i].i!.x as number[])[0],
                    (rawKeyFrames[i].i!.y as number[])[0],
                    context.easingSteps
                );
            } else {
                // Value is a number
                easeFunction1 = new BezierCurve(
                    rawKeyFrames[i].o!.x as number,
                    rawKeyFrames[i].o!.y as number,
                    rawKeyFrames[i].i!.x as number,
                    rawKeyFrames[i].i!.y as number,
                    context.easingSteps
                );
            }
        }

        let easeFunction2: BezierCurve | undefined = undefined;
        if (rawKeyFrames[i].o !== undefined && rawKeyFrames[i].i !== undefined) {
            if (Array.isArray(rawKeyFrames[i].o!.x)) {
                // Value is an array
                easeFunction2 = new BezierCurve(
                    (rawKeyFrames[i].o!.x as number[])[1],
                    (rawKeyFrames[i].o!.y as number[])[1],
                    (rawKeyFrames[i].i!.x as number[])[1],
                    (rawKeyFrames[i].i!.y as number[])[1],
                    context.easingSteps
                );
            } else {
                // Value is a number
                easeFunction2 = new BezierCurve(
                    rawKeyFrames[i].o!.x as number,
                    rawKeyFrames[i].o!.y as number,
                    rawKeyFrames[i].i!.x as number,
                    rawKeyFrames[i].i!.y as number,
                    context.easingSteps
                );
            }
        }

        keyframes.push({
            value: CalculateFinalVector(rawKeyFrames[i].s[0], rawKeyFrames[i].s[1], vectorType),
            time: rawKeyFrames[i].t,
            easeFunction1: easeFunction1!, // We assume that the ease function is always defined if we have keyframes
            easeFunction2: easeFunction2!, // We assume that the ease function is always defined if we have keyframes
        });
    }

    const startValue = CalculateFinalVector(rawKeyFrames[0].s[0], rawKeyFrames[0].s[1], vectorType);
    return {
        startValue: startValue,
        currentValue: { x: startValue.x, y: startValue.y }, // All vectors are passed by reference, so we need to create a copy to avoid modifying the start value
        keyframes: keyframes,
        currentKeyframeIndex: 0,
    };
}

function CalculateFinalVector(x: number, y: number, vectorType: VectorType): IVector2Like {
    const result = { x, y };

    if (vectorType === "Position") {
        // Lottie uses a different coordinate system for position, so we need to invert the Y value
        result.y = -result.y;
    } else if (vectorType === "AnchorPoint") {
        // Lottie uses a different coordinate system for anchor point, so we need to invert the X value
        result.x = -result.x;
    } else if (vectorType === "Scale") {
        // Lottie uses a different coordinate system for scale, so we need to divide by 100
        result.x = result.x / 100;
        result.y = result.y / 100;
    }

    return result;
}
