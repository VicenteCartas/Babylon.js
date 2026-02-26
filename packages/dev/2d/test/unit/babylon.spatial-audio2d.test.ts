import { SpatialAudio2D } from "2d/Audio/spatialAudio2D";
import { AbstractEngine } from "core/Engines/abstractEngine";
import { Vector3 } from "core/Maths/math.vector";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Minimal mock for AbstractEngine (instance only — static audioEngine set per-test). */
function createMockEngine(): any {
    return { __brand: "mockEngine" };
}

/** Mock AudioListener with modern positionX/Y/Z AudioParam-style API. */
function createModernListener(): any {
    return {
        positionX: { value: 0 },
        positionY: { value: 0 },
        positionZ: { value: 0 },
    };
}

/** Mock AudioListener with only the deprecated setPosition API. */
function createLegacyListener(): any {
    return {
        setPosition: jest.fn(),
    };
}

/** Mock audioContext wrapping a given listener. */
function createMockAudioContext(listener: any): any {
    return { listener };
}

/** Mock IAudioEngine wrapping a given audioContext. */
function createMockAudioEngine(audioContext: any): any {
    return { audioContext };
}

/**
 * Minimal Sound mock with a jest-fn setPosition.
 * Because SpatialAudio2D reuses a single internal Vector3, we snapshot
 * the x/y/z values at call-time so later mutations don't affect captured args.
 */
function createMockSound(): any {
    const calls: Array<{ x: number; y: number; z: number }> = [];
    const setPosition = jest.fn((v: Vector3) => {
        calls.push({ x: v.x, y: v.y, z: v.z });
    });
    return { setPosition, capturedPositions: calls };
}

/** Minimal Camera2D mock. */
function createMockCamera(x: number, y: number): any {
    return { position: { x, y } };
}

/** Minimal Node2D mock. */
function createMockNode(x: number, y: number): any {
    return { worldPosition: { x, y } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SpatialAudio2D", () => {
    /** Restore the static audioEngine after every test so tests stay isolated. */
    const originalAudioEngine = AbstractEngine.audioEngine;

    afterEach(() => {
        AbstractEngine.audioEngine = originalAudioEngine;
    });

    // -----------------------------------------------------------------------
    // 1. Constructor stores engine reference, `engine` getter works
    // -----------------------------------------------------------------------
    describe("constructor / engine getter", () => {
        it("should store and return the engine reference", () => {
            const engine = createMockEngine();
            const spatial = new SpatialAudio2D(engine);

            expect(spatial.engine).toBe(engine);
        });
    });

    // -----------------------------------------------------------------------
    // 2. attachmentCount starts at 0
    // -----------------------------------------------------------------------
    describe("attachmentCount", () => {
        it("should start at 0", () => {
            const spatial = new SpatialAudio2D(createMockEngine());

            expect(spatial.attachmentCount).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // 3. setSoundPosition calls sound.setPosition with correct Vector3
    // -----------------------------------------------------------------------
    describe("setSoundPosition", () => {
        it("should call sound.setPosition with Vector3(x, y, 0)", () => {
            const spatial = new SpatialAudio2D(createMockEngine());
            const sound = createMockSound();

            spatial.setSoundPosition(sound, 42, 99);

            expect(sound.setPosition).toHaveBeenCalledTimes(1);
            expect(sound.capturedPositions[0]).toEqual({ x: 42, y: 99, z: 0 });
        });

        it("should handle negative coordinates", () => {
            const spatial = new SpatialAudio2D(createMockEngine());
            const sound = createMockSound();

            spatial.setSoundPosition(sound, -10, -20);

            expect(sound.capturedPositions[0]).toEqual({ x: -10, y: -20, z: 0 });
        });

        it("should handle zero coordinates", () => {
            const spatial = new SpatialAudio2D(createMockEngine());
            const sound = createMockSound();

            spatial.setSoundPosition(sound, 0, 0);

            expect(sound.capturedPositions[0]).toEqual({ x: 0, y: 0, z: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // 4. attachToNode increases attachmentCount
    // -----------------------------------------------------------------------
    describe("attachToNode", () => {
        it("should increase attachmentCount", () => {
            const spatial = new SpatialAudio2D(createMockEngine());
            const sound1 = createMockSound();
            const sound2 = createMockSound();
            const node = createMockNode(0, 0);

            spatial.attachToNode(sound1, node);
            expect(spatial.attachmentCount).toBe(1);

            spatial.attachToNode(sound2, node);
            expect(spatial.attachmentCount).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // 5. detachFromNode decreases attachmentCount
    // -----------------------------------------------------------------------
    describe("detachFromNode", () => {
        it("should decrease attachmentCount", () => {
            const spatial = new SpatialAudio2D(createMockEngine());
            const sound = createMockSound();
            const node = createMockNode(0, 0);

            spatial.attachToNode(sound, node);
            expect(spatial.attachmentCount).toBe(1);

            spatial.detachFromNode(sound);
            expect(spatial.attachmentCount).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // 6. detachFromNode on untracked sound is a no-op
    // -----------------------------------------------------------------------
    describe("detachFromNode (untracked)", () => {
        it("should be a no-op for a sound that was never attached", () => {
            const spatial = new SpatialAudio2D(createMockEngine());
            const sound = createMockSound();

            // Should not throw
            spatial.detachFromNode(sound);
            expect(spatial.attachmentCount).toBe(0);
        });

        it("should be a no-op when called twice for the same sound", () => {
            const spatial = new SpatialAudio2D(createMockEngine());
            const sound = createMockSound();
            const node = createMockNode(0, 0);

            spatial.attachToNode(sound, node);
            spatial.detachFromNode(sound);
            spatial.detachFromNode(sound); // second call

            expect(spatial.attachmentCount).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // 7. update(camera) sets listener position to (camera.x, camera.y, 0)
    // -----------------------------------------------------------------------
    describe("update — listener position (modern API)", () => {
        it("should set positionX/Y/Z values from camera position", () => {
            const listener = createModernListener();
            const audioCtx = createMockAudioContext(listener);
            AbstractEngine.audioEngine = createMockAudioEngine(audioCtx);

            const spatial = new SpatialAudio2D(createMockEngine());
            const camera = createMockCamera(100, 200);

            spatial.update(camera);

            expect(listener.positionX.value).toBe(100);
            expect(listener.positionY.value).toBe(200);
            expect(listener.positionZ.value).toBe(0);
        });
    });

    describe("update — listener position (legacy API)", () => {
        it("should call listener.setPosition when positionX is undefined", () => {
            const listener = createLegacyListener();
            const audioCtx = createMockAudioContext(listener);
            AbstractEngine.audioEngine = createMockAudioEngine(audioCtx);

            const spatial = new SpatialAudio2D(createMockEngine());
            const camera = createMockCamera(50, 75);

            spatial.update(camera);

            expect(listener.setPosition).toHaveBeenCalledWith(50, 75, 0);
        });
    });

    // -----------------------------------------------------------------------
    // 8. update(camera) syncs all attached sound positions from node worldPosition
    // -----------------------------------------------------------------------
    describe("update — attached sound sync", () => {
        it("should set each attached sound's position from its node worldPosition", () => {
            const listener = createModernListener();
            AbstractEngine.audioEngine = createMockAudioEngine(createMockAudioContext(listener));

            const spatial = new SpatialAudio2D(createMockEngine());

            const soundA = createMockSound();
            const nodeA = createMockNode(10, 20);
            const soundB = createMockSound();
            const nodeB = createMockNode(30, 40);

            spatial.attachToNode(soundA, nodeA);
            spatial.attachToNode(soundB, nodeB);

            const camera = createMockCamera(0, 0);
            spatial.update(camera);

            // soundA → nodeA worldPosition (10, 20)
            expect(soundA.setPosition).toHaveBeenCalledTimes(1);
            expect(soundA.capturedPositions[0]).toEqual({ x: 10, y: 20, z: 0 });

            // soundB → nodeB worldPosition (30, 40)
            expect(soundB.setPosition).toHaveBeenCalledTimes(1);
            expect(soundB.capturedPositions[0]).toEqual({ x: 30, y: 40, z: 0 });
        });

        it("should reflect node worldPosition changes on subsequent updates", () => {
            const listener = createModernListener();
            AbstractEngine.audioEngine = createMockAudioEngine(createMockAudioContext(listener));

            const spatial = new SpatialAudio2D(createMockEngine());
            const sound = createMockSound();
            const node = createMockNode(1, 2);

            spatial.attachToNode(sound, node);

            spatial.update(createMockCamera(0, 0));
            expect(sound.capturedPositions[0]).toEqual({ x: 1, y: 2, z: 0 });

            // Move the node
            node.worldPosition.x = 100;
            node.worldPosition.y = 200;

            spatial.update(createMockCamera(0, 0));
            expect(sound.capturedPositions[1]).toEqual({ x: 100, y: 200, z: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // 9. dispose() clears all attachments (count goes to 0)
    // -----------------------------------------------------------------------
    describe("dispose", () => {
        it("should clear all attachments", () => {
            const spatial = new SpatialAudio2D(createMockEngine());

            spatial.attachToNode(createMockSound(), createMockNode(0, 0));
            spatial.attachToNode(createMockSound(), createMockNode(1, 1));
            spatial.attachToNode(createMockSound(), createMockNode(2, 2));
            expect(spatial.attachmentCount).toBe(3);

            spatial.dispose();
            expect(spatial.attachmentCount).toBe(0);
        });

        it("should not throw when called with no attachments", () => {
            const spatial = new SpatialAudio2D(createMockEngine());

            expect(() => spatial.dispose()).not.toThrow();
            expect(spatial.attachmentCount).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // 10. Graceful behavior when audioEngine is null (no crash)
    // -----------------------------------------------------------------------
    describe("update — null audioEngine", () => {
        it("should not throw when AbstractEngine.audioEngine is null", () => {
            AbstractEngine.audioEngine = null;

            const spatial = new SpatialAudio2D(createMockEngine());
            const camera = createMockCamera(10, 20);

            expect(() => spatial.update(camera)).not.toThrow();
        });

        it("should not throw when AbstractEngine.audioEngine is undefined", () => {
            (AbstractEngine as any).audioEngine = undefined;

            const spatial = new SpatialAudio2D(createMockEngine());
            const camera = createMockCamera(10, 20);

            expect(() => spatial.update(camera)).not.toThrow();
        });
    });

    // -----------------------------------------------------------------------
    // 11. Graceful behavior when audioContext is null (no crash)
    // -----------------------------------------------------------------------
    describe("update — null audioContext", () => {
        it("should not throw when audioContext is null", () => {
            AbstractEngine.audioEngine = createMockAudioEngine(null);

            const spatial = new SpatialAudio2D(createMockEngine());
            const camera = createMockCamera(10, 20);

            expect(() => spatial.update(camera)).not.toThrow();
        });

        it("should not throw when audioContext is undefined", () => {
            AbstractEngine.audioEngine = createMockAudioEngine(undefined);

            const spatial = new SpatialAudio2D(createMockEngine());
            const camera = createMockCamera(10, 20);

            expect(() => spatial.update(camera)).not.toThrow();
        });

        it("should still sync attached sound positions even without audioContext", () => {
            AbstractEngine.audioEngine = createMockAudioEngine(null);

            const spatial = new SpatialAudio2D(createMockEngine());
            const sound = createMockSound();
            const node = createMockNode(5, 10);
            spatial.attachToNode(sound, node);

            spatial.update(createMockCamera(0, 0));

            expect(sound.setPosition).toHaveBeenCalledTimes(1);
            expect(sound.capturedPositions[0]).toEqual({ x: 5, y: 10, z: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // 12. attachToNode with same sound replaces previous node
    // -----------------------------------------------------------------------
    describe("attachToNode — replacement", () => {
        it("should replace previous node when same sound is re-attached", () => {
            const spatial = new SpatialAudio2D(createMockEngine());
            const sound = createMockSound();
            const nodeA = createMockNode(10, 20);
            const nodeB = createMockNode(30, 40);

            spatial.attachToNode(sound, nodeA);
            expect(spatial.attachmentCount).toBe(1);

            spatial.attachToNode(sound, nodeB);
            expect(spatial.attachmentCount).toBe(1); // count unchanged, not 2

            // Verify update uses the new node
            const listener = createModernListener();
            AbstractEngine.audioEngine = createMockAudioEngine(createMockAudioContext(listener));
            spatial.update(createMockCamera(0, 0));

            expect(sound.capturedPositions[0]).toEqual({ x: 30, y: 40, z: 0 });
        });
    });
});
