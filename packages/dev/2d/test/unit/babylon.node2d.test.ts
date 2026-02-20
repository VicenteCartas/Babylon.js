import { Node2D } from "2d/Node2D/node2D";
import { Vector2 } from "core/Maths/math.vector";

describe("Node2D", () => {
    describe("hierarchy", () => {
        it("should set parent and add to children", () => {
            const parent = new Node2D("parent");
            const child = new Node2D("child");

            child.parent = parent;

            expect(child.parent).toBe(parent);
            expect(parent.children).toHaveLength(1);
            expect(parent.children[0]).toBe(child);
        });

        it("should remove from old parent when reparenting", () => {
            const parent1 = new Node2D("parent1");
            const parent2 = new Node2D("parent2");
            const child = new Node2D("child");

            child.parent = parent1;
            expect(parent1.children).toHaveLength(1);

            child.parent = parent2;
            expect(parent1.children).toHaveLength(0);
            expect(parent2.children).toHaveLength(1);
        });

        it("should handle addChild and removeChild", () => {
            const parent = new Node2D("parent");
            const child = new Node2D("child");

            parent.addChild(child);
            expect(child.parent).toBe(parent);

            parent.removeChild(child);
            expect(child.parent).toBeNull();
            expect(parent.children).toHaveLength(0);
        });

        it("should not add duplicate when setting same parent", () => {
            const parent = new Node2D("parent");
            const child = new Node2D("child");

            child.parent = parent;
            child.parent = parent; // set again

            expect(parent.children).toHaveLength(1);
        });
    });

    describe("transform", () => {
        it("should compute identity world transform for root node", () => {
            const node = new Node2D("root");
            node.position = new Vector2(100, 200);

            const wp = node.worldPosition;
            expect(wp.x).toBe(100);
            expect(wp.y).toBe(200);
        });

        it("should compose parent and child transforms", () => {
            const parent = new Node2D("parent");
            parent.position = new Vector2(100, 100);

            const child = new Node2D("child");
            child.position = new Vector2(50, 50);
            child.parent = parent;

            const wp = child.worldPosition;
            expect(wp.x).toBeCloseTo(150, 5);
            expect(wp.y).toBeCloseTo(150, 5);
        });

        it("should handle scaled parent", () => {
            const parent = new Node2D("parent");
            parent.scale = new Vector2(2, 2);

            const child = new Node2D("child");
            child.position = new Vector2(10, 20);
            child.parent = parent;

            const wp = child.worldPosition;
            expect(wp.x).toBeCloseTo(20, 5);
            expect(wp.y).toBeCloseTo(40, 5);
        });

        it("should localToWorld and worldToLocal be inverse operations", () => {
            const node = new Node2D("node");
            node.position = new Vector2(100, 200);
            node.rotation = 0.5;
            node.scale = new Vector2(2, 3);

            const localPoint = new Vector2(10, 20);
            const worldPoint = node.localToWorld(localPoint);
            const backToLocal = node.worldToLocal(worldPoint);

            expect(backToLocal.x).toBeCloseTo(localPoint.x, 5);
            expect(backToLocal.y).toBeCloseTo(localPoint.y, 5);
        });
    });

    describe("alpha inheritance", () => {
        it("should multiply alpha through hierarchy", () => {
            const parent = new Node2D("parent");
            parent.alpha = 0.5;

            const child = new Node2D("child");
            child.alpha = 0.8;
            child.parent = parent;

            expect(child.worldAlpha).toBeCloseTo(0.4, 5);
        });
    });

    describe("z-index sorting", () => {
        it("should sort children by zIndex", () => {
            const parent = new Node2D("parent");
            const a = new Node2D("a");
            a.zIndex = 3;
            const b = new Node2D("b");
            b.zIndex = 1;
            const c = new Node2D("c");
            c.zIndex = 2;

            parent.addChild(a);
            parent.addChild(b);
            parent.addChild(c);

            const sorted = parent.getChildrenSortedByZIndex();
            expect(sorted[0].name).toBe("b");
            expect(sorted[1].name).toBe("c");
            expect(sorted[2].name).toBe("a");
        });
    });

    describe("dispose", () => {
        it("should dispose children recursively", () => {
            const parent = new Node2D("parent");
            const child = new Node2D("child");
            const grandchild = new Node2D("grandchild");

            parent.addChild(child);
            child.addChild(grandchild);

            let disposed = false;
            grandchild.onDispose.add(() => {
                disposed = true;
            });

            parent.dispose();
            expect(disposed).toBe(true);
            expect(parent.children).toHaveLength(0);
        });

        it("should remove from parent on dispose", () => {
            const parent = new Node2D("parent");
            const child = new Node2D("child");
            parent.addChild(child);

            child.dispose();
            expect(parent.children).toHaveLength(0);
        });
    });

    describe("update", () => {
        it("should notify onUpdate observable", () => {
            const node = new Node2D("node");
            let receivedDt = -1;

            node.onUpdate.add((dt) => {
                receivedDt = dt;
            });

            node.update(0.016);
            expect(receivedDt).toBeCloseTo(0.016, 5);
        });

        it("should propagate update to children", () => {
            const parent = new Node2D("parent");
            const child = new Node2D("child");
            parent.addChild(child);

            let childUpdated = false;
            child.onUpdate.add(() => {
                childUpdated = true;
            });

            parent.update(0.016);
            expect(childUpdated).toBe(true);
        });
    });
});
