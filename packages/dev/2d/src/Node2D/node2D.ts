import type { ThinTexture } from "core/Materials/Textures/thinTexture";
import { Vector2 } from "core/Maths/math.vector";
import { Observable } from "core/Misc/observable";

import { Matrix2D } from "../Math/matrix2D";
import type { ISprite2DRenderData } from "../Rendering/spriteBatchRenderer";
import type { Scene2D } from "../Scene2D/scene2D";
import { Scene2DStore } from "../Scene2D/scene2DStore";
import type { INode2D } from "./iNode2D";

/**
 * Base class for all 2D entities in a Scene2D.
 * Uses a Y-down, top-left origin coordinate system with pixel coordinates.
 */
export class Node2D implements INode2D {
    private static _worldToLocalScratch: Matrix2D = Matrix2D.Identity();

    /**
     * Unique identifier for this node.
     */
    public readonly id: string;

    /**
     * Display name for this node.
     */
    public name: string;

    /**
     * Position in pixels relative to parent origin (Y-down).
     */
    public position: Vector2 = Vector2.Zero();

    /**
     * Scale factors.
     */
    public scale: Vector2 = new Vector2(1, 1);

    /**
     * Pivot point for rotation and scaling, relative to this node's local origin.
     */
    public pivot: Vector2 = Vector2.Zero();

    /**
     * Observable triggered each frame with delta time in seconds.
     */
    public readonly onUpdate: Observable<number> = new Observable<number>();

    /**
     * Observable triggered when the node is disposed.
     */
    public readonly onDispose: Observable<INode2D> = new Observable<INode2D>();

    private _parent: Node2D | null = null;
    private _children: Node2D[] = [];
    private _scene: Scene2D | null = null;
    private _worldTransform: Matrix2D = Matrix2D.Identity();
    private _localTransform: Matrix2D = Matrix2D.Identity();
    private _worldPosition: Vector2 = Vector2.Zero();
    private _worldTransformDirty: boolean = true;
    private _isDisposed: boolean = false;
    private _isDisposing: boolean = false;
    private _sceneUpdateActive: boolean = false;

    private _rotation: number = 0;
    private _skewX: number = 0;
    private _skewY: number = 0;

    // Snapshots for Vector2 fields (detect direct .x/.y mutation).
    private _snapshotPosX: number = 0;
    private _snapshotPosY: number = 0;
    private _snapshotScaleX: number = 1;
    private _snapshotScaleY: number = 1;
    private _snapshotPivotX: number = 0;
    private _snapshotPivotY: number = 0;

    /**
     * Creates a new Node2D.
     * @param name - Name of the node.
     * @param scene - Optional Scene2D to add this node to. If omitted, uses the last created Scene2D.
     */
    constructor(name: string, scene?: Scene2D | null) {
        this.name = name;
        this.id = name;

        const targetScene = scene !== undefined ? scene : Scene2DStore._LastCreatedScene;
        if (targetScene) {
            targetScene.addRootNode(this);
        }
    }

    /**
     * Rotation in radians (clockwise in Y-down coordinate system).
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
     * Skew along the X axis in radians (shears the Y axis).
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

    /**
     * The Scene2D this node belongs to, or null when detached.
     */
    public get scene(): Scene2D | null {
        return this._scene;
    }

    /**
     * The parent node in the hierarchy.
     */
    public get parent(): Node2D | null {
        return this._parent;
    }

    public set parent(value: Node2D | null) {
        if (this._parent === value) {
            return;
        }

        const previousParent = this._parent;
        const previousScene = this._scene;

        if (previousScene && previousScene._isOverlayNode(this)) {
            previousScene._removeOverlay(this);
        }

        if (previousParent) {
            const previousIndex = previousParent._children.indexOf(this);
            if (previousIndex !== -1) {
                previousParent._children.splice(previousIndex, 1);
            }
        } else if (previousScene) {
            previousScene._removeRootNodeDirect(this);
        }

        this._parent = value;

        if (value) {
            if (value._children.indexOf(this) === -1) {
                value._children.push(this);
            }
        }

        const nextScene = value ? value.scene : previousScene;
        if (previousScene !== nextScene) {
            if (previousScene) {
                previousScene._detachNodeTree(this);
            }
            if (nextScene) {
                nextScene._attachNodeTree(this);
            }
        } else if (!value && previousScene && !this._isDisposing) {
            previousScene._addRootNodeDirect(this);
        }

        this._markWorldTransformDirty();
        this._markWorldRenderStateDirty();
    }

    /**
     * Read-only list of child nodes.
     */
    public get children(): readonly Node2D[] {
        return this._children;
    }

    /**
     * Adds a child node to this node.
     * @param child - The node to add as a child.
     */
    public addChild(child: Node2D): void {
        child.parent = this;
    }

    /**
     * Removes a child node from this node.
     * @param child - The node to remove.
     */
    public removeChild(child: Node2D): void {
        if (child._parent === this) {
            child.parent = null;
        }
    }

    /**
     * The computed world transform matrix, accounting for parent hierarchy.
     */
    public get worldTransform(): Matrix2D {
        if (!this._worldTransformDirty) {
            this._checkLocalTransformChanges();
        }
        if (this._worldTransformDirty) {
            this._updateWorldTransform();
        }
        return this._worldTransform;
    }

    /**
     * Returns this node's world transform.
     * @returns The cached world transform matrix.
     */
    public getWorldTransform(): Readonly<Matrix2D> {
        return this.worldTransform;
    }

    /**
     * The resolved world position (read-only).
     */
    public get worldPosition(): Vector2 {
        const wt = this.worldTransform;
        this._worldPosition.x = wt.m[4];
        this._worldPosition.y = wt.m[5];
        return this._worldPosition;
    }

    /**
     * Copies the world position into the provided Vector2.
     * @param ref - The Vector2 to store the result in.
     * @returns The ref vector for chaining.
     */
    public worldPositionToRef(ref: Vector2): Vector2 {
        const wt = this.worldTransform;
        ref.x = wt.m[4];
        ref.y = wt.m[5];
        return ref;
    }

    /**
     * Writes the world position into the provided Vector2.
     * @param out - Output vector.
     * @returns The output vector.
     */
    public getWorldPosition(out: Vector2): Vector2 {
        return this.worldPositionToRef(out);
    }

    /**
     * Transforms a point from local space to world space.
     * @param point - The local-space point.
     * @returns The world-space point.
     */
    public localToWorld(point: Vector2): Vector2 {
        const result = Vector2.Zero();
        return this.localToWorldToRef(point, result);
    }

    /**
     * Transforms a point from local space to world space without allocating.
     * @param point - The local-space point.
     * @param ref - The vector to store the result in.
     * @returns The ref vector.
     */
    public localToWorldToRef(point: Vector2, ref: Vector2): Vector2 {
        const m = this.worldTransform.m;
        ref.x = m[0] * point.x + m[2] * point.y + m[4];
        ref.y = m[1] * point.x + m[3] * point.y + m[5];
        return ref;
    }

    /**
     * Transforms a point from world space to local space.
     * @param point - The world-space point.
     * @returns The local-space point.
     */
    public worldToLocal(point: Vector2): Vector2 {
        const result = Vector2.Zero();
        return this.worldToLocalToRef(point, result);
    }

    /**
     * Transforms a point from world space to local space without allocating.
     * @param point - The world-space point.
     * @param ref - The vector to store the result in.
     * @returns The ref vector.
     */
    public worldToLocalToRef(point: Vector2, ref: Vector2): Vector2 {
        this.worldTransform.invertToRef(Node2D._worldToLocalScratch);
        const m = Node2D._worldToLocalScratch.m;
        ref.x = m[0] * point.x + m[2] * point.y + m[4];
        ref.y = m[1] * point.x + m[3] * point.y + m[5];
        return ref;
    }

    /**
     * Called each frame to update this node and its children.
     * @param deltaTime - Time elapsed since last frame in seconds.
     */
    public update(deltaTime: number): void {
        this.onUpdate.notifyObservers(deltaTime);

        if (this._sceneUpdateActive) {
            return;
        }

        for (const child of this._children) {
            child.update(deltaTime);
        }
    }

    /**
     * Disposes of this node and removes it from the hierarchy.
     */
    public dispose(): void {
        if (this._isDisposed) {
            return;
        }

        this._isDisposing = true;

        const childrenCopy = [...this._children];
        for (const child of childrenCopy) {
            child.dispose();
        }

        const scene = this._scene;
        if (this._parent) {
            this.parent = null;
        } else if (scene) {
            if (scene._isOverlayNode(this)) {
                scene._removeOverlay(this);
            } else {
                scene._removeRootNodeDirect(this);
                scene._detachNodeTree(this);
            }
        }

        this.onDispose.notifyObservers(this);
        this.onUpdate.clear();
        this.onDispose.clear();

        this._isDisposed = true;
        this._isDisposing = false;
    }

    /**
     * @internal
     * Sets the scene reference directly.
     * @param scene - The owning scene or null.
     */
    public _setScene(scene: Scene2D | null): void {
        this._scene = scene;
    }

    /**
     * @internal
     * Scene-owned update hook that suppresses child recursion.
     * @param deltaTime - Time elapsed since last frame in seconds.
     */
    public _updateForScene(deltaTime: number): void {
        this._sceneUpdateActive = true;
        try {
            this.update(deltaTime);
        } finally {
            this._sceneUpdateActive = false;
        }
    }

    /**
     * @internal
     * No-op base implementation for render-data collection.
     * @param _list - Output render-data list.
     * @param _fallbackTexture - Fallback texture.
     */
    public _collectRenderData(_list: ISprite2DRenderData[], _fallbackTexture: ThinTexture): void {
    }

    /**
     * @internal
     * Marks the world transform as dirty and propagates to descendants.
     */
    public _markWorldTransformDirty(): void {
        if (this._worldTransformDirty) {
            return;
        }

        this._worldTransformDirty = true;
        for (const child of this._children) {
            child._markWorldTransformDirty();
        }
    }

    /**
     * @internal
     * Marks inherited render-state caches as dirty and propagates to descendants.
     */
    public _markWorldRenderStateDirty(): void {
        for (const child of this._children) {
            child._markWorldRenderStateDirty();
        }
    }

    private _checkLocalTransformChanges(): void {
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

    private _updateWorldTransform(): void {
        Matrix2D._ComposeWithSkewToRef(this.position, this._rotation, this.scale, this.pivot, this._skewX, this._skewY, this._localTransform);

        if (this._parent) {
            this._parent.worldTransform.multiplyToRef(this._localTransform, this._worldTransform);
        } else {
            this._worldTransform.copyFrom(this._localTransform);
        }

        this._snapshotPosX = this.position.x;
        this._snapshotPosY = this.position.y;
        this._snapshotScaleX = this.scale.x;
        this._snapshotScaleY = this.scale.y;
        this._snapshotPivotX = this.pivot.x;
        this._snapshotPivotY = this.pivot.y;
        this._worldTransformDirty = false;
    }
}
