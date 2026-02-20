import { AStarPathfinder } from "2d/Pathfinding/aStarPathfinder";
import { Grid2D, GridTopology } from "2d/Grid/grid2D";

describe("AStarPathfinder", () => {
    // Simple 5x5 grid: all walkable
    const openGrid = () =>
        new AStarPathfinder({
            width: 5,
            height: 5,
            isWalkable: () => true,
        });

    // 5x5 grid with a wall in the middle column
    const wallGrid = () =>
        new AStarPathfinder({
            width: 5,
            height: 5,
            isWalkable: (col, row) => !(col === 2 && row >= 0 && row <= 3),
        });

    describe("findPath", () => {
        it("should find a straight path in open grid", () => {
            const pf = openGrid();
            const path = pf.findPath(0, 0, 4, 0);
            expect(path.length).toBeGreaterThan(0);
            expect(path[0]).toEqual({ col: 0, row: 0 });
            expect(path[path.length - 1]).toEqual({ col: 4, row: 0 });
        });

        it("should return single point when start equals end", () => {
            const pf = openGrid();
            const path = pf.findPath(2, 2, 2, 2);
            expect(path).toEqual([{ col: 2, row: 2 }]);
        });

        it("should navigate around a wall", () => {
            const pf = wallGrid();
            const path = pf.findPath(0, 0, 4, 0);
            expect(path.length).toBeGreaterThan(0);
            expect(path[path.length - 1]).toEqual({ col: 4, row: 0 });
            // Path should not pass through the wall
            for (const p of path) {
                const isWall = p.col === 2 && p.row >= 0 && p.row <= 3;
                expect(isWall).toBe(false);
            }
        });

        it("should return empty array when no path exists", () => {
            // Completely blocked
            const pf = new AStarPathfinder({
                width: 3,
                height: 3,
                isWalkable: (col, row) => (col === 0 && row === 0) || (col === 2 && row === 2),
            });
            const path = pf.findPath(0, 0, 2, 2);
            expect(path).toEqual([]);
        });

        it("should return empty array for out-of-bounds coordinates", () => {
            const pf = openGrid();
            expect(pf.findPath(-1, 0, 4, 0)).toEqual([]);
            expect(pf.findPath(0, 0, 10, 0)).toEqual([]);
        });

        it("should return empty array when start or end is not walkable", () => {
            const pf = new AStarPathfinder({
                width: 5,
                height: 5,
                isWalkable: (col) => col !== 0,
            });
            expect(pf.findPath(0, 0, 4, 0)).toEqual([]);
        });

        it("should support diagonal movement", () => {
            const pf = new AStarPathfinder({
                width: 5,
                height: 5,
                isWalkable: () => true,
                allowDiagonal: true,
            });
            const path = pf.findPath(0, 0, 4, 4);
            expect(path.length).toBeGreaterThan(0);
            // Diagonal should be shorter than cardinal-only
            expect(path.length).toBe(5); // Diagonal path: (0,0),(1,1),(2,2),(3,3),(4,4)
        });

        it("should respect weighted costs", () => {
            const pf = new AStarPathfinder({
                width: 5,
                height: 1,
                isWalkable: () => true,
                getCost: (col) => (col === 2 ? 100 : 1),
            });
            // With only 1 row, must go through expensive cell
            const path = pf.findPath(0, 0, 4, 0);
            expect(path.length).toBeGreaterThan(0);
        });
    });

    describe("getReachableCells", () => {
        it("should return cells within movement range", () => {
            const pf = openGrid();
            const cells = pf.getReachableCells(2, 2, 2);
            // Center + 4 adjacent + 4 at distance 2 (diamond pattern)
            expect(cells.length).toBeGreaterThan(1);
            // The center itself should be included
            expect(cells.some((c) => c.col === 2 && c.row === 2)).toBe(true);
        });

        it("should respect walls", () => {
            const pf = wallGrid();
            const cells = pf.getReachableCells(0, 0, 3);
            // Should not include cells behind the wall at col=2
            const behindWall = cells.filter((c) => c.col > 2);
            expect(behindWall).toHaveLength(0);
        });

        it("should include start cell even when it is unwalkable", () => {
            const pf = new AStarPathfinder({
                width: 5,
                height: 5,
                isWalkable: () => false,
            });
            const cells = pf.getReachableCells(0, 0, 5);
            expect(cells).toEqual([{ col: 0, row: 0, cost: 0 }]);
        });
    });

    describe("hasLineOfSight", () => {
        it("should have line of sight in open grid", () => {
            const pf = openGrid();
            expect(pf.hasLineOfSight(0, 0, 4, 4)).toBe(true);
        });

        it("should not have line of sight through walls", () => {
            const pf = wallGrid();
            expect(pf.hasLineOfSight(0, 1, 4, 1)).toBe(false);
        });

        it("should have line of sight to self", () => {
            const pf = openGrid();
            expect(pf.hasLineOfSight(2, 2, 2, 2)).toBe(true);
        });
    });
});

describe("Grid2D", () => {
    describe("Square grid", () => {
        const grid = new Grid2D(10, 10, 32, GridTopology.Square);

        it("should convert cell to world position", () => {
            const pos = grid.cellToWorld(0, 0);
            expect(pos.x).toBe(16); // center of first cell
            expect(pos.y).toBe(16);
        });

        it("should convert world to cell", () => {
            const cell = grid.worldToCell(50, 70);
            expect(cell.col).toBe(1);
            expect(cell.row).toBe(2);
        });

        it("should get 4 neighbors for interior cell", () => {
            const neighbors = grid.getNeighbors(5, 5);
            expect(neighbors).toHaveLength(4);
        });

        it("should get 2 neighbors for corner cell", () => {
            const neighbors = grid.getNeighbors(0, 0);
            expect(neighbors).toHaveLength(2);
        });

        it("should calculate Manhattan distance", () => {
            expect(grid.distance(0, 0, 3, 4)).toBe(7);
        });

        it("should get cells in range", () => {
            const cells = grid.getCellsInRange(5, 5, 1);
            expect(cells).toHaveLength(5); // center + 4 neighbors
        });

        it("should check bounds correctly", () => {
            expect(grid.inBounds(0, 0)).toBe(true);
            expect(grid.inBounds(9, 9)).toBe(true);
            expect(grid.inBounds(-1, 0)).toBe(false);
            expect(grid.inBounds(10, 0)).toBe(false);
        });

        it("should round-trip cell→world→cell", () => {
            const world = grid.cellToWorld(3, 7);
            const cell = grid.worldToCell(world.x, world.y);
            expect(cell.col).toBe(3);
            expect(cell.row).toBe(7);
        });
    });

    describe("Hex flat-top grid", () => {
        const grid = new Grid2D(8, 8, 32, GridTopology.HexFlatTop);

        it("should get 6 neighbors for interior cell", () => {
            const neighbors = grid.getNeighbors(4, 4);
            expect(neighbors).toHaveLength(6);
        });

        it("should calculate hex distance", () => {
            // Adjacent cells should be distance 1
            const d = grid.distance(4, 4, 5, 4);
            expect(d).toBe(1);
        });

        it("should round-trip cell→world→cell for hex", () => {
            const world = grid.cellToWorld(3, 3);
            const cell = grid.worldToCell(world.x, world.y);
            expect(cell.col).toBe(3);
            expect(cell.row).toBe(3);
        });
    });

    describe("Hex pointy-top grid", () => {
        const grid = new Grid2D(8, 8, 32, GridTopology.HexPointyTop);

        it("should get 6 neighbors for interior cell", () => {
            const neighbors = grid.getNeighbors(4, 4);
            expect(neighbors).toHaveLength(6);
        });

        it("should round-trip cell→world→cell", () => {
            const world = grid.cellToWorld(2, 5);
            const cell = grid.worldToCell(world.x, world.y);
            expect(cell.col).toBe(2);
            expect(cell.row).toBe(5);
        });
    });
});
