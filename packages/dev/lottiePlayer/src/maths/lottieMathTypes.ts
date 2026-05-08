/**
 * Minimal 2D vector shape used by the engine-neutral Lottie runtime.
 */
export type LottieVector2Like = {
    /**
     * X coordinate or horizontal scale component.
     */
    x: number;
    /**
     * Y coordinate or vertical scale component.
     */
    y: number;
};

/**
 * Fixed-size row-major 4x4 matrix value array used by the Lottie thin matrix.
 */
export type LottieMatrixValues = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];

/**
 * Minimal matrix shape consumed by Lottie rendering adapters.
 */
export type LottieMatrixLike = {
    /**
     * Monotonically increasing flag updated when matrix values change.
     */
    updateFlag: number;
    /**
     * Returns the 16 matrix values.
     * @returns The current matrix value array.
     */
    asArray(): LottieMatrixValues;
};
