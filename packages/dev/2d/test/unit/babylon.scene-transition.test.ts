import { SceneTransition2D } from "2d/Transition/sceneTransition2D";
import { Scene2D } from "2d/Scene2D/scene2D";
import { Camera2D } from "2d/Camera2D/camera2D";
import { Easing } from "2d/Tween/easing";
import { Color4 } from "core/Maths/math.color";
import { Vector2 } from "core/Maths/math.vector";

// Minimal engine mock for Scene2D
function mockEngine() {
    return {
        getRenderWidth: () => 800,
        getRenderHeight: () => 600,
        getRenderingCanvas: () => null,
        beginFrame: () => {},
        endFrame: () => {},
        clear: () => {},
        setViewport: () => {},
        setAlphaMode: () => {},
        setDepthBuffer: () => {},
        enableEffect: () => {},
        getCaps: () => ({ instancedArrays: false, standardDerivatives: false }),
        createEffect: () => ({ isReady: () => false, onCompiled: null }),
    } as any;
}

function createScene(): Scene2D {
    const scene = new Scene2D(mockEngine());
    scene.camera = new Camera2D();
    scene.camera.setViewport(800, 600);
    return scene;
}

describe("SceneTransition2D", () => {
    describe("fade", () => {
        it("should start active", () => {
            const from = createScene();
            const to = createScene();
            const t = SceneTransition2D.fade({ from, to });
            expect(t.isActive).toBe(true);
            expect(t.isDone).toBe(false);
        });

        it("should start with activeScene = from", () => {
            const from = createScene();
            const to = createScene();
            const t = SceneTransition2D.fade({ from, to });
            expect(t.activeScene).toBe(from);
        });

        it("should add overlay to from scene", () => {
            const from = createScene();
            const to = createScene();
            SceneTransition2D.fade({ from, to });
            // Overlay is added as root node
            expect(from.rootNodes.length).toBe(1);
            expect(from.rootNodes[0].name).toBe("__transition_overlay__");
        });

        it("should switch to 'to' scene after half duration", () => {
            const from = createScene();
            const to = createScene();
            const t = SceneTransition2D.fade({ from, to, duration: 1.0 });

            // Advance past the "out" phase (0.5s)
            t.update(0.6);
            expect(t.activeScene).toBe(to);
        });

        it("should move overlay from 'from' to 'to' at midpoint", () => {
            const from = createScene();
            const to = createScene();
            const t = SceneTransition2D.fade({ from, to, duration: 1.0 });

            t.update(0.6); // Past midpoint
            expect(from.rootNodes.length).toBe(0);
            expect(to.rootNodes.length).toBe(1);
        });

        it("should complete and call onComplete", () => {
            const from = createScene();
            const to = createScene();
            let completed = false;
            const t = SceneTransition2D.fade({
                from,
                to,
                duration: 1.0,
                onComplete: () => {
                    completed = true;
                },
            });

            // Run through both phases
            t.update(0.6); // Past "out"
            t.update(0.6); // Past "in"
            expect(t.isDone).toBe(true);
            expect(t.isActive).toBe(false);
            expect(completed).toBe(true);
        });

        it("should remove overlay when done", () => {
            const from = createScene();
            const to = createScene();
            const t = SceneTransition2D.fade({ from, to, duration: 0.5 });

            t.update(0.3); // Past "out"
            t.update(0.3); // Past "in"
            expect(to.rootNodes.length).toBe(0);
        });

        it("should use custom color", () => {
            const from = createScene();
            const to = createScene();
            const red = new Color4(1, 0, 0, 1);
            SceneTransition2D.fade({ from, to, color: red });

            const overlay = from.rootNodes[0] as any;
            expect(overlay.tint.r).toBe(1);
            expect(overlay.tint.g).toBe(0);
            expect(overlay.tint.b).toBe(0);
        });

        it("should use default duration of 0.5", () => {
            const from = createScene();
            const to = createScene();
            const t = SceneTransition2D.fade({ from, to });

            // At 0.3s, should still be in "out" phase (half = 0.25s)
            t.update(0.3);
            // Should have switched to "in" phase
            expect(t.activeScene).toBe(to);
        });
    });

    describe("slide", () => {
        it("should start active", () => {
            const from = createScene();
            const to = createScene();
            const t = SceneTransition2D.slide({ from, to });
            expect(t.isActive).toBe(true);
        });

        it("should offset 'to' camera at start (left slide)", () => {
            const from = createScene();
            const to = createScene();
            to.camera!.position = new Vector2(0, 0);
            SceneTransition2D.slide({ from, to, direction: "left" });

            // "to" camera should start off-screen to the right (opposite of left)
            expect(to.camera!.position.x).toBe(800); // +vpW
        });

        it("should restore 'to' camera at end", () => {
            const from = createScene();
            const to = createScene();
            to.camera!.position = new Vector2(100, 200);
            const t = SceneTransition2D.slide({ from, to, duration: 0.5, direction: "left" });

            t.update(0.6); // Past duration
            expect(to.camera!.position.x).toBeCloseTo(100);
            expect(to.camera!.position.y).toBeCloseTo(200);
        });

        it("should complete and call onComplete", () => {
            const from = createScene();
            const to = createScene();
            let completed = false;
            const t = SceneTransition2D.slide({
                from,
                to,
                duration: 0.5,
                onComplete: () => {
                    completed = true;
                },
            });

            t.update(0.6);
            expect(t.isDone).toBe(true);
            expect(completed).toBe(true);
        });

        it("should support all 4 directions", () => {
            for (const dir of ["left", "right", "up", "down"] as const) {
                const from = createScene();
                const to = createScene();
                to.camera!.position = new Vector2(0, 0);
                const t = SceneTransition2D.slide({ from, to, direction: dir, duration: 0.5 });
                t.update(0.6);
                expect(t.isDone).toBe(true);
                expect(to.camera!.position.x).toBeCloseTo(0);
                expect(to.camera!.position.y).toBeCloseTo(0);
            }
        });
    });

    describe("after completion", () => {
        it("should not advance after done", () => {
            const from = createScene();
            const to = createScene();
            let count = 0;
            const t = SceneTransition2D.fade({
                from,
                to,
                duration: 0.5,
                onComplete: () => count++,
            });

            t.update(0.3);
            t.update(0.3);
            expect(count).toBe(1);

            // Further updates should do nothing
            t.update(1.0);
            expect(count).toBe(1);
        });
    });
});
