import { Matrix2D } from "2d/Math/matrix2D";
import { Rectangle2D } from "2d/Math/rectangle2D";
import { Vector2 } from "core/Maths/math.vector";

describe("Matrix2D", () => {
    it("should create an identity matrix by default", () => {
        const m = new Matrix2D();
        expect(m.m[0]).toBe(1);
        expect(m.m[1]).toBe(0);
        expect(m.m[2]).toBe(0);
        expect(m.m[3]).toBe(1);
        expect(m.m[4]).toBe(0);
        expect(m.m[5]).toBe(0);
    });

    it("should create a translation matrix", () => {
        const m = Matrix2D.Translation(10, 20);
        const point = m.transformPoint(Vector2.Zero());
        expect(point.x).toBe(10);
        expect(point.y).toBe(20);
    });

    it("should create a scaling matrix", () => {
        const m = Matrix2D.Scaling(2, 3);
        const point = m.transformPoint(new Vector2(5, 10));
        expect(point.x).toBe(10);
        expect(point.y).toBe(30);
    });

    it("should create a rotation matrix", () => {
        const m = Matrix2D.Rotation(Math.PI / 2); // 90 degrees
        const point = m.transformPoint(new Vector2(1, 0));
        expect(point.x).toBeCloseTo(0, 10);
        expect(point.y).toBeCloseTo(1, 10);
    });

    it("should multiply matrices correctly", () => {
        const translate = Matrix2D.Translation(100, 200);
        const scale = Matrix2D.Scaling(2, 2);
        const combined = translate.multiply(scale);

        // Scale then translate: point (5,5) -> scale (10,10) -> translate (110, 210)
        const point = combined.transformPoint(new Vector2(5, 5));
        expect(point.x).toBeCloseTo(110, 10);
        expect(point.y).toBeCloseTo(210, 10);
    });

    it("should invert correctly", () => {
        const m = Matrix2D.Compose(new Vector2(100, 50), Math.PI / 4, new Vector2(2, 2), Vector2.Zero());
        const inv = m.invert();
        const result = m.multiply(inv);

        // Should be approximately identity
        expect(result.m[0]).toBeCloseTo(1, 5);
        expect(result.m[1]).toBeCloseTo(0, 5);
        expect(result.m[2]).toBeCloseTo(0, 5);
        expect(result.m[3]).toBeCloseTo(1, 5);
        expect(result.m[4]).toBeCloseTo(0, 5);
        expect(result.m[5]).toBeCloseTo(0, 5);
    });

    it("should compose from position, rotation, scale, pivot", () => {
        const m = Matrix2D.Compose(new Vector2(10, 20), 0, new Vector2(1, 1), Vector2.Zero());
        const point = m.transformPoint(Vector2.Zero());
        expect(point.x).toBe(10);
        expect(point.y).toBe(20);
    });

    it("should clone correctly", () => {
        const m = Matrix2D.Translation(5, 10);
        const c = m.clone();
        expect(c.m[4]).toBe(5);
        expect(c.m[5]).toBe(10);

        // Modifying clone should not affect original
        c.m[4] = 99;
        expect(m.m[4]).toBe(5);
    });

    it("should reset to identity", () => {
        const m = Matrix2D.Translation(5, 10);
        m.reset();
        expect(m.m[0]).toBe(1);
        expect(m.m[4]).toBe(0);
        expect(m.m[5]).toBe(0);
    });
});

describe("Rectangle2D", () => {
    it("should compute right and bottom edges", () => {
        const r = new Rectangle2D(10, 20, 100, 50);
        expect(r.right).toBe(110);
        expect(r.bottom).toBe(70);
    });

    it("should detect point containment", () => {
        const r = new Rectangle2D(0, 0, 100, 100);
        expect(r.contains(50, 50)).toBe(true);
        expect(r.contains(0, 0)).toBe(true);
        expect(r.contains(100, 100)).toBe(false); // exclusive right/bottom
        expect(r.contains(-1, 50)).toBe(false);
    });

    it("should detect rectangle intersection", () => {
        const a = new Rectangle2D(0, 0, 100, 100);
        const b = new Rectangle2D(50, 50, 100, 100);
        const c = new Rectangle2D(200, 200, 10, 10);

        expect(a.intersects(b)).toBe(true);
        expect(b.intersects(a)).toBe(true);
        expect(a.intersects(c)).toBe(false);
    });

    it("should clone correctly", () => {
        const r = new Rectangle2D(1, 2, 3, 4);
        const c = r.clone();
        expect(c.x).toBe(1);
        expect(c.width).toBe(3);
        c.x = 99;
        expect(r.x).toBe(1);
    });
});
