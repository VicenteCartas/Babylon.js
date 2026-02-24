import type { BaseTexture } from "core/Materials/Textures/baseTexture";
import type { ThinTexture } from "core/Materials/Textures/thinTexture";
import { Texture } from "core/Materials/Textures/texture";

import { Sprite2D } from "../Sprite2D/sprite2D";
import { Matrix2D } from "../Math/matrix2D";
import type { ISprite2DRenderData } from "../Rendering/spriteBatchRenderer";

/**
 * A 9-slice (9-patch) sprite that can be resized without distorting its borders.
 *
 * The texture is divided into a 3×3 grid by border insets:
 * ```
 * ┌────────┬────────────┬────────┐
 * │ TL     │  Top Edge  │    TR  │  ← fixed height (borderTop)
 * ├────────┼────────────┼────────┤
 * │ Left   │   Center   │  Right │  ← stretches vertically
 * │ Edge   │ (stretches)│  Edge  │
 * ├────────┼────────────┼────────┤
 * │ BL     │  Bot Edge  │    BR  │  ← fixed height (borderBottom)
 * └────────┴────────────┴────────┘
 *   fixed     stretches    fixed
 *   width       ←→         width
 * ```
 *
 * The 4 corners maintain their original size, the 4 edges stretch in one
 * direction, and the center stretches in both directions.
 *
 * @example
 * ```typescript
 * const panel = new NineSliceSprite2D("panel", panelTexture);
 * panel.setBorders(16, 16, 16, 16); // 16px borders on all sides
 * panel.width = 300;
 * panel.height = 200;
 * ```
 */
export class NineSliceSprite2D extends Sprite2D {
    /**
     * Left border width in source pixels
     */
    public borderLeft: number = 0;

    /**
     * Right border width in source pixels
     */
    public borderRight: number = 0;

    /**
     * Top border height in source pixels
     */
    public borderTop: number = 0;

    /**
     * Bottom border height in source pixels
     */
    public borderBottom: number = 0;

    /**
     * Pre-allocated transform matrices for the 9 slices (avoids per-frame allocation)
     */
    private _sliceTransforms: Matrix2D[] = Array.from({ length: 9 }, () => Matrix2D.Identity());

    /**
     * Creates a new NineSliceSprite2D.
     * @param name - Node name
     * @param texture - The texture containing the 9-slice source graphic
     */
    constructor(name: string, texture?: BaseTexture) {
        super(name);
        if (texture) {
            this.texture = texture;
        }
    }

    /**
     * Sets all four border insets at once.
     * @param left - Left border width in source pixels
     * @param right - Right border width in source pixels
     * @param top - Top border height in source pixels
     * @param bottom - Bottom border height in source pixels
     * @returns This instance for chaining
     */
    public setBorders(left: number, right: number, top: number, bottom: number): this {
        this.borderLeft = left;
        this.borderRight = right;
        this.borderTop = top;
        this.borderBottom = bottom;
        return this;
    }

    /**
     * Sets uniform border insets (same on all sides).
     * @param size - Border size in source pixels
     * @returns This instance for chaining
     */
    public setUniformBorders(size: number): this {
        this.borderLeft = size;
        this.borderRight = size;
        this.borderTop = size;
        this.borderBottom = size;
        return this;
    }

    /** @internal */
    public override _collectRenderData(list: ISprite2DRenderData[], fallbackTexture: ThinTexture): void {
        const W = this.getDisplayWidth();
        const H = this.getDisplayHeight();
        if (W <= 0 || H <= 0) {
            return;
        }

        const tex = this.texture ?? fallbackTexture;
        const texSize = this.texture ? this.texture.getSize() : { width: 1, height: 1 };
        const texW = texSize.width;
        const texH = texSize.height;

        // Source rect in pixels (full texture if not set)
        const srcX = this.sourceRect ? this.sourceRect.x : 0;
        const srcY = this.sourceRect ? this.sourceRect.y : 0;
        const srcW = this.sourceRect ? this.sourceRect.width : texW;
        const srcH = this.sourceRect ? this.sourceRect.height : texH;

        // Clamp borders if panel is smaller than combined borders
        let bL = this.borderLeft;
        let bR = this.borderRight;
        let bT = this.borderTop;
        let bB = this.borderBottom;

        const hScale = bL + bR > W ? W / (bL + bR) : 1;
        const vScale = bT + bB > H ? H / (bT + bB) : 1;
        bL *= hScale;
        bR *= hScale;
        bT *= vScale;
        bB *= vScale;

        // Center slice display dimensions
        const cW = Math.max(0, W - bL - bR);
        const mH = Math.max(0, H - bT - bB);

        // Source border sizes (unscaled, in source texture pixels)
        const sL = this.borderLeft;
        const sR = this.borderRight;
        const sT = this.borderTop;
        const sB = this.borderBottom;
        const sCW = Math.max(0, srcW - sL - sR);
        const sMH = Math.max(0, srcH - sT - sB);

        // Common render data fields
        const m = this.worldTransform.m;
        const r = this.tint.r;
        const g = this.tint.g;
        const b = this.tint.b;
        const a = this.tint.a * this.worldAlpha;
        const zIndex = this.worldZIndex;
        const sortingLayer = this.sortingLayer;

        // 3 rows × 3 cols of slices
        // Each defined by: display offset (cx, cy), display size (sw, sh), source rect (px, py, pw, ph)
        const cols = [
            { x: -W / 2 + bL / 2, w: bL, sx: srcX, sw: sL },
            { x: -W / 2 + bL + cW / 2, w: cW, sx: srcX + sL, sw: sCW },
            { x: W / 2 - bR / 2, w: bR, sx: srcX + srcW - sR, sw: sR },
        ];
        const rows = [
            { y: -H / 2 + bT / 2, h: bT, sy: srcY, sh: sT },
            { y: -H / 2 + bT + mH / 2, h: mH, sy: srcY + sT, sh: sMH },
            { y: H / 2 - bB / 2, h: bB, sy: srcY + srcH - sB, sh: sB },
        ];

        let sliceIdx = 0;
        for (const row of rows) {
            for (const col of cols) {
                if (col.w <= 0 || row.h <= 0) {
                    sliceIdx++;
                    continue;
                }

                // Compute world transform for this slice (parent transform + local offset)
                const cx = col.x;
                const cy = row.y;
                const sliceTransform = this._sliceTransforms[sliceIdx];
                sliceTransform.m[0] = m[0];
                sliceTransform.m[1] = m[1];
                sliceTransform.m[2] = m[2];
                sliceTransform.m[3] = m[3];
                sliceTransform.m[4] = m[0] * cx + m[2] * cy + m[4];
                sliceTransform.m[5] = m[1] * cx + m[3] * cy + m[5];

                // Compute UV rect for this slice
                const cellU = texW > 0 ? col.sx / texW : 0;
                const cellV = texH > 0 ? row.sy / texH : 0;
                const cellW = texW > 0 ? col.sw / texW : 0;
                const cellH = texH > 0 ? row.sh / texH : 0;

                list.push({
                    worldTransform: sliceTransform,
                    width: col.w,
                    height: row.h,
                    r,
                    g,
                    b,
                    a,
                    cellU,
                    cellV,
                    cellW,
                    cellH,
                    flipX: this.flipX,
                    flipY: this.flipY,
                    invertY: this.texture instanceof Texture ? this.texture.invertY : true,
                    texture: tex,
                    zIndex,
                    sortingLayer,
                });
                sliceIdx++;
            }
        }
    }
}
