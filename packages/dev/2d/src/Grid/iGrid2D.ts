import type { Vector2 } from "core/Maths/math.vector";

/**
 * A cell coordinate in a 2D grid.
 */
export interface IGridCoord {
    /**
     * Column index
     */
    col: number;
    /**
     * Row index
     */
    row: number;
}

/**
 * Common interface for 2D grid systems.
 * Implemented by Grid2D (square/hex) and IsometricGrid (diamond/staggered).
 * Use this to write grid-agnostic algorithms (e.g., pathfinding, range queries).
 */
export interface IGrid2D {
    /**
     * Grid width in cells/tiles
     */
    readonly width: number;

    /**
     * Grid height in cells/tiles
     */
    readonly height: number;

    /**
     * Checks if a coordinate is within grid bounds
     * @param col - Column
     * @param row - Row
     * @returns True if within bounds
     */
    inBounds(col: number, row: number): boolean;

    /**
     * Gets the valid neighbors of a cell
     * @param col - Column
     * @param row - Row
     * @returns Array of neighbor coordinates
     */
    getNeighbors(col: number, row: number): IGridCoord[];

    /**
     * Converts a grid coordinate to world pixel position
     * @param col - Column
     * @param row - Row
     * @returns World position
     */
    cellToWorld(col: number, row: number): Vector2;

    /**
     * Converts a world pixel position to the nearest grid coordinate
     * @param worldX - World X position
     * @param worldY - World Y position
     * @returns Grid coordinate
     */
    worldToCell(worldX: number, worldY: number): IGridCoord;
}
