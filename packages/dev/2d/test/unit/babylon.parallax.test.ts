import { Node2D } from "2d/Node2D/node2D";
import { Sprite2D } from "2d/Sprite2D/sprite2D";
import type { ISprite2DRenderData } from "2d/Rendering/spriteBatchRenderer";

// Mock texture helper
function mockTexture(w: number, h: number) {
    return {
        getSize: () => ({ width: w, height: h }),
        getInternalTexture: () => null,
    } as any;
}

// Mock fallback texture
const whiteTex = mockTexture(1, 1);

describe("Parallax scrolling — Node2D scroll factors", () => {
    describe("default values", () => {
        it("should default scrollFactorX and scrollFactorY to 1", () => {
            const node = new Node2D("node");

            expect(node.scrollFactorX).toBe(1);
            expect(node.scrollFactorY).toBe(1);
        });

        it("should default worldScrollFactorX and worldScrollFactorY to 1", () => {
            const node = new Node2D("node");

            expect(node.worldScrollFactorX).toBe(1);
            expect(node.worldScrollFactorY).toBe(1);
        });
    });

    describe("local scroll factor → world scroll factor (root node)", () => {
        it("should use own scrollFactorX as worldScrollFactorX when no parent", () => {
            const node = new Node2D("root");
            node.scrollFactorX = 0.5;

            expect(node.worldScrollFactorX).toBe(0.5);
        });

        it("should use own scrollFactorY as worldScrollFactorY when no parent", () => {
            const node = new Node2D("root");
            node.scrollFactorY = 0.3;

            expect(node.worldScrollFactorY).toBe(0.3);
        });

        it("should give worldScrollFactor 0 when scrollFactor is 0", () => {
            const node = new Node2D("fixed");
            node.scrollFactorX = 0;
            node.scrollFactorY = 0;

            expect(node.worldScrollFactorX).toBe(0);
            expect(node.worldScrollFactorY).toBe(0);
        });
    });

    describe("inheritance through hierarchy", () => {
        it("should inherit parent scroll factor when child is 1 (parent=0.5, child=1 → 0.5)", () => {
            const parent = new Node2D("parent");
            parent.scrollFactorX = 0.5;
            parent.scrollFactorY = 0.5;

            const child = new Node2D("child");
            child.parent = parent;

            expect(child.worldScrollFactorX).toBe(0.5);
            expect(child.worldScrollFactorY).toBe(0.5);
        });

        it("should multiply parent and child scroll factors (parent=0.5, child=0.5 → 0.25)", () => {
            const parent = new Node2D("parent");
            parent.scrollFactorX = 0.5;
            parent.scrollFactorY = 0.5;

            const child = new Node2D("child");
            child.scrollFactorX = 0.5;
            child.scrollFactorY = 0.5;
            child.parent = parent;

            expect(child.worldScrollFactorX).toBeCloseTo(0.25, 10);
            expect(child.worldScrollFactorY).toBeCloseTo(0.25, 10);
        });

        it("should propagate through a three-level hierarchy", () => {
            const grandparent = new Node2D("grandparent");
            grandparent.scrollFactorX = 0.5;
            grandparent.scrollFactorY = 0.8;

            const parent = new Node2D("parent");
            parent.scrollFactorX = 0.4;
            parent.scrollFactorY = 0.5;
            parent.parent = grandparent;

            const child = new Node2D("child");
            child.scrollFactorX = 0.5;
            child.scrollFactorY = 0.5;
            child.parent = parent;

            // 0.5 * 0.4 * 0.5 = 0.1
            expect(child.worldScrollFactorX).toBeCloseTo(0.1, 10);
            // 0.8 * 0.5 * 0.5 = 0.2
            expect(child.worldScrollFactorY).toBeCloseTo(0.2, 10);
        });

        it("should give 0 when any ancestor has scrollFactor 0", () => {
            const parent = new Node2D("parent");
            parent.scrollFactorX = 0;
            parent.scrollFactorY = 0;

            const child = new Node2D("child");
            child.scrollFactorX = 0.8;
            child.scrollFactorY = 0.8;
            child.parent = parent;

            expect(child.worldScrollFactorX).toBe(0);
            expect(child.worldScrollFactorY).toBe(0);
        });
    });

    describe("X and Y independence", () => {
        it("should allow different values for X and Y scroll factors", () => {
            const node = new Node2D("node");
            node.scrollFactorX = 0.3;
            node.scrollFactorY = 0.7;

            expect(node.worldScrollFactorX).toBe(0.3);
            expect(node.worldScrollFactorY).toBe(0.7);
        });

        it("should independently multiply X and Y through hierarchy", () => {
            const parent = new Node2D("parent");
            parent.scrollFactorX = 0.5;
            parent.scrollFactorY = 0.8;

            const child = new Node2D("child");
            child.scrollFactorX = 0.6;
            child.scrollFactorY = 0.25;
            child.parent = parent;

            expect(child.worldScrollFactorX).toBeCloseTo(0.3, 10); // 0.5 * 0.6
            expect(child.worldScrollFactorY).toBeCloseTo(0.2, 10); // 0.8 * 0.25
        });
    });

    describe("dirty flag propagation", () => {
        it("should update child worldScrollFactor when parent is dirtied after scrollFactor change", () => {
            const parent = new Node2D("parent");
            parent.scrollFactorX = 0.5;

            const child = new Node2D("child");
            child.parent = parent;

            // Force initial computation
            expect(child.worldScrollFactorX).toBe(0.5);

            // scrollFactorX is a plain public field (not a dirty-tracking setter),
            // so changing it alone does NOT mark the transform dirty.
            // A transform property change (e.g. rotation) is needed to trigger
            // recomputation, which will then pick up the new scrollFactor value.
            parent.scrollFactorX = 0.8;
            parent.rotation = parent.rotation + 0.001; // nudge to dirty the parent

            expect(parent.worldScrollFactorX).toBeCloseTo(0.8, 5);
            expect(child.worldScrollFactorX).toBeCloseTo(0.8, 5);
        });

        it("should update child worldScrollFactor when reparented", () => {
            const parentA = new Node2D("parentA");
            parentA.scrollFactorX = 0.5;
            parentA.scrollFactorY = 0.5;

            const parentB = new Node2D("parentB");
            parentB.scrollFactorX = 0.8;
            parentB.scrollFactorY = 0.8;

            const child = new Node2D("child");
            child.parent = parentA;

            expect(child.worldScrollFactorX).toBe(0.5);
            expect(child.worldScrollFactorY).toBe(0.5);

            // Reparent
            child.parent = parentB;

            expect(child.worldScrollFactorX).toBe(0.8);
            expect(child.worldScrollFactorY).toBe(0.8);
        });

        it("should use own scrollFactor when detached from parent", () => {
            const parent = new Node2D("parent");
            parent.scrollFactorX = 0.5;

            const child = new Node2D("child");
            child.scrollFactorX = 0.6;
            child.parent = parent;

            expect(child.worldScrollFactorX).toBeCloseTo(0.3, 10);

            // Detach
            child.parent = null;

            expect(child.worldScrollFactorX).toBe(0.6);
        });
    });
});

describe("Parallax scrolling — Sprite2D render data", () => {
    describe("_collectRenderData includes scroll factors", () => {
        it("should include default worldScrollFactorX=1 and worldScrollFactorY=1", () => {
            const sprite = new Sprite2D("bg");
            sprite.texture = mockTexture(64, 64);
            sprite.width = 64;
            sprite.height = 64;

            const list: ISprite2DRenderData[] = [];
            sprite._collectRenderData(list, whiteTex);

            expect(list).toHaveLength(1);
            expect(list[0].scrollFactorX).toBe(1);
            expect(list[0].scrollFactorY).toBe(1);
        });

        it("should include custom worldScrollFactor in render data", () => {
            const sprite = new Sprite2D("parallax-bg");
            sprite.texture = mockTexture(128, 128);
            sprite.width = 128;
            sprite.height = 128;
            sprite.scrollFactorX = 0.3;
            sprite.scrollFactorY = 0.5;

            const list: ISprite2DRenderData[] = [];
            sprite._collectRenderData(list, whiteTex);

            expect(list).toHaveLength(1);
            expect(list[0].scrollFactorX).toBeCloseTo(0.3, 10);
            expect(list[0].scrollFactorY).toBeCloseTo(0.5, 10);
        });

        it("should include inherited worldScrollFactor in render data", () => {
            const layer = new Node2D("parallax-layer");
            layer.scrollFactorX = 0.5;
            layer.scrollFactorY = 0.8;

            const sprite = new Sprite2D("cloud");
            sprite.texture = mockTexture(32, 32);
            sprite.width = 32;
            sprite.height = 32;
            sprite.parent = layer;

            const list: ISprite2DRenderData[] = [];
            sprite._collectRenderData(list, whiteTex);

            expect(list).toHaveLength(1);
            expect(list[0].scrollFactorX).toBeCloseTo(0.5, 10);
            expect(list[0].scrollFactorY).toBeCloseTo(0.8, 10);
        });

        it("should multiply parent and sprite scroll factors in render data", () => {
            const layer = new Node2D("layer");
            layer.scrollFactorX = 0.5;
            layer.scrollFactorY = 0.5;

            const sprite = new Sprite2D("mountain");
            sprite.texture = mockTexture(64, 64);
            sprite.width = 64;
            sprite.height = 64;
            sprite.scrollFactorX = 0.6;
            sprite.scrollFactorY = 0.4;
            sprite.parent = layer;

            const list: ISprite2DRenderData[] = [];
            sprite._collectRenderData(list, whiteTex);

            expect(list).toHaveLength(1);
            expect(list[0].scrollFactorX).toBeCloseTo(0.3, 10); // 0.5 * 0.6
            expect(list[0].scrollFactorY).toBeCloseTo(0.2, 10); // 0.5 * 0.4
        });

        it("should write scrollFactor 0 for HUD-like fixed sprites", () => {
            const sprite = new Sprite2D("hud");
            sprite.texture = mockTexture(200, 50);
            sprite.width = 200;
            sprite.height = 50;
            sprite.scrollFactorX = 0;
            sprite.scrollFactorY = 0;

            const list: ISprite2DRenderData[] = [];
            sprite._collectRenderData(list, whiteTex);

            expect(list).toHaveLength(1);
            expect(list[0].scrollFactorX).toBe(0);
            expect(list[0].scrollFactorY).toBe(0);
        });
    });
});
