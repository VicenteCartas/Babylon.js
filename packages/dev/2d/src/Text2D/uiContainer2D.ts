import type { ThinTexture } from "core/Materials/Textures/thinTexture";
import type { Rectangle2D } from "../Math/rectangle2D";

import type { Node2D } from "../Node2D/node2D";
import { RenderableNode2D } from "../Node2D/renderableNode2D";
import { Sprite2D } from "../Sprite2D/sprite2D";
import type { ISprite2DRenderData } from "../Rendering/spriteBatchRenderer";
import type { Scene2D } from "../Scene2D/scene2D";

/** Padding values used by UIContainer2D. */
export interface IUIPadding {
    /** Top padding in pixels. */
    top: number;
    /** Right padding in pixels. */
    right: number;
    /** Bottom padding in pixels. */
    bottom: number;
    /** Left padding in pixels. */
    left: number;
}

/** Anchor positions used by UIContainer2D absolute layout. */
export enum UIAnchor {
    /** Top-left corner. */
    TopLeft = 0,
    /** Top-center edge. */
    TopCenter = 1,
    /** Top-right corner. */
    TopRight = 2,
    /** Middle-left edge. */
    MiddleLeft = 3,
    /** Center point. */
    Center = 4,
    /** Middle-right edge. */
    MiddleRight = 5,
    /** Bottom-left corner. */
    BottomLeft = 6,
    /** Bottom-center edge. */
    BottomCenter = 7,
    /** Bottom-right corner. */
    BottomRight = 8,
}

/** Layout strategies supported by UIContainer2D. */
export enum UILayoutMode {
    /** Children are positioned manually or via setChildAnchor. */
    Absolute = 0,
    /** Children are stacked vertically top-to-bottom. */
    VerticalFlow = 1,
    /** Children are stacked horizontally left-to-right. */
    HorizontalFlow = 2,
}

interface IChildAnchorLayout {
    anchor: UIAnchor;
    offsetX: number;
    offsetY: number;
}

interface INodeWithWidthHeight {
    width: number;
    height: number;
}

interface INodeWithMeasuredSize {
    getMeasuredWidth(): number;
    getMeasuredHeight(): number;
}

/**
 * Lightweight UI layout container that positions direct children using anchors or flow rules.
 */
export class UIContainer2D extends RenderableNode2D {
    private _width: number = 0;
    private _height: number = 0;
    private _layout: UILayoutMode = UILayoutMode.Absolute;
    private _padding: IUIPadding = { top: 0, right: 0, bottom: 0, left: 0 };
    private _spacing: number = 0;
    private _layoutDirty: boolean = true;
    private _childAnchors: Map<Node2D, IChildAnchorLayout> = new Map();

    /**
     * Creates a new UIContainer2D.
     * @param name - Node name.
     * @param scene - Optional owning scene.
     */
    constructor(name: string, scene?: Scene2D | null) {
        super(name, scene);
    }

    /** Container logical width in design pixels. */
    public get width(): number {
        return this._width;
    }

    public set width(value: number) {
        if (this._width !== value) {
            this._width = value;
            this.invalidateLayout();
        }
    }

    /** Container logical height in design pixels. */
    public get height(): number {
        return this._height;
    }

    public set height(value: number) {
        if (this._height !== value) {
            this._height = value;
            this.invalidateLayout();
        }
    }

    /** Active layout mode. */
    public get layout(): UILayoutMode {
        return this._layout;
    }

    public set layout(value: UILayoutMode) {
        if (this._layout !== value) {
            this._layout = value;
            this.invalidateLayout();
        }
    }

    /** Padding inside the container bounds. */
    public get padding(): IUIPadding {
        return this._padding;
    }

    public set padding(value: IUIPadding) {
        this._padding = {
            top: value.top,
            right: value.right,
            bottom: value.bottom,
            left: value.left,
        };
        this.invalidateLayout();
    }

    /** Spacing between children in flow layouts. */
    public get spacing(): number {
        return this._spacing;
    }

    public set spacing(value: number) {
        if (this._spacing !== value) {
            this._spacing = value;
            this.invalidateLayout();
        }
    }

    /**
     * Adds a child and invalidates layout.
     * @param child - Child node to add.
     * @returns Nothing.
     */
    public override addChild(child: Node2D): void {
        super.addChild(child);
        this.invalidateLayout();
    }

    /**
     * Removes a child and invalidates layout.
     * @param child - Child node to remove.
     * @returns Nothing.
     */
    public override removeChild(child: Node2D): void {
        super.removeChild(child);
        this._childAnchors.delete(child);
        this.invalidateLayout();
    }

    /**
     * Sets an anchor constraint for a direct child.
     * @param child - Direct child node to anchor.
     * @param anchor - Which point on the container to anchor against.
     * @param offsetX - Horizontal offset in pixels.
     * @param offsetY - Vertical offset in pixels.
     * @returns Nothing.
     */
    public setChildAnchor(child: Node2D, anchor: UIAnchor, offsetX: number = 0, offsetY: number = 0): void {
        if (child.parent !== this) {
            throw new Error("UIContainer2D.setChildAnchor() requires a direct child.");
        }

        this._childAnchors.set(child, { anchor, offsetX, offsetY });
        this.invalidateLayout();
    }

    /**
     * Removes anchor constraints from a direct child.
     * @param child - Child node whose anchor should be cleared.
     * @returns Nothing.
     */
    public clearChildAnchor(child: Node2D): void {
        if (this._childAnchors.delete(child)) {
            this.invalidateLayout();
        }
    }

    /**
     * Marks the cached layout as dirty.
     * @returns Nothing.
     */
    public invalidateLayout(): void {
        this._layoutDirty = true;
    }

    /**
     * Updates layout before child updates run.
     * @param deltaTime - Time elapsed since the previous frame.
     * @returns Nothing.
     */
    public override update(deltaTime: number): void {
        this._ensureLayoutUpToDate();
        super.update(deltaTime);
    }


/**
 * Resolves this container's local bounds for RectMask2D owner fallback.
 * @param out - Rectangle receiving the bounds.
 * @returns True when bounds were written.
 * @internal
 */
public override _getMaskLocalBounds(out: Rectangle2D): boolean {
    if (this._width <= 0 || this._height <= 0) {
        return false;
    }

    out.set(0, 0, this._width, this._height);
    return true;
}

/**
 * Ensures layout is resolved before manual render-data collection.
     * @param _list - Ignored render-data output list.
     * @param _fallbackTexture - Ignored fallback texture.
     * @returns Nothing.
     * @internal
     */
    public override _collectRenderData(_list: ISprite2DRenderData[], _fallbackTexture: ThinTexture): void {
        this._ensureLayoutUpToDate();
    }

    /**
     * Disposes the container and clears cached layout metadata.
     * @returns Nothing.
     */
    public override dispose(): void {
        this._childAnchors.clear();
        super.dispose();
    }

    private _ensureLayoutUpToDate(): void {
        if (!this._layoutDirty) {
            return;
        }

        this._updateLayout();
        this._layoutDirty = false;
    }

    private _updateLayout(): void {
        if (this._layout === UILayoutMode.VerticalFlow) {
            this._applyVerticalFlowLayout();
            return;
        }

        if (this._layout === UILayoutMode.HorizontalFlow) {
            this._applyHorizontalFlowLayout();
            return;
        }

        this._applyAbsoluteLayout();
    }

    private _applyAbsoluteLayout(): void {
        for (const child of this.children) {
            const anchorLayout = this._childAnchors.get(child);
            if (!anchorLayout) {
                continue;
            }

            const size = this._getNodeLayoutSize(child);
            child.position.x = this._resolveAnchorX(anchorLayout.anchor, size.width) + anchorLayout.offsetX;
            child.position.y = this._resolveAnchorY(anchorLayout.anchor, size.height) + anchorLayout.offsetY;
            child._markWorldTransformDirty();
        }
    }

    private _applyVerticalFlowLayout(): void {
        let cursorY = this._padding.top;
        for (const child of this.children) {
            const size = this._getNodeLayoutSize(child);
            child.position.x = this._padding.left + size.width * 0.5;
            child.position.y = cursorY + size.height * 0.5;
            child._markWorldTransformDirty();
            cursorY += size.height + this._spacing;
        }
    }

    private _applyHorizontalFlowLayout(): void {
        let cursorX = this._padding.left;
        for (const child of this.children) {
            const size = this._getNodeLayoutSize(child);
            child.position.x = cursorX + size.width * 0.5;
            child.position.y = this._padding.top + size.height * 0.5;
            child._markWorldTransformDirty();
            cursorX += size.width + this._spacing;
        }
    }

    private _resolveAnchorX(anchor: UIAnchor, childWidth: number): number {
        switch (anchor) {
            case UIAnchor.TopLeft:
            case UIAnchor.MiddleLeft:
            case UIAnchor.BottomLeft:
                return this._padding.left + childWidth * 0.5;
            case UIAnchor.TopCenter:
            case UIAnchor.Center:
            case UIAnchor.BottomCenter:
                return this._width * 0.5;
            case UIAnchor.TopRight:
            case UIAnchor.MiddleRight:
            case UIAnchor.BottomRight:
                return this._width - this._padding.right - childWidth * 0.5;
            default:
                return 0;
        }
    }

    private _resolveAnchorY(anchor: UIAnchor, childHeight: number): number {
        switch (anchor) {
            case UIAnchor.TopLeft:
            case UIAnchor.TopCenter:
            case UIAnchor.TopRight:
                return this._padding.top + childHeight * 0.5;
            case UIAnchor.MiddleLeft:
            case UIAnchor.Center:
            case UIAnchor.MiddleRight:
                return this._height * 0.5;
            case UIAnchor.BottomLeft:
            case UIAnchor.BottomCenter:
            case UIAnchor.BottomRight:
                return this._height - this._padding.bottom - childHeight * 0.5;
            default:
                return 0;
        }
    }

    private _getNodeLayoutSize(child: Node2D): { width: number; height: number } {
        if (child instanceof Sprite2D) {
            return {
                width: child.getDisplayWidth(),
                height: child.getDisplayHeight(),
            };
        }

        if (this._hasMeasuredSize(child)) {
            return {
                width: child.getMeasuredWidth(),
                height: child.getMeasuredHeight(),
            };
        }

        if (this._hasWidthHeight(child)) {
            return {
                width: child.width,
                height: child.height,
            };
        }

        return { width: 0, height: 0 };
    }

    private _hasWidthHeight(child: Node2D): child is Node2D & INodeWithWidthHeight {
        const sizedChild = child as Node2D & Partial<INodeWithWidthHeight>;
        return typeof sizedChild.width === "number" && typeof sizedChild.height === "number";
    }

    private _hasMeasuredSize(child: Node2D): child is Node2D & INodeWithMeasuredSize {
        const measuredChild = child as Node2D & Partial<INodeWithMeasuredSize>;
        return typeof measuredChild.getMeasuredWidth === "function" && typeof measuredChild.getMeasuredHeight === "function";
    }
}


