/**
 * A* pathfinding on a 2D grid.
 * Supports weighted nodes, diagonal movement, and custom heuristics.
 */

/**
 * Options for configuring the A* pathfinder
 */
export interface IAStarOptions {
    /**
     * Grid width in cells
     */
    width: number;
    /**
     * Grid height in cells
     */
    height: number;
    /**
     * Callback to determine if a cell is walkable.
     * Return false for walls/obstacles.
     * @param col - Column index
     * @param row - Row index
     * @returns True if walkable
     */
    isWalkable: (col: number, row: number) => boolean;
    /**
     * Optional callback to get the movement cost for entering a cell.
     * Default: 1 for all cells.
     * @param col - Column index
     * @param row - Row index
     * @returns Movement cost (higher = slower)
     */
    getCost?: (col: number, row: number) => number;
    /**
     * Whether to allow diagonal movement. Default: false
     */
    allowDiagonal?: boolean;
    /**
     * Heuristic function. Default: Manhattan (or Octile if diagonal allowed)
     * @param ax - Start column
     * @param ay - Start row
     * @param bx - End column
     * @param by - End row
     * @returns Estimated distance
     */
    heuristic?: (ax: number, ay: number, bx: number, by: number) => number;
}

/**
 * A point on the path grid
 */
export interface IPathPoint {
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
 * Internal node used during A* search
 */
interface IAStarNode {
    col: number;
    row: number;
    g: number;
    h: number;
    f: number;
    parentCol: number;
    parentRow: number;
    closed: boolean;
    opened: boolean;
}

/**
 * Manhattan distance heuristic (no diagonal movement)
 */
function heuristicManhattan(ax: number, ay: number, bx: number, by: number): number {
    return Math.abs(ax - bx) + Math.abs(ay - by);
}

/**
 * Octile distance heuristic (diagonal movement allowed)
 */
function heuristicOctile(ax: number, ay: number, bx: number, by: number): number {
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

/**
 * A* pathfinder for 2D grid-based maps.
 *
 * Usage:
 * ```typescript
 * const pathfinder = new AStarPathfinder({
 *     width: mapWidth,
 *     height: mapHeight,
 *     isWalkable: (col, row) => !tilemap.isSolid(col, row),
 *     allowDiagonal: true,
 * });
 * const path = pathfinder.findPath(0, 0, 10, 5);
 * ```
 */
export class AStarPathfinder {
    private static readonly _CARDINAL_DIRECTIONS: readonly (readonly [number, number])[] = [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
    ];

    private static readonly _ALL_DIRECTIONS: readonly (readonly [number, number])[] = [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
        [1, -1],
        [1, 1],
        [-1, 1],
        [-1, -1],
    ];

    private _width: number;
    private _height: number;
    private _isWalkable: (col: number, row: number) => boolean;
    private _getCost: (col: number, row: number) => number;
    private _allowDiagonal: boolean;
    private _heuristic: (ax: number, ay: number, bx: number, by: number) => number;

    /** Reusable node grid for findPath — avoids per-call 2D array allocation */
    private _nodeGrid: IAStarNode[][] = [];
    private _nodeGridWidth: number = 0;
    private _nodeGridHeight: number = 0;

    /** Reusable cost grid for getReachableCells */
    private _costGrid: number[][] = [];
    private _costGridWidth: number = 0;
    private _costGridHeight: number = 0;

    /**
     * Creates a new AStarPathfinder
     * @param options - Configuration options
     */
    constructor(options: IAStarOptions) {
        this._width = options.width;
        this._height = options.height;
        this._isWalkable = options.isWalkable;
        this._getCost = options.getCost ?? (() => 1);
        this._allowDiagonal = options.allowDiagonal ?? false;
        this._heuristic = options.heuristic ?? (this._allowDiagonal ? heuristicOctile : heuristicManhattan);
    }

    /**
     * Gets the grid width in cells
     */
    public get gridWidth(): number {
        return this._width;
    }

    /**
     * Gets the grid height in cells
     */
    public get gridHeight(): number {
        return this._height;
    }

    /**
     * Checks whether a particular cell is walkable
     * @param col - Column index
     * @param row - Row index
     * @returns True if the cell is walkable
     */
    public isWalkable(col: number, row: number): boolean {
        return this._isWalkable(col, row);
    }

    /**
     * Finds a path from (startCol, startRow) to (endCol, endRow).
     * @param startCol - Start column
     * @param startRow - Start row
     * @param endCol - End column
     * @param endRow - End row
     * @returns Array of path points from start to end, or empty array if no path found
     */
    public findPath(startCol: number, startRow: number, endCol: number, endRow: number): IPathPoint[] {
        // Validate bounds
        if (!this._inBounds(startCol, startRow) || !this._inBounds(endCol, endRow)) {
            return [];
        }
        if (!this._isWalkable(startCol, startRow) || !this._isWalkable(endCol, endRow)) {
            return [];
        }
        if (startCol === endCol && startRow === endRow) {
            return [{ col: startCol, row: startRow }];
        }

        // Reuse pooled node grid
        const nodes = this._ensureNodeGrid();

        // Open list (simple array, sorted by f)
        const open: IAStarNode[] = [];

        const startNode = nodes[startRow][startCol];
        startNode.g = 0;
        startNode.h = this._heuristic(startCol, startRow, endCol, endRow);
        startNode.f = startNode.h;
        startNode.opened = true;
        open.push(startNode);

        // Direction offsets
        const dirs = this._allowDiagonal ? AStarPathfinder._ALL_DIRECTIONS : AStarPathfinder._CARDINAL_DIRECTIONS;

        while (open.length > 0) {
            // Find node with lowest f
            let bestIdx = 0;
            for (let i = 1; i < open.length; i++) {
                if (open[i].f < open[bestIdx].f) {
                    bestIdx = i;
                }
            }
            const current = open[bestIdx];
            open.splice(bestIdx, 1);
            current.closed = true;

            // Reached goal
            if (current.col === endCol && current.row === endRow) {
                return this._reconstructPath(nodes, endCol, endRow);
            }

            // Expand neighbors
            for (const [dx, dy] of dirs) {
                const nc = current.col + dx;
                const nr = current.row + dy;

                if (!this._inBounds(nc, nr) || !this._isWalkable(nc, nr)) {
                    continue;
                }

                const neighbor = nodes[nr][nc];
                if (neighbor.closed) {
                    continue;
                }

                // For diagonal movement, check that we can cut corners
                if (dx !== 0 && dy !== 0) {
                    if (!this._isWalkable(current.col + dx, current.row) || !this._isWalkable(current.col, current.row + dy)) {
                        continue;
                    }
                }

                const moveCost = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
                const tentativeG = current.g + moveCost * this._getCost(nc, nr);

                if (tentativeG < neighbor.g) {
                    neighbor.g = tentativeG;
                    neighbor.h = this._heuristic(nc, nr, endCol, endRow);
                    neighbor.f = neighbor.g + neighbor.h;
                    neighbor.parentCol = current.col;
                    neighbor.parentRow = current.row;

                    if (!neighbor.opened) {
                        neighbor.opened = true;
                        open.push(neighbor);
                    }
                }
            }
        }

        // No path found
        return [];
    }

    /**
     * Gets all walkable cells reachable within a given movement range.
     * Useful for turn-based games to show movement range.
     * @param col - Starting column
     * @param row - Starting row
     * @param maxCost - Maximum movement cost
     * @returns Array of reachable cells with their costs
     */
    public getReachableCells(col: number, row: number, maxCost: number): Array<{ col: number; row: number; cost: number }> {
        if (!this._inBounds(col, row)) {
            return [];
        }

        // Reuse pooled cost grid
        const costGrid = this._ensureCostGrid();
        costGrid[row][col] = 0;

        const results: Array<{ col: number; row: number; cost: number }> = [{ col, row, cost: 0 }];
        const queue: Array<{ col: number; row: number; cost: number }> = [{ col, row, cost: 0 }];

        const dirs = this._allowDiagonal ? AStarPathfinder._ALL_DIRECTIONS : AStarPathfinder._CARDINAL_DIRECTIONS;

        while (queue.length > 0) {
            // Find lowest cost in queue
            let bestIdx = 0;
            for (let i = 1; i < queue.length; i++) {
                if (queue[i].cost < queue[bestIdx].cost) {
                    bestIdx = i;
                }
            }
            const current = queue[bestIdx];
            queue.splice(bestIdx, 1);

            for (const [dx, dy] of dirs) {
                const nc = current.col + dx;
                const nr = current.row + dy;

                if (!this._inBounds(nc, nr) || !this._isWalkable(nc, nr)) {
                    continue;
                }

                if (dx !== 0 && dy !== 0) {
                    if (!this._isWalkable(current.col + dx, current.row) || !this._isWalkable(current.col, current.row + dy)) {
                        continue;
                    }
                }

                const moveCost = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
                const newCost = current.cost + moveCost * this._getCost(nc, nr);

                if (newCost <= maxCost && newCost < costGrid[nr][nc]) {
                    costGrid[nr][nc] = newCost;
                    const cell = { col: nc, row: nr, cost: newCost };
                    results.push(cell);
                    queue.push(cell);
                }
            }
        }

        return results;
    }

    /**
     * Checks if there is a clear line of sight between two cells using Bresenham's line algorithm.
     * @param startCol - Start column
     * @param startRow - Start row
     * @param endCol - End column
     * @param endRow - End row
     * @returns True if all cells on the line are walkable
     */
    public hasLineOfSight(startCol: number, startRow: number, endCol: number, endRow: number): boolean {
        let x0 = startCol;
        let y0 = startRow;
        const x1 = endCol;
        const y1 = endRow;

        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;

        while (true) {
            if (!this._inBounds(x0, y0) || !this._isWalkable(x0, y0)) {
                return false;
            }
            if (x0 === x1 && y0 === y1) {
                return true;
            }

            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x0 += sx;
            }
            if (e2 < dx) {
                err += dx;
                y0 += sy;
            }
        }
    }

    private _ensureNodeGrid(): IAStarNode[][] {
        if (this._nodeGridWidth !== this._width || this._nodeGridHeight !== this._height) {
            this._nodeGrid = [];
            for (let r = 0; r < this._height; r++) {
                const row: IAStarNode[] = [];
                for (let c = 0; c < this._width; c++) {
                    row.push({ col: c, row: r, g: Infinity, h: 0, f: Infinity, parentCol: -1, parentRow: -1, closed: false, opened: false });
                }
                this._nodeGrid.push(row);
            }
            this._nodeGridWidth = this._width;
            this._nodeGridHeight = this._height;
        } else {
            // Reset all nodes for reuse
            for (let r = 0; r < this._height; r++) {
                for (let c = 0; c < this._width; c++) {
                    const node = this._nodeGrid[r][c];
                    node.g = Infinity;
                    node.h = 0;
                    node.f = Infinity;
                    node.parentCol = -1;
                    node.parentRow = -1;
                    node.closed = false;
                    node.opened = false;
                }
            }
        }
        return this._nodeGrid;
    }

    private _ensureCostGrid(): number[][] {
        if (this._costGridWidth !== this._width || this._costGridHeight !== this._height) {
            this._costGrid = [];
            for (let r = 0; r < this._height; r++) {
                this._costGrid.push(new Array(this._width));
            }
            this._costGridWidth = this._width;
            this._costGridHeight = this._height;
        }
        // Reset all to Infinity
        for (let r = 0; r < this._height; r++) {
            for (let c = 0; c < this._width; c++) {
                this._costGrid[r][c] = Infinity;
            }
        }
        return this._costGrid;
    }

    private _inBounds(col: number, row: number): boolean {
        return col >= 0 && col < this._width && row >= 0 && row < this._height;
    }

    private _reconstructPath(nodes: IAStarNode[][], endCol: number, endRow: number): IPathPoint[] {
        const path: IPathPoint[] = [];
        let c = endCol;
        let r = endRow;

        while (c !== -1 && r !== -1) {
            path.push({ col: c, row: r });
            const node = nodes[r][c];
            const pc = node.parentCol;
            const pr = node.parentRow;
            c = pc;
            r = pr;
        }

        path.reverse();
        return path;
    }
}
