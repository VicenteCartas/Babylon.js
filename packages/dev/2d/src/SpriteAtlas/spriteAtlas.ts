import type { BaseTexture } from "core/Materials/Textures/baseTexture";

import type { Rectangle2D } from "../Math/rectangle2D";
import type { SpriteSheet } from "../SpriteSheet/spriteSheet";

/**
 * Result of a sprite atlas build operation.
 * Contains the packed texture, a compatible SpriteSheet, and frame lookup by key.
 * 
 * @example
 * ```typescript
 * const atlas = await builder.buildAsync();
 * 
 * // Get frame data by key
 * const playerFrame = atlas.getFrame("player");
 * if (playerFrame) {
 *     console.log(`Player is at (${playerFrame.x}, ${playerFrame.y})`);
 * }
 * 
 * // Check if frame exists
 * if (atlas.hasFrame("enemy")) {
 *     const enemySprite = new Sprite2D("enemy", scene);
 *     enemySprite.texture = atlas.texture;
 *     enemySprite.sourceRect = atlas.getFrame("enemy");
 * }
 * 
 * // Get all available frames
 * const allKeys = atlas.getFrameKeys();
 * console.log(`Atlas contains ${allKeys.length} frames:`, allKeys);
 * ```
 */
export class SpriteAtlas {
    /**
     * The packed atlas texture
     */
    public readonly texture: BaseTexture;

    /**
     * A SpriteSheet created from the atlas data
     */
    public readonly spriteSheet: SpriteSheet;

    /**
     * Map of image keys to their frame rectangles
     */
    private readonly _frames: Map<string, Rectangle2D>;

    /**
     * Creates a new SpriteAtlas
     * @param texture - The packed atlas texture
     * @param spriteSheet - A SpriteSheet created from the atlas
     * @param frames - Map of image keys to frame rectangles
     */
    constructor(texture: BaseTexture, spriteSheet: SpriteSheet, frames: Map<string, Rectangle2D>) {
        this.texture = texture;
        this.spriteSheet = spriteSheet;
        this._frames = frames;
    }

    /**
     * Gets the frame rectangle for a specific image by key
     * @param key - The image key provided when adding the image
     * @returns The frame rectangle, or undefined if not found
     */
    public getFrame(key: string): Rectangle2D | undefined {
        return this._frames.get(key);
    }

    /**
     * Gets all frame keys in the atlas
     * @returns Array of all image keys
     */
    public getFrameKeys(): string[] {
        return Array.from(this._frames.keys());
    }

    /**
     * Checks if the atlas contains a frame with the given key
     * @param key - The image key to check
     * @returns True if the frame exists
     */
    public hasFrame(key: string): boolean {
        return this._frames.has(key);
    }
}
