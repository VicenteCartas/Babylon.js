import { DynamicTexture } from "core/Materials/Textures/dynamicTexture";
import { Constants } from "core/Engines/constants";

import { Sprite2D } from "../Sprite2D/sprite2D";
import type { Scene2D } from "../Scene2D/scene2D";

/**
 * Options for configuring a Text2D node
 */
export interface IText2DOptions {
    /**
     * CSS font string (e.g., "24px Arial", "bold 16px monospace")
     */
    font?: string;

    /**
     * Fill color as a CSS color string (e.g., "#ffffff", "red", "rgba(0,0,0,0.5)")
     */
    color?: string;

    /**
     * Text alignment: "left", "center", or "right". Default: "left"
     */
    textAlign?: CanvasTextAlign;

    /**
     * Vertical alignment: "top", "middle", "bottom". Default: "top"
     */
    textBaseline?: CanvasTextBaseline;

    /**
     * Padding in pixels added around the text. Default: 2
     */
    padding?: number;
}

/**
 * A 2D text node that renders a string as a textured sprite.
 * Uses an off-screen canvas to rasterize text via the browser's
 * CanvasRenderingContext2D, then uploads the result as a texture.
 *
 * Inherits all Node2D/Sprite2D capabilities: position, rotation, scale,
 * alpha, tint, parent-child hierarchy, and camera transforms.
 *
 * @example
 * ```typescript
 * const label = new Text2D("score", "Score: 0", { font: "24px Arial", color: "#fff" });
 * label.position = new Vector2(10, 10);
 * ```
 */
export class Text2D extends Sprite2D {
    private _text: string;
    private _font: string;
    private _color: string;
    private _textAlign: CanvasTextAlign;
    private _textBaseline: CanvasTextBaseline;
    private _padding: number;
    private _dynamicTexture: DynamicTexture | null = null;
    private _needsRedraw: boolean = true;

    /**
     * Creates a new Text2D node
     * @param name - Node name / identifier
     * @param text - The text string to display
     * @param options - Optional styling configuration
     * @param scene - Optional Scene2D. If omitted, uses the last created Scene2D.
     */
    constructor(name: string, text: string = "", options?: IText2DOptions, scene?: Scene2D | null) {
        super(name, scene);
        this._text = text;
        this._font = options?.font ?? "16px sans-serif";
        this._color = options?.color ?? "#ffffff";
        this._textAlign = options?.textAlign ?? "left";
        this._textBaseline = options?.textBaseline ?? "top";
        this._padding = options?.padding ?? 4;
    }

    /**
     * The text string to display. Setting this triggers a texture re-render.
     */
    public get text(): string {
        return this._text;
    }

    public set text(value: string) {
        if (this._text !== value) {
            this._text = value;
            this._needsRedraw = true;
        }
    }

    /**
     * CSS font string. Setting this triggers a texture re-render.
     */
    public get font(): string {
        return this._font;
    }

    public set font(value: string) {
        if (this._font !== value) {
            this._font = value;
            this._needsRedraw = true;
        }
    }

    /**
     * Fill color as a CSS color string. Setting this triggers a texture re-render.
     */
    public get color(): string {
        return this._color;
    }

    public set color(value: string) {
        if (this._color !== value) {
            this._color = value;
            this._needsRedraw = true;
        }
    }

    /**
     * Text alignment. Setting this triggers a texture re-render.
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
     * Vertical alignment. Setting this triggers a texture re-render.
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
     * Updates the text texture if any property has changed.
     * Called automatically each frame via the scene update loop.
     * @param deltaTime - Time elapsed since last frame in seconds
     */
    public override update(deltaTime: number): void {
        if (this._needsRedraw) {
            this._renderText();
            this._needsRedraw = false;
        }
        super.update(deltaTime);
    }

    /**
     * Forces the text texture to be re-rendered immediately,
     * without waiting for the next update cycle.
     */
    public redraw(): void {
        this._renderText();
        this._needsRedraw = false;
    }

    /**
     * Renders the text string to the internal DynamicTexture
     */
    private _renderText(): void {
        if (!this._text) {
            this.width = 0;
            this.height = 0;
            return;
        }

        // Measure text using a temporary canvas context
        const measureCanvas = document.createElement("canvas");
        const measureCtx = measureCanvas.getContext("2d")!;
        measureCtx.font = this._font;
        const metrics = measureCtx.measureText(this._text);

        const textWidth = Math.ceil(metrics.width);
        // Use actual bounding box for precise sizing (fallback to estimate)
        let ascent: number;
        let descent: number;
        if (metrics.actualBoundingBoxAscent !== undefined && metrics.actualBoundingBoxDescent !== undefined) {
            ascent = Math.ceil(metrics.actualBoundingBoxAscent);
            descent = Math.ceil(metrics.actualBoundingBoxDescent);
        } else {
            const fontHeight = this._estimateFontHeight(measureCtx);
            ascent = Math.ceil(fontHeight * 0.8);
            descent = Math.ceil(fontHeight * 0.2);
        }

        const pad = this._padding;
        const texWidth = textWidth + pad * 2;
        const texHeight = ascent + descent + pad * 2;

        if (texWidth <= 0 || texHeight <= 0) {
            return;
        }

        // Create or resize the DynamicTexture
        if (this._dynamicTexture) {
            this._dynamicTexture.dispose();
        }

        // Always render with "alphabetic" baseline at a known y for pixel-perfect placement
        const drawCanvas = document.createElement("canvas");
        drawCanvas.width = texWidth;
        drawCanvas.height = texHeight;
        const ctx = drawCanvas.getContext("2d")!;

        ctx.clearRect(0, 0, texWidth, texHeight);
        ctx.font = this._font;
        ctx.fillStyle = this._color;
        ctx.textBaseline = "alphabetic";
        ctx.textAlign = this._textAlign;

        let x = pad;
        if (this._textAlign === "center") {
            x = texWidth / 2;
        } else if (this._textAlign === "right") {
            x = texWidth - pad;
        }

        // Place baseline so ascent sits exactly pad pixels from the top
        const y = pad + ascent;

        ctx.fillText(this._text, x, y);

        // Wrap in DynamicTexture and upload
        this._dynamicTexture = new DynamicTexture(
            this.name + "_tex",
            drawCanvas,
            null,
            false,
            Constants.TEXTURE_NEAREST_SAMPLINGMODE,
            Constants.TEXTUREFORMAT_RGBA,
            false
        );
        const engine = this.scene!.engine;
        this._dynamicTexture._texture = engine.createDynamicTexture(texWidth, texHeight, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE);
        (engine as any).updateDynamicTexture(this._dynamicTexture._texture, drawCanvas, false);

        // Assign to Sprite2D
        this.texture = this._dynamicTexture;
        this.width = texWidth;
        this.height = texHeight;
    }

    /**
     * Estimates the font height from font metrics
     */
    private _estimateFontHeight(ctx: CanvasRenderingContext2D): number {
        const metrics = ctx.measureText("Mg[");
        if (metrics.fontBoundingBoxAscent !== undefined && metrics.fontBoundingBoxDescent !== undefined) {
            return Math.ceil(metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) + 2;
        }
        // Fallback: parse font size from the CSS font string
        const match = this._font.match(/(\d+(?:\.\d+)?)\s*px/);
        return match ? Math.ceil(parseFloat(match[1]) * 1.2) + 2 : 16;
    }

    /**
     * Disposes this Text2D node and its internal texture
     */
    public override dispose(): void {
        if (this._dynamicTexture) {
            this._dynamicTexture.dispose();
            this._dynamicTexture = null;
        }
        super.dispose();
    }
}
