import { Tilemap2D } from "2d/Tilemap/tilemap2D";

const mockTexture = { getSize: () => ({ width: 64, height: 64 }) } as any;

/**
 * Helper: build a minimal Tiled JSON object with animated tiles.
 */
function tiledDataWithAnimation() {
    return {
        width: 3,
        height: 2,
        tilewidth: 16,
        tileheight: 16,
        tilesets: [
            {
                firstgid: 1,
                image: "tiles.png",
                columns: 4,
                tilecount: 8,
                imagewidth: 64,
                imageheight: 32,
                tiles: [
                    {
                        // Local tile id 0 → GID 1 (water animation: 3 frames)
                        id: 0,
                        animation: [
                            { tileid: 0, duration: 200 },
                            { tileid: 1, duration: 200 },
                            { tileid: 2, duration: 200 },
                        ],
                    },
                    {
                        // Local tile id 4 → GID 5 (lava animation: 2 frames)
                        id: 4,
                        animation: [
                            { tileid: 4, duration: 500 },
                            { tileid: 5, duration: 500 },
                        ],
                    },
                ],
            },
        ],
        layers: [
            {
                type: "tilelayer",
                name: "ground",
                data: [1, 3, 5, 0, 1, 5],
                width: 3,
                height: 2,
            },
        ],
    };
}

describe("Tilemap2D - Animated Tiles", () => {
    describe("FromTiled parsing", () => {
        it("should parse tile animations from Tiled data", () => {
            const textures = new Map([["tiles.png", mockTexture]]);
            const tilemap = Tilemap2D.FromTiled(tiledDataWithAnimation(), textures);

            expect(tilemap.tileAnimations.size).toBe(2);
            expect(tilemap.tileAnimations.has(1)).toBe(true); // GID 1 (firstgid=1 + id=0)
            expect(tilemap.tileAnimations.has(5)).toBe(true); // GID 5 (firstgid=1 + id=4)
        });

        it("should compute correct frame GIDs (local tileid + firstgid)", () => {
            const textures = new Map([["tiles.png", mockTexture]]);
            const tilemap = Tilemap2D.FromTiled(tiledDataWithAnimation(), textures);

            const waterAnim = tilemap.tileAnimations.get(1)!;
            expect(waterAnim.frames.length).toBe(3);
            expect(waterAnim.frames[0].gid).toBe(1); // firstgid(1) + tileid(0)
            expect(waterAnim.frames[1].gid).toBe(2); // firstgid(1) + tileid(1)
            expect(waterAnim.frames[2].gid).toBe(3); // firstgid(1) + tileid(2)
        });

        it("should compute total duration", () => {
            const textures = new Map([["tiles.png", mockTexture]]);
            const tilemap = Tilemap2D.FromTiled(tiledDataWithAnimation(), textures);

            const waterAnim = tilemap.tileAnimations.get(1)!;
            expect(waterAnim.totalDuration).toBe(600); // 200+200+200

            const lavaAnim = tilemap.tileAnimations.get(5)!;
            expect(lavaAnim.totalDuration).toBe(1000); // 500+500
        });

        it("should initialize elapsed and currentFrame to 0", () => {
            const textures = new Map([["tiles.png", mockTexture]]);
            const tilemap = Tilemap2D.FromTiled(tiledDataWithAnimation(), textures);

            const anim = tilemap.tileAnimations.get(1)!;
            expect(anim.elapsed).toBe(0);
            expect(anim.currentFrame).toBe(0);
        });

        it("should not create animations for tilesets without tiles array", () => {
            const data = {
                width: 2,
                height: 2,
                tilewidth: 16,
                tileheight: 16,
                tilesets: [{ firstgid: 1, image: "plain.png", columns: 4, tilecount: 4, imagewidth: 64, imageheight: 16 }],
                layers: [{ type: "tilelayer", name: "bg", data: [1, 2, 3, 4], width: 2, height: 2 }],
            };
            const textures = new Map([["plain.png", mockTexture]]);
            const tilemap = Tilemap2D.FromTiled(data, textures);
            expect(tilemap.tileAnimations.size).toBe(0);
        });
    });

    describe("update()", () => {
        it("should advance elapsed time in milliseconds", () => {
            const textures = new Map([["tiles.png", mockTexture]]);
            const tilemap = Tilemap2D.FromTiled(tiledDataWithAnimation(), textures);

            tilemap.update(0.1); // 100ms
            const anim = tilemap.tileAnimations.get(1)!;
            expect(anim.elapsed).toBeCloseTo(100);
        });

        it("should advance to the second frame when time passes first frame duration", () => {
            const textures = new Map([["tiles.png", mockTexture]]);
            const tilemap = Tilemap2D.FromTiled(tiledDataWithAnimation(), textures);

            // Water: frame 0 = 200ms, frame 1 = 200ms, frame 2 = 200ms
            tilemap.update(0.25); // 250ms → should be in frame 1
            const anim = tilemap.tileAnimations.get(1)!;
            expect(anim.currentFrame).toBe(1);
        });

        it("should advance to the last frame correctly", () => {
            const textures = new Map([["tiles.png", mockTexture]]);
            const tilemap = Tilemap2D.FromTiled(tiledDataWithAnimation(), textures);

            tilemap.update(0.45); // 450ms → frame 2 (200+200=400ms boundary)
            const anim = tilemap.tileAnimations.get(1)!;
            expect(anim.currentFrame).toBe(2);
        });

        it("should wrap around to frame 0 after full cycle", () => {
            const textures = new Map([["tiles.png", mockTexture]]);
            const tilemap = Tilemap2D.FromTiled(tiledDataWithAnimation(), textures);

            tilemap.update(0.65); // 650ms → wraps to 50ms → frame 0
            const anim = tilemap.tileAnimations.get(1)!;
            expect(anim.currentFrame).toBe(0);
        });

        it("should handle multiple animation cycles", () => {
            const textures = new Map([["tiles.png", mockTexture]]);
            const tilemap = Tilemap2D.FromTiled(tiledDataWithAnimation(), textures);

            // 2.5 full cycles = 1500ms → wraps to 300ms → frame 1 (200+100)
            tilemap.update(1.5);
            const anim = tilemap.tileAnimations.get(1)!;
            expect(anim.currentFrame).toBe(1);
        });

        it("should update multiple animations independently", () => {
            const textures = new Map([["tiles.png", mockTexture]]);
            const tilemap = Tilemap2D.FromTiled(tiledDataWithAnimation(), textures);

            tilemap.update(0.3); // 300ms
            const water = tilemap.tileAnimations.get(1)!;
            const lava = tilemap.tileAnimations.get(5)!;

            // Water: 300ms → frame 1 (200ms boundary)
            expect(water.currentFrame).toBe(1);
            // Lava: 300ms → frame 0 (500ms boundary not reached)
            expect(lava.currentFrame).toBe(0);
        });

        it("should handle incremental updates", () => {
            const textures = new Map([["tiles.png", mockTexture]]);
            const tilemap = Tilemap2D.FromTiled(tiledDataWithAnimation(), textures);

            tilemap.update(0.1); // 100ms → frame 0
            tilemap.update(0.1); // 200ms → frame 0 (exactly at boundary, still < accumulated)
            tilemap.update(0.05); // 250ms → frame 1
            const anim = tilemap.tileAnimations.get(1)!;
            expect(anim.currentFrame).toBe(1);
        });
    });

    describe("getDisplayTileId()", () => {
        it("should return current animation frame GID for animated tiles", () => {
            const textures = new Map([["tiles.png", mockTexture]]);
            const tilemap = Tilemap2D.FromTiled(tiledDataWithAnimation(), textures);

            // Frame 0 initially
            expect(tilemap.getDisplayTileId(1)).toBe(1); // GID 1 → frame[0].gid = 1

            tilemap.update(0.25); // 250ms → frame 1
            expect(tilemap.getDisplayTileId(1)).toBe(2); // frame[1].gid = 2

            tilemap.update(0.2); // 450ms → frame 2
            expect(tilemap.getDisplayTileId(1)).toBe(3); // frame[2].gid = 3
        });

        it("should return the input GID unchanged for non-animated tiles", () => {
            const textures = new Map([["tiles.png", mockTexture]]);
            const tilemap = Tilemap2D.FromTiled(tiledDataWithAnimation(), textures);

            // GID 3 has no animation
            expect(tilemap.getDisplayTileId(3)).toBe(3);
            expect(tilemap.getDisplayTileId(0)).toBe(0);
        });
    });

    describe("addTileAnimation()", () => {
        it("should register a programmatic animation", () => {
            const textures = new Map([["tiles.png", mockTexture]]);
            const tilemap = Tilemap2D.FromTiled(tiledDataWithAnimation(), textures);

            tilemap.addTileAnimation(3, [
                { gid: 3, duration: 100 },
                { gid: 4, duration: 100 },
            ]);

            expect(tilemap.tileAnimations.has(3)).toBe(true);
            expect(tilemap.tileAnimations.get(3)!.totalDuration).toBe(200);
        });

        it("should work with update/getDisplayTileId", () => {
            const textures = new Map([["tiles.png", mockTexture]]);
            const tilemap = Tilemap2D.FromTiled(tiledDataWithAnimation(), textures);

            tilemap.addTileAnimation(3, [
                { gid: 3, duration: 100 },
                { gid: 4, duration: 100 },
            ]);

            expect(tilemap.getDisplayTileId(3)).toBe(3);
            tilemap.update(0.15); // 150ms → frame 1
            expect(tilemap.getDisplayTileId(3)).toBe(4);
        });
    });
});
