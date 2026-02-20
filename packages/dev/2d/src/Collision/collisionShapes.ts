import { Vector2 } from "core/Maths/math.vector";

/**
 * Base interface for 2D collision shapes
 */
export interface ICollisionShape2D {
    /**
     * The type discriminator for the shape
     */
    readonly type: "box" | "circle" | "polygon";
    /**
     * Offset from the owner node's position
     */
    offset: Vector2;
}

/**
 * Axis-aligned bounding box collider
 */
export class BoxCollider2D implements ICollisionShape2D {
    /** @inheritdoc */
    public readonly type = "box" as const;

    /**
     * Offset from the owner node's position
     */
    public offset: Vector2;

    /**
     * Width of the box in pixels
     */
    public width: number;

    /**
     * Height of the box in pixels
     */
    public height: number;

    /**
     * Creates a new BoxCollider2D
     * @param width - Width in pixels
     * @param height - Height in pixels
     * @param offset - Offset from owner position
     */
    constructor(width: number, height: number, offset: Vector2 = Vector2.Zero()) {
        this.width = width;
        this.height = height;
        this.offset = offset;
    }
}

/**
 * Circle collider
 */
export class CircleCollider2D implements ICollisionShape2D {
    /** @inheritdoc */
    public readonly type = "circle" as const;

    /**
     * Offset from the owner node's position
     */
    public offset: Vector2;

    /**
     * Radius of the circle in pixels
     */
    public radius: number;

    /**
     * Creates a new CircleCollider2D
     * @param radius - Radius in pixels
     * @param offset - Offset from owner position
     */
    constructor(radius: number, offset: Vector2 = Vector2.Zero()) {
        this.radius = radius;
        this.offset = offset;
    }
}

/**
 * Convex polygon collider
 */
export class PolygonCollider2D implements ICollisionShape2D {
    /** @inheritdoc */
    public readonly type = "polygon" as const;

    /**
     * Offset from the owner node's position
     */
    public offset: Vector2;

    /**
     * Vertices of the polygon in local space (clockwise winding)
     */
    public vertices: Vector2[];

    /**
     * Creates a new PolygonCollider2D
     * @param vertices - Array of vertices in local space
     * @param offset - Offset from owner position
     */
    constructor(vertices: Vector2[], offset: Vector2 = Vector2.Zero()) {
        this.vertices = vertices;
        this.offset = offset;
    }
}

/**
 * A collider component that can be attached to a Node2D.
 * Holds one or more shapes and layer/mask filtering for collision queries.
 */
export class Collider2D {
    /**
     * The collision shapes that define this collider's geometry
     */
    public shapes: ICollisionShape2D[];

    /**
     * Bitmask identifying which collision layers this collider belongs to
     */
    public layer: number;

    /**
     * Bitmask identifying which collision layers this collider can interact with
     */
    public mask: number;

    /**
     * Creates a new Collider2D
     * @param shapes - One or more collision shapes
     * @param layer - Collision layer bitmask (default: 1)
     * @param mask - Collision mask bitmask (default: 0xFFFFFFFF = collide with everything)
     */
    constructor(shapes: ICollisionShape2D[] = [], layer: number = 1, mask: number = 0xffffffff) {
        this.shapes = shapes;
        this.layer = layer;
        this.mask = mask;
    }
}

/**
 * Result of a 2D raycast
 */
export interface IRaycastHit2D {
    /**
     * The world position where the ray hit
     */
    point: Vector2;
    /**
     * The surface normal at the hit point
     */
    normal: Vector2;
    /**
     * Distance from ray origin to hit point
     */
    distance: number;
}

// =====================================================
// Collision detection functions
// =====================================================

/**
 * Tests if two axis-aligned boxes overlap
 * @param ax - Box A center X
 * @param ay - Box A center Y
 * @param aw - Box A half-width
 * @param ah - Box A half-height
 * @param bx - Box B center X
 * @param by - Box B center Y
 * @param bw - Box B half-width
 * @param bh - Box B half-height
 * @returns True if the boxes overlap
 */
export function TestBoxBox(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
    return Math.abs(ax - bx) < aw + bw && Math.abs(ay - by) < ah + bh;
}

/**
 * Tests if two circles overlap
 * @param ax - Circle A center X
 * @param ay - Circle A center Y
 * @param ar - Circle A radius
 * @param bx - Circle B center X
 * @param by - Circle B center Y
 * @param br - Circle B radius
 * @returns True if the circles overlap
 */
export function TestCircleCircle(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
    const dx = ax - bx;
    const dy = ay - by;
    const distSq = dx * dx + dy * dy;
    const rSum = ar + br;
    return distSq < rSum * rSum;
}

/**
 * Tests if a circle and an AABB overlap
 * @param cx - Circle center X
 * @param cy - Circle center Y
 * @param cr - Circle radius
 * @param bx - Box center X
 * @param by - Box center Y
 * @param bw - Box half-width
 * @param bh - Box half-height
 * @returns True if they overlap
 */
export function TestCircleBox(cx: number, cy: number, cr: number, bx: number, by: number, bw: number, bh: number): boolean {
    // Find closest point on box to circle center
    const closestX = Math.max(bx - bw, Math.min(cx, bx + bw));
    const closestY = Math.max(by - bh, Math.min(cy, by + bh));

    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx * dx + dy * dy < cr * cr;
}

/**
 * Tests if a point is inside an AABB
 * @param px - Point X
 * @param py - Point Y
 * @param bx - Box center X
 * @param by - Box center Y
 * @param bw - Box half-width
 * @param bh - Box half-height
 * @returns True if the point is inside the box
 */
export function TestPointBox(px: number, py: number, bx: number, by: number, bw: number, bh: number): boolean {
    return Math.abs(px - bx) < bw && Math.abs(py - by) < bh;
}

/**
 * Tests if a point is inside a circle
 * @param px - Point X
 * @param py - Point Y
 * @param cx - Circle center X
 * @param cy - Circle center Y
 * @param cr - Circle radius
 * @returns True if the point is inside the circle
 */
export function TestPointCircle(px: number, py: number, cx: number, cy: number, cr: number): boolean {
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy < cr * cr;
}
