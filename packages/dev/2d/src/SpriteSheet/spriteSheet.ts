import type { BaseTexture } from "core/Materials/Textures/baseTexture";

import { Rectangle2D } from "../Math/rectangle2D";

/**
 * Defines a named animation as a sequence of frame indices and a frame rate.
 */
export interface ISpriteAnimation {
    /**
     * Name of the animation
     */
    name: string;
    /**
     * Array of frame indices in the sprite sheet
     */
    frames: number[];
    /**
     * Frames per second
     */
    frameRate: number;
}

/**
 * A sprite sheet that defines frames (regions) within a texture.
 * Supports both uniform grid-based layouts and JSON atlas data.
 */
export class SpriteSheet {
    /**
     * The source texture containing all frames
     */
    public readonly texture: BaseTexture;

    private _frames: Rectangle2D[] = [];
    private _animations: Map<string, ISpriteAnimation> = new Map();

    /**
     * Creates a new SpriteSheet
     * @param texture - The source texture
     */
    constructor(texture: BaseTexture) {
        this.texture = texture;
    }

    /**
     * Creates a SpriteSheet from a uniform grid layout
     * @param texture - The source texture
     * @param frameWidth - Width of each frame in pixels
     * @param frameHeight - Height of each frame in pixels
     * @param frameCount - Optional total number of frames (defaults to all cells in grid)
     * @param startFrame - Optional first frame index (defaults to 0)
     * @returns A new SpriteSheet
     */
    public static FromGrid(texture: BaseTexture, frameWidth: number, frameHeight: number, frameCount?: number, startFrame: number = 0): SpriteSheet {
        const sheet = new SpriteSheet(texture);
        const size = texture.getSize();

        if (size.width === 0 || size.height === 0) {
            return sheet;
        }

        const cols = Math.floor(size.width / frameWidth);
        const rows = Math.floor(size.height / frameHeight);
        const maxFrames = cols * rows;
        const count = frameCount !== undefined ? Math.min(frameCount, maxFrames - startFrame) : maxFrames - startFrame;

        for (let i = 0; i < count; i++) {
            const frameIndex = startFrame + i;
            const col = frameIndex % cols;
            const row = Math.floor(frameIndex / cols);
            sheet._frames.push(new Rectangle2D(col * frameWidth, row * frameHeight, frameWidth, frameHeight));
        }

        return sheet;
    }

    /**
     * Creates a SpriteSheet from JSON atlas data (supports TexturePacker JSON Hash and JSON Array formats)
     * @param texture - The source texture
     * @param atlasData - The parsed JSON atlas data
     * @returns A new SpriteSheet
     */
    public static FromAtlas(texture: BaseTexture, atlasData: { frames: any }): SpriteSheet {
        const sheet = new SpriteSheet(texture);
        const frames = atlasData.frames;

        if (Array.isArray(frames)) {
            // JSON Array format
            for (const frame of frames) {
                const f = frame.frame;
                sheet._frames.push(new Rectangle2D(f.x, f.y, f.w, f.h));
            }
        } else {
            // JSON Hash format
            for (const key of Object.keys(frames)) {
                const f = frames[key].frame;
                sheet._frames.push(new Rectangle2D(f.x, f.y, f.w, f.h));
            }
        }

        return sheet;
    }

    /**
     * Gets the number of frames in this sprite sheet
     */
    public get frameCount(): number {
        return this._frames.length;
    }

    /**
     * Gets the source rectangle for a frame by index (in pixels)
     * @param index - The frame index
     * @returns The frame rectangle, or a zero rectangle if out of bounds
     */
    public getFrame(index: number): Rectangle2D {
        if (index < 0 || index >= this._frames.length) {
            return new Rectangle2D();
        }
        return this._frames[index];
    }

    /**
     * Defines a named animation
     * @param name - The animation name
     * @param frames - Array of frame indices
     * @param frameRate - Frames per second
     */
    public defineAnimation(name: string, frames: number[], frameRate: number): void {
        this._animations.set(name, { name, frames, frameRate });
    }

    /**
     * Gets a named animation definition
     * @param name - The animation name
     * @returns The animation definition, or undefined if not found
     */
    public getAnimation(name: string): ISpriteAnimation | undefined {
        return this._animations.get(name);
    }

    /**
     * Gets all defined animation names
     * @returns Array of animation names
     */
    public getAnimationNames(): string[] {
        return Array.from(this._animations.keys());
    }
}
