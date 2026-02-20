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
}

/** Type alias for an easing function */
export type EasingFunction = (t: number) => number;
