import { Camera2D } from "2d/Camera2D/camera2D";
import { Vector2 } from "core/Maths/math.vector";

// ParticleHelper2D requires a real core Scene + FreeCamera which need a full engine.
// We test the sync math and Camera2D.effectiveScale getter independently.
// Integration tests with a real engine belong in the devHost demos.

describe("Camera2D.effectiveScale", () => {
    it("should return zoom when no design resolution set", () => {
        const cam = new Camera2D();
        cam.zoom = 2;
        const scale = cam.effectiveScale;
        expect(scale.scaleX).toBe(2);
        expect(scale.scaleY).toBe(2);
    });

    it("should return 1 when zoom is 1 and no design resolution", () => {
        const cam = new Camera2D();
        const scale = cam.effectiveScale;
        expect(scale.scaleX).toBe(1);
        expect(scale.scaleY).toBe(1);
    });

    it("should combine design resolution FIT scale with zoom", () => {
        const cam = new Camera2D();
        cam.setViewport(1920, 1080);
        cam.setDesignResolution(960, 540); // 2x scale
        cam.zoom = 1;
        const scale = cam.effectiveScale;
        expect(scale.scaleX).toBe(2);
        expect(scale.scaleY).toBe(2);
    });

    it("should multiply zoom on top of design scale", () => {
        const cam = new Camera2D();
        cam.setViewport(1920, 1080);
        cam.setDesignResolution(960, 540); // 2x base
        cam.zoom = 3;
        const scale = cam.effectiveScale;
        expect(scale.scaleX).toBe(6);
        expect(scale.scaleY).toBe(6);
    });
});

describe("ParticleHelper2D sync math", () => {
    // Test the ortho-camera sync math in isolation by computing expected values
    it("should compute correct ortho bounds from Camera2D state", () => {
        const cam = new Camera2D();
        cam.setViewport(800, 600);
        cam.zoom = 1;
        cam.position = new Vector2(100, 200);

        const { scaleX, scaleY } = cam.effectiveScale;
        const halfWorldW = cam.viewportWidth / (2 * scaleX);
        const halfWorldH = cam.viewportHeight / (2 * scaleY);

        // At zoom=1, no design resolution: half-world = half-viewport
        expect(halfWorldW).toBe(400);
        expect(halfWorldH).toBe(300);

        // Expected ortho bounds (Y-flipped for Y-down)
        expect(-halfWorldW).toBe(-400);  // orthoLeft
        expect(halfWorldW).toBe(400);    // orthoRight
        expect(-halfWorldH).toBe(-300);  // orthoTop (flipped)
        expect(halfWorldH).toBe(300);    // orthoBottom (flipped)
    });

    it("should compute correct ortho bounds with zoom", () => {
        const cam = new Camera2D();
        cam.setViewport(800, 600);
        cam.zoom = 2;

        const { scaleX, scaleY } = cam.effectiveScale;
        const halfWorldW = cam.viewportWidth / (2 * scaleX);
        const halfWorldH = cam.viewportHeight / (2 * scaleY);

        // At zoom=2: visible world halved
        expect(halfWorldW).toBe(200);
        expect(halfWorldH).toBe(150);
    });

    it("should compute correct ortho bounds with design resolution", () => {
        const cam = new Camera2D();
        cam.setViewport(1920, 1080);
        cam.setDesignResolution(480, 270); // 4x FIT scale
        cam.zoom = 1;

        const { scaleX, scaleY } = cam.effectiveScale;
        const halfWorldW = cam.viewportWidth / (2 * scaleX);
        const halfWorldH = cam.viewportHeight / (2 * scaleY);

        // Design is 480x270, so visible world half = 240x135
        expect(halfWorldW).toBe(240);
        expect(halfWorldH).toBe(135);
    });
});
