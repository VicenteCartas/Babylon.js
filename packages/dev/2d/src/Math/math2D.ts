/**
 * Collection of stateless math helpers for 2D games.
 */
export class Math2D {
    /**
     * Clamps a value to the inclusive [min, max] range.
     * @param value - Source value.
     * @param min - Minimum allowed value.
     * @param max - Maximum allowed value.
     * @returns The clamped value.
     */
    public static clamp(value: number, min: number, max: number): number {
        return Math.min(Math.max(value, min), max);
    }

    /**
     * Linearly interpolates between two values.
     * @param a - Start value.
     * @param b - End value.
     * @param t - Interpolation factor.
     * @returns The interpolated value.
     */
    public static lerp(a: number, b: number, t: number): number {
        return a + (b - a) * t;
    }

    /**
     * Computes the inverse lerp factor for a value between `a` and `b`.
     * @param a - Start value.
     * @param b - End value.
     * @param value - Value to map.
     * @returns The interpolation factor, or 0 when `a === b`.
     */
    public static inverseLerp(a: number, b: number, value: number): number {
        const delta = b - a;
        if (delta === 0) {
            return 0;
        }

        return (value - a) / delta;
    }

    /**
     * Performs smooth-step interpolation.
     * @param a - Start value.
     * @param b - End value.
     * @param t - Interpolation factor.
     * @returns The smoothly interpolated value.
     */
    public static smoothStep(a: number, b: number, t: number): number {
        const clampedT = Math2D.clamp(t, 0, 1);
        const smoothT = clampedT * clampedT * (3 - 2 * clampedT);
        return Math2D.lerp(a, b, smoothT);
    }

    /**
     * Wraps a value into the [0, range) interval.
     * @param value - Value to wrap.
     * @param range - Range size.
     * @returns The wrapped value.
     */
    public static wrap(value: number, range: number): number {
        if (range === 0) {
            return 0;
        }

        const wrapped = value % range;
        return wrapped < 0 ? wrapped + range : wrapped;
    }

    /**
     * Computes the signed shortest angular delta in radians.
     * @param from - Starting angle.
     * @param to - Target angle.
     * @returns A value in [-PI, PI].
     */
    public static angleDelta(from: number, to: number): number {
        const tau = Math.PI * 2;
        let delta = Math2D.wrap(to - from, tau);
        if (delta > Math.PI) {
            delta -= tau;
        }
        return delta;
    }

    /**
     * Linearly interpolates between angles along the shortest arc.
     * @param from - Starting angle.
     * @param to - Target angle.
     * @param t - Interpolation factor.
     * @returns The interpolated angle.
     */
    public static lerpAngle(from: number, to: number, t: number): number {
        return from + Math2D.angleDelta(from, to) * t;
    }

    /**
     * Converts degrees to radians.
     * @param degrees - Angle in degrees.
     * @returns The angle in radians.
     */
    public static toRadians(degrees: number): number {
        return (degrees * Math.PI) / 180;
    }

    /**
     * Converts radians to degrees.
     * @param radians - Angle in radians.
     * @returns The angle in degrees.
     */
    public static toDegrees(radians: number): number {
        return (radians * 180) / Math.PI;
    }

    /**
     * Computes the next power of two greater than or equal to `n`.
     * @param n - Input value.
     * @returns The next power of two, or 1 when `n <= 1`.
     */
    public static nextPowerOfTwo(n: number): number {
        if (n <= 1) {
            return 1;
        }

        let value = 1;
        while (value < n) {
            value <<= 1;
        }
        return value;
    }

    /**
     * Tests whether `n` is a power of two.
     * @param n - Input value.
     * @returns True when `n` is a power of two.
     */
    public static isPowerOfTwo(n: number): boolean {
        return n > 0 && (n & (n - 1)) === 0;
    }

    /**
     * Computes a frame-rate-independent exponential decay interpolation factor.
     * @param speed - Decay speed.
     * @param dt - Delta time in seconds.
     * @returns The interpolation factor.
     */
    public static expDecayT(speed: number, dt: number): number {
        return 1 - Math.exp(-speed * dt);
    }

    /**
     * Computes the distance between two points.
     * @param x1 - First point X.
     * @param y1 - First point Y.
     * @param x2 - Second point X.
     * @param y2 - Second point Y.
     * @returns The Euclidean distance.
     */
    public static distance(x1: number, y1: number, x2: number, y2: number): number {
        return Math.sqrt(Math2D.distanceSq(x1, y1, x2, y2));
    }

    /**
     * Computes the squared distance between two points.
     * @param x1 - First point X.
     * @param y1 - First point Y.
     * @param x2 - Second point X.
     * @param y2 - Second point Y.
     * @returns The squared distance.
     */
    public static distanceSq(x1: number, y1: number, x2: number, y2: number): number {
        const dx = x2 - x1;
        const dy = y2 - y1;
        return dx * dx + dy * dy;
    }
}
