import { Observable } from "core/Misc/observable";
import { Logger } from "core/Misc/logger";

import { Rectangle2D } from "../Math/rectangle2D";
import type { Scene2D } from "../Scene2D/scene2D";
import { Sprite2D } from "../Sprite2D/sprite2D";
import { SpriteSheet } from "../SpriteSheet/spriteSheet";

/**
 * Defines a named animation sequence.
 */
export interface IAnimationClip {
    /** Unique clip name. */
    name: string;
    /** Frame indices referencing SpriteSheet frames. */
    frames: number[];
    /** Playback rate in frames per second. */
    fps?: number;
    /** Whether the clip loops. */
    loop?: boolean;
    /** Whether the loop ping-pongs between the ends. */
    pingPong?: boolean;
}

/**
 * A sprite with frame-based animation driven by named clips.
 */
export class AnimatedSprite2D extends Sprite2D {
    /**
     * The spritesheet containing all frames.
     */
    public readonly spriteSheet: SpriteSheet;

    /**
     * Playback speed multiplier.
     */
    public playbackSpeed: number = 1;

    /**
     * Fires when the displayed frame changes.
     */
    public readonly onFrameChange: Observable<number> = new Observable<number>();

    /**
     * Fires when the animation reaches its last frame.
     */
    public readonly onAnimationEnd: Observable<string> = new Observable<string>();

    /**
     * Fires when a looping animation wraps back to its start.
     */
    public readonly onLoop: Observable<string> = new Observable<string>();

    private _clips: Map<string, IAnimationClip> = new Map();
    private _currentClipData: IAnimationClip | null = null;
    private _currentFrameIndex: number = 0;
    private _currentClipName: string | null = null;
    private _isPaused: boolean = false;
    private _isStopped: boolean = true;
    private _isReverse: boolean = false;
    private _elapsed: number = 0;
    private _frameRect: Rectangle2D = new Rectangle2D();

    /**
     * Creates a new AnimatedSprite2D.
     * @param name - Sprite name.
     * @param spriteSheet - The spritesheet containing animation frames.
     * @param scene - Optional owning scene.
     */
    constructor(name: string, spriteSheet: SpriteSheet, scene?: Scene2D | null) {
        super(name, scene);
        this.spriteSheet = spriteSheet;
        this.texture = spriteSheet.texture;
        this.sourceRect = this._frameRect;
        this.onUpdate.add((deltaTime) => {
            this.advanceTime(deltaTime);
        });
    }

    /**
     * Name of the currently playing clip, or null when stopped.
     */
    public get currentClip(): string | null {
        if (this._isStopped) {
            return null;
        }

        return this._currentClipName;
    }

    /**
     * Current frame index within the active clip.
     */
    public get currentFrameIndex(): number {
        return this._currentFrameIndex;
    }

    /**
     * Whether playback is currently paused.
     */
    public get isPaused(): boolean {
        return this._isPaused;
    }

    /**
     * Registers or replaces an animation clip.
     * @param clip - The clip definition.
     */
    public addClip(clip: IAnimationClip): void {
        const normalizedClip: IAnimationClip = {
            name: clip.name,
            frames: clip.frames.slice(),
            fps: clip.fps,
            loop: clip.loop,
            pingPong: clip.pingPong,
        };

        this._clips.set(normalizedClip.name, normalizedClip);

        if (this._currentClipName === normalizedClip.name) {
            this._currentClipData = normalizedClip;
            if (normalizedClip.frames.length === 0) {
                this._currentFrameIndex = 0;
                this._isStopped = true;
                this._frameRect.x = 0;
                this._frameRect.y = 0;
                this._frameRect.width = 0;
                this._frameRect.height = 0;
                return;
            }

            if (this._currentFrameIndex >= normalizedClip.frames.length) {
                this._currentFrameIndex = normalizedClip.frames.length - 1;
            }

            this._applyFrame(true);
        }
    }

    /**
     * Starts playing a named clip.
     * @param clipName - The clip name.
     * @param forceRestart - Whether to restart even if the clip is already active.
     */
    public play(clipName: string, forceRestart: boolean = false): void {
        const clip = this._clips.get(clipName);
        if (!clip || clip.frames.length === 0) {
            Logger.Warn(`AnimatedSprite2D '${this.name}' cannot play missing clip '${clipName}'.`);
            return;
        }

        if (this._currentClipName === clipName && !this._isStopped && !forceRestart) {
            return;
        }

        this._currentClipData = clip;
        this._currentClipName = clipName;
        this._currentFrameIndex = 0;
        this._isPaused = false;
        this._isStopped = false;
        this._isReverse = false;
        this._elapsed = 0;
        this._applyFrame(true);
    }

    /**
     * Pauses playback at the current frame.
     */
    public pause(): void {
        if (!this._currentClipData || this._isStopped) {
            return;
        }

        this._isPaused = true;
    }

    /**
     * Resumes a paused animation.
     */
    public resume(): void {
        if (!this._currentClipData || !this._isPaused) {
            return;
        }

        this._isPaused = false;
        this._isStopped = false;
    }

    /**
     * Stops playback and resets to the first frame of the current clip.
     */
    public stop(): void {
        if (!this._currentClipData) {
            return;
        }

        this._isPaused = false;
        this._isStopped = true;
        this._isReverse = false;
        this._elapsed = 0;
        this._currentFrameIndex = 0;
        this._applyFrame(false);
    }

    /**
     * Jumps to a frame within the current clip.
     * @param frameIndexInClip - The frame index within the clip.
     */
    public gotoFrame(frameIndexInClip: number): void {
        const clip = this._currentClipData;
        if (!clip || clip.frames.length === 0) {
            return;
        }

        let targetIndex = Math.floor(frameIndexInClip);
        if (targetIndex < 0) {
            targetIndex = 0;
        } else if (targetIndex >= clip.frames.length) {
            targetIndex = clip.frames.length - 1;
        }

        if (targetIndex === this._currentFrameIndex) {
            return;
        }

        this._currentFrameIndex = targetIndex;
        this._elapsed = 0;
        this._applyFrame(true);
    }

    /**
     * Advances the animation by elapsed time.
     * @param deltaTime - Elapsed time in seconds.
     */
    public advanceTime(deltaTime: number): void {
        const clip = this._currentClipData;
        if (!clip || this._isStopped || this._isPaused || deltaTime <= 0 || this.playbackSpeed <= 0) {
            return;
        }

        const frameRate = clip.fps && clip.fps > 0 ? clip.fps : 12;
        const frameDuration = 1 / frameRate;
        this._elapsed += deltaTime * this.playbackSpeed;

        while (this._elapsed >= frameDuration) {
            this._elapsed -= frameDuration;
            this._advanceFrame();
            if (this._isStopped) {
                this._elapsed = 0;
                break;
            }
        }
    }

    /**
     * Disposes the sprite and clears animation observables.
     */
    public override dispose(): void {
        this.onFrameChange.clear();
        this.onAnimationEnd.clear();
        this.onLoop.clear();
        super.dispose();
    }

    private _advanceFrame(): void {
        const clip = this._currentClipData;
        if (!clip || clip.frames.length === 0) {
            return;
        }

        const lastFrameIndex = clip.frames.length - 1;
        if (lastFrameIndex <= 0) {
            this.onAnimationEnd.notifyObservers(clip.name);
            if (clip.loop ?? true) {
                this.onLoop.notifyObservers(clip.name);
            } else {
                this._isStopped = true;
            }
            this._applyFrame(false);
            return;
        }

        if (clip.pingPong && (clip.loop ?? true)) {
            if (!this._isReverse) {
                if (this._currentFrameIndex < lastFrameIndex) {
                    this._currentFrameIndex++;
                    this._applyFrame(true);
                    if (this._currentFrameIndex === lastFrameIndex) {
                        this.onAnimationEnd.notifyObservers(clip.name);
                        this._isReverse = true;
                    }
                    return;
                }

                this._isReverse = true;
            }

            if (this._currentFrameIndex > 0) {
                this._currentFrameIndex--;
                this._applyFrame(true);
                if (this._currentFrameIndex === 0) {
                    this._isReverse = false;
                    this.onLoop.notifyObservers(clip.name);
                }
            }
            return;
        }

        if (this._currentFrameIndex < lastFrameIndex) {
            this._currentFrameIndex++;
            this._applyFrame(true);
            if (this._currentFrameIndex === lastFrameIndex) {
                this.onAnimationEnd.notifyObservers(clip.name);
                if (!(clip.loop ?? true)) {
                    this._isStopped = true;
                }
            }
            return;
        }

        if (clip.loop ?? true) {
            this._currentFrameIndex = 0;
            this._applyFrame(true);
            this.onLoop.notifyObservers(clip.name);
        } else {
            this._isStopped = true;
            this._applyFrame(false);
        }
    }

    private _applyFrame(notify: boolean): void {
        const clip = this._currentClipData;
        if (!clip || clip.frames.length === 0) {
            this._frameRect.x = 0;
            this._frameRect.y = 0;
            this._frameRect.width = 0;
            this._frameRect.height = 0;
            return;
        }

        this.spriteSheet.getFrameRect(clip.frames[this._currentFrameIndex], this._frameRect);
        if (this.sourceRect !== this._frameRect) {
            this.sourceRect = this._frameRect;
        }

        if (notify) {
            this.onFrameChange.notifyObservers(this._currentFrameIndex);
        }
    }
}
