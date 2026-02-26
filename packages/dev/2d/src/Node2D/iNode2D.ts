import type { Vector2 } from "core/Maths/math.vector";
import type { Observable } from "core/Misc/observable";

import type { Matrix2D } from "../Math/matrix2D";

/**
 * Interface for 2D scene graph nodes.
 * Implement this to create custom node types compatible with the 2D engine.
 * The built-in {@link Node2D} class provides a full implementation.
 */
export interface INode2D {
    /** Unique identifier */
    id: string;
    /** Display name */
    name: string;
    /** Local position in pixels */
    position: Vector2;
    /** Local rotation in radians */
    rotation: number;
    /** Local scale */
    scale: Vector2;
    /** Pivot point for rotation/scale */
    pivot: Vector2;
    /** Whether the node is visible */
    visible: boolean;
    /** Rendering sort order within a sorting layer */
    zIndex: number;
    /** Rendering sort layer (higher layers draw on top) */
    sortingLayer: number;
    /** Local opacity (0–1) */
    alpha: number;
    /** Parallax scroll factor X (0=fixed, 1=normal) */
    scrollFactorX: number;
    /** Parallax scroll factor Y (0=fixed, 1=normal) */
    scrollFactorY: number;
    /** Computed world transform matrix */
    readonly worldTransform: Matrix2D;
    /** Computed world opacity */
    readonly worldAlpha: number;
    /** Computed world z-index */
    readonly worldZIndex: number;
    /** Parent node, or null for root nodes */
    readonly parent: INode2D | null;
    /** Ordered list of child nodes */
    readonly children: readonly INode2D[];
    /** Observable fired each update tick */
    onUpdate: Observable<number>;
    /** Observable fired on dispose */
    onDispose: Observable<INode2D>;
    /** Add a child node */
    addChild(child: INode2D): void;
    /** Remove a child node */
    removeChild(child: INode2D): void;
    /** Update the node (called each frame) */
    update(deltaTime: number): void;
    /** Dispose this node and remove from scene */
    dispose(): void;
}
