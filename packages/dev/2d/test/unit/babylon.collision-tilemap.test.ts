import { TestBoxBox, TestCircleCircle, TestCircleBox, TestPointBox, TestPointCircle, BoxCollider2D, CircleCollider2D, Collider2D } from "2d/Collision/collisionShapes";
import { Tilemap2D, TilemapLayer2D } from "2d/Tilemap/tilemap2D";

describe("Collision2D", () => {
    describe("box-box", () => {
        it("should detect overlapping boxes", () => {
            expect(TestBoxBox(0, 0, 10, 10, 5, 5, 10, 10)).toBe(true);
        });

        it("should detect non-overlapping boxes", () => {
            expect(TestBoxBox(0, 0, 10, 10, 100, 100, 10, 10)).toBe(false);
        });

        it("should detect touching boxes as non-overlapping", () => {
            expect(TestBoxBox(0, 0, 10, 10, 20, 0, 10, 10)).toBe(false);
        });
    });

    describe("circle-circle", () => {
        it("should detect overlapping circles", () => {
            expect(TestCircleCircle(0, 0, 10, 5, 0, 10)).toBe(true);
        });

        it("should detect non-overlapping circles", () => {
            expect(TestCircleCircle(0, 0, 5, 100, 0, 5)).toBe(false);
        });
    });

    describe("circle-box", () => {
        it("should detect circle overlapping box", () => {
            expect(TestCircleBox(15, 0, 10, 0, 0, 10, 10)).toBe(true);
        });

        it("should detect circle not overlapping box", () => {
            expect(TestCircleBox(100, 0, 5, 0, 0, 10, 10)).toBe(false);
        });
    });

    describe("point tests", () => {
        it("should detect point in box", () => {
            expect(TestPointBox(5, 5, 0, 0, 10, 10)).toBe(true);
            expect(TestPointBox(50, 50, 0, 0, 10, 10)).toBe(false);
        });

        it("should detect point in circle", () => {
            expect(TestPointCircle(3, 4, 0, 0, 10)).toBe(true);
            expect(TestPointCircle(100, 0, 0, 0, 10)).toBe(false);
        });
    });

    describe("Collider2D", () => {
        it("should create with default layer and mask", () => {
            const collider = new Collider2D([new BoxCollider2D(32, 32)]);
            expect(collider.layer).toBe(1);
            expect(collider.mask).toBe(0xffffffff);
        });

        it("should support layer/mask filtering", () => {
            const a = new Collider2D([new CircleCollider2D(10)], 1, 2);
            const b = new Collider2D([new CircleCollider2D(10)], 2, 1);

            // a can interact with layer 2 (mask=2), b is on layer 2 (layer=2) -> yes
            expect((a.mask & b.layer) !== 0).toBe(true);
            // b can interact with layer 1 (mask=1), a is on layer 1 (layer=1) -> yes
            expect((b.mask & a.layer) !== 0).toBe(true);

            const c = new Collider2D([new CircleCollider2D(10)], 4, 4);
            // a can interact with layer 4? mask=2, so no
            expect((a.mask & c.layer) !== 0).toBe(false);
        });
    });
});

describe("Tilemap2D", () => {
    it("should load from Tiled JSON format", () => {
        const tiledData = {
            width: 3,
            height: 3,
            tilewidth: 16,
            tileheight: 16,
            tilesets: [{ firstgid: 1, image: "tiles.png", columns: 4, tilecount: 16, imagewidth: 64, imageheight: 64 }],
            layers: [
                {
                    name: "ground",
                    type: "tilelayer",
                    width: 3,
                    height: 3,
                    data: [1, 2, 3, 4, 5, 6, 7, 8, 9],
                    visible: true,
                },
                {
                    name: "collision",
                    type: "tilelayer",
                    width: 3,
                    height: 3,
                    data: [0, 0, 0, 1, 1, 1, 0, 0, 0],
                    visible: true,
                    properties: [{ name: "collision", value: true }],
                },
            ],
        };

        const mockTexture = { getSize: () => ({ width: 64, height: 64 }) } as any;
        const textures = new Map([["tiles.png", mockTexture]]);

        const tilemap = Tilemap2D.FromTiled(tiledData, textures);

        expect(tilemap.width).toBe(3);
        expect(tilemap.height).toBe(3);
        expect(tilemap.tileWidth).toBe(16);
        expect(tilemap.layers).toHaveLength(2);
    });

    it("should query tiles by layer name", () => {
        const tiledData = {
            width: 2,
            height: 2,
            tilewidth: 32,
            tileheight: 32,
            tilesets: [],
            layers: [
                {
                    name: "ground",
                    type: "tilelayer",
                    width: 2,
                    height: 2,
                    data: [1, 2, 3, 4],
                },
            ],
        };

        const tilemap = Tilemap2D.FromTiled(tiledData, new Map());
        expect(tilemap.getTileAt("ground", 0, 0)).toBe(1);
        expect(tilemap.getTileAt("ground", 1, 1)).toBe(4);
        expect(tilemap.getTileAt("nonexistent", 0, 0)).toBe(0);
    });

    it("should detect solid tiles from collision layers", () => {
        const tiledData = {
            width: 2,
            height: 2,
            tilewidth: 16,
            tileheight: 16,
            tilesets: [],
            layers: [
                {
                    name: "walls",
                    type: "tilelayer",
                    width: 2,
                    height: 2,
                    data: [1, 0, 0, 1],
                    properties: [{ name: "collision", value: true }],
                },
            ],
        };

        const tilemap = Tilemap2D.FromTiled(tiledData, new Map());
        expect(tilemap.isSolid(0, 0)).toBe(true);
        expect(tilemap.isSolid(1, 0)).toBe(false);
        expect(tilemap.isSolid(1, 1)).toBe(true);
    });

    it("should convert between world and tile coordinates", () => {
        const layer = new TilemapLayer2D("test", 10, 10, []);
        const tilemap = new Tilemap2D(10, 10, 32, 32, [layer], new Map(), new Map());

        const tile = tilemap.worldToTile(50, 70);
        expect(tile.col).toBe(1);
        expect(tile.row).toBe(2);

        const world = tilemap.tileToWorld(3, 4);
        expect(world.x).toBe(96);
        expect(world.y).toBe(128);
    });
});
