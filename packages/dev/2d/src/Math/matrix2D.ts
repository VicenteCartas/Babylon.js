import { Vector2 } from "core/Maths/math.vector";

/**
 * A 3×3 2D affine transformation matrix stored as 6 values in column-major order.
 * Layout: [m00, m10, m01, m11, m02, m12].
 */
export class Matrix2D {
    /**
     * The matrix values in column-major order.
     */
    public readonly m: Float32Array;

    /**
     * Creates a new Matrix2D.
     * @param m00 - First column X component.
     * @param m10 - First column Y component.
     * @param m01 - Second column X component.
     * @param m11 - Second column Y component.
     * @param m02 - Translation X component.
     * @param m12 - Translation Y component.
     */
    constructor(m00: number = 1, m10: number = 0, m01: number = 0, m11: number = 1, m02: number = 0, m12: number = 0) {
        this.m = new Float32Array(6);
        this.m[0] = m00;
        this.m[1] = m10;
        this.m[2] = m01;
        this.m[3] = m11;
        this.m[4] = m02;
        this.m[5] = m12;
    }

    /**
     * Returns a new identity matrix.
     * @returns A new identity matrix.
     */
    public static Identity(): Matrix2D {
        return new Matrix2D();
    }

    /**
     * Returns a new zero matrix.
     * @returns A new zero matrix.
     */
    public static Zero(): Matrix2D {
        return new Matrix2D(0, 0, 0, 0, 0, 0);
    }

    /**
     * Composes a matrix from translation, rotation, scale, and pivot.
     * @param position - Translation.
     * @param rotation - Rotation angle in radians.
     * @param scale - Scale factors.
     * @param pivot - Pivot point in local space.
     * @returns A new composed matrix.
     */
    public static Compose(position: Vector2, rotation: number, scale: Vector2, pivot: Vector2): Matrix2D {
        return new Matrix2D().compose(position, rotation, scale, pivot);
    }

    /**
     * @internal
     * Composes a matrix from translation, rotation, scale, pivot, and skew into `out`.
     * @param position - Translation.
     * @param rotation - Rotation angle in radians.
     * @param scale - Scale factors.
     * @param pivot - Pivot point in local space.
     * @param skewX - Skew along the local X axis in radians.
     * @param skewY - Skew along the local Y axis in radians.
     * @param out - Matrix receiving the result.
     * @returns The `out` matrix.
     */
    public static _ComposeWithSkewToRef(position: Vector2, rotation: number, scale: Vector2, pivot: Vector2, skewX: number, skewY: number, out: Matrix2D): Matrix2D {
        const m = out.m;

        if (skewX === 0 && skewY === 0) {
            const cos = Math.cos(rotation);
            const sin = Math.sin(rotation);

            m[0] = scale.x * cos;
            m[1] = scale.x * sin;
            m[2] = -scale.y * sin;
            m[3] = scale.y * cos;
        } else {
            m[0] = Math.cos(rotation + skewY) * scale.x;
            m[1] = Math.sin(rotation + skewY) * scale.x;
            m[2] = -Math.sin(rotation + skewX) * scale.y;
            m[3] = Math.cos(rotation + skewX) * scale.y;
        }

        m[4] = position.x - pivot.x * m[0] - pivot.y * m[2];
        m[5] = position.y - pivot.x * m[1] - pivot.y * m[3];
        return out;
    }

    /**
     * Sets this matrix to the identity matrix.
     * @returns This matrix.
     */
    public setIdentity(): this {
        const m = this.m;
        m[0] = 1;
        m[1] = 0;
        m[2] = 0;
        m[3] = 1;
        m[4] = 0;
        m[5] = 0;
        return this;
    }

    /**
     * Composes this matrix in place from translation, rotation, scale, and pivot.
     * @param position - Translation.
     * @param rotation - Rotation angle in radians.
     * @param scale - Scale factors.
     * @param pivot - Pivot point in local space.
     * @returns This matrix.
     */
    public compose(position: Vector2, rotation: number, scale: Vector2, pivot: Vector2): this {
        Matrix2D._ComposeWithSkewToRef(position, rotation, scale, pivot, 0, 0, this);
        return this;
    }

    /**
     * Multiplies this matrix by another, writing into `out`.
     * @param other - The right-hand matrix.
     * @param out - Matrix receiving the result.
     * @returns The `out` matrix.
     */
    public multiplyToRef(other: Matrix2D, out: Matrix2D): Matrix2D {
        const a = this.m;
        const b = other.m;
        const outM = out.m;

        const m00 = a[0] * b[0] + a[2] * b[1];
        const m10 = a[1] * b[0] + a[3] * b[1];
        const m01 = a[0] * b[2] + a[2] * b[3];
        const m11 = a[1] * b[2] + a[3] * b[3];
        const m02 = a[0] * b[4] + a[2] * b[5] + a[4];
        const m12 = a[1] * b[4] + a[3] * b[5] + a[5];

        outM[0] = m00;
        outM[1] = m10;
        outM[2] = m01;
        outM[3] = m11;
        outM[4] = m02;
        outM[5] = m12;
        return out;
    }

    /**
     * Inverts this matrix into `out`.
     * @param out - Matrix receiving the inverse.
     * @returns True when inversion succeeded; otherwise false.
     */
    public invertToRef(out: Matrix2D): boolean {
        const m = this.m;
        const determinant = m[0] * m[3] - m[1] * m[2];
        if (Math.abs(determinant) < 1e-10) {
            return false;
        }

        const inverseDeterminant = 1 / determinant;
        const outM = out.m;
        outM[0] = m[3] * inverseDeterminant;
        outM[1] = -m[1] * inverseDeterminant;
        outM[2] = -m[2] * inverseDeterminant;
        outM[3] = m[0] * inverseDeterminant;
        outM[4] = (m[2] * m[5] - m[3] * m[4]) * inverseDeterminant;
        outM[5] = (m[1] * m[4] - m[0] * m[5]) * inverseDeterminant;
        return true;
    }

    /**
     * Transforms a point into `out`.
     * @param x - Point X.
     * @param y - Point Y.
     * @param out - Vector receiving the transformed point.
     * @returns The `out` vector.
     */
    public transformPoint(x: number, y: number, out: Vector2): Vector2 {
        const m = this.m;
        out.x = m[0] * x + m[2] * y + m[4];
        out.y = m[1] * x + m[3] * y + m[5];
        return out;
    }

    /**
     * Transforms a direction vector without applying translation.
     * @param x - Direction X.
     * @param y - Direction Y.
     * @param out - Vector receiving the transformed direction.
     * @returns The `out` vector.
     */
    public transformDirection(x: number, y: number, out: Vector2): Vector2 {
        const m = this.m;
        out.x = m[0] * x + m[2] * y;
        out.y = m[1] * x + m[3] * y;
        return out;
    }

    /**
     * X translation component.
     * @returns The X translation.
     */
    public get tx(): number {
        return this.m[4];
    }

    /**
     * Y translation component.
     * @returns The Y translation.
     */
    public get ty(): number {
        return this.m[5];
    }

    /**
     * X scale magnitude.
     * @returns The X scale.
     */
    public get scaleX(): number {
        return Math.hypot(this.m[0], this.m[1]);
    }

    /**
     * Y scale magnitude.
     * @returns The Y scale.
     */
    public get scaleY(): number {
        return Math.hypot(this.m[2], this.m[3]);
    }

    /**
     * Extracted rotation angle in radians.
     * @returns The rotation angle.
     */
    public get rotation(): number {
        return Math.atan2(this.m[1], this.m[0]);
    }

    /**
     * Copies values from another matrix.
     * @param other - Matrix to copy from.
     * @returns This matrix.
     */
    public copyFrom(other: Matrix2D): this {
        this.m.set(other.m);
        return this;
    }

    /**
     * Creates a clone of this matrix.
     * @returns A new matrix with the same values.
     */
    public clone(): Matrix2D {
        return new Matrix2D(this.m[0], this.m[1], this.m[2], this.m[3], this.m[4], this.m[5]);
    }

    /**
     * Writes this matrix to an array.
     * @param array - Target array.
     * @param offset - Starting element offset.
     * @returns Nothing.
     */
    public copyToArray(array: Float32Array, offset: number): void {
        array[offset] = this.m[0];
        array[offset + 1] = this.m[1];
        array[offset + 2] = this.m[2];
        array[offset + 3] = this.m[3];
        array[offset + 4] = this.m[4];
        array[offset + 5] = this.m[5];
    }

    /**
     * Compares two matrices using an epsilon.
     * @param a - First matrix.
     * @param b - Second matrix.
     * @param epsilon - Comparison tolerance.
     * @returns True when all components are within epsilon.
     */
    public static AreEqual(a: Matrix2D, b: Matrix2D, epsilon: number = 1e-6): boolean {
        for (let i = 0; i < 6; i++) {
            if (Math.abs(a.m[i] - b.m[i]) > epsilon) {
                return false;
            }
        }

        return true;
    }

    /**
     * Returns a string representation of this matrix.
     * @returns The matrix as a string.
     */
    public toString(): string {
        const m = this.m;
        return `Matrix2D(${m[0]}, ${m[1]}, ${m[2]}, ${m[3]}, ${m[4]}, ${m[5]})`;
    }
}