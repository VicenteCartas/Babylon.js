import { Vector2 } from "core/Maths/math.vector";

/**
 * Orientation of the isometric projection
 */
export enum IsometricOrientation {
    /**
     * Diamond / staggered isometric (Diablo, Age of Empires)
     */
    Diamond = 0,
    /**
     * Staggered columns (SimCity 2000)
     */
    Staggered = 1,
}

/**
 * Provides isometric coordinate conversion utilities.
 * Supports diamond and staggered isometric projections.
 *
 * In diamond iso, tiles are rotated 45° and scaled vertically by 0.5 (2:1 ratio).
 * The world origin is at the top of the diamond.
 */
export class IsometricGrid {
    /**
     * Tile width in pixels (the wide dimension of the diamond)
     */
    public readonly tileWidth: number;

    /**
     * Tile height in pixels (the narrow dimension of the diamond, typically tileWidth/2)
     */
    public readonly tileHeight: number;

    /**
     * Grid width in tiles
     */
    public readonly width: number;

    /**
     * Grid height in tiles
     */
    public readonly height: number;

    /**
     * Isometric orientation
     */
    public readonly orientation: IsometricOrientation;

    /**
     * Creates a new IsometricGrid
     * @param width - Grid width in tiles
     * @param height - Grid height in tiles
     * @param tileWidth - Tile width in pixels
     * @param tileHeight - Tile height in pixels (typically tileWidth/2)
     * @param orientation - Isometric orientation
     */
    constructor(
        width: number,
        height: number,
        tileWidth: number,
        tileHeight: number,
        orientation: IsometricOrientation = IsometricOrientation.Diamond
    ) {
        this.width = width;
        this.height = height;
        this.tileWidth = tileWidth;
        this.tileHeight = tileHeight;
        this.orientation = orientation;
    }

    /**
     * Converts a tile coordinate to world pixel position (center of the tile).
     * @param col - Column index
     * @param row - Row index
     * @returns World position at the tile center
     */
    public tileToWorld(col: number, row: number): Vector2 {
        if (this.orientation === IsometricOrientation.Diamond) {
            const x = (col - row) * (this.tileWidth / 2);
            const y = (col + row) * (this.tileHeight / 2);
            return new Vector2(x, y);
        } else {
            // Staggered
            const x = col * this.tileWidth + (row % 2 === 1 ? this.tileWidth / 2 : 0);
            const y = row * (this.tileHeight / 2);
            return new Vector2(x, y);
        }
    }

    /**
     * Converts a world pixel position to the nearest tile coordinate.
     * @param worldX - World X position
     * @param worldY - World Y position
     * @returns Tile coordinate (col, row)
     */
    public worldToTile(worldX: number, worldY: number): { col: number; row: number } {
        if (this.orientation === IsometricOrientation.Diamond) {
            const tw2 = this.tileWidth / 2;
            const th2 = this.tileHeight / 2;
            const col = Math.floor(worldX / tw2 + worldY / th2) / 2;
            const row = Math.floor(worldY / th2 - worldX / tw2) / 2;
            return { col: Math.round(col), row: Math.round(row) };
        } else {
            // Staggered — approximate
            const roughRow = Math.round(worldY / (this.tileHeight / 2));
            const offset = roughRow % 2 === 1 ? this.tileWidth / 2 : 0;
            const roughCol = Math.round((worldX - offset) / this.tileWidth);
            return { col: roughCol, row: roughRow };
        }
    }

    /**
     * Gets the depth (z-sort value) for a tile.
     * Higher depth = rendered later (on top).
     * For isometric, depth = col + row so tiles further from camera sort behind.
     * @param col - Column
     * @param row - Row
     * @returns A numeric depth value
     */
    public getDepth(col: number, row: number): number {
        return col + row;
    }

    /**
     * Gets all tile coordinates visible within a screen rectangle.
     * Useful for culling — only render tiles that are on screen.
     * @param screenX - Screen rectangle X (top-left)
     * @param screenY - Screen rectangle Y (top-left)
     * @param screenW - Screen rectangle width
     * @param screenH - Screen rectangle height
     * @param cameraX - Camera world X offset
     * @param cameraY - Camera world Y offset
     * @returns Array of visible tile coordinates
     */
    public getVisibleTiles(screenX: number, screenY: number, screenW: number, screenH: number, cameraX: number = 0, cameraY: number = 0): Array<{ col: number; row: number }> {
        const worldLeft = screenX + cameraX;
        const worldTop = screenY + cameraY;
        const worldRight = worldLeft + screenW;
        const worldBottom = worldTop + screenH;

        // Add margin (one tile extra on each side for safety)
        const margin = Math.max(this.tileWidth, this.tileHeight);

        const topLeft = this.worldToTile(worldLeft - margin, worldTop - margin);
        const bottomRight = this.worldToTile(worldRight + margin, worldBottom + margin);

        const minCol = Math.max(0, Math.min(topLeft.col, bottomRight.col) - 1);
        const maxCol = Math.min(this.width - 1, Math.max(topLeft.col, bottomRight.col) + 1);
        const minRow = Math.max(0, Math.min(topLeft.row, bottomRight.row) - 1);
        const maxRow = Math.min(this.height - 1, Math.max(topLeft.row, bottomRight.row) + 1);

        const tiles: Array<{ col: number; row: number }> = [];
        for (let row = minRow; row <= maxRow; row++) {
            for (let col = minCol; col <= maxCol; col++) {
                const world = this.tileToWorld(col, row);
                if (
                    world.x + this.tileWidth / 2 >= worldLeft - margin &&
                    world.x - this.tileWidth / 2 <= worldRight + margin &&
                    world.y + this.tileHeight / 2 >= worldTop - margin &&
                    world.y - this.tileHeight / 2 <= worldBottom + margin
                ) {
                    tiles.push({ col, row });
                }
            }
        }

        return tiles;
    }

    /**
     * Gets the 4 neighbors of a tile (N, E, S, W in iso space).
     * @param col - Column
     * @param row - Row
     * @returns Array of valid neighbor coordinates
     */
    public getNeighbors(col: number, row: number): Array<{ col: number; row: number }> {
        const neighbors: Array<{ col: number; row: number }> = [];
        const offsets = [
            { col: 0, row: -1 },
            { col: 1, row: 0 },
            { col: 0, row: 1 },
            { col: -1, row: 0 },
        ];
        for (const off of offsets) {
            const nc = col + off.col;
            const nr = row + off.row;
            if (nc >= 0 && nc < this.width && nr >= 0 && nr < this.height) {
                neighbors.push({ col: nc, row: nr });
            }
        }
        return neighbors;
    }

    /**
     * Checks if a coordinate is within grid bounds
     * @param col - Column
     * @param row - Row
     * @returns True if valid
     */
    public inBounds(col: number, row: number): boolean {
        return col >= 0 && col < this.width && row >= 0 && row < this.height;
    }
}
