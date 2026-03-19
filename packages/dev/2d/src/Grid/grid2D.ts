import { Vector2 } from "core/Maths/math.vector";

import { Rectangle2D } from "../Math/rectangle2D";
import type { IGrid2D, IGridCoord } from "./iGrid2D";

/**
 * Supported grid topologies.
 */
export enum GridTopology {
    /**
     * Square grid.
     */
    Square = 0,
    /**
     * Hexagonal grid with flat top edges.
     */
    HexFlatTop = 1,
    /**
     * Hexagonal grid with pointy top edges.
     */
    HexPointyTop = 2,
}

/**
 * Grid coordinate utility for square and hexagonal grids.
 * Does not store game data — it is purely a coordinate converter and neighbor calculator.
 */
export class Grid2D implements IGrid2D {
    private static readonly _SQRT3 = Math.sqrt(3);

    private readonly _scratchWorld = new Vector2();

    /**
     * Grid width in cells.
     */
    public readonly width: number;

    /**
     * Grid height in cells.
     */
    public readonly height: number;

    /**
     * Cell size in pixels. For square grids this is the cell width, for hex grids the hex radius.
     */
    public readonly cellSize: number;

    /**
     * Grid topology.
     */
    public readonly topology: GridTopology;

    /**
     * Creates a new Grid2D.
     * @param width - Grid width in cells.
     * @param height - Grid height in cells.
     * @param cellSize - Cell size in pixels.
     * @param topology - Grid topology.
     */
    constructor(width: number, height: number, cellSize: number, topology: GridTopology = GridTopology.Square) {
        this.width = width;
        this.height = height;
        this.cellSize = cellSize;
        this.topology = topology;
    }

    /**
     * Returns whether a coordinate is within grid bounds.
     * @param col - Column index.
     * @param row - Row index.
     * @returns True when the coordinate is inside the grid.
     */
    public isInBounds(col: number, row: number): boolean {
        return col >= 0 && col < this.width && row >= 0 && row < this.height;
    }

    /**
     * Backward-compatible alias of {@link isInBounds}.
     * @param col - Column index.
     * @param row - Row index.
     * @returns True when the coordinate is inside the grid.
     */
    public inBounds(col: number, row: number): boolean {
        return this.isInBounds(col, row);
    }

    /**
     * Returns the valid neighboring cells.
     * Square grids return 4 neighbors by default or 8 when `diagonal` is true.
     * Hex grids always return 6 neighbors.
     * @param col - Column index.
     * @param row - Row index.
     * @param diagonal - Whether to include diagonal neighbors on square grids.
     * @returns Neighbor coordinates.
     */
    public getNeighbors(col: number, row: number, diagonal: boolean = false): IGridCoord[] {
        const neighbors: IGridCoord[] = [];

        switch (this.topology) {
            case GridTopology.Square: {
                this._appendNeighbor(neighbors, col, row - 1);
                this._appendNeighbor(neighbors, col + 1, row);
                this._appendNeighbor(neighbors, col, row + 1);
                this._appendNeighbor(neighbors, col - 1, row);

                if (diagonal) {
                    this._appendNeighbor(neighbors, col + 1, row - 1);
                    this._appendNeighbor(neighbors, col + 1, row + 1);
                    this._appendNeighbor(neighbors, col - 1, row + 1);
                    this._appendNeighbor(neighbors, col - 1, row - 1);
                }
                break;
            }

            case GridTopology.HexFlatTop: {
                if ((col & 1) === 0) {
                    this._appendNeighbor(neighbors, col + 1, row - 1);
                    this._appendNeighbor(neighbors, col + 1, row);
                    this._appendNeighbor(neighbors, col, row + 1);
                    this._appendNeighbor(neighbors, col - 1, row);
                    this._appendNeighbor(neighbors, col - 1, row - 1);
                    this._appendNeighbor(neighbors, col, row - 1);
                } else {
                    this._appendNeighbor(neighbors, col + 1, row);
                    this._appendNeighbor(neighbors, col + 1, row + 1);
                    this._appendNeighbor(neighbors, col, row + 1);
                    this._appendNeighbor(neighbors, col - 1, row + 1);
                    this._appendNeighbor(neighbors, col - 1, row);
                    this._appendNeighbor(neighbors, col, row - 1);
                }
                break;
            }

            case GridTopology.HexPointyTop: {
                if ((row & 1) === 0) {
                    this._appendNeighbor(neighbors, col, row - 1);
                    this._appendNeighbor(neighbors, col + 1, row);
                    this._appendNeighbor(neighbors, col, row + 1);
                    this._appendNeighbor(neighbors, col - 1, row + 1);
                    this._appendNeighbor(neighbors, col - 1, row);
                    this._appendNeighbor(neighbors, col - 1, row - 1);
                } else {
                    this._appendNeighbor(neighbors, col + 1, row - 1);
                    this._appendNeighbor(neighbors, col + 1, row);
                    this._appendNeighbor(neighbors, col + 1, row + 1);
                    this._appendNeighbor(neighbors, col, row + 1);
                    this._appendNeighbor(neighbors, col - 1, row);
                    this._appendNeighbor(neighbors, col, row - 1);
                }
                break;
            }
        }

        return neighbors;
    }

    /**
     * Returns the topology-aware distance between two cells.
     * @param ax - Start column.
     * @param ay - Start row.
     * @param bx - End column.
     * @param by - End row.
     * @returns Distance in cells.
     */
    public distance(ax: number, ay: number, bx: number, by: number): number {
        switch (this.topology) {
            case GridTopology.Square:
                return Math.abs(ax - bx) + Math.abs(ay - by);
            case GridTopology.HexFlatTop:
            case GridTopology.HexPointyTop: {
                const [aq, ar, as] = this._toCube(ax, ay);
                const [bq, br, bs] = this._toCube(bx, by);
                return Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(as - bs));
            }
            default:
                throw new Error("Unsupported grid topology.");
        }
    }

    /**
     * Converts a cell coordinate to world space.
     * @param col - Column index.
     * @param row - Row index.
     * @returns A newly allocated world position.
     */
    public cellToWorld(col: number, row: number): Vector2;
    /**
     * Converts a cell coordinate to world space.
     * @param col - Column index.
     * @param row - Row index.
     * @param out - Output vector.
     * @returns The output vector.
     */
    public cellToWorld(col: number, row: number, out: Vector2): Vector2;
    public cellToWorld(col: number, row: number, out?: Vector2): Vector2 {
        const result = out ?? new Vector2();

        switch (this.topology) {
            case GridTopology.Square:
                result.x = col * this.cellSize + this.cellSize / 2;
                result.y = row * this.cellSize + this.cellSize / 2;
                return result;
            case GridTopology.HexFlatTop:
                result.x = this.cellSize * 1.5 * col;
                result.y = this.cellSize * Grid2D._SQRT3 * (row + ((col & 1) === 1 ? 0.5 : 0));
                return result;
            case GridTopology.HexPointyTop:
                result.x = this.cellSize * Grid2D._SQRT3 * (col + ((row & 1) === 1 ? 0.5 : 0));
                result.y = this.cellSize * 1.5 * row;
                return result;
            default:
                throw new Error("Unsupported grid topology.");
        }
    }

    /**
     * Backward-compatible zero-allocation alias of {@link cellToWorld}.
     * @param col - Column index.
     * @param row - Row index.
     * @param result - Output vector.
     * @returns The output vector.
     */
    public cellToWorldToRef(col: number, row: number, result: Vector2): Vector2 {
        return this.cellToWorld(col, row, result);
    }

    /**
     * Converts a world position to a grid coordinate.
     * @param worldX - World X coordinate.
     * @param worldY - World Y coordinate.
     * @returns A newly allocated grid coordinate.
     */
    public worldToCell(worldX: number, worldY: number): IGridCoord;
    /**
     * Converts a world position to a grid coordinate.
     * @param worldX - World X coordinate.
     * @param worldY - World Y coordinate.
     * @param out - Output cell coordinate.
     * @returns The output cell coordinate.
     */
    public worldToCell(worldX: number, worldY: number, out: IGridCoord): IGridCoord;
    public worldToCell(worldX: number, worldY: number, out?: IGridCoord): IGridCoord {
        const result = out ?? { col: 0, row: 0 };

        switch (this.topology) {
            case GridTopology.Square:
                result.col = Math.floor(worldX / this.cellSize);
                result.row = Math.floor(worldY / this.cellSize);
                return result;
            case GridTopology.HexFlatTop: {
                const approxCol = worldX / (this.cellSize * 1.5);
                const approxRow = worldY / (this.cellSize * Grid2D._SQRT3) - ((Math.round(approxCol) & 1) === 1 ? 0.5 : 0);
                return this._nearestHexFlatTop(worldX, worldY, Math.round(approxCol), Math.round(approxRow), result);
            }
            case GridTopology.HexPointyTop: {
                const approxRow = worldY / (this.cellSize * 1.5);
                const approxCol = worldX / (this.cellSize * Grid2D._SQRT3) - ((Math.round(approxRow) & 1) === 1 ? 0.5 : 0);
                return this._nearestHexPointyTop(worldX, worldY, Math.round(approxCol), Math.round(approxRow), result);
            }
            default:
                throw new Error("Unsupported grid topology.");
        }
    }

    /**
     * Returns the world-space bounds of a cell.
     * @param col - Column index.
     * @param row - Row index.
     * @param out - Output rectangle.
     * @returns The output rectangle.
     */
    public cellBounds(col: number, row: number, out: Rectangle2D): Rectangle2D {
        switch (this.topology) {
            case GridTopology.Square:
                out.x = col * this.cellSize;
                out.y = row * this.cellSize;
                out.width = this.cellSize;
                out.height = this.cellSize;
                return out;
            case GridTopology.HexFlatTop: {
                const center = this.cellToWorld(col, row, this._scratchWorld);
                out.x = center.x - this.cellSize;
                out.y = center.y - (Grid2D._SQRT3 * this.cellSize) / 2;
                out.width = this.cellSize * 2;
                out.height = Grid2D._SQRT3 * this.cellSize;
                return out;
            }
            case GridTopology.HexPointyTop: {
                const center = this.cellToWorld(col, row, this._scratchWorld);
                out.x = center.x - (Grid2D._SQRT3 * this.cellSize) / 2;
                out.y = center.y - this.cellSize;
                out.width = Grid2D._SQRT3 * this.cellSize;
                out.height = this.cellSize * 2;
                return out;
            }
            default:
                throw new Error("Unsupported grid topology.");
        }
    }

    /**
     * Returns all cells within a given grid distance from a center cell.
     * @param col - Center column.
     * @param row - Center row.
     * @param steps - Maximum distance in cells.
     * @returns Cells within range.
     */
    public getCellsInRange(col: number, row: number, steps: number): IGridCoord[] {
        const results: IGridCoord[] = [];

        if (steps < 0) {
            return results;
        }

        switch (this.topology) {
            case GridTopology.Square:
                for (let dr = -steps; dr <= steps; dr++) {
                    const rowSteps = steps - Math.abs(dr);
                    for (let dc = -rowSteps; dc <= rowSteps; dc++) {
                        this._appendNeighbor(results, col + dc, row + dr);
                    }
                }
                break;
            case GridTopology.HexFlatTop:
            case GridTopology.HexPointyTop: {
                const [cq, cr, cs] = this._toCube(col, row);
                for (let dq = -steps; dq <= steps; dq++) {
                    const minDr = Math.max(-steps, -dq - steps);
                    const maxDr = Math.min(steps, -dq + steps);
                    for (let dr = minDr; dr <= maxDr; dr++) {
                        const ds = -dq - dr;
                        const coord = this._fromCube(cq + dq, cr + dr, cs + ds);
                        if (this.isInBounds(coord.col, coord.row)) {
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
     * Returns all cells on the ring at exactly `steps` distance.
     * @param col - Center column.
     * @param row - Center row.
     * @param steps - Ring radius.
     * @returns Cells on the ring.
     */
    public getCellsOnRing(col: number, row: number, steps: number): IGridCoord[] {
        if (steps < 0) {
            return [];
        }

        if (steps === 0) {
            return this.isInBounds(col, row) ? [{ col, row }] : [];
        }

        return this.getCellsInRange(col, row, steps).filter((coord) => this.distance(col, row, coord.col, coord.row) === steps);
    }

    /**
     * Returns the cells on the line from one cell to another.
     * @param ax - Start column.
     * @param ay - Start row.
     * @param bx - End column.
     * @param by - End row.
     * @returns Cells on the line.
     */
    public getLine(ax: number, ay: number, bx: number, by: number): IGridCoord[] {
        if (this.topology === GridTopology.Square) {
            return this._getSquareLine(ax, ay, bx, by);
        }

        return this._getHexLine(ax, ay, bx, by);
    }

    private _appendNeighbor(results: IGridCoord[], col: number, row: number): void {
        if (this.isInBounds(col, row)) {
            results.push({ col, row });
        }
    }

    private _toCube(col: number, row: number): [number, number, number] {
        if (this.topology === GridTopology.HexFlatTop) {
            const q = col;
            const s = row - ((col - (col & 1)) >> 1);
            const r = -q - s;
            return [q, r, s];
        }

        const s = row;
        const q = col - ((row - (row & 1)) >> 1);
        const r = -q - s;
        return [q, r, s];
    }

    private _fromCube(q: number, r: number, s: number): IGridCoord {
        if (this.topology === GridTopology.HexFlatTop) {
            return {
                col: q,
                row: s + ((q - (q & 1)) >> 1),
            };
        }

        return {
            col: q + ((s - (s & 1)) >> 1),
            row: s,
        };
    }

    private _fromRoundedCube(q: number, r: number, s: number): IGridCoord {
        let rq = Math.round(q);
        let rr = Math.round(r);
        let rs = Math.round(s);

        const qDiff = Math.abs(rq - q);
        const rDiff = Math.abs(rr - r);
        const sDiff = Math.abs(rs - s);

        if (qDiff > rDiff && qDiff > sDiff) {
            rq = -rr - rs;
        } else if (rDiff > sDiff) {
            rr = -rq - rs;
        } else {
            rs = -rq - rr;
        }

        return this._fromCube(rq, rr, rs);
    }

    private _nearestHexFlatTop(worldX: number, worldY: number, approxCol: number, approxRow: number, out: IGridCoord): IGridCoord {
        let bestCol = approxCol;
        let bestRow = approxRow;
        let bestDistanceSq = Number.POSITIVE_INFINITY;

        for (let dc = -1; dc <= 1; dc++) {
            for (let dr = -1; dr <= 1; dr++) {
                const testCol = approxCol + dc;
                const testRow = approxRow + dr;
                this.cellToWorld(testCol, testRow, this._scratchWorld);
                const dx = worldX - this._scratchWorld.x;
                const dy = worldY - this._scratchWorld.y;
                const distanceSq = dx * dx + dy * dy;
                if (distanceSq < bestDistanceSq) {
                    bestDistanceSq = distanceSq;
                    bestCol = testCol;
                    bestRow = testRow;
                }
            }
        }

        out.col = bestCol;
        out.row = bestRow;
        return out;
    }

    private _nearestHexPointyTop(worldX: number, worldY: number, approxCol: number, approxRow: number, out: IGridCoord): IGridCoord {
        let bestCol = approxCol;
        let bestRow = approxRow;
        let bestDistanceSq = Number.POSITIVE_INFINITY;

        for (let dc = -1; dc <= 1; dc++) {
            for (let dr = -1; dr <= 1; dr++) {
                const testCol = approxCol + dc;
                const testRow = approxRow + dr;
                this.cellToWorld(testCol, testRow, this._scratchWorld);
                const dx = worldX - this._scratchWorld.x;
                const dy = worldY - this._scratchWorld.y;
                const distanceSq = dx * dx + dy * dy;
                if (distanceSq < bestDistanceSq) {
                    bestDistanceSq = distanceSq;
                    bestCol = testCol;
                    bestRow = testRow;
                }
            }
        }

        out.col = bestCol;
        out.row = bestRow;
        return out;
    }

    private _getSquareLine(ax: number, ay: number, bx: number, by: number): IGridCoord[] {
        const results: IGridCoord[] = [];
        let col = ax;
        let row = ay;
        const deltaCol = Math.abs(bx - ax);
        const stepCol = ax < bx ? 1 : -1;
        const deltaRow = -Math.abs(by - ay);
        const stepRow = ay < by ? 1 : -1;
        let error = deltaCol + deltaRow;

        while (true) {
            if (this.isInBounds(col, row)) {
                results.push({ col, row });
            }

            if (col === bx && row === by) {
                break;
            }

            const error2 = 2 * error;
            if (error2 >= deltaRow) {
                error += deltaRow;
                col += stepCol;
            }
            if (error2 <= deltaCol) {
                error += deltaCol;
                row += stepRow;
            }
        }

        return results;
    }

    private _getHexLine(ax: number, ay: number, bx: number, by: number): IGridCoord[] {
        const results: IGridCoord[] = [];
        const steps = this.distance(ax, ay, bx, by);
        const [aq, ar, as] = this._toCube(ax, ay);
        const [bq, br, bs] = this._toCube(bx, by);

        for (let i = 0; i <= steps; i++) {
            const t = steps === 0 ? 0 : i / steps;
            const coord = this._fromRoundedCube(aq + (bq - aq) * t, ar + (br - ar) * t, as + (bs - as) * t);
            const last = results[results.length - 1];
            if (this.isInBounds(coord.col, coord.row) && (!last || last.col !== coord.col || last.row !== coord.row)) {
                results.push(coord);
            }
        }

        return results;
    }
}

