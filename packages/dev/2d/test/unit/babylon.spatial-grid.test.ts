import { Node2D } from "2d/Node2D/node2D";
import { BoxCollider2D, CircleCollider2D, PolygonCollider2D } from "2d/Collision/collisionShapes";
import { SpatialGrid } from "2d/Collision/spatialGrid";
import type { ICollisionEntry } from "2d/Collision/spatialGrid";
import { Vector2 } from "core/Maths/math.vector";

describe("SpatialGrid", () => {
    let grid: SpatialGrid;

    beforeEach(() => {
        grid = new SpatialGrid(64);
    });

    function makeEntry(name: string, x: number, y: number, shapes: any[], layer: number = 1, mask: number = 0xffffffff): ICollisionEntry {
        const node = new Node2D(name);
        node.position = new Vector2(x, y);
        return { node, shapes, layer, mask };
    }

    describe("insert and queryPoint", () => {
        it("should find box collider at point", () => {
            const entry = makeEntry("box", 100, 100, [new BoxCollider2D(32, 32)]);
            grid.insert(entry);

            const results = grid.queryPoint(100, 100);
            expect(results).toHaveLength(1);
            expect(results[0].node.name).toBe("box");
        });

        it("should not find box when point is outside", () => {
            const entry = makeEntry("box", 100, 100, [new BoxCollider2D(32, 32)]);
            grid.insert(entry);

            const results = grid.queryPoint(500, 500);
            expect(results).toHaveLength(0);
        });

        it("should find circle collider at point", () => {
            const entry = makeEntry("circle", 200, 200, [new CircleCollider2D(20)]);
            grid.insert(entry);

            const results = grid.queryPoint(205, 200);
            expect(results).toHaveLength(1);
        });

        it("should not find circle when point is outside", () => {
            const entry = makeEntry("circle", 200, 200, [new CircleCollider2D(5)]);
            grid.insert(entry);

            const results = grid.queryPoint(220, 220);
            expect(results).toHaveLength(0);
        });

        it("should respect layer mask filtering", () => {
            const entry = makeEntry("box", 100, 100, [new BoxCollider2D(50, 50)], 2);
            grid.insert(entry);

            // Query with mask that doesn't match layer 2
            const noHit = grid.queryPoint(100, 100, 4);
            expect(noHit).toHaveLength(0);

            // Query with mask that matches layer 2
            const hit = grid.queryPoint(100, 100, 2);
            expect(hit).toHaveLength(1);
        });
    });

    describe("queryBox", () => {
        it("should find entries overlapping query box", () => {
            const e1 = makeEntry("a", 50, 50, [new BoxCollider2D(30, 30)]);
            const e2 = makeEntry("b", 200, 200, [new BoxCollider2D(30, 30)]);
            grid.insert(e1);
            grid.insert(e2);

            // Query a box that overlaps "a" but not "b"
            const results = grid.queryBox(50, 50, 40, 40);
            expect(results.length).toBeGreaterThanOrEqual(1);
            expect(results.some((r) => r.node.name === "a")).toBe(true);
        });

        it("should return empty for non-overlapping area", () => {
            const e1 = makeEntry("a", 50, 50, [new BoxCollider2D(20, 20)]);
            grid.insert(e1);

            const results = grid.queryBox(500, 500, 10, 10);
            expect(results).toHaveLength(0);
        });
    });

    describe("queryCircle", () => {
        it("should find entries overlapping query circle", () => {
            const e1 = makeEntry("c1", 100, 100, [new CircleCollider2D(15)]);
            grid.insert(e1);

            const results = grid.queryCircle(110, 100, 20);
            expect(results.length).toBeGreaterThanOrEqual(1);
        });

        it("should not find distant entries", () => {
            const e1 = makeEntry("c1", 100, 100, [new CircleCollider2D(10)]);
            grid.insert(e1);

            const results = grid.queryCircle(500, 500, 10);
            expect(results).toHaveLength(0);
        });
    });

    describe("clear", () => {
        it("should remove all entries", () => {
            const e1 = makeEntry("a", 50, 50, [new BoxCollider2D(30, 30)]);
            grid.insert(e1);

            grid.clear();
            const results = grid.queryPoint(50, 50);
            expect(results).toHaveLength(0);
        });
    });

    describe("raycast", () => {
        it("should hit a box in the ray path", () => {
            const entry = makeEntry("wall", 200, 0, [new BoxCollider2D(40, 40)]);
            grid.insert(entry);

            const hit = grid.raycast(0, 0, 1, 0, 300);
            expect(hit).not.toBeNull();
            expect(hit!.distance).toBeLessThan(300);
        });

        it("should return null when nothing is hit", () => {
            const entry = makeEntry("wall", 200, 200, [new BoxCollider2D(20, 20)]);
            grid.insert(entry);

            // Cast in the opposite direction
            const hit = grid.raycast(0, 0, -1, 0, 100);
            expect(hit).toBeNull();
        });

        it("should return null for zero-length direction", () => {
            const entry = makeEntry("wall", 100, 0, [new BoxCollider2D(20, 20)]);
            grid.insert(entry);

            const hit = grid.raycast(0, 0, 0, 0, 200);
            expect(hit).toBeNull();
        });
    });

    describe("polygon collider in grid", () => {
        it("should insert polygon collider without error", () => {
            const poly = new PolygonCollider2D([new Vector2(-10, -10), new Vector2(10, -10), new Vector2(10, 10), new Vector2(-10, 10)]);
            const entry = makeEntry("poly", 100, 100, [poly]);
            // Should not throw
            grid.insert(entry);
        });
    });

    describe("multiple shapes per entry", () => {
        it("should find entry by any of its shapes", () => {
            const box = new BoxCollider2D(20, 20, new Vector2(-30, 0));
            const circle = new CircleCollider2D(10, new Vector2(30, 0));
            const entry = makeEntry("multi", 100, 100, [box, circle]);
            grid.insert(entry);

            // Hit the box shape (at 70, 100)
            const hitBox = grid.queryPoint(72, 100);
            expect(hitBox.length).toBeGreaterThanOrEqual(1);

            // Hit the circle shape (at 130, 100)
            const hitCircle = grid.queryPoint(128, 100);
            expect(hitCircle.length).toBeGreaterThanOrEqual(1);
        });
    });
});
