import type { AbstractEngine } from "core/Engines/abstractEngine";
import { Constants } from "core/Engines/constants";
import { HtmlElementTexture } from "core/Materials/Textures/htmlElementTexture";
import type { ThinTexture } from "core/Materials/Textures/thinTexture";
import { Texture } from "core/Materials/Textures/texture";
import { Color4 } from "core/Maths/math.color";
import { Tools } from "core/Misc/tools";

import { Matrix2D } from "../Math/matrix2D";
import type { Rectangle2D } from "../Math/rectangle2D";
import { RenderableNode2D } from "../Node2D/renderableNode2D";
import type { ISprite2DRenderData } from "../Rendering/spriteBatchRenderer";
import type { Scene2D } from "../Scene2D/scene2D";

/** Character definition from an AngelCode BMFont descriptor. */
export interface IBitmapFontCharDef {
    /** Unicode char code. */
    id: number;
    /** X coordinate in the atlas page in pixels. */
    x: number;
    /** Y coordinate in the atlas page in pixels. */
    y: number;
    /** Glyph width in pixels. */
    width: number;
    /** Glyph height in pixels. */
    height: number;
    /** Horizontal bearing in pixels. */
    xoffset: number;
    /** Vertical bearing in pixels. */
    yoffset: number;
    /** Cursor advance in pixels. */
    xadvance: number;
    /** Atlas page index. */
    page: number;
}

/** Parsed BMFont data shared by BitmapFont2D instances. */
export interface IBitmapFontData {
    /** Native line height in atlas pixels. */
    lineHeight: number;
    /** Baseline position in atlas pixels. */
    base: number;
    /** Texture page file names. */
    pages: string[];
    /** Character definitions. */
    chars: IBitmapFontCharDef[];
    /** Kerning pairs. */
    kernings: Array<{ first: number; second: number; amount: number }>;
}

interface IParsedBitmapFontSource {
    data: IBitmapFontData;
    isMsdf: boolean;
    msdfDistanceRange: number;
}

interface IBitmapFontLayoutLine {
    width: number;
}

interface IBitmapFontJsonData {
    common?: {
        lineHeight?: number;
        base?: number;
    };
    pages?: string[];
    chars?: Array<{
        id: number;
        x: number;
        y: number;
        width: number;
        height: number;
        xoffset: number;
        yoffset: number;
        xadvance: number;
        page?: number;
    }>;
    kernings?: Array<{ first: number; second: number; amount: number }>;
    distanceField?: {
        fieldType?: string;
        distanceRange?: number;
    };
}

/**
 * BMFont atlas and metrics used by BitmapFont2DText.
 */
export class BitmapFont2D {
    private readonly _textures: ThinTexture[];
    private readonly _chars: Map<number, IBitmapFontCharDef> = new Map();
    private readonly _kerning: Map<string, number> = new Map();
    private _ownsTextures: boolean = false;
    private _msdfDistanceRange: number = 4;

    /** The font's native line height in atlas pixels. */
    public readonly lineHeight: number;

    /** Whether the atlas was authored as an MSDF font. */
    public readonly isMsdf: boolean;

    /**
     * Creates a new BitmapFont2D.
     * @param data - Parsed font metrics.
     * @param textures - Atlas page textures.
     * @param isMsdf - Whether the atlas is an MSDF font.
     */
    constructor(data: IBitmapFontData, textures: ThinTexture[], isMsdf: boolean = false) {
        this.lineHeight = data.lineHeight;
        this.isMsdf = isMsdf;
        this._textures = textures.slice();

        for (const charDef of data.chars) {
            this._chars.set(charDef.id, { ...charDef });
        }

        for (const kerning of data.kernings) {
            this._kerning.set(BitmapFont2D._getKerningKey(kerning.first, kerning.second), kerning.amount);
        }
    }

    /**
     * Loads a BMFont descriptor and its page textures.
     * @param url - URL to the `.fnt` or `.json` descriptor.
     * @param engine - Babylon engine used to create textures.
     * @returns A promise resolving to the loaded font.
     */
    public static async loadAsync(url: string, engine: AbstractEngine): Promise<BitmapFont2D> {
        const text = await Tools.LoadFileAsync(url, false);
        const parsed = BitmapFont2D._parseDescriptor(text, url);
        const baseUrl = BitmapFont2D._getDirectoryUrl(url);
        const textures = await Promise.all(parsed.data.pages.map((page) => BitmapFont2D._loadTextureAsync(BitmapFont2D._resolveUrl(baseUrl, page), engine)));
        const font = new BitmapFont2D(parsed.data, textures, parsed.isMsdf);
        font._ownsTextures = true;
        font._msdfDistanceRange = parsed.msdfDistanceRange;
        return font;
    }

    /**
     * Measures the rendered width of a string at the supplied font size.
     * @param text - Text to measure.
     * @param fontSize - Desired rendered font size in pixels.
     * @returns The maximum line width in pixels.
     */
    public measureText(text: string, fontSize: number): number {
        if (!text || this.lineHeight <= 0 || fontSize <= 0) {
            return 0;
        }

        const scale = fontSize / this.lineHeight;
        let maxWidth = 0;
        let cursor = 0;
        let lineWidth = 0;
        let previousCharCode = -1;

        for (let index = 0; index < text.length; index++) {
            const charCode = text.charCodeAt(index);
            if (charCode === 10) {
                if (lineWidth > maxWidth) {
                    maxWidth = lineWidth;
                }
                cursor = 0;
                lineWidth = 0;
                previousCharCode = -1;
                continue;
            }

            const charDef = this.getChar(charCode);
            if (!charDef) {
                continue;
            }

            cursor += this.getKerning(previousCharCode, charCode) * scale;
            const glyphLeft = cursor + charDef.xoffset * scale;
            const glyphRight = glyphLeft + charDef.width * scale;
            if (glyphRight > lineWidth) {
                lineWidth = glyphRight;
            }
            cursor += charDef.xadvance * scale;
            previousCharCode = charCode;
        }

        return lineWidth > maxWidth ? lineWidth : maxWidth;
    }

    /**
     * Returns the character definition for the supplied character code.
     * @param charCode - Unicode character code.
     * @returns The character definition, or null when absent.
     */
    public getChar(charCode: number): IBitmapFontCharDef | null {
        return this._chars.get(charCode) ?? null;
    }

    /**
     * Releases owned atlas textures.
     * @returns Nothing.
     */
    public dispose(): void {
        if (!this._ownsTextures) {
            return;
        }

        for (const texture of this._textures) {
            texture.dispose();
        }
        this._ownsTextures = false;
    }

    /**
     * Returns a kerning amount for a glyph pair.
     * @param first - Previous glyph code.
     * @param second - Current glyph code.
     * @returns Kerning amount in atlas pixels.
     * @internal
     */
    public getKerning(first: number, second: number): number {
        if (first < 0 || second < 0) {
            return 0;
        }
        return this._kerning.get(BitmapFont2D._getKerningKey(first, second)) ?? 0;
    }

    /**
     * Returns the texture page for the supplied page index.
     * @param pageIndex - Atlas page index.
     * @returns The texture page, or null when unavailable.
     * @internal
     */
    public getPageTexture(pageIndex: number): ThinTexture | null {
        return this._textures[pageIndex] ?? null;
    }

    /**
     * Computes the MSDF screen pixel range for the supplied font size.
     * @param fontSize - Desired rendered font size in pixels.
     * @returns A positive MSDF screen pixel range.
     * @internal
     */
    public getMsdfScreenPxRange(fontSize: number): number {
        if (!this.isMsdf || this.lineHeight <= 0 || fontSize <= 0) {
            return 0;
        }

        return Math.max(1, (fontSize / this.lineHeight) * this._msdfDistanceRange);
    }

    private static _getKerningKey(first: number, second: number): string {
        return `${first}:${second}`;
    }

    private static _parseDescriptor(text: string, url: string): IParsedBitmapFontSource {
        const trimmed = text.trimStart();
        if (trimmed.startsWith("{")) {
            return BitmapFont2D._parseJsonDescriptor(JSON.parse(text) as IBitmapFontJsonData);
        }

        if (trimmed.startsWith("<")) {
            throw new Error(`Unsupported BMFont XML descriptor: ${url}`);
        }

        return BitmapFont2D._parseTextDescriptor(text);
    }

    private static _parseJsonDescriptor(data: IBitmapFontJsonData): IParsedBitmapFontSource {
        return {
            data: {
                lineHeight: data.common?.lineHeight ?? 0,
                base: data.common?.base ?? 0,
                pages: data.pages ? data.pages.slice() : [],
                chars: data.chars ? data.chars.map((charDef) => ({
                    id: charDef.id,
                    x: charDef.x,
                    y: charDef.y,
                    width: charDef.width,
                    height: charDef.height,
                    xoffset: charDef.xoffset,
                    yoffset: charDef.yoffset,
                    xadvance: charDef.xadvance,
                    page: charDef.page ?? 0,
                })) : [],
                kernings: data.kernings ? data.kernings.map((kerning) => ({
                    first: kerning.first,
                    second: kerning.second,
                    amount: kerning.amount,
                })) : [],
            },
            isMsdf: data.distanceField?.fieldType?.toLowerCase() === "msdf",
            msdfDistanceRange: data.distanceField?.distanceRange ?? 4,
        };
    }

    private static _parseTextDescriptor(text: string): IParsedBitmapFontSource {
        const pages = new Map<number, string>();
        const chars: IBitmapFontCharDef[] = [];
        const kernings: Array<{ first: number; second: number; amount: number }> = [];
        let lineHeight = 0;
        let base = 0;
        let isMsdf = false;
        let msdfDistanceRange = 4;

        const lines = text.split(/\r?\n/);
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (line.length === 0) {
                continue;
            }

            const firstSpace = line.indexOf(" ");
            const tag = firstSpace >= 0 ? line.slice(0, firstSpace) : line;
            const attributeText = firstSpace >= 0 ? line.slice(firstSpace + 1) : "";
            const attributes = BitmapFont2D._parseAttributes(attributeText);

            switch (tag) {
                case "common": {
                    lineHeight = BitmapFont2D._parseInt(attributes.get("lineHeight"), 0);
                    base = BitmapFont2D._parseInt(attributes.get("base"), 0);
                    break;
                }
                case "page": {
                    const id = BitmapFont2D._parseInt(attributes.get("id"), pages.size);
                    const file = BitmapFont2D._stripQuotes(attributes.get("file") ?? "");
                    pages.set(id, file);
                    break;
                }
                case "char": {
                    chars.push({
                        id: BitmapFont2D._parseInt(attributes.get("id"), 0),
                        x: BitmapFont2D._parseInt(attributes.get("x"), 0),
                        y: BitmapFont2D._parseInt(attributes.get("y"), 0),
                        width: BitmapFont2D._parseInt(attributes.get("width"), 0),
                        height: BitmapFont2D._parseInt(attributes.get("height"), 0),
                        xoffset: BitmapFont2D._parseInt(attributes.get("xoffset"), 0),
                        yoffset: BitmapFont2D._parseInt(attributes.get("yoffset"), 0),
                        xadvance: BitmapFont2D._parseInt(attributes.get("xadvance"), 0),
                        page: BitmapFont2D._parseInt(attributes.get("page"), 0),
                    });
                    break;
                }
                case "kerning": {
                    kernings.push({
                        first: BitmapFont2D._parseInt(attributes.get("first"), 0),
                        second: BitmapFont2D._parseInt(attributes.get("second"), 0),
                        amount: BitmapFont2D._parseInt(attributes.get("amount"), 0),
                    });
                    break;
                }
                case "distanceField": {
                    isMsdf = BitmapFont2D._stripQuotes(attributes.get("fieldType") ?? "").toLowerCase() === "msdf";
                    msdfDistanceRange = BitmapFont2D._parseInt(attributes.get("distanceRange"), 4);
                    break;
                }
            }
        }

        const orderedPages: string[] = [];
        for (const [pageIndex, file] of pages.entries()) {
            orderedPages[pageIndex] = file;
        }

        return {
            data: {
                lineHeight,
                base,
                pages: orderedPages,
                chars,
                kernings,
            },
            isMsdf,
            msdfDistanceRange,
        };
    }

    private static _parseAttributes(text: string): Map<string, string> {
        const attributes = new Map<string, string>();
        const regex = /([a-zA-Z][\w-]*)=([^\s]+|"[^"]*")/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            attributes.set(match[1], match[2]);
        }
        return attributes;
    }

    private static _parseInt(value: string | undefined, fallback: number): number {
        if (value === undefined) {
            return fallback;
        }

        const parsed = parseInt(BitmapFont2D._stripQuotes(value), 10);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    private static _stripQuotes(value: string): string {
        return value.startsWith("\"") && value.endsWith("\"") ? value.slice(1, -1) : value;
    }

    private static _getDirectoryUrl(url: string): string {
        const lastSlashIndex = Math.max(url.lastIndexOf("/"), url.lastIndexOf("\\"));
        if (lastSlashIndex < 0) {
            return "";
        }

        return url.slice(0, lastSlashIndex + 1);
    }

    private static _resolveUrl(baseUrl: string, relativeUrl: string): string {
        if (/^(?:[a-z]+:)?\/\//i.test(relativeUrl) || relativeUrl.startsWith("data:")) {
            return relativeUrl;
        }

        if (!baseUrl) {
            return relativeUrl;
        }

        try {
            return new URL(relativeUrl, baseUrl).toString();
        } catch {
            if (baseUrl.endsWith("/") || baseUrl.endsWith("\\")) {
                return `${baseUrl}${relativeUrl}`;
            }
            return `${baseUrl}/${relativeUrl}`;
        }
    }

    private static _loadTextureAsync(url: string, engine: AbstractEngine): Promise<HtmlElementTexture> {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = "anonymous";
            image.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = image.width;
                canvas.height = image.height;
                const context = canvas.getContext("2d");
                if (!context) {
                    reject(new Error("Failed to get 2D canvas context for BMFont texture."));
                    return;
                }

                context.drawImage(image, 0, 0);
                const texture = new HtmlElementTexture("BitmapFont2D", canvas, {
                    generateMipMaps: false,
                    samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
                    format: Constants.TEXTUREFORMAT_RGBA,
                    engine,
                    scene: null,
                });
                texture.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
                texture.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
                resolve(texture);
            };
            image.onerror = () => {
                reject(new Error(`Failed to load BMFont page texture image: ${url}`));
            };
            image.src = url;
        });
    }
}

/**
 * Scene-graph text node backed by a BitmapFont2D atlas.
 */
export class BitmapFont2DText extends RenderableNode2D {
    private _text: string;
    private _font: BitmapFont2D;
    private _fontSize: number;
    private _letterSpacing: number = 0;
    private _lineHeight: number = 1;
    private _textAlign: "left" | "center" | "right" = "left";
    private _glyphTransforms: Matrix2D[] = [];
    private _glyphRenderDataPool: ISprite2DRenderData[] = [];
    private _lineLayouts: IBitmapFontLayoutLine[] = [];
    private _measuredLineCount: number = 0;

    /** Color tint applied to all glyphs. */
    public tint: Color4 = new Color4(1, 1, 1, 1);

    /** Alpha blend mode for glyph rendering. */
    public alphaMode: number = Constants.ALPHA_COMBINE;

    /**
     * Creates a new BitmapFont2DText node.
     * @param name - Node name.
     * @param font - Bitmap font atlas and metrics.
     * @param text - Initial text content.
     * @param scene - Optional owning scene.
     */
    constructor(name: string, font: BitmapFont2D, text: string, scene?: Scene2D | null) {
        super(name, scene);
        this._font = font;
        this._text = text;
        this._fontSize = font.lineHeight;
    }

    /** The font used for rendering. */
    public get font(): BitmapFont2D {
        return this._font;
    }

    public set font(value: BitmapFont2D) {
        if (this._font === value) {
            return;
        }

        this._font = value;
        if (this._fontSize <= 0) {
            this._fontSize = value.lineHeight;
        }
    }

    /** The displayed text. */
    public get text(): string {
        return this._text;
    }

    /** Font size in pixels. */
    public get fontSize(): number {
        return this._fontSize;
    }

    public set fontSize(value: number) {
        this._fontSize = value;
    }

    /** Additional spacing between glyph advances in pixels. */
    public get letterSpacing(): number {
        return this._letterSpacing;
    }

    public set letterSpacing(value: number) {
        this._letterSpacing = value;
    }

    /** Line spacing multiplier. */
    public get lineHeight(): number {
        return this._lineHeight;
    }

    public set lineHeight(value: number) {
        this._lineHeight = value;
    }

    /** Horizontal text alignment. */
    public get textAlign(): "left" | "center" | "right" {
        return this._textAlign;
    }

    public set textAlign(value: "left" | "center" | "right") {
        this._textAlign = value;
    }

    /**
     * Updates the displayed text.
     * @param text - New text content.
     * @returns Nothing.
     */
    public setText(text: string): void {
        if (this._text !== text) {
            this._text = text;
        }
    }

    /**
     * Measures the current text width in pixels.
     * @returns The measured width.
     */
    public getMeasuredWidth(): number {
        const lineLayouts = this._measureLines();
        let maxWidth = 0;
        for (let i = 0; i < this._measuredLineCount; i++) {
            const lineWidth = lineLayouts[i].width;
            if (lineWidth > maxWidth) {
                maxWidth = lineWidth;
            }
        }
        return maxWidth;
    }

    /**
     * Measures the current text height in pixels.
     * @returns The measured height.
     */
    public getMeasuredHeight(): number {
        if (!this._text || this._fontSize <= 0) {
            return 0;
        }

        const lineCount = this._measureLines().length;
        if (lineCount <= 0) {
            return 0;
        }

        return this._fontSize + Math.max(0, lineCount - 1) * this._fontSize * this._lineHeight;
    }

    /**
     * Resolves this text node's local bounds for RectMask2D owner fallback.
     * @param out - Rectangle receiving the bounds.
     * @returns True when bounds were written.
     * @internal
     */
    public override _getMaskLocalBounds(out: Rectangle2D): boolean {
        const width = this.getMeasuredWidth();
        const height = this.getMeasuredHeight();
        if (width <= 0 || height <= 0) {
            return false;
        }

        out.set(this._getAlignedOffset(width), 0, width, height);
        return true;
    }

    /**
     * Collects sprite render data for the current glyphs.
     * @param list - Output render-data list.
     * @param _fallbackTexture - Unused fallback texture required by the scene collector signature.
     * @returns Nothing.
     * @internal
     */
    public override _collectRenderData(list: ISprite2DRenderData[], _fallbackTexture: ThinTexture): void {
        this._appendRenderData(list, this.worldAlpha, this.worldScrollFactorX, this.worldScrollFactorY, this.worldZIndex, 0, (index) => {
            let renderData = this._glyphRenderDataPool[index];
            if (!renderData) {
                renderData = {} as ISprite2DRenderData;
                this._glyphRenderDataPool[index] = renderData;
            }
            list.push(renderData);
            return renderData;
        });
    }

    /**
     * Appends this node's glyph render data into reusable structs.
     * @param list - Output list.
     * @param worldAlpha - Resolved world alpha.
     * @param worldScrollFactorX - Resolved world scroll factor X.
     * @param worldScrollFactorY - Resolved world scroll factor Y.
     * @param worldZIndex - Resolved world z-index.
     * @param insertionOrderStart - Starting insertion-order value.
     * @param allocator - Allocator for reusable render-data entries.
     * @returns The number of emitted glyph quads.
     * @internal
     */
    public _appendRenderData(
        list: ISprite2DRenderData[],
        worldAlpha: number,
        worldScrollFactorX: number,
        worldScrollFactorY: number,
        worldZIndex: number,
        insertionOrderStart: number,
        allocator: (index: number) => ISprite2DRenderData
    ): number {
        void list;
        if (!this._text || this._fontSize <= 0 || this._font.lineHeight <= 0) {
            return 0;
        }

        const scale = this._fontSize / this._font.lineHeight;
        const lineLayouts = this._measureLines();
        const worldTransform = this.worldTransform.m;
        const tintR = this.tint.r;
        const tintG = this.tint.g;
        const tintB = this.tint.b;
        const tintA = this.tint.a * worldAlpha;
        const lineAdvance = this._fontSize * this._lineHeight;
        const sortingLayer = this.sortingLayer;
        const sortKey = (sortingLayer << 16) | (worldZIndex & 0xffff);
        const msdf = this._font.isMsdf;
        const msdfScreenPxRange = msdf ? this._font.getMsdfScreenPxRange(this._fontSize) : 0;

        let cursorX = 0;
        let lineIndex = 0;
        let lineY = 0;
        let previousCharCode = -1;
        let emittedCount = 0;

        for (let index = 0; index < this._text.length; index++) {
            const charCode = this._text.charCodeAt(index);
            if (charCode === 10) {
                cursorX = 0;
                lineIndex++;
                lineY += lineAdvance;
                previousCharCode = -1;
                continue;
            }

            const charDef = this._font.getChar(charCode);
            if (!charDef) {
                continue;
            }

            const texture = this._font.getPageTexture(charDef.page);
            if (!texture) {
                previousCharCode = charCode;
                continue;
            }

            cursorX += this._font.getKerning(previousCharCode, charCode) * scale;

            const glyphWidth = charDef.width * scale;
            const glyphHeight = charDef.height * scale;
            if (glyphWidth <= 0 || glyphHeight <= 0) {
                cursorX += (charDef.xadvance + this._letterSpacing) * scale;
                previousCharCode = charCode;
                continue;
            }

            const lineWidth = lineLayouts[lineIndex]?.width ?? 0;
            const alignOffsetX = this._getAlignedOffset(lineWidth);
            const centerX = alignOffsetX + cursorX + charDef.xoffset * scale + glyphWidth * 0.5;
            const centerY = lineY + charDef.yoffset * scale + glyphHeight * 0.5;

            let glyphTransform = this._glyphTransforms[emittedCount];
            if (!glyphTransform) {
                glyphTransform = Matrix2D.Identity();
                this._glyphTransforms[emittedCount] = glyphTransform;
            }
            glyphTransform.m[0] = worldTransform[0];
            glyphTransform.m[1] = worldTransform[1];
            glyphTransform.m[2] = worldTransform[2];
            glyphTransform.m[3] = worldTransform[3];
            glyphTransform.m[4] = worldTransform[0] * centerX + worldTransform[2] * centerY + worldTransform[4];
            glyphTransform.m[5] = worldTransform[1] * centerX + worldTransform[3] * centerY + worldTransform[5];

            const textureSize = texture.getSize();
            const textureWidth = textureSize.width;
            const textureHeight = textureSize.height;
            const invertY = texture instanceof Texture ? texture.invertY : true;
            const u0 = textureWidth > 0 ? charDef.x / textureWidth : 0;
            const u1 = textureWidth > 0 ? (charDef.x + charDef.width) / textureWidth : 1;
            let v0 = 0;
            let v1 = 1;
            if (textureHeight > 0) {
                const sourceTop = charDef.y / textureHeight;
                const sourceBottom = (charDef.y + charDef.height) / textureHeight;
                if (invertY) {
                    v0 = 1 - sourceTop;
                    v1 = 1 - sourceBottom;
                } else {
                    v0 = sourceTop;
                    v1 = sourceBottom;
                }
            }

            const renderData = allocator(emittedCount);
            const color: [number, number, number, number] = renderData.color ?? [1, 1, 1, 1];
            color[0] = tintR;
            color[1] = tintG;
            color[2] = tintB;
            color[3] = tintA;

            const packedUvs: [number, number, number, number] = renderData.uvs ?? [0, 0, 1, 1];
            packedUvs[0] = u0;
            packedUvs[1] = v0;
            packedUvs[2] = u1;
            packedUvs[3] = v1;

            renderData.worldTransform = glyphTransform;
            renderData.texture = texture;
            renderData.uvs = packedUvs;
            renderData.color = color;
            renderData.width = glyphWidth;
            renderData.height = glyphHeight;
            renderData.alphaMode = this.alphaMode;
            renderData.sortKey = sortKey;
            renderData.insertionOrder = insertionOrderStart + emittedCount;
            renderData.lit = false;
            renderData.localLeft = -glyphWidth * 0.5;
            renderData.localTop = -glyphHeight * 0.5;
            renderData.localRight = glyphWidth * 0.5;
            renderData.localBottom = glyphHeight * 0.5;
            renderData.uvOriginU = u0;
            renderData.uvOriginV = v0;
            renderData.uvAxisXU = u1 - u0;
            renderData.uvAxisXV = 0;
            renderData.uvAxisYU = 0;
            renderData.uvAxisYV = v1 - v0;
            renderData.scrollFactorX = worldScrollFactorX;
            renderData.scrollFactorY = worldScrollFactorY;
            renderData.msdf = msdf;
            renderData.msdfScreenPxRange = msdfScreenPxRange;
            emittedCount++;

            cursorX += (charDef.xadvance + this._letterSpacing) * scale;
            previousCharCode = charCode;
        }

        return emittedCount;
    }

    private _measureLines(): IBitmapFontLayoutLine[] {
        if (!this._text || this._fontSize <= 0 || this._font.lineHeight <= 0) {
            this._measuredLineCount = 0;
            this._lineLayouts.length = 0;
            return this._lineLayouts;
        }

        const scale = this._fontSize / this._font.lineHeight;
        let cursorX = 0;
        let lineWidth = 0;
        let previousCharCode = -1;
        let lineCount = 0;

        for (let index = 0; index < this._text.length; index++) {
            const charCode = this._text.charCodeAt(index);
            if (charCode === 10) {
                this._getLineLayout(lineCount).width = lineWidth;
                lineCount++;
                cursorX = 0;
                lineWidth = 0;
                previousCharCode = -1;
                continue;
            }

            const charDef = this._font.getChar(charCode);
            if (!charDef) {
                continue;
            }

            cursorX += this._font.getKerning(previousCharCode, charCode) * scale;
            const glyphLeft = cursorX + charDef.xoffset * scale;
            const glyphRight = glyphLeft + charDef.width * scale;
            if (glyphRight > lineWidth) {
                lineWidth = glyphRight;
            }
            cursorX += (charDef.xadvance + this._letterSpacing) * scale;
            previousCharCode = charCode;
        }

        this._getLineLayout(lineCount).width = lineWidth;
        lineCount++;
        this._measuredLineCount = lineCount;
        this._lineLayouts.length = lineCount;
        return this._lineLayouts;
    }

    private _getLineLayout(index: number): IBitmapFontLayoutLine {
        let lineLayout = this._lineLayouts[index];
        if (!lineLayout) {
            lineLayout = { width: 0 };
            this._lineLayouts[index] = lineLayout;
        }
        return lineLayout;
    }

    private _getAlignedOffset(lineWidth: number): number {
        if (this._textAlign === "center") {
            return -lineWidth * 0.5;
        }
        if (this._textAlign === "right") {
            return -lineWidth;
        }
        return 0;
    }
}
