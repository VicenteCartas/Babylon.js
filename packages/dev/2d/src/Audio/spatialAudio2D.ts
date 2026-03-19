import { Vector3 } from "core/Maths/math.vector";
import { AbstractEngine } from "core/Engines/abstractEngine";
import type { Sound } from "core/Audio/sound";

import type { Camera2D } from "../Camera2D/camera2D";
import type { Node2D } from "../Node2D/node2D";

/**
 * Lightweight utility that maps 2D world positions to 3D coordinates
 * for the Web Audio API spatial listener and AudioV2 Sound positions.
 *
 * This class does **not** create or manage sounds — users create sounds
 * with AudioV2 directly (`new Sound(...)`) and manage volume through
 * AudioV2's `SoundTrack` / `AudioBus`. `SpatialAudio2D` only handles:
 *
 * - Syncing the Web Audio listener with a {@link Camera2D}
 * - Positioning sounds at 2D world coordinates (mapped to `(x, y, 0)`)
 * - Auto-tracking sounds attached to {@link Node2D} instances
 *
 * Note: The Web Audio listener is a global singleton — only one
 * `SpatialAudio2D` instance should call {@link update} per frame.
 *
 * @example
 * ```typescript
 * const spatial = new SpatialAudio2D(engine);
 *
 * // Position a sound manually
 * spatial.setSoundPosition(explosionSound, 400, 300);
 *
 * // Attach a sound to follow a node
 * spatial.attachToNode(engineSound, spaceship);
 *
 * // Each frame, sync listener + tracked sounds
 * spatial.update(camera);
 *
 * // Clean up when done
 * spatial.dispose();
 * ```
 */
export class SpatialAudio2D {
    private _engine: AbstractEngine;
    private _attachments: Map<Sound, Node2D> = new Map();
    private _isDisposed: boolean = false;

    // Reusable Vector3 to avoid per-frame allocations
    private _tempVector3: Vector3 = Vector3.Zero();

    /**
     * Creates a new SpatialAudio2D utility.
     * @param engine - The AbstractEngine used to access the audio context
     */
    constructor(engine: AbstractEngine) {
        this._engine = engine;
    }

    /**
     * Gets the engine associated with this spatial audio instance.
     * @returns The AbstractEngine
     */
    public get engine(): AbstractEngine {
        return this._engine;
    }

    /**
     * Gets the number of currently tracked sound-to-node attachments.
     * @returns The attachment count
     */
    public get attachmentCount(): number {
        return this._attachments.size;
    }

    /**
     * Whether this instance has been disposed.
     * @returns True when dispose() has been called.
     */
    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    /**
     * Updates the audio listener position from the given camera and
     * syncs all node-attached sound positions. Call once per frame.
     * @param camera - The Camera2D whose position drives the audio listener, or null to keep the listener at the origin
     * @returns Nothing.
     */
    public update(camera: Camera2D | null): void {
        if (this._isDisposed) {
            return;
        }
        if (camera) {
            this._updateListenerPosition(camera.position.x, camera.position.y);
        } else {
            this._updateListenerPosition(0, 0);
        }

        for (const [sound, node] of this._attachments) {
            const wp = node.worldPosition;
            this._setSoundPosition3D(sound, wp.x, wp.y);
        }
    }

    /**
     * Sets the 3D position of a spatial sound from 2D coordinates.
     * Maps `(x, y)` to `(x, y, 0)` in 3D space.
     * The sound must have `spatialSound` enabled for this to take effect.
     * @param sound - An AudioV2 Sound with spatial audio enabled
     * @param x - X position in 2D world space
     * @param y - Y position in 2D world space
     * @returns Nothing.
     */
    public setSoundPosition(sound: Sound, x: number, y: number): void {
        this._setSoundPosition3D(sound, x, y);
    }

    /**
     * Registers a sound to automatically follow a Node2D's world position.
     * The position is synced each time {@link update} is called.
     * If the sound was already attached to a different node, the
     * previous attachment is replaced.
     * @param sound - An AudioV2 Sound with spatial audio enabled
     * @param node - The Node2D whose world position the sound will track
     * @returns Nothing.
     */
    public attachToNode(sound: Sound, node: Node2D): void {
        this._attachments.set(sound, node);
    }

    /**
     * Removes a sound from automatic Node2D position tracking.
     * Does nothing if the sound is not currently attached.
     * @param sound - The Sound to stop tracking
     * @returns Nothing.
     */
    public detachFromNode(sound: Sound): void {
        this._attachments.delete(sound);
    }

    /**
     * Clears all node attachments and releases references.
     * @returns Nothing.
     */
    public dispose(): void {
        if (this._isDisposed) {
            return;
        }
        this._attachments.clear();
        this._isDisposed = true;
    }

    /**
     * Sets a sound's 3D position using the reusable Vector3 to avoid
     * per-frame allocations.
     * @param sound - The sound to position
     * @param x - X coordinate
     * @param y - Y coordinate
     * @returns Nothing.
     */
    private _setSoundPosition3D(sound: Sound, x: number, y: number): void {
        this._tempVector3.x = x;
        this._tempVector3.y = y;
        this._tempVector3.z = 0;
        sound.setPosition(this._tempVector3);
    }

    /**
     * Updates the Web Audio API listener position from 2D coordinates.
     * Maps `(x, y)` to `(x, y, 10)` in listener space so the listener sits
     * slightly in front of the 2D plane for spatial panning.
     * @param x - Listener X coordinate in 2D world space
     * @param y - Listener Y coordinate in 2D world space
     * @returns Nothing.
     */
    private _updateListenerPosition(x: number, y: number): void {
        const audioEngine = AbstractEngine.audioEngine;
        if (!audioEngine) {
            return;
        }

        const audioContext = audioEngine.audioContext;
        if (!audioContext) {
            return;
        }

        const listener = audioContext.listener;

        // Prefer AudioParam-based API (modern browsers)
        if (listener.positionX !== undefined) {
            listener.positionX.value = x;
            listener.positionY.value = y;
            listener.positionZ.value = 10;
        } else {
            // Fallback to deprecated setPosition for older browsers
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            listener.setPosition(x, y, 10);
        }
    }
}
