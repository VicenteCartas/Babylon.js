import { Color4 } from "core/Maths/math.color";
import { Vector2 } from "core/Maths/math.vector";

import type { Node2D } from "../Node2D/node2D";
import { Matrix2D } from "../Math/matrix2D";
import { Rectangle2D } from "../Math/rectangle2D";
import { Sprite2D } from "../Sprite2D/sprite2D";
import type { Scene2D } from "../Scene2D/scene2D";

/**
 * Scale mode for fitting a design resolution into the actual viewport.
 */
export enum ScaleMode {
    /**
     * Scale uniformly to fit entirely within the viewport (may letterbox).
     */
    FIT = 0,

    /**
     * Scale uniformly to fill the viewport (may crop edges).
     */
    FILL = 1,

    /**
     * Stretch non-uniformly to exactly match the viewport (may distort).
     */
    STRETCH = 2,

    /**
     * Scale using integer multiples of the design resolution (pixel-art friendly).
     */
    INTEGER_SCALE = 3,
}

/**
 * A 2D camera that controls the visible portion of a Scene2D.
 * Provides follow behavior, dead zone and look-ahead bias, bounds clamping,
 * design resolution scaling, screen shake, screen-space effects, and
 * world/screen coordinate conversion.
 */
export class Camera2D {
    private static readonly _overlayExtent: number = 999999;

    /**
     * World position of the camera center.
     */
    public position: Vector2 = Vector2.Zero();

    /**
     * Camera zoom level. 1 = 100%, 2 = 200% (closer), 0.5 = 50% (farther).
     * When a design resolution is set, this acts as an additional multiplier
     * on top of the auto-computed scale.
     */
    public zoom: number = 1;

    /**
     * Camera rotation in radians.
     */
    public rotation: number = 0;

    /**
     * Target node for the camera to follow. Set to null to disable following.
     */
    public lockedTarget: Node2D | null = null;

    /**
     * Offset from the locked target's position.
     */
    public followOffset: Vector2 = Vector2.Zero();

    /**
     * Exponential follow smoothing speed in inverse-seconds.
     * 0 snaps instantly to the target.
     */
    public lerpSpeed: number = 0;

    /**
     * World-space dead zone relative to the camera center.
     * Set to null to disable dead-zone follow.
     */
    public deadZone: Rectangle2D | null = null;

    /**
     * Maximum look-ahead distance in world pixels.
     */
    public lookAheadDistance: number = 0;

    /**
     * Exponential smoothing speed for look-ahead in inverse-seconds.
     */
    public lookAheadLerpSpeed: number = 6.666666666666667;

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
    private _shakeRng: (() => number) | null = null;
    private _viewTransform: Matrix2D = Matrix2D.Identity();
    private _invertedViewTransform: Matrix2D = Matrix2D.Identity();
    private _visibleWorldRect: Rectangle2D = new Rectangle2D();
    private _lookAheadOffset: Vector2 = Vector2.Zero();
    private _followBasePosition: Vector2 = Vector2.Zero();
    private _previousTargetPosition: Vector2 = Vector2.Zero();
    private _lookAheadTarget: Node2D | null = null;
    private _scratchTargetPosition: Vector2 = Vector2.Zero();
    private _scratchDesiredLookAhead: Vector2 = Vector2.Zero();
    private _hasPreviousTargetPosition: boolean = false;
    private _scene: Scene2D | null = null;
    private _overlaySprite: Sprite2D | null = null;
    private _effectColor: Color4 = new Color4(0, 0, 0, 0);
    private _effectElapsed: number = 0;
    private _effectDuration: number = 0;
    private _effectStartAlpha: number = 0;
    private _effectEndAlpha: number = 0;
    private _effectOnComplete: (() => void) | null = null;
    private _effectActive: boolean = false;

    /**
     * The viewport width in pixels.
     * @returns The cached viewport width.
     */
    public get viewportWidth(): number {
        return this._viewportWidth;
    }

    /**
     * The viewport height in pixels.
     * @returns The cached viewport height.
     */
    public get viewportHeight(): number {
        return this._viewportHeight;
    }

    /**
     * Whether a design resolution is currently active.
     * @returns True when a design resolution has been configured.
     */
    public get hasDesignResolution(): boolean {
        return this._designWidth > 0 && this._designHeight > 0;
    }

    /**
     * Whether a screen shake is currently active.
     * @returns True when shake is active.
     */
    public get isShaking(): boolean {
        return this._shakeDuration > 0;
    }

    /**
     * Gets the effective scale combining design-resolution auto-scale with the
     * user's zoom property.
     * @returns Separate X and Y scale factors.
     */
    public get effectiveScale(): { scaleX: number; scaleY: number } {
        return this._getEffectiveScale();
    }

    /**
     * Updates viewport dimensions. Called by Scene2D or manually.
     * @param width - Viewport width in pixels.
     * @param height - Viewport height in pixels.
     */
    public setViewport(width: number, height: number): void {
        this._viewportWidth = width;
        this._viewportHeight = height;
        this._updateOverlayPlacement();
    }

    /**
     * Sets a virtual design resolution.
     * @param width - Design width in pixels.
     * @param height - Design height in pixels.
     * @param scaleMode - How to fit the design into the viewport.
     */
    public setDesignResolution(width: number, height: number, scaleMode: ScaleMode = ScaleMode.FIT): void {
        this._designWidth = width;
        this._designHeight = height;
        this._scaleMode = scaleMode;
    }

    /**
     * Clears the current design resolution.
     */
    public clearDesignResolution(): void {
        this._designWidth = 0;
        this._designHeight = 0;
        this._scaleMode = ScaleMode.FIT;
    }

    /**
     * Advances the camera by deltaTime.
     * @param deltaTime - Time elapsed since last frame in seconds.
     * @param viewportWidth - Optional viewport width override in pixels.
     * @param viewportHeight - Optional viewport height override in pixels.
     */
    public update(deltaTime: number, viewportWidth?: number, viewportHeight?: number): void {
        if (viewportWidth !== undefined && viewportHeight !== undefined) {
            this.setViewport(viewportWidth, viewportHeight);
        }

        const lockedTarget = this.lockedTarget;
        if (lockedTarget) {
            this._followBasePosition.x = this.position.x - this._lookAheadOffset.x;
            this._followBasePosition.y = this.position.y - this._lookAheadOffset.y;
            this._updateFollow(deltaTime);
            this._updateLookAhead(deltaTime);
            this.position.x = this._followBasePosition.x + this._lookAheadOffset.x;
            this.position.y = this._followBasePosition.y + this._lookAheadOffset.y;
        } else {
            this._updateLookAhead(deltaTime);
        }

        this._clampToBounds();
        if (lockedTarget) {
            this._followBasePosition.x = this.position.x - this._lookAheadOffset.x;
            this._followBasePosition.y = this.position.y - this._lookAheadOffset.y;
        }
        this._updateShake(deltaTime);
        this._recomputeViewTransform();
        this._updateEffects(deltaTime);
    }

    /**
     * Starts a screen shake effect.
     * @param intensity - Maximum pixel offset per axis.
     * @param duration - Duration of the shake in seconds.
     * @param seed - Optional legacy numeric seed for deterministic shake.
     */
    public shake(intensity: number, duration: number, seed?: number): void;

    /**
     * Starts a screen shake effect.
     * @param intensity - Maximum pixel offset per axis.
     * @param duration - Duration of the shake in seconds.
     * @param rng - Optional random callback used for deterministic shake.
     */
    public shake(intensity: number, duration: number, rng?: () => number): void;

    /**
     * Starts a screen shake effect.
     * @param intensity - Maximum pixel offset per axis.
     * @param duration - Duration of the shake in seconds.
     * @param rngOrSeed - Optional random callback or legacy numeric seed.
     */
    public shake(intensity: number, duration: number, rngOrSeed?: number | (() => number)): void {
        this._shakeIntensity = intensity;
        this._shakeDuration = duration > 0 ? duration : 0;
        this._shakeElapsed = 0;
        this._shakeOffset.x = 0;
        this._shakeOffset.y = 0;

        if (typeof rngOrSeed === "function") {
            this._shakeRng = rngOrSeed;
        } else if (typeof rngOrSeed === "number") {
            this._shakeRng = Camera2D._createSeededRng(rngOrSeed);
        } else {
            this._shakeRng = null;
        }
    }

    /**
     * Stops any active screen shake.
     */
    public stopShake(): void {
        this._shakeIntensity = 0;
        this._shakeDuration = 0;
        this._shakeElapsed = 0;
        this._shakeOffset.x = 0;
        this._shakeOffset.y = 0;
        this._shakeRng = null;
        this._recomputeViewTransform();
        this._updateOverlayPlacement();
    }

    /**
     * Flashes the screen with a color that fades back to transparent.
     * @param color - Flash color.
     * @param duration - Fade duration in seconds.
     * @param onComplete - Callback fired when the flash finishes.
     */
    public flash(color: Color4 = new Color4(1, 1, 1, 1), duration: number = 0.3, onComplete?: () => void): void {
        this._startEffect(color, 1, 0, duration, onComplete);
    }

    /**
     * Fades the screen to a solid color.
     * @param color - Fade color.
     * @param duration - Fade duration in seconds.
     * @param onComplete - Callback fired when the fade finishes.
     */
    public fadeOut(color: Color4 = new Color4(0, 0, 0, 1), duration: number = 0.5, onComplete?: () => void): void {
        this._startEffect(color, 0, 1, duration, onComplete);
    }

    /**
     * Fades from a solid color to transparent.
     * @param color - Fade color.
     * @param duration - Fade duration in seconds.
     * @param onComplete - Callback fired when the fade finishes.
     */
    public fadeIn(color: Color4 = new Color4(0, 0, 0, 1), duration: number = 0.5, onComplete?: () => void): void {
        this._startEffect(color, 1, 0, duration, onComplete);
    }

    /**
     * Gets the camera's current world-to-screen transform matrix.
     * Returns a cached matrix reference that is updated in place.
     * @returns The cached transform matrix.
     */
    public getViewTransform(): Matrix2D {
        return this._recomputeViewTransform();
    }

    /**
     * Gets the current world-to-screen view-projection matrix.
     * @returns The cached transform matrix.
     */
    public getViewProjectionMatrix(): Readonly<Matrix2D> {
        return this._recomputeViewTransform();
    }

    /**
     * Gets the current inverse world-to-screen transform matrix.
     * @returns The cached inverse transform matrix.
     */
    public getInverseViewProjectionMatrix(): Readonly<Matrix2D> {
        this._recomputeViewTransform();
        return this._invertedViewTransform;
    }

    /**
     * Gets the visible world-space rectangle covered by the current viewport.
     * Returns a cached rectangle that is updated in place.
     * @returns The cached visible world rectangle.
     */
    public getVisibleWorldRect(): Readonly<Rectangle2D> {
        return this.getVisibleWorldRectToRef(this._visibleWorldRect);
    }

    /**
     * Writes the visible world-space rectangle covered by the current viewport into `out`.
     * @param out - Rectangle receiving the visible world-space bounds.
     * @returns The provided output rectangle.
     */
    public getVisibleWorldRectToRef(out: Rectangle2D): Rectangle2D {
        this._recomputeViewTransform();

        if (this._viewportWidth <= 0 || this._viewportHeight <= 0) {
            return out.set(this.position.x, this.position.y, 0, 0);
        }

        const m = this._invertedViewTransform.m;
        const x0 = m[4];
        const y0 = m[5];
        const x1 = m[0] * this._viewportWidth + m[4];
        const y1 = m[1] * this._viewportWidth + m[5];
        const x2 = m[0] * this._viewportWidth + m[2] * this._viewportHeight + m[4];
        const y2 = m[1] * this._viewportWidth + m[3] * this._viewportHeight + m[5];
        const x3 = m[2] * this._viewportHeight + m[4];
        const y3 = m[3] * this._viewportHeight + m[5];

        const minX = Math.min(x0, x1, x2, x3);
        const minY = Math.min(y0, y1, y2, y3);
        const maxX = Math.max(x0, x1, x2, x3);
        const maxY = Math.max(y0, y1, y2, y3);
        return out.set(minX, minY, maxX - minX, maxY - minY);
    }

    /**
     * Converts a screen-space position to world-space.
     * @param screenPos - Position in screen pixels.
     * @returns The corresponding world position.
     */
    public screenToWorld(screenPos: Vector2): Vector2;

    /**
     * Converts a screen-space position to world-space without allocating.
     * @param screenPos - Position in screen pixels.
     * @param out - Output world position.
     * @returns The provided output vector.
     */
    public screenToWorld(screenPos: Vector2, out: Vector2): Vector2;

    /**
     * Converts a screen-space position to world-space.
     * @param screenPos - Position in screen pixels.
     * @param out - Optional output world position.
     * @returns The world-space position.
     */
    public screenToWorld(screenPos: Vector2, out?: Vector2): Vector2 {
        this._recomputeViewTransform();
        const target = out ?? Vector2.Zero();
        const m = this._invertedViewTransform.m;
        target.x = m[0] * screenPos.x + m[2] * screenPos.y + m[4];
        target.y = m[1] * screenPos.x + m[3] * screenPos.y + m[5];
        return target;
    }

    /**
     * Converts a world-space position to screen-space.
     * @param worldPos - Position in world coordinates.
     * @returns The corresponding screen position in pixels.
     */
    public worldToScreen(worldPos: Vector2): Vector2;

    /**
     * Converts a world-space position to screen-space without allocating.
     * @param worldPos - Position in world coordinates.
     * @param out - Output screen position.
     * @returns The provided output vector.
     */
    public worldToScreen(worldPos: Vector2, out: Vector2): Vector2;

    /**
     * Converts a world-space position to screen-space.
     * @param worldPos - Position in world coordinates.
     * @param out - Optional output screen position.
     * @returns The screen-space position.
     */
    public worldToScreen(worldPos: Vector2, out?: Vector2): Vector2 {
        this._recomputeViewTransform();
        const target = out ?? Vector2.Zero();
        const m = this._viewTransform.m;
        target.x = m[0] * worldPos.x + m[2] * worldPos.y + m[4];
        target.y = m[1] * worldPos.x + m[3] * worldPos.y + m[5];
        return target;
    }

    /**
     * Disposes of internal effect resources.
     */
    public dispose(): void {
        this.stopShake();
        this._effectActive = false;
        this._effectDuration = 0;
        this._effectElapsed = 0;
        this._effectOnComplete = null;

        if (this._overlaySprite) {
            if (this._scene) {
                this._scene._removeOverlay(this._overlaySprite);
            }
            this._overlaySprite.dispose();
            this._overlaySprite = null;
        }

        this._scene = null;
    }

    /**
     * @internal
     * Associates this camera with a Scene2D so internal overlay effects can be managed.
     * @param scene - The owning scene, or null to detach.
     */
    public _setScene(scene: Scene2D | null): void {
        if (this._scene === scene) {
            return;
        }

        if (this._overlaySprite && this._scene) {
            this._scene._removeOverlay(this._overlaySprite);
        }

        this._scene = scene;

        if (this._overlaySprite && this._scene && this._effectActive) {
            this._scene._addOverlay(this._overlaySprite);
            this._updateOverlayPlacement();
        }
    }

    private _getEffectiveScale(): { scaleX: number; scaleY: number } {
        if (!this.hasDesignResolution || this._viewportWidth <= 0 || this._viewportHeight <= 0) {
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
            case ScaleMode.INTEGER_SCALE: {
                const uniform = Math.max(1, Math.floor(Math.min(ratioX, ratioY)));
                sx = uniform;
                sy = uniform;
                break;
            }
            default:
                sx = 1;
                sy = 1;
                break;
        }

        return { scaleX: sx * this.zoom, scaleY: sy * this.zoom };
    }

    private _updateFollow(deltaTime: number): void {
        if (!this.lockedTarget) {
            return;
        }

        const targetPos = this.lockedTarget.worldPositionToRef(this._scratchTargetPosition);
        const targetX = targetPos.x + this.followOffset.x;
        const targetY = targetPos.y + this.followOffset.y;

        let desiredX = targetX;
        let desiredY = targetY;

        if (this.deadZone) {
            const currentX = this._followBasePosition.x;
            const currentY = this._followBasePosition.y;
            const clampedX = Camera2D._clamp(targetX - currentX, this.deadZone.x, this.deadZone.x + this.deadZone.width);
            const clampedY = Camera2D._clamp(targetY - currentY, this.deadZone.y, this.deadZone.y + this.deadZone.height);
            desiredX = targetX - clampedX;
            desiredY = targetY - clampedY;
        }

        if (this.lerpSpeed <= 0 || deltaTime <= 0) {
            this._followBasePosition.x = desiredX;
            this._followBasePosition.y = desiredY;
            return;
        }

        const t = 1 - Math.exp(-this.lerpSpeed * deltaTime);
        this._followBasePosition.x += (desiredX - this._followBasePosition.x) * t;
        this._followBasePosition.y += (desiredY - this._followBasePosition.y) * t;
    }

    private _updateLookAhead(deltaTime: number): void {
        if (!this.lockedTarget) {
            this._lookAheadTarget = null;
            this._hasPreviousTargetPosition = false;
            this._lookAheadOffset.x = 0;
            this._lookAheadOffset.y = 0;
            return;
        }

        const target = this.lockedTarget;
        const targetPos = target.worldPositionToRef(this._scratchTargetPosition);
        if (this._lookAheadTarget !== target) {
            this._lookAheadTarget = target;
            this._previousTargetPosition.x = targetPos.x;
            this._previousTargetPosition.y = targetPos.y;
            this._hasPreviousTargetPosition = true;
            this._lookAheadOffset.x = 0;
            this._lookAheadOffset.y = 0;
            return;
        }

        if (!this._hasPreviousTargetPosition) {
            this._previousTargetPosition.x = targetPos.x;
            this._previousTargetPosition.y = targetPos.y;
            this._hasPreviousTargetPosition = true;
            this._updateLookAheadOffset(0, 0, deltaTime);
            return;
        }

        let desiredX = 0;
        let desiredY = 0;

        if (this.lookAheadDistance > 0 && deltaTime > 0) {
            const velocityX = (targetPos.x - this._previousTargetPosition.x) / deltaTime;
            const velocityY = (targetPos.y - this._previousTargetPosition.y) / deltaTime;
            const velocityLength = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
            if (velocityLength > 1e-6) {
                const invLength = this.lookAheadDistance / velocityLength;
                desiredX = velocityX * invLength;
                desiredY = velocityY * invLength;
            }
        }

        this._previousTargetPosition.x = targetPos.x;
        this._previousTargetPosition.y = targetPos.y;
        this._updateLookAheadOffset(desiredX, desiredY, deltaTime);
    }

    private _updateLookAheadOffset(desiredX: number, desiredY: number, deltaTime: number): void {
        this._scratchDesiredLookAhead.x = desiredX;
        this._scratchDesiredLookAhead.y = desiredY;

        if (deltaTime <= 0 || this.lookAheadLerpSpeed <= 0) {
            this._lookAheadOffset.x = desiredX;
            this._lookAheadOffset.y = desiredY;
            return;
        }

        const t = 1 - Math.exp(-this.lookAheadLerpSpeed * deltaTime);
        this._lookAheadOffset.x += (desiredX - this._lookAheadOffset.x) * t;
        this._lookAheadOffset.y += (desiredY - this._lookAheadOffset.y) * t;
    }

    private _clampToBounds(): void {
        if (!this.bounds || this._viewportWidth <= 0 || this._viewportHeight <= 0) {
            return;
        }

        const { scaleX, scaleY } = this._getEffectiveScale();
        const safeScaleX = Math.max(Math.abs(scaleX), 1e-6);
        const safeScaleY = Math.max(Math.abs(scaleY), 1e-6);
        const halfW = this._viewportWidth / (2 * safeScaleX);
        const halfH = this._viewportHeight / (2 * safeScaleY);
        const boundsW = this.bounds.width;
        const boundsH = this.bounds.height;

        if (halfW * 2 >= boundsW) {
            this.position.x = this.bounds.x + boundsW / 2;
        } else {
            this.position.x = Camera2D._clamp(this.position.x, this.bounds.x + halfW, this.bounds.right - halfW);
        }

        if (halfH * 2 >= boundsH) {
            this.position.y = this.bounds.y + boundsH / 2;
        } else {
            this.position.y = Camera2D._clamp(this.position.y, this.bounds.y + halfH, this.bounds.bottom - halfH);
        }
    }

    private _updateShake(deltaTime: number): void {
        if (this._shakeDuration <= 0) {
            this._shakeOffset.x = 0;
            this._shakeOffset.y = 0;
            this._updateOverlayPlacement();
            return;
        }

        this._shakeElapsed += deltaTime;
        if (this._shakeElapsed >= this._shakeDuration) {
            this.stopShake();
            return;
        }

        const progress = this._shakeElapsed / this._shakeDuration;
        const magnitude = this._shakeIntensity * (1 - progress);
        const rng = this._shakeRng ?? Math.random;
        this._shakeOffset.x = (rng() * 2 - 1) * magnitude;
        this._shakeOffset.y = (rng() * 2 - 1) * magnitude;
        this._updateOverlayPlacement();
    }

    private _recomputeViewTransform(): Matrix2D {
        const cx = this.position.x + this._shakeOffset.x;
        const cy = this.position.y + this._shakeOffset.y;
        const { scaleX, scaleY } = this._getEffectiveScale();
        const cosR = Math.cos(-this.rotation);
        const sinR = Math.sin(-this.rotation);
        const offsetX = this._viewportWidth * 0.5;
        const offsetY = this._viewportHeight * 0.5;
        const m = this._viewTransform.m;

        m[0] = cosR * scaleX;
        m[1] = sinR * scaleX;
        m[2] = -sinR * scaleY;
        m[3] = cosR * scaleY;
        m[4] = offsetX - m[0] * cx - m[2] * cy;
        m[5] = offsetY - m[1] * cx - m[3] * cy;

        this._viewTransform.invertToRef(this._invertedViewTransform);
        this._updateOverlayPlacement();
        return this._viewTransform;
    }

    private _updateEffects(deltaTime: number): void {
        if (!this._effectActive || !this._overlaySprite) {
            return;
        }

        if (this._effectDuration <= 0) {
            this._overlaySprite.tint.a = this._effectEndAlpha * this._effectColor.a;
            this._finishEffectIfNeeded();
            return;
        }

        this._effectElapsed = Math.min(this._effectElapsed + deltaTime, this._effectDuration);
        const t = this._effectDuration > 0 ? this._effectElapsed / this._effectDuration : 1;
        this._overlaySprite.tint.a = (this._effectStartAlpha + (this._effectEndAlpha - this._effectStartAlpha) * t) * this._effectColor.a;

        if (t >= 1) {
            this._finishEffectIfNeeded();
        }
    }

    private _startEffect(color: Color4, startAlpha: number, endAlpha: number, duration: number, onComplete?: () => void): void {
        this._effectColor.r = color.r;
        this._effectColor.g = color.g;
        this._effectColor.b = color.b;
        this._effectColor.a = color.a;
        this._effectElapsed = 0;
        this._effectDuration = duration > 0 ? duration : 0;
        this._effectStartAlpha = startAlpha;
        this._effectEndAlpha = endAlpha;
        this._effectOnComplete = onComplete ?? null;
        this._effectActive = true;

        const overlay = this._ensureOverlaySprite();
        overlay.tint.r = color.r;
        overlay.tint.g = color.g;
        overlay.tint.b = color.b;
        overlay.tint.a = startAlpha * color.a;
        this._updateOverlayPlacement();

        if (this._effectDuration <= 0) {
            overlay.tint.a = endAlpha * color.a;
            this._finishEffectIfNeeded();
        }
    }

    private _finishEffectIfNeeded(): void {
        if (!this._overlaySprite) {
            return;
        }

        this._overlaySprite.tint.a = this._effectEndAlpha * this._effectColor.a;
        const onComplete = this._effectOnComplete;
        const shouldRemoveOverlay = this._overlaySprite.tint.a <= 0;

        this._effectActive = false;
        this._effectDuration = 0;
        this._effectElapsed = 0;
        this._effectOnComplete = null;

        if (shouldRemoveOverlay && this._scene) {
            this._scene._removeOverlay(this._overlaySprite);
        }

        if (onComplete) {
            onComplete();
        }
    }

    private _ensureOverlaySprite(): Sprite2D {
        if (!this._overlaySprite) {
            this._overlaySprite = new Sprite2D("__camera_overlay__", null);
            this._overlaySprite.sortingLayer = Number.MAX_SAFE_INTEGER;
            this._overlaySprite.width = Camera2D._overlayExtent;
            this._overlaySprite.height = Camera2D._overlayExtent;
        }

        if (this._scene) {
            this._scene._addOverlay(this._overlaySprite);
        }

        return this._overlaySprite;
    }

    private _updateOverlayPlacement(): void {
        if (!this._overlaySprite) {
            return;
        }

        this._overlaySprite.position.x = this.position.x + this._shakeOffset.x;
        this._overlaySprite.position.y = this.position.y + this._shakeOffset.y;
    }

    private static _clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }

    private static _createSeededRng(seed: number): () => number {
        let s = seed | 0;
        return () => {
            s = (s + 0x6d2b79f5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
}

