import { Sprite2D } from "2d/Sprite2D/sprite2D";
import { Rectangle2D } from "2d/Math/rectangle2D";
import { Color4 } from "core/Maths/math.color";
import { Constants } from "core/Engines/constants";

const mockTexture = (w: number, h: number) => ({ getSize: () => ({ width: w, height: h }) }) as any;

describe("Sprite2D", () => {
    describe("constructor", () => {
        it("should create with a name", () => {
            const s = new Sprite2D("hero");
            expect(s.name).toBe("hero");
            expect(s.texture).toBeNull();
        });

        it("should accept an optional texture", () => {
            const tex = mockTexture(64, 64);
            const s = new Sprite2D("hero");
            s.texture = tex;
            expect(s.texture).toBe(tex);
        });
    });

    describe("default properties", () => {
        it("should have white tint", () => {
            const s = new Sprite2D("s");
            expect(s.tint).toEqual(new Color4(1, 1, 1, 1));
        });

        it("should not flip by default", () => {
            const s = new Sprite2D("s");
            expect(s.flipX).toBe(false);
            expect(s.flipY).toBe(false);
        });

        it("should use ALPHA_COMBINE by default", () => {
            const s = new Sprite2D("s");
            expect(s.alphaMode).toBe(Constants.ALPHA_COMBINE);
        });

        it("should have zero width and height by default", () => {
            const s = new Sprite2D("s");
            expect(s.width).toBe(0);
            expect(s.height).toBe(0);
        });

        it("should have null sourceRect by default", () => {
            const s = new Sprite2D("s");
            expect(s.sourceRect).toBeNull();
        });
    });

    describe("getDisplayWidth / getDisplayHeight", () => {
        it("should return explicit width/height when set", () => {
            const s = new Sprite2D("s");
            s.width = 100;
            s.height = 50;
            expect(s.getDisplayWidth()).toBe(100);
            expect(s.getDisplayHeight()).toBe(50);
        });

        it("should fall back to sourceRect dimensions", () => {
            const s = new Sprite2D("s");
            s.sourceRect = new Rectangle2D(10, 20, 48, 32);
            expect(s.getDisplayWidth()).toBe(48);
            expect(s.getDisplayHeight()).toBe(32);
        });

        it("should fall back to texture size", () => {
            const s = new Sprite2D("s");
            s.texture = mockTexture(128, 256);
            expect(s.getDisplayWidth()).toBe(128);
            expect(s.getDisplayHeight()).toBe(256);
        });

        it("should return 0 when no size info available", () => {
            const s = new Sprite2D("s");
            expect(s.getDisplayWidth()).toBe(0);
            expect(s.getDisplayHeight()).toBe(0);
        });

        it("should prioritize explicit width over sourceRect and texture", () => {
            const s = new Sprite2D("s");
            s.texture = mockTexture(128, 128);
            s.sourceRect = new Rectangle2D(0, 0, 64, 64);
            s.width = 32;
            s.height = 16;
            expect(s.getDisplayWidth()).toBe(32);
            expect(s.getDisplayHeight()).toBe(16);
        });
    });

    describe("getSourceUV", () => {
        it("should return full UV when no sourceRect", () => {
            const s = new Sprite2D("s");
            expect(s.getSourceUV()).toEqual([0, 0, 1, 1]);
        });

        it("should return full UV when no texture", () => {
            const s = new Sprite2D("s");
            s.sourceRect = new Rectangle2D(10, 10, 32, 32);
            expect(s.getSourceUV()).toEqual([0, 0, 1, 1]);
        });

        it("should compute normalized UVs from sourceRect and texture size", () => {
            const s = new Sprite2D("s");
            s.texture = mockTexture(128, 64);
            s.sourceRect = new Rectangle2D(32, 16, 64, 32);
            const uv = s.getSourceUV();
            expect(uv[0]).toBeCloseTo(32 / 128); // u
            expect(uv[1]).toBeCloseTo(16 / 64);  // v
            expect(uv[2]).toBeCloseTo(64 / 128); // uWidth
            expect(uv[3]).toBeCloseTo(32 / 64);  // vHeight
        });

        it("should return full UV for zero-size texture", () => {
            const s = new Sprite2D("s");
            s.texture = mockTexture(0, 0);
            s.sourceRect = new Rectangle2D(0, 0, 32, 32);
            expect(s.getSourceUV()).toEqual([0, 0, 1, 1]);
        });
    });

    describe("Node2D inheritance", () => {
        it("should support position, rotation, scale", () => {
            const s = new Sprite2D("s");
            s.position.x = 100;
            s.position.y = 200;
            s.rotation = Math.PI / 4;
            s.scale.x = 2;
            expect(s.position.x).toBe(100);
            expect(s.rotation).toBe(Math.PI / 4);
            expect(s.scale.x).toBe(2);
        });

        it("should support parent-child hierarchy", () => {
            const parent = new Sprite2D("parent");
            const child = new Sprite2D("child");
            parent.addChild(child);
            expect(child.parent).toBe(parent);
            expect(parent.children).toContain(child);
        });
    });
});
