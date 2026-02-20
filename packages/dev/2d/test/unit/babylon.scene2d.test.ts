import { Scene2D } from "2d/Scene2D/scene2D";
import { Node2D } from "2d/Node2D/node2D";
import { Sprite2D } from "2d/Sprite2D/sprite2D";
import { Color4 } from "core/Maths/math.color";

// Minimal engine mock — only properties used by Scene2D's non-render code
const mockEngine = {} as any;

describe("Scene2D", () => {
    let scene: Scene2D;

    beforeEach(() => {
        scene = new Scene2D(mockEngine);
    });

    describe("constructor", () => {
        it("should store the engine reference", () => {
            expect(scene.engine).toBe(mockEngine);
        });

        it("should have black background by default", () => {
            expect(scene.backgroundColor).toEqual(new Color4(0, 0, 0, 1));
        });

        it("should have no camera by default", () => {
            expect(scene.camera).toBeNull();
        });

        it("should start with no root nodes", () => {
            expect(scene.rootNodes).toHaveLength(0);
        });

        it("should not be disposed initially", () => {
            expect(scene.isDisposed).toBe(false);
        });
    });

    describe("addNode / removeNode", () => {
        it("should add a root node", () => {
            const node = new Node2D("n1");
            scene.addNode(node);
            expect(scene.rootNodes).toContain(node);
        });

        it("should not add the same node twice", () => {
            const node = new Node2D("n1");
            scene.addNode(node);
            scene.addNode(node);
            expect(scene.rootNodes).toHaveLength(1);
        });

        it("should not add a node that has a parent", () => {
            const parent = new Node2D("parent");
            const child = new Node2D("child");
            parent.addChild(child);
            scene.addNode(child);
            expect(scene.rootNodes).not.toContain(child);
        });

        it("should remove a root node", () => {
            const node = new Node2D("n1");
            scene.addNode(node);
            scene.removeNode(node);
            expect(scene.rootNodes).not.toContain(node);
        });

        it("should handle removing a node not in the scene", () => {
            const node = new Node2D("n1");
            expect(() => scene.removeNode(node)).not.toThrow();
        });
    });

    describe("getNodeById", () => {
        it("should find a node by id", () => {
            const node = new Node2D("hero");
            scene.addNode(node);
            expect(scene.getNodeById(node.id)).toBe(node);
        });

        it("should find child nodes", () => {
            const parent = new Node2D("parent");
            const child = new Node2D("child");
            parent.addChild(child);
            scene.addNode(parent);
            expect(scene.getNodeById(child.id)).toBe(child);
        });

        it("should return null for unknown id", () => {
            expect(scene.getNodeById("nonexistent")).toBeNull();
        });

        it("should unregister removed nodes", () => {
            const node = new Node2D("n1");
            scene.addNode(node);
            scene.removeNode(node);
            expect(scene.getNodeById(node.id)).toBeNull();
        });
    });

    describe("getAllNodes", () => {
        it("should return all registered nodes including children", () => {
            const parent = new Node2D("parent");
            const child1 = new Node2D("child1");
            const child2 = new Node2D("child2");
            parent.addChild(child1);
            parent.addChild(child2);
            scene.addNode(parent);

            const all = scene.getAllNodes();
            expect(all).toHaveLength(3);
            expect(all).toContain(parent);
            expect(all).toContain(child1);
            expect(all).toContain(child2);
        });
    });

    describe("update", () => {
        it("should call update on root nodes", () => {
            const updates: string[] = [];
            const n1 = new Node2D("n1");
            const n2 = new Node2D("n2");
            n1.onUpdate.add(() => updates.push("n1"));
            n2.onUpdate.add(() => updates.push("n2"));
            scene.addNode(n1);
            scene.addNode(n2);
            scene.update(0.016);
            expect(updates).toEqual(["n1", "n2"]);
        });

        it("should propagate to child nodes", () => {
            const updates: string[] = [];
            const parent = new Node2D("parent");
            const child = new Node2D("child");
            parent.addChild(child);
            parent.onUpdate.add(() => updates.push("parent"));
            child.onUpdate.add(() => updates.push("child"));
            scene.addNode(parent);
            scene.update(0.016);
            expect(updates).toContain("parent");
            expect(updates).toContain("child");
        });
    });

    describe("observables", () => {
        it("should fire onDispose when disposed", () => {
            let disposed = false;
            scene.onDispose.add(() => { disposed = true; });
            scene.dispose();
            expect(disposed).toBe(true);
        });
    });

    describe("dispose", () => {
        it("should mark scene as disposed", () => {
            scene.dispose();
            expect(scene.isDisposed).toBe(true);
        });

        it("should clear all root nodes", () => {
            scene.addNode(new Node2D("n1"));
            scene.addNode(new Node2D("n2"));
            scene.dispose();
            expect(scene.rootNodes).toHaveLength(0);
        });

        it("should not throw when disposed twice", () => {
            scene.dispose();
            expect(() => scene.dispose()).not.toThrow();
        });

        it("should clear node lookup", () => {
            const node = new Node2D("hero");
            scene.addNode(node);
            scene.dispose();
            expect(scene.getNodeById(node.id)).toBeNull();
        });
    });

    describe("sprite sorting order", () => {
        it("should maintain multiple sprite nodes", () => {
            const s1 = new Sprite2D("bg");
            s1.zIndex = 0;
            s1.sortingLayer = 0;
            const s2 = new Sprite2D("player");
            s2.zIndex = 10;
            s2.sortingLayer = 1;
            const s3 = new Sprite2D("ui");
            s3.zIndex = 5;
            s3.sortingLayer = 2;

            scene.addNode(s1);
            scene.addNode(s2);
            scene.addNode(s3);

            expect(scene.getAllNodes()).toHaveLength(3);
        });
    });
});
