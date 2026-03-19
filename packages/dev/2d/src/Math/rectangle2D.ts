/**
 * An axis-aligned 2D rectangle stored as x, y, width, and height.
 */
export class Rectangle2D {
    /**
     * Creates a new Rectangle2D.
     * @param x - Left edge X coordinate.
     * @param y - Top edge Y coordinate.
     * @param width - Rectangle width.
     * @param height - Rectangle height.
     */
    constructor(
        public x: number = 0,
        public y: number = 0,
        public width: number = 0,
        public height: number = 0
    ) {}

    /**
     * Left edge X coordinate.
     * @returns The left edge.
     */
    public get left(): number {
        return this.x;
    }

    /**
     * Top edge Y coordinate.
     * @returns The top edge.
     */
    public get top(): number {
        return this.y;
    }

    /**
     * Right edge X coordinate.
     * @returns The right edge.
     */
    public get right(): number {
        return this.x + this.width;
    }

    /**
     * Bottom edge Y coordinate.
     * @returns The bottom edge.
     */
    public get bottom(): number {
        return this.y + this.height;
    }

    /**
     * Horizontal center.
     * @returns The center X coordinate.
     */
    public get centerX(): number {
        return this.x + this.width * 0.5;
    }

    /**
     * Vertical center.
     * @returns The center Y coordinate.
     */
    public get centerY(): number {
        return this.y + this.height * 0.5;
    }

    /**
     * Rectangle area.
     * @returns The area.
     */
    public get area(): number {
        return this.width * this.height;
    }

    /**
     * Checks whether the point is inside this rectangle, inclusive of edges.
     * @param px - Point X coordinate.
     * @param py - Point Y coordinate.
     * @returns True when the point is inside this rectangle.
     */
    public containsPoint(px: number, py: number): boolean {
        return px >= this.left && px <= this.right && py >= this.top && py <= this.bottom;
    }

    /**
     * Checks whether this rectangle contains a point or another rectangle.
     * @param pxOrOther - Point X coordinate or another rectangle.
     * @param py - Point Y coordinate when the first argument is a number.
     * @returns True when the point or rectangle is fully contained.
     */
    public contains(px: number, py: number): boolean;
    /**
     * Checks whether this rectangle fully contains another rectangle.
     * @param other - The other rectangle.
     * @returns True when the other rectangle is fully contained.
     */
    public contains(other: Rectangle2D): boolean;
    public contains(pxOrOther: number | Rectangle2D, py?: number): boolean {
        if (pxOrOther instanceof Rectangle2D) {
            return pxOrOther.left >= this.left && pxOrOther.right <= this.right && pxOrOther.top >= this.top && pxOrOther.bottom <= this.bottom;
        }

        return this.containsPoint(pxOrOther, py!);
    }

    /**
     * Checks whether this rectangle intersects another rectangle.
     * @param other - The other rectangle.
     * @returns True when the rectangles overlap or touch.
     */
    public intersects(other: Rectangle2D): boolean {
        return this.left <= other.right && this.right >= other.left && this.top <= other.bottom && this.bottom >= other.top;
    }

    /**
     * Computes the intersection of this rectangle and another into `out`.
     * @param other - The other rectangle.
     * @param out - Rectangle receiving the intersection.
     * @returns The `out` rectangle.
     */
    public intersectToRef(other: Rectangle2D, out: Rectangle2D): Rectangle2D {
        const x = Math.max(this.left, other.left);
        const y = Math.max(this.top, other.top);
        const right = Math.min(this.right, other.right);
        const bottom = Math.min(this.bottom, other.bottom);

        out.x = x;
        out.y = y;
        out.width = Math.max(0, right - x);
        out.height = Math.max(0, bottom - y);
        return out;
    }

    /**
     * Computes the union of this rectangle and another into `out`.
     * @param other - The other rectangle.
     * @param out - Rectangle receiving the union.
     * @returns The `out` rectangle.
     */
    public unionToRef(other: Rectangle2D, out: Rectangle2D): Rectangle2D {
        const left = Math.min(this.left, other.left);
        const top = Math.min(this.top, other.top);
        const right = Math.max(this.right, other.right);
        const bottom = Math.max(this.bottom, other.bottom);

        out.x = left;
        out.y = top;
        out.width = right - left;
        out.height = bottom - top;
        return out;
    }

    /**
     * Expands this rectangle by the same amount on all sides.
     * @param amount - Amount to expand.
     * @returns This rectangle.
     */
    public expand(amount: number): this {
        this.x -= amount;
        this.y -= amount;
        this.width += amount * 2;
        this.height += amount * 2;
        return this;
    }

    /**
     * Writes an expanded copy of this rectangle into `out`.
     * @param amount - Amount to expand on all sides.
     * @param out - Rectangle receiving the result.
     * @returns The `out` rectangle.
     */
    public expandToRef(amount: number, out: Rectangle2D): Rectangle2D {
        out.x = this.x - amount;
        out.y = this.y - amount;
        out.width = this.width + amount * 2;
        out.height = this.height + amount * 2;
        return out;
    }

    /**
     * Sets all rectangle fields.
     * @param x - Left edge X coordinate.
     * @param y - Top edge Y coordinate.
     * @param width - Rectangle width.
     * @param height - Rectangle height.
     * @returns This rectangle.
     */
    public set(x: number, y: number, width: number, height: number): this {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        return this;
    }

    /**
     * Copies values from another rectangle.
     * @param other - Rectangle to copy from.
     * @returns This rectangle.
     */
    public copyFrom(other: Rectangle2D): this {
        return this.set(other.x, other.y, other.width, other.height);
    }

    /**
     * Creates a copy of this rectangle.
     * @returns A new rectangle with the same values.
     */
    public clone(): Rectangle2D {
        return new Rectangle2D(this.x, this.y, this.width, this.height);
    }

    /**
     * Checks exact equality with another rectangle.
     * @param other - Rectangle to compare with.
     * @returns True when all fields match exactly.
     */
    public equals(other: Rectangle2D): boolean {
        return this.x === other.x && this.y === other.y && this.width === other.width && this.height === other.height;
    }

    /**
     * Returns a string representation of this rectangle.
     * @returns The rectangle as a string.
     */
    public toString(): string {
        return `Rectangle2D(${this.x}, ${this.y}, ${this.width}, ${this.height})`;
    }
}
