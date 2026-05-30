import { describe, it, expect } from "vitest";

import { DetectShapeDrawItems, ShapeDrawItemTypes } from "../../src/load/detectShapeItems";
import { type RawElement, type RawLottieAnimation, type RawLottieLayer } from "../../src/parsing/rawTypes";

function shapeItem(ty: string, extra?: Partial<RawElement>): RawElement {
    return { ty, ...extra } as RawElement;
}

function group(children: RawElement[], extra?: Partial<RawElement>): RawElement {
    return { ty: "gr", it: children, ...extra } as RawElement;
}

function shapeLayer(shapes: RawElement[], extra?: Partial<RawLottieLayer>): RawLottieLayer {
    return { ty: 4, shapes, ...extra } as unknown as RawLottieLayer;
}

function animation(layers: RawLottieLayer[]): RawLottieAnimation {
    return { v: "5.0.0", fr: 30, ip: 0, op: 60, w: 100, h: 100, layers } as RawLottieAnimation;
}

describe("DetectShapeDrawItems", () => {
    it("returns an empty list when there are no shape layers", () => {
        const raw = animation([{ ty: 1 } as unknown as RawLottieLayer, { ty: 5 } as unknown as RawLottieLayer]);
        expect(DetectShapeDrawItems(raw)).toEqual([]);
    });

    it("detects a single shape-item type", () => {
        const raw = animation([shapeLayer([shapeItem("rc"), shapeItem("fl")])]);
        expect(DetectShapeDrawItems(raw)).toEqual(["rc", "fl"]);
    });

    it("detects items nested inside groups", () => {
        const raw = animation([shapeLayer([group([shapeItem("el"), group([shapeItem("gf")])])])]);
        expect(DetectShapeDrawItems(raw)).toEqual(["el", "gf"]);
    });

    it("does not report gradient code for a gradient-free animation", () => {
        const raw = animation([shapeLayer([shapeItem("rc"), shapeItem("sh"), shapeItem("fl"), shapeItem("st")])]);
        const detected = DetectShapeDrawItems(raw);
        expect(detected).not.toContain("gf");
        expect(detected).not.toContain("gs");
    });

    it("reports gradient code only when a gradient item is present", () => {
        const raw = animation([shapeLayer([shapeItem("sh"), shapeItem("gf")])]);
        expect(DetectShapeDrawItems(raw)).toContain("gf");
    });

    it("ignores structural group and transform items", () => {
        const raw = animation([shapeLayer([group([shapeItem("rc")]), shapeItem("tr")])]);
        const detected = DetectShapeDrawItems(raw);
        expect(detected).toEqual(["rc"]);
        expect(detected).not.toContain("gr" as never);
        expect(detected).not.toContain("tr" as never);
    });

    it("skips hidden layers", () => {
        const raw = animation([shapeLayer([shapeItem("gf")], { hd: true }), shapeLayer([shapeItem("rc")])]);
        expect(DetectShapeDrawItems(raw)).toEqual(["rc"]);
    });

    it("skips hidden shape items", () => {
        const raw = animation([shapeLayer([shapeItem("gf", { hd: true }), shapeItem("rc")])]);
        expect(DetectShapeDrawItems(raw)).toEqual(["rc"]);
    });

    it("deduplicates and returns canonical order regardless of document order", () => {
        const raw = animation([shapeLayer([shapeItem("st"), shapeItem("rc"), shapeItem("rc"), shapeItem("fl"), shapeItem("el")])]);
        const detected = DetectShapeDrawItems(raw);
        expect(detected).toEqual(["rc", "el", "fl", "st"]);
        // Canonical order matches the exported ordering.
        const indices = detected.map((ty) => ShapeDrawItemTypes.indexOf(ty));
        const sorted = [...indices].sort((a, b) => a - b);
        expect(indices).toEqual(sorted);
    });

    it("merges items across multiple shape layers", () => {
        const raw = animation([shapeLayer([shapeItem("rc")]), shapeLayer([shapeItem("gf")])]);
        expect(DetectShapeDrawItems(raw)).toEqual(["rc", "gf"]);
    });
});
