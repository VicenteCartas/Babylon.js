import { SpatialGrid } from "2d/Collision/spatialGrid";
import type { ICollisionEntry } from "2d/Collision/spatialGrid";
import { BoxCollider2D, CircleCollider2D } from "2d/Collision/collisionShapes";
import { AStarPathfinder } from "2d/Pathfinding/aStarPathfinder";
import { PlanckPhysicsEngine } from "2d/Physics/planckPhysicsEngine";
import { PhysicsBodyType2D } from "2d/Physics/physicsEngine2D";
import { Node2D } from "2d/Node2D/node2D";
import { Vector2 } from "core/Maths/math.vector";

// ---------------------------------------------------------------------------
// SpatialGrid public getters
// ---------------------------------------------------------------------------

describe("SpatialGrid public getters", () => {
    describe("cellSize", () => {
        it("should return the configured cell size", () => {
            const grid = new SpatialGrid(128);
            expect(grid.cellSize).toBe(128);
        });

        it("should return default cell size when not specified", () => {
            const grid = new SpatialGrid();
            expect(grid.cellSize).toBe(128);
        });

        it("should return custom cell size", () => {
            const grid = new SpatialGrid(256);
            expect(grid.cellSize).toBe(256);
        });
    });

    describe("allEntries", () => {
        it("should return empty array initially", () => {
            const grid = new SpatialGrid(64);
            expect(grid.allEntries).toHaveLength(0);
        });

        it("should return all inserted entries", () => {
            const grid = new SpatialGrid(64);
            const node1 = new Node2D("a");
            node1.position = new Vector2(10, 10);
            const node2 = new Node2D("b");
            node2.position = new Vector2(100, 100);

            const e1: ICollisionEntry = { node: node1, shapes: [new BoxCollider2D(20, 20)], layer: 1, mask: 0xffffffff };
            const e2: ICollisionEntry = { node: node2, shapes: [new CircleCollider2D(10)], layer: 1, mask: 0xffffffff };

            grid.insert(e1);
            grid.insert(e2);

            const all = grid.allEntries;
            expect(all).toHaveLength(2);
            expect(all[0]).toBe(e1);
            expect(all[1]).toBe(e2);
        });

        it("should reflect new insertions", () => {
            const grid = new SpatialGrid(64);
            const node = new Node2D("c");
            node.position = new Vector2(0, 0);
            grid.insert({ node, shapes: [new BoxCollider2D(10, 10)], layer: 1, mask: 0xffffffff });
            expect(grid.allEntries).toHaveLength(1);
        });

        it("should be empty after clear", () => {
            const grid = new SpatialGrid(64);
            const node = new Node2D("d");
            node.position = new Vector2(50, 50);
            grid.insert({ node, shapes: [new BoxCollider2D(10, 10)], layer: 1, mask: 0xffffffff });
            expect(grid.allEntries).toHaveLength(1);

            grid.clear();
            expect(grid.allEntries).toHaveLength(0);
        });
    });

    describe("occupiedCellKeys", () => {
        it("should return no keys for empty grid", () => {
            const grid = new SpatialGrid(64);
            const keys = Array.from(grid.occupiedCellKeys);
            expect(keys).toHaveLength(0);
        });

        it("should return keys for occupied cells after insert", () => {
            const grid = new SpatialGrid(64);
            const node = new Node2D("e");
            node.position = new Vector2(32, 32);
            grid.insert({ node, shapes: [new BoxCollider2D(10, 10)], layer: 1, mask: 0xffffffff });

            const keys = Array.from(grid.occupiedCellKeys);
            expect(keys.length).toBeGreaterThan(0);
        });

        it("should return multiple keys for entries spanning multiple cells", () => {
            const grid = new SpatialGrid(64);
            const node = new Node2D("large");
            node.position = new Vector2(64, 64);
            // A 200x200 box spans multiple 64px cells
            grid.insert({ node, shapes: [new BoxCollider2D(200, 200)], layer: 1, mask: 0xffffffff });

            const keys = Array.from(grid.occupiedCellKeys);
            expect(keys.length).toBeGreaterThan(1);
        });

        it("should reflect key encoding: row * 100000 + col", () => {
            const grid = new SpatialGrid(1000); // large cells so one entry = one cell
            const node = new Node2D("f");
            node.position = new Vector2(500, 500); // cell (0, 0)
            grid.insert({ node, shapes: [new BoxCollider2D(10, 10)], layer: 1, mask: 0xffffffff });

            const keys = Array.from(grid.occupiedCellKeys);
            expect(keys).toContain(0 * 100000 + 0);
        });

        it("should be empty after clear", () => {
            const grid = new SpatialGrid(64);
            const node = new Node2D("g");
            node.position = new Vector2(32, 32);
            grid.insert({ node, shapes: [new BoxCollider2D(10, 10)], layer: 1, mask: 0xffffffff });
            grid.clear();

            const keys = Array.from(grid.occupiedCellKeys);
            expect(keys).toHaveLength(0);
        });
    });
});

// ---------------------------------------------------------------------------
// AStarPathfinder public getters
// ---------------------------------------------------------------------------

describe("AStarPathfinder public getters", () => {
    describe("gridWidth", () => {
        it("should return the configured width", () => {
            const pf = new AStarPathfinder({ width: 10, height: 5, isWalkable: () => true });
            expect(pf.gridWidth).toBe(10);
        });

        it("should return 1 for a 1-cell wide grid", () => {
            const pf = new AStarPathfinder({ width: 1, height: 1, isWalkable: () => true });
            expect(pf.gridWidth).toBe(1);
        });
    });

    describe("gridHeight", () => {
        it("should return the configured height", () => {
            const pf = new AStarPathfinder({ width: 10, height: 5, isWalkable: () => true });
            expect(pf.gridHeight).toBe(5);
        });

        it("should return 1 for a 1-cell tall grid", () => {
            const pf = new AStarPathfinder({ width: 1, height: 1, isWalkable: () => true });
            expect(pf.gridHeight).toBe(1);
        });
    });

    describe("isWalkable", () => {
        it("should delegate to the isWalkable callback", () => {
            const walkFn = jest.fn().mockReturnValue(true);
            const pf = new AStarPathfinder({ width: 5, height: 5, isWalkable: walkFn });

            expect(pf.isWalkable(3, 2)).toBe(true);
            expect(walkFn).toHaveBeenCalledWith(3, 2);
        });

        it("should return false for unwalkable cells", () => {
            const pf = new AStarPathfinder({
                width: 5,
                height: 5,
                isWalkable: (col) => col !== 2,
            });

            expect(pf.isWalkable(0, 0)).toBe(true);
            expect(pf.isWalkable(2, 0)).toBe(false);
            expect(pf.isWalkable(4, 0)).toBe(true);
        });

        it("should reflect dynamic walkability changes from callback", () => {
            let blocked = false;
            const pf = new AStarPathfinder({
                width: 5,
                height: 5,
                isWalkable: (col, row) => !(blocked && col === 1 && row === 1),
            });

            expect(pf.isWalkable(1, 1)).toBe(true);

            blocked = true;
            expect(pf.isWalkable(1, 1)).toBe(false);
        });
    });

    describe("gridWidth x gridHeight consistency", () => {
        it("should match the dimensions used for pathfinding", () => {
            const pf = new AStarPathfinder({
                width: 8,
                height: 12,
                isWalkable: () => true,
            });

            // The pathfinder should reach the extents reported by the getters
            const path = pf.findPath(0, 0, pf.gridWidth - 1, pf.gridHeight - 1);
            expect(path.length).toBeGreaterThan(0);
            expect(path[path.length - 1]).toEqual({ col: 7, row: 11 });
        });
    });
});

// ---------------------------------------------------------------------------
// PlanckPhysicsEngine public getters (getAllBodies, bodyType, shapeOptions)
// ---------------------------------------------------------------------------

describe("PlanckPhysicsEngine public getters", () => {
    let engine: PlanckPhysicsEngine;

    beforeEach(() => {
        engine = new PlanckPhysicsEngine(new Vector2(0, 980));
    });

    afterEach(() => {
        engine.dispose();
    });

    describe("getAllBodies", () => {
        it("should return empty array initially", () => {
            const bodies = engine.getAllBodies();
            expect(bodies).toHaveLength(0);
        });

        it("should return all added bodies", () => {
            const n1 = new Node2D("a");
            n1.position = new Vector2(0, 0);
            const n2 = new Node2D("b");
            n2.position = new Vector2(100, 100);

            engine.addBody(n1, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: { type: "box", width: 20, height: 20 },
            });
            engine.addBody(n2, {
                bodyType: PhysicsBodyType2D.Static,
                shape: { type: "circle", radius: 10 },
            });

            const bodies = engine.getAllBodies();
            expect(bodies).toHaveLength(2);
            expect(bodies.some((b) => b.node === n1)).toBe(true);
            expect(bodies.some((b) => b.node === n2)).toBe(true);
        });

        it("should reflect removal of bodies", () => {
            const node = new Node2D("rem");
            node.position = new Vector2(0, 0);
            const body = engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: { type: "box", width: 10, height: 10 },
            });

            expect(engine.getAllBodies()).toHaveLength(1);
            engine.removeBody(body);
            expect(engine.getAllBodies()).toHaveLength(0);
        });

        it("should return a copy, not the internal array", () => {
            const node = new Node2D("copy");
            node.position = new Vector2(0, 0);
            engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: { type: "box", width: 10, height: 10 },
            });

            const bodies1 = engine.getAllBodies();
            const bodies2 = engine.getAllBodies();
            expect(bodies1).toEqual(bodies2);
            expect(bodies1).not.toBe(bodies2); // Different array references
        });

        it("should be empty after dispose", () => {
            const node = new Node2D("disp");
            node.position = new Vector2(0, 0);
            engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: { type: "box", width: 10, height: 10 },
            });

            engine.dispose();
            expect(engine.getAllBodies()).toHaveLength(0);
        });
    });

    describe("IPhysicsBody2D.bodyType", () => {
        it("should return Dynamic for dynamic bodies", () => {
            const node = new Node2D("dyn");
            node.position = new Vector2(0, 0);
            const body = engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: { type: "box", width: 10, height: 10 },
            });
            expect(body.bodyType).toBe(PhysicsBodyType2D.Dynamic);
        });

        it("should return Static for static bodies", () => {
            const node = new Node2D("stat");
            node.position = new Vector2(0, 0);
            const body = engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Static,
                shape: { type: "circle", radius: 5 },
            });
            expect(body.bodyType).toBe(PhysicsBodyType2D.Static);
        });

        it("should return Kinematic for kinematic bodies", () => {
            const node = new Node2D("kin");
            node.position = new Vector2(0, 0);
            const body = engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Kinematic,
                shape: { type: "box", width: 10, height: 10 },
            });
            expect(body.bodyType).toBe(PhysicsBodyType2D.Kinematic);
        });
    });

    describe("IPhysicsBody2D.shapeOptions", () => {
        it("should return the box shape configuration", () => {
            const node = new Node2D("box");
            node.position = new Vector2(0, 0);
            const body = engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: { type: "box", width: 32, height: 64 },
            });

            expect(body.shapeOptions).toEqual({ type: "box", width: 32, height: 64 });
        });

        it("should return the circle shape configuration", () => {
            const node = new Node2D("circ");
            node.position = new Vector2(0, 0);
            const body = engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Static,
                shape: { type: "circle", radius: 25 },
            });

            expect(body.shapeOptions).toEqual({ type: "circle", radius: 25 });
        });

        it("should return the polygon shape configuration", () => {
            const verts = [new Vector2(-10, -10), new Vector2(10, -10), new Vector2(10, 10), new Vector2(-10, 10)];
            const node = new Node2D("poly");
            node.position = new Vector2(0, 0);
            const body = engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: { type: "polygon", vertices: verts },
            });

            expect(body.shapeOptions.type).toBe("polygon");
            if (body.shapeOptions.type === "polygon") {
                expect(body.shapeOptions.vertices).toHaveLength(4);
            }
        });

        it("should preserve the shape across physics steps", () => {
            const node = new Node2D("step");
            node.position = new Vector2(0, 0);
            const body = engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: { type: "box", width: 20, height: 20 },
            });

            engine.step(1 / 60);
            engine.step(1 / 60);

            // shapeOptions should remain the same after stepping
            expect(body.shapeOptions).toEqual({ type: "box", width: 20, height: 20 });
        });
    });

    describe("IPhysicsBody2D.node", () => {
        it("should reference the original node", () => {
            const node = new Node2D("ref");
            node.position = new Vector2(50, 50);
            const body = engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: { type: "box", width: 10, height: 10 },
            });
            expect(body.node).toBe(node);
        });
    });
});
