import { Camera2D } from "2d/Camera2D/camera2D";
import { Scene2D } from "2d/Scene2D/scene2D";
import { SceneTransition2D } from "2d/Transition/sceneTransition2D";
import { Easing } from "2d/Tween/easing";
import { Color4 } from "core/Maths/math.color";
import { Vector2 } from "core/Maths/math.vector";

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
        setState: () => {},
        enableEffect: () => {},
        createDynamicVertexBuffer: () => ({}),
        updateDynamicVertexBuffer: () => {},
        createIndexBuffer: () => ({}),
        createDrawContext: () => ({ reset: () => {}, dispose: () => {}, useInstancing: false }),
        createMaterialContext: () => ({}),
        _releaseBuffer: () => {},
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
        it("should expose spec-aligned running state and progress", () => {
            const from = createScene();
            const to = createScene();

            const transition = SceneTransition2D.fade({ from, to });

            expect(transition.isRunning).toBe(true);
            expect(transition.isActive).toBe(true);
            expect(transition.isDone).toBe(false);
            expect(transition.progress).toBe(0);
            expect(transition.activeScene).toBe(from);
        });

        it("should create an internal full-screen overlay without polluting root nodes", () => {
            const from = createScene();
            const to = createScene();
            const color = new Color4(1, 0, 0, 1);

            const transition = SceneTransition2D.fade({ from, to, color });
            const overlay = (transition as any)._overlay;

            expect(from.rootNodes.length).toBe(0);
            expect(to.rootNodes.length).toBe(0);
            expect(overlay.tint.r).toBe(1);
            expect(overlay.tint.g).toBe(0);
            expect(overlay.tint.b).toBe(0);
            expect(overlay.tint.a).toBe(0);
            expect(overlay.scrollFactorX).toBe(0);
            expect(overlay.scrollFactorY).toBe(0);
            expect(overlay.sortingLayer).toBe(Number.MAX_SAFE_INTEGER);
            expect(overlay.width).toBe(800);
            expect(overlay.height).toBe(600);
        });

        it("should switch scenes at the midpoint and complete once", () => {
            const from = createScene();
            const to = createScene();
            let callbackCount = 0;
            let observableCount = 0;

            const transition = SceneTransition2D.fade({
                from,
                to,
                duration: 1,
                onComplete: () => {
                    callbackCount++;
                },
            });
            transition.onComplete.add(() => {
                observableCount++;
            });

            transition.update(0.25);
            expect(transition.progress).toBeCloseTo(0.25);
            expect(transition.activeScene).toBe(from);

            transition.update(0.25);
            expect(transition.progress).toBeCloseTo(0.5);
            expect(transition.activeScene).toBe(to);

            transition.update(0.5);
            expect(transition.progress).toBe(1);
            expect(transition.isRunning).toBe(false);
            expect(transition.isDone).toBe(true);
            expect(callbackCount).toBe(1);
            expect(observableCount).toBe(1);
            expect(from.rootNodes.length).toBe(0);
            expect(to.rootNodes.length).toBe(0);
            expect((transition as any)._overlay).toBeNull();

            transition.update(1);
            expect(callbackCount).toBe(1);
            expect(observableCount).toBe(1);
        });

        it("should cancel without firing completion callbacks", () => {
            const from = createScene();
            const to = createScene();
            let callbackCount = 0;
            let observableCount = 0;

            const transition = SceneTransition2D.fade({
                from,
                to,
                duration: 1,
                onComplete: () => {
                    callbackCount++;
                },
            });
            transition.onComplete.add(() => {
                observableCount++;
            });

            transition.update(0.25);
            transition.cancel();

            expect(transition.progress).toBeCloseTo(0.25);
            expect(transition.isRunning).toBe(false);
            expect(callbackCount).toBe(0);
            expect(observableCount).toBe(0);
            expect(from.rootNodes.length).toBe(0);
            expect(to.rootNodes.length).toBe(0);
            expect((transition as any)._overlay).toBeNull();
        });
    });

    describe("slide", () => {
        it("should fall back to a fade when render textures are unavailable", () => {
            const from = createScene();
            const to = createScene();
            to.camera!.position = new Vector2(100, 200);

            const transition = SceneTransition2D.slide({ from, to, duration: 1, direction: "left" });

            expect(transition.isRunning).toBe(true);
            expect((transition as any)._overlay).not.toBeNull();
            expect((transition as any)._slideCompositeScene).toBeNull();
            expect(to.camera!.position.x).toBe(100);
            expect(to.camera!.position.y).toBe(200);

            transition.update(0.5);
            expect(transition.activeScene).toBe(to);

            transition.update(0.5);
            expect(transition.isDone).toBe(true);
        });

        it("should preserve provided duration and completion behavior when falling back", () => {
            const from = createScene();
            const to = createScene();
            let completed = 0;

            const transition = SceneTransition2D.slide({
                from,
                to,
                duration: 0.5,
                onComplete: () => {
                    completed++;
                },
            });

            transition.update(0.25);
            expect(transition.progress).toBeCloseTo(0.5);

            transition.update(0.25);
            expect(transition.progress).toBe(1);
            expect(completed).toBe(1);
        });
    });

    describe("custom", () => {
        it("should report eased progress and complete", () => {
            const from = createScene();
            const to = createScene();
            const progressValues: number[] = [];
            let completed = 0;

            const transition = SceneTransition2D.custom({
                from,
                to,
                duration: 1,
                easing: Easing.SineInOut,
                onProgress: (t) => {
                    progressValues.push(t);
                },
                onComplete: () => {
                    completed++;
                },
            });

            transition.update(0.25);
            transition.update(0.25);
            transition.update(0.5);

            expect(progressValues.length).toBe(3);
            expect(progressValues[0]).toBeCloseTo(Easing.SineInOut(0.25));
            expect(progressValues[1]).toBeCloseTo(Easing.SineInOut(0.5));
            expect(progressValues[2]).toBeCloseTo(1);
            expect(transition.progress).toBe(1);
            expect(completed).toBe(1);
        });

        it("should cancel custom transitions without completing", () => {
            const from = createScene();
            const to = createScene();
            let completed = 0;

            const transition = SceneTransition2D.custom({
                from,
                to,
                duration: 1,
                onProgress: () => {},
                onComplete: () => {
                    completed++;
                },
            });

            transition.update(0.1);
            transition.cancel();
            transition.update(1);

            expect(transition.progress).toBeCloseTo(0.1);
            expect(transition.isRunning).toBe(false);
            expect(completed).toBe(0);
        });
    });
});
