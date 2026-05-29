import { type IVector2Like } from "core/Maths/math.like";

import { type ScalarProperty, type Transform, type Vector2Property } from "./parsedTypes";
import { type RawScalarProperty, type RawTransform, type RawVectorKeyframe, type RawVectorProperty } from "./rawTypes";
import { type ParseDiagnostics } from "./diagnostics";
import { BuildScalarTrack, BuildVector2Track, type EaseHandle, type ScalarKeyframeInput, type Vector2KeyframeInput } from "./tracks";

/**
 * Reads the cubic-bezier easing handle for a given axis from a raw keyframe.
 * Returns `undefined` when the keyframe has no easing handles (a hold/step segment).
 * @param keyframe The raw keyframe.
 * @param axis The axis index to read for array-valued handles (0 = X, 1 = Y).
 * @returns The easing handle control points, or `undefined`.
 */
function ReadEaseHandle(keyframe: RawVectorKeyframe, axis: number): EaseHandle {
    const o = keyframe.o;
    const i = keyframe.i;
    if (o === undefined || i === undefined) {
        return undefined;
    }

    if (Array.isArray(o.x)) {
        return {
            x1: (o.x as number[])[axis],
            y1: (o.y as number[])[axis],
            x2: (i.x as number[])[axis],
            y2: (i.y as number[])[axis],
        };
    }

    return {
        x1: o.x as number,
        y1: o.y as number,
        x2: i.x as number,
        y2: i.y as number,
    };
}

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

    const keyframes: ScalarKeyframeInput[] = [];
    const rawKeyFrames = property.k as RawVectorKeyframe[];
    let i: number;
    for (i = 0; i < rawKeyFrames.length; i++) {
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
            ease: ReadEaseHandle(rawKeyFrames[i], 0),
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
        track: BuildScalarTrack(keyframes, context.easingSteps),
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

    const keyframes: Vector2KeyframeInput[] = [];
    const rawKeyFrames = property.k as RawVectorKeyframe[];
    let i: number;
    for (i = 0; i < rawKeyFrames.length; i++) {
        const value = CalculateFinalVector(rawKeyFrames[i].s[0], rawKeyFrames[i].s[1], vectorType);
        keyframes.push({
            time: rawKeyFrames[i].t,
            x: value.x,
            y: value.y,
            ease1: ReadEaseHandle(rawKeyFrames[i], 0),
            ease2: ReadEaseHandle(rawKeyFrames[i], 1),
        });
    }

    const startValue = CalculateFinalVector(rawKeyFrames[0].s[0], rawKeyFrames[0].s[1], vectorType);
    return {
        startValue: startValue,
        currentValue: { x: startValue.x, y: startValue.y }, // All vectors are passed by reference, so we need to create a copy to avoid modifying the start value
        track: BuildVector2Track(keyframes, context.easingSteps),
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
