import { describe, it, expect } from "vitest";

import { DeserializeAnimationInfo, SerializeAnimationInfo, type PrebakedAnimationInfo } from "../../src/load/prebake";
import { CreateControlNode, CreateNode, CreateSpriteNode, type AnimationNode } from "../../src/nodes/node";
import { type AnimationInfo, type ScalarProperty, type Vector2Property } from "../../src/parsing/parsedTypes";
import { BuildScalarTrack, BuildVector2Track, type EaseHandle } from "../../src/parsing/tracks";

const EasingSteps = 4;

function linearEase(): EaseHandle {
    return { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 };
}

function animatedPosition(startX: number, startY: number): Vector2Property {
    return {
        startValue: { x: startX, y: startY },
        currentValue: { x: startX, y: startY },
        currentKeyframeIndex: 0,
        track: BuildVector2Track(
            [
                { time: 0, x: startX, y: startY, ease1: linearEase(), ease2: linearEase() },
                // Second keyframe uses a hold/step segment (undefined ease) to exercise the NaN bezier marker.
                { time: 30, x: startX + 100, y: startY + 200, ease1: undefined, ease2: undefined },
            ],
            EasingSteps
        ),
    };
}

function animatedOpacity(): ScalarProperty {
    return {
        startValue: 1,
        currentValue: 1,
        currentKeyframeIndex: 0,
        track: BuildScalarTrack(
            [
                { time: 0, value: 1, ease: linearEase() },
                { time: 30, value: 0, ease: undefined },
            ],
            EasingSteps
        ),
    };
}

function buildSampleAnimationInfo(): AnimationInfo {
    // control (root, animated) -> node (child) -> sprite (grandchild)
    const root = CreateControlNode("root", 0, 60, animatedPosition(10, 20), undefined, undefined, animatedOpacity(), undefined, true);
    const child = CreateNode("child", animatedPosition(5, 5), undefined, undefined, undefined, root);
    CreateSpriteNode("leaf", 64, 48, undefined, undefined, undefined, undefined, child);

    // A second root with no animation to cover the static (no-track) path.
    const staticRoot = CreateControlNode("static-root", 5, 40, undefined, undefined, undefined, undefined, undefined, false);

    return {
        startFrame: 0,
        endFrame: 60,
        frameRate: 30,
        widthPx: 512,
        heightPx: 256,
        nodes: [root, staticRoot],
    };
}

function flatten(info: AnimationInfo): AnimationNode[] {
    const result: AnimationNode[] = [];
    const visit = (node: AnimationNode): void => {
        result.push(node);
        for (const child of node.children) {
            visit(child);
        }
    };
    for (const root of info.nodes) {
        visit(root);
    }
    return result;
}

describe("Prebaked animation serialization", () => {
    it("round-trips animation metadata through JSON", () => {
        const original = buildSampleAnimationInfo();
        const prebaked: PrebakedAnimationInfo = JSON.parse(JSON.stringify(SerializeAnimationInfo(original)));
        const restored = DeserializeAnimationInfo(prebaked);

        expect(restored.startFrame).toBe(original.startFrame);
        expect(restored.endFrame).toBe(original.endFrame);
        expect(restored.frameRate).toBe(original.frameRate);
        expect(restored.widthPx).toBe(original.widthPx);
        expect(restored.heightPx).toBe(original.heightPx);
    });

    it("preserves the node hierarchy and parent/child wiring", () => {
        const original = buildSampleAnimationInfo();
        const restored = DeserializeAnimationInfo(JSON.parse(JSON.stringify(SerializeAnimationInfo(original))));

        const originalNodes = flatten(original);
        const restoredNodes = flatten(restored);

        expect(restoredNodes.map((n) => n.id)).toEqual(originalNodes.map((n) => n.id));
        expect(restoredNodes.map((n) => n._kind)).toEqual(originalNodes.map((n) => n._kind));
        expect(restoredNodes.map((n) => n.parent?.id ?? null)).toEqual(originalNodes.map((n) => n.parent?.id ?? null));
        expect(restoredNodes.map((n) => n.children.map((c) => c.id))).toEqual(originalNodes.map((n) => n.children.map((c) => c.id)));
    });

    it("preserves per-kind metadata and base transforms", () => {
        const original = buildSampleAnimationInfo();
        const restored = DeserializeAnimationInfo(JSON.parse(JSON.stringify(SerializeAnimationInfo(original))));

        const originalById = new Map(flatten(original).map((n) => [n.id, n]));
        for (const node of flatten(restored)) {
            const source = originalById.get(node.id)!;
            expect(node.inFrame).toBe(source.inFrame);
            expect(node.outFrame).toBe(source.outFrame);
            expect(node.isNullLayer).toBe(source.isNullLayer);
            expect(node.isShape).toBe(source.isShape);
            expect(node.originalWidth).toBe(source.originalWidth);
            expect(node.originalHeight).toBe(source.originalHeight);
            expect(node.animatedTracks).toBe(source.animatedTracks);
            expect(node.isAnimated).toBe(source.isAnimated);
            expect(node.position.startValue).toEqual(source.position.startValue);
            expect(node.opacity.startValue).toBe(source.opacity.startValue);
        }
    });

    it("rehydrates typed-array tracks, restoring NaN hold/step easing markers", () => {
        const original = buildSampleAnimationInfo();
        const restored = DeserializeAnimationInfo(JSON.parse(JSON.stringify(SerializeAnimationInfo(original))));

        const restoredRoot = restored.nodes[0];
        const originalRoot = original.nodes[0];

        const restoredTrack = restoredRoot.position.track!;
        const originalTrack = originalRoot.position.track!;

        expect(restoredTrack).toBeDefined();
        expect(restoredTrack.times).toBeInstanceOf(Float32Array);
        expect(Array.from(restoredTrack.times)).toEqual(Array.from(originalTrack.times));
        expect(Array.from(restoredTrack.valuesX)).toEqual(Array.from(originalTrack.valuesX));
        expect(Array.from(restoredTrack.valuesY)).toEqual(Array.from(originalTrack.valuesY));

        // The first keyframe has a real ease; the second is a hold/step marked by NaN in the x1 slot.
        expect(restoredTrack.bezierX[0]).toBeCloseTo(0.1);
        expect(Number.isNaN(restoredTrack.bezierX[4])).toBe(true);
        expect(Number.isNaN(restoredTrack.bezierY[4])).toBe(true);
    });

    it("leaves sprite nodes without a materialized sprite", () => {
        const original = buildSampleAnimationInfo();
        const restored = DeserializeAnimationInfo(JSON.parse(JSON.stringify(SerializeAnimationInfo(original))));

        const sprite = flatten(restored).find((n) => n._kind === "sprite")!;
        expect(sprite).toBeDefined();
        expect(sprite.sprite).toBeNull();
        expect(sprite.isShape).toBe(true);
        expect(sprite.originalWidth).toBe(64);
        expect(sprite.originalHeight).toBe(48);
    });
});
