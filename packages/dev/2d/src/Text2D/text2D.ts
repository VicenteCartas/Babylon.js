import { Constants } from "core/Engines/constants";
import { DynamicTexture } from "core/Materials/Textures/dynamicTexture";
import { CeilingPOT } from "core/Misc/tools.functions";
import type { ThinTexture } from "core/Materials/Textures/thinTexture";

import type { Scene2D } from "../Scene2D/scene2D";
import { Sprite2D } from "../Sprite2D/sprite2D";
import { Rectangle2D } from "../Math/rectangle2D";

// Module-level shared canvases to avoid per-frame DOM allocations.
let _sharedMeasureCanvas: HTMLCanvasElement | null = null;
let _sharedMeasureCtx: CanvasRenderingContext2D | null = null;
let _sharedDrawCanvas: HTMLCanvasElement | null = null;
let _sharedDrawCtx: CanvasRenderingContext2D | null = null;

interface ITextLineLayout {
    text: string;
    width: number;
}

interface ITextLayoutMetrics {
    lines: ITextLineLayout[];
    maxLineWidth: number;
    lineHeightPx: number;
    singleLineHeight: number;
    ascent: number;
    descent: number;
    drawWidth: number;
    drawHeight: number;
    textOffsetX: number;
    textOffsetY: number;
}

/**
 * Drop-shadow options for Text2D rasterization.
 */
export interface ITextShadowOptions {
    /** Shadow color as a CSS color string. */
    color: string;
    /** Blur radius in pixels. */
    blur: number;
    /** Horizontal shadow offset in pixels. */
    offsetX: number;
    /** Vertical shadow offset in pixels. */
    offsetY: number;
}

/**
 * Options for configuring a Text2D node.
 */
export interface IText2DOptions {
    /** CSS font string (for example, "24px Arial" or "bold 16px monospace"). */
    font?: string;
    /** Fill color as a CSS color string. */
    color?: string;
    /** Text alignment. Default: "left". */
    textAlign?: CanvasTextAlign;
    /** Vertical text baseline. Default: "top". */
    textBaseline?: CanvasTextBaseline;
    /** Padding in pixels around the rendered text. Default: 4. */
    padding?: number;
    /** Outline/stroke color. Null disables the outline. */
    outlineColor?: string | null;
    /** Outline width in pixels. Default: 0. */
    outlineWidth?: number;
    /** Optional drop shadow. Null disables the shadow. */
    shadow?: ITextShadowOptions | null;
    /** Maximum line width in pixels before wrapping. 0 disables wrapping. */
    maxWidth?: number;
    /** Line spacing multiplier. Default: 1.2. */
    lineHeight?: number;
}

/**
 * Returns a lazily-created shared canvas context for text measurement.
 * @returns A reusable CanvasRenderingContext2D.
 * @internal
 */
function _getSharedMeasureCtx(): CanvasRenderingContext2D {
    if (!_sharedMeasureCtx) {
        _sharedMeasureCanvas = document.createElement("canvas");
        _sharedMeasureCtx = _sharedMeasureCanvas.getContext("2d")!;
    }

    return _sharedMeasureCtx;
}

/**
 * Returns a lazily-created shared canvas context for text drawing.
 * @returns A reusable CanvasRenderingContext2D.
 * @internal
 */
function _getSharedDrawCtx(): CanvasRenderingContext2D {
    if (!_sharedDrawCtx) {
        _sharedDrawCanvas = document.createElement("canvas");
        _sharedDrawCtx = _sharedDrawCanvas.getContext("2d")!;
    }

    return _sharedDrawCtx;
}

/**
 * Renders a text string as a sprite using the browser's Canvas 2D API.
 * The text is rasterized to an off-screen canvas and uploaded only when the
 * content or style changes.
 */
export class Text2D extends Sprite2D {
    private _text: string;
    private _font: string;
    private _color: string;
    private _textAlign: CanvasTextAlign;
    private _textBaseline: CanvasTextBaseline;
    private _padding: number;
    private _outlineColor: string | null;
    private _outlineWidth: number;
    private _shadow: ITextShadowOptions | null;
    private _maxWidth: number;
    private _lineHeight: number;
    private _dynamicTexture: DynamicTexture | null = null;
    private _needsRedraw: boolean = true;
    private _textSourceRect: Rectangle2D = new Rectangle2D();

    /**
     * Creates a new Text2D.
     * @param name - Node name.
     * @param text - The initial text content.
     * @param scene - Optional owning scene.
     * @param options - Optional styling configuration.
     */
    constructor(name: string, text: string = "", scene?: Scene2D | null, options?: IText2DOptions) {
        super(name, scene ?? undefined);

        this._text = text;
        this._font = options?.font ?? "16px sans-serif";
        this._color = options?.color ?? "#ffffff";
        this._textAlign = options?.textAlign ?? "left";
        this._textBaseline = options?.textBaseline ?? "top";
        this._padding = options?.padding ?? 4;
        this._outlineColor = options?.outlineColor ?? null;
        this._outlineWidth = options?.outlineWidth ?? 0;
        this._shadow = options?.shadow ?? null;
        this._maxWidth = options?.maxWidth ?? 0;
        this._lineHeight = options?.lineHeight ?? 1.2;
        this.sourceRect = this._textSourceRect;
        this._textSourceRect.width = 0;
        this._textSourceRect.height = 0;
    }

    /**
     * Current text content.
     */
    public get text(): string {
        return this._text;
    }

    public set text(value: string) {
        this.setText(value);
    }

    /**
     * CSS font string.
     */
    public get font(): string {
        return this._font;
    }

    public set font(value: string) {
        this.setFont(value);
    }

    /**
     * CSS fill color.
     */
    public get color(): string {
        return this._color;
    }

    public set color(value: string) {
        this.setColor(value);
    }

    /**
     * Text alignment.
     */
    public get textAlign(): CanvasTextAlign {
        return this._textAlign;
    }

    public set textAlign(value: CanvasTextAlign) {
        if (this._textAlign !== value) {
            this._textAlign = value;
            this._needsRedraw = true;
        }
    }

    /**
     * Text baseline.
     */
    public get textBaseline(): CanvasTextBaseline {
        return this._textBaseline;
    }

    public set textBaseline(value: CanvasTextBaseline) {
        if (this._textBaseline !== value) {
            this._textBaseline = value;
            this._needsRedraw = true;
        }
    }

    /**
     * Padding in pixels around the text.
     */
    public get padding(): number {
        return this._padding;
    }

    public set padding(value: number) {
        if (this._padding !== value) {
            this._padding = value;
            this._needsRedraw = true;
        }
    }

    /**
     * Outline/stroke color. Null disables outlining.
     */
    public get outlineColor(): string | null {
        return this._outlineColor;
    }

    public set outlineColor(value: string | null) {
        if (this._outlineColor !== value) {
            this._outlineColor = value;
            this._needsRedraw = true;
        }
    }

    /**
     * Outline width in pixels.
     */
    public get outlineWidth(): number {
        return this._outlineWidth;
    }

    public set outlineWidth(value: number) {
        if (this._outlineWidth !== value) {
            this._outlineWidth = value;
            this._needsRedraw = true;
        }
    }

    /**
     * Drop shadow options. Null disables the shadow.
     */
    public get shadow(): ITextShadowOptions | null {
        return this._shadow;
    }

    public set shadow(value: ITextShadowOptions | null) {
        if (this._shadow !== value) {
            this._shadow = value;
            this._needsRedraw = true;
        }
    }

    /**
     * Maximum width in pixels before text wraps. 0 disables wrapping.
     */
    public get maxWidth(): number {
        return this._maxWidth;
    }

    public set maxWidth(value: number) {
        if (this._maxWidth !== value) {
            this._maxWidth = value;
            this._needsRedraw = true;
        }
    }

    /**
     * Line spacing multiplier.
     */
    public get lineHeight(): number {
        return this._lineHeight;
    }

    public set lineHeight(value: number) {
        if (this._lineHeight !== value) {
            this._lineHeight = value;
            this._needsRedraw = true;
        }
    }

    /**
     * Updates the text content.
     * @param text - The new text content.
     * @returns Nothing.
     */
    public setText(text: string): void {
        if (this._text !== text) {
            this._text = text;
            this._needsRedraw = true;
        }
    }

    /**
     * Updates the CSS font string.
     * @param font - The new font string.
     * @returns Nothing.
     */
    public setFont(font: string): void {
        if (this._font !== font) {
            this._font = font;
            this._needsRedraw = true;
        }
    }

    /**
     * Updates the fill color.
     * @param color - The new fill color.
     * @returns Nothing.
     */
    public setColor(color: string): void {
        if (this._color !== color) {
            this._color = color;
            this._needsRedraw = true;
        }
    }

    /**
     * Returns the rendered width of the current text in pixels.
     * @returns The measured rendered width.
     */
    public getMeasuredWidth(): number {
        if (!this._text) {
            return 0;
        }

        const layout = this._measureLayout();
        return layout.drawWidth;
    }

    /**
     * Forces the text texture to be re-rasterized immediately.
     * @returns Nothing.
     */
    public redraw(): void {
        this._rasterize();
    }

    /**
     * Collects render data for this text sprite.
     * @param list - Array to push render data into.
     * @param fallbackTexture - White texture fallback when no dynamic texture is available.
     * @internal
     */
    public override _collectRenderData(list: Parameters<Sprite2D["_collectRenderData"]>[0], fallbackTexture: ThinTexture): void {
        if (this._needsRedraw) {
            this._rasterize();
        }

        super._collectRenderData(list, fallbackTexture);
    }

    /**
     * Disposes this Text2D node and its internal DynamicTexture.
     * @returns Nothing.
     */
    public override dispose(): void {
        if (this._dynamicTexture) {
            this._dynamicTexture.dispose();
            this._dynamicTexture = null;
        }

        super.dispose();
    }

    private _measureLayout(): ITextLayoutMetrics {
        const ctx = _getSharedMeasureCtx();
        ctx.font = this._font;

        const lines = this._layoutLines(ctx);
        const singleLineHeight = this._estimateFontHeight(ctx);
        const sampleMetrics = ctx.measureText("Mg[");
        const ascent = sampleMetrics.actualBoundingBoxAscent !== undefined ? Math.ceil(sampleMetrics.actualBoundingBoxAscent) : Math.ceil(singleLineHeight * 0.8);
        const descent = sampleMetrics.actualBoundingBoxDescent !== undefined ? Math.ceil(sampleMetrics.actualBoundingBoxDescent) : Math.max(1, singleLineHeight - ascent);
        const lineHeightPx = Math.max(1, Math.ceil(singleLineHeight * this._lineHeight));

        let maxLineWidth = 0;
        for (const line of lines) {
            if (line.width > maxLineWidth) {
                maxLineWidth = line.width;
            }
        }

        const lineCount = lines.length;
        const textBlockHeight = lineCount > 0 ? singleLineHeight + Math.max(0, lineCount - 1) * lineHeightPx : 0;
        const outlineInset = this._outlineColor !== null && this._outlineWidth > 0 ? this._outlineWidth : 0;
        const shadowBlur = this._shadow ? Math.max(0, this._shadow.blur) : 0;
        const shadowOffsetX = this._shadow ? this._shadow.offsetX : 0;
        const shadowOffsetY = this._shadow ? this._shadow.offsetY : 0;
        const leftInset = Math.ceil(this._padding + outlineInset + Math.max(0, shadowBlur - shadowOffsetX));
        const rightInset = Math.ceil(this._padding + outlineInset + Math.max(0, shadowBlur + shadowOffsetX));
        const topInset = Math.ceil(this._padding + outlineInset + Math.max(0, shadowBlur - shadowOffsetY));
        const bottomInset = Math.ceil(this._padding + outlineInset + Math.max(0, shadowBlur + shadowOffsetY));

        return {
            lines,
            maxLineWidth,
            lineHeightPx,
            singleLineHeight,
            ascent,
            descent,
            drawWidth: Math.ceil(maxLineWidth + leftInset + rightInset),
            drawHeight: Math.ceil(textBlockHeight + topInset + bottomInset),
            textOffsetX: leftInset,
            textOffsetY: topInset,
        };
    }

    private _layoutLines(ctx: CanvasRenderingContext2D): ITextLineLayout[] {
        const result: ITextLineLayout[] = [];
        const rawLines = this._text.split(/\r?\n/);

        for (const rawLine of rawLines) {
            if (this._maxWidth > 0) {
                this._appendWrappedLine(rawLine, ctx, result);
            } else {
                result.push({
                    text: rawLine,
                    width: Math.ceil(ctx.measureText(rawLine).width),
                });
            }
        }

        return result;
    }

    private _appendWrappedLine(line: string, ctx: CanvasRenderingContext2D, result: ITextLineLayout[]): void {
        if (line.length === 0) {
            result.push({ text: "", width: 0 });
            return;
        }

        const tokens = line.split(/(\s+)/);
        let current = "";

        for (const token of tokens) {
            if (token.length === 0) {
                continue;
            }

            const candidate = current + token;
            if (current.length === 0) {
                if (ctx.measureText(token).width <= this._maxWidth) {
                    current = token;
                } else {
                    this._appendHardWrappedText(token, ctx, result);
                }
                continue;
            }

            if (ctx.measureText(candidate).width <= this._maxWidth) {
                current = candidate;
                continue;
            }

            result.push({ text: current, width: Math.ceil(ctx.measureText(current).width) });
            if (token.trim().length === 0) {
                current = "";
            } else if (ctx.measureText(token).width <= this._maxWidth) {
                current = token;
            } else {
                this._appendHardWrappedText(token, ctx, result);
                current = "";
            }
        }

        if (current.length > 0) {
            result.push({ text: current, width: Math.ceil(ctx.measureText(current).width) });
        }
    }

    private _appendHardWrappedText(text: string, ctx: CanvasRenderingContext2D, result: ITextLineLayout[]): void {
        let current = "";

        for (const character of text) {
            const candidate = current + character;
            if (current.length > 0 && ctx.measureText(candidate).width > this._maxWidth) {
                result.push({ text: current, width: Math.ceil(ctx.measureText(current).width) });
                current = character;
            } else {
                current = candidate;
            }
        }

        if (current.length > 0) {
            result.push({ text: current, width: Math.ceil(ctx.measureText(current).width) });
        }
    }

    private _rasterize(): void {
        if (!this._text) {
            this.width = 0;
            this.height = 0;
            this._textSourceRect.width = 0;
            this._textSourceRect.height = 0;
            this._needsRedraw = false;
            return;
        }

        const layout = this._measureLayout();
        if (layout.drawWidth <= 0 || layout.drawHeight <= 0) {
            this.width = 0;
            this.height = 0;
            this._textSourceRect.width = 0;
            this._textSourceRect.height = 0;
            this._needsRedraw = false;
            return;
        }

        const textureWidth = Math.max(1, CeilingPOT(layout.drawWidth));
        const textureHeight = Math.max(1, CeilingPOT(layout.drawHeight));
        const ctx = _getSharedDrawCtx();
        const drawCanvas = _sharedDrawCanvas!;
        drawCanvas.width = textureWidth;
        drawCanvas.height = textureHeight;
        ctx.clearRect(0, 0, textureWidth, textureHeight);
        ctx.font = this._font;
        ctx.fillStyle = this._color;
        ctx.textAlign = this._textAlign;
        ctx.textBaseline = this._textBaseline;

        if (this._shadow) {
            ctx.shadowColor = this._shadow.color;
            ctx.shadowBlur = this._shadow.blur;
            ctx.shadowOffsetX = this._shadow.offsetX;
            ctx.shadowOffsetY = this._shadow.offsetY;
        } else {
            ctx.shadowColor = "rgba(0, 0, 0, 0)";
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        }

        if (this._outlineColor !== null && this._outlineWidth > 0) {
            ctx.strokeStyle = this._outlineColor;
            ctx.lineWidth = this._outlineWidth;
            ctx.lineJoin = "round";
        }

        for (let index = 0; index < layout.lines.length; index++) {
            const line = layout.lines[index];
            const x = this._getLineDrawX(layout);
            const y = this._getLineDrawY(layout, index);

            if (this._outlineColor !== null && this._outlineWidth > 0) {
                ctx.strokeText(line.text, x, y, this._maxWidth > 0 ? this._maxWidth : undefined);
            }
            ctx.fillText(line.text, x, y, this._maxWidth > 0 ? this._maxWidth : undefined);
        }

        this.width = layout.drawWidth;
        this.height = layout.drawHeight;
        this._textSourceRect.x = 0;
        this._textSourceRect.y = 0;
        this._textSourceRect.width = layout.drawWidth;
        this._textSourceRect.height = layout.drawHeight;

        const scene = this.scene;
        if (!scene) {
            return;
        }

        const engine = scene.engine;
        const existingTexture = this._dynamicTexture;
        const existingSize = existingTexture ? existingTexture.getSize() : null;
        const canReuse = existingSize !== null && existingSize.width === textureWidth && existingSize.height === textureHeight;

        if (!canReuse) {
            if (existingTexture) {
                existingTexture.dispose();
            }

            this._dynamicTexture = new DynamicTexture(
                this.name + "_tex",
                drawCanvas,
                null,
                false,
                Constants.TEXTURE_NEAREST_SAMPLINGMODE,
                Constants.TEXTUREFORMAT_RGBA,
                false
            );
            this._dynamicTexture._texture = engine.createDynamicTexture(textureWidth, textureHeight, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE);
            this.texture = this._dynamicTexture;
        }

        engine.updateDynamicTexture(this._dynamicTexture!._texture, drawCanvas, false);
        this._needsRedraw = false;
    }

    private _getLineDrawX(layout: ITextLayoutMetrics): number {
        if (this._textAlign === "center") {
            return layout.textOffsetX + layout.maxLineWidth / 2;
        }
        if (this._textAlign === "right") {
            return layout.textOffsetX + layout.maxLineWidth;
        }
        return layout.textOffsetX;
    }

    private _getLineDrawY(layout: ITextLayoutMetrics, lineIndex: number): number {
        const lineTop = layout.textOffsetY + lineIndex * layout.lineHeightPx;
        if (this._textBaseline === "middle") {
            return lineTop + layout.singleLineHeight / 2;
        }
        if (this._textBaseline === "bottom") {
            return lineTop + layout.singleLineHeight;
        }
        return lineTop;
    }

    /**
     * Estimates font height from font metrics.
     * @param ctx - Measurement context.
     * @returns Estimated font height in pixels.
     */
    private _estimateFontHeight(ctx: CanvasRenderingContext2D): number {
        const metrics = ctx.measureText("Mg[");
        if (metrics.fontBoundingBoxAscent !== undefined && metrics.fontBoundingBoxDescent !== undefined) {
            return Math.ceil(metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) + 2;
        }

        const match = this._font.match(/(\d+(?:\.\d+)?)\s*px/);
        return match ? Math.ceil(parseFloat(match[1]) * 1.2) + 2 : 16;
    }
}
