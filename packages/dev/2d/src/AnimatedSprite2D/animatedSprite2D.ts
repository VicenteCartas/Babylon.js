import { Observable } from "core/Misc/observable";
import type { BaseTexture } from "core/Materials/Textures/baseTexture";

import { Sprite2D } from "../Sprite2D/sprite2D";
import type { SpriteSheet, ISpriteAnimation } from "../SpriteSheet/spriteSheet";

/**
 * A sprite that plays frame-based animations from a SpriteSheet.
 * Extends Sprite2D with animation playback controls and events.
 */
export class AnimatedSprite2D extends Sprite2D {
    /**
     * The sprite sheet containing frames and animation definitions
     */
    public spriteSheet: SpriteSheet;

    /**
     * Playback speed multiplier (1 = normal, 2 = double speed, 0.5 = half speed)
     */
    public speed: number = 1;

    /**
     * Observable triggered when an animation finishes (with the animation name)
     */
    public onAnimationEnd: Observable<string> = new Observable<string>();

    /**
     * Observable triggered when the current frame changes (with the frame index)
     */
    public onFrameChange: Observable<number> = new Observable<number>();

    private _currentAnimation: ISpriteAnimation | null = null;
    private _currentFrame: number = 0;
    private _isPlaying: boolean = false;
    private _loop: boolean = false;
    private _elapsed: number = 0;

    /**
     * Creates a new AnimatedSprite2D
     * @param name - Name of the sprite
     * @param spriteSheet - The sprite sheet containing frames and animations
     */
    constructor(name: string, spriteSheet: SpriteSheet) {
        super(name);
        this.texture = spriteSheet.texture as BaseTexture;
        this.spriteSheet = spriteSheet;
    }

    /**
     * The name of the currently playing animation, or empty string if none
     */
    public get currentAnimation(): string {
        return this._currentAnimation?.name ?? "";
    }

    /**
     * The index into the current animation's frame array
     */
    public get currentFrame(): number {
        return this._currentFrame;
    }

    /**
     * Whether an animation is currently playing
     */
    public get isPlaying(): boolean {
        return this._isPlaying;
    }

    /**
     * Plays a named animation
     * @param animationName - Name of the animation defined in the sprite sheet
     * @param loop - Whether to loop the animation (default: true)
     */
    public play(animationName: string, loop: boolean = true): void {
        const anim = this.spriteSheet.getAnimation(animationName);
        if (!anim || anim.frames.length === 0) {
            return;
        }

        // Don't restart if already playing the same animation
        if (this._currentAnimation === anim && this._isPlaying) {
            return;
        }

        this._currentAnimation = anim;
        this._currentFrame = 0;
        this._isPlaying = true;
        this._loop = loop;
        this._elapsed = 0;

        this._applyFrame();
    }

    /**
     * Stops the current animation
     */
    public stop(): void {
        this._isPlaying = false;
    }

    /**
     * Pauses the current animation (can be resumed with play)
     */
    public pause(): void {
        this._isPlaying = false;
    }

    /**
     * Updates the animation state. Called each frame via Node2D.update().
     * @param deltaTime - Time elapsed since last frame in seconds
     */
    public override update(deltaTime: number): void {
        if (this._isPlaying && this._currentAnimation) {
            this._elapsed += deltaTime * this.speed;

            const frameDuration = 1.0 / this._currentAnimation.frameRate;
            const totalFrames = this._currentAnimation.frames.length;

            if (this._elapsed >= frameDuration) {
                const framesToAdvance = Math.floor(this._elapsed / frameDuration);
                this._elapsed -= framesToAdvance * frameDuration;

                const newFrame = this._currentFrame + framesToAdvance;

                if (newFrame >= totalFrames) {
                    if (this._loop) {
                        this._currentFrame = newFrame % totalFrames;
                        this._applyFrame();
                    } else {
                        this._currentFrame = totalFrames - 1;
                        this._isPlaying = false;
                        this._applyFrame();
                        this.onAnimationEnd.notifyObservers(this._currentAnimation.name);
                    }
                } else {
                    this._currentFrame = newFrame;
                    this._applyFrame();
                }
            }
        }

        // Call parent update to propagate to children and notify observers
        super.update(deltaTime);
    }

    /**
     * Sets the sourceRect on the Sprite2D base class to match the current animation frame
     */
    private _applyFrame(): void {
        if (!this._currentAnimation) {
            return;
        }

        const frameIndex = this._currentAnimation.frames[this._currentFrame];
        this.sourceRect = this.spriteSheet.getFrame(frameIndex);
        this.onFrameChange.notifyObservers(this._currentFrame);
    }

    /**
     * Disposes of this animated sprite
     */
    public override dispose(): void {
        this.onAnimationEnd.clear();
        this.onFrameChange.clear();
        super.dispose();
    }
}
