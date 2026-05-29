import { type LottieFeatureConfig, type LottieRendererConfig } from "../animationConfiguration";
import { type LottieFeature, type LottieFeatureId, type LottieFeatureSet } from "../features/feature";
import { GetFeatureIdForLayerType } from "../features/layerTypes";
import { CreateControlNode, type AnimationNode } from "../nodes/node";
import { ParseDiagnostics } from "./diagnostics";
import { ParseNullLayer } from "./nullLayer";
import { type AnimationInfo, type Transform } from "./parsedTypes";
import { type RawFont, type RawLottieAnimation, type RawLottieLayer, type RawShapeLayer, type RawSolidLayer, type RawTextLayer } from "./rawTypes";
import { type LottieSpriteRecord } from "./spriteRecord";
import { type SpritePacker } from "./spritePacker";
import { ParseTransform } from "./transform";

/**
 * Result of building a renderer-agnostic animation from raw Lottie data.
 */
export type BuildAnimationResult = {
    /** Parsed animation information (node graph and timing). */
    animationInfo: AnimationInfo;
    /** Renderer-agnostic sprite records emitted during the build, for later materialization. */
    spriteRecords: readonly LottieSpriteRecord[];
    /** Unsupported-feature diagnostics collected during the build, in report order. */
    diagnostics: readonly string[];
};

/**
 * Tree structure used to reorder layers into a child-parent hierarchy.
 */
type LayerTree = {
    layer: RawLottieLayer;
    children: LayerTree[];
};

/**
 * Mutable per-build state shared between the dispatcher and its layer handlers.
 */
type BuildState = {
    packer: SpritePacker;
    featureConfig: LottieFeatureConfig;
    rendererConfig: LottieRendererConfig;
    features: LottieFeatureSet | undefined;
    diagnostics: ParseDiagnostics;
    spriteRecords: LottieSpriteRecord[];
    rawFonts: Map<string, RawFont>;
    rootNodes: AnimationNode[]; // Array of root-level nodes in the animation, in top-down z order
    parentNodes: Map<number, AnimationNode>; // Map of nodes to build the scenegraph from the animation layers
    layerOriginalIndices: Map<RawLottieLayer, number>; // Maps layers to their original array index for z-ordering
    startFrame: number;
    currentLayerOriginalIndex: number; // Original array index of the layer currently being parsed, used for sprite z-ordering
    currentLayerName: string | undefined; // Name of the layer currently being parsed, used for diagnostic messages
};

function GetFeature(features: LottieFeatureSet | undefined, id: LottieFeatureId): LottieFeature | undefined {
    if (features === undefined) {
        return undefined;
    }

    for (let i = 0; i < features.features.length; i++) {
        if (features.features[i].id === id) {
            return features.features[i];
        }
    }

    return undefined;
}

/**
 * Builds a renderer-agnostic Lottie animation from raw animation data and an explicit feature set.
 * Replaces the former monolithic Parser: shared helpers (null/anchor nodes, rasterization frame/scale,
 * transforms, diagnostics) are standalone modules imported directly by both this dispatcher and the
 * layer features, so there is no callback inversion between them.
 * Important: not all lottie features are supported; inspect the returned `diagnostics` for what was skipped.
 * @param rawData The raw lottie animation as a JSON object.
 * @param packer Object that packs the sprites from the animation into a texture atlas.
 * @param featureConfig Engine-free feature configuration for the animation.
 * @param rendererConfig Renderer-bound configuration for atlas dimensions.
 * @param features Optional feature modules loaded for this animation.
 * @returns The parsed animation, emitted sprite records, and collected diagnostics.
 */
export function BuildAnimation(
    rawData: RawLottieAnimation,
    packer: SpritePacker,
    featureConfig: LottieFeatureConfig,
    rendererConfig: LottieRendererConfig,
    features?: LottieFeatureSet
): BuildAnimationResult {
    const state: BuildState = {
        packer,
        featureConfig,
        rendererConfig,
        features,
        diagnostics: new ParseDiagnostics(),
        spriteRecords: [],
        rawFonts: new Map<string, RawFont>(),
        rootNodes: [],
        parentNodes: new Map<number, AnimationNode>(),
        layerOriginalIndices: new Map<RawLottieLayer, number>(),
        startFrame: rawData.ip,
        currentLayerOriginalIndex: 0,
        currentLayerName: undefined,
    };

    ParseFonts(state, rawData);

    // Layers data may come unordered, we need to sort into child-parents but maintaining z-order before parsing
    const orderedLayers = ReorderLayers(state, rawData.layers);
    for (let i = 0; i < orderedLayers.length; i++) {
        state.currentLayerOriginalIndex = state.layerOriginalIndices.get(orderedLayers[i]) ?? i;
        state.currentLayerName = orderedLayers[i].nm;
        ParseLayer(state, orderedLayers[i]);
    }

    // Clear layer index map to allow raw JSON data to be garbage-collected
    state.layerOriginalIndices.clear();

    // Update the atlas texture after creating all sprites from the animation
    state.packer.updateAtlasTexture();

    // Drain any unsupported-feature reports from the packer before we drop the reference to it.
    const packerUnsupported = state.packer.unsupportedFeatures;
    for (let i = 0; i < packerUnsupported.length; i++) {
        state.diagnostics.push(packerUnsupported[i]);
    }

    // Release the canvas to avoid memory leaks
    state.packer.releaseCanvas();

    const animationInfo: AnimationInfo = {
        startFrame: rawData.ip,
        endFrame: rawData.op,
        frameRate: rawData.fr,
        widthPx: rawData.w,
        heightPx: rawData.h,
        nodes: state.rootNodes,
    };

    return {
        animationInfo,
        spriteRecords: state.spriteRecords,
        diagnostics: state.diagnostics.messages,
    };
}

function ParseFonts(state: BuildState, rawData: RawLottieAnimation): void {
    if (rawData.fonts && rawData.fonts.list) {
        for (const font of rawData.fonts.list) {
            state.rawFonts.set(font.fName, font);
        }
    }
}

function ReorderLayers(state: BuildState, layers: RawLottieLayer[]): RawLottieLayer[] {
    // Record the original array index of each layer before reordering, for z-order preservation
    for (let i = 0; i < layers.length; i++) {
        state.layerOriginalIndices.set(layers[i], i);
    }

    let unusedIndex = Number.MIN_SAFE_INTEGER;
    const layerTrees: LayerTree[] = [];
    let movedLayers = Number.MAX_VALUE;

    while (movedLayers > 0) {
        movedLayers = 0;

        for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];
            if (layer.ind === undefined) {
                layer.ind = unusedIndex--; // Assign an unused index to the layer if it has no index
            }

            // Layers with no parents are top-level layers, push them to the final layers
            // in the same order they are declared to preserve the z-order
            if (layer.parent === undefined) {
                layerTrees.push({
                    layer,
                    children: [],
                });

                layers.splice(i, 1);
                i--;
                movedLayers++;
            } else {
                for (let j = 0; j < layerTrees.length; j++) {
                    const parent = SearchBfs(layerTrees[j], layer.parent);
                    if (parent) {
                        parent.children.push({
                            layer,
                            children: [],
                        });

                        layers.splice(i, 1);
                        i--;
                        movedLayers++;
                        break;
                    }
                }
            }
        }
    }

    // Finally, convert the map to an array of layers
    const finalLayersArray: RawLottieLayer[] = [];
    for (let i = 0; i < layerTrees.length; i++) {
        finalLayersArray.push(...VisitDfs(layerTrees[i]));
    }

    if (layers.length > 0) {
        finalLayersArray.push(...layers); // Add any remaining layers that were not processed
    }

    return finalLayersArray;
}

function SearchBfs(tree: LayerTree, index: number): LayerTree | undefined {
    const queue: LayerTree[] = [tree];
    while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.layer.ind === index) {
            return current;
        }
        for (let i = 0; i < current.children.length; i++) {
            queue.push(current.children[i]);
        }
    }
    return undefined;
}

function VisitDfs(tree: LayerTree): RawLottieLayer[] {
    const result: RawLottieLayer[] = [];

    const visit = (node: LayerTree) => {
        result.push(node.layer);
        for (let i = 0; i < node.children.length; i++) {
            visit(node.children[i]);
        }
    };

    visit(tree);
    return result;
}

function ParseLayer(state: BuildState, layer: RawLottieLayer): void {
    if (layer.hd === true) {
        return; // Ignore hidden layers
    }

    // We only support solid, null, shape and text layers
    if ((layer.ty === 1 && state.featureConfig.compatibility.solidLayerRendering === "babylon8") || (layer.ty !== 1 && layer.ty !== 3 && layer.ty !== 4 && layer.ty !== 5)) {
        state.diagnostics.push(`UnsupportedLayerType - Layer Name: ${layer.nm} - Layer Index: ${layer.ind} - Layer Type: ${layer.ty}`);
        return;
    }

    if (layer.ip === undefined || layer.op === undefined || layer.st === undefined) {
        state.diagnostics.push(`Layer without required values - Layer Name: ${layer.nm}`);
        return;
    }

    let parentNode: AnimationNode | undefined = undefined;
    if (layer.parent !== undefined) {
        parentNode = state.parentNodes.get(layer.parent);
        if (parentNode === undefined) {
            state.diagnostics.push(`Parent node with index ${layer.parent} not found for layer ${layer.nm}`);
        }
    }

    const transform = ParseTransform(layer.ks, {
        easingSteps: state.featureConfig.easingSteps,
        layerName: state.currentLayerName,
        layerOriginalIndex: state.currentLayerOriginalIndex,
        diagnostics: state.diagnostics,
    });

    const trsNode = CreateControlNode(
        `ControlNode (TRS) - ${layer.nm}`,
        layer.ip,
        layer.op,
        transform.position,
        transform.rotation,
        transform.scale,
        transform.opacity,
        parentNode,
        layer.ty === 3 // isNullLayer
    );

    let anchorNode: AnimationNode | undefined = undefined;
    if (layer.ty === 3) {
        // Null layers are structural and owned by no feature.
        anchorNode = ParseNullLayer(layer, transform, trsNode);
    } else {
        switch (GetFeatureIdForLayerType(layer.ty)) {
            case "solid":
                anchorNode = DispatchSolidLayer(state, layer as RawSolidLayer, transform, trsNode);
                break;
            case "shape":
                anchorNode = DispatchShapeLayer(state, layer as RawShapeLayer, transform, trsNode);
                if (anchorNode === undefined) {
                    return;
                }
                break;
            case "text":
                anchorNode = DispatchTextLayer(state, layer as RawTextLayer, transform, trsNode);
                if (anchorNode === undefined) {
                    return;
                }
                break;
        }
    }

    // If no parent, this is a top level node, add it to the root nodes for rendering
    if (layer.parent === undefined) {
        state.rootNodes.push(trsNode);
    }

    if (anchorNode === undefined) {
        state.diagnostics.push(`Layer ${layer.nm} did not generate an anchor node, this is unexpected and should be investigated.`);
    }

    if (layer.ind !== undefined && anchorNode) {
        state.parentNodes.set(layer.ind, anchorNode);
    }
}

function DispatchSolidLayer(state: BuildState, layer: RawSolidLayer, transform: Transform, parent: AnimationNode): AnimationNode {
    const feature = GetFeature(state.features, "solid")?.solidLayer;
    if (feature === undefined) {
        state.diagnostics.pushOnce("Solid layer feature was not loaded; skipping solid layers.");
        return ParseNullLayer(layer, transform, parent);
    }

    return feature.parseSolidLayer({
        layer,
        transform,
        parent,
        packer: state.packer,
        rendererConfiguration: state.rendererConfig,
        emitSpriteRecord: (record) => state.spriteRecords.push(record),
        currentLayerOriginalIndex: state.currentLayerOriginalIndex,
        diagnostics: state.diagnostics,
    });
}

function DispatchShapeLayer(state: BuildState, layer: RawShapeLayer, transform: Transform, parent: AnimationNode): AnimationNode | undefined {
    const feature = GetFeature(state.features, "shape")?.shapeLayer;
    if (feature === undefined) {
        state.diagnostics.pushOnce("Shape layer feature was not loaded; skipping shape layers.");
        return undefined;
    }

    return feature.parseShapeLayer({
        layer,
        transform,
        parent,
        packer: state.packer,
        emitSpriteRecord: (record) => state.spriteRecords.push(record),
        currentLayerOriginalIndex: state.currentLayerOriginalIndex,
        currentLayerName: state.currentLayerName,
        startFrame: state.startFrame,
        easingSteps: state.featureConfig.easingSteps,
        diagnostics: state.diagnostics,
    });
}

function DispatchTextLayer(state: BuildState, layer: RawTextLayer, transform: Transform, parent: AnimationNode): AnimationNode | undefined {
    const feature = GetFeature(state.features, "text")?.textLayer;
    if (feature === undefined) {
        state.diagnostics.pushOnce("Text layer feature was not loaded; skipping text layers.");
        return undefined;
    }

    return feature.parseTextLayer({
        layer,
        transform,
        parent,
        packer: state.packer,
        rawFonts: state.rawFonts,
        featureConfiguration: state.featureConfig,
        emitSpriteRecord: (record) => state.spriteRecords.push(record),
        currentLayerOriginalIndex: state.currentLayerOriginalIndex,
        startFrame: state.startFrame,
    });
}
