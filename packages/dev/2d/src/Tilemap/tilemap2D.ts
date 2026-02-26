import type { BaseTexture } from "core/Materials/Textures/baseTexture";
import { Logger } from "core/Misc/logger";

import { Node2D } from "../Node2D/node2D";
import { Rectangle2D } from "../Math/rectangle2D";

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
 * Represents a single layer of a tilemap. Extends Node2D so it participates
 * in the scene graph with z-ordering.
 */
export class TilemapLayer2D extends Node2D {
    /**
     * 2D array of tile IDs. 0 means empty/no tile.
     * Indexed as [row][col].
     */
    public tiles: number[][];

    /**
     * Width of the layer in tiles
     */
    public readonly widthInTiles: number;

    /**
     * Height of the layer in tiles
     */
    public readonly heightInTiles: number;

    /**
     * Name of the layer (from Tiled)
     */
    public readonly layerName: string;

    /**
     * Whether this layer is used for collision detection
     */
    public isCollisionLayer: boolean = false;

    /**
     * Creates a new TilemapLayer2D
     * @param layerName - Name of the layer
     * @param widthInTiles - Width in tile units
     * @param heightInTiles - Height in tile units
     * @param tiles - 2D array of tile IDs [row][col]
     */
    constructor(layerName: string, widthInTiles: number, heightInTiles: number, tiles: number[][]) {
        super(layerName);
        this.layerName = layerName;
        this.widthInTiles = widthInTiles;
        this.heightInTiles = heightInTiles;
        this.tiles = tiles;
    }

    /**
     * Gets the tile ID at a given grid position
     * @param col - Column index
     * @param row - Row index
     * @returns The tile ID, or 0 if out of bounds
     */
    public getTileAt(col: number, row: number): number {
        if (row < 0 || row >= this.heightInTiles || col < 0 || col >= this.widthInTiles) {
            return 0;
        }
        return this.tiles[row][col];
    }

    /**
     * Sets the tile ID at a given grid position
     * @param col - Column index
     * @param row - Row index
     * @param tileId - The tile ID to set
     */
    public setTileAt(col: number, row: number, tileId: number): void {
        if (row >= 0 && row < this.heightInTiles && col >= 0 && col < this.widthInTiles) {
            this.tiles[row][col] = tileId;
        }
    }
}

/**
 * Represents a full tilemap with multiple layers, tile dimensions, and tileset textures.
 * Can be loaded from Tiled JSON (.tmj) format.
 */
export class Tilemap2D {
    /**
     * Width of the map in tiles
     */
    public readonly width: number;

    /**
     * Height of the map in tiles
     */
    public readonly height: number;

    /**
     * Width of a single tile in pixels
     */
    public readonly tileWidth: number;

    /**
     * Height of a single tile in pixels
     */
    public readonly tileHeight: number;

    /**
     * The tile layers in this map
     */
    public readonly layers: TilemapLayer2D[];

    /**
     * Tileset textures keyed by first tile ID
     */
    public readonly tilesets: Map<number, BaseTexture>;

    /**
     * Tileset metadata (firstGid, tileCount, columns, imageWidth, imageHeight)
     */
    public readonly tilesetMeta: Map<number, { columns: number; tileCount: number; imageWidth: number; imageHeight: number }>;

    /**
     * Tile animations keyed by global tile ID.
     * Only tiles that have animation data in the Tiled file appear here.
     */
    public readonly tileAnimations: Map<number, ITileAnimation> = new Map();

    /**
     * Creates a new Tilemap2D
     * @param width - Width in tiles
     * @param height - Height in tiles
     * @param tileWidth - Tile width in pixels
     * @param tileHeight - Tile height in pixels
     * @param layers - Array of tile layers
     * @param tilesets - Map of firstGid to texture
     * @param tilesetMeta - Map of firstGid to tileset metadata
     */
    constructor(
        width: number,
        height: number,
        tileWidth: number,
        tileHeight: number,
        layers: TilemapLayer2D[],
        tilesets: Map<number, BaseTexture>,
        tilesetMeta: Map<number, { columns: number; tileCount: number; imageWidth: number; imageHeight: number }>
    ) {
        this.width = width;
        this.height = height;
        this.tileWidth = tileWidth;
        this.tileHeight = tileHeight;
        this.layers = layers;
        this.tilesets = tilesets;
        this.tilesetMeta = tilesetMeta;
    }

    /**
     * Creates a Tilemap2D from Tiled JSON data (.tmj format)
     * @param data - Parsed Tiled JSON object
     * @param textures - Map of tileset image filenames to textures
     * @returns A new Tilemap2D
     */
    public static FromTiled(data: any, textures: Map<string, BaseTexture>): Tilemap2D {
        const width: number = data.width;
        const height: number = data.height;
        const tileWidth: number = data.tilewidth;
        const tileHeight: number = data.tileheight;

        // Parse tilesets
        const tilesetMap = new Map<number, BaseTexture>();
        const tilesetMeta = new Map<number, { columns: number; tileCount: number; imageWidth: number; imageHeight: number }>();
        const tileAnimMap = new Map<number, ITileAnimation>();

        for (const ts of data.tilesets) {
            const firstGid: number = ts.firstgid;
            const imageName: string = ts.image;
            const tex = textures.get(imageName);
            if (tex) {
                tilesetMap.set(firstGid, tex);
            }
            tilesetMeta.set(firstGid, {
                columns: ts.columns ?? 1,
                tileCount: ts.tilecount ?? 1,
                imageWidth: ts.imagewidth ?? tileWidth,
                imageHeight: ts.imageheight ?? tileHeight,
            });

            // Parse tile animations (Tiled format: tiles[].animation[])
            if (ts.tiles) {
                for (const tileDef of ts.tiles) {
                    if (tileDef.animation && tileDef.animation.length > 0) {
                        const gid = firstGid + tileDef.id;
                        const frames: ITileAnimationFrame[] = [];
                        let totalDuration = 0;
                        for (const frame of tileDef.animation) {
                            const frameDuration: number = frame.duration;
                            frames.push({
                                gid: firstGid + frame.tileid,
                                duration: frameDuration,
                            });
                            totalDuration += frameDuration;
                        }
                        tileAnimMap.set(gid, {
                            frames,
                            totalDuration,
                            elapsed: 0,
                            currentFrame: 0,
                        });
                    }
                }
            }
        }

        // Parse tile layers
        const layers: TilemapLayer2D[] = [];
        let layerIndex = 0;

        for (const layerData of data.layers) {
            if (layerData.type !== "tilelayer") {
                Logger.Warn(`Tilemap2D.FromTiled: Skipping unsupported layer "${layerData.name ?? "unnamed"}" of type "${layerData.type}".`);
                continue;
            }

            const tileData: number[] = layerData.data;
            const layerWidth: number = layerData.width ?? width;
            const layerHeight: number = layerData.height ?? height;

            // Convert flat array to 2D [row][col]
            const tiles: number[][] = [];
            for (let row = 0; row < layerHeight; row++) {
                const rowData: number[] = [];
                for (let col = 0; col < layerWidth; col++) {
                    rowData.push(tileData[row * layerWidth + col]);
                }
                tiles.push(rowData);
            }

            const layer = new TilemapLayer2D(layerData.name ?? `layer_${layerIndex}`, layerWidth, layerHeight, tiles);
            layer.zIndex = layerIndex;
            layer.visible = layerData.visible !== false;

            // Check for collision property
            if (layerData.properties) {
                for (const prop of layerData.properties) {
                    if (prop.name === "collision" && prop.value === true) {
                        layer.isCollisionLayer = true;
                    }
                }
            }

            layers.push(layer);
            layerIndex++;
        }

        const tilemap = new Tilemap2D(width, height, tileWidth, tileHeight, layers, tilesetMap, tilesetMeta);

        // Copy parsed animations into the tilemap
        tileAnimMap.forEach((anim, gid) => tilemap.tileAnimations.set(gid, anim));

        return tilemap;
    }

    /**
     * Gets a layer by name
     * @param name - The layer name
     * @returns The layer, or null if not found
     */
    public getLayer(name: string): TilemapLayer2D | null {
        return this.layers.find((l) => l.layerName === name) ?? null;
    }

    // -----------------------------------------------------------------------
    // Animated tiles
    // -----------------------------------------------------------------------

    /**
     * Advances all tile animations by the given delta time.
     * Call this once per frame (e.g., from your game loop).
     * @param deltaTime - Time elapsed since the last frame in **seconds**
     */
    public update(deltaTime: number): void {
        if (this.tileAnimations.size === 0) {
            return;
        }
        const dtMs = deltaTime * 1000;
        this.tileAnimations.forEach((anim) => {
            anim.elapsed += dtMs;
            // Wrap elapsed to total duration (handles long gaps / tab-away)
            if (anim.elapsed >= anim.totalDuration) {
                anim.elapsed %= anim.totalDuration;
            }
            // Walk frames to find the current one
            let accumulated = 0;
            for (let i = 0; i < anim.frames.length; i++) {
                accumulated += anim.frames[i].duration;
                if (anim.elapsed < accumulated) {
                    anim.currentFrame = i;
                    return;
                }
            }
            // Floating-point edge case: land on last frame
            anim.currentFrame = anim.frames.length - 1;
        });
    }

    /**
     * Returns the GID that should be displayed for a tile right now.
     * For animated tiles this returns the current animation frame's GID.
     * For non-animated tiles this returns the input GID unchanged.
     * @param gid - The tile's base global ID (from layer data)
     * @returns The GID to render
     */
    public getDisplayTileId(gid: number): number {
        const anim = this.tileAnimations.get(gid);
        if (anim) {
            return anim.frames[anim.currentFrame].gid;
        }
        return gid;
    }

    /**
     * Registers a tile animation programmatically (without Tiled data).
     * @param gid - The base global tile ID that triggers this animation
     * @param frames - Array of {gid, duration} animation frames
     */
    public addTileAnimation(gid: number, frames: ITileAnimationFrame[]): void {
        let totalDuration = 0;
        for (const f of frames) {
            totalDuration += f.duration;
        }
        this.tileAnimations.set(gid, {
            frames: [...frames],
            totalDuration,
            elapsed: 0,
            currentFrame: 0,
        });
    }

    /**
     * Gets the tile ID at a position on a named layer
     * @param layerName - The layer name
     * @param col - Column index
     * @param row - Row index
     * @returns The tile ID, or 0 if not found
     */
    public getTileAt(layerName: string, col: number, row: number): number {
        const layer = this.getLayer(layerName);
        return layer ? layer.getTileAt(col, row) : 0;
    }

    /**
     * Sets the tile ID at a position on a named layer
     * @param layerName - The layer name
     * @param col - Column index
     * @param row - Row index
     * @param tileId - The tile ID to set
     */
    public setTileAt(layerName: string, col: number, row: number, tileId: number): void {
        const layer = this.getLayer(layerName);
        if (layer) {
            layer.setTileAt(col, row, tileId);
        }
    }

    /**
     * Checks if a tile position is solid (non-zero) on any collision layer
     * @param col - Column index
     * @param row - Row index
     * @returns True if any collision layer has a non-zero tile at this position
     */
    public isSolid(col: number, row: number): boolean {
        for (const layer of this.layers) {
            if (layer.isCollisionLayer && layer.getTileAt(col, row) !== 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * Returns a 2D boolean array indicating solid tiles on all collision layers
     * @returns Boolean grid where true = solid
     */
    public getCollisionGrid(): boolean[][] {
        const grid: boolean[][] = [];
        for (let row = 0; row < this.height; row++) {
            const rowData: boolean[] = [];
            for (let col = 0; col < this.width; col++) {
                rowData.push(this.isSolid(col, row));
            }
            grid.push(rowData);
        }
        return grid;
    }

    /**
     * Converts a world position to tile coordinates
     * @param worldX - World X position in pixels
     * @param worldY - World Y position in pixels
     * @returns An object with col and row
     */
    public worldToTile(worldX: number, worldY: number): { col: number; row: number } {
        return {
            col: Math.floor(worldX / this.tileWidth),
            row: Math.floor(worldY / this.tileHeight),
        };
    }

    /**
     * Converts tile coordinates to world position (top-left corner of tile)
     * @param col - Column index
     * @param row - Row index
     * @returns An object with x and y in world pixels
     */
    public tileToWorld(col: number, row: number): { x: number; y: number } {
        return {
            x: col * this.tileWidth,
            y: row * this.tileHeight,
        };
    }

    /**
     * Gets the bounding rectangle of a tile in world coordinates
     * @param col - Column index
     * @param row - Row index
     * @returns A Rectangle2D in world coordinates
     */
    public getTileBounds(col: number, row: number): Rectangle2D {
        return new Rectangle2D(col * this.tileWidth, row * this.tileHeight, this.tileWidth, this.tileHeight);
    }
}
