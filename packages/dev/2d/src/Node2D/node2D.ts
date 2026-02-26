import { Vector2 } from "core/Maths/math.vector";
import { Observable } from "core/Misc/observable";

import { Matrix2D } from "../Math/matrix2D";
import type { IMask2D } from "../Masking/iMask2D";
import { Scene2DStore } from "../Scene2D/scene2DStore";
import type { Scene2D } from "../Scene2D/scene2D";
import type { INode2D } from "./iNode2D";

/**
 * Base class for all 2D entities in a Scene2D.
 * Uses a Y-down, top-left origin coordinate system with pixel coordinates.
 */
export class Node2D implements INode2D {
    /**
     * Unique identifier for this node
     */
    public id: string;

    /**
     * Display name for this node
     */
    public name: string;

    /**
     * Position in pixels relative to parent origin (Y-down)
     */
    public position: Vector2 = Vector2.Zero();

    /**
     * Scale factors
     */
    public scale: Vector2 = new Vector2(1, 1);

    /**
     * Pivot point for rotation and scaling, relative to this node's local origin
     */
    public pivot: Vector2 = Vector2.Zero();

    /**
     * Whether this node and its children are visible
     */
    public visible: boolean = true;

    /**
     * The mask applied to this node's subtree.
     * When set, all children (and this node's own visuals if it's a Sprite2D)
     * are clipped to the mask region. Set to null to remove the mask.
     *
     * Supports both RectMask2D (scissor-based, cheapest) and
     * SpriteMask2D (stencil-based, shape-based).
     */
    public get mask(): IMask2D | null {
        return this._mask;
    }

    public set mask(value: IMask2D | null) {
        this._mask = value;
    }

    private _mask: IMask2D | null = null;

    /**
     * Observable triggered each frame with delta time in seconds
     */
    public onUpdate: Observable<number> = new Observable<number>();

    /**
     * Observable triggered when the node is disposed
     */
    public onDispose: Observable<INode2D> = new Observable<INode2D>();

    private _parent: Node2D | null = null;
    private _children: Node2D[] = [];
    private _worldTransform: Matrix2D = Matrix2D.Identity();
    private _worldTransformDirty: boolean = true;
    private _worldAlpha: number = 1;
    private _worldZIndex: number = 0;
    private _worldScrollFactorX: number = 1;
    private _worldScrollFactorY: number = 1;
    private _worldPosition: Vector2 = Vector2.Zero();
    private _localTransform: Matrix2D = Matrix2D.Identity();

    /**
     * Sorting layer for render ordering. Sprites in lower layers render first (behind).
     * Within the same layer, sprites sort by zIndex as usual.
     * Common convention: 0 = ground, 1 = objects, 2 = characters, 3 = effects, 4 = UI.
     */
    public sortingLayer: number = 0;

    /**
     * Horizontal scroll factor controlling how much camera movement affects this node.
     * - 1 (default) = moves normally with the camera (foreground)
     * - 0 = fixed to the camera, unaffected by scrolling (HUD-like)
     * - 0..1 = parallax depth layers (lower = further away, scrolls slower)
     * - >1 = foreground parallax (scrolls faster than camera)
     *
     * Multiplied through the hierarchy like worldAlpha.
     */
    public get scrollFactorX(): number {
        return this._scrollFactorX;
    }

    public set scrollFactorX(value: number) {
        if (this._scrollFactorX !== value) {
            this._scrollFactorX = value;
            this._markWorldTransformDirty();
        }
    }

    /**
     * Vertical scroll factor controlling how much camera movement affects this node.
     * - 1 (default) = moves normally with the camera (foreground)
     * - 0 = fixed to the camera, unaffected by scrolling (HUD-like)
     * - 0..1 = parallax depth layers (lower = further away, scrolls slower)
     * - >1 = foreground parallax (scrolls faster than camera)
     *
     * Multiplied through the hierarchy like worldAlpha.
     */
    public get scrollFactorY(): number {
        return this._scrollFactorY;
    }

    public set scrollFactorY(value: number) {
        if (this._scrollFactorY !== value) {
            this._scrollFactorY = value;
            this._markWorldTransformDirty();
        }
    }

    // Backing fields for scalar properties with dirty-flagging setters
    private _rotation: number = 0;
    private _alpha: number = 1;
    private _zIndex: number = 0;
    private _skewX: number = 0;
    private _skewY: number = 0;
    private _scrollFactorX: number = 1;
    private _scrollFactorY: number = 1;

    // Snapshots for Vector2 fields (detect direct .x/.y mutation)
    private _snapshotPosX: number = 0;
    private _snapshotPosY: number = 0;
    private _snapshotScaleX: number = 1;
    private _snapshotScaleY: number = 1;
    private _snapshotPivotX: number = 0;
    private _snapshotPivotY: number = 0;

    /**
     * The Scene2D this node belongs to (null if not added to any scene)
     */
    private _scene: Scene2D | null = null;

    /**
     * Gets the Scene2D this node belongs to
     */
    public get scene(): Scene2D | null {
        return this._scene;
    }

    /**
     * @internal
     * Sets the scene reference. Called by Scene2D.addNode/removeNode.
     */
    public _setScene(scene: Scene2D | null): void {
        this._scene = scene;
    }

    /**
     * Creates a new Node2D
     * @param name - Name of the node
     * @param scene - Optional Scene2D to add this node to. If omitted, uses the last created Scene2D.
     */
    constructor(name: string, scene?: Scene2D | null) {
        this.name = name;
        this.id = name;
        const targetScene = scene !== undefined ? scene : Scene2DStore._LastCreatedScene;
        if (targetScene) {
            this._scene = targetScene;
            targetScene.addNode(this);
        }
    }

    // ─── Scalar properties with dirty-flagging setters ───────────────

    /**
     * Rotation in radians (clockwise in Y-down coordinate system)
     */
    public get rotation(): number {
        return this._rotation;
    }

    public set rotation(value: number) {
        if (this._rotation !== value) {
            this._rotation = value;
            this._markWorldTransformDirty();
        }
    }

    /**
     * Opacity of this node (0-1). Multiplied through the hierarchy.
     */
    public get alpha(): number {
        return this._alpha;
    }

    public set alpha(value: number) {
        if (this._alpha !== value) {
            this._alpha = value;
            this._markWorldTransformDirty();
        }
    }

    /**
     * Draw order within the parent. Higher values render on top.
     */
    public get zIndex(): number {
        return this._zIndex;
    }

    public set zIndex(value: number) {
        if (this._zIndex !== value) {
            this._zIndex = value;
            this._markWorldTransformDirty();
        }
    }

    /**
     * Skew along the X axis in radians (shears the Y axis).
     * Used with skewY to create non-rectangular transforms (e.g., isometric diamonds).
     */
    public get skewX(): number {
        return this._skewX;
    }

    public set skewX(value: number) {
        if (this._skewX !== value) {
            this._skewX = value;
            this._markWorldTransformDirty();
        }
    }

    /**
     * Skew along the Y axis in radians (shears the X axis).
     * Used with skewX to create non-rectangular transforms (e.g., isometric diamonds).
     */
    public get skewY(): number {
        return this._skewY;
    }

    public set skewY(value: number) {
        if (this._skewY !== value) {
            this._skewY = value;
            this._markWorldTransformDirty();
        }
    }

    // ─── Parent / children ───────────────────────────────────────────

    /**
     * The parent node in the hierarchy
     */
    public get parent(): Node2D | null {
        return this._parent;
    }

    public set parent(value: Node2D | null) {
        if (this._parent === value) {
            return;
        }

        // Remove from old parent
        if (this._parent) {
            const index = this._parent._children.indexOf(this);
            if (index !== -1) {
                this._parent._children.splice(index, 1);
            }
        }

        this._parent = value;

        // Add to new parent
        if (this._parent) {
            this._parent._children.push(this);
        }

        this._markWorldTransformDirty();
    }

    /**
     * Read-only list of child nodes
     */
    public get children(): readonly Node2D[] {
        return this._children;
    }

    /**
     * Adds a child node to this node
     * @param child - The node to add as a child
     */
    public addChild(child: Node2D): void {
        child.parent = this;
    }

    /**
     * Removes a child node from this node
     * @param child - The node to remove
     */
    public removeChild(child: Node2D): void {
        if (child._parent === this) {
            child.parent = null;
        }
    }

    // ─── World-space computed properties ─────────────────────────────

    /**
     * The computed world transform matrix, accounting for parent hierarchy.
     * Uses dirty tracking with snapshot comparison for optimal performance:
     * static nodes skip recomputation entirely.
     */
    public get worldTransform(): Matrix2D {
        if (!this._worldTransformDirty) {
            this._checkLocalChanges();
        }
        if (this._worldTransformDirty) {
            this._updateWorldTransform();
        }
        return this._worldTransform;
    }

    /**
     * The resolved world position (read-only).
     * Returns a cached Vector2 — do not store this reference across frames.
     * Use {@link worldPositionToRef} if you need a persistent copy.
     */
    public get worldPosition(): Vector2 {
        const wt = this.worldTransform;
        this._worldPosition.x = wt.m[4];
        this._worldPosition.y = wt.m[5];
        return this._worldPosition;
    }

    /**
     * Copies the world position into the provided Vector2.
     * @param ref - The Vector2 to store the result in
     * @returns The ref vector for chaining
     */
    public worldPositionToRef(ref: Vector2): Vector2 {
        const wt = this.worldTransform;
        ref.x = wt.m[4];
        ref.y = wt.m[5];
        return ref;
    }

    /**
     * The effective alpha accounting for parent hierarchy
     */
    public get worldAlpha(): number {
        if (!this._worldTransformDirty) {
            this._checkLocalChanges();
        }
        if (this._worldTransformDirty) {
            this._updateWorldTransform();
        }
        return this._worldAlpha;
    }

    /**
     * The effective z-index accounting for parent hierarchy.
     * Accumulated additively: parent.worldZIndex + this.zIndex.
     */
    public get worldZIndex(): number {
        if (!this._worldTransformDirty) {
            this._checkLocalChanges();
        }
        if (this._worldTransformDirty) {
            this._updateWorldTransform();
        }
        return this._worldZIndex;
    }

    /**
     * The effective horizontal scroll factor accounting for parent hierarchy.
     * Multiplied through the hierarchy: parent.worldScrollFactorX × this.scrollFactorX.
     */
    public get worldScrollFactorX(): number {
        if (!this._worldTransformDirty) {
            this._checkLocalChanges();
        }
        if (this._worldTransformDirty) {
            this._updateWorldTransform();
        }
        return this._worldScrollFactorX;
    }

    /**
     * The effective vertical scroll factor accounting for parent hierarchy.
     * Multiplied through the hierarchy: parent.worldScrollFactorY × this.scrollFactorY.
     */
    public get worldScrollFactorY(): number {
        if (!this._worldTransformDirty) {
            this._checkLocalChanges();
        }
        if (this._worldTransformDirty) {
            this._updateWorldTransform();
        }
        return this._worldScrollFactorY;
    }

    /**
     * Transforms a point from local space to world space
     * @param point - The local-space point
     * @returns The world-space point
     */
    public localToWorld(point: Vector2): Vector2 {
        return this.worldTransform.transformPoint(point);
    }

    /**
     * Transforms a point from world space to local space
     * @param point - The world-space point
     * @returns The local-space point
     */
    public worldToLocal(point: Vector2): Vector2 {
        const inv = this.worldTransform.invert();
        return inv.transformPoint(point);
    }

    // ─── Update / dispose ────────────────────────────────────────────

    /**
     * Called each frame to update this node and its children.
     * Override in subclasses for custom update logic.
     * @param deltaTime - Time elapsed since last frame in seconds
     */
    public update(deltaTime: number): void {
        this.onUpdate.notifyObservers(deltaTime);

        for (const child of this._children) {
            child.update(deltaTime);
        }
    }

    /**
     * Returns all children sorted by zIndex (ascending)
     * @returns Sorted array of children
     */
    public getChildrenSortedByZIndex(): Node2D[] {
        return [...this._children].sort((a, b) => a.zIndex - b.zIndex);
    }

    /**
     * Disposes of this node and removes it from the hierarchy
     */
    public dispose(): void {
        // Dispose children first (copy array since it mutates)
        const childrenCopy = [...this._children];
        for (const child of childrenCopy) {
            child.dispose();
        }

        this.onDispose.notifyObservers(this);
        this.onUpdate.clear();
        this.onDispose.clear();

        this._mask = null;
        this.parent = null;
    }

    // ─── Dirty tracking internals ────────────────────────────────────

    /**
     * Marks the world transform as needing recomputation and propagates to children
     */
    private _markWorldTransformDirty(): void {
        if (this._worldTransformDirty) {
            return;
        }
        this._worldTransformDirty = true;
        for (const child of this._children) {
            child._markWorldTransformDirty();
        }
    }

    /**
     * Detects direct mutations to Vector2 fields (position.x, scale.y, etc.)
     * by comparing current values against snapshots taken after last recomputation.
     * Cost: 6 float comparisons — much cheaper than a full matrix recomputation.
     */
    private _checkLocalChanges(): void {
        if (
            this.position.x !== this._snapshotPosX ||
            this.position.y !== this._snapshotPosY ||
            this.scale.x !== this._snapshotScaleX ||
            this.scale.y !== this._snapshotScaleY ||
            this.pivot.x !== this._snapshotPivotX ||
            this.pivot.y !== this._snapshotPivotY
        ) {
            this._markWorldTransformDirty();
        }
    }

    /**
     * Recomputes the world transform from local transform and parent,
     * then snapshots current Vector2 values for future change detection.
     */
    private _updateWorldTransform(): void {
        Matrix2D.ComposeToRef(this.position, this._rotation, this.scale, this.pivot, this._skewX, this._skewY, this._localTransform);

        if (this._parent) {
            this._parent.worldTransform.multiplyToRef(this._localTransform, this._worldTransform);
            this._worldAlpha = this._parent.worldAlpha * this._alpha;
            this._worldZIndex = this._parent.worldZIndex + this._zIndex;
            this._worldScrollFactorX = this._parent.worldScrollFactorX * this._scrollFactorX;
            this._worldScrollFactorY = this._parent.worldScrollFactorY * this._scrollFactorY;
        } else {
            this._worldTransform.copyFrom(this._localTransform);
            this._worldAlpha = this._alpha;
            this._worldZIndex = this._zIndex;
            this._worldScrollFactorX = this._scrollFactorX;
            this._worldScrollFactorY = this._scrollFactorY;
        }

        // Snapshot Vector2 values for change detection
        this._snapshotPosX = this.position.x;
        this._snapshotPosY = this.position.y;
        this._snapshotScaleX = this.scale.x;
        this._snapshotScaleY = this.scale.y;
        this._snapshotPivotX = this.pivot.x;
        this._snapshotPivotY = this.pivot.y;

        this._worldTransformDirty = false;
    }
}
