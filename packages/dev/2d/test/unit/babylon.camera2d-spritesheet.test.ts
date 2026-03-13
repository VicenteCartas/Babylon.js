import { Camera2D, ScaleMode } from "2d/Camera2D/camera2D";
import { Node2D } from "2d/Node2D/node2D";
import { Rectangle2D } from "2d/Math/rectangle2D";
import { Vector2 } from "core/Maths/math.vector";

describe("Camera2D", () => {
    let camera: Camera2D;

    beforeEach(() => {
        camera = new Camera2D();
        camera.setViewport(800, 600);
    });

    it("should initialize with default values", () => {
        expect(camera.position.x).toBe(0);
        expect(camera.position.y).toBe(0);
        expect(camera.zoom).toBe(1);
        expect(camera.rotation).toBe(0);
    });

    it("should convert screen to world and back", () => {
        camera.position = new Vector2(200, 100);

        const worldPos = camera.screenToWorld(new Vector2(400, 300)); // center of viewport
        expect(worldPos.x).toBeCloseTo(200, 1);
        expect(worldPos.y).toBeCloseTo(100, 1);

        const screenPos = camera.worldToScreen(new Vector2(200, 100));
        expect(screenPos.x).toBeCloseTo(400, 1); // viewport center
        expect(screenPos.y).toBeCloseTo(300, 1);
    });

    it("should zoom correctly", () => {
        camera.position = new Vector2(0, 0);
        camera.zoom = 2;

        // At 2x zoom, the viewport center (400,300) should map to camera position (0,0)
        const worldPos = camera.screenToWorld(new Vector2(400, 300));
        expect(worldPos.x).toBeCloseTo(0, 1);
        expect(worldPos.y).toBeCloseTo(0, 1);

        // Top-left of screen should be closer to center at higher zoom
        const topLeft = camera.screenToWorld(new Vector2(0, 0));
        expect(topLeft.x).toBeCloseTo(-200, 1); // half viewport / zoom
        expect(topLeft.y).toBeCloseTo(-150, 1);
    });

    it("should follow a target instantly when lerpSpeed is 0", () => {
        const target = new Node2D("target");
        target.position = new Vector2(500, 300);

        camera.lockedTarget = target;
        camera.lerpSpeed = 0;
        camera.update(0.016);

        expect(camera.position.x).toBeCloseTo(500, 1);
        expect(camera.position.y).toBeCloseTo(300, 1);
    });

    it("should follow a target smoothly when lerpSpeed > 0", () => {
        const target = new Node2D("target");
        target.position = new Vector2(500, 300);

        camera.lockedTarget = target;
        camera.lerpSpeed = 0.1;
        camera.update(0.016);

        // Should move toward target but not reach it
        expect(camera.position.x).toBeGreaterThan(0);
        expect(camera.position.x).toBeLessThan(500);
    });

    it("should clamp to bounds", () => {
        camera.bounds = new Rectangle2D(0, 0, 1000, 1000);
        camera.position = new Vector2(-100, -100);
        camera.update(0.016);

        // Camera center should be at least half viewport from bounds edges
        expect(camera.position.x).toBeGreaterThanOrEqual(400); // 800/2
        expect(camera.position.y).toBeGreaterThanOrEqual(300); // 600/2
    });

    it("should apply follow offset", () => {
        const target = new Node2D("target");
        target.position = new Vector2(100, 100);

        camera.lockedTarget = target;
        camera.followOffset = new Vector2(50, -30);
        camera.lerpSpeed = 0;
        camera.update(0.016);

        expect(camera.position.x).toBeCloseTo(150, 1);
        expect(camera.position.y).toBeCloseTo(70, 1);
    });

    it("should keep the camera still while the target remains inside the dead zone", () => {
        const target = new Node2D("target");
        camera.lockedTarget = target;
        camera.deadZone = new Rectangle2D(-50, -25, 100, 50);

        target.position = new Vector2(20, 10);
        camera.update(0.016);
        expect(camera.position.x).toBeCloseTo(0);
        expect(camera.position.y).toBeCloseTo(0);

        target.position = new Vector2(90, 10);
        camera.update(0.016);
        expect(camera.position.x).toBeCloseTo(40);
        expect(camera.position.y).toBeCloseTo(0);
    });

    it("should apply look-ahead in the target movement direction", () => {
        const target = new Node2D("target");
        camera.lockedTarget = target;
        camera.lerpSpeed = 0;
        camera.lookAheadDistance = 50;
        camera.lookAheadLerpSpeed = 0;

        target.position = new Vector2(0, 0);
        camera.update(0.016);
        expect(camera.position.x).toBeCloseTo(0);

        target.position = new Vector2(100, 0);
        camera.update(1);
        expect(camera.position.x).toBeCloseTo(150);
        expect(camera.position.y).toBeCloseTo(0);
    });

    it("should support integer design resolution scaling", () => {
        camera.setDesignResolution(320, 180, ScaleMode.INTEGER_SCALE);
        camera.update(0, 1000, 700);

        expect(camera.hasDesignResolution).toBe(true);
        expect(camera.effectiveScale.scaleX).toBe(3);
        expect(camera.effectiveScale.scaleY).toBe(3);
    });

    it("should clear the design resolution state", () => {
        camera.setDesignResolution(320, 180, ScaleMode.FIT);
        expect(camera.hasDesignResolution).toBe(true);

        camera.clearDesignResolution();
        expect(camera.hasDesignResolution).toBe(false);
        expect(camera.effectiveScale.scaleX).toBe(1);
        expect(camera.effectiveScale.scaleY).toBe(1);
    });

    it("should support zero-allocation coordinate conversion overloads", () => {
        camera.position = new Vector2(120, 80);

        const worldOut = new Vector2(-1, -1);
        const worldResult = camera.screenToWorld(new Vector2(400, 300), worldOut);
        expect(worldResult).toBe(worldOut);
        expect(worldOut.x).toBeCloseTo(120);
        expect(worldOut.y).toBeCloseTo(80);

        const screenOut = new Vector2(-1, -1);
        const screenResult = camera.worldToScreen(new Vector2(120, 80), screenOut);
        expect(screenResult).toBe(screenOut);
        expect(screenOut.x).toBeCloseTo(400);
        expect(screenOut.y).toBeCloseTo(300);
    });

    it("should expose shake lifecycle helpers", () => {
        camera.shake(8, 0.5, () => 0.5);
        expect(camera.isShaking).toBe(true);

        camera.stopShake();
        expect(camera.isShaking).toBe(false);
    });
});

describe("SpriteSheet and AnimatedSprite2D", () => {
    it("should define and retrieve animations from SpriteSheet", () => {
        // SpriteSheet needs a texture, but we can test the animation definitions
        // without actually rendering by using the API directly
        const { SpriteSheet } = require("2d/SpriteSheet/spriteSheet");

        // Create a mock texture with getSize
        const mockTexture = { getSize: () => ({ width: 128, height: 128 }) };
        const sheet = SpriteSheet.FromGrid(mockTexture, 32, 32);

        expect(sheet.frameCount).toBe(16); // 4x4 grid

        sheet.defineAnimation("walk", [0, 1, 2, 3], 10);
        sheet.defineAnimation("idle", [4, 5], 5);

        expect(sheet.getAnimationNames()).toContain("walk");
        expect(sheet.getAnimationNames()).toContain("idle");

        const walk = sheet.getAnimation("walk");
        expect(walk).toBeDefined();
        expect(walk!.frames).toEqual([0, 1, 2, 3]);
        expect(walk!.frameRate).toBe(10);
    });

    it("should get correct frame rectangles from grid", () => {
        const { SpriteSheet } = require("2d/SpriteSheet/spriteSheet");
        const mockTexture = { getSize: () => ({ width: 128, height: 64 }) };
        const sheet = SpriteSheet.FromGrid(mockTexture, 32, 32);

        expect(sheet.frameCount).toBe(8); // 4 cols x 2 rows

        const frame0 = sheet.getFrame(0);
        expect(frame0.x).toBe(0);
        expect(frame0.y).toBe(0);
        expect(frame0.width).toBe(32);

        const frame5 = sheet.getFrame(5); // row 1, col 1
        expect(frame5.x).toBe(32);
        expect(frame5.y).toBe(32);
    });

    it("should return empty rectangle for out-of-bounds frame", () => {
        const { SpriteSheet } = require("2d/SpriteSheet/spriteSheet");
        const mockTexture = { getSize: () => ({ width: 64, height: 64 }) };
        const sheet = SpriteSheet.FromGrid(mockTexture, 32, 32);

        const frame = sheet.getFrame(99);
        expect(frame.width).toBe(0);
    });
});
