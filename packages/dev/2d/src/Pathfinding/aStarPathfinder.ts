/**
 * Options for configuring the A* pathfinder.
 */
export interface IAStarOptions {
    /**
     * Grid width in cells.
     */
    width: number;
    /**
     * Grid height in cells.
     */
    height: number;
    /**
     * Returns whether a cell is walkable.
     * @param col - Column index.
     * @param row - Row index.
     * @returns True when the cell can be traversed.
     */
    isWalkable: (col: number, row: number) => boolean;
    /**
     * Returns the cost for entering a cell.
     * @param col - Column index.
     * @param row - Row index.
     * @returns Movement cost.
     */
    getCost?: (col: number, row: number) => number;
    /**
     * Whether diagonal movement is allowed.
     */
    allowDiagonal?: boolean;
    /**
     * Custom heuristic function.
     * @param ax - Start column.
     * @param ay - Start row.
     * @param bx - Goal column.
     * @param by - Goal row.
     * @returns Estimated remaining cost.
     */
    heuristic?: (ax: number, ay: number, bx: number, by: number) => number;
}

/**
 * A point on a computed path.
 */
export interface IPathPoint {
    /**
     * Column index.
     */
    col: number;
    /**
     * Row index.
     */
    row: number;
}

interface IAStarNode {
    col: number;
    row: number;
    g: number;
    h: number;
    f: number;
    parentIndex: number;
    generation: number;
    opened: boolean;
    closed: boolean;
    heapIndex: number;
}

class AStarMinHeap {
    private _heap: IAStarNode[] = [];

    /**
     * Returns the number of nodes in the heap.
     */
    public get size(): number {
        return this._heap.length;
    }

    /**
     * Removes all nodes from the heap.
     */
    public clear(): void {
        for (let i = 0; i < this._heap.length; i++) {
            this._heap[i].heapIndex = -1;
        }
        this._heap.length = 0;
    }

    /**
     * Adds a node to the heap.
     * @param node - Node to insert.
     */
    public push(node: IAStarNode): void {
        node.heapIndex = this._heap.length;
        this._heap.push(node);
        this._siftUp(node.heapIndex);
    }

    /**
     * Removes and returns the lowest-cost node.
     * @returns The next node, or null when the heap is empty.
     */
    public pop(): IAStarNode | null {
        if (this._heap.length === 0) {
            return null;
        }

        const root = this._heap[0];
        const last = this._heap.pop()!;
        root.heapIndex = -1;

        if (this._heap.length > 0) {
            this._heap[0] = last;
            last.heapIndex = 0;
            this._siftDown(0);
        }

        return root;
    }

    /**
     * Updates a node whose key decreased.
     * @param node - Node to reheapify.
     */
    public update(node: IAStarNode): void {
        if (node.heapIndex < 0) {
            return;
        }

        this._siftUp(node.heapIndex);
        this._siftDown(node.heapIndex);
    }

    private _siftUp(index: number): void {
        while (index > 0) {
            const parentIndex = (index - 1) >> 1;
            if (!this._isHigherPriority(index, parentIndex)) {
                break;
            }

            this._swap(index, parentIndex);
            index = parentIndex;
        }
    }

    private _siftDown(index: number): void {
        for (;;) {
            const left = index * 2 + 1;
            const right = left + 1;
            let best = index;

            if (left < this._heap.length && this._isHigherPriority(left, best)) {
                best = left;
            }
            if (right < this._heap.length && this._isHigherPriority(right, best)) {
                best = right;
            }
            if (best === index) {
                break;
            }

            this._swap(index, best);
            index = best;
        }
    }

    private _isHigherPriority(aIndex: number, bIndex: number): boolean {
        const a = this._heap[aIndex];
        const b = this._heap[bIndex];
        if (a.f !== b.f) {
            return a.f < b.f;
        }
        if (a.h !== b.h) {
            return a.h < b.h;
        }
        return a.g > b.g;
    }

    private _swap(aIndex: number, bIndex: number): void {
        const a = this._heap[aIndex];
        const b = this._heap[bIndex];
        this._heap[aIndex] = b;
        this._heap[bIndex] = a;
        a.heapIndex = bIndex;
        b.heapIndex = aIndex;
    }
}

/**
 * Manhattan heuristic for 4-direction movement.
 * @param ax - Start column.
 * @param ay - Start row.
 * @param bx - Goal column.
 * @param by - Goal row.
 * @returns Estimated remaining cost.
 */
function heuristicManhattan(ax: number, ay: number, bx: number, by: number): number {
    return Math.abs(ax - bx) + Math.abs(ay - by);
}

/**
 * Octile heuristic for 8-direction movement.
 * @param ax - Start column.
 * @param ay - Start row.
 * @param bx - Goal column.
 * @param by - Goal row.
 * @returns Estimated remaining cost.
 */
function heuristicOctile(ax: number, ay: number, bx: number, by: number): number {
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

/**
 * A* pathfinding on a 2D grid.
 * Reusable across multiple findPath() calls — internal node pool is pre-allocated.
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
    private _nodes: IAStarNode[];
    private _openHeap = new AStarMinHeap();
    private _generation = 0;

    /**
     * Creates a new AStarPathfinder.
     * @param options - Pathfinder configuration.
     */
    constructor(options: IAStarOptions) {
        this._width = options.width;
        this._height = options.height;
        this._isWalkable = options.isWalkable;
        this._getCost = options.getCost ?? (() => 1);
        this._allowDiagonal = options.allowDiagonal ?? false;
        this._heuristic = options.heuristic ?? (this._allowDiagonal ? heuristicOctile : heuristicManhattan);
        this._nodes = new Array(this._width * this._height);

        for (let row = 0; row < this._height; row++) {
            for (let col = 0; col < this._width; col++) {
                const index = this._toIndex(col, row);
                this._nodes[index] = {
                    col,
                    row,
                    g: Number.POSITIVE_INFINITY,
                    h: 0,
                    f: Number.POSITIVE_INFINITY,
                    parentIndex: -1,
                    generation: 0,
                    opened: false,
                    closed: false,
                    heapIndex: -1,
                };
            }
        }
    }

    /**
     * Gets the grid width in cells.
     */
    public get gridWidth(): number {
        return this._width;
    }

    /**
     * Gets the grid height in cells.
     */
    public get gridHeight(): number {
        return this._height;
    }

    /**
     * Returns whether a cell is walkable.
     * @param col - Column index.
     * @param row - Row index.
     * @returns True when the cell is walkable.
     */
    public isWalkable(col: number, row: number): boolean {
        return this._inBounds(col, row) && this._isWalkable(col, row);
    }

    /**
     * Finds the shortest path from start to goal.
     * @param startCol - Start column.
     * @param startRow - Start row.
     * @param goalCol - Goal column.
     * @param goalRow - Goal row.
     * @returns Path points from start to goal, or null when no path exists.
     */
    public findPath(startCol: number, startRow: number, goalCol: number, goalRow: number): IPathPoint[] | null {
        if (!this._inBounds(startCol, startRow) || !this._inBounds(goalCol, goalRow)) {
            return null;
        }
        if (!this._isWalkable(startCol, startRow) || !this._isWalkable(goalCol, goalRow)) {
            return null;
        }
        if (startCol === goalCol && startRow === goalRow) {
            return [{ col: startCol, row: startRow }];
        }

        this._beginSearch();

        const startNode = this._getNode(startCol, startRow);
        startNode.g = 0;
        startNode.h = this._heuristic(startCol, startRow, goalCol, goalRow);
        startNode.f = startNode.h;
        startNode.parentIndex = -1;
        startNode.opened = true;
        this._openHeap.push(startNode);

        const directions = this._allowDiagonal ? AStarPathfinder._ALL_DIRECTIONS : AStarPathfinder._CARDINAL_DIRECTIONS;

        while (this._openHeap.size > 0) {
            const current = this._openHeap.pop();
            if (current === null || current.closed) {
                continue;
            }

            if (current.col === goalCol && current.row === goalRow) {
                return this._reconstructPath(current);
            }

            current.closed = true;

            for (const [dc, dr] of directions) {
                const neighborCol = current.col + dc;
                const neighborRow = current.row + dr;

                if (!this._inBounds(neighborCol, neighborRow) || !this._isWalkable(neighborCol, neighborRow)) {
                    continue;
                }

                if (dc !== 0 && dr !== 0 && !this._canTraverseDiagonal(current.col, current.row, dc, dr)) {
                    continue;
                }

                const neighbor = this._getNode(neighborCol, neighborRow);
                if (neighbor.closed) {
                    continue;
                }

                const moveCost = (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1) * this._getCost(neighborCol, neighborRow);
                const tentativeG = current.g + moveCost;

                if (!neighbor.opened || tentativeG < neighbor.g) {
                    neighbor.g = tentativeG;
                    neighbor.h = this._heuristic(neighborCol, neighborRow, goalCol, goalRow);
                    neighbor.f = neighbor.g + neighbor.h;
                    neighbor.parentIndex = this._toIndex(current.col, current.row);

                    if (!neighbor.opened) {
                        neighbor.opened = true;
                        this._openHeap.push(neighbor);
                    } else {
                        this._openHeap.update(neighbor);
                    }
                }
            }
        }

        return null;
    }

    /**
     * Tests line-of-sight between two cells using Bresenham's algorithm.
     * @param fromCol - Start column.
     * @param fromRow - Start row.
     * @param toCol - Goal column.
     * @param toRow - Goal row.
     * @returns True when all intersected cells are walkable.
     */
    public hasLineOfSight(fromCol: number, fromRow: number, toCol: number, toRow: number): boolean {
        let col = fromCol;
        let row = fromRow;
        const deltaCol = Math.abs(toCol - fromCol);
        const stepCol = fromCol < toCol ? 1 : -1;
        const deltaRow = -Math.abs(toRow - fromRow);
        const stepRow = fromRow < toRow ? 1 : -1;
        let error = deltaCol + deltaRow;

        while (true) {
            if (!this._inBounds(col, row) || !this._isWalkable(col, row)) {
                return false;
            }
            if (col === toCol && row === toRow) {
                return true;
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
    }

    /**
     * Flood-fills the grid and returns all cells reachable within the given movement budget.
     * @param col - Start column.
     * @param row - Start row.
     * @param maxSteps - Maximum travel cost.
     * @returns Map keyed by `"col,row"` with total movement cost values.
     */
    public getReachableCells(col: number, row: number, maxSteps: number): Map<string, number> {
        const reachable = new Map<string, number>();
        if (!this._inBounds(col, row)) {
            return reachable;
        }

        reachable.set(this._makeKey(col, row), 0);
        if (!this._isWalkable(col, row)) {
            return reachable;
        }

        this._beginSearch();

        const startNode = this._getNode(col, row);
        startNode.g = 0;
        startNode.h = 0;
        startNode.f = 0;
        startNode.parentIndex = -1;
        startNode.opened = true;
        this._openHeap.push(startNode);

        const directions = this._allowDiagonal ? AStarPathfinder._ALL_DIRECTIONS : AStarPathfinder._CARDINAL_DIRECTIONS;

        while (this._openHeap.size > 0) {
            const current = this._openHeap.pop();
            if (current === null || current.closed) {
                continue;
            }

            if (current.g > maxSteps) {
                continue;
            }

            current.closed = true;
            reachable.set(this._makeKey(current.col, current.row), current.g);

            for (const [dc, dr] of directions) {
                const neighborCol = current.col + dc;
                const neighborRow = current.row + dr;

                if (!this._inBounds(neighborCol, neighborRow) || !this._isWalkable(neighborCol, neighborRow)) {
                    continue;
                }

                if (dc !== 0 && dr !== 0 && !this._canTraverseDiagonal(current.col, current.row, dc, dr)) {
                    continue;
                }

                const neighbor = this._getNode(neighborCol, neighborRow);
                if (neighbor.closed) {
                    continue;
                }

                const stepCost = (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1) * this._getCost(neighborCol, neighborRow);
                const nextCost = current.g + stepCost;
                if (nextCost > maxSteps) {
                    continue;
                }

                if (!neighbor.opened || nextCost < neighbor.g) {
                    neighbor.g = nextCost;
                    neighbor.h = 0;
                    neighbor.f = nextCost;
                    neighbor.parentIndex = this._toIndex(current.col, current.row);

                    if (!neighbor.opened) {
                        neighbor.opened = true;
                        this._openHeap.push(neighbor);
                    } else {
                        this._openHeap.update(neighbor);
                    }
                }
            }
        }

        return reachable;
    }

    /**
     * Invalidates any cached walkability state.
     * This implementation reads live walkability data, so invalidation is a no-op.
     */
    public invalidate(): void {
        // No cached walkability data to invalidate.
    }

    /**
     * Releases internal pooled state.
     */
    public dispose(): void {
        this._openHeap.clear();
        this._nodes = [];
        this._generation = 0;
    }

    private _beginSearch(): void {
        this._generation++;
        this._openHeap.clear();
    }

    private _getNode(col: number, row: number): IAStarNode {
        const node = this._nodes[this._toIndex(col, row)];
        if (node.generation !== this._generation) {
            node.generation = this._generation;
            node.g = Number.POSITIVE_INFINITY;
            node.h = 0;
            node.f = Number.POSITIVE_INFINITY;
            node.parentIndex = -1;
            node.opened = false;
            node.closed = false;
            node.heapIndex = -1;
        }

        return node;
    }

    private _inBounds(col: number, row: number): boolean {
        return col >= 0 && col < this._width && row >= 0 && row < this._height;
    }

    private _toIndex(col: number, row: number): number {
        return row * this._width + col;
    }

    private _makeKey(col: number, row: number): string {
        return `${col},${row}`;
    }

    private _canTraverseDiagonal(col: number, row: number, dc: number, dr: number): boolean {
        return this.isWalkable(col + dc, row) && this.isWalkable(col, row + dr);
    }

    private _reconstructPath(goalNode: IAStarNode): IPathPoint[] {
        const path: IPathPoint[] = [];
        let current: IAStarNode | null = goalNode;

        while (current !== null) {
            path.push({ col: current.col, row: current.row });
            current = current.parentIndex >= 0 ? this._nodes[current.parentIndex] : null;
        }

        path.reverse();
        return path;
    }
}

