/**
 * Evaluate a 1D cubic bezier at parameter u.
 * Control points are implicitly 0, p1, p2, 1.
 * B(u) = 3(1-u)²·u·p1 + 3(1-u)·u²·p2 + u³
 * @internal
 */
function _sampleBezier(p1: number, p2: number, u: number): number {
    const u1 = 1 - u;
    return 3 * u1 * u1 * u * p1 + 3 * u1 * u * u * p2 + u * u * u;
}

/**
 * Derivative of a 1D cubic bezier at parameter u.
 * B'(u) = 3(1-u)²·p1 + 6(1-u)·u·(p2-p1) + 3u²·(1-p2)
 * @internal
 */
function _sampleBezierDerivative(p1: number, p2: number, u: number): number {
    const u1 = 1 - u;
    return 3 * u1 * u1 * p1 + 6 * u1 * u * (p2 - p1) + 3 * u * u * (1 - p2);
}

/**
 * Standard easing functions for tweening.
 * Each function takes a normalized time value t (0–1) and returns the eased value (0–1).
 *
 * @see https://easings.net for visual reference
 */
export class Easing {
    /** No easing — constant speed */
    public static Linear(t: number): number {
        return t;
    }

    // ─── Quadratic ───────────────────────────────────────────────────

    /** Accelerating from zero velocity */
    public static QuadIn(t: number): number {
        return t * t;
    }

    /** Decelerating to zero velocity */
    public static QuadOut(t: number): number {
        return t * (2 - t);
    }

    /** Accelerate then decelerate */
    public static QuadInOut(t: number): number {
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }

    // ─── Cubic ───────────────────────────────────────────────────────

    /** Accelerating from zero velocity (steeper than Quad) */
    public static CubicIn(t: number): number {
        return t * t * t;
    }

    /** Decelerating to zero velocity */
    public static CubicOut(t: number): number {
        const t1 = t - 1;
        return t1 * t1 * t1 + 1;
    }

    /** Accelerate then decelerate */
    public static CubicInOut(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    // ─── Sine ────────────────────────────────────────────────────────

    /** Gentle acceleration using sine wave */
    public static SineIn(t: number): number {
        return 1 - Math.cos((t * Math.PI) / 2);
    }

    /** Gentle deceleration using sine wave */
    public static SineOut(t: number): number {
        return Math.sin((t * Math.PI) / 2);
    }

    /** Smooth sine acceleration/deceleration */
    public static SineInOut(t: number): number {
        return -(Math.cos(Math.PI * t) - 1) / 2;
    }

    // ─── Exponential ─────────────────────────────────────────────────

    /** Exponential acceleration */
    public static ExpoIn(t: number): number {
        return t === 0 ? 0 : Math.pow(2, 10 * (t - 1));
    }

    /** Exponential deceleration */
    public static ExpoOut(t: number): number {
        return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    }

    // ─── Back ────────────────────────────────────────────────────────

    /** Overshoots then returns — slight pullback at start */
    public static BackIn(t: number): number {
        const s = 1.70158;
        return t * t * ((s + 1) * t - s);
    }

    /** Overshoots target then settles */
    public static BackOut(t: number): number {
        const s = 1.70158;
        const t1 = t - 1;
        return t1 * t1 * ((s + 1) * t1 + s) + 1;
    }

    // ─── Elastic ─────────────────────────────────────────────────────

    /** Spring-like overshoot at the end */
    public static ElasticOut(t: number): number {
        if (t === 0 || t === 1) {
            return t;
        }
        return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
    }

    // ─── Bounce ──────────────────────────────────────────────────────

    /** Bouncing deceleration at the end */
    public static BounceOut(t: number): number {
        const n1 = 7.5625;
        const d1 = 2.75;
        if (t < 1 / d1) {
            return n1 * t * t;
        } else if (t < 2 / d1) {
            const t1 = t - 1.5 / d1;
            return n1 * t1 * t1 + 0.75;
        } else if (t < 2.5 / d1) {
            const t1 = t - 2.25 / d1;
            return n1 * t1 * t1 + 0.9375;
        } else {
            const t1 = t - 2.625 / d1;
            return n1 * t1 * t1 + 0.984375;
        }
    }

    // ─── Custom Curves ────────────────────────────────────────────────

    /**
     * Creates a cubic bezier easing function, matching the CSS `cubic-bezier()` spec.
     * The curve is defined by two control points (x1, y1) and (x2, y2).
     * The start point is implicitly (0, 0) and the end point is (1, 1).
     *
     * Uses Newton-Raphson iteration to solve for the bezier parameter given x,
     * with a binary-search fallback for robustness.
     *
     * @param x1 - X of first control point (0–1)
     * @param y1 - Y of first control point (unrestricted; values outside 0–1 create overshoot)
     * @param x2 - X of second control point (0–1)
     * @param y2 - Y of second control point (unrestricted; values outside 0–1 create overshoot)
     * @returns An easing function that maps t (0–1) to the eased value
     *
     * @example
     * ```typescript
     * // CSS "ease" equivalent
     * const ease = Easing.CubicBezier(0.25, 0.1, 0.25, 1.0);
     * const tween = new Tween({ from: 0, to: 100 }, 1.0, ease);
     *
     * // Overshoot curve (y values outside 0–1)
     * const overshoot = Easing.CubicBezier(0.68, -0.55, 0.27, 1.55);
     * ```
     */
    public static CubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFunction {
        // Fast paths for linear curves
        if (x1 === y1 && x2 === y2) {
            return Easing.Linear;
        }

        return (t: number): number => {
            if (t <= 0) {
                return 0;
            }
            if (t >= 1) {
                return 1;
            }

            // Newton-Raphson iteration to find parameter u where bezierX(u) = t
            let u = t; // Initial guess
            for (let i = 0; i < 8; i++) {
                const xu = _sampleBezier(x1, x2, u) - t;
                if (Math.abs(xu) < 1e-6) {
                    break;
                }
                const dxu = _sampleBezierDerivative(x1, x2, u);
                if (Math.abs(dxu) < 1e-6) {
                    break;
                }
                u -= xu / dxu;
            }

            // Binary search fallback if Newton's method diverged
            if (u < 0 || u > 1) {
                let lo = 0;
                let hi = 1;
                u = t;
                for (let i = 0; i < 20; i++) {
                    const xu = _sampleBezier(x1, x2, u);
                    if (Math.abs(xu - t) < 1e-6) {
                        break;
                    }
                    if (xu < t) {
                        lo = u;
                    } else {
                        hi = u;
                    }
                    u = (lo + hi) * 0.5;
                }
            }

            // Clamp u to [0, 1]
            u = Math.max(0, Math.min(1, u));

            return _sampleBezier(y1, y2, u);
        };
    }
}

/** Type alias for an easing function */
export type EasingFunction = (t: number) => number;
