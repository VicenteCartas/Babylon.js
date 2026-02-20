import { Vector2 } from "core/Maths/math.vector";

/**
 * Supported grid topologies
 */
export enum GridTopology {
    /**
     * Square grid
     */
    Square = 0,
    /**
     * Hexagonal grid (flat-top)
     */
    HexFlatTop = 1,
    /**
     * Hexagonal grid (pointy-top)
     */
    HexPointyTop = 2,
}

/**
 * A cell coordinate in the grid
 */
export interface IGridCoord {
    /**
     * Column
     */
    col: number;
    /**
     * Row
     */
    row: number;
}

/**
 * Utility class for 2D grid operations.
 * Supports square and hexagonal grids with coordinate conversion,
 * neighbor queries, distance calculations, and range queries.
 */
export class Grid2D {
    /**
     * Grid width in cells
     */
    public readonly width: number;

    /**
     * Grid height in cells
     */
    public readonly height: number;

    /**
     * Size of each cell in pixels (width for square, radius for hex)
     */
    public readonly cellSize: number;

    /**
     * Grid topology (square or hex)
     */
    public readonly topology: GridTopology;

    /**
     * Creates a new Grid2D
     * @param width - Grid width in cells
     * @param height - Grid height in cells
     * @param cellSize - Cell size in pixels
     * @param topology - Grid topology (default: Square)
     */
    constructor(width: number, height: number, cellSize: number, topology: GridTopology = GridTopology.Square) {
        this.width = width;
        this.height = height;
        this.cellSize = cellSize;
        this.topology = topology;
    }

    /**
     * Converts a grid coordinate to world pixel position (center of cell)
     * @param col - Column
     * @param row - Row
     * @returns World position of the cell center
     */
    public cellToWorld(col: number, row: number): Vector2 {
        switch (this.topology) {
            case GridTopology.Square:
                return new Vector2(col * this.cellSize + this.cellSize / 2, row * this.cellSize + this.cellSize / 2);

            case GridTopology.HexFlatTop: {
                const x = this.cellSize * 1.5 * col;
                const y = this.cellSize * Math.sqrt(3) * (row + (col % 2 === 1 ? 0.5 : 0));
                return new Vector2(x, y);
            }

            case GridTopology.HexPointyTop: {
                const x = this.cellSize * Math.sqrt(3) * (col + (row % 2 === 1 ? 0.5 : 0));
                const y = this.cellSize * 1.5 * row;
                return new Vector2(x, y);
            }
        }
    }

    /**
     * Converts a world pixel position to the nearest grid coordinate
     * @param worldX - World X position
     * @param worldY - World Y position
     * @returns Grid coordinate
     */
    public worldToCell(worldX: number, worldY: number): IGridCoord {
        switch (this.topology) {
            case GridTopology.Square:
                return {
                    col: Math.floor(worldX / this.cellSize),
                    row: Math.floor(worldY / this.cellSize),
                };

            case GridTopology.HexFlatTop: {
                // Approximate then refine
                const approxCol = worldX / (this.cellSize * 1.5);
                const approxRow = worldY / (this.cellSize * Math.sqrt(3)) - (Math.round(approxCol) % 2 === 1 ? 0.5 : 0);
                return this._nearestHexFlatTop(worldX, worldY, Math.round(approxCol), Math.round(approxRow));
            }

            case GridTopology.HexPointyTop: {
                const approxCol = worldX / (this.cellSize * Math.sqrt(3)) - (Math.round(worldY / (this.cellSize * 1.5)) % 2 === 1 ? 0.5 : 0);
                const approxRow = worldY / (this.cellSize * 1.5);
                return this._nearestHexPointyTop(worldX, worldY, Math.round(approxCol), Math.round(approxRow));
            }
        }
    }

    /**
     * Gets the neighbors of a cell
     * @param col - Column
     * @param row - Row
     * @returns Array of valid neighbor coordinates
     */
    public getNeighbors(col: number, row: number): IGridCoord[] {
        const neighbors: IGridCoord[] = [];

        switch (this.topology) {
            case GridTopology.Square: {
                const offsets = [
                    [0, -1],
                    [1, 0],
                    [0, 1],
                    [-1, 0],
                ];
                for (const [dc, dr] of offsets) {
                    const nc = col + dc;
                    const nr = row + dr;
                    if (this.inBounds(nc, nr)) {
                        neighbors.push({ col: nc, row: nr });
                    }
                }
                break;
            }

            case GridTopology.HexFlatTop: {
                const even = col % 2 === 0;
                const offsets = even
                    ? [
                          [1, -1],
                          [1, 0],
                          [0, 1],
                          [-1, 0],
                          [-1, -1],
                          [0, -1],
                      ]
                    : [
                          [1, 0],
                          [1, 1],
                          [0, 1],
                          [-1, 1],
                          [-1, 0],
                          [0, -1],
                      ];
                for (const [dc, dr] of offsets) {
                    const nc = col + dc;
                    const nr = row + dr;
                    if (this.inBounds(nc, nr)) {
                        neighbors.push({ col: nc, row: nr });
                    }
                }
                break;
            }

            case GridTopology.HexPointyTop: {
                const even = row % 2 === 0;
                const offsets = even
                    ? [
                          [0, -1],
                          [1, 0],
                          [0, 1],
                          [-1, 1],
                          [-1, 0],
                          [-1, -1],
                      ]
                    : [
                          [1, -1],
                          [1, 0],
                          [1, 1],
                          [0, 1],
                          [-1, 0],
                          [0, -1],
                      ];
                for (const [dc, dr] of offsets) {
                    const nc = col + dc;
                    const nr = row + dr;
                    if (this.inBounds(nc, nr)) {
                        neighbors.push({ col: nc, row: nr });
                    }
                }
                break;
            }
        }

        return neighbors;
    }

    /**
     * Calculates the grid distance between two cells.
     * For square grids: Manhattan distance.
     * For hex grids: hex distance.
     * @param col1 - First cell column
     * @param row1 - First cell row
     * @param col2 - Second cell column
     * @param row2 - Second cell row
     * @returns Distance in cells
     */
    public distance(col1: number, row1: number, col2: number, row2: number): number {
        switch (this.topology) {
            case GridTopology.Square:
                return Math.abs(col1 - col2) + Math.abs(row1 - row2);

            case GridTopology.HexFlatTop:
            case GridTopology.HexPointyTop: {
                const [ax, ay, az] = this._toCube(col1, row1);
                const [bx, by, bz] = this._toCube(col2, row2);
                return (Math.abs(ax - bx) + Math.abs(ay - by) + Math.abs(az - bz)) / 2;
            }
        }
    }

    /**
     * Gets all cells within a given range (inclusive) of a center cell.
     * @param col - Center column
     * @param row - Center row
     * @param range - Maximum distance in cells
     * @returns Array of cells within range
     */
    public getCellsInRange(col: number, row: number, range: number): IGridCoord[] {
        const results: IGridCoord[] = [];

        switch (this.topology) {
            case GridTopology.Square: {
                for (let dr = -range; dr <= range; dr++) {
                    for (let dc = -range; dc <= range; dc++) {
                        const nc = col + dc;
                        const nr = row + dr;
                        if (this.inBounds(nc, nr) && Math.abs(dc) + Math.abs(dr) <= range) {
                            results.push({ col: nc, row: nr });
                        }
                    }
                }
                break;
            }

            case GridTopology.HexFlatTop:
            case GridTopology.HexPointyTop: {
                const [cx, cy, cz] = this._toCube(col, row);
                for (let dx = -range; dx <= range; dx++) {
                    for (let dy = Math.max(-range, -dx - range); dy <= Math.min(range, -dx + range); dy++) {
                        const dz = -dx - dy;
                        const coord = this._fromCube(cx + dx, cy + dy, cz + dz);
                        if (this.inBounds(coord.col, coord.row)) {
                            results.push(coord);
                        }
                    }
                }
                break;
            }
        }

        return results;
    }

    /**
     * Checks if a coordinate is within grid bounds
     * @param col - Column
     * @param row - Row
     * @returns True if within bounds
     */
    public inBounds(col: number, row: number): boolean {
        return col >= 0 && col < this.width && row >= 0 && row < this.height;
    }

    // Convert offset coords to cube coords for hex grids
    private _toCube(col: number, row: number): [number, number, number] {
        if (this.topology === GridTopology.HexFlatTop) {
            const x = col;
            const z = row - (col - (col & 1)) / 2;
            const y = -x - z;
            return [x, y, z];
        } else {
            // HexPointyTop
            const x = col - (row - (row & 1)) / 2;
            const z = row;
            const y = -x - z;
            return [x, y, z];
        }
    }

    // Convert cube coords to offset coords for hex grids
    private _fromCube(x: number, y: number, _z: number): IGridCoord {
        if (this.topology === GridTopology.HexFlatTop) {
            const col = x;
            const row = _z + (x - (x & 1)) / 2;
            return { col, row };
        } else {
            // HexPointyTop
            const row = _z;
            const col = x + (_z - (_z & 1)) / 2;
            return { col, row };
        }
    }

    // Find nearest hex (flat-top) to a world position by checking neighbors
    private _nearestHexFlatTop(worldX: number, worldY: number, approxCol: number, approxRow: number): IGridCoord {
        let bestCol = approxCol;
        let bestRow = approxRow;
        let bestDistSq = Infinity;

        for (let dc = -1; dc <= 1; dc++) {
            for (let dr = -1; dr <= 1; dr++) {
                const tc = approxCol + dc;
                const tr = approxRow + dr;
                const center = this.cellToWorld(tc, tr);
                const dx = worldX - center.x;
                const dy = worldY - center.y;
                const distSq = dx * dx + dy * dy;
                if (distSq < bestDistSq) {
                    bestDistSq = distSq;
                    bestCol = tc;
                    bestRow = tr;
                }
            }
        }

        return { col: bestCol, row: bestRow };
    }

    // Find nearest hex (pointy-top) to a world position by checking neighbors
    private _nearestHexPointyTop(worldX: number, worldY: number, approxCol: number, approxRow: number): IGridCoord {
        let bestCol = approxCol;
        let bestRow = approxRow;
        let bestDistSq = Infinity;

        for (let dc = -1; dc <= 1; dc++) {
            for (let dr = -1; dr <= 1; dr++) {
                const tc = approxCol + dc;
                const tr = approxRow + dr;
                const center = this.cellToWorld(tc, tr);
                const dx = worldX - center.x;
                const dy = worldY - center.y;
                const distSq = dx * dx + dy * dy;
                if (distSq < bestDistSq) {
                    bestDistSq = distSq;
                    bestCol = tc;
                    bestRow = tr;
                }
            }
        }

        return { col: bestCol, row: bestRow };
    }
}
