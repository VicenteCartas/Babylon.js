import { Vector2 } from "core/Maths/math.vector";

import { GridTopology } from "../Grid/grid2D";
import type { IGrid2D, IGridCoord } from "../Grid/iGrid2D";

/**
 * Orientation of the isometric projection.
 */
export enum IsometricOrientation {
    /**
     * Diamond isometric projection.
     */
    Diamond = 0,
    /**
     * Staggered isometric projection.
     */
    Staggered = 1,
}

/**
 * String mode accepted by the spec-facing IsometricGrid API.
 */
export type IsometricGridMode = "diamond" | "staggered";

/**
 * Coordinate utilities for isometric (diamond) and staggered isometric grids.
 * The world origin is at the top tile of the diamond.
 */
export class IsometricGrid implements IGrid2D {
    private readonly _scratchWorld = new Vector2();

    /**
     * Grid width in tiles.
     */
    public readonly width: number;

    /**
     * Grid height in tiles.
     */
    public readonly height: number;

    /**
     * Tile width in pixels.
     */
    public readonly tileWidth: number;

    /**
     * Tile height in pixels.
     */
    public readonly tileHeight: number;

    /**
     * Primary cell size in pixels.
     */
    public readonly cellSize: number;

    /**
     * IGrid2D topology classification.
     * Isometric grids still move on a 4-neighbor square lattice in tile space.
     */
    public readonly topology = GridTopology.Square;

    /**
     * Spec-facing isometric mode.
     */
    public readonly mode: IsometricGridMode;

    /**
     * Backward-compatible enum orientation.
     */
    public readonly orientation: IsometricOrientation;

    /**
     * Creates a new IsometricGrid.
     * @param width - Grid width in tiles.
     * @param height - Grid height in tiles.
     * @param tileWidth - Tile width in pixels.
     * @param tileHeight - Tile height in pixels.
     * @param mode - String mode or backward-compatible enum orientation.
     */
    constructor(width: number, height: number, tileWidth: number, tileHeight: number, mode?: IsometricGridMode);
    /**
     * Creates a new IsometricGrid.
     * @param width - Grid width in tiles.
     * @param height - Grid height in tiles.
     * @param tileWidth - Tile width in pixels.
     * @param tileHeight - Tile height in pixels.
     * @param orientation - Backward-compatible enum orientation.
     */
    constructor(width: number, height: number, tileWidth: number, tileHeight: number, orientation: IsometricOrientation);
    constructor(width: number, height: number, tileWidth: number, tileHeight: number, modeOrOrientation: IsometricGridMode | IsometricOrientation = "diamond") {
        this.width = width;
        this.height = height;
        this.tileWidth = tileWidth;
        this.tileHeight = tileHeight;
        this.cellSize = tileWidth;
        this.mode = this._resolveMode(modeOrOrientation);
        this.orientation = this.mode === "diamond" ? IsometricOrientation.Diamond : IsometricOrientation.Staggered;
    }

    /**
     * Returns whether a tile coordinate is within bounds.
     * @param col - Column index.
     * @param row - Row index.
     * @returns True when the tile is valid.
     */
    public isInBounds(col: number, row: number): boolean {
        return col >= 0 && col < this.width && row >= 0 && row < this.height;
    }

    /**
     * Backward-compatible alias of {@link isInBounds}.
     * @param col - Column index.
     * @param row - Row index.
     * @returns True when the tile is valid.
     */
    public inBounds(col: number, row: number): boolean {
        return this.isInBounds(col, row);
    }

    /**
     * Converts tile coordinates to screen-space world position.
     * Diamond mode returns the top point of the tile rhombus.
     * @param col - Column index.
     * @param row - Row index.
     * @returns A newly allocated world position.
     */
    public tileToWorld(col: number, row: number): Vector2;
    /**
     * Converts tile coordinates to screen-space world position.
     * @param col - Column index.
     * @param row - Row index.
     * @param out - Output vector.
     * @returns The output vector.
     */
    public tileToWorld(col: number, row: number, out: Vector2): Vector2;
    public tileToWorld(col: number, row: number, out?: Vector2): Vector2 {
        const result = out ?? new Vector2();

        if (this.mode === "diamond") {
            result.x = (col - row) * (this.tileWidth / 2);
            result.y = (col + row) * (this.tileHeight / 2);
            return result;
        }

        result.x = col * this.tileWidth + ((row & 1) === 1 ? this.tileWidth / 2 : 0);
        result.y = row * (this.tileHeight / 2);
        return result;
    }

    /**
     * Converts a world position to a tile coordinate.
     * @param worldX - World X coordinate.
     * @param worldY - World Y coordinate.
     * @returns A newly allocated tile coordinate.
     */
    public worldToTile(worldX: number, worldY: number): IGridCoord;
    /**
     * Converts a world position to a tile coordinate.
     * @param worldX - World X coordinate.
     * @param worldY - World Y coordinate.
     * @param out - Output tile coordinate.
     * @returns The output tile coordinate.
     */
    public worldToTile(worldX: number, worldY: number, out: IGridCoord): IGridCoord;
    public worldToTile(worldX: number, worldY: number, out?: IGridCoord): IGridCoord {
        const result = out ?? { col: 0, row: 0 };

        if (this.mode === "diamond") {
            const halfWidth = this.tileWidth / 2;
            const halfHeight = this.tileHeight / 2;
            const approxCol = (worldX / halfWidth + worldY / halfHeight) / 2;
            const approxRow = (worldY / halfHeight - worldX / halfWidth) / 2;
            return this._resolveDiamondTile(worldX, worldY, Math.round(approxCol), Math.round(approxRow), result);
        }

        const roughRow = Math.round(worldY / (this.tileHeight / 2));
        const rowOffset = (roughRow & 1) === 1 ? this.tileWidth / 2 : 0;
        result.col = Math.round((worldX - rowOffset) / this.tileWidth);
        result.row = roughRow;
        return result;
    }

    /**
     * Returns the 4 cardinal neighbors in tile space.
     * @param col - Column index.
     * @param row - Row index.
     * @returns Neighbor coordinates.
     */
    public getNeighbors(col: number, row: number): IGridCoord[] {
        const neighbors: IGridCoord[] = [];
        const offsets: readonly (readonly [number, number])[] = [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0],
        ];

        for (const [dc, dr] of offsets) {
            const neighborCol = col + dc;
            const neighborRow = row + dr;
            if (this.isInBounds(neighborCol, neighborRow)) {
                neighbors.push({ col: neighborCol, row: neighborRow });
            }
        }

        return neighbors;
    }

    /**
     * Returns Manhattan distance in isometric tile space.
     * @param ax - Start column.
     * @param ay - Start row.
     * @param bx - End column.
     * @param by - End row.
     * @returns Distance in tiles.
     */
    public distance(ax: number, ay: number, bx: number, by: number): number {
        return Math.abs(ax - bx) + Math.abs(ay - by);
    }

    /**
     * Converts tile coordinates to world space.
     * @param col - Column index.
     * @param row - Row index.
     * @returns A newly allocated world position.
     */
    public cellToWorld(col: number, row: number): Vector2;
    /**
     * Converts tile coordinates to world space.
     * @param col - Column index.
     * @param row - Row index.
     * @param out - Output vector.
     * @returns The output vector.
     */
    public cellToWorld(col: number, row: number, out: Vector2): Vector2;
    public cellToWorld(col: number, row: number, out?: Vector2): Vector2 {
        return this.tileToWorld(col, row, out ?? new Vector2());
    }

    /**
     * Converts a world position to a tile coordinate.
     * @param worldX - World X coordinate.
     * @param worldY - World Y coordinate.
     * @returns A newly allocated tile coordinate.
     */
    public worldToCell(worldX: number, worldY: number): IGridCoord;
    /**
     * Converts a world position to a tile coordinate.
     * @param worldX - World X coordinate.
     * @param worldY - World Y coordinate.
     * @param out - Output tile coordinate.
     * @returns The output tile coordinate.
     */
    public worldToCell(worldX: number, worldY: number, out: IGridCoord): IGridCoord;
    public worldToCell(worldX: number, worldY: number, out?: IGridCoord): IGridCoord {
        return this.worldToTile(worldX, worldY, out ?? { col: 0, row: 0 });
    }

    /**
     * Returns a stable depth key for painter-style sorting.
     * @param col - Column index.
     * @param row - Row index.
     * @returns Depth value.
     */
    public getDepth(col: number, row: number): number {
        return col + row;
    }

    /**
     * Returns tiles potentially visible within a screen rectangle.
     * @param screenX - Screen-space left edge.
     * @param screenY - Screen-space top edge.
     * @param screenW - Screen-space width.
     * @param screenH - Screen-space height.
     * @param cameraX - Camera X offset.
     * @param cameraY - Camera Y offset.
     * @returns Visible tile coordinates.
     */
    public getVisibleTiles(screenX: number, screenY: number, screenW: number, screenH: number, cameraX: number = 0, cameraY: number = 0): IGridCoord[] {
        const worldLeft = screenX + cameraX;
        const worldTop = screenY + cameraY;
        const worldRight = worldLeft + screenW;
        const worldBottom = worldTop + screenH;
        const margin = Math.max(this.tileWidth, this.tileHeight);

        const topLeft = this.worldToTile(worldLeft - margin, worldTop - margin);
        const bottomRight = this.worldToTile(worldRight + margin, worldBottom + margin);

        const minCol = Math.max(0, Math.min(topLeft.col, bottomRight.col) - 1);
        const maxCol = Math.min(this.width - 1, Math.max(topLeft.col, bottomRight.col) + 1);
        const minRow = Math.max(0, Math.min(topLeft.row, bottomRight.row) - 1);
        const maxRow = Math.min(this.height - 1, Math.max(topLeft.row, bottomRight.row) + 1);

        const tiles: IGridCoord[] = [];
        for (let row = minRow; row <= maxRow; row++) {
            for (let col = minCol; col <= maxCol; col++) {
                this.tileToWorld(col, row, this._scratchWorld);
                if (
                    this._scratchWorld.x + this.tileWidth / 2 >= worldLeft - margin &&
                    this._scratchWorld.x - this.tileWidth / 2 <= worldRight + margin &&
                    this._scratchWorld.y + this.tileHeight >= worldTop - margin &&
                    this._scratchWorld.y <= worldBottom + margin
                ) {
                    tiles.push({ col, row });
                }
            }
        }

        return tiles;
    }

    private _resolveMode(modeOrOrientation: IsometricGridMode | IsometricOrientation): IsometricGridMode {
        if (modeOrOrientation === IsometricOrientation.Staggered || modeOrOrientation === "staggered") {
            return "staggered";
        }

        return "diamond";
    }

    private _resolveDiamondTile(worldX: number, worldY: number, approxCol: number, approxRow: number, out: IGridCoord): IGridCoord {
        let bestCol = approxCol;
        let bestRow = approxRow;
        let bestMetric = Number.POSITIVE_INFINITY;

        for (let dc = -1; dc <= 1; dc++) {
            for (let dr = -1; dr <= 1; dr++) {
                const testCol = approxCol + dc;
                const testRow = approxRow + dr;
                const inside = this._isPointInsideDiamond(worldX, worldY, testCol, testRow);
                this.tileToWorld(testCol, testRow, this._scratchWorld);
                const centerX = this._scratchWorld.x;
                const centerY = this._scratchWorld.y + this.tileHeight / 2;
                const dx = Math.abs(worldX - centerX) / (this.tileWidth / 2);
                const dy = Math.abs(worldY - centerY) / (this.tileHeight / 2);
                const metric = dx + dy;

                if (inside) {
                    out.col = testCol;
                    out.row = testRow;
                    return out;
                }

                if (metric < bestMetric) {
                    bestMetric = metric;
                    bestCol = testCol;
                    bestRow = testRow;
                }
            }
        }

        out.col = bestCol;
        out.row = bestRow;
        return out;
    }

    private _isPointInsideDiamond(worldX: number, worldY: number, col: number, row: number): boolean {
        this.tileToWorld(col, row, this._scratchWorld);
        const halfWidth = this.tileWidth / 2;
        const halfHeight = this.tileHeight / 2;
        const centerX = this._scratchWorld.x;
        const centerY = this._scratchWorld.y + halfHeight;
        const normalizedX = Math.abs(worldX - centerX) / halfWidth;
        const normalizedY = Math.abs(worldY - centerY) / halfHeight;
        return normalizedX + normalizedY <= 1;
    }
}
