/**
 * Minimal interface for 2D scene graph nodes.
 */
export interface INode2D {
    /** Unique identifier. */
    readonly id: string;
    /** Display name. */
    name: string;
    /** Dispose the node. */
    dispose(): void;
}
