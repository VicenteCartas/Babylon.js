import { Color4 } from "core/Maths/math.color";
import { Vector2 } from "core/Maths/math.vector";
import { Observable } from "core/Misc/observable";

import { RenderTexture2D } from "../RenderTexture/renderTexture2D";
import { Scene2D } from "../Scene2D/scene2D";
import { Sprite2D } from "../Sprite2D/sprite2D";
import { Easing } from "../Tween/easing";
import type { EasingFunction } from "../Tween/easing";
import { Tween } from "../Tween/tween";

/**
 * Options for a fade transition.
 */
export interface IFadeTransitionOptions {
    /** The scene to transition away from. */
    from: Scene2D;
    /** The scene to transition to. */
    to: Scene2D;
    /** Total duration in seconds (split 50/50 between fade-out and fade-in). Default: 0.5. */
    duration?: number;
    /** The color to fade through. Default: black. */
    color?: Color4;
    /** Easing for both fade phases. Default: Easing.SineInOut. */
    easing?: EasingFunction;
    /** Called when the transition is fully complete. */
    onComplete?: () => void;
}

/**
 * Options for a slide transition.
 */
export interface ISlideTransitionOptions {
    /** The scene to transition away from. */
    from: Scene2D;
    /** The scene to transition to. */
    to: Scene2D;
    /** Total duration in seconds. Default: 0.5. */
    duration?: number;
    /**
     * Direction the outgoing scene slides toward.
     * The incoming scene enters from the opposite direction.
     * Default: "left".
     */
    direction?: "left" | "right" | "up" | "down";
    /** Easing for the slide. Default: Easing.CubicInOut. */
    easing?: EasingFunction;
    /** Called when the transition is fully complete. */
    onComplete?: () => void;
}

/**
 * Options for a custom transition.
 */
export interface ICustomTransitionOptions {
    /** The scene to transition away from. */
    from: Scene2D;
    /** The scene to transition to. */
    to: Scene2D;
    /** Total duration in seconds. Default: 0.5. */
    duration?: number;
    /**
     * Progress callback, called each frame with t in [0..1].
     * The callback is responsible for all visual manipulation.
     */
    onProgress: (t: number, from: Scene2D, to: Scene2D) => void;
    /** Easing for the transition progress. Default: Easing.Linear. */
    easing?: EasingFunction;
    /** Called when the transition is fully complete. */
    onComplete?: () => void;
}

type TransitionType = "fade" | "slide" | "custom";
type TransitionPhase = "out" | "in" | "running" | "done";

/**
 * Manages animated transitions between two Scene2D instances.
 *
 * Transition timing is driven by Tween, while the actual frame compositing is
 * integrated into Scene2D.render()/renderContent(). Callers keep using their
 * normal scene render loop and advance the transition with update(dt).
 */
export class SceneTransition2D {
    /** Fires when the transition completes. */
    public readonly onComplete: Observable<SceneTransition2D> = new Observable<SceneTransition2D>();

    private readonly _fromScene: Scene2D;
    private readonly _toScene: Scene2D;
    private readonly _type: TransitionType;
    private readonly _duration: number;
    private readonly _easing: EasingFunction;
    private readonly _onCompleteCallback: (() => void) | null;

    private _phase: TransitionPhase;
    private _progress: number = 0;
    private _lastAppliedProgress: number = -1;
    private _tween: Tween | null = null;

    private _overlay: Sprite2D | null = null;
    private _fadeColor: Color4 = new Color4(0, 0, 0, 1);

    private _slideDirection: Vector2 = Vector2.Zero();
    private _slideCompositeScene: Scene2D | null = null;
    private _slideFromTexture: RenderTexture2D | null = null;
    private _slideToTexture: RenderTexture2D | null = null;
    private _slideFromSprite: Sprite2D | null = null;
    private _slideToSprite: Sprite2D | null = null;

    private _customOnProgress: ((t: number, from: Scene2D, to: Scene2D) => void) | null = null;

    private constructor(type: TransitionType, from: Scene2D, to: Scene2D, duration: number, easing: EasingFunction, onComplete?: () => void) {
        this._type = type;
        this._fromScene = from;
        this._toScene = to;
        this._duration = Math.max(duration, 0);
        this._easing = easing;
        this._onCompleteCallback = onComplete ?? null;
        this._phase = type === "fade" ? "out" : "running";
    }

    /**
     * Creates and starts a fade transition.
     * @param options - Fade transition options.
     * @returns The running transition instance.
     */
    public static fade(options: IFadeTransitionOptions): SceneTransition2D {
        const duration = options.duration ?? 0.5;
        const easing = options.easing ?? Easing.SineInOut;
        const color = options.color ?? new Color4(0, 0, 0, 1);

        const transition = new SceneTransition2D("fade", options.from, options.to, duration, easing, options.onComplete);
        transition._fadeColor = new Color4(color.r, color.g, color.b, color.a);
        transition._setupFadeOverlay();
        transition._registerWithScenes();
        transition._start();
        transition._applyCurrentState();
        if (transition._duration === 0) {
            transition.update(0);
        }
        return transition;
    }

    /**
     * Creates and starts a slide transition.
     * @param options - Slide transition options.
     * @returns The running transition instance.
     */
    public static slide(options: ISlideTransitionOptions): SceneTransition2D {
        const duration = options.duration ?? 0.5;
        const easing = options.easing ?? Easing.CubicInOut;

        const transition = new SceneTransition2D("slide", options.from, options.to, duration, easing, options.onComplete);
        if (!transition._setupSlide(options.direction ?? "left")) {
            return SceneTransition2D.fade({
                from: options.from,
                to: options.to,
                duration,
                easing: options.easing,
                onComplete: options.onComplete,
            });
        }

        transition._registerWithScenes();
        transition._start();
        transition._applyCurrentState();
        if (transition._duration === 0) {
            transition.update(0);
        }
        return transition;
    }

    /**
     * Creates and starts a custom transition.
     * @param options - Custom transition options.
     * @returns The running transition instance.
     */
    public static custom(options: ICustomTransitionOptions): SceneTransition2D {
        const duration = options.duration ?? 0.5;
        const easing = options.easing ?? Easing.Linear;

        const transition = new SceneTransition2D("custom", options.from, options.to, duration, easing, options.onComplete);
        transition._customOnProgress = options.onProgress;
        transition._registerWithScenes();
        transition._start();
        transition._applyCurrentState();
        if (transition._duration === 0) {
            transition.update(0);
        }
        return transition;
    }

    /**
     * Current normalized progress in [0..1].
     * @returns The transition progress.
     */
    public get progress(): number {
        return this._progress;
    }

    /**
     * Whether the transition is still running.
     * @returns True while the transition is active.
     */
    public get isRunning(): boolean {
        return this._phase !== "done";
    }

    /**
     * Advances the transition by deltaTime.
     * @param deltaTime - Time elapsed since the last frame in seconds.
     * @returns void
     */
    public update(deltaTime: number): void {
        if (!this.isRunning || !this._tween) {
            return;
        }

        this._tween.update(Math.max(deltaTime, 0));
    }

    /**
     * Cancels the transition at the current progress.
     * The completion callback and observable are not fired.
     * @returns void
     */
    public cancel(): void {
        if (!this.isRunning) {
            return;
        }

        this._disposeTween();
        this._cleanupVisuals();
        this._unregisterFromScenes();
        this._phase = "done";
        this.onComplete.clear();
    }

    /**
     * @internal
     * Renders the transition into the current frame ownership mode.
     * @param ownsFrame - Whether beginFrame/endFrame should be called.
     * @param clear - Whether to clear the target framebuffer.
     * @param autoUpdate - Whether participant scenes should auto-update.
     * @param deltaTime - Optional delta time in seconds.
     */
    public _render(ownsFrame: boolean, clear: boolean, autoUpdate: boolean, deltaTime?: number): void {
        const engine = this._fromScene.engine;
        if (ownsFrame) {
            engine.beginFrame();
        }

        try {
            switch (this._type) {
                case "fade": {
                    const scene = this._progress < 0.5 ? this._fromScene : this._toScene;
                    scene._renderContentDirect(clear, autoUpdate, deltaTime);
                    break;
                }
                case "slide": {
                    this._renderSlideFrame(clear, autoUpdate, deltaTime);
                    break;
                }
                case "custom": {
                    this._fromScene._renderContentDirect(clear, autoUpdate, deltaTime);
                    this._toScene._renderContentDirect(false, autoUpdate, deltaTime);
                    break;
                }
            }
        } finally {
            if (ownsFrame) {
                engine.endFrame();
            }
        }
    }

    private _start(): void {
        this._tween = new Tween({ from: 0, to: 1 }, this._duration, Easing.Linear)
            .onUpdate((value) => {
                if (value === this._lastAppliedProgress) {
                    return;
                }

                this._progress = value;
                this._lastAppliedProgress = value;
                this._applyCurrentState();
            })
            .onComplete(() => {
                this._complete();
            })
            .start();
    }

    private _applyCurrentState(): void {
        switch (this._type) {
            case "fade":
                this._updateFade();
                break;
            case "slide":
                this._updateSlide();
                break;
            case "custom":
                this._updateCustom();
                break;
        }
    }

    private _registerWithScenes(): void {
        const fromTransition = this._fromScene._getSceneTransition();
        const toTransition = this._toScene._getSceneTransition();

        if (fromTransition && fromTransition !== this) {
            fromTransition.cancel();
        }
        if (toTransition && toTransition !== this && toTransition !== fromTransition) {
            toTransition.cancel();
        }

        this._fromScene._attachSceneTransition(this);
        if (this._toScene !== this._fromScene) {
            this._toScene._attachSceneTransition(this);
        }
    }

    private _unregisterFromScenes(): void {
        this._fromScene._detachSceneTransition(this);
        if (this._toScene !== this._fromScene) {
            this._toScene._detachSceneTransition(this);
        }
    }

    private _setupFadeOverlay(): void {
        const overlay = new Sprite2D("__transition_overlay__", null);
        overlay.tint = new Color4(this._fadeColor.r, this._fadeColor.g, this._fadeColor.b, 0);
        overlay.scrollFactorX = 0;
        overlay.scrollFactorY = 0;
        overlay.sortingLayer = Number.MAX_SAFE_INTEGER;
        this._syncFullscreenSprite(overlay, this._fromScene.engine);
        this._fromScene._addOverlay(overlay);
        this._overlay = overlay;
    }

    private _updateFade(): void {
        const overlay = this._overlay;
        if (!overlay) {
            return;
        }

        const midpoint = 0.5;
        if (this._progress < midpoint) {
            this._phase = "out";
            const phaseProgress = midpoint > 0 ? this._progress / midpoint : 1;
            overlay.tint.a = this._fadeColor.a * this._easing(phaseProgress);
            this._syncFullscreenSprite(overlay, this._fromScene.engine);
            return;
        }

        if (this._phase === "out") {
            this._fromScene._removeOverlay(overlay);
            this._toScene._addOverlay(overlay);
        }

        this._phase = "in";
        const phaseProgress = midpoint > 0 ? (this._progress - midpoint) / midpoint : 1;
        const clampedPhaseProgress = Math.min(Math.max(phaseProgress, 0), 1);
        overlay.tint.a = this._fadeColor.a * (1 - this._easing(clampedPhaseProgress));
        this._syncFullscreenSprite(overlay, this._toScene.engine);
    }

    private _setupSlide(direction: "left" | "right" | "up" | "down"): boolean {
        const engine = this._fromScene.engine as {
            getRenderWidth: () => number;
            getRenderHeight: () => number;
            createRenderTargetTexture?: unknown;
            bindFramebuffer?: unknown;
            restoreDefaultFramebuffer?: unknown;
            unbindAllTextures?: unknown;
        };

        if (typeof engine.createRenderTargetTexture !== "function" || typeof engine.bindFramebuffer !== "function" || typeof engine.restoreDefaultFramebuffer !== "function" || typeof engine.unbindAllTextures !== "function") {
            return false;
        }

        const width = engine.getRenderWidth();
        const height = engine.getRenderHeight();

        switch (direction) {
            case "left":
                this._slideDirection = new Vector2(-width, 0);
                break;
            case "right":
                this._slideDirection = new Vector2(width, 0);
                break;
            case "up":
                this._slideDirection = new Vector2(0, -height);
                break;
            case "down":
                this._slideDirection = new Vector2(0, height);
                break;
        }

        try {
            this._slideFromTexture = new RenderTexture2D("__transition_from__", this._fromScene.engine, width, height);
            this._slideToTexture = new RenderTexture2D("__transition_to__", this._toScene.engine, width, height);
            this._slideCompositeScene = new Scene2D(this._fromScene.engine);
            this._slideCompositeScene.backgroundColor = new Color4(0, 0, 0, 1);

            this._slideFromSprite = new Sprite2D("__transition_slide_from__", this._slideCompositeScene);
            this._slideToSprite = new Sprite2D("__transition_slide_to__", this._slideCompositeScene);

            this._slideFromSprite.texture = this._slideFromTexture.texture;
            this._slideToSprite.texture = this._slideToTexture.texture;
            this._slideFromSprite.sortingLayer = 0;
            this._slideToSprite.sortingLayer = 1;
            this._slideFromSprite.scrollFactorX = 0;
            this._slideFromSprite.scrollFactorY = 0;
            this._slideToSprite.scrollFactorX = 0;
            this._slideToSprite.scrollFactorY = 0;

            this._syncSlideSprites(0);
            return true;
        } catch {
            this._cleanupSlide();
            return false;
        }
    }

    private _updateSlide(): void {
        this._phase = this._progress < 0.5 ? "out" : "in";
        this._syncSlideSprites(this._easing(this._progress));
    }

    private _updateCustom(): void {
        this._phase = this._progress < 0.5 ? "out" : "in";
        this._customOnProgress?.(this._easing(this._progress), this._fromScene, this._toScene);
    }

    private _renderSlideFrame(clear: boolean, autoUpdate: boolean, deltaTime?: number): void {
        if (!this._slideCompositeScene || !this._slideFromTexture || !this._slideToTexture) {
            this._fromScene._renderContentDirect(clear, autoUpdate, deltaTime);
            return;
        }

        this._renderSceneToTexture(this._slideFromTexture, this._fromScene, autoUpdate, deltaTime);
        this._renderSceneToTexture(this._slideToTexture, this._toScene, autoUpdate, deltaTime);
        this._slideCompositeScene._renderContentDirect(clear, false);
    }

    private _syncSlideSprites(easedProgress: number): void {
        if (!this._slideFromSprite || !this._slideToSprite || !this._slideCompositeScene) {
            return;
        }

        const engine = this._slideCompositeScene.engine;
        const width = engine.getRenderWidth();
        const height = engine.getRenderHeight();
        const centerX = width * 0.5;
        const centerY = height * 0.5;

        this._syncFullscreenSprite(this._slideFromSprite, engine);
        this._syncFullscreenSprite(this._slideToSprite, engine);

        this._slideFromSprite.position.x = centerX + this._slideDirection.x * easedProgress;
        this._slideFromSprite.position.y = centerY + this._slideDirection.y * easedProgress;
        this._slideToSprite.position.x = centerX - this._slideDirection.x * (1 - easedProgress);
        this._slideToSprite.position.y = centerY - this._slideDirection.y * (1 - easedProgress);
    }

    private _renderSceneToTexture(texture: RenderTexture2D, scene: Scene2D, autoUpdate: boolean, deltaTime?: number): void {
        const engine = scene.engine as {
            bindFramebuffer: (framebuffer: unknown) => void;
            restoreDefaultFramebuffer: () => void;
            unbindAllTextures?: () => void;
        };

        if (scene.camera) {
            if (autoUpdate) {
                scene.camera.update(deltaTime ?? 0, texture.width, texture.height);
            } else {
                scene.camera.setViewport(texture.width, texture.height);
            }
        }

        if (autoUpdate) {
            scene.update(deltaTime ?? 0);
        }

        engine.unbindAllTextures?.();
        engine.bindFramebuffer(texture.renderTarget);
        try {
            scene._renderContentDirect(true, false);
        } finally {
            engine.restoreDefaultFramebuffer();
        }
    }

    private _syncFullscreenSprite(sprite: Sprite2D, engine: { getRenderWidth: () => number; getRenderHeight: () => number }): void {
        const width = engine.getRenderWidth();
        const height = engine.getRenderHeight();
        sprite.width = width;
        sprite.height = height;
        sprite.position.x = width * 0.5;
        sprite.position.y = height * 0.5;
    }

    private _complete(): void {
        if (!this.isRunning) {
            return;
        }

        this._disposeTween();
        this._progress = 1;
        this._lastAppliedProgress = 1;
        this._applyCurrentState();
        this._cleanupVisuals();
        this._unregisterFromScenes();
        this._phase = "done";
        this._onCompleteCallback?.();
        this.onComplete.notifyObservers(this);
        this.onComplete.clear();
    }

    private _disposeTween(): void {
        if (!this._tween) {
            return;
        }

        this._tween.dispose();
        this._tween = null;
    }

    private _cleanupVisuals(): void {
        if (this._overlay) {
            if (this._fromScene._isOverlayNode(this._overlay)) {
                this._fromScene._removeOverlay(this._overlay);
            }
            if (this._toScene._isOverlayNode(this._overlay)) {
                this._toScene._removeOverlay(this._overlay);
            }
            this._overlay.dispose();
            this._overlay = null;
        }

        this._cleanupSlide();
    }

    private _cleanupSlide(): void {
        if (this._slideCompositeScene) {
            this._slideCompositeScene.dispose();
            this._slideCompositeScene = null;
        }

        if (this._slideFromTexture) {
            this._slideFromTexture.dispose();
            this._slideFromTexture = null;
        }

        if (this._slideToTexture) {
            this._slideToTexture.dispose();
            this._slideToTexture = null;
        }

        this._slideFromSprite = null;
        this._slideToSprite = null;
    }
}
