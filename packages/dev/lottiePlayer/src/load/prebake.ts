import { type IVector2Like } from "core/Maths/math.like";

import { type AnimationNode, type AnimationNodeKind, CreateControlNode, CreateNode, CreateSpriteNode } from "../nodes/node";
import { type AnimationInfo, type ScalarProperty, type ScalarTrack, type Vector2Property, type Vector2Track } from "../parsing/parsedTypes";

/**
 * Serialized form of a {@link ScalarTrack}. The `Float32Array`s are stored as plain number arrays so
 * the track survives `JSON.stringify`/`JSON.parse`. A `NaN` easing handle (hold/step marker) becomes
 * `null` after a JSON round-trip; {@link DeserializeAnimationInfo} maps it back to `NaN` on rehydrate.
 */
type SerializedScalarTrack = {
    count: number;
    times: number[];
    values: number[];
    bezier: (number | null)[];
    easingSteps: number;
};

/**
 * Serialized form of a {@link Vector2Track}. See {@link SerializedScalarTrack} for the JSON/`NaN` notes.
 */
type SerializedVector2Track = {
    count: number;
    times: number[];
    valuesX: number[];
    valuesY: number[];
    bezierX: (number | null)[];
    bezierY: (number | null)[];
    easingSteps: number;
};

/**
 * Serialized form of a {@link ScalarProperty}. Only the immutable inputs are baked; the per-frame
 * mutable state (`currentValue`, `currentKeyframeIndex`) is reset to defaults on rehydrate.
 */
type SerializedScalarProperty = {
    startValue: number;
    track?: SerializedScalarTrack;
};

/**
 * Serialized form of a {@link Vector2Property}. See {@link SerializedScalarProperty}.
 */
type SerializedVector2Property = {
    startValue: IVector2Like;
    track?: SerializedVector2Track;
};

/**
 * Serialized form of a single {@link AnimationNode}. Engine-bound fields (the `ThinMatrix` instances
 * and the renderer `sprite`) and runtime-mutable playback state are intentionally omitted; they are
 * reconstructed by {@link DeserializeAnimationInfo}. The scene-graph parent is stored as an index into
 * the flat {@link PrebakedAnimationInfo.nodes} array (`null` for a root) to avoid circular references.
 */
type SerializedNode = {
    kind: AnimationNodeKind;
    id: string;
    parentNodeIndex: number | null;
    position: SerializedVector2Property;
    rotation: SerializedScalarProperty;
    scale: SerializedVector2Property;
    opacity: SerializedScalarProperty;
    // Control-kind inputs.
    inFrame?: number;
    outFrame?: number;
    isNullLayer?: boolean;
    // Sprite-kind inputs.
    originalWidth?: number;
    originalHeight?: number;
};

/**
 * Renderer-ready, JSON-serializable form of an {@link AnimationInfo}. This is the "prebaked" animation
 * artifact: the result of running the detection/parse/track-build pipeline ahead of time, reduced to
 * pure data. It deliberately bakes only the vector animation data (timing, node hierarchy, transforms,
 * and keyframe tracks) and not sprite atlas pixels or a fixed-size packed layout, so the payload stays
 * small and the worker remains free to rasterize and pack sprites for the current device.
 */
export type PrebakedAnimationInfo = {
    /** Frame number where the animation starts. */
    startFrame: number;
    /** Frame number where the animation ends. */
    endFrame: number;
    /** Frame rate of the animation. */
    frameRate: number;
    /** Width of the animation in pixels. */
    widthPx: number;
    /** Height of the animation in pixels. */
    heightPx: number;
    /** Flattened scene graph, depth-first with parents before children; parent links are stored as indices. */
    nodes: SerializedNode[];
};

function SerializeFloat32Array(array: Float32Array): number[] {
    return Array.from(array);
}

function DeserializeFloat32Array(array: ReadonlyArray<number | null>): Float32Array {
    const result = new Float32Array(array.length);
    for (let i = 0; i < array.length; i++) {
        const value = array[i];
        // A JSON round-trip turns `NaN` (the hold/step easing marker) into `null`; restore it here.
        result[i] = value === null ? NaN : value;
    }
    return result;
}

function SerializeScalarTrack(track: ScalarTrack): SerializedScalarTrack {
    return {
        count: track.count,
        times: SerializeFloat32Array(track.times),
        values: SerializeFloat32Array(track.values),
        bezier: SerializeFloat32Array(track.bezier),
        easingSteps: track.easingSteps,
    };
}

function DeserializeScalarTrack(track: SerializedScalarTrack): ScalarTrack {
    return {
        count: track.count,
        times: DeserializeFloat32Array(track.times),
        values: DeserializeFloat32Array(track.values),
        bezier: DeserializeFloat32Array(track.bezier),
        easingSteps: track.easingSteps,
    };
}

function SerializeVector2Track(track: Vector2Track): SerializedVector2Track {
    return {
        count: track.count,
        times: SerializeFloat32Array(track.times),
        valuesX: SerializeFloat32Array(track.valuesX),
        valuesY: SerializeFloat32Array(track.valuesY),
        bezierX: SerializeFloat32Array(track.bezierX),
        bezierY: SerializeFloat32Array(track.bezierY),
        easingSteps: track.easingSteps,
    };
}

function DeserializeVector2Track(track: SerializedVector2Track): Vector2Track {
    return {
        count: track.count,
        times: DeserializeFloat32Array(track.times),
        valuesX: DeserializeFloat32Array(track.valuesX),
        valuesY: DeserializeFloat32Array(track.valuesY),
        bezierX: DeserializeFloat32Array(track.bezierX),
        bezierY: DeserializeFloat32Array(track.bezierY),
        easingSteps: track.easingSteps,
    };
}

function SerializeScalarProperty(property: ScalarProperty): SerializedScalarProperty {
    const serialized: SerializedScalarProperty = { startValue: property.startValue };
    if (property.track !== undefined) {
        serialized.track = SerializeScalarTrack(property.track);
    }
    return serialized;
}

function DeserializeScalarProperty(property: SerializedScalarProperty): ScalarProperty {
    return {
        startValue: property.startValue,
        currentValue: property.startValue,
        currentKeyframeIndex: 0,
        track: property.track !== undefined ? DeserializeScalarTrack(property.track) : undefined,
    };
}

function SerializeVector2Property(property: Vector2Property): SerializedVector2Property {
    const serialized: SerializedVector2Property = { startValue: { x: property.startValue.x, y: property.startValue.y } };
    if (property.track !== undefined) {
        serialized.track = SerializeVector2Track(property.track);
    }
    return serialized;
}

function DeserializeVector2Property(property: SerializedVector2Property): Vector2Property {
    return {
        startValue: { x: property.startValue.x, y: property.startValue.y },
        currentValue: { x: property.startValue.x, y: property.startValue.y },
        currentKeyframeIndex: 0,
        track: property.track !== undefined ? DeserializeVector2Track(property.track) : undefined,
    };
}

function SerializeNode(node: AnimationNode, parentNodeIndex: number | null): SerializedNode {
    return {
        kind: node._kind,
        id: node.id,
        parentNodeIndex,
        position: SerializeVector2Property(node.position),
        rotation: SerializeScalarProperty(node.rotation),
        scale: SerializeVector2Property(node.scale),
        opacity: SerializeScalarProperty(node.opacity),
        inFrame: node.inFrame,
        outFrame: node.outFrame,
        isNullLayer: node.isNullLayer,
        originalWidth: node.originalWidth,
        originalHeight: node.originalHeight,
    };
}

function DeserializeNode(node: SerializedNode, parent: AnimationNode | undefined): AnimationNode {
    const position = DeserializeVector2Property(node.position);
    const rotation = DeserializeScalarProperty(node.rotation);
    const scale = DeserializeVector2Property(node.scale);
    const opacity = DeserializeScalarProperty(node.opacity);

    switch (node.kind) {
        case "control":
            return CreateControlNode(node.id, node.inFrame ?? 0, node.outFrame ?? 0, position, rotation, scale, opacity, parent, node.isNullLayer ?? false);
        case "sprite":
            return CreateSpriteNode(node.id, node.originalWidth ?? 0, node.originalHeight ?? 0, position, rotation, scale, opacity, parent);
        default:
            return CreateNode(node.id, position, rotation, scale, opacity, parent);
    }
}

/**
 * Serializes a parsed {@link AnimationInfo} into a compact, JSON-safe {@link PrebakedAnimationInfo}.
 *
 * The node tree is flattened depth-first so a parent always precedes its children, and each node's
 * parent link is stored as an index (or `null` for a root). Engine-bound state (`ThinMatrix`
 * instances, the renderer `sprite`) and runtime-mutable playback state are dropped; they are
 * reconstructed by {@link DeserializeAnimationInfo}.
 * @param info Parsed animation information to serialize.
 * @returns The prebaked, JSON-serializable animation artifact.
 */
export function SerializeAnimationInfo(info: AnimationInfo): PrebakedAnimationInfo {
    const nodes: SerializedNode[] = [];

    const visit = (node: AnimationNode, parentNodeIndex: number | null): void => {
        const index = nodes.length;
        nodes.push(SerializeNode(node, parentNodeIndex));
        for (let i = 0; i < node.children.length; i++) {
            visit(node.children[i], index);
        }
    };

    for (let i = 0; i < info.nodes.length; i++) {
        visit(info.nodes[i], null);
    }

    return {
        startFrame: info.startFrame,
        endFrame: info.endFrame,
        frameRate: info.frameRate,
        widthPx: info.widthPx,
        heightPx: info.heightPx,
        nodes,
    };
}

/**
 * Rehydrates a {@link PrebakedAnimationInfo} back into a renderer-ready {@link AnimationInfo}.
 *
 * Nodes are rebuilt through the same `Create*Node` factories the parser uses, so matrices are freshly
 * composed, the scene graph is re-parented, the `animatedTracks` bitmask is recomputed, and mutable
 * playback state starts from its defaults. Sprite nodes are returned with `sprite` unset; the renderer
 * adapter materializes the concrete sprite separately.
 * @param prebaked Prebaked animation artifact produced by {@link SerializeAnimationInfo}.
 * @returns The reconstructed animation information (root nodes only, children reachable via `children`).
 */
export function DeserializeAnimationInfo(prebaked: PrebakedAnimationInfo): AnimationInfo {
    const built: AnimationNode[] = new Array(prebaked.nodes.length);
    const roots: AnimationNode[] = [];

    for (let i = 0; i < prebaked.nodes.length; i++) {
        const serializedNode = prebaked.nodes[i];
        // Serialization is depth-first parent-before-child, so the parent is always already built.
        const parent = serializedNode.parentNodeIndex === null ? undefined : built[serializedNode.parentNodeIndex];
        const node = DeserializeNode(serializedNode, parent);
        built[i] = node;
        if (parent === undefined) {
            roots.push(node);
        }
    }

    return {
        startFrame: prebaked.startFrame,
        endFrame: prebaked.endFrame,
        frameRate: prebaked.frameRate,
        widthPx: prebaked.widthPx,
        heightPx: prebaked.heightPx,
        nodes: roots,
    };
}
