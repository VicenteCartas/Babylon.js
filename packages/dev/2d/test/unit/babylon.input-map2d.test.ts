/**
 * @jest-environment jsdom
 */

import { InputMap2D } from "2d/Input/inputMap2D";
import { Camera2D } from "2d/Camera2D/camera2D";
import { Vector2 } from "core/Maths/math.vector";
import { Observable } from "core/Misc/observable";

// Minimal engine mock satisfying DeviceSourceManager initialization
function createMockEngine(canvas: HTMLCanvasElement) {
    return {
        getRenderingCanvas: () => canvas,
        getInputElement: () => canvas,
        _deviceSourceManager: null,
        _onEngineViewChanged: null,
        onDisposeObservable: new Observable(),
        onEndFrameObservable: new Observable(),
        canvasTabIndex: 1,
        _creationOptions: {},
    } as any;
}

describe("InputMap2D", () => {
    let canvas: HTMLCanvasElement;
    let input: InputMap2D;

    beforeEach(() => {
        canvas = document.createElement("canvas");
        canvas.width = 800;
        canvas.height = 600;
        canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => {} });
        const engine = createMockEngine(canvas);
        input = new InputMap2D(engine);
    });

    afterEach(() => {
        input.dispose();
    });

    describe("keyboard actions", () => {
        beforeEach(() => {
            input.defineAction("jump", { type: "key", key: "Space" });
        });

        it("should detect key press on first frame", () => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
            input.update();
            expect(input.isActionPressed("jump")).toBe(true);
            expect(input.isActionDown("jump")).toBe(true);
        });

        it("should not report pressed on subsequent frames", () => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
            input.update();
            expect(input.isActionPressed("jump")).toBe(true);
            input.update();
            expect(input.isActionPressed("jump")).toBe(false);
            expect(input.isActionDown("jump")).toBe(true);
        });

        it("should detect key release", () => {
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
            input.update();
            window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
            input.update();
            expect(input.isActionReleased("jump")).toBe(true);
            expect(input.isActionDown("jump")).toBe(false);
        });

        it("should support multiple bindings", () => {
            input.defineAction("fire", { type: "key", key: "KeyF" }, { type: "key", key: "Enter" });
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter" }));
            input.update();
            expect(input.isActionPressed("fire")).toBe(true);
        });
    });

    describe("pointer position", () => {
        it("should return screen position as world position when no camera", () => {
            const world = input.pointerWorldPosition;
            // No events fired, position should be at origin
            expect(world.x).toBe(0);
            expect(world.y).toBe(0);
        });

        it("should convert to world position using camera", () => {
            const camera = new Camera2D();
            camera.setViewport(800, 600);
            camera.position = new Vector2(400, 300);
            input.camera = camera;

            // Screen center (400,300) should map to camera position (400,300)
            const world = camera.screenToWorld(new Vector2(400, 300));
            expect(world.x).toBeCloseTo(400);
            expect(world.y).toBeCloseTo(300);
        });
    });

    describe("undefined actions", () => {
        it("should return false for undefined action names", () => {
            input.update();
            expect(input.isActionDown("nonexistent")).toBe(false);
            expect(input.isActionPressed("nonexistent")).toBe(false);
            expect(input.isActionReleased("nonexistent")).toBe(false);
        });

        it("should return 0 for undefined axis", () => {
            expect(input.getAxis("nonexistent")).toBe(0);
        });
    });

    describe("getAxis", () => {
        it("should return 1 when digital key binding is down", () => {
            input.defineAction("moveRight", { type: "key", key: "ArrowRight" });
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));
            input.update();
            expect(input.getAxis("moveRight")).toBe(1);
        });

        it("should return 0 when digital key binding is up", () => {
            input.defineAction("moveRight", { type: "key", key: "ArrowRight" });
            input.update();
            expect(input.getAxis("moveRight")).toBe(0);
        });
    });

    describe("dispose", () => {
        it("should prevent further keyboard event handling", () => {
            input.defineAction("jump", { type: "key", key: "Space" });
            input.dispose();
            window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
            input.update();
            expect(input.isActionPressed("jump")).toBe(false);
        });
    });
});
