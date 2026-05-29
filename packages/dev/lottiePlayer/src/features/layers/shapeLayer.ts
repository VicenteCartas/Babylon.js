import { type IVector2Like } from "core/Maths/math.like";

import { GetShapesBoundingBox } from "../../maths/boundingBox";
import { Node } from "../../nodes/node";
import { SpriteNode } from "../../nodes/spriteNode";
import { type ParseDiagnostics } from "../../parsing/diagnostics";
import { ParseNullLayer } from "../../parsing/nullLayer";
import { type Transform, type Vector2Property } from "../../parsing/parsedTypes";
import { GetRasterizationFrame, GetRasterizationScale } from "../../parsing/rasterization";
import { type RawElement, type RawShapeLayer, type RawTransformShape } from "../../parsing/rawTypes";
import { type LottieSpriteRecord } from "../../parsing/spriteRecord";
import { type SpriteAtlasInfo, type SpritePacker } from "../../parsing/spritePacker";
import { ParseTransform } from "../../parsing/transform";
import { DrawVectorShape } from "../shapes/drawShape";

/**
 * Parser dependencies needed by the shape layer feature.
 */
export type LottieShapeLayerParseContext = {
    /** Raw shape layer to parse. */
    layer: RawShapeLayer;
    /** Already parsed layer transform. */
    transform: Transform;
    /** Parent node in the animation tree. */
    parent: Node;
    /** Sprite atlas packer used by this animation. */
    packer: SpritePacker;
    /** Emits a renderer-agnostic sprite record for later materialization. */
    emitSpriteRecord(record: LottieSpriteRecord): void;
    /** Original Lottie layer index used for render ordering. */
    currentLayerOriginalIndex: number;
    /** Name of the layer currently being parsed, used in atlas oversize warnings. */
    currentLayerName: string | undefined;
    /** Animation start frame, used to choose the rasterization scale for this layer. */
    startFrame: number;
    /** Number of subdivision steps used when sampling group transform easing curves. */
    easingSteps: number;
    /** Collector for unsupported-feature diagnostics. */
    diagnostics: ParseDiagnostics;
};

/**
 * Shape layer feature behavior loaded only for animations that contain shape layers.
 */
export type LottieShapeLayerFeature = {
    /** Parses and rasterizes a Lottie shape layer. */
    parseShapeLayer(context: LottieShapeLayerParseContext): Node;
};

/**
 * Shape layer feature implementation.
 */
export const ShapeLayerFeature: LottieShapeLayerFeature = {
    parseShapeLayer: ParseShapeLayer,
};

function ParseShapeLayer(context: LottieShapeLayerParseContext): Node {
    const anchorNode = ParseNullLayer(context.layer, context.transform, context.parent);
    const rasterizationFrame = GetRasterizationFrame(context.layer, context.startFrame);
    ParseElements(context, context.layer.shapes, anchorNode, rasterizationFrame);

    return anchorNode;
}

function ParseElements(context: LottieShapeLayerParseContext, elements: RawElement[] | undefined, parent: Node, rasterizationFrame: number): void {
    if (elements === undefined || elements.length <= 0) {
        return;
    }

    // Lottie/After Effects shape stack: a fill/stroke (or gradient fill/stroke) at a given level
    // applies to every sibling shape/group above it. When a layer (or a group) mixes child groups
    // with sibling decorators, those decorators have to flow into each child group so each group's
    // sprite is rasterized with them. Without this, e.g. `[gr, gr, fl]` would render only the
    // groups that already carry their own fill — the others would rasterize as empty sprites
    let hasGroup = false;
    let levelDecorators: RawElement[] | undefined;
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (el.hd === true || el.ty === "tr") {
            continue;
        }
        if (el.ty === "gr") {
            hasGroup = true;
        } else if (el.ty === "fl" || el.ty === "st" || el.ty === "gf" || el.ty === "gs") {
            (levelDecorators ??= []).push(el);
        }
    }
    const propagateDecorators = hasGroup && levelDecorators !== undefined && levelDecorators.length > 0;

    for (let i = 0; i < elements.length; i++) {
        if (elements[i].hd === true) {
            continue; // Ignore hidden shapes
        }

        if (elements[i].ty === "tr") {
            continue; // Transforms are parsed as part of other elements, so we can ignore it
        }

        if (elements[i].ty === "gr") {
            ParseGroup(context, elements[i], parent, rasterizationFrame, propagateDecorators ? levelDecorators : undefined);
            //break;
        } else if (elements[i].ty === "sh" || elements[i].ty === "rc" || elements[i].ty === "el") {
            ParseShapes(context, elements, parent, rasterizationFrame);
            break; // After parsing the shapes, this array of elements is done
        } else if (propagateDecorators && (elements[i].ty === "fl" || elements[i].ty === "st" || elements[i].ty === "gf" || elements[i].ty === "gs")) {
            // Already absorbed into the preceding sibling groups via `ParseGroup` above.
            continue;
        } else {
            context.diagnostics.push(`Only groups or shapes are supported as children of layers - Name: ${elements[i].nm} Type: ${elements[i].ty}`);
            continue;
        }
    }
}

function ParseGroup(context: LottieShapeLayerParseContext, group: RawElement, parent: Node, rasterizationFrame: number, inheritedDecorators?: RawElement[]): void {
    if (group.it === undefined || group.it.length === 0) {
        context.diagnostics.push(`Unexpected empty group: ${group.nm}`);
        return;
    }

    const transform: Transform | undefined = GetShapeTransform(context, group.it);
    if (transform === undefined) {
        context.diagnostics.push(`Group ${group.nm} does not have a transform which is not supported`);
        return;
    }

    // Splice any inherited decorators (parent-level fills/strokes) just before the group's
    // transform so the rasterizer sees them in the same relative position they had at the
    // parent level — i.e. below the group's own contents in z-order. Lottie's terminal-`tr`
    // contract (relied on by `GetShapeTransform` and `DrawVectorShape`) is preserved.
    let items = group.it;
    if (inheritedDecorators && inheritedDecorators.length > 0) {
        items = group.it.slice(0, -1).concat(inheritedDecorators, group.it[group.it.length - 1]);
    }

    // Create the nodes on the scenegraph for this group
    const trsNode = new Node(`Node (TRS)- ${group.nm}`, transform.position, transform.rotation, transform.scale, transform.opacity, parent);

    const anchorNode = new Node(
        `Node (Anchor) - ${group.nm}`,
        transform.anchorPoint,
        undefined, // Rotation is not used for anchor point
        undefined, // Scale is not used for anchor point
        undefined, // Opacity is not used for anchor point
        trsNode
    );

    // Parse the children of the group
    ParseElements(context, items, anchorNode, rasterizationFrame);
}

function ParseShapes(context: LottieShapeLayerParseContext, elements: RawElement[], parent: Node, rasterizationFrame: number): void {
    // Get the rasterization scale at the frame when the layer first becomes visible
    const currentScale = GetRasterizationScale(parent, rasterizationFrame);
    const spriteInfo = AddLottieShapeToAtlas(context, elements, currentScale);

    const positionProperty: Vector2Property = {
        startValue: { x: spriteInfo.centerX || 0, y: -spriteInfo.centerY || 0 },
        currentValue: { x: spriteInfo.centerX || 0, y: -spriteInfo.centerY || 0 },
        currentKeyframeIndex: 0,
    };

    const spriteNode = new SpriteNode(
        "Sprite",
        spriteInfo.widthPx,
        spriteInfo.heightPx,
        positionProperty,
        undefined, // Rotation is not used for sprites final transform
        undefined, // Scale is not used for sprites final transform
        undefined, // Opacity is not used for sprites final transform
        parent
    );

    context.emitSpriteRecord({
        node: spriteNode,
        atlasIndex: spriteInfo.atlasIndex,
        uOffset: spriteInfo.uOffset,
        vOffset: spriteInfo.vOffset,
        uSize: spriteInfo.cellWidth,
        vSize: spriteInfo.cellHeight,
        width: spriteInfo.widthPx,
        height: spriteInfo.heightPx,
        invertV: true,
        layerOrder: context.currentLayerOriginalIndex,
    });
}

/**
 * Allocates an atlas cell for a vector shape and rasterizes it via the shape feature's Canvas2D drawer.
 * @param context Shape layer parse context.
 * @param rawElements The raw elements (paths, shapes, fills, strokes) to rasterize.
 * @param scalingFactor The scaling factor to apply. Mutated by the packer with the effective atlas scale.
 * @returns The information on how to find the sprite in the atlas.
 */
function AddLottieShapeToAtlas(context: LottieShapeLayerParseContext, rawElements: RawElement[], scalingFactor: IVector2Like): SpriteAtlasInfo {
    const boundingBox = GetShapesBoundingBox(rawElements);

    return context.packer.addRasterizedSprite(
        "shape",
        boundingBox,
        scalingFactor,
        (rasterizationContext) =>
            DrawVectorShape(rawElements, boundingBox, scalingFactor, rasterizationContext, (ty) => context.diagnostics.pushOnce(`Unsupported shape type in vector shape: ${ty}`)),
        context.currentLayerName
    );
}

function GetShapeTransform(context: LottieShapeLayerParseContext, elements: RawElement[] | undefined): Transform | undefined {
    if (!elements || elements.length === 0) {
        return undefined;
    }

    // Lottie format mandates the transform is the last item on a list of elements
    if (elements[elements.length - 1].ty !== "tr") {
        return undefined;
    }

    return ParseTransform(elements[elements.length - 1] as RawTransformShape, {
        easingSteps: context.easingSteps,
        layerName: context.currentLayerName,
        layerOriginalIndex: context.currentLayerOriginalIndex,
        diagnostics: context.diagnostics,
    });
}
