import { NineSliceSprite2D } from "2d/NineSlice/nineSliceSprite2D";
import { Matrix2D } from "2d/Math/matrix2D";
import type { ISprite2DRenderData } from "2d/Rendering/spriteBatchRenderer";

// Mock texture with known size
function mockTexture(w: number, h: number) {
    return {
        getSize: () => ({ width: w, height: h }),
        getInternalTexture: () => null,
    } as any;
}

// Mock fallback texture
const whiteTex = mockTexture(1, 1);

describe("NineSliceSprite2D", () => {
    let sprite: NineSliceSprite2D;

    beforeEach(() => {
        sprite = new NineSliceSprite2D("panel");
        sprite.texture = mockTexture(64, 64);
        sprite.width = 200;
        sprite.height = 100;
        sprite.setBorders(16, 16, 16, 16);
    });

    describe("basic setup", () => {
        it("should extend Sprite2D", () => {
            expect(sprite.getDisplayWidth()).toBe(200);
            expect(sprite.getDisplayHeight()).toBe(100);
        });

        it("should set borders via setBorders", () => {
            sprite.setBorders(10, 20, 30, 40);
            expect(sprite.borderLeft).toBe(10);
            expect(sprite.borderRight).toBe(20);
            expect(sprite.borderTop).toBe(30);
            expect(sprite.borderBottom).toBe(40);
        });

        it("should set uniform borders", () => {
            sprite.setUniformBorders(8);
            expect(sprite.borderLeft).toBe(8);
            expect(sprite.borderRight).toBe(8);
            expect(sprite.borderTop).toBe(8);
            expect(sprite.borderBottom).toBe(8);
        });

        it("should chain setBorders", () => {
            const result = sprite.setBorders(1, 2, 3, 4);
            expect(result).toBe(sprite);
        });
    });

    describe("render data collection", () => {
        it("should produce 9 quads", () => {
            const list: ISprite2DRenderData[] = [];
            sprite._collectRenderData(list, whiteTex);
            expect(list.length).toBe(9);
        });

        it("should produce fewer quads when center has zero size", () => {
            // Panel exactly equals borders — center column and middle row are 0
            sprite.width = 32;  // borderLeft(16) + borderRight(16) = 32, center = 0
            sprite.height = 32;
            const list: ISprite2DRenderData[] = [];
            sprite._collectRenderData(list, whiteTex);
            // Only 4 corners (center col = 0, middle row = 0)
            expect(list.length).toBe(4);
        });

        it("should produce nothing for zero-size sprite", () => {
            sprite.width = 0;
            sprite.height = 0;
            sprite.texture = null;
            const list: ISprite2DRenderData[] = [];
            sprite._collectRenderData(list, whiteTex);
            expect(list.length).toBe(0);
        });

        it("should use fallback texture when no texture set", () => {
            sprite.texture = null;
            sprite.width = 100;
            sprite.height = 50;
            const list: ISprite2DRenderData[] = [];
            sprite._collectRenderData(list, whiteTex);
            for (const entry of list) {
                expect(entry.texture).toBe(whiteTex);
            }
        });
    });

    describe("corner sizes", () => {
        it("should have fixed-size corners", () => {
            const list: ISprite2DRenderData[] = [];
            sprite._collectRenderData(list, whiteTex);

            // Corners are entries 0 (TL), 2 (TR), 6 (BL), 8 (BR) in row-major order
            const tl = list[0];
            const tr = list[2];
            const bl = list[6];
            const br = list[8];

            expect(tl.width).toBe(16);
            expect(tl.height).toBe(16);
            expect(tr.width).toBe(16);
            expect(tr.height).toBe(16);
            expect(bl.width).toBe(16);
            expect(bl.height).toBe(16);
            expect(br.width).toBe(16);
            expect(br.height).toBe(16);
        });
    });

    describe("edge sizes", () => {
        it("should stretch top/bottom edges horizontally", () => {
            const list: ISprite2DRenderData[] = [];
            sprite._collectRenderData(list, whiteTex);

            const top = list[1]; // TC
            const bot = list[7]; // BC
            // Center width = 200 - 16 - 16 = 168
            expect(top.width).toBe(168);
            expect(top.height).toBe(16);
            expect(bot.width).toBe(168);
            expect(bot.height).toBe(16);
        });

        it("should stretch left/right edges vertically", () => {
            const list: ISprite2DRenderData[] = [];
            sprite._collectRenderData(list, whiteTex);

            const left = list[3]; // ML
            const right = list[5]; // MR
            // Center height = 100 - 16 - 16 = 68
            expect(left.width).toBe(16);
            expect(left.height).toBe(68);
            expect(right.width).toBe(16);
            expect(right.height).toBe(68);
        });
    });

    describe("center", () => {
        it("should stretch center in both directions", () => {
            const list: ISprite2DRenderData[] = [];
            sprite._collectRenderData(list, whiteTex);

            const center = list[4]; // MC
            expect(center.width).toBe(168); // 200 - 16 - 16
            expect(center.height).toBe(68); // 100 - 16 - 16
        });
    });

    describe("UV coordinates", () => {
        it("should compute correct UV for corners", () => {
            const list: ISprite2DRenderData[] = [];
            sprite._collectRenderData(list, whiteTex);

            // TL: source (0, 0, 16, 16) on 64×64 texture
            expect(list[0].cellU).toBeCloseTo(0);
            expect(list[0].cellV).toBeCloseTo(0);
            expect(list[0].cellW).toBeCloseTo(16 / 64);
            expect(list[0].cellH).toBeCloseTo(16 / 64);

            // BR: source (48, 48, 16, 16)
            expect(list[8].cellU).toBeCloseTo(48 / 64);
            expect(list[8].cellV).toBeCloseTo(48 / 64);
            expect(list[8].cellW).toBeCloseTo(16 / 64);
            expect(list[8].cellH).toBeCloseTo(16 / 64);
        });

        it("should compute correct UV for center", () => {
            const list: ISprite2DRenderData[] = [];
            sprite._collectRenderData(list, whiteTex);

            // MC: source (16, 16, 32, 32) on 64×64
            expect(list[4].cellU).toBeCloseTo(16 / 64);
            expect(list[4].cellV).toBeCloseTo(16 / 64);
            expect(list[4].cellW).toBeCloseTo(32 / 64);
            expect(list[4].cellH).toBeCloseTo(32 / 64);
        });
    });

    describe("border clamping", () => {
        it("should clamp borders when panel is smaller than combined borders", () => {
            sprite.width = 20;  // borders want 32 total, scale to 20
            sprite.height = 10; // borders want 32 total, scale to 10
            const list: ISprite2DRenderData[] = [];
            sprite._collectRenderData(list, whiteTex);

            // All 4 corners should exist (no center)
            expect(list.length).toBe(4);

            // Borders scaled: L=R=10 (20 * 16/32), T=B=5 (10 * 16/32)
            expect(list[0].width).toBeCloseTo(10);
            expect(list[0].height).toBeCloseTo(5);
        });
    });

    describe("asymmetric borders", () => {
        it("should handle different border sizes per side", () => {
            sprite.setBorders(8, 24, 12, 20);
            const list: ISprite2DRenderData[] = [];
            sprite._collectRenderData(list, whiteTex);

            expect(list.length).toBe(9);

            // TL: 8×12
            expect(list[0].width).toBe(8);
            expect(list[0].height).toBe(12);

            // TR: 24×12
            expect(list[2].width).toBe(24);
            expect(list[2].height).toBe(12);

            // BL: 8×20
            expect(list[6].width).toBe(8);
            expect(list[6].height).toBe(20);

            // Center: (200-8-24) × (100-12-20) = 168 × 68
            expect(list[4].width).toBe(168);
            expect(list[4].height).toBe(68);
        });
    });

    describe("world transform", () => {
        it("should offset slices from parent transform", () => {
            const list: ISprite2DRenderData[] = [];
            sprite._collectRenderData(list, whiteTex);

            // With identity parent transform, TL center is at (-92, -42)
            // (W/2=100, bL/2=8 → -100+8=-92; H/2=50, bT/2=8 → -50+8=-42)
            const tl = list[0];
            expect(tl.worldTransform.m[4]).toBeCloseTo(-92);
            expect(tl.worldTransform.m[5]).toBeCloseTo(-42);

            // BR center is at (92, 42)
            const br = list[8];
            expect(br.worldTransform.m[4]).toBeCloseTo(92);
            expect(br.worldTransform.m[5]).toBeCloseTo(42);
        });

        it("should apply parent rotation to slice positions", () => {
            // Rotate parent 90 degrees
            sprite.rotation = Math.PI / 2;
            // Force worldTransform recalculation
            const _ = sprite.worldTransform;

            const list: ISprite2DRenderData[] = [];
            sprite._collectRenderData(list, whiteTex);

            // TL local offset (-92, -42) rotated 90°: (42, -92)
            const tl = list[0];
            expect(tl.worldTransform.m[4]).toBeCloseTo(42);
            expect(tl.worldTransform.m[5]).toBeCloseTo(-92);
        });
    });
});
