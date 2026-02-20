import { Vector2 } from "core/Maths/math.vector";

import type { Node2D } from "../Node2D/node2D";
import { Matrix2D } from "../Math/matrix2D";
import { Rectangle2D } from "../Math/rectangle2D";

/**
 * Scale mode for fitting a design resolution into the actual viewport
 */
export enum ScaleMode {
    /**
     * Scale uniformly to fit entirely within the viewport (may letterbox)
     */
    FIT = 0,

    /**
     * Scale uniformly to fill the viewport (may crop edges)
     */
    FILL = 1,

    /**
     * Stretch non-uniformly to exactly match the viewport (may distort)
     */
    STRETCH = 2,
}

/**
 * A 2D camera that controls the visible portion of a Scene2D.
 * Provides follow behavior, bounds clamping, zoom, screen shake,
 * and design resolution scaling for pixel-art and resolution-independent games.
 * Uses Y-down, top-left origin coordinates.
 */
export class Camera2D {
    /**
     * World position of the camera center
     */
    public position: Vector2 = Vector2.Zero();

    /**
     * Camera zoom level. 1 = 100%, 2 = 200% (closer), 0.5 = 50% (farther).
     * When a design resolution is set, this acts as an additional multiplier
     * on top of the auto-computed scale.
     */
    public zoom: number = 1;

    /**
     * Camera rotation in radians
     */
    public rotation: number = 0;

    /**
     * Target node for the camera to follow. Set to null to disable following.
     */
    public lockedTarget: Node2D | null = null;

    /**
     * Offset from the locked target's position
     */
    public followOffset: Vector2 = Vector2.Zero();

    /**
     * Interpolation speed for following. 0 = instant, higher = smoother/slower.
     * Represents the time constant in seconds.
     */
    public lerpSpeed: number = 0;

    /**
     * World-space bounds that constrain the camera position.
     * If set, the camera will not show areas outside these bounds.
     */
    public bounds: Rectangle2D | null = null;

    private _viewportWidth: number = 0;
    private _viewportHeight: number = 0;
    private _designWidth: number = 0;
    private _designHeight: number = 0;
    private _scaleMode: ScaleMode = ScaleMode.FIT;
    private _shakeIntensity: number = 0;
    private _shakeDuration: number = 0;
    private _shakeElapsed: number = 0;
    private _shakeOffset: Vector2 = Vector2.Zero();

    /**
     * The viewport width in pixels (set by Scene2D from engine)
     */
    public get viewportWidth(): number {
        return this._viewportWidth;
    }

    /**
     * The viewport height in pixels (set by Scene2D from engine)
     */
    public get viewportHeight(): number {
        return this._viewportHeight;
    }

    /**
     * Updates viewport dimensions. Called by Scene2D or manually.
     * @param width - Viewport width in pixels
     * @param height - Viewport height in pixels
     */
    public setViewport(width: number, height: number): void {
        this._viewportWidth = width;
        this._viewportHeight = height;
    }

    /**
     * Sets a design (virtual) resolution. The camera will automatically scale
     * the scene so that the design resolution fills the actual viewport according
     * to the chosen scale mode. This is essential for pixel-art games and
     * resolution-independent rendering.
     *
     * @example
     * ```typescript
     * // Pixel-art game designed at 480×270
     * camera.setDesignResolution(480, 270, ScaleMode.FIT);
     * // On a 1920×1080 screen this gives 4× zoom with letterboxing if needed
     * ```
     *
     * @param width - Design width in world units / pixels
     * @param height - Design height in world units / pixels
     * @param scaleMode - How to fit the design into the viewport (default: FIT)
     */
    public setDesignResolution(width: number, height: number, scaleMode: ScaleMode = ScaleMode.FIT): void {
        this._designWidth = width;
        this._designHeight = height;
        this._scaleMode = scaleMode;
    }

    /**
     * Gets the effective scale combining design-resolution auto-scale with the
     * user's `zoom` property. Returns separate X and Y factors (equal unless STRETCH mode).
     */
    public get effectiveScale(): { scaleX: number; scaleY: number } {
        return this._getEffectiveScale();
    }

    /**
     * Computes the effective zoom, combining design-resolution auto-scale with the
     * user's `zoom` property. Returns separate X and Y scale factors (equal unless STRETCH mode).
     */
    private _getEffectiveScale(): { scaleX: number; scaleY: number } {
        if (this._designWidth <= 0 || this._designHeight <= 0 || this._viewportWidth <= 0 || this._viewportHeight <= 0) {
            return { scaleX: this.zoom, scaleY: this.zoom };
        }

        const ratioX = this._viewportWidth / this._designWidth;
        const ratioY = this._viewportHeight / this._designHeight;

        let sx: number;
        let sy: number;

        switch (this._scaleMode) {
            case ScaleMode.FIT: {
                const uniform = Math.min(ratioX, ratioY);
                sx = uniform;
                sy = uniform;
                break;
            }
            case ScaleMode.FILL: {
                const uniform = Math.max(ratioX, ratioY);
                sx = uniform;
                sy = uniform;
                break;
            }
            case ScaleMode.STRETCH:
                sx = ratioX;
                sy = ratioY;
                break;
            default:
                sx = 1;
                sy = 1;
        }

        return { scaleX: sx * this.zoom, scaleY: sy * this.zoom };
    }

    /**
     * Updates the camera state (follow target, shake, bounds clamping).
     * Should be called once per frame before rendering.
     * @param deltaTime - Time elapsed since last frame in seconds
     */
    public update(deltaTime: number): void {
        // Follow target
        if (this.lockedTarget) {
            const targetPos = this.lockedTarget.worldPosition;
            const desiredX = targetPos.x + this.followOffset.x;
            const desiredY = targetPos.y + this.followOffset.y;

            if (this.lerpSpeed <= 0) {
                this.position.x = desiredX;
                this.position.y = desiredY;
            } else {
                const t = 1 - Math.exp(-deltaTime / this.lerpSpeed);
                this.position.x += (desiredX - this.position.x) * t;
                this.position.y += (desiredY - this.position.y) * t;
            }
        }

        // Clamp to bounds
        if (this.bounds && this._viewportWidth > 0 && this._viewportHeight > 0) {
            const { scaleX, scaleY } = this._getEffectiveScale();
            const halfW = this._viewportWidth / (2 * scaleX);
            const halfH = this._viewportHeight / (2 * scaleY);

            const boundsW = this.bounds.right - this.bounds.x;
            const boundsH = this.bounds.bottom - this.bounds.y;

            // If viewport is larger than bounds, center on the bounds
            if (halfW * 2 >= boundsW) {
                this.position.x = this.bounds.x + boundsW / 2;
            } else {
                this.position.x = Math.max(this.bounds.x + halfW, Math.min(this.bounds.right - halfW, this.position.x));
            }

            if (halfH * 2 >= boundsH) {
                this.position.y = this.bounds.y + boundsH / 2;
            } else {
                this.position.y = Math.max(this.bounds.y + halfH, Math.min(this.bounds.bottom - halfH, this.position.y));
            }
        }

        // Screen shake
        if (this._shakeDuration > 0) {
            this._shakeElapsed += deltaTime;
            if (this._shakeElapsed >= this._shakeDuration) {
                this._shakeDuration = 0;
                this._shakeElapsed = 0;
                this._shakeOffset.x = 0;
                this._shakeOffset.y = 0;
            } else {
                const progress = this._shakeElapsed / this._shakeDuration;
                const decay = 1 - progress;
                this._shakeOffset.x = (Math.random() * 2 - 1) * this._shakeIntensity * decay;
                this._shakeOffset.y = (Math.random() * 2 - 1) * this._shakeIntensity * decay;
            }
        }
    }

    /**
     * Triggers a screen shake effect
     * @param intensity - Maximum pixel offset
     * @param duration - Duration in seconds
     */
    public shake(intensity: number, duration: number): void {
        this._shakeIntensity = intensity;
        this._shakeDuration = duration;
        this._shakeElapsed = 0;
    }

    /**
     * Gets the camera's view transform matrix (world → view space).
     * This is the inverse of the camera's world position/rotation/zoom, used by the renderer.
     * @returns The view Matrix2D
     */
    public getViewTransform(): Matrix2D {
        const cx = this.position.x + this._shakeOffset.x;
        const cy = this.position.y + this._shakeOffset.y;

        const { scaleX, scaleY } = this._getEffectiveScale();

        // View transform: translate to center viewport, then apply zoom and rotation
        const cosR = Math.cos(-this.rotation);
        const sinR = Math.sin(-this.rotation);

        const a = cosR * scaleX;
        const b = sinR * scaleX;
        const c = -sinR * scaleY;
        const d = cosR * scaleY;

        const offsetX = this._viewportWidth / 2;
        const offsetY = this._viewportHeight / 2;

        return new Matrix2D(a, b, c, d, -cx * a + cy * -c + offsetX, -cx * b + cy * -d + offsetY);
    }

    /**
     * Converts a screen-space position to world-space
     * @param screenPos - Position in screen pixels
     * @returns The corresponding world position
     */
    public screenToWorld(screenPos: Vector2): Vector2 {
        const inv = this.getViewTransform().invert();
        return inv.transformPoint(screenPos);
    }

    /**
     * Converts a world-space position to screen-space
     * @param worldPos - Position in world coordinates
     * @returns The corresponding screen position in pixels
     */
    public worldToScreen(worldPos: Vector2): Vector2 {
        return this.getViewTransform().transformPoint(worldPos);
    }
}
