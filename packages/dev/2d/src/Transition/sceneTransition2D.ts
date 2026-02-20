import { Color4 } from "core/Maths/math.color";
import { Vector2 } from "core/Maths/math.vector";

import { Sprite2D } from "../Sprite2D/sprite2D";
import type { Scene2D } from "../Scene2D/scene2D";
import { Easing } from "../Tween/easing";
import type { EasingFunction } from "../Tween/easing";

/**
 * Options for a fade transition
 */
export interface IFadeTransitionOptions {
    /** The scene to transition from */
    from: Scene2D;
    /** The scene to transition to */
    to: Scene2D;
    /** Total transition duration in seconds (split equally between fade-out and fade-in). Default: 0.5 */
    duration?: number;
    /** Color to fade through. Default: black */
    color?: Color4;
    /** Easing function for the fade. Default: SineInOut */
    easing?: EasingFunction;
    /** Called when the transition completes */
    onComplete?: () => void;
}

/**
 * Options for a slide transition
 */
export interface ISlideTransitionOptions {
    /** The scene to transition from */
    from: Scene2D;
    /** The scene to transition to */
    to: Scene2D;
    /** Total transition duration in seconds. Default: 0.5 */
    duration?: number;
    /** Direction the old scene slides toward. Default: "left" */
    direction?: "left" | "right" | "up" | "down";
    /** Easing function for the slide. Default: CubicInOut */
    easing?: EasingFunction;
    /** Called when the transition completes */
    onComplete?: () => void;
}

type TransitionPhase = "out" | "in" | "done";

/**
 * Manages animated transitions between two Scene2D instances.
 *
 * Supports **fade** (fade to color then reveal new scene) and **slide**
 * (old scene slides out while new scene slides in).
 *
 * @example
 * ```typescript
 * const transition = SceneTransition2D.fade({
 *     from: currentScene,
 *     to: newScene,
 *     duration: 0.8,
 *     color: new Color4(0, 0, 0, 1),
 * });
 *
 * // Replace your render loop during transition:
 * engine.runRenderLoop(() => {
 *     if (transition.isActive) {
 *         transition.update(engine.getDeltaTime() / 1000);
 *         transition.render();
 *     } else {
 *         activeScene.render();
 *     }
 * });
 * ```
 */
export class SceneTransition2D {
    private _fromScene: Scene2D;
    private _toScene: Scene2D;
    private _phase: TransitionPhase;
    private _phaseDuration: number;
    private _elapsed: number = 0;
    private _easing: EasingFunction;
    private _onComplete: (() => void) | null;

    // Fade-specific
    private _overlay: Sprite2D | null = null;
    private _fadeColor: Color4 = new Color4(0, 0, 0, 1);

    // Slide-specific
    private _slideDirection: Vector2 = Vector2.Zero();
    private _fromCameraOriginalPos: Vector2 = Vector2.Zero();
    private _toCameraOriginalPos: Vector2 = Vector2.Zero();

    private _type: "fade" | "slide";

    private constructor(type: "fade" | "slide", from: Scene2D, to: Scene2D, duration: number, easing: EasingFunction, onComplete?: () => void) {
        this._type = type;
        this._fromScene = from;
        this._toScene = to;
        this._phaseDuration = duration / 2;
        this._easing = easing;
        this._onComplete = onComplete ?? null;
        this._phase = "out";
    }

    // -----------------------------------------------------------------------
    // Static factories
    // -----------------------------------------------------------------------

    /**
     * Creates a fade transition: the old scene fades to a solid color, then the
     * new scene fades in from that color.
     */
    public static fade(options: IFadeTransitionOptions): SceneTransition2D {
        const duration = options.duration ?? 0.5;
        const easing = options.easing ?? Easing.SineInOut;
        const color = options.color ?? new Color4(0, 0, 0, 1);

        const t = new SceneTransition2D("fade", options.from, options.to, duration, easing, options.onComplete);
        t._fadeColor = color;
        t._setupFadeOverlay(options.from);
        return t;
    }

    /**
     * Creates a slide transition: the old scene slides out in one direction
     * while the new scene slides in from the opposite side.
     */
    public static slide(options: ISlideTransitionOptions): SceneTransition2D {
        const duration = options.duration ?? 0.5;
        const easing = options.easing ?? Easing.CubicInOut;
        const dir = options.direction ?? "left";

        const t = new SceneTransition2D("slide", options.from, options.to, duration, easing, options.onComplete);

        // Full duration for slide (not split into two phases)
        t._phaseDuration = duration;

        // Compute slide direction in world units (viewport size)
        const engine = options.from.engine;
        const vpW = engine.getRenderWidth();
        const vpH = engine.getRenderHeight();

        // Direction the "from" scene moves toward
        switch (dir) {
            case "left":
                t._slideDirection = new Vector2(-vpW, 0);
                break;
            case "right":
                t._slideDirection = new Vector2(vpW, 0);
                break;
            case "up":
                t._slideDirection = new Vector2(0, -vpH);
                break;
            case "down":
                t._slideDirection = new Vector2(0, vpH);
                break;
        }

        // Save original camera positions
        if (options.from.camera) {
            t._fromCameraOriginalPos = options.from.camera.position.clone();
        }
        if (options.to.camera) {
            t._toCameraOriginalPos = options.to.camera.position.clone();
            // Start "to" scene off-screen (opposite direction)
            options.to.camera.position.x = t._toCameraOriginalPos.x - t._slideDirection.x;
            options.to.camera.position.y = t._toCameraOriginalPos.y - t._slideDirection.y;
        }

        return t;
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Whether the transition is still running.
     */
    public get isActive(): boolean {
        return this._phase !== "done";
    }

    /**
     * Whether the transition has completed.
     */
    public get isDone(): boolean {
        return this._phase === "done";
    }

    /**
     * The scene currently being rendered.
     */
    public get activeScene(): Scene2D {
        if (this._type === "slide") {
            return this._toScene; // Both render during slide
        }
        return this._phase === "out" ? this._fromScene : this._toScene;
    }

    /**
     * Advances the transition by deltaTime seconds.
     * @param deltaTime - Time elapsed since last frame in seconds
     */
    public update(deltaTime: number): void {
        if (this._phase === "done") {
            return;
        }

        this._elapsed += deltaTime;
        const t = Math.min(1, this._elapsed / this._phaseDuration);
        const easedT = this._easing(t);

        if (this._type === "fade") {
            this._updateFade(t, easedT);
        } else {
            this._updateSlide(t, easedT);
        }
    }

    /**
     * Renders the current frame of the transition.
     * Call this instead of scene.render() while the transition is active.
     */
    public render(): void {
        if (this._type === "fade") {
            if (this._phase === "out") {
                this._fromScene.render();
            } else if (this._phase === "in") {
                this._toScene.render();
            }
        } else {
            // Slide: render both scenes in a single frame.
            // "from" renders first (with clear), "to" renders on top (no clear).
            const engine = this._fromScene.engine;
            engine.beginFrame();
            this._fromScene.renderContent(true);
            this._toScene.renderContent(false);
            engine.endFrame();
        }
    }

    // -----------------------------------------------------------------------
    // Fade internals
    // -----------------------------------------------------------------------

    private _setupFadeOverlay(scene: Scene2D): void {
        this._overlay = new Sprite2D("__transition_overlay__");
        this._overlay.tint = new Color4(this._fadeColor.r, this._fadeColor.g, this._fadeColor.b, 0);
        this._overlay.sortingLayer = 0x7FFFFFFF; // Render on top of everything
        this._overlay.width = 99999;
        this._overlay.height = 99999;
        scene.addNode(this._overlay);
    }

    private _updateFade(t: number, easedT: number): void {
        if (!this._overlay) {
            return;
        }

        if (this._phase === "out") {
            // Fade overlay in (0 → 1)
            this._overlay.tint.a = easedT;
            this._positionOverlay(this._fromScene);

            if (t >= 1) {
                // Switch to "in" phase
                this._fromScene.removeNode(this._overlay);
                this._overlay.tint.a = 1;
                this._toScene.addNode(this._overlay);
                this._phase = "in";
                this._elapsed = 0;
            }
        } else if (this._phase === "in") {
            // Fade overlay out (1 → 0)
            this._overlay.tint.a = 1 - easedT;
            this._positionOverlay(this._toScene);

            if (t >= 1) {
                this._toScene.removeNode(this._overlay);
                this._overlay = null;
                this._phase = "done";
                this._onComplete?.();
            }
        }
    }

    private _positionOverlay(scene: Scene2D): void {
        if (!this._overlay) {
            return;
        }
        if (scene.camera) {
            this._overlay.position.x = scene.camera.position.x;
            this._overlay.position.y = scene.camera.position.y;
        } else {
            // No camera: position at viewport center
            const engine = scene.engine;
            this._overlay.position.x = engine.getRenderWidth() / 2;
            this._overlay.position.y = engine.getRenderHeight() / 2;
        }
    }

    // -----------------------------------------------------------------------
    // Slide internals
    // -----------------------------------------------------------------------

    private _updateSlide(t: number, easedT: number): void {
        if (this._phase === "out") {
            // Move "from" camera toward slide direction
            if (this._fromScene.camera) {
                this._fromScene.camera.position.x = this._fromCameraOriginalPos.x + this._slideDirection.x * easedT;
                this._fromScene.camera.position.y = this._fromCameraOriginalPos.y + this._slideDirection.y * easedT;
            }

            // Move "to" camera from off-screen toward original position
            if (this._toScene.camera) {
                this._toScene.camera.position.x = this._toCameraOriginalPos.x - this._slideDirection.x * (1 - easedT);
                this._toScene.camera.position.y = this._toCameraOriginalPos.y - this._slideDirection.y * (1 - easedT);
            }

            if (t >= 1) {
                // Restore cameras to exact final positions
                if (this._fromScene.camera) {
                    this._fromScene.camera.position.x = this._fromCameraOriginalPos.x + this._slideDirection.x;
                    this._fromScene.camera.position.y = this._fromCameraOriginalPos.y + this._slideDirection.y;
                }
                if (this._toScene.camera) {
                    this._toScene.camera.position.copyFrom(this._toCameraOriginalPos);
                }
                this._phase = "done";
                this._onComplete?.();
            }
        }
    }
}
