/**
 * A 2D rectangle defined by position and size
 */
export class Rectangle2D {
    /**
     * Creates a new Rectangle2D
     * @param x - Left edge X coordinate
     * @param y - Top edge Y coordinate
     * @param width - Width of the rectangle
     * @param height - Height of the rectangle
     */
    constructor(
        public x: number = 0,
        public y: number = 0,
        public width: number = 0,
        public height: number = 0
    ) {}

    /**
     * The right edge X coordinate
     */
    public get right(): number {
        return this.x + this.width;
    }

    /**
     * The bottom edge Y coordinate
     */
    public get bottom(): number {
        return this.y + this.height;
    }

    /**
     * Checks if this rectangle contains a point
     * @param px - Point X coordinate
     * @param py - Point Y coordinate
     * @returns True if the point is inside the rectangle
     */
    public contains(px: number, py: number): boolean {
        return px >= this.x && px < this.right && py >= this.y && py < this.bottom;
    }

    /**
     * Checks if this rectangle intersects with another
     * @param other - The other rectangle
     * @returns True if the rectangles overlap
     */
    public intersects(other: Rectangle2D): boolean {
        return this.x < other.right && this.right > other.x && this.y < other.bottom && this.bottom > other.y;
    }

    /**
     * Clones this rectangle
     * @returns A new Rectangle2D with the same values
     */
    public clone(): Rectangle2D {
        return new Rectangle2D(this.x, this.y, this.width, this.height);
    }

    /**
     * Computes the intersection of two rectangles and stores the result in ref.
     * If the rectangles don't overlap, ref will have zero width and height.
     * @param a - First rectangle
     * @param b - Second rectangle
     * @param ref - Rectangle to store the result in
     * @returns The ref rectangle for chaining
     */
    public static IntersectToRef(a: Rectangle2D, b: Rectangle2D, ref: Rectangle2D): Rectangle2D {
        const x = Math.max(a.x, b.x);
        const y = Math.max(a.y, b.y);
        const right = Math.min(a.right, b.right);
        const bottom = Math.min(a.bottom, b.bottom);
        ref.x = x;
        ref.y = y;
        ref.width = Math.max(0, right - x);
        ref.height = Math.max(0, bottom - y);
        return ref;
    }
}
