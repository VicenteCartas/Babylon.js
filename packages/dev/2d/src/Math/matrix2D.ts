import { Vector2 } from "core/Maths/math.vector";

/**
 * A 3x2 affine transformation matrix for 2D operations.
 * Stored as [a, b, c, d, tx, ty] representing:
 * | a  c  tx |
 * | b  d  ty |
 * | 0  0  1  |
 */
export class Matrix2D {
    /**
     * The matrix values in column-major order: [a, b, c, d, tx, ty]
     */
    public m: Float32Array;

    /**
     * Creates a new Matrix2D
     * @param a - Scale X / Rotation component
     * @param b - Skew Y component
     * @param c - Skew X component
     * @param d - Scale Y / Rotation component
     * @param tx - Translation X
     * @param ty - Translation Y
     */
    constructor(a: number = 1, b: number = 0, c: number = 0, d: number = 1, tx: number = 0, ty: number = 0) {
        this.m = new Float32Array([a, b, c, d, tx, ty]);
    }

    /**
     * Returns the value at the specified index
     * @param index - The index (0-5)
     * @returns The value at the given index
     */
    public get(index: number): number {
        return this.m[index];
    }

    /**
     * Creates an identity matrix
     * @returns A new identity Matrix2D
     */
    public static Identity(): Matrix2D {
        return new Matrix2D(1, 0, 0, 1, 0, 0);
    }

    /**
     * Creates a translation matrix
     * @param x - Translation along X
     * @param y - Translation along Y
     * @returns A new translation Matrix2D
     */
    public static Translation(x: number, y: number): Matrix2D {
        return new Matrix2D(1, 0, 0, 1, x, y);
    }

    /**
     * Creates a rotation matrix (clockwise in Y-down coordinate system)
     * @param angle - Rotation angle in radians
     * @returns A new rotation Matrix2D
     */
    public static Rotation(angle: number): Matrix2D {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return new Matrix2D(cos, sin, -sin, cos, 0, 0);
    }

    /**
     * Creates a scaling matrix
     * @param x - Scale factor along X
     * @param y - Scale factor along Y
     * @returns A new scaling Matrix2D
     */
    public static Scaling(x: number, y: number): Matrix2D {
        return new Matrix2D(x, 0, 0, y, 0, 0);
    }

    /**
     * Composes a matrix from translation, rotation, scale, and pivot
     * @param position - Translation
     * @param rotation - Rotation angle in radians
     * @param scale - Scale factors
     * @param pivot - Pivot point (rotation/scale center relative to self)
     * @returns A new composed Matrix2D
     */
    public static Compose(position: Vector2, rotation: number, scale: Vector2, pivot: Vector2, skewX: number = 0, skewY: number = 0): Matrix2D {
        const a = Math.cos(rotation + skewY) * scale.x;
        const b = Math.sin(rotation + skewY) * scale.x;
        const c = -Math.sin(rotation + skewX) * scale.y;
        const d = Math.cos(rotation + skewX) * scale.y;
        const px = pivot.x;
        const py = pivot.y;
        const tx = position.x - px * a - py * c;
        const ty = position.y - px * b - py * d;

        return new Matrix2D(a, b, c, d, tx, ty);
    }

    /**
     * Multiplies two matrices (this * other)
     * @param other - The matrix to multiply with
     * @returns A new Matrix2D containing the result
     */
    public multiply(other: Matrix2D): Matrix2D {
        const a = this.m;
        const b = other.m;

        return new Matrix2D(
            a[0] * b[0] + a[2] * b[1],
            a[1] * b[0] + a[3] * b[1],
            a[0] * b[2] + a[2] * b[3],
            a[1] * b[2] + a[3] * b[3],
            a[0] * b[4] + a[2] * b[5] + a[4],
            a[1] * b[4] + a[3] * b[5] + a[5]
        );
    }

    /**
     * Multiplies this matrix by the other and stores the result in this matrix
     * @param other - The matrix to multiply with
     * @returns This matrix for chaining
     */
    public multiplyToSelf(other: Matrix2D): Matrix2D {
        const a0 = this.m[0],
            a1 = this.m[1],
            a2 = this.m[2],
            a3 = this.m[3],
            a4 = this.m[4],
            a5 = this.m[5];
        const b = other.m;

        this.m[0] = a0 * b[0] + a2 * b[1];
        this.m[1] = a1 * b[0] + a3 * b[1];
        this.m[2] = a0 * b[2] + a2 * b[3];
        this.m[3] = a1 * b[2] + a3 * b[3];
        this.m[4] = a0 * b[4] + a2 * b[5] + a4;
        this.m[5] = a1 * b[4] + a3 * b[5] + a5;

        return this;
    }

    /**
     * Transforms a point by this matrix
     * @param point - The point to transform
     * @returns A new transformed Vector2
     */
    public transformPoint(point: Vector2): Vector2 {
        const m = this.m;
        return new Vector2(m[0] * point.x + m[2] * point.y + m[4], m[1] * point.x + m[3] * point.y + m[5]);
    }

    /**
     * Computes the inverse of this matrix
     * @returns A new inverted Matrix2D, or identity if not invertible
     */
    public invert(): Matrix2D {
        const m = this.m;
        const det = m[0] * m[3] - m[1] * m[2];

        if (Math.abs(det) < 1e-10) {
            return Matrix2D.Identity();
        }

        const invDet = 1.0 / det;
        return new Matrix2D(m[3] * invDet, -m[1] * invDet, -m[2] * invDet, m[0] * invDet, (m[2] * m[5] - m[3] * m[4]) * invDet, (m[1] * m[4] - m[0] * m[5]) * invDet);
    }

    /**
     * Copies values from another matrix
     * @param other - The matrix to copy from
     * @returns This matrix for chaining
     */
    public copyFrom(other: Matrix2D): Matrix2D {
        this.m.set(other.m);
        return this;
    }

    /**
     * Clones this matrix
     * @returns A new Matrix2D with the same values
     */
    public clone(): Matrix2D {
        return new Matrix2D(this.m[0], this.m[1], this.m[2], this.m[3], this.m[4], this.m[5]);
    }

    /**
     * Sets this matrix to identity
     * @returns This matrix for chaining
     */
    public reset(): Matrix2D {
        this.m[0] = 1;
        this.m[1] = 0;
        this.m[2] = 0;
        this.m[3] = 1;
        this.m[4] = 0;
        this.m[5] = 0;
        return this;
    }
}
