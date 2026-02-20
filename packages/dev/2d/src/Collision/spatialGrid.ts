import { Vector2 } from "core/Maths/math.vector";

import type { Node2D } from "../Node2D/node2D";
import type { IRaycastHit2D } from "./collisionShapes";
import type { BoxCollider2D, CircleCollider2D, PolygonCollider2D } from "./collisionShapes";
import { TestBoxBox, TestCircleCircle, TestCircleBox, TestPointBox, TestPointCircle } from "./collisionShapes";

/**
 * Union type of all concrete collision shapes, enabling discriminated union narrowing
 */
export type CollisionShape2D = BoxCollider2D | CircleCollider2D | PolygonCollider2D;

/**
 * Entry stored in the collision system for spatial queries
 */
export interface ICollisionEntry {
    /**
     * The node this collider belongs to
     */
    node: Node2D;
    /**
     * The collision shapes
     */
    shapes: CollisionShape2D[];
    /**
     * Bitmask identifying which collision layers this entry belongs to
     */
    layer: number;
    /**
     * Bitmask identifying which collision layers this entry can interact with
     */
    mask: number;
}

/**
 * Uniform grid-based spatial partitioning for broad-phase 2D collision detection.
 * Divides the world into fixed-size cells and assigns entries to cells based on their bounds.
 */
export class SpatialGrid {
    private _cellSize: number;
    private _cells: Map<number, ICollisionEntry[]> = new Map();
    private _allEntries: ICollisionEntry[] = [];

    /**
     * Creates a new SpatialGrid
     * @param cellSize - Size of each grid cell in pixels (default: 128)
     */
    constructor(cellSize: number = 128) {
        this._cellSize = cellSize;
    }

    /**
     * Clears all entries from the grid
     */
    public clear(): void {
        this._cells.clear();
        this._allEntries.length = 0;
    }

    /**
     * Inserts a collision entry into the grid
     * @param entry - The collision entry to insert
     */
    public insert(entry: ICollisionEntry): void {
        this._allEntries.push(entry);

        // Compute AABB for all shapes
        const wp = entry.node.worldPosition;
        for (const shape of entry.shapes) {
            const cx = wp.x + shape.offset.x;
            const cy = wp.y + shape.offset.y;
            let minX: number, minY: number, maxX: number, maxY: number;

            if (shape.type === "box") {
                const hw = shape.width / 2;
                const hh = shape.height / 2;
                minX = cx - hw;
                minY = cy - hh;
                maxX = cx + hw;
                maxY = cy + hh;
            } else if (shape.type === "circle") {
                minX = cx - shape.radius;
                minY = cy - shape.radius;
                maxX = cx + shape.radius;
                maxY = cy + shape.radius;
            } else {
                // Polygon — compute AABB from vertices
                minX = Infinity;
                minY = Infinity;
                maxX = -Infinity;
                maxY = -Infinity;
                for (const v of shape.vertices) {
                    const vx = cx + v.x;
                    const vy = cy + v.y;
                    minX = Math.min(minX, vx);
                    minY = Math.min(minY, vy);
                    maxX = Math.max(maxX, vx);
                    maxY = Math.max(maxY, vy);
                }
            }

            // Insert into all overlapping cells
            const startCol = Math.floor(minX / this._cellSize);
            const endCol = Math.floor(maxX / this._cellSize);
            const startRow = Math.floor(minY / this._cellSize);
            const endRow = Math.floor(maxY / this._cellSize);

            for (let row = startRow; row <= endRow; row++) {
                for (let col = startCol; col <= endCol; col++) {
                    const key = row * 100000 + col;
                    let cell = this._cells.get(key);
                    if (!cell) {
                        cell = [];
                        this._cells.set(key, cell);
                    }
                    cell.push(entry);
                }
            }
        }
    }

    /**
     * Queries all entries that may overlap with a point
     * @param x - Point X
     * @param y - Point Y
     * @param mask - Collision mask filter
     * @returns Array of matching entries
     */
    public queryPoint(x: number, y: number, mask: number = 0xffffffff): ICollisionEntry[] {
        const col = Math.floor(x / this._cellSize);
        const row = Math.floor(y / this._cellSize);
        const key = row * 100000 + col;
        const cell = this._cells.get(key);
        if (!cell) {
            return [];
        }

        const results: ICollisionEntry[] = [];
        const seen = new Set<Node2D>();

        for (const entry of cell) {
            if (seen.has(entry.node) || (entry.layer & mask) === 0) {
                continue;
            }

            const wp = entry.node.worldPosition;
            for (const shape of entry.shapes) {
                const cx = wp.x + shape.offset.x;
                const cy = wp.y + shape.offset.y;
                let hit = false;

                if (shape.type === "box") {
                    hit = TestPointBox(x, y, cx, cy, shape.width / 2, shape.height / 2);
                } else if (shape.type === "circle") {
                    hit = TestPointCircle(x, y, cx, cy, shape.radius);
                }

                if (hit) {
                    results.push(entry);
                    seen.add(entry.node);
                    break;
                }
            }
        }

        return results;
    }

    /**
     * Queries all entries that may overlap with an AABB
     * @param x - Box center X
     * @param y - Box center Y
     * @param halfWidth - Box half-width
     * @param halfHeight - Box half-height
     * @param mask - Collision mask filter
     * @returns Array of matching entries
     */
    public queryBox(x: number, y: number, halfWidth: number, halfHeight: number, mask: number = 0xffffffff): ICollisionEntry[] {
        const minX = x - halfWidth;
        const minY = y - halfHeight;
        const maxX = x + halfWidth;
        const maxY = y + halfHeight;

        const startCol = Math.floor(minX / this._cellSize);
        const endCol = Math.floor(maxX / this._cellSize);
        const startRow = Math.floor(minY / this._cellSize);
        const endRow = Math.floor(maxY / this._cellSize);

        const results: ICollisionEntry[] = [];
        const seen = new Set<Node2D>();

        for (let row = startRow; row <= endRow; row++) {
            for (let col = startCol; col <= endCol; col++) {
                const key = row * 100000 + col;
                const cell = this._cells.get(key);
                if (!cell) {
                    continue;
                }

                for (const entry of cell) {
                    if (seen.has(entry.node) || (entry.layer & mask) === 0) {
                        continue;
                    }

                    const wp = entry.node.worldPosition;
                    for (const shape of entry.shapes) {
                        const cx = wp.x + shape.offset.x;
                        const cy = wp.y + shape.offset.y;
                        let hit = false;

                        if (shape.type === "box") {
                            hit = TestBoxBox(x, y, halfWidth, halfHeight, cx, cy, shape.width / 2, shape.height / 2);
                        } else if (shape.type === "circle") {
                            hit = TestCircleBox(cx, cy, shape.radius, x, y, halfWidth, halfHeight);
                        }

                        if (hit) {
                            results.push(entry);
                            seen.add(entry.node);
                            break;
                        }
                    }
                }
            }
        }

        return results;
    }

    /**
     * Queries all entries that may overlap with a circle
     * @param x - Circle center X
     * @param y - Circle center Y
     * @param radius - Circle radius
     * @param mask - Collision mask filter
     * @returns Array of matching entries
     */
    public queryCircle(x: number, y: number, radius: number, mask: number = 0xffffffff): ICollisionEntry[] {
        // Use AABB query as broad phase, then narrow phase with circle tests
        const candidates = this.queryBox(x, y, radius, radius, mask);
        const results: ICollisionEntry[] = [];

        for (const entry of candidates) {
            const wp = entry.node.worldPosition;
            for (const shape of entry.shapes) {
                const cx = wp.x + shape.offset.x;
                const cy = wp.y + shape.offset.y;
                let hit = false;

                if (shape.type === "circle") {
                    hit = TestCircleCircle(x, y, radius, cx, cy, shape.radius);
                } else if (shape.type === "box") {
                    hit = TestCircleBox(x, y, radius, cx, cy, shape.width / 2, shape.height / 2);
                }

                if (hit) {
                    results.push(entry);
                    break;
                }
            }
        }

        return results;
    }

    /**
     * Performs a raycast against all entries in the grid.
     * Uses DDA (Digital Differential Analyzer) to walk cells along the ray.
     * @param originX - Ray origin X
     * @param originY - Ray origin Y
     * @param dirX - Ray direction X (will be normalized)
     * @param dirY - Ray direction Y (will be normalized)
     * @param maxDistance - Maximum ray distance
     * @param mask - Collision mask filter
     * @returns The closest hit, or null if no hit
     */
    public raycast(originX: number, originY: number, dirX: number, dirY: number, maxDistance: number, mask: number = 0xffffffff): IRaycastHit2D | null {
        // Normalize direction
        const len = Math.sqrt(dirX * dirX + dirY * dirY);
        if (len < 1e-10) {
            return null;
        }
        const ndx = dirX / len;
        const ndy = dirY / len;

        // Simple stepping approach: check at intervals along the ray
        const stepSize = this._cellSize / 2;
        const steps = Math.ceil(maxDistance / stepSize);
        const seen = new Set<Node2D>();
        let closest: IRaycastHit2D | null = null;

        for (let i = 0; i <= steps; i++) {
            const dist = i * stepSize;
            if (dist > maxDistance) {
                break;
            }

            const px = originX + ndx * dist;
            const py = originY + ndy * dist;

            const entries = this.queryPoint(px, py, mask);
            for (const entry of entries) {
                if (seen.has(entry.node)) {
                    continue;
                }
                seen.add(entry.node);

                // Approximate hit point at current step position
                const hitDist = dist;
                if (!closest || hitDist < closest.distance) {
                    closest = {
                        point: new Vector2(px, py),
                        normal: new Vector2(-ndx, -ndy),
                        distance: hitDist,
                    };
                }
            }

            if (closest) {
                return closest;
            }
        }

        return null;
    }
}
