import type { Vector2 } from "core/Maths/math.vector";

import type { GridTopology } from "./grid2D";

/**
 * A cell coordinate in a 2D grid.
 */
export interface IGridCoord {
    /**
     * Column index.
     */
    col: number;
    /**
     * Row index.
     */
    row: number;
}

/**
 * Common interface for 2D grid systems.
 * Implemented by {@link Grid2D} and {@link IsometricGrid}.
 */
export interface IGrid2D {
    /**
     * Grid width in cells or tiles.
     */
    readonly width: number;

    /**
     * Grid height in cells or tiles.
     */
    readonly height: number;

    /**
     * Primary cell size in pixels.
     * For square grids this is the cell width, for hex grids the hex radius,
     * and for isometric grids it aliases the tile width.
     */
    readonly cellSize: number;

    /**
     * Grid topology classification.
     */
    readonly topology: GridTopology;

    /**
     * Returns whether the coordinate is within the grid bounds.
     * @param col - Column index.
     * @param row - Row index.
     * @returns True when the coordinate is valid.
     */
    isInBounds(col: number, row: number): boolean;

    /**
     * Backward-compatible alias of {@link isInBounds}.
     * @param col - Column index.
     * @param row - Row index.
     * @returns True when the coordinate is valid.
     */
    inBounds(col: number, row: number): boolean;

    /**
     * Returns the valid neighboring cells.
     * @param col - Column index.
     * @param row - Row index.
     * @returns Neighbor coordinates.
     */
    getNeighbors(col: number, row: number): IGridCoord[];

    /**
     * Returns the topology-aware grid distance between two cells.
     * @param ax - Start column.
     * @param ay - Start row.
     * @param bx - End column.
     * @param by - End row.
     * @returns Distance in cells.
     */
    distance(ax: number, ay: number, bx: number, by: number): number;

    /**
     * Converts a grid coordinate to world space.
     * @param col - Column index.
     * @param row - Row index.
     * @returns A newly allocated world position.
     */
    cellToWorld(col: number, row: number): Vector2;

    /**
     * Converts a grid coordinate to world space.
     * @param col - Column index.
     * @param row - Row index.
     * @param out - Output vector.
     * @returns The output vector.
     */
    cellToWorld(col: number, row: number, out: Vector2): Vector2;

    /**
     * Converts a world position to a grid coordinate.
     * @param worldX - World X coordinate.
     * @param worldY - World Y coordinate.
     * @returns A newly allocated cell coordinate.
     */
    worldToCell(worldX: number, worldY: number): IGridCoord;

    /**
     * Converts a world position to a grid coordinate.
     * @param worldX - World X coordinate.
     * @param worldY - World Y coordinate.
     * @param out - Output cell coordinate.
     * @returns The output cell coordinate.
     */
    worldToCell(worldX: number, worldY: number, out: IGridCoord): IGridCoord;
}
