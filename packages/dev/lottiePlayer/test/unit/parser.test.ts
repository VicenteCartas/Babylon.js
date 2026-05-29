import { describe, it, expect, vi } from "vitest";

import { BuildAnimation, type BuildAnimationResult } from "../../src/parsing/buildAnimation";
import { type SpritePacker, type SpriteAtlasInfo, type SpritePackerRasterizationContext } from "../../src/parsing/spritePacker";
import { CreateSpriteNode, type AnimationNode } from "../../src/nodes/node";
import { ParseNullLayer } from "../../src/parsing/nullLayer";
import { type RawLottieAnimation, type RawShapeLayer, type RawTextJustify, type RawTextLayer, type RawTransform } from "../../src/parsing/rawTypes";
import { type AnimationConfiguration, type ResolvedAnimationConfiguration, UpdateConfiguration } from "../../src/animationConfiguration";
import { type LottieFeatureSet } from "../../src/features/feature";
import { SolidLayerFeature } from "../../src/features/layers/solidLayer";
import { ShapeLayerFeature } from "../../src/features/layers/shapeLayer";
import { type LottieTextLayerFeature } from "../../src/features/layers/textLayer";

/**
 * Thin wrapper over a {@link BuildAnimationResult} mirroring the surface the tests previously used on the
 * retired Parser class (animation info, sprite records, and a console-logging debug method).
 */
type ParserLike = {
    animationInfo: BuildAnimationResult["animationInfo"];
    spriteRecords: BuildAnimationResult["spriteRecords"];
    debug(): void;
};

const BaseSpriteInfo: SpriteAtlasInfo = {
    uOffset: 0,
    vOffset: 0,
    cellWidth: 16,
    cellHeight: 16,
    widthPx: 16,
    heightPx: 16,
    centerX: 8,
    centerY: 8,
    atlasIndex: 0,
};

const MockTextLayerFeature: LottieTextLayerFeature = {
    parseTextLayer: (context) => {
        const spriteInfo = BaseSpriteInfo;
        const useBabylon8TextPlacement = context.featureConfiguration.compatibility.textLayerPlacement === "babylon8";
        const spriteParent = useBabylon8TextPlacement ? context.parent : ParseNullLayer(context.layer, context.transform, context.parent);

        const babylon8X = context.layer.t.d.k[0].s.j === 0 ? spriteInfo.widthPx / 2 : context.layer.t.d.k[0].s.j === 1 ? -spriteInfo.widthPx / 2 : 0;
        const babylon8Y = spriteInfo.heightPx / 2;
        const position = useBabylon8TextPlacement
            ? {
                  startValue: { x: context.transform.anchorPoint.startValue.x + babylon8X, y: context.transform.anchorPoint.startValue.y + babylon8Y },
                  currentValue: { x: context.transform.anchorPoint.currentValue.x + babylon8X, y: context.transform.anchorPoint.currentValue.y + babylon8Y },
                  currentKeyframeIndex: 0,
              }
            : {
                  startValue: { x: spriteInfo.centerX || 0, y: -spriteInfo.centerY || 0 },
                  currentValue: { x: spriteInfo.centerX || 0, y: -spriteInfo.centerY || 0 },
                  currentKeyframeIndex: 0,
              };

        const spriteNode = CreateSpriteNode("Sprite", spriteInfo.widthPx, spriteInfo.heightPx, position, undefined, undefined, undefined, spriteParent);

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

        return useBabylon8TextPlacement ? spriteNode : spriteParent;
    },
};

const MockFeatureSet: LottieFeatureSet = {
    ids: ["solid", "shape", "text"],
    features: [
        { id: "solid", layerTypes: [1], solidLayer: SolidLayerFeature },
        { id: "shape", layerTypes: [4], shapeLayer: ShapeLayerFeature },
        { id: "text", layerTypes: [5], textLayer: MockTextLayerFeature },
    ],
};

// Minimal valid transform with a configurable anchor point.
function makeTransform(anchorPoint: number[] = [0, 0]): RawTransform {
    return { a: { a: 0, k: anchorPoint, l: 2 } };
}

// Minimal valid rectangle shape. The shape feature computes its own bounding box, so rectangle shapes
// used in shape-layer fixtures must carry size/position/radius properties (not just a name/type).
function makeRectShape(): any {
    return { ty: "rc", nm: "rect", s: { a: 0, k: [10, 10] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 } };
}

// Minimal valid text data. Content does not matter because the SpritePacker is mocked,
// but the type requires these fields.
function makeTextData(justification: RawTextJustify = 0): RawTextLayer["t"] {
    return {
        a: [],
        d: {
            k: [
                {
                    t: 0,
                    s: {
                        f: "Arial",
                        s: 16,
                        lh: 16,
                        t: "Text",
                        ca: 0,
                        j: justification,
                        ls: 0,
                    },
                },
            ],
        },
        m: { a: { a: 0, k: [0, 0], l: 2 }, g: 1 },
    };
}

// Builds a SpritePacker mock that returns deterministic SpriteAtlasInfo for both
// shape and text additions.
function makeMockPacker(): SpritePacker {
    const mock = {
        addRasterizedSprite: () => BaseSpriteInfo,
        addLottieText: () => BaseSpriteInfo,
        updateAtlasTexture: () => {},
        releaseCanvas: () => {},
        get textures() {
            return [];
        },
        get unsupportedFeatures() {
            return [];
        },
        set rawFonts(_: unknown) {},
    };

    return mock as unknown as SpritePacker;
}

function makeConfiguration(configuration: Partial<AnimationConfiguration> = {}): ResolvedAnimationConfiguration {
    return UpdateConfiguration(configuration, 4096, 1);
}

function makeParser(
    packer: SpritePacker,
    animation: RawLottieAnimation,
    configuration: ResolvedAnimationConfiguration = makeConfiguration(),
    features: LottieFeatureSet | undefined = MockFeatureSet
): ParserLike {
    const result = BuildAnimation(animation, packer, configuration, configuration, features);
    return {
        animationInfo: result.animationInfo,
        spriteRecords: result.spriteRecords,
        debug: () => {
            for (const message of result.diagnostics) {
                // eslint-disable-next-line no-console
                console.log(message);
            }
        },
    };
}

// Recursively finds the first descendant node whose id starts with the given prefix.
function findDescendantByIdPrefix(root: AnimationNode, prefix: string): AnimationNode | undefined {
    if (root.id.startsWith(prefix)) {
        return root;
    }
    for (const child of root.children) {
        const found = findDescendantByIdPrefix(child, prefix);
        if (found) {
            return found;
        }
    }
    return undefined;
}

describe("Parser scene graph structure", () => {
    it("parses a text layer into ControlNode (TRS) -> Node (Anchor) -> SpriteNode", () => {
        const animation: RawLottieAnimation = {
            v: "5.0.0",
            fr: 30,
            ip: 0,
            op: 60,
            w: 100,
            h: 100,
            layers: [
                {
                    ty: 5,
                    ind: 1,
                    nm: "Text",
                    ip: 0,
                    op: 60,
                    st: 0,
                    ks: makeTransform(),
                    t: makeTextData(),
                } as RawTextLayer,
            ],
        };

        const parser = makeParser(makeMockPacker(), animation);
        const roots = parser.animationInfo.nodes;

        expect(roots).toHaveLength(1);
        const trs = roots[0];
        expect(trs._kind).toBe("control");
        expect(trs.id).toBe("ControlNode (TRS) - Text");

        expect(trs.children).toHaveLength(1);
        const anchor = trs.children[0];
        // The anchor node is a plain node, not a control node and not a sprite node.
        expect(anchor._kind).toBe("node");
        expect(anchor.id).toBe("Node (Anchor) - Text");

        expect(anchor.children).toHaveLength(1);
        const sprite = anchor.children[0];
        expect(sprite._kind).toBe("sprite");
        expect(sprite.position.startValue).toEqual({ x: 8, y: -8 });
    });

    it("can parse text layers with Babylon 8 text placement compatibility", () => {
        const animation: RawLottieAnimation = {
            v: "5.0.0",
            fr: 30,
            ip: 0,
            op: 60,
            w: 100,
            h: 100,
            layers: [
                {
                    ty: 5,
                    ind: 1,
                    nm: "Text",
                    ip: 0,
                    op: 60,
                    st: 0,
                    ks: makeTransform([3, 5]),
                    t: makeTextData(1),
                } as RawTextLayer,
            ],
        };

        const parser = makeParser(makeMockPacker(), animation, makeConfiguration({ compatibility: { textLayerPlacement: "babylon8" } }));
        const roots = parser.animationInfo.nodes;

        expect(roots).toHaveLength(1);
        const trs = roots[0];
        expect(trs._kind).toBe("control");
        expect(trs.children).toHaveLength(1);

        const sprite = trs.children[0];
        expect(sprite._kind).toBe("sprite");
        expect(sprite.position.startValue).toEqual({ x: -11, y: 13 });
    });

    it("parents a child shape layer under the text layer's anchor Node, not its SpriteNode", () => {
        // Regression test for the structural change that made text layers expose the
        // anchor Node as their parent handle (matching the convention used by shape layers).
        // Children parented to a text layer must follow the layer's anchor point — not the
        // rendered sprite — so their transform composes with the layer transform the same
        // way they would when parented to a shape layer.
        const animation: RawLottieAnimation = {
            v: "5.0.0",
            fr: 30,
            ip: 0,
            op: 60,
            w: 100,
            h: 100,
            layers: [
                {
                    ty: 5,
                    ind: 1,
                    nm: "TextParent",
                    ip: 0,
                    op: 60,
                    st: 0,
                    ks: makeTransform(),
                    t: makeTextData(),
                } as RawTextLayer,
                {
                    ty: 4,
                    ind: 2,
                    nm: "ShapeChild",
                    parent: 1,
                    ip: 0,
                    op: 60,
                    st: 0,
                    ks: makeTransform(),
                    shapes: [makeRectShape()],
                } as RawShapeLayer,
            ],
        };

        const parser = makeParser(makeMockPacker(), animation);
        const roots = parser.animationInfo.nodes;

        // Only the text layer is a root; the shape layer is parented under it.
        expect(roots).toHaveLength(1);
        const textTrs = roots[0];
        expect(textTrs.id).toBe("ControlNode (TRS) - TextParent");

        const textAnchor = findDescendantByIdPrefix(textTrs, "Node (Anchor) - TextParent");
        expect(textAnchor).toBeDefined();

        const shapeTrs = findDescendantByIdPrefix(textTrs, "ControlNode (TRS) - ShapeChild");
        expect(shapeTrs).toBeDefined();

        // The child shape's ControlNode must be parented to the text layer's anchor Node,
        // NOT to the SpriteNode that renders the text glyphs.
        expect(shapeTrs!.parent).toBe(textAnchor);
        expect(shapeTrs!.parent!._kind).not.toBe("sprite");
    });

    it("parents a child shape layer under a parent shape layer's anchor Node (parity baseline)", () => {
        // Baseline: shape-layer-parented-to-shape-layer must produce the same parenting
        // structure as shape-layer-parented-to-text-layer. This guards against accidental
        // divergence between the two layer types.
        const animation: RawLottieAnimation = {
            v: "5.0.0",
            fr: 30,
            ip: 0,
            op: 60,
            w: 100,
            h: 100,
            layers: [
                {
                    ty: 4,
                    ind: 1,
                    nm: "ShapeParent",
                    ip: 0,
                    op: 60,
                    st: 0,
                    ks: makeTransform(),
                    shapes: [makeRectShape()],
                } as RawShapeLayer,
                {
                    ty: 4,
                    ind: 2,
                    nm: "ShapeChild",
                    parent: 1,
                    ip: 0,
                    op: 60,
                    st: 0,
                    ks: makeTransform(),
                    shapes: [makeRectShape()],
                } as RawShapeLayer,
            ],
        };

        const parser = makeParser(makeMockPacker(), animation);
        const roots = parser.animationInfo.nodes;

        const parentAnchor = findDescendantByIdPrefix(roots[0], "Node (Anchor) - ShapeParent");
        const childTrs = findDescendantByIdPrefix(roots[0], "ControlNode (TRS) - ShapeChild");

        expect(parentAnchor).toBeDefined();
        expect(childTrs).toBeDefined();
        expect(childTrs!.parent).toBe(parentAnchor);
    });
});

describe("Parser vector property validation (I-05)", () => {
    // Builds a minimal shape-layer animation whose layer transform sets `position` to the
    // given raw-vector property. We use this to drive the `_fromLottieVector2ToBabylonVector2`
    // path that I-05 tightens up.
    function makeAnimationWithLayerPosition(positionProperty: object): RawLottieAnimation {
        return {
            v: "5.0.0",
            fr: 30,
            ip: 0,
            op: 60,
            w: 100,
            h: 100,
            layers: [
                {
                    ty: 4,
                    ind: 1,
                    nm: "L",
                    ip: 0,
                    op: 60,
                    st: 0,
                    ks: { p: positionProperty } as unknown as RawTransform,
                    shapes: [makeRectShape()],
                } as RawShapeLayer,
            ],
        };
    }

    function captureDebugMessages(parser: ParserLike): string[] {
        const messages: string[] = [];
        const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
            messages.push(args.map((a) => String(a)).join(" "));
        });
        try {
            parser.debug();
        } finally {
            spy.mockRestore();
        }
        return messages;
    }

    it("logs a warning when 'l' is missing on a 3-component static vector value", () => {
        // Real-world exporters (e.g. After Effects on 2D layers) often emit `[x, y, 0]`
        // triples and omit `l`. Parser must continue to use indices 0/1 (so this animation
        // still parses) but surface a warning so we don't silently regress on unexpected
        // component counts.
        const animation = makeAnimationWithLayerPosition({ a: 0, k: [10, 20, 0] });
        const parser = makeParser(makeMockPacker(), animation);

        // Animation must still parse successfully (layer transform applied from x/y).
        expect(parser.animationInfo.nodes).toHaveLength(1);

        const messages = captureDebugMessages(parser);
        expect(messages.some((m) => m.includes("Vector2 missing 'l' with 3-component value"))).toBe(true);
        expect(messages.some((m) => m.includes("Layer: L"))).toBe(true);
    });

    it("logs a warning when 'l' is missing on a 3-component animated vector value", () => {
        const ease = { x: [0, 0], y: [1, 1] };
        const animation = makeAnimationWithLayerPosition({
            a: 1,
            k: [
                { t: 0, s: [0, 0, 0], i: ease, o: ease },
                { t: 30, s: [10, 20, 0], i: ease, o: ease },
            ],
        });
        const parser = makeParser(makeMockPacker(), animation);
        const messages = captureDebugMessages(parser);
        expect(messages.some((m) => m.includes("Vector2 missing 'l' with 3-component value"))).toBe(true);
    });

    it("does not log when 'l' is missing on a 2-component value", () => {
        const animation = makeAnimationWithLayerPosition({ a: 0, k: [10, 20] });
        const parser = makeParser(makeMockPacker(), animation);
        const messages = captureDebugMessages(parser);
        expect(messages.some((m) => m.includes("Vector2 missing 'l'"))).toBe(false);
    });

    it("does not log when 'l' is explicitly 2", () => {
        const animation = makeAnimationWithLayerPosition({ a: 0, k: [10, 20], l: 2 });
        const parser = makeParser(makeMockPacker(), animation);
        const messages = captureDebugMessages(parser);
        expect(messages.some((m) => m.includes("Vector2 missing 'l'"))).toBe(false);
    });

    it("dedupes the missing-'l' warning across many properties of the same shape", () => {
        // Three properties on the same layer (anchor, position, scale) all triggered
        // by the same omission pattern would otherwise spam the log three times.
        const animation: RawLottieAnimation = {
            v: "5.0.0",
            fr: 30,
            ip: 0,
            op: 60,
            w: 100,
            h: 100,
            layers: [
                {
                    ty: 4,
                    ind: 1,
                    nm: "L",
                    ip: 0,
                    op: 60,
                    st: 0,
                    ks: {
                        a: { a: 0, k: [0, 0, 0] },
                        p: { a: 0, k: [10, 20, 0] },
                        s: { a: 0, k: [100, 100, 100] },
                    } as unknown as RawTransform,
                    shapes: [makeRectShape()],
                } as RawShapeLayer,
            ],
        };
        const parser = makeParser(makeMockPacker(), animation);
        const messages = captureDebugMessages(parser);
        // Each (layer, vectorType) pair gets its own message — but each message only once.
        const matches = messages.filter((m) => m.includes("Vector2 missing 'l' with 3-component value"));
        // AnchorPoint, Position, Scale all distinct VectorType values → 3 unique messages.
        expect(matches).toHaveLength(3);
    });
});

describe("Parser per-axis easing on Vector2 keyframes (I-06)", () => {
    // When a vector keyframe carries per-axis tangent arrays (`o.x`/`o.y`/`i.x`/`i.y` are
    // arrays), index `[0]` belongs to the X axis and `[1]` to the Y axis. The runtime
    // interpolation applies the X-axis easing (stored in `track.bezierX`) to X and the
    // Y-axis easing (stored in `track.bezierY`) to Y, so the parser must split the array
    // entries the same way. This test pins down the X/Y component split with an asymmetric
    // fixture (different curve per axis) so a future swap of `[0]`/`[1]` would be caught immediately.
    it("splits asymmetric per-axis tangent arrays so bezierX=X (index 0) and bezierY=Y (index 1)", () => {
        const animation: RawLottieAnimation = {
            v: "5.0.0",
            fr: 30,
            ip: 0,
            op: 60,
            w: 100,
            h: 100,
            layers: [
                {
                    ty: 4,
                    ind: 1,
                    nm: "L",
                    ip: 0,
                    op: 60,
                    st: 0,
                    ks: {
                        p: {
                            a: 1,
                            l: 2,
                            k: [
                                {
                                    t: 0,
                                    s: [0, 0],
                                    // Asymmetric per-axis tangents: X uses (0.1,0.2)→(0.3,0.4),
                                    // Y uses (0.5,0.6)→(0.7,0.8). All four numbers in each
                                    // array differ across axes so swapping [0]/[1] anywhere
                                    // would alter at least one BezierCurve coordinate.
                                    o: { x: [0.1, 0.5], y: [0.2, 0.6] },
                                    i: { x: [0.3, 0.7], y: [0.4, 0.8] },
                                },
                                { t: 30, s: [10, 20] },
                            ],
                        },
                    } as unknown as RawTransform,
                    shapes: [makeRectShape()],
                } as RawShapeLayer,
            ],
        };

        const parser = makeParser(makeMockPacker(), animation);

        // Reach into the parsed control node to inspect the Vector2Property track.
        const controlNode = parser.animationInfo.nodes[0];
        const track = controlNode.position.track;
        expect(track).toBeDefined();
        expect(track!.count).toBeGreaterThan(0);

        // The easing of the segment starting at keyframe 0 is stored at bezier[0..3] for each axis.
        // X-axis curve must be built from index [0] of every per-axis array.
        // Values are stored in Float32Array, so compare with single-precision tolerance.
        expect(track!.bezierX[0]).toBeCloseTo(0.1, 6);
        expect(track!.bezierX[1]).toBeCloseTo(0.2, 6);
        expect(track!.bezierX[2]).toBeCloseTo(0.3, 6);
        expect(track!.bezierX[3]).toBeCloseTo(0.4, 6);

        // Y-axis curve must be built from index [1] of every per-axis array.
        expect(track!.bezierY[0]).toBeCloseTo(0.5, 6);
        expect(track!.bezierY[1]).toBeCloseTo(0.6, 6);
        expect(track!.bezierY[2]).toBeCloseTo(0.7, 6);
        expect(track!.bezierY[3]).toBeCloseTo(0.8, 6);
    });
});

describe("Parser layer-level shape decorators", () => {
    // Records the fill/stroke styles that each rasterized sprite paints into its atlas cell. The shape
    // feature no longer hands raw elements to the packer (it rasterizes them itself), so decorator
    // propagation is asserted behaviorally: a propagated fill/stroke shows up as an extra paint with the
    // expected CSS color in the corresponding sprite's draw callback.
    type ShapeRasterCall = {
        fillStyles: unknown[];
        strokeStyles: unknown[];
    };

    function makeShapeRasterizationContext(call: ShapeRasterCall): SpritePackerRasterizationContext {
        const context: any = {
            fillStyle: "",
            strokeStyle: "",
            lineWidth: 1,
            lineCap: "butt",
            lineJoin: "miter",
            miterLimit: 10,
            globalCompositeOperation: "source-over",
            save: () => {},
            restore: () => {},
            translate: () => {},
            scale: () => {},
            beginPath: () => {},
            rect: () => {},
            roundRect: () => {},
            clip: () => {},
            moveTo: () => {},
            lineTo: () => {},
            ellipse: () => {},
            bezierCurveTo: () => {},
            closePath: () => {},
            setLineDash: () => {},
            createLinearGradient: () => ({ addColorStop: () => {} }),
            createRadialGradient: () => ({ addColorStop: () => {} }),
            fill: () => {
                call.fillStyles.push(context.fillStyle);
            },
            stroke: () => {
                call.strokeStyles.push(context.strokeStyle);
            },
        };

        return { context, x: 3, y: 5, cellWidth: 16, cellHeight: 16 };
    }

    function makeRecordingPacker(): { packer: SpritePacker; calls: ShapeRasterCall[] } {
        const calls: ShapeRasterCall[] = [];
        const baseInfo: SpriteAtlasInfo = {
            uOffset: 0,
            vOffset: 0,
            cellWidth: 16,
            cellHeight: 16,
            widthPx: 16,
            heightPx: 16,
            centerX: 8,
            centerY: 8,
            atlasIndex: 0,
        };

        const mock = {
            addRasterizedSprite: (
                _kind: string,
                _boundingBox: unknown,
                _scalingFactor: { x: number; y: number },
                drawSprite: (context: SpritePackerRasterizationContext) => void
            ) => {
                const call: ShapeRasterCall = { fillStyles: [], strokeStyles: [] };
                drawSprite(makeShapeRasterizationContext(call));
                calls.push(call);
                return baseInfo;
            },
            addLottieText: () => baseInfo,
            updateAtlasTexture: () => {},
            releaseCanvas: () => {},
            get textures() {
                return [];
            },
            get unsupportedFeatures() {
                return [];
            },
            set rawFonts(_: unknown) {},
        };

        return { packer: mock as unknown as SpritePacker, calls };
    }

    // Mirrors the real-world structure that surfaced this bug (Lottie EDU_V2_07 "Search" layer):
    // two sibling groups followed by a layer-level fill that should color both. Group 1 has its
    // own fill (white inner circle); Group 2 has no fill of its own (the dark gray magnifying-glass
    // body and handle); the layer-level dark-gray Fill 1 is supposed to fill Group 2 (and would also
    // be drawn behind Group 1's white circle, where it is invisible).
    it("propagates a layer-level fill to every sibling group's rasterized shape", () => {
        // Non-empty path so `_drawPath` issues a real subpath that the following fills paint.
        const circlePath = { i: [[0, 0]], o: [[0, 0]], v: [[0, 0]], c: true };
        const innerCirclePath = { ind: 0, ty: "sh", nm: "Path 1", ks: { a: 0, k: circlePath } };
        const lensPath = { ind: 0, ty: "sh", nm: "Path 2", ks: { a: 0, k: circlePath } };
        const whiteFill = { ty: "fl", nm: "Fill 1 (white)", c: { a: 0, k: [1, 1, 1, 1] }, o: { a: 0, k: 100 } };
        const grayLayerFill = { ty: "fl", nm: "Fill 1 (gray)", c: { a: 0, k: [0.25, 0.25, 0.25, 1] }, o: { a: 0, k: 100 } };
        const groupTransform = { ty: "tr", nm: "Transform" };

        const animation: RawLottieAnimation = {
            v: "5.0.0",
            fr: 30,
            ip: 0,
            op: 60,
            w: 100,
            h: 100,
            layers: [
                {
                    ty: 4,
                    ind: 1,
                    nm: "Search",
                    ip: 0,
                    op: 60,
                    st: 0,
                    ks: makeTransform(),
                    shapes: [
                        { ty: "gr", nm: "Group 1", it: [innerCirclePath, whiteFill, groupTransform] },
                        { ty: "gr", nm: "Group 2", it: [lensPath, groupTransform] },
                        grayLayerFill,
                    ] as any,
                } as RawShapeLayer,
            ],
        };

        const { packer, calls } = makeRecordingPacker();
        makeParser(packer, animation);

        // Both groups must produce a sprite call.
        expect(calls).toHaveLength(2);

        const white = "rgba(255, 255, 255, 1)";
        const gray = "rgba(64, 64, 64, 1)"; // 0.25 * 255 = 63.75 -> 64

        // Group 1 must paint both its own white fill (on top) AND the inherited layer-level gray fill.
        expect(calls[0].fillStyles).toContain(white);
        expect(calls[0].fillStyles).toContain(gray);

        // Group 2 has no fill of its own; it must inherit only the layer-level gray fill (otherwise the
        // magnifying glass outline rasterizes to nothing — the original bug from EDU_V2_07).
        expect(calls[1].fillStyles).toEqual([gray]);
    });

    // A layer-level stroke (`st`) follows the same Lottie semantics as a layer-level fill: it
    // applies to all sibling shapes/groups above it. Cover it here too so a future tweak to the
    // decorator-detection list does not silently drop strokes.
    it("propagates a layer-level stroke to every sibling group's rasterized shape", () => {
        const path = { ind: 0, ty: "sh", nm: "Path 1", ks: { a: 0, k: { i: [[0, 0]], o: [[0, 0]], v: [[0, 0]], c: true } } };
        const layerStroke = {
            ty: "st",
            nm: "Stroke 1",
            c: { a: 0, k: [0, 0, 0, 1] },
            o: { a: 0, k: 100 },
            w: { a: 0, k: 2 },
        };
        const groupTransform = { ty: "tr", nm: "Transform" };

        const animation: RawLottieAnimation = {
            v: "5.0.0",
            fr: 30,
            ip: 0,
            op: 60,
            w: 100,
            h: 100,
            layers: [
                {
                    ty: 4,
                    ind: 1,
                    nm: "Outlined",
                    ip: 0,
                    op: 60,
                    st: 0,
                    ks: makeTransform(),
                    shapes: [{ ty: "gr", nm: "Group 1", it: [path, groupTransform] }, layerStroke] as any,
                } as RawShapeLayer,
            ],
        };

        const { packer, calls } = makeRecordingPacker();
        makeParser(packer, animation);

        expect(calls).toHaveLength(1);
        // The inherited layer-level stroke must be painted with its black CSS color.
        expect(calls[0].strokeStyles).toEqual(["rgba(0, 0, 0, 1)"]);
    });
});

describe("Parser solid layer (ty:1)", () => {
    // Same recording packer pattern as the layer-level decorator suite above. Defined inline so each
    // describe block is self-contained.
    type SolidRasterCall = {
        kind: string;
        boundingBox: { width: number; height: number; centerX: number; centerY: number; offsetX: number; offsetY: number; strokeInset: number };
        scalingFactor: { x: number; y: number };
        fillStyle: unknown;
        fillRects: Array<{ x: number; y: number; width: number; height: number }>;
    };

    function makeRasterizationContext(call: SolidRasterCall): SpritePackerRasterizationContext {
        const context: any = {
            fillStyle: "",
            strokeStyle: "",
            lineWidth: 1,
            lineCap: "butt",
            lineJoin: "miter",
            miterLimit: 10,
            globalCompositeOperation: "source-over",
            save: () => {},
            restore: () => {},
            translate: () => {},
            scale: () => {},
            beginPath: () => {},
            rect: () => {},
            roundRect: () => {},
            clip: () => {},
            moveTo: () => {},
            lineTo: () => {},
            ellipse: () => {},
            bezierCurveTo: () => {},
            closePath: () => {},
            setLineDash: () => {},
            createLinearGradient: () => ({ addColorStop: () => {} }),
            createRadialGradient: () => ({ addColorStop: () => {} }),
            fill: () => {},
            stroke: () => {},
            fillRect: (x: number, y: number, width: number, height: number) => {
                call.fillStyle = context.fillStyle;
                call.fillRects.push({ x, y, width, height });
            },
        };

        return { context, x: 3, y: 5, cellWidth: 16, cellHeight: 16 };
    }

    function makeRecordingPacker(): { packer: SpritePacker; rasterCalls: SolidRasterCall[] } {
        const rasterCalls: SolidRasterCall[] = [];
        const baseInfo: SpriteAtlasInfo = {
            uOffset: 0,
            vOffset: 0,
            cellWidth: 16,
            cellHeight: 16,
            widthPx: 16,
            heightPx: 16,
            centerX: 8,
            centerY: 8,
            atlasIndex: 0,
        };

        const mock = {
            addRasterizedSprite: (
                kind: string,
                boundingBox: SolidRasterCall["boundingBox"],
                scalingFactor: { x: number; y: number },
                drawSprite: (context: SpritePackerRasterizationContext) => void
            ) => {
                const call: SolidRasterCall = {
                    kind,
                    boundingBox: { ...boundingBox },
                    scalingFactor: { x: scalingFactor.x, y: scalingFactor.y },
                    fillStyle: undefined,
                    fillRects: [],
                };
                drawSprite(makeRasterizationContext(call));
                rasterCalls.push(call);
                return baseInfo;
            },
            addLottieText: () => baseInfo,
            updateAtlasTexture: () => {},
            releaseCanvas: () => {},
            get textures() {
                return [];
            },
            get unsupportedFeatures() {
                return [];
            },
            set rawFonts(_: unknown) {},
        };

        return { packer: mock as unknown as SpritePacker, rasterCalls };
    }

    // Reads the parser's renderer-agnostic sprite records so tests can assert the on-screen sprite
    // dimensions that will be handed to the sprite renderer. Solid layers stretch a 1x1 atlas cell
    // to full sw*sh, so the on-screen size is the meaningful surface — distinct from `widthPx`
    // reported by the packer.
    function readSpriteRecords(parser: ParserLike): { width: number; height: number; xOffset: number; yOffset: number; xSize: number; ySize: number }[] {
        return parser.spriteRecords.map((record) => ({
            width: record.width,
            height: record.height,
            xOffset: record.uOffset,
            yOffset: record.vOffset,
            xSize: record.uSize,
            ySize: record.vSize,
        }));
    }

    function captureDebugMessages(parser: ParserLike): string[] {
        const messages: string[] = [];
        const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
            messages.push(args.map((a) => String(a)).join(" "));
        });
        try {
            parser.debug();
        } finally {
            spy.mockRestore();
        }
        return messages;
    }

    it("rasterizes a ty:1 solid layer using a 1x1 atlas cell stretched to full sw*sh on screen", () => {
        // Mirrors the "Grey" backplate in EDU/Pages.json: a 960x540 #f0f0f0 solid layer that the
        // official Lottie player draws as a flat backplate. Solid layers are by definition a single
        // flat color (Lottie schema only allows `sc` as a CSS color string), so we rasterize a 1x1
        // cell into the atlas and let the sprite renderer stretch it. Otherwise a 960x540 backplate
        // at devicePixelRatio=2 would consume ~90% of a 2048-pixel atlas page.
        const animation: RawLottieAnimation = {
            v: "5.0.0",
            fr: 30,
            ip: 0,
            op: 60,
            w: 960,
            h: 540,
            layers: [
                {
                    ty: 1,
                    ind: 1,
                    nm: "Grey",
                    ip: 0,
                    op: 60,
                    st: 0,
                    ks: makeTransform(),
                    sw: 960,
                    sh: 540,
                    sc: "#f0f0f0",
                } as any,
            ],
        };

        const { packer, rasterCalls } = makeRecordingPacker();
        const parser = makeParser(packer, animation, makeConfiguration());
        const sprites = readSpriteRecords(parser);

        // Solid layer must produce exactly one feature-owned atlas rasterization call. It no longer
        // smuggles a rectangle/fill pair through the generic shape path.
        expect(rasterCalls).toHaveLength(1);
        const solidCall = rasterCalls[0];
        expect(solidCall.kind).toBe("solid");
        expect(solidCall.boundingBox).toEqual({ width: 1, height: 1, centerX: 0.5, centerY: 0.5, offsetX: 0.5, offsetY: 0.5, strokeInset: 0 });
        expect(solidCall.scalingFactor).toEqual({ x: 1, y: 1 });
        expect(solidCall.fillStyle).toBe("rgba(240, 240, 240, 1)");
        expect(solidCall.fillRects).toEqual([{ x: 3, y: 5, width: 16, height: 16 }]);

        // On-screen sprite size must reflect the layer's full sw/sh — that's the dimension the GPU
        // stretches the 1x1 cell to. Pages.json's "Grey" layer is the regression case: dropping
        // these dimensions or wiring sw/sh into the atlas instead would either lose the backplate
        // or eat the atlas.
        expect(sprites).toHaveLength(1);
        expect(sprites[0].width).toBe(960);
        expect(sprites[0].height).toBe(540);
        expect(sprites[0].xOffset).toBeCloseTo(8 / 4096, 6);
        expect(sprites[0].yOffset).toBeCloseTo(8 / 4096, 6);
        expect(sprites[0].xSize).toBe(0);
        expect(sprites[0].ySize).toBe(0);
    });

    it("treats ty:1 solid layers as unsupported in Babylon 8 solid layer compatibility mode", () => {
        const animation: RawLottieAnimation = {
            v: "5.0.0",
            fr: 30,
            ip: 0,
            op: 60,
            w: 960,
            h: 540,
            layers: [
                {
                    ty: 1,
                    ind: 1,
                    nm: "Grey",
                    ip: 0,
                    op: 60,
                    st: 0,
                    ks: makeTransform(),
                    sw: 960,
                    sh: 540,
                    sc: "#f0f0f0",
                } as any,
            ],
        };

        const { packer, rasterCalls } = makeRecordingPacker();
        const parser = makeParser(packer, animation, makeConfiguration({ compatibility: { solidLayerRendering: "babylon8" } }));
        const sprites = readSpriteRecords(parser);

        expect(rasterCalls).toHaveLength(0);
        expect(sprites).toHaveLength(0);
        expect(parser.animationInfo.nodes).toHaveLength(0);
        expect(captureDebugMessages(parser)).toContain("UnsupportedLayerType - Layer Name: Grey - Layer Index: 1 - Layer Type: 1");
    });

    it("keeps solid layer rendering independent from text placement compatibility", () => {
        const animation: RawLottieAnimation = {
            v: "5.0.0",
            fr: 30,
            ip: 0,
            op: 60,
            w: 100,
            h: 100,
            layers: [
                {
                    ty: 1,
                    ind: 1,
                    nm: "Override",
                    ip: 0,
                    op: 60,
                    st: 0,
                    ks: makeTransform(),
                    sw: 100,
                    sh: 100,
                    sc: "#000000",
                } as any,
            ],
        };

        const { packer, rasterCalls } = makeRecordingPacker();
        makeParser(packer, animation, makeConfiguration({ compatibility: { textLayerPlacement: "babylon8", solidLayerRendering: "spec" } }));

        expect(rasterCalls).toHaveLength(1);
    });

    it("handles short #RGB hex form for solid layer color", () => {
        // After Effects normally exports the long form, but the CSS spec also allows #RGB. Cover it
        // explicitly so the helper's two-branch path doesn't regress on shorter strings (e.g.
        // hand-edited animations or third-party exporters).
        const animation: RawLottieAnimation = {
            v: "5.0.0",
            fr: 30,
            ip: 0,
            op: 60,
            w: 100,
            h: 100,
            layers: [
                {
                    ty: 1,
                    ind: 1,
                    nm: "Short",
                    ip: 0,
                    op: 60,
                    st: 0,
                    ks: makeTransform(),
                    sw: 100,
                    sh: 100,
                    sc: "#f00",
                } as any,
            ],
        };

        const { packer, rasterCalls } = makeRecordingPacker();
        makeParser(packer, animation);

        expect(rasterCalls).toHaveLength(1);
        expect(rasterCalls[0].fillStyle).toBe("rgba(255, 0, 0, 1)");
    });

    it("skips rasterization but still registers the anchor node when sw/sh are zero", () => {
        // Defensive: malformed solid layer with no usable rectangle. We must not call addLottieShape
        // with zero-size geometry (which produces zero-area sprites and risks divide-by-zero in
        // bounding-box code), but we still need a valid anchor slot so child layers parented via
        // `ind` resolve correctly.
        const animation: RawLottieAnimation = {
            v: "5.0.0",
            fr: 30,
            ip: 0,
            op: 60,
            w: 100,
            h: 100,
            layers: [
                {
                    ty: 1,
                    ind: 1,
                    nm: "Empty",
                    ip: 0,
                    op: 60,
                    st: 0,
                    ks: makeTransform(),
                    sw: 0,
                    sh: 0,
                    sc: "#000000",
                } as any,
                {
                    ty: 4,
                    ind: 2,
                    nm: "Child",
                    parent: 1,
                    ip: 0,
                    op: 60,
                    st: 0,
                    ks: makeTransform(),
                    shapes: [makeRectShape()],
                } as RawShapeLayer,
            ],
        };

        const { packer, rasterCalls } = makeRecordingPacker();
        const parser = makeParser(packer, animation);

        // Only the child shape rasterizes; the malformed solid layer is skipped.
        expect(rasterCalls.filter((c) => c.kind === "solid")).toHaveLength(0);
        expect(rasterCalls.filter((c) => c.kind === "shape")).toHaveLength(1);

        // Solid layer's anchor was still created so the child resolves its parent and ends up as a
        // descendant of the solid layer's ControlNode (not a stray root).
        const roots = parser.animationInfo.nodes;
        expect(roots).toHaveLength(1);
        expect(roots[0].id).toBe("ControlNode (TRS) - Empty");
    });
});
