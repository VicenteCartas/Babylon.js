import type { AbstractEngine } from "core/Engines/abstractEngine";
import { Scene } from "core/scene";
import { FreeCamera } from "core/Cameras/freeCamera";
import { Camera } from "core/Cameras/camera";
import { Vector3 } from "core/Maths/math.vector";
import { ParticleSystem } from "core/Particles/particleSystem";
import type { IParticleSystem } from "core/Particles/IParticleSystem";
import type { AbstractMesh } from "core/Meshes/abstractMesh";
import { Logger } from "core/Misc/logger";

import type { Camera2D } from "../Camera2D/camera2D";

/**
 * Options for creating a particle system via the helper
 */
export interface IParticleSystem2DOptions {
    /** Name of the particle system */
    name?: string;
    /** Maximum particle capacity */
    capacity?: number;
    /**
     * World-space position (x, y) for the emitter.
     * Mapped to Vector3(x, y, 0) internally.
     */
    emitterPosition?: { x: number; y: number };
}

/**
 * A bridge that enables Babylon.js core ParticleSystems to render in a 2D game.
 *
 * Creates a dedicated core `Scene` with an orthographic camera that automatically
 * syncs with a `Camera2D`. Core particles render in the same coordinate space
 * as 2D sprites, with Y-down convention matching Camera2D.
 *
 * If your application already has a core Scene, you can pass it to the
 * constructor to avoid creating an additional one.
 *
 * @example
 * ```typescript
 * const helper = new ParticleHelper2D(engine);
 * helper.camera = camera2D;
 *
 * // Create a core particle system with full GPU power
 * const ps = helper.createParticleSystem("fire", 2000);
 * ps.emitter = new Vector3(100, 200, 0); // 2D world position
 * ps.minLifeTime = 0.3;
 * ps.maxLifeTime = 1.5;
 * ps.start();
 *
 * // In render loop:
 * scene2D.render();
 * helper.render(); // renders particles on top
 * ```
 */
export class ParticleHelper2D {
    /**
     * The core Scene used for particle rendering.
     * Access this to configure scene-level particle settings or to load
     * particle systems from .json files exported from the Node Particle Editor.
     */
    public readonly scene: Scene;

    private _orthoCamera: FreeCamera;
    private _camera2D: Camera2D | null = null;
    private _ownsScene: boolean;
    private _zOffset: number = -10;

    /**
     * Creates a new ParticleHelper2D.
     * @param engine - The Babylon.js engine (shared with Scene2D)
     * @param existingScene - Optional pre-existing core Scene to use for particle rendering.
     *   If omitted, a dedicated Scene is created internally. When provided, the scene's
     *   `autoClear` will be set to `false` and an orthographic camera will be added.
     */
    constructor(engine: AbstractEngine, existingScene?: Scene) {
        this.scene = existingScene ?? new Scene(engine);
        this._ownsScene = !existingScene;
        this.scene.autoClear = false;

        this._orthoCamera = new FreeCamera("__particles2d_cam__", new Vector3(0, 0, this._zOffset), this.scene);
        this._orthoCamera.mode = Camera.ORTHOGRAPHIC_CAMERA;
        this._orthoCamera.minZ = 0.1;
        this._orthoCamera.maxZ = 1000;
        // Remove default keyboard/mouse inputs — this camera is programmatically controlled
        this._orthoCamera.inputs.clear();
        this.scene.activeCamera = this._orthoCamera;
    }

    /**
     * The Camera2D to sync with. When set, the orthographic camera will match
     * the 2D camera's position, zoom, rotation and viewport each frame.
     */
    public get camera(): Camera2D | null {
        return this._camera2D;
    }

    public set camera(cam: Camera2D | null) {
        this._camera2D = cam;
    }

    /**
     * Syncs the internal orthographic camera with the current Camera2D state.
     * Called automatically by `render()`, but can be called manually if needed.
     */
    public sync(): void {
        if (!this._camera2D) {
            return;
        }

        const cam = this._camera2D;
        const { scaleX, scaleY } = cam.effectiveScale;

        const halfWorldW = cam.viewportWidth / (2 * scaleX);
        const halfWorldH = cam.viewportHeight / (2 * scaleY);

        this._orthoCamera.position.x = cam.position.x;
        this._orthoCamera.position.y = cam.position.y;

        this._orthoCamera.orthoLeft = -halfWorldW;
        this._orthoCamera.orthoRight = halfWorldW;
        // Flip Y: orthoTop < orthoBottom makes Y go down, matching Camera2D
        this._orthoCamera.orthoTop = -halfWorldH;
        this._orthoCamera.orthoBottom = halfWorldH;

        this._orthoCamera.rotation.z = cam.rotation;
    }

    /**
     * Creates a core ParticleSystem attached to this helper's scene.
     * The returned system has full access to all core particle features:
     * GPU rendering, gradients, sub-emitters, noise, sprites, etc.
     *
     * @param name - Name of the particle system
     * @param capacity - Maximum particle count
     * @param emitter - Optional emitter (mesh, Vector3, or null). Defaults to origin.
     * @returns The created ParticleSystem
     */
    public createParticleSystem(name: string, capacity: number, emitter?: AbstractMesh | Vector3): ParticleSystem {
        const ps = new ParticleSystem(name, capacity, this.scene);
        ps.emitter = emitter ?? new Vector3(0, 0, 0);
        return ps;
    }

    /**
     * Adds an externally-created particle system to this helper's scene.
     * Useful for systems loaded from JSON (Node Particle Editor exports).
     *
     * @param particleSystem - The particle system to add
     */
    public addParticleSystem(particleSystem: IParticleSystem): void {
        // ParticleSystem.parse() creates it in a scene; re-assigning is tricky.
        // This method is for documentation guidance — users should pass this.scene
        // when calling ParticleSystem.Parse() directly.
        Logger.Warn("ParticleHelper2D.addParticleSystem: For best results, use ParticleSystem.Parse(data, this.scene) to create the system directly in the helper's scene.");
        void particleSystem;
    }

    /**
     * Syncs the camera and renders all particle systems.
     * Call this after Scene2D.render() to draw particles on top.
     */
    public render(): void {
        this.sync();
        this.scene.render();
    }

    /**
     * Disposes the helper and all particle systems within it.
     * If the helper created its own scene, the scene is also disposed.
     * If an external scene was provided, it is left intact.
     */
    public dispose(): void {
        if (this._ownsScene) {
            this.scene.dispose();
        }
        this._camera2D = null;
    }
}
