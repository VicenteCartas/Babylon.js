/**
 * Base interface for all 2D masks.
 * A mask restricts rendering of a Node2D's subtree to a specific region.
 */
export interface IMask2D {
    /**
     * Whether this mask is currently enabled.
     * When false, the mask has no effect (children render normally).
     */
    enabled: boolean;

    /**
     * Whether to invert the mask (show what would be hidden and vice versa).
     */
    inverted: boolean;

    /**
     * Disposes GPU resources held by this mask.
     */
    dispose(): void;
}
