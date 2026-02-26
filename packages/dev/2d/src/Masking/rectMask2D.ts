import { Rectangle2D } from "../Math/rectangle2D";
import type { IMask2D } from "./iMask2D";

/**
 * A rectangular clipping mask using the GPU scissor test.
 * The cheapest mask type — zero stencil overhead, ideal for UI scroll regions
 * and simple rectangular clipping.
 *
 * The rectangle is defined in the **local space** of the node it's assigned to.
 * It transforms with the node's worldTransform automatically.
 *
 * Limitations:
 * - Only axis-aligned rectangles after world transform (rotation will use the AABB)
 * - Cannot produce soft edges or shaped cutouts (use SpriteMask2D for those)
 * - Nesting uses intersection: child rect is clipped to parent rect
 *
 * @example
 * ```typescript
 * const scrollPanel = new Node2D("panel", scene);
 * scrollPanel.mask = new RectMask2D(0, 0, 300, 200);
 * // All children of scrollPanel are clipped to this 300×200 region
 * ```
 */
export class RectMask2D implements IMask2D {
    /**
     * Whether this mask is currently enabled
     */
    public enabled: boolean = true;

    /**
     * Whether to invert the mask.
     * When inverted, pixels INSIDE the rectangle are hidden.
     * Note: scissor inversion is emulated via stencil fallback.
     */
    public inverted: boolean = false;

    /**
     * The clipping rectangle in the owning node's local space (pixels, Y-down).
     */
    public rect: Rectangle2D;

    /**
     * Optional padding that expands the clipping rectangle (useful for
     * preventing edge-pixel artifacts when sprites extend slightly beyond).
     */
    public padding: number = 0;

    /**
     * Creates a new RectMask2D.
     * @param x - Left edge in local space (default: 0)
     * @param y - Top edge in local space (default: 0)
     * @param width - Width in pixels (default: 0, meaning "use node bounds")
     * @param height - Height in pixels (default: 0, meaning "use node bounds")
     */
    constructor(x: number = 0, y: number = 0, width: number = 0, height: number = 0) {
        this.rect = new Rectangle2D(x, y, width, height);
    }

    /**
     * Disposes this mask. RectMask2D holds no GPU resources, so this is a no-op.
     */
    public dispose(): void {
        // No GPU resources to release
    }
}
