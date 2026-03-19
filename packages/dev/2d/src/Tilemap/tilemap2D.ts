import type { AbstractEngine } from "core/Engines/abstractEngine";
import { Constants } from "core/Engines/constants";
import { HtmlElementTexture } from "core/Materials/Textures/htmlElementTexture";
import { Texture } from "core/Materials/Textures/texture";
import type { ThinTexture } from "core/Materials/Textures/thinTexture";
import { Vector2 } from "core/Maths/math.vector";
import { Logger } from "core/Misc/logger";
import { Tools } from "core/Misc/tools";

import { Matrix2D } from "../Math/matrix2D";
import { Rectangle2D } from "../Math/rectangle2D";
import { RenderableNode2D } from "../Node2D/renderableNode2D";
import type { ISprite2DRenderData } from "../Rendering/spriteBatchRenderer";
import type { Scene2D } from "../Scene2D/scene2D";

const _TILED_FLIPPED_H = 0x80000000;
const _TILED_FLIPPED_V = 0x40000000;
const _TILED_FLIPPED_D = 0x20000000;
const _TILED_GID_MASK = 0x1fffffff;

interface ITilesetMeta {
    columns: number;
    tileCount: number;
    imageWidth: number;
    imageHeight: number;
}

interface ITiledPropertyData {
    name: string;
    value: unknown;
}

interface ITiledAnimationFrameData {
    tileid: number;
    duration: number;
}

interface ITiledTilesetTileData {
    id: number;
    properties?: ITiledPropertyData[] | Record<string, unknown>;
    animation?: ITiledAnimationFrameData[];
}

interface ITiledTilesetData {
    firstgid?: number;
    source?: string;
    name?: string;
    image?: string;
    tilewidth?: number;
    tileheight?: number;
    columns?: number;
    tilecount?: number;
    spacing?: number;
    margin?: number;
    imagewidth?: number;
    imageheight?: number;
    tiles?: ITiledTilesetTileData[];
}

interface ITiledLayerData {
    type: string;
    name?: string;
    width?: number;
    height?: number;
    data?: number[];
    visible?: boolean;
    opacity?: number;
    offsetx?: number;
    offsety?: number;
    properties?: ITiledPropertyData[] | Record<string, unknown>;
    objects?: ITiledObjectData[];
}

interface ITiledObjectPointData {
    x: number;
    y: number;
}

interface ITiledObjectData {
    id?: number;
    name?: string;
    type?: string;
    class?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    rotation?: number;
    visible?: boolean;
    properties?: ITiledPropertyData[] | Record<string, unknown>;
    polygon?: ITiledObjectPointData[];
    polyline?: ITiledObjectPointData[];
    point?: boolean;
    ellipse?: boolean;
    gid?: number;
}

/**
 * Parsed Tiled map data used by {@link Tilemap2D.fromTiledJson}.
 */
export interface ITiledMapData {
    orientation?: string;
    width: number;
    height: number;
    tilewidth: number;
    tileheight: number;
    tilesets: ITiledTilesetData[];
    layers: ITiledLayerData[];
}

/**
 * A single frame within a tile animation.
 */
export interface ITileAnimationFrame {
    /** Global tile ID to display for this frame */
    gid: number;
    /** Duration of this frame in milliseconds */
    duration: number;
}

/**
 * Runtime state for an animated tile.
 */
export interface ITileAnimation {
    /** The animation frames */
    frames: ITileAnimationFrame[];
    /** Total animation duration in milliseconds */
    totalDuration: number;
    /** Current elapsed time in milliseconds */
    elapsed: number;
    /** Index of the current frame */
    currentFrame: number;
}

/**
 * Describes a tileset used by a tilemap.
 */
export interface ITilesetDefinition {
    /** Name of the tileset (from Tiled). */
    name: string;
    /** First global tile ID in this tileset. */
    firstGid: number;
    /** Tile width in pixels. */
    tileWidth: number;
    /** Tile height in pixels. */
    tileHeight: number;
    /** Number of columns in the sheet. */
    columns: number;
    /** Total number of tiles. */
    tileCount: number;
    /** Spacing between tiles in pixels. */
    spacing: number;
    /** Margin at sheet edges in pixels. */
    margin: number;
    /** The loaded GPU texture for this tileset. */
    texture: ThinTexture;
    /** Per-tile property bags (from Tiled custom properties). */
    tileProperties: Map<number, Record<string, unknown>>;
    /** Per-tile animation definitions (local tile ID → frames). */
    tileAnimations: Map<number, ITileAnimationFrame[]>;
}

/**
 * A Tiled object layer entity.
 */
export interface ITiledObject {
    /** Object ID (from Tiled). */
    id: number;
    /** Object name. */
    name: string;
    /** Object type/class string. */
    type: string;
    /** Position in pixels (Y-down). */
    x: number;
    y: number;
    /** Size in pixels (may be 0 for point objects). */
    width: number;
    height: number;
    /** Rotation in degrees. */
    rotation: number;
    /** Whether the object is visible in Tiled. */
    visible: boolean;
    /** Custom properties from Tiled. */
    properties: Record<string, unknown>;
    /** For polygon/polyline objects, the vertices relative to (x, y). */
    polygon?: Array<{ x: number; y: number }>;
    /** Whether this is a point object. */
    point?: boolean;
    /** Whether this is an ellipse object. */
    ellipse?: boolean;
    /** Global tile ID if this is a tile object. */
    gid?: number;
}

/**
 * A single tile layer stored as a flat Uint32Array.
 */
export class TilemapLayer2D extends RenderableNode2D {
    private static readonly _visibleWorldRectScratch = new Rectangle2D();
    private static readonly _visibleLocalRectScratch = new Rectangle2D();
    private static readonly _inverseWorldTransformScratch = Matrix2D.Identity();

    private _tiles: Uint32Array;
    private _tileWidth: number = 0;
    private _tileHeight: number = 0;
    private _owner: Tilemap2D | null = null;
    private _layerOpacity: number = 1;
    private _layerOffsetX: number = 0;
    private _layerOffsetY: number = 0;
    private _renderDataPool: ISprite2DRenderData[] = [];

    /**
     * Width of the layer in tiles.
     */
    public readonly widthInTiles: number;

    /**
     * Height of the layer in tiles.
     */
    public readonly heightInTiles: number;

    /**
     * Name of the layer (from Tiled).
     */
    public readonly layerName: string;

    /**
     * Whether this layer is used for collision detection.
     */
    public isCollisionLayer: boolean = false;

    /**
     * Back-compat materialized tile matrix view.
     */
    public get tiles(): number[][] {
        const rows: number[][] = [];
        for (let row = 0; row < this.heightInTiles; row++) {
            const rowData: number[] = [];
            for (let col = 0; col < this.widthInTiles; col++) {
                rowData.push(this.getTileAt(col, row));
            }
            rows.push(rowData);
        }
        return rows;
    }

    /**
     * Layer opacity multiplier (0–1), applied on top of Node2D.alpha.
     */
    public get layerOpacity(): number {
        return this._layerOpacity;
    }

    public set layerOpacity(value: number) {
        this._layerOpacity = value;
    }

    /**
     * Horizontal layer offset in pixels.
     */
    public get layerOffsetX(): number {
        return this._layerOffsetX;
    }

    public set layerOffsetX(value: number) {
        this._layerOffsetX = value;
    }

    /**
     * Vertical layer offset in pixels.
     */
    public get layerOffsetY(): number {
        return this._layerOffsetY;
    }

    public set layerOffsetY(value: number) {
        this._layerOffsetY = value;
    }

    /**
     * Creates a new TilemapLayer2D.
     * @param layerName - Name of the layer.
     * @param widthInTiles - Width in tile units.
     * @param heightInTiles - Height in tile units.
     * @param tiles - Initial tile data as a 2D array or flat array.
     * @param scene - Optional owning scene.
     */
    constructor(layerName: string, widthInTiles: number, heightInTiles: number, tiles: number[][] | ArrayLike<number> = [], scene?: Scene2D | null) {
        super(layerName, scene);
        this.layerName = layerName;
        this.widthInTiles = widthInTiles;
        this.heightInTiles = heightInTiles;
        this._tiles = TilemapLayer2D._normalizeTiles(widthInTiles, heightInTiles, tiles);
    }

    /**
     * Gets the tile ID at a given grid position.
     * @param col - Column index.
     * @param row - Row index.
     * @returns The tile ID, or 0 if out of bounds.
     */
    public getTileAt(col: number, row: number): number {
        return this._getRawTileAt(col, row) & _TILED_GID_MASK;
    }

    /**
     * Sets the tile ID at a given grid position.
     * @param col - Column index.
     * @param row - Row index.
     * @param gid - The tile ID to set.
     */
    public setTileAt(col: number, row: number, gid: number): void {
        if (row < 0 || row >= this.heightInTiles || col < 0 || col >= this.widthInTiles) {
            return;
        }

        this._tiles[(row * this.widthInTiles) + col] = gid >>> 0;
    }

    /**
     * Returns true if the tile at the given coordinates is marked solid.
     * @param col - Column index.
     * @param row - Row index.
     * @returns True when the tileset property `isSolid` is true.
     */
    public isSolid(col: number, row: number): boolean {
        const gid = this.getTileAt(col, row);
        if (gid === 0) {
            return false;
        }

        if (!this._owner) {
            return true;
        }

        return this._owner._isSolidGid(gid);
    }

    /**
     * Returns all solid tiles in this layer.
     * @returns An array of tile coordinates.
     */
    public getCollisionTiles(): Array<{ col: number; row: number }> {
        const tiles: Array<{ col: number; row: number }> = [];
        for (let row = 0; row < this.heightInTiles; row++) {
            for (let col = 0; col < this.widthInTiles; col++) {
                if (this.isSolid(col, row)) {
                    tiles.push({ col, row });
                }
            }
        }
        return tiles;
    }

    /**
     * Converts a world position to tile coordinates.
     * @param worldX - World X position in pixels.
     * @param worldY - World Y position in pixels.
     * @param out - Output tile coordinate object.
     */
    public worldToTile(worldX: number, worldY: number, out: { col: number; row: number }): void {
        const originX = this.worldPosition.x + this._layerOffsetX;
        const originY = this.worldPosition.y + this._layerOffsetY;
        out.col = this._tileWidth > 0 ? Math.floor((worldX - originX) / this._tileWidth) : 0;
        out.row = this._tileHeight > 0 ? Math.floor((worldY - originY) / this._tileHeight) : 0;
    }

    /**
     * Converts tile coordinates to the world-space center of the tile.
     * @param col - Column index.
     * @param row - Row index.
     * @param out - Output world position.
     * @returns The output vector for chaining.
     */
    public tileToWorld(col: number, row: number, out: Vector2): Vector2 {
        const originX = this.worldPosition.x + this._layerOffsetX;
        const originY = this.worldPosition.y + this._layerOffsetY;
        out.x = originX + ((col + 0.5) * this._tileWidth);
        out.y = originY + ((row + 0.5) * this._tileHeight);
        return out;
    }

    /**
     * Gets the world-space bounds of a tile.
     * @param col - Column index.
     * @param row - Row index.
     * @param out - Output rectangle.
     * @returns The output rectangle for chaining.
     */
    public getTileBounds(col: number, row: number, out: Rectangle2D): Rectangle2D {
        const originX = this.worldPosition.x + this._layerOffsetX;
        const originY = this.worldPosition.y + this._layerOffsetY;
        out.x = originX + (col * this._tileWidth);
        out.y = originY + (row * this._tileHeight);
        out.width = this._tileWidth;
        out.height = this._tileHeight;
        return out;
    }


/**
 * Resolves this layer's local bounds for RectMask2D owner fallback.
 * @param out - Rectangle receiving the bounds.
 * @returns True when bounds were written.
 * @internal
 */
public override _getMaskLocalBounds(out: Rectangle2D): boolean {
    const width = this.widthInTiles * this._tileWidth;
    const height = this.heightInTiles * this._tileHeight;
    if (width <= 0 || height <= 0) {
        return false;
    }

    out.set(this._layerOffsetX, this._layerOffsetY, width, height);
    return true;
}

/**
 * @internal
 */
public override _collectRenderData(list: ISprite2DRenderData[], _fallbackTexture: ThinTexture): void {
        const owner = this._owner;
        if (!owner || this._tileWidth <= 0 || this._tileHeight <= 0 || this._layerOpacity <= 0) {
            return;
        }

        const scene = this.scene;
        const worldAlpha = this.worldAlpha * this._layerOpacity;
        if (worldAlpha <= 0) {
            return;
        }

        let startCol = 0;
        let endCol = this.widthInTiles;
        let startRow = 0;
        let endRow = this.heightInTiles;

        const camera = scene?.camera ?? null;
        if (camera) {
            const visibleWorldRect = camera.getVisibleWorldRectToRef(TilemapLayer2D._visibleWorldRectScratch);
            if (this.worldTransform.invertToRef(TilemapLayer2D._inverseWorldTransformScratch)) {
                TilemapLayer2D._transformRectToLocal(
                    visibleWorldRect,
                    TilemapLayer2D._inverseWorldTransformScratch,
                    TilemapLayer2D._visibleLocalRectScratch
                );

                const visibleLocalRect = TilemapLayer2D._visibleLocalRectScratch;
                startCol = Math.max(0, Math.floor((visibleLocalRect.left - this._layerOffsetX) / this._tileWidth));
                endCol = Math.min(this.widthInTiles, Math.ceil((visibleLocalRect.right - this._layerOffsetX) / this._tileWidth));
                startRow = Math.max(0, Math.floor((visibleLocalRect.top - this._layerOffsetY) / this._tileHeight));
                endRow = Math.min(this.heightInTiles, Math.ceil((visibleLocalRect.bottom - this._layerOffsetY) / this._tileHeight));
            }
        }

        if (startCol >= endCol || startRow >= endRow) {
            return;
        }

        const worldTransform = this.worldTransform;
        const worldZIndex = this.worldZIndex;
        const sortKey = (this.sortingLayer << 16) | (worldZIndex & 0xffff);
        const lit = scene !== null && scene.lightingManager !== null && this.sortingLayer < scene.unlitSortingLayerMin;
        const scrollFactorX = this.worldScrollFactorX;
        const scrollFactorY = this.worldScrollFactorY;
        let emittedCount = 0;

        for (let row = startRow; row < endRow; row++) {
            const rowOffset = row * this.widthInTiles;
            for (let col = startCol; col < endCol; col++) {
                const rawGid = this._tiles[rowOffset + col];
                const baseGid = rawGid & _TILED_GID_MASK;
                if (baseGid === 0) {
                    continue;
                }

                const effectiveGid = owner.getDisplayTileId(baseGid);
                const tileset = owner._getTilesetForGid(effectiveGid);
                if (!tileset) {
                    continue;
                }

                const localId = effectiveGid - tileset.firstGid;
                if (localId < 0 || localId >= tileset.tileCount) {
                    continue;
                }

                let renderData = this._renderDataPool[emittedCount];
                if (!renderData) {
                    renderData = {} as ISprite2DRenderData;
                    this._renderDataPool[emittedCount] = renderData;
                }

                const localLeft = this._layerOffsetX + (col * this._tileWidth);
                const localTop = this._layerOffsetY + (row * this._tileHeight);
                TilemapLayer2D._writeTileUvsToRenderData(renderData, tileset, localId, rawGid);

                const color = renderData.color ?? [1, 1, 1, 1];
                color[0] = 1;
                color[1] = 1;
                color[2] = 1;
                color[3] = worldAlpha;

                renderData.worldTransform = worldTransform;
                renderData.texture = tileset.texture;
                renderData.color = color;
                renderData.width = this._tileWidth;
                renderData.height = this._tileHeight;
                renderData.alphaMode = Constants.ALPHA_COMBINE;
                renderData.sortKey = sortKey;
                renderData.insertionOrder = emittedCount;
                renderData.lit = lit;
                renderData.scrollFactorX = scrollFactorX;
                renderData.scrollFactorY = scrollFactorY;
                renderData.localLeft = localLeft;
                renderData.localTop = localTop;
                renderData.localRight = localLeft + this._tileWidth;
                renderData.localBottom = localTop + this._tileHeight;

                list.push(renderData);
                emittedCount++;
            }
        }
    }

    /**
     * @internal
     */
    public _setOwner(owner: Tilemap2D): void {
        this._owner = owner;
    }

    /**
     * @internal
     */
    public _setTileMetrics(tileWidth: number, tileHeight: number): void {
        this._tileWidth = tileWidth;
        this._tileHeight = tileHeight;
    }

    private _getRawTileAt(col: number, row: number): number {
        if (row < 0 || row >= this.heightInTiles || col < 0 || col >= this.widthInTiles) {
            return 0;
        }

        return this._tiles[(row * this.widthInTiles) + col];
    }

    private static _normalizeTiles(widthInTiles: number, heightInTiles: number, tiles: number[][] | ArrayLike<number>): Uint32Array {
        const result = new Uint32Array(widthInTiles * heightInTiles);

        if (Array.isArray(tiles) && tiles.length > 0 && Array.isArray(tiles[0])) {
            for (let row = 0; row < heightInTiles; row++) {
                const rowData = tiles[row] ?? [];
                for (let col = 0; col < widthInTiles; col++) {
                    result[(row * widthInTiles) + col] = (rowData[col] ?? 0) >>> 0;
                }
            }
            return result;
        }

        const flatTiles = tiles as ArrayLike<number>;
        const max = Math.min(result.length, flatTiles.length ?? 0);
        for (let index = 0; index < max; index++) {
            result[index] = (flatTiles[index] ?? 0) >>> 0;
        }
        return result;
    }

    private static _transformRectToLocal(rect: Rectangle2D, transform: Matrix2D, out: Rectangle2D): Rectangle2D {
        const m = transform.m;
        const x0 = m[0] * rect.left + m[2] * rect.top + m[4];
        const y0 = m[1] * rect.left + m[3] * rect.top + m[5];
        const x1 = m[0] * rect.right + m[2] * rect.top + m[4];
        const y1 = m[1] * rect.right + m[3] * rect.top + m[5];
        const x2 = m[0] * rect.right + m[2] * rect.bottom + m[4];
        const y2 = m[1] * rect.right + m[3] * rect.bottom + m[5];
        const x3 = m[0] * rect.left + m[2] * rect.bottom + m[4];
        const y3 = m[1] * rect.left + m[3] * rect.bottom + m[5];

        const minX = Math.min(x0, x1, x2, x3);
        const minY = Math.min(y0, y1, y2, y3);
        const maxX = Math.max(x0, x1, x2, x3);
        const maxY = Math.max(y0, y1, y2, y3);
        return out.set(minX, minY, maxX - minX, maxY - minY);
    }

    private static _writeTileUvsToRenderData(target: ISprite2DRenderData, tileset: ITilesetDefinition, localId: number, rawGid: number): void {
        const texture = tileset.texture;
        const textureSize = texture.getSize();
        const columns = Math.max(1, tileset.columns);
        const tileWidth = tileset.tileWidth;
        const tileHeight = tileset.tileHeight;

        if (textureSize.width <= 0 || textureSize.height <= 0 || tileWidth <= 0 || tileHeight <= 0) {
            const packedUvs = target.uvs ?? [0, 0, 1, 1];
            packedUvs[0] = 0;
            packedUvs[1] = 0;
            packedUvs[2] = 1;
            packedUvs[3] = 1;
            target.uvs = packedUvs;
            target.uvOriginU = 0;
            target.uvOriginV = 0;
            target.uvAxisXU = 1;
            target.uvAxisXV = 0;
            target.uvAxisYU = 0;
            target.uvAxisYV = 1;
            return;
        }

        const col = localId % columns;
        const row = Math.floor(localId / columns);
        const left = tileset.margin + col * (tileWidth + tileset.spacing);
        const top = tileset.margin + row * (tileHeight + tileset.spacing);
        const u0 = left / textureSize.width;
        const u1 = (left + tileWidth) / textureSize.width;
        const topV = top / textureSize.height;
        const bottomV = (top + tileHeight) / textureSize.height;
        const storedTopV = texture instanceof Texture ? 1 - topV : topV;
        const storedBottomV = texture instanceof Texture ? 1 - bottomV : bottomV;
        const deltaU = u1 - u0;
        const deltaV = storedBottomV - storedTopV;

        const flipH = (rawGid & _TILED_FLIPPED_H) !== 0;
        const flipV = (rawGid & _TILED_FLIPPED_V) !== 0;
        const flipD = (rawGid & _TILED_FLIPPED_D) !== 0;

        let tlx = 0;
        let tly = 0;
        let trx = 1;
        let tryY = 0;
        let blx = 0;
        let bly = 1;

        if (flipD) {
            tlx = 0;
            tly = 0;
            trx = 0;
            tryY = 1;
            blx = 1;
            bly = 0;
        }

        if (flipH) {
            tlx = 1 - tlx;
            trx = 1 - trx;
            blx = 1 - blx;
        }

        if (flipV) {
            tly = 1 - tly;
            tryY = 1 - tryY;
            bly = 1 - bly;
        }

        const uvOriginU = u0 + deltaU * tlx;
        const uvOriginV = storedTopV + deltaV * tly;
        const uvAxisXU = deltaU * (trx - tlx);
        const uvAxisXV = deltaV * (tryY - tly);
        const uvAxisYU = deltaU * (blx - tlx);
        const uvAxisYV = deltaV * (bly - tly);

        const packedUvs = target.uvs ?? [0, 0, 1, 1];
        packedUvs[0] = uvOriginU;
        packedUvs[1] = uvOriginV;
        packedUvs[2] = uvOriginU + uvAxisXU + uvAxisYU;
        packedUvs[3] = uvOriginV + uvAxisXV + uvAxisYV;

        target.uvs = packedUvs;
        target.uvOriginU = uvOriginU;
        target.uvOriginV = uvOriginV;
        target.uvAxisXU = uvAxisXU;
        target.uvAxisXV = uvAxisXV;
        target.uvAxisYU = uvAxisYU;
        target.uvAxisYV = uvAxisYV;
    }
}
/**
 * Container for a complete tilemap: tilesets, tile layers, object layers,
 * and animated tiles.
 */
export class Tilemap2D {
    private _widthInTiles: number;
    private _heightInTiles: number;
    private _tileWidth: number;
    private _tileHeight: number;
    private _layers: TilemapLayer2D[];
    private _tilesets: ITilesetDefinition[];
    private _objectLayers: Map<string, ITiledObject[]>;
    private _tilesetFirstGids: number[];

    /**
     * Back-compat tileset metadata keyed by first GID.
     */
    public readonly tilesetMeta: Map<number, ITilesetMeta> = new Map();

    /**
     * Back-compat tileset texture map keyed by first GID.
     */
    public readonly tilesetTexturesByFirstGid: Map<number, ThinTexture> = new Map();

    /**
     * Runtime tile animations keyed by global tile ID.
     */
    public readonly tileAnimations: Map<number, ITileAnimation> = new Map();

    /**
     * Creates a new Tilemap2D.
     * @param widthInTiles - Width of the map in tiles.
     * @param heightInTiles - Height of the map in tiles.
     * @param tileWidth - Tile width in pixels.
     * @param tileHeight - Tile height in pixels.
     * @param layers - Tile layers.
     * @param tilesets - Tileset definitions or a legacy firstGid → texture map.
     * @param tilesetMeta - Legacy metadata map used when `tilesets` is a Map.
     * @param objectLayers - Optional object layers.
     */
    constructor(
        widthInTiles: number,
        heightInTiles: number,
        tileWidth: number,
        tileHeight: number,
        layers: TilemapLayer2D[],
        tilesets: Map<number, ThinTexture> | ITilesetDefinition[] = [],
        tilesetMeta?: Map<number, ITilesetMeta>,
        objectLayers?: Map<string, ITiledObject[]>
    ) {
        this._widthInTiles = widthInTiles;
        this._heightInTiles = heightInTiles;
        this._tileWidth = tileWidth;
        this._tileHeight = tileHeight;
        this._layers = layers;
        this._objectLayers = objectLayers ?? new Map();

        if (tilesets instanceof Map) {
            this._tilesets = [];
            const sortedFirstGids = Array.from(tilesets.keys()).sort((left, right) => left - right);
            for (const firstGid of sortedFirstGids) {
                const texture = tilesets.get(firstGid);
                if (!texture) {
                    continue;
                }

                const meta = tilesetMeta?.get(firstGid);
                const size = texture.getSize();
                const definition: ITilesetDefinition = {
                    name: `tileset_${firstGid}`,
                    firstGid,
                    tileWidth,
                    tileHeight,
                    columns: meta?.columns ?? 1,
                    tileCount: meta?.tileCount ?? 1,
                    spacing: 0,
                    margin: 0,
                    texture,
                    tileProperties: new Map(),
                    tileAnimations: new Map(),
                };

                this._tilesets.push(definition);
                this.tilesetTexturesByFirstGid.set(firstGid, texture);
                this.tilesetMeta.set(firstGid, {
                    columns: meta?.columns ?? 1,
                    tileCount: meta?.tileCount ?? 1,
                    imageWidth: meta?.imageWidth ?? size.width,
                    imageHeight: meta?.imageHeight ?? size.height,
                });
            }
        } else {
            this._tilesets = [...tilesets].sort((left, right) => left.firstGid - right.firstGid);
            for (const tileset of this._tilesets) {
                this.tilesetTexturesByFirstGid.set(tileset.firstGid, tileset.texture);
                const size = tileset.texture.getSize();
                this.tilesetMeta.set(tileset.firstGid, {
                    columns: tileset.columns,
                    tileCount: tileset.tileCount,
                    imageWidth: size.width,
                    imageHeight: size.height,
                });
            }
        }

        this._tilesetFirstGids = this._tilesets.map((tileset) => tileset.firstGid);

        for (const layer of this._layers) {
            layer._setOwner(this);
            layer._setTileMetrics(this._tileWidth, this._tileHeight);
        }
    }

    /**
     * Width of the map in tiles.
     */
    public get widthInTiles(): number {
        return this._widthInTiles;
    }

    /**
     * Height of the map in tiles.
     */
    public get heightInTiles(): number {
        return this._heightInTiles;
    }

    /**
     * Back-compat alias for widthInTiles.
     */
    public get width(): number {
        return this._widthInTiles;
    }

    /**
     * Back-compat alias for heightInTiles.
     */
    public get height(): number {
        return this._heightInTiles;
    }

    /**
     * Width of a single tile in pixels.
     */
    public get tileWidth(): number {
        return this._tileWidth;
    }

    /**
     * Height of a single tile in pixels.
     */
    public get tileHeight(): number {
        return this._tileHeight;
    }

    /**
     * Map width in pixels.
     */
    public get widthInPixels(): number {
        return this._widthInTiles * this._tileWidth;
    }

    /**
     * Map height in pixels.
     */
    public get heightInPixels(): number {
        return this._heightInTiles * this._tileHeight;
    }

    /**
     * All tile layers, in Tiled order.
     */
    public get layers(): ReadonlyArray<TilemapLayer2D> {
        return this._layers;
    }

    /**
     * All tilesets used by this map.
     */
    public get tilesets(): ReadonlyArray<ITilesetDefinition> {
        return this._tilesets;
    }

    /**
     * Object layers keyed by layer name.
     */
    public get objectLayers(): ReadonlyMap<string, ITiledObject[]> {
        return this._objectLayers;
    }

    /**
     * Loads a Tiled .tmj file and all referenced textures.
     * @param url - URL to the .tmj file.
     * @param engine - The engine used for texture loading.
     * @param scene - Scene to add layers to, or null.
     * @param baseUrl - Optional base URL for relative assets.
     * @returns A promise that resolves to the loaded tilemap.
     */
    public static async loadTiledMapAsync(url: string, engine: AbstractEngine, scene: Scene2D | null, baseUrl?: string): Promise<Tilemap2D> {
        const mapText = await Tools.LoadFileAsync(url, false);
        const parsed = JSON.parse(mapText) as ITiledMapData;
        const resolvedBaseUrl = baseUrl ?? Tilemap2D._getDirectoryUrl(url);
        const resolvedData = await Tilemap2D._resolveExternalTilesetsAsync(parsed, resolvedBaseUrl);
        const textures = new Map<string, ThinTexture>();

        for (const tileset of resolvedData.tilesets) {
            if (!tileset.image) {
                throw new Error(`Tilemap2D.loadTiledMapAsync: Tileset '${tileset.name ?? "unnamed"}' is missing an image.`);
            }

            const imageUrl = Tilemap2D._resolveUrl(resolvedBaseUrl, tileset.image);
            let texture = textures.get(imageUrl);
            if (!texture) {
                texture = await Tilemap2D._loadTextureAsync(tileset.name ?? imageUrl, imageUrl, engine);
                textures.set(imageUrl, texture);
            }

            textures.set(tileset.image, texture);
            if (tileset.name) {
                textures.set(tileset.name, texture);
            }
        }

        return Tilemap2D.fromTiledJson(resolvedData, textures, scene);
    }

    /**
     * Creates a Tilemap2D from pre-parsed Tiled JSON data.
     * @param data - Parsed Tiled data.
     * @param tilesetTextures - Tileset textures keyed by name and/or image path.
     * @param scene - Scene to add layers to, or null.
     * @returns The constructed tilemap.
     */
    public static fromTiledJson(data: ITiledMapData, tilesetTextures: Map<string, ThinTexture>, scene: Scene2D | null): Tilemap2D {
        if (data.orientation && data.orientation !== "orthogonal") {
            throw new Error(`Tilemap2D.fromTiledJson only supports orthogonal maps. Received '${data.orientation}'.`);
        }

        const tilesets: ITilesetDefinition[] = [];
        const runtimeAnimations = new Map<number, ITileAnimation>();

        for (const tilesetData of data.tilesets) {
            if (tilesetData.source) {
                throw new Error(`Tilemap2D.fromTiledJson cannot resolve external tileset source '${tilesetData.source}'. Use loadTiledMapAsync instead.`);
            }
            if (tilesetData.firstgid === undefined) {
                throw new Error(`Tilemap2D.fromTiledJson encountered a tileset without firstgid.`);
            }

            const texture = Tilemap2D._resolveTilesetTexture(tilesetData, tilesetTextures);
            if (!texture) {
                throw new Error(`Tilemap2D.fromTiledJson could not find a texture for tileset '${tilesetData.name ?? tilesetData.image ?? tilesetData.firstgid}'.`);
            }

            const tileProperties = new Map<number, Record<string, unknown>>();
            const tileAnimations = new Map<number, ITileAnimationFrame[]>();

            for (const tileData of tilesetData.tiles ?? []) {
                const props = Tilemap2D._propertiesToRecord(tileData.properties);
                if (Object.keys(props).length > 0) {
                    tileProperties.set(tileData.id, props);
                }

                if (tileData.animation && tileData.animation.length > 0) {
                    const frames = Tilemap2D._normalizeAnimationFrames(tilesetData.firstgid, tileData.animation);
                    tileAnimations.set(tileData.id, frames);
                    runtimeAnimations.set(tilesetData.firstgid + tileData.id, Tilemap2D._createRuntimeAnimation(frames));
                }
            }

            tilesets.push({
                name: tilesetData.name ?? `tileset_${tilesetData.firstgid}`,
                firstGid: tilesetData.firstgid,
                tileWidth: tilesetData.tilewidth ?? data.tilewidth,
                tileHeight: tilesetData.tileheight ?? data.tileheight,
                columns: tilesetData.columns ?? 1,
                tileCount: tilesetData.tilecount ?? 1,
                spacing: tilesetData.spacing ?? 0,
                margin: tilesetData.margin ?? 0,
                texture,
                tileProperties,
                tileAnimations,
            });
        }

        const layers: TilemapLayer2D[] = [];
        const objectLayers = new Map<string, ITiledObject[]>();
        let tileLayerIndex = 0;

        for (const layerData of data.layers) {
            if (layerData.type === "tilelayer") {
                const layerWidth = layerData.width ?? data.width;
                const layerHeight = layerData.height ?? data.height;
                const tileData = layerData.data ?? [];
                const layer = new TilemapLayer2D(layerData.name ?? `layer_${tileLayerIndex}`, layerWidth, layerHeight, tileData, scene);
                layer.visible = layerData.visible !== false;
                layer.layerOpacity = layerData.opacity ?? 1;
                layer.layerOffsetX = layerData.offsetx ?? 0;
                layer.layerOffsetY = layerData.offsety ?? 0;
                layer.sortingLayer = tileLayerIndex;
                layer.zIndex = 0;

                const properties = Tilemap2D._propertiesToRecord(layerData.properties);
                layer.isCollisionLayer = properties.isCollisionLayer === true || properties.collision === true;

                layers.push(layer);
                tileLayerIndex++;
                continue;
            }

            if (layerData.type === "objectgroup") {
                objectLayers.set(layerData.name ?? `object_layer_${objectLayers.size}`, Tilemap2D._parseObjectLayer(layerData.objects));
                continue;
            }

            Logger.Warn(`Tilemap2D.fromTiledJson: Skipping unsupported layer '${layerData.name ?? "unnamed"}' of type '${layerData.type}'.`);
        }

        const tilemap = new Tilemap2D(data.width, data.height, data.tilewidth, data.tileheight, layers, tilesets, undefined, objectLayers);
        runtimeAnimations.forEach((animation, gid) => {
            tilemap.tileAnimations.set(gid, animation);
        });
        return tilemap;
    }

    /**
     * Back-compat sync loader alias.
     * @param data - Parsed Tiled data.
     * @param textures - Tileset textures.
     * @returns The constructed tilemap.
     */
    public static FromTiled(data: ITiledMapData, textures: Map<string, ThinTexture>): Tilemap2D {
        return Tilemap2D.fromTiledJson(data, textures, null);
    }

    /**
     * Creates an empty tilemap programmatically.
     * @param tileWidth - Tile width in pixels.
     * @param tileHeight - Tile height in pixels.
     * @param widthInTiles - Map width in tiles.
     * @param heightInTiles - Map height in tiles.
     * @param scene - Scene to add layers to, or null.
     * @returns The empty tilemap.
     */
    public static createEmpty(tileWidth: number, tileHeight: number, widthInTiles: number, heightInTiles: number, scene: Scene2D | null): Tilemap2D {
        const baseLayer = new TilemapLayer2D("layer_0", widthInTiles, heightInTiles, new Uint32Array(widthInTiles * heightInTiles), scene);
        baseLayer.sortingLayer = 0;
        return new Tilemap2D(widthInTiles, heightInTiles, tileWidth, tileHeight, [baseLayer], [], undefined, new Map());
    }

    /**
     * Gets a tile layer by name.
     * @param name - Layer name.
     * @returns The layer, or null if not found.
     */
    public getLayer(name: string): TilemapLayer2D | null {
        for (const layer of this._layers) {
            if (layer.layerName === name) {
                return layer;
            }
        }
        return null;
    }

    /**
     * Gets all objects from an object layer.
     * @param layerName - Object layer name.
     * @returns The objects in that layer, or an empty array.
     */
    public getObjects(layerName: string): ITiledObject[] {
        return this._objectLayers.get(layerName) ?? [];
    }

    /**
     * Finds all objects with a matching type.
     * @param type - Type/class string to match.
     * @returns Matching objects across all layers.
     */
    public findObjectsByType(type: string): ITiledObject[] {
        const matches: ITiledObject[] = [];
        for (const objects of this._objectLayers.values()) {
            for (const objectData of objects) {
                if (objectData.type === type) {
                    matches.push(objectData);
                }
            }
        }
        return matches;
    }

    /**
     * Finds all objects with a matching name.
     * @param name - Name string to match.
     * @returns Matching objects across all layers.
     */
    public findObjectsByName(name: string): ITiledObject[] {
        const matches: ITiledObject[] = [];
        for (const objects of this._objectLayers.values()) {
            for (const objectData of objects) {
                if (objectData.name === name) {
                    matches.push(objectData);
                }
            }
        }
        return matches;
    }

    /**
     * Advances all tile animations by the given delta time.
     * @param deltaTime - Time elapsed since the last frame in seconds.
     */
    public update(deltaTime: number): void {
        if (this.tileAnimations.size === 0) {
            return;
        }

        const dtMs = deltaTime * 1000;
        this.tileAnimations.forEach((animation) => {
            if (animation.frames.length === 0) {
                return;
            }

            animation.elapsed += dtMs;
            while (animation.elapsed >= animation.frames[animation.currentFrame].duration) {
                animation.elapsed -= animation.frames[animation.currentFrame].duration;
                animation.currentFrame = (animation.currentFrame + 1) % animation.frames.length;
            }
        });
    }

    /**
     * Gets the currently displayed GID for the provided base GID.
     * @param gid - Base tile GID.
     * @returns The animated frame GID, or the original GID.
     */
    public getDisplayTileId(gid: number): number {
        return this._getAnimatedGid(gid);
    }

    /**
     * Registers a tile animation programmatically.
     * @param gid - Base global tile ID.
     * @param frames - Animation frames.
     */
    public addTileAnimation(gid: number, frames: ITileAnimationFrame[]): void {
        const normalizedFrames = Tilemap2D._normalizeProgrammaticAnimationFrames(frames);
        this.tileAnimations.set(gid, Tilemap2D._createRuntimeAnimation(normalizedFrames));
    }

    /**
     * Back-compat tile lookup helper by layer name.
     * @param layerName - Tile layer name.
     * @param col - Column index.
     * @param row - Row index.
     * @returns The tile GID, or 0 if not found.
     */
    public getTileAt(layerName: string, col: number, row: number): number {
        const layer = this.getLayer(layerName);
        return layer ? layer.getTileAt(col, row) : 0;
    }

    /**
     * Back-compat tile setter by layer name.
     * @param layerName - Tile layer name.
     * @param col - Column index.
     * @param row - Row index.
     * @param gid - Tile GID.
     */
    public setTileAt(layerName: string, col: number, row: number, gid: number): void {
        const layer = this.getLayer(layerName);
        if (layer) {
            layer.setTileAt(col, row, gid);
        }
    }

    /**
     * Back-compat map-wide solidity check across collision layers.
     * @param col - Column index.
     * @param row - Row index.
     * @returns True if any collision layer has a non-empty tile at the position.
     */
    public isSolid(col: number, row: number): boolean {
        for (const layer of this._layers) {
            if (layer.isCollisionLayer && layer.getTileAt(col, row) !== 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * Back-compat collision grid helper across collision layers.
     * @returns Boolean grid where true means solid.
     */
    public getCollisionGrid(): boolean[][] {
        const grid: boolean[][] = [];
        for (let row = 0; row < this._heightInTiles; row++) {
            const rowData: boolean[] = [];
            for (let col = 0; col < this._widthInTiles; col++) {
                rowData.push(this.isSolid(col, row));
            }
            grid.push(rowData);
        }
        return grid;
    }

    /**
     * Back-compat map-space world-to-tile conversion.
     * @param worldX - World X position in pixels.
     * @param worldY - World Y position in pixels.
     * @returns Tile coordinates in map space.
     */
    public worldToTile(worldX: number, worldY: number): { col: number; row: number } {
        return {
            col: Math.floor(worldX / this._tileWidth),
            row: Math.floor(worldY / this._tileHeight),
        };
    }

    /**
     * Back-compat map-space tile-to-world conversion.
     * @param col - Column index.
     * @param row - Row index.
     * @returns World-space tile origin.
     */
    public tileToWorld(col: number, row: number): { x: number; y: number } {
        return {
            x: col * this._tileWidth,
            y: row * this._tileHeight,
        };
    }

    /**
     * Back-compat tile bounds helper in map space.
     * @param col - Column index.
     * @param row - Row index.
     * @returns Tile bounds.
     */
    public getTileBounds(col: number, row: number): Rectangle2D {
        return new Rectangle2D(col * this._tileWidth, row * this._tileHeight, this._tileWidth, this._tileHeight);
    }

    /**
     * Returns the world bounds of the entire map.
     * @returns A world-space rectangle enclosing all layers.
     */
    public getWorldBounds(): Rectangle2D {
        if (this._layers.length === 0) {
            return new Rectangle2D(0, 0, this.widthInPixels, this.heightInPixels);
        }

        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;

        for (const layer of this._layers) {
            const left = layer.worldPosition.x + layer.layerOffsetX;
            const top = layer.worldPosition.y + layer.layerOffsetY;
            const right = left + (layer.widthInTiles * this._tileWidth);
            const bottom = top + (layer.heightInTiles * this._tileHeight);

            if (left < minX) {
                minX = left;
            }
            if (top < minY) {
                minY = top;
            }
            if (right > maxX) {
                maxX = right;
            }
            if (bottom > maxY) {
                maxY = bottom;
            }
        }

        return new Rectangle2D(minX, minY, maxX - minX, maxY - minY);
    }

    /**
     * Disposes all layers and tileset textures.
     */
    public dispose(): void {
        for (const layer of this._layers) {
            layer.dispose();
        }

        const disposedTextures = new Set<ThinTexture>();
        for (const tileset of this._tilesets) {
            if (disposedTextures.has(tileset.texture)) {
                continue;
            }
            disposedTextures.add(tileset.texture);
            tileset.texture.dispose();
        }

        this._layers.length = 0;
        this._objectLayers.clear();
        this.tileAnimations.clear();
        this.tilesetMeta.clear();
        this.tilesetTexturesByFirstGid.clear();
        this._tilesets.length = 0;
        this._tilesetFirstGids.length = 0;
    }

    /**
     * @internal
     */
    public _isSolidGid(gid: number): boolean {
        const tileset = this._getTilesetForGid(gid);
        if (!tileset) {
            return false;
        }

        const localId = gid - tileset.firstGid;
        const properties = tileset.tileProperties.get(localId);
        return properties?.isSolid === true || properties?.solid === true;
    }

    private _getAnimatedGid(gid: number): number {
        const animation = this.tileAnimations.get(gid);
        if (!animation || animation.frames.length === 0) {
            return gid;
        }
        return animation.frames[animation.currentFrame].gid;
    }

    /**
     * Resolves the tileset that owns the provided global tile ID.
     * @param gid - The global tile ID to resolve.
     * @returns The owning tileset, or null when the GID is not covered by any tileset.
     * @internal
     */
    public _getTilesetForGid(gid: number): ITilesetDefinition | null {
        let low = 0;
        let high = this._tilesetFirstGids.length - 1;

        while (low <= high) {
            const mid = (low + high) >> 1;
            const firstGid = this._tilesetFirstGids[mid];
            const tileset = this._tilesets[mid];
            const lastGid = firstGid + tileset.tileCount - 1;

            if (gid < firstGid) {
                high = mid - 1;
                continue;
            }

            if (gid > lastGid) {
                low = mid + 1;
                continue;
            }

            return tileset;
        }

        return null;
    }

    private static _normalizeProgrammaticAnimationFrames(frames: ITileAnimationFrame[]): ITileAnimationFrame[] {
        return frames.map((frame) => ({
            gid: frame.gid,
            duration: Math.max(1, frame.duration),
        }));
    }

    private static _normalizeAnimationFrames(firstGid: number, frames: ITiledAnimationFrameData[]): ITileAnimationFrame[] {
        return frames.map((frame) => ({
            gid: firstGid + frame.tileid,
            duration: Math.max(1, frame.duration),
        }));
    }

    private static _createRuntimeAnimation(frames: ITileAnimationFrame[]): ITileAnimation {
        let totalDuration = 0;
        for (const frame of frames) {
            totalDuration += frame.duration;
        }

        return {
            frames: [...frames],
            totalDuration,
            elapsed: 0,
            currentFrame: 0,
        };
    }

    private static _propertiesToRecord(properties?: ITiledPropertyData[] | Record<string, unknown>): Record<string, unknown> {
        if (!properties) {
            return {};
        }

        if (!Array.isArray(properties)) {
            return { ...properties };
        }

        const result: Record<string, unknown> = {};
        for (const property of properties) {
            result[property.name] = property.value;
        }
        return result;
    }

    private static _parseObjectLayer(objects?: ITiledObjectData[]): ITiledObject[] {
        if (!objects) {
            return [];
        }

        const parsedObjects: ITiledObject[] = [];
        for (const objectData of objects) {
            const polygon = objectData.polygon ?? objectData.polyline;
            parsedObjects.push({
                id: objectData.id ?? 0,
                name: objectData.name ?? "",
                type: objectData.type ?? objectData.class ?? "",
                x: objectData.x ?? 0,
                y: objectData.y ?? 0,
                width: objectData.width ?? 0,
                height: objectData.height ?? 0,
                rotation: objectData.rotation ?? 0,
                visible: objectData.visible !== false,
                properties: Tilemap2D._propertiesToRecord(objectData.properties),
                polygon: polygon ? polygon.map((point) => ({ x: point.x, y: point.y })) : undefined,
                point: objectData.point === true,
                ellipse: objectData.ellipse === true,
                gid: objectData.gid !== undefined ? (objectData.gid >>> 0) & _TILED_GID_MASK : undefined,
            });
        }

        return parsedObjects;
    }

    private static _resolveTilesetTexture(tilesetData: ITiledTilesetData, textures: Map<string, ThinTexture>): ThinTexture | null {
        const candidates: string[] = [];
        if (tilesetData.name) {
            candidates.push(tilesetData.name);
        }
        if (tilesetData.image) {
            candidates.push(tilesetData.image);
            const fileName = Tilemap2D._getFileName(tilesetData.image);
            if (fileName !== tilesetData.image) {
                candidates.push(fileName);
            }
        }
        if (tilesetData.source) {
            candidates.push(tilesetData.source);
            const fileName = Tilemap2D._getFileName(tilesetData.source);
            if (fileName !== tilesetData.source) {
                candidates.push(fileName);
            }
        }

        for (const key of candidates) {
            const texture = textures.get(key);
            if (texture) {
                return texture;
            }
        }

        return null;
    }

    private static async _resolveExternalTilesetsAsync(data: ITiledMapData, baseUrl: string): Promise<ITiledMapData> {
        const tilesets: ITiledTilesetData[] = [];

        for (const tilesetData of data.tilesets) {
            if (!tilesetData.source) {
                tilesets.push({ ...tilesetData });
                continue;
            }

            const sourceUrl = Tilemap2D._resolveUrl(baseUrl, tilesetData.source);
            const tilesetText = await Tools.LoadFileAsync(sourceUrl, false);
            const parsedTileset = JSON.parse(tilesetText) as ITiledTilesetData;
            tilesets.push({
                ...parsedTileset,
                firstgid: tilesetData.firstgid,
                source: tilesetData.source,
            });
        }

        return {
            ...data,
            tilesets,
        };
    }

    private static _loadTextureAsync(name: string, url: string, engine: AbstractEngine): Promise<HtmlElementTexture> {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = "anonymous";
            image.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = image.width;
                canvas.height = image.height;
                const context = canvas.getContext("2d");
                if (!context) {
                    reject(new Error(`Failed to create canvas context for tilemap texture '${url}'.`));
                    return;
                }

                context.drawImage(image, 0, 0);
                const texture = new HtmlElementTexture(name, canvas, {
                    generateMipMaps: false,
                    samplingMode: Constants.TEXTURE_NEAREST_SAMPLINGMODE,
                    format: Constants.TEXTUREFORMAT_RGBA,
                    engine,
                    scene: null,
                });
                texture.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
                texture.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
                resolve(texture);
            };
            image.onerror = () => {
                reject(new Error(`Failed to load tilemap texture image '${url}'.`));
            };
            image.src = url;
        });
    }

    private static _getDirectoryUrl(url: string): string {
        const lastSlashIndex = Math.max(url.lastIndexOf("/"), url.lastIndexOf("\\"));
        if (lastSlashIndex < 0) {
            return "";
        }
        return url.slice(0, lastSlashIndex + 1);
    }

    private static _getFileName(url: string): string {
        const lastSlashIndex = Math.max(url.lastIndexOf("/"), url.lastIndexOf("\\"));
        if (lastSlashIndex < 0) {
            return url;
        }
        return url.slice(lastSlashIndex + 1);
    }

    private static _resolveUrl(baseUrl: string, relativeUrl: string): string {
        if (/^(?:[a-z]+:)?\/\//i.test(relativeUrl) || relativeUrl.startsWith("data:")) {
            return relativeUrl;
        }
        return `${baseUrl}${relativeUrl}`;
    }
}


