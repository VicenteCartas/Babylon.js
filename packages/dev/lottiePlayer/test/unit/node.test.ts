import { describe, it, expect } from "vitest";
import { CreateNode, CreateControlNode, DecomposeWorldMatrixAtFrame, GetNodeOpacity, ResetNode, SetNodeVisible, UpdateNode } from "../../src/nodes/node";
import { type Vector2Property, type ScalarProperty } from "../../src/parsing/parsedTypes";
import { BuildScalarTrack, BuildVector2Track, type EaseHandle } from "../../src/parsing/tracks";

const EasingSteps = 4;

function linearEase(): EaseHandle {
    return { x1: 0, y1: 0, x2: 1, y2: 1 };
}

function makePositionProperty(startX: number, startY: number, keyframes: { time: number; x: number; y: number }[]): Vector2Property {
    return {
        startValue: { x: startX, y: startY },
        currentValue: { x: startX, y: startY },
        currentKeyframeIndex: 0,
        track: BuildVector2Track(
            keyframes.map((kf) => ({
                time: kf.time,
                x: kf.x,
                y: kf.y,
                ease1: linearEase(),
                ease2: linearEase(),
            })),
            EasingSteps
        ),
    };
}

function makeScalarProperty(startValue: number, keyframes: { time: number; value: number }[]): ScalarProperty {
    return {
        startValue,
        currentValue: startValue,
        currentKeyframeIndex: 0,
        track: BuildScalarTrack(
            keyframes.map((kf) => ({
                time: kf.time,
                value: kf.value,
                ease: linearEase(),
            })),
            EasingSteps
        ),
    };
}

describe("Node keyframe boundary", () => {
    it("returns the final keyframe value at exactly the last keyframe time", () => {
        const position = makePositionProperty(0, 0, [
            { time: 0, x: 0, y: 0 },
            { time: 30, x: 100, y: 200 },
        ]);

        const node = CreateNode("test", position);
        SetNodeVisible(node, true);
        UpdateNode(node, 30);

        expect(node.position.currentValue.x).toBe(100);
        expect(node.position.currentValue.y).toBe(200);
    });

    it("clamps to the final keyframe value beyond the last keyframe time", () => {
        const position = makePositionProperty(0, 0, [
            { time: 0, x: 0, y: 0 },
            { time: 30, x: 100, y: 200 },
        ]);

        const node = CreateNode("test", position);
        SetNodeVisible(node, true);
        UpdateNode(node, 31);

        expect(node.position.currentValue.x).toBe(100);
        expect(node.position.currentValue.y).toBe(200);
    });

    it("interpolates correctly at mid-frame", () => {
        const position = makePositionProperty(0, 0, [
            { time: 0, x: 0, y: 0 },
            { time: 30, x: 100, y: 200 },
        ]);

        const node = CreateNode("test", position);
        SetNodeVisible(node, true);
        UpdateNode(node, 15);

        expect(node.position.currentValue.x).toBeCloseTo(50, 0);
        expect(node.position.currentValue.y).toBeCloseTo(100, 0);
    });

    it("returns the final scale value at exactly the last keyframe time", () => {
        const scale = makePositionProperty(1, 1, [
            { time: 0, x: 1, y: 1 },
            { time: 20, x: 2, y: 3 },
        ]);

        const node = CreateNode("test", undefined, undefined, scale);
        SetNodeVisible(node, true);
        UpdateNode(node, 20);

        expect(node.scale.currentValue.x).toBe(2);
        expect(node.scale.currentValue.y).toBe(3);
    });

    it("returns the final opacity value at exactly the last keyframe time", () => {
        const opacity = makeScalarProperty(0, [
            { time: 0, value: 0 },
            { time: 10, value: 1 },
        ]);

        const node = CreateNode("test", undefined, undefined, undefined, opacity);
        SetNodeVisible(node, true);
        UpdateNode(node, 10);

        expect(GetNodeOpacity(node)).toBe(1);
    });

    it("applies correct sign for rotation at exactly the last keyframe time", () => {
        const rotation = makeScalarProperty(0, [
            { time: 0, value: 0 },
            { time: 30, value: Math.PI / 2 },
        ]);

        const node = CreateNode("test", undefined, rotation);
        SetNodeVisible(node, true);

        // At mid-frame, interpolation applies negation
        UpdateNode(node, 15);
        const midValue = node.rotation.currentValue;
        expect(midValue).toBeLessThan(0);

        // At exact last keyframe, clamp should also apply negation
        UpdateNode(node, 30);
        expect(node.rotation.currentValue).toBeCloseTo(-Math.PI / 2, 5);
    });
});

describe("Null layer opacity isolation", () => {
    it("child of null layer with opacity 0 returns its own opacity when no grandparent", () => {
        const parentOpacity = makeScalarProperty(0, []);
        const nullParent = CreateControlNode("null-parent", 0, 100, undefined, undefined, undefined, parentOpacity, undefined, true);
        UpdateNode(nullParent, 0);

        const childOpacity: ScalarProperty = { startValue: 1, currentValue: 1, currentKeyframeIndex: 0 };
        const child = CreateNode("child", undefined, undefined, undefined, childOpacity, nullParent);
        SetNodeVisible(child, true);
        SetNodeVisible(nullParent, true);

        // Force update to propagate visibility
        UpdateNode(nullParent, 0);

        expect(GetNodeOpacity(child)).toBe(1);
    });

    it("child of null layer still inherits grandparent opacity", () => {
        const grandparentOpacity: ScalarProperty = { startValue: 0.5, currentValue: 0.5, currentKeyframeIndex: 0 };
        const grandparent = CreateControlNode("grandparent", 0, 100, undefined, undefined, undefined, grandparentOpacity);

        const nullOpacity = makeScalarProperty(0, []);
        const nullParent = CreateControlNode("null-parent", 0, 100, undefined, undefined, undefined, nullOpacity, grandparent, true);

        const childOpacity: ScalarProperty = { startValue: 0.8, currentValue: 0.8, currentKeyframeIndex: 0 };
        const child = CreateNode("child", undefined, undefined, undefined, childOpacity, nullParent);

        SetNodeVisible(grandparent, true);
        UpdateNode(grandparent, 0);

        // Child should skip null layer's opacity (0) but still multiply by grandparent's opacity (0.5)
        expect(GetNodeOpacity(child)).toBeCloseTo(0.4, 5);
    });

    it("child of nested null layers still inherits ancestor opacity", () => {
        // Mirror the real scene graph: control → anchor node → control → anchor node → ...
        const ancestorOpacity: ScalarProperty = { startValue: 0.5, currentValue: 0.5, currentKeyframeIndex: 0 };
        const ancestor = CreateControlNode("ancestor", 0, 100, undefined, undefined, undefined, ancestorOpacity);
        const ancestorAnchor = CreateNode("ancestor-anchor", undefined, undefined, undefined, undefined, ancestor);

        const null1Opacity = makeScalarProperty(0, []);
        const null1 = CreateControlNode("null1", 0, 100, undefined, undefined, undefined, null1Opacity, ancestorAnchor, true);
        const null1Anchor = CreateNode("null1-anchor", undefined, undefined, undefined, undefined, null1);

        const null2Opacity = makeScalarProperty(0, []);
        const null2 = CreateControlNode("null2", 0, 100, undefined, undefined, undefined, null2Opacity, null1Anchor, true);
        const null2Anchor = CreateNode("null2-anchor", undefined, undefined, undefined, undefined, null2);

        const childOpacity: ScalarProperty = { startValue: 1, currentValue: 1, currentKeyframeIndex: 0 };
        const child = CreateNode("child", undefined, undefined, undefined, childOpacity, null2Anchor);

        SetNodeVisible(ancestor, true);
        UpdateNode(ancestor, 0);

        // Both null layers' opacities (0) should be skipped, but ancestor's 0.5 should be preserved
        expect(GetNodeOpacity(child)).toBeCloseTo(0.5, 5);
    });

    it("child of regular layer still multiplies by parent opacity", () => {
        const parentOpacity: ScalarProperty = { startValue: 0.5, currentValue: 0.5, currentKeyframeIndex: 0 };
        const regularParent = CreateControlNode("regular-parent", 0, 100, undefined, undefined, undefined, parentOpacity, undefined, false);

        const childOpacity: ScalarProperty = { startValue: 0.8, currentValue: 0.8, currentKeyframeIndex: 0 };
        const child = CreateNode("child", undefined, undefined, undefined, childOpacity, regularParent);
        SetNodeVisible(child, true);
        SetNodeVisible(regularParent, true);

        UpdateNode(regularParent, 0);

        expect(GetNodeOpacity(child)).toBeCloseTo(0.4, 5);
    });

    it("transforms from null layer parent still apply to children", () => {
        const parentPosition = makePositionProperty(10, 20, []);
        const nullParent = CreateControlNode("null-parent", 0, 100, parentPosition, undefined, undefined, undefined, undefined, true);

        const child = CreateNode("child", undefined, undefined, undefined, undefined, nullParent);
        SetNodeVisible(child, true);
        SetNodeVisible(nullParent, true);

        UpdateNode(nullParent, 0);

        // The child's world matrix should reflect the parent's position
        const scale = { x: 0, y: 0 };
        const translation = { x: 0, y: 0 };
        child.worldMatrix.decompose(scale, translation);

        expect(translation.x).toBeCloseTo(10, 5);
        expect(translation.y).toBeCloseTo(20, 5);
    });
});

describe("ControlNode out-frame exclusivity", () => {
    it("is visible at outFrame - 1", () => {
        const control = CreateControlNode("test", 0, 30);
        UpdateNode(control, 29);

        expect(GetNodeOpacity(control)).toBeGreaterThan(0);
    });

    it("is invisible at exactly outFrame", () => {
        const control = CreateControlNode("test", 0, 30);
        UpdateNode(control, 30);

        expect(GetNodeOpacity(control)).toBe(0);
    });

    it("is visible at inFrame", () => {
        const control = CreateControlNode("test", 5, 30);
        UpdateNode(control, 5);

        expect(GetNodeOpacity(control)).toBeGreaterThan(0);
    });

    it("is invisible before inFrame", () => {
        const control = CreateControlNode("test", 5, 30);
        UpdateNode(control, 4);

        expect(GetNodeOpacity(control)).toBe(0);
    });
});

describe("decomposeWorldMatrixAtFrame", () => {
    it("returns interpolated scale at mid-frame", () => {
        const scale = makePositionProperty(1, 1, [
            { time: 0, x: 1, y: 1 },
            { time: 30, x: 2, y: 2 },
        ]);

        const node = CreateNode("test", undefined, undefined, scale);
        const outScale = { x: 0, y: 0 };
        const outTranslation = { x: 0, y: 0 };
        DecomposeWorldMatrixAtFrame(node, 15, outScale, outTranslation);

        expect(outScale.x).toBeCloseTo(1.5, 1);
        expect(outScale.y).toBeCloseTo(1.5, 1);
    });

    it("returns start values when no keyframes", () => {
        const node = CreateNode("test");
        const outScale = { x: 0, y: 0 };
        const outTranslation = { x: 0, y: 0 };
        DecomposeWorldMatrixAtFrame(node, 10, outScale, outTranslation);

        expect(outScale.x).toBeCloseTo(1, 5);
        expect(outScale.y).toBeCloseTo(1, 5);
        expect(outTranslation.x).toBeCloseTo(0, 5);
        expect(outTranslation.y).toBeCloseTo(0, 5);
    });

    it("returns last keyframe values at frame beyond last keyframe", () => {
        const scale = makePositionProperty(1, 1, [
            { time: 0, x: 1, y: 1 },
            { time: 30, x: 3, y: 3 },
        ]);

        const node = CreateNode("test", undefined, undefined, scale);
        const outScale = { x: 0, y: 0 };
        const outTranslation = { x: 0, y: 0 };
        DecomposeWorldMatrixAtFrame(node, 50, outScale, outTranslation);

        expect(outScale.x).toBeCloseTo(3, 1);
        expect(outScale.y).toBeCloseTo(3, 1);
    });

    it("composes parent and child transforms", () => {
        const parentScale = makePositionProperty(2, 2, [
            { time: 0, x: 2, y: 2 },
            { time: 30, x: 4, y: 4 },
        ]);

        const parent = CreateNode("parent", undefined, undefined, parentScale);
        const child = CreateNode("child", undefined, undefined, undefined, undefined, parent);

        const outScale = { x: 0, y: 0 };
        const outTranslation = { x: 0, y: 0 };
        DecomposeWorldMatrixAtFrame(child, 15, outScale, outTranslation);

        // Parent scale at frame 15 = interpolated 3,3 → child inherits parent scale
        expect(outScale.x).toBeCloseTo(3, 1);
        expect(outScale.y).toBeCloseTo(3, 1);
    });

    it("matches worldMatrix.decompose for static non-zero rotation (no keyframes)", () => {
        const rotation: ScalarProperty = { startValue: -Math.PI / 4, currentValue: -Math.PI / 4, currentKeyframeIndex: 0 };

        const node = CreateNode("test", undefined, rotation);

        // Get expected rotation from worldMatrix.decompose (the constructor path)
        const wmScale = { x: 0, y: 0 };
        const wmTranslation = { x: 0, y: 0 };
        const wmRotation = node.worldMatrix.decompose(wmScale, wmTranslation);

        // DecomposeWorldMatrixAtFrame should produce the same rotation
        const outScale = { x: 0, y: 0 };
        const outTranslation = { x: 0, y: 0 };
        const outRotation = DecomposeWorldMatrixAtFrame(node, 10, outScale, outTranslation);

        expect(outRotation).toBeCloseTo(wmRotation, 5);
    });

    it("does not mutate node state", () => {
        const position = makePositionProperty(0, 0, [
            { time: 0, x: 0, y: 0 },
            { time: 30, x: 100, y: 200 },
        ]);

        const node = CreateNode("test", position);
        const outScale = { x: 0, y: 0 };
        const outTranslation = { x: 0, y: 0 };

        // Call DecomposeWorldMatrixAtFrame — should NOT change currentValue
        DecomposeWorldMatrixAtFrame(node, 15, outScale, outTranslation);

        expect(node.position.currentValue.x).toBe(0);
        expect(node.position.currentValue.y).toBe(0);
    });

    it("applies negation consistently for animated rotation keyframes", () => {
        // Rotation keyframes are stored without negation; negation is applied at interpolation time.
        // startValue is pre-negated by the parser. This test covers the keyframe interpolation path
        // to guard against regressions in the sign convention.
        const rotation = makeScalarProperty(0, [
            { time: 0, value: 0 },
            { time: 30, value: Math.PI / 2 },
        ]);

        const node = CreateNode("test", undefined, rotation);

        // Drive the runtime update path to get the "ground truth" rotation at frame 15.
        SetNodeVisible(node, true);
        UpdateNode(node, 15);
        const expectedScale = { x: 0, y: 0 };
        const expectedTranslation = { x: 0, y: 0 };
        const expectedRotation = node.worldMatrix.decompose(expectedScale, expectedTranslation);

        // Reset and verify the at-frame path produces the same rotation without mutating state.
        ResetNode(node);
        const outScale = { x: 0, y: 0 };
        const outTranslation = { x: 0, y: 0 };
        const outRotation = DecomposeWorldMatrixAtFrame(node, 15, outScale, outTranslation);

        expect(outRotation).toBeCloseTo(expectedRotation, 5);
        expect(node.rotation.currentValue).toBeCloseTo(0, 5); // reset restored startValue; DecomposeWorldMatrixAtFrame did not mutate
    });
});

describe("Node loop reset of nested animated nodes", () => {
    // Regression: when looping back to a frame that is BEFORE the first keyframe of an animated
    // child node, the controller's reset()+update(currentFrame) sequence used to leave the child's
    // localMatrix at the END-of-previous-loop interpolated value, even though `currentValue` had
    // been correctly reset to `startValue`. The cause was that `UpdateNode` only honored
    // `isReset` on the node it was first called on (the root) and did not propagate it to
    // children, so animated descendants whose animation functions return false at the new frame
    // (idx < 0 — frame before first keyframe) never recomposed their localMatrix.
    //
    // This was visible in the Pages.json animation where layers parented under "Null 19" / "Null
    // Pages" (which have keyframes starting at t=37 / t=109) appeared in their previous-loop
    // end-state for the first ~30+ frames of every loop.
    it("recomposes a nested animated child's worldMatrix after looping back before its first keyframe", () => {
        // Parent: animated keyframes 30→60. Mirrors a "Null" layer whose own animation starts late.
        const parentScale: Vector2Property = {
            startValue: { x: 1, y: 1 },
            currentValue: { x: 1, y: 1 },
            currentKeyframeIndex: 0,
            track: BuildVector2Track(
                [
                    { time: 30, x: 1, y: 1, ease1: linearEase(), ease2: linearEase() },
                    { time: 60, x: 5, y: 5, ease1: linearEase(), ease2: linearEase() },
                ],
                EasingSteps
            ),
        };
        const parent = CreateNode("parent", undefined, undefined, parentScale);
        SetNodeVisible(parent, true);

        // Child: own animated position with first keyframe at t=10. Its localMatrix gets recomposed
        // every time its animation function fires (frames 10..40), then stays at the final
        // interpolated value once frame > 40.
        const childPosition = makePositionProperty(0, 0, [
            { time: 10, x: 0, y: 0 },
            { time: 40, x: 100, y: 200 },
        ]);
        const child = CreateNode("child", childPosition, undefined, undefined, undefined, parent);
        SetNodeVisible(child, true);

        // Drive the animation to its end so both parent.localMatrix and child.localMatrix sit at
        // their last-keyframe interpolated values.
        UpdateNode(parent, 90);

        // Sanity: child's local position is at the last keyframe value before the loop reset.
        expect(child.position.currentValue.x).toBeCloseTo(100, 5);
        expect(child.position.currentValue.y).toBeCloseTo(200, 5);

        // Loop back: reset all properties and replay from frame 0 (before the child's first
        // keyframe at t=10). This mirrors what AnimationController does on loop wrap.
        ResetNode(parent);
        UpdateNode(parent, 0);

        // After reset+update at frame 0:
        //  - child.currentValue must be back to startValue (0, 0) — reset's responsibility.
        //  - child.worldMatrix translation must reflect (0, 0) too — i.e. its localMatrix must
        //    have been recomposed from the reset currentValue, not left at the end-of-loop state.
        expect(child.position.currentValue.x).toBeCloseTo(0, 5);
        expect(child.position.currentValue.y).toBeCloseTo(0, 5);

        const worldScale = { x: 0, y: 0 };
        const worldTranslation = { x: 0, y: 0 };
        child.worldMatrix.decompose(worldScale, worldTranslation);
        expect(worldTranslation.x).toBeCloseTo(0, 5);
        expect(worldTranslation.y).toBeCloseTo(0, 5);
    });
});
