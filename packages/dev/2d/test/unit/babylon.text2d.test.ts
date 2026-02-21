import { Text2D } from "2d/Text2D/text2D";

// Text2D depends on DynamicTexture + engine for GPU texture creation.
// We test the property/state logic here; actual rendering requires WebGL.

describe("Text2D", () => {
    describe("constructor", () => {
        it("should create with default options", () => {
            const t = new Text2D("label", "", undefined, null);
            expect(t.name).toBe("label");
            expect(t.text).toBe("");
            expect(t.font).toBe("16px sans-serif");
            expect(t.color).toBe("#ffffff");
            expect(t.textAlign).toBe("left");
            expect(t.textBaseline).toBe("top");
            expect(t.padding).toBe(4);
        });

        it("should accept initial text", () => {
            const t = new Text2D("label", "Hello", undefined, null);
            expect(t.text).toBe("Hello");
        });

        it("should accept custom options", () => {
            const t = new Text2D("label", "Hi", {
                font: "bold 32px Arial",
                color: "#ff0000",
                textAlign: "center",
                textBaseline: "middle",
                padding: 8,
            }, null);
            expect(t.font).toBe("bold 32px Arial");
            expect(t.color).toBe("#ff0000");
            expect(t.textAlign).toBe("center");
            expect(t.textBaseline).toBe("middle");
            expect(t.padding).toBe(8);
        });
    });

    describe("property setters trigger redraw", () => {
        it("should mark dirty when text changes", () => {
            const t = new Text2D("label", "A", undefined, null);
            // Access internal state via type assertion
            (t as any)._needsRedraw = false;
            t.text = "B";
            expect((t as any)._needsRedraw).toBe(true);
        });

        it("should not mark dirty when text is set to same value", () => {
            const t = new Text2D("label", "A", undefined, null);
            (t as any)._needsRedraw = false;
            t.text = "A";
            expect((t as any)._needsRedraw).toBe(false);
        });

        it("should mark dirty when font changes", () => {
            const t = new Text2D("label", "", undefined, null);
            (t as any)._needsRedraw = false;
            t.font = "24px monospace";
            expect((t as any)._needsRedraw).toBe(true);
        });

        it("should mark dirty when color changes", () => {
            const t = new Text2D("label", "", undefined, null);
            (t as any)._needsRedraw = false;
            t.color = "red";
            expect((t as any)._needsRedraw).toBe(true);
        });

        it("should mark dirty when textAlign changes", () => {
            const t = new Text2D("label", "", undefined, null);
            (t as any)._needsRedraw = false;
            t.textAlign = "center";
            expect((t as any)._needsRedraw).toBe(true);
        });

        it("should mark dirty when textBaseline changes", () => {
            const t = new Text2D("label", "", undefined, null);
            (t as any)._needsRedraw = false;
            t.textBaseline = "middle";
            expect((t as any)._needsRedraw).toBe(true);
        });

        it("should mark dirty when padding changes", () => {
            const t = new Text2D("label", "", undefined, null);
            (t as any)._needsRedraw = false;
            t.padding = 10;
            expect((t as any)._needsRedraw).toBe(true);
        });
    });

    describe("Node2D inheritance", () => {
        it("should support position and hierarchy", () => {
            const parent = new Text2D("parent", "Parent", undefined, null);
            const child = new Text2D("child", "Child", undefined, null);
            parent.addChild(child);
            expect(child.parent).toBe(parent);
            expect(parent.children).toContain(child);
        });

        it("should support rotation and scale", () => {
            const t = new Text2D("label", "Hi", undefined, null);
            t.rotation = Math.PI / 4;
            t.scale.x = 2;
            expect(t.rotation).toBe(Math.PI / 4);
            expect(t.scale.x).toBe(2);
        });
    });

    describe("_estimateFontHeight", () => {
        it("should parse pixel size from font string", () => {
            const t = new Text2D("label", "Hi", { font: "24px Arial" }, null);
            const height = (t as any)._estimateFontHeight({
                measureText: () => ({}), // No fontBoundingBox support
            });
            expect(height).toBeCloseTo(31, 0); // 24 * 1.2 ≈ 28.8 → ceil = 29 + 2 safety = 31
        });

        it("should fallback to 16 for unparseable fonts", () => {
            const t = new Text2D("label", "Hi", { font: "large serif" }, null);
            const height = (t as any)._estimateFontHeight({
                measureText: () => ({}),
            });
            expect(height).toBe(16);
        });
    });
});
