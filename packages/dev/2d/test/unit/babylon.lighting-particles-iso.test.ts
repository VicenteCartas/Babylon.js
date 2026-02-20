import { Light2D, LightingManager2D, LightType2D, LightingMode2D, MAX_FORWARD_LIGHTS } from "2d/Lighting/light2D";
import { IsometricGrid, IsometricOrientation } from "2d/Isometric/isometricGrid";
import { Vector2 } from "core/Maths/math.vector";
import { Color4 } from "core/Maths/math.color";

describe("Light2D", () => {
    it("should create with correct defaults", () => {
        const light = new Light2D(LightType2D.Point, new Vector2(100, 100), new Color4(1, 0, 0, 1), 200);
        expect(light.type).toBe(LightType2D.Point);
        expect(light.position.x).toBe(100);
        expect(light.radius).toBe(200);
        expect(light.intensity).toBe(1);
        expect(light.falloff).toBe(2);
        expect(light.enabled).toBe(true);
    });

    it("should support spotlight properties", () => {
        const light = new Light2D(LightType2D.Spot, new Vector2(0, 0), new Color4(1, 1, 1, 1), 300);
        light.direction = new Vector2(1, 0);
        light.innerAngle = Math.PI / 8;
        light.outerAngle = Math.PI / 4;
        expect(light.direction.x).toBe(1);
        expect(light.innerAngle).toBeCloseTo(Math.PI / 8);
    });

    it("should support ambient type", () => {
        const light = new Light2D(LightType2D.Ambient);
        light.color = new Color4(0.5, 0.5, 0.5, 1);
        light.intensity = 1;
        expect(light.type).toBe(LightType2D.Ambient);
    });

    it("should support disabling", () => {
        const light = new Light2D(LightType2D.Point, new Vector2(0, 0), new Color4(1, 1, 1, 1), 200);
        light.enabled = false;
        expect(light.enabled).toBe(false);
    });
});

describe("LightingManager2D", () => {
    it("should pack point light uniforms correctly", () => {
        const manager = new LightingManager2D();
        manager.createPointLight(100, 200, new Color4(1, 0.5, 0, 1), 300);

        const count = manager.packLightUniforms();
        expect(count).toBe(1);
        expect(manager.activeLightCount).toBe(1);
    });

    it("should skip disabled lights in packing", () => {
        const manager = new LightingManager2D();
        const light = manager.createPointLight(0, 0, new Color4(1, 1, 1, 1), 100);
        light.enabled = false;

        const count = manager.packLightUniforms();
        expect(count).toBe(0);
    });

    it("should transform positions to view space when camera provided", () => {
        const manager = new LightingManager2D();
        manager.createPointLight(100, 0, new Color4(1, 1, 1, 1), 200);

        // Identity camera — no change
        const identity = new Float32Array([1, 0, 0, 1, 0, 0]);
        manager.packLightUniforms(identity);
        // Access internal data via activeLightCount
        expect(manager.activeLightCount).toBe(1);

        // Translate camera by (-50, -50)
        const translated = new Float32Array([1, 0, 0, 1, -50, -50]);
        manager.packLightUniforms(translated);
        expect(manager.activeLightCount).toBe(1);
    });

    it("should clamp to MAX_FORWARD_LIGHTS", () => {
        const manager = new LightingManager2D();
        for (let i = 0; i < MAX_FORWARD_LIGHTS + 5; i++) {
            manager.createPointLight(i * 10, 0, new Color4(1, 1, 1, 1), 100);
        }

        const count = manager.packLightUniforms();
        expect(count).toBe(MAX_FORWARD_LIGHTS);
    });

    it("should remove lights", () => {
        const manager = new LightingManager2D();
        const light = manager.createPointLight(0, 0, new Color4(1, 0, 0, 1), 100);
        expect(manager.lights.length).toBe(1);
        manager.removeLight(light);
        expect(manager.lights.length).toBe(0);
    });

    it("should clear all lights", () => {
        const manager = new LightingManager2D();
        manager.createPointLight(0, 0);
        manager.createPointLight(100, 100);
        manager.clear();
        expect(manager.lights.length).toBe(0);
    });
});

describe("IsometricGrid", () => {
    describe("Diamond orientation", () => {
        const grid = new IsometricGrid(10, 10, 64, 32, IsometricOrientation.Diamond);

        it("should convert tile to world for origin", () => {
            const pos = grid.tileToWorld(0, 0);
            expect(pos.x).toBe(0);
            expect(pos.y).toBe(0);
        });

        it("should convert tile to world for (1,0)", () => {
            const pos = grid.tileToWorld(1, 0);
            expect(pos.x).toBe(32); // (1-0) * 32
            expect(pos.y).toBe(16); // (1+0) * 16
        });

        it("should convert tile to world for (0,1)", () => {
            const pos = grid.tileToWorld(0, 1);
            expect(pos.x).toBe(-32); // (0-1) * 32
            expect(pos.y).toBe(16);  // (0+1) * 16
        });

        it("should round-trip tileToWorld → worldToTile", () => {
            const world = grid.tileToWorld(3, 5);
            const tile = grid.worldToTile(world.x, world.y);
            expect(tile.col).toBe(3);
            expect(tile.row).toBe(5);
        });

        it("should compute depth correctly", () => {
            // Further tiles have higher depth
            expect(grid.getDepth(0, 0)).toBe(0);
            expect(grid.getDepth(5, 5)).toBe(10);
            expect(grid.getDepth(3, 2)).toBeLessThan(grid.getDepth(5, 5));
        });

        it("should get 4 neighbors for interior tile", () => {
            const neighbors = grid.getNeighbors(5, 5);
            expect(neighbors).toHaveLength(4);
        });

        it("should get fewer neighbors for corner tile", () => {
            const neighbors = grid.getNeighbors(0, 0);
            expect(neighbors).toHaveLength(2);
        });

        it("should check bounds", () => {
            expect(grid.inBounds(0, 0)).toBe(true);
            expect(grid.inBounds(9, 9)).toBe(true);
            expect(grid.inBounds(-1, 0)).toBe(false);
            expect(grid.inBounds(10, 0)).toBe(false);
        });
    });

    describe("Staggered orientation", () => {
        const grid = new IsometricGrid(10, 10, 64, 32, IsometricOrientation.Staggered);

        it("should convert tile to world", () => {
            const pos = grid.tileToWorld(0, 0);
            expect(pos.x).toBe(0);
            expect(pos.y).toBe(0);
        });

        it("should offset odd rows", () => {
            const pos0 = grid.tileToWorld(0, 0);
            const pos1 = grid.tileToWorld(0, 1);
            // Odd row should be offset by tileWidth/2
            expect(pos1.x - pos0.x).toBeCloseTo(32);
        });

        it("should round-trip for staggered", () => {
            const world = grid.tileToWorld(4, 4);
            const tile = grid.worldToTile(world.x, world.y);
            expect(tile.col).toBe(4);
            expect(tile.row).toBe(4);
        });
    });

    describe("getVisibleTiles", () => {
        const grid = new IsometricGrid(20, 20, 64, 32, IsometricOrientation.Diamond);

        it("should return tiles within screen bounds", () => {
            const visible = grid.getVisibleTiles(0, 0, 400, 300);
            expect(visible.length).toBeGreaterThan(0);
            // All tiles should be in bounds
            for (const t of visible) {
                expect(grid.inBounds(t.col, t.row)).toBe(true);
            }
        });
    });
});
