import type { IMask2D } from "../Masking/iMask2D";
import type { Rectangle2D } from "../Math/rectangle2D";
import type { Scene2D } from "../Scene2D/scene2D";
import { Node2D } from "./node2D";

/**
 * A scene-graph node that participates in rendering behavior without
 * necessarily drawing geometry itself.
 *
 * This class is the architectural render-capable base used by Sprite2D,
 * TilemapLayer2D, and other visual/grouping nodes.
 */
export class RenderableNode2D extends Node2D {
    private _visible: boolean = true;
    private _mask: IMask2D | null = null;
    private _alpha: number = 1;
    private _zIndex: number = 0;
    private _sortingLayer: number = 0;
    private _scrollFactorX: number = 1;
    private _scrollFactorY: number = 1;
    private _worldAlpha: number = 1;
    private _worldZIndex: number = 0;
    private _worldScrollFactorX: number = 1;
    private _worldScrollFactorY: number = 1;
    private _worldRenderStateDirty: boolean = true;

    /**
     * Creates a new RenderableNode2D.
     * @param name - Node name.
     * @param scene - Optional owning scene.
     */
    constructor(name: string, scene?: Scene2D | null) {
        super(name, scene);
    }

    /**
     * Whether this node and its descendants participate in scene update/render traversal.
     */
    public get visible(): boolean {
        return this._visible;
    }

    public set visible(value: boolean) {
        this._visible = value;
    }

    /**
     * Mask applied to this node's subtree.
     */
    public get mask(): IMask2D | null {
        return this._mask;
    }

    public set mask(value: IMask2D | null) {
        this._mask = value;
    }

    /**
     * Local alpha multiplier.
     */
    public get alpha(): number {
        return this._alpha;
    }

    public set alpha(value: number) {
        if (this._alpha !== value) {
            this._alpha = value;
            this._markWorldRenderStateDirty();
        }
    }

    /**
     * Coarse render-order grouping. Lower layers render first.
     */
    public get sortingLayer(): number {
        return this._sortingLayer;
    }

    public set sortingLayer(value: number) {
        this._sortingLayer = value;
    }

    /**
     * Fine-grained depth within a sorting layer.
     */
    public get zIndex(): number {
        return this._zIndex;
    }

    public set zIndex(value: number) {
        if (this._zIndex !== value) {
            this._zIndex = value;
            this._markWorldRenderStateDirty();
        }
    }

    /**
     * Horizontal parallax factor.
     */
    public get scrollFactorX(): number {
        return this._scrollFactorX;
    }

    public set scrollFactorX(value: number) {
        if (this._scrollFactorX !== value) {
            this._scrollFactorX = value;
            this._markWorldRenderStateDirty();
        }
    }

    /**
     * Vertical parallax factor.
     */
    public get scrollFactorY(): number {
        return this._scrollFactorY;
    }

    public set scrollFactorY(value: number) {
        if (this._scrollFactorY !== value) {
            this._scrollFactorY = value;
            this._markWorldRenderStateDirty();
        }
    }

    /**
     * The effective alpha accounting for ancestor renderable nodes.
     */
    public get worldAlpha(): number {
        if (this._worldRenderStateDirty) {
            this._updateWorldRenderState();
        }
        return this._worldAlpha;
    }

    /**
     * The effective z-index accounting for ancestor renderable nodes.
     */
    public get worldZIndex(): number {
        if (this._worldRenderStateDirty) {
            this._updateWorldRenderState();
        }
        return this._worldZIndex;
    }

    /**
     * The effective horizontal scroll factor accounting for ancestor renderable nodes.
     */
    public get worldScrollFactorX(): number {
        if (this._worldRenderStateDirty) {
            this._updateWorldRenderState();
        }
        return this._worldScrollFactorX;
    }

    /**
     * The effective vertical scroll factor accounting for ancestor renderable nodes.
     */
    public get worldScrollFactorY(): number {
        if (this._worldRenderStateDirty) {
            this._updateWorldRenderState();
        }
        return this._worldScrollFactorY;
    }

    /**
     * Returns renderable children sorted by z-index (ascending).
     * @returns Sorted renderable child nodes.
     */
    public getChildrenSortedByZIndex(): RenderableNode2D[] {
        return this.children.filter((child): child is RenderableNode2D => child instanceof RenderableNode2D).sort((left, right) => left.zIndex - right.zIndex);
    }


/**
 * Resolves local-space bounds usable by RectMask2D owner-bounds fallback.
 * Subclasses with stable logical bounds override this.
 * @param _out - Rectangle receiving the bounds.
 * @returns True when bounds were written.
 * @internal
 */
public _getMaskLocalBounds(_out: Rectangle2D): boolean {
    return false;
}

/**
 * Disposes this renderable node.
 */
    public override dispose(): void {
        this.mask = null;
        super.dispose();
    }

    /**
     * @internal
     */
    public override _markWorldRenderStateDirty(): void {
        if (!this._worldRenderStateDirty) {
            this._worldRenderStateDirty = true;
        }
        super._markWorldRenderStateDirty();
    }

    private _getParentRenderableNode(): RenderableNode2D | null {
        let current = this.parent;
        while (current) {
            if (current instanceof RenderableNode2D) {
                return current;
            }
            current = current.parent;
        }
        return null;
    }

    private _updateWorldRenderState(): void {
        const parentRenderable = this._getParentRenderableNode();
        if (parentRenderable) {
            this._worldAlpha = parentRenderable.worldAlpha * this._alpha;
            this._worldZIndex = parentRenderable.worldZIndex + this._zIndex;
            this._worldScrollFactorX = parentRenderable.worldScrollFactorX * this._scrollFactorX;
            this._worldScrollFactorY = parentRenderable.worldScrollFactorY * this._scrollFactorY;
        } else {
            this._worldAlpha = this._alpha;
            this._worldZIndex = this._zIndex;
            this._worldScrollFactorX = this._scrollFactorX;
            this._worldScrollFactorY = this._scrollFactorY;
        }

        this._worldRenderStateDirty = false;
    }
}
