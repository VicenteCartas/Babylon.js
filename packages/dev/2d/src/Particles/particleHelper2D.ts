import type { AbstractEngine } from "core/Engines/abstractEngine";
import { Camera } from "core/Cameras/camera";
import { FreeCamera } from "core/Cameras/freeCamera";
import { Vector2, Vector3 } from "core/Maths/math.vector";
import { Mesh } from "core/Meshes/mesh";
import type { AbstractMesh } from "core/Meshes/abstractMesh";
import { Logger } from "core/Misc/logger";
import { ParticleHelper } from "core/Particles/particleHelper";
import type { IParticleSystem } from "core/Particles/IParticleSystem";
import { ParticleSystem } from "core/Particles/particleSystem";
import { Scene as CoreScene } from "core/scene";

import type { Camera2D } from "../Camera2D/camera2D";
import type { Node2D } from "../Node2D/node2D";

/**
 * Options for creating a 2D particle system.
 */
export interface IParticleSystem2DOptions {
    /** Name of the particle system. Default: "particles". */
    name?: string;
    /** Maximum particle capacity. Default: 2000. */
    capacity?: number;
    /** Initial emitter position in 2D world space. */
    emitterPosition?: { x: number; y: number };
    /** Texture URL for the particle texture. */
    textureUrl?: string;
}

/**
 * Bridges Babylon.js core GPU particle systems into a 2D game scene.
 *
 * Creates a dedicated core `Scene` with a synchronized orthographic camera.
 * Particles render in the same pixel coordinate space as the 2D scene.
 * Use `helper.render()` after `scene2D.render()` to composite particles on top.
 */
export class ParticleHelper2D {
    private static readonly _attachmentPositionScratch: Vector2 = Vector2.Zero();

    /**
     * The underlying core Scene used for particle rendering.
     */
    public readonly particleScene: CoreScene;

    /**
     * Sorting layer threshold reserved for future particle/sprite compositing control.
     * @returns The sorting-layer threshold value.
     */
    public renderSortingLayer: number = 3;

    private _orthoCamera: FreeCamera;
    private _camera: Camera2D | null = null;
    private _ownsScene: boolean;
    private _previousActiveCamera: Camera | null;
    private _previousAutoClear: boolean;
    private _managedSystems: Set<IParticleSystem> = new Set();
    private _attachments: Map<IParticleSystem, Node2D> = new Map();
    private _ownedEmitters: Map<IParticleSystem, Mesh> = new Map();

    /**
     * Creates a new ParticleHelper2D.
     * @param engine - The Babylon.js engine shared with Scene2D.
     * @param existingScene - Optional pre-existing core Scene to use for particle rendering.
     */
    constructor(engine: AbstractEngine, existingScene?: CoreScene) {
        this.particleScene = existingScene ?? new CoreScene(engine);
        this._ownsScene = !existingScene;
        this._previousActiveCamera = this.particleScene.activeCamera;
        this._previousAutoClear = this.particleScene.autoClear;
        this.particleScene.autoClear = false;

        this._orthoCamera = new FreeCamera("__particles2d_cam__", new Vector3(0, 0, -1), this.particleScene);
        this._orthoCamera.mode = Camera.ORTHOGRAPHIC_CAMERA;
        this._orthoCamera.minZ = 0.1;
        this._orthoCamera.maxZ = 1000;
        this._orthoCamera.inputs.clear();
        this.particleScene.activeCamera = this._orthoCamera;
    }

    /**
     * Backward-compatible alias for `particleScene`.
     * @returns The underlying core Scene.
     */
    public get scene(): CoreScene {
        return this.particleScene;
    }

    /**
     * The Camera2D to synchronize with before rendering particles.
     * @returns The current Camera2D, or null when unassigned.
     */
    public get camera(): Camera2D | null {
        return this._camera;
    }

    public set camera(camera: Camera2D | null) {
        this._camera = camera;
    }

    /**
     * Synchronizes the internal orthographic camera with the current Camera2D.
     */
    public sync(): void {
        if (!this._camera) {
            return;
        }

        this._syncOrthoCameraWith(this._camera);
    }

    /**
     * Creates and registers a core ParticleSystem ready for 2D use.
     * @param name - Unique name for the particle system.
     * @param capacity - Maximum number of particles.
     * @param emitter - Optional emitter override kept for backward compatibility.
     * @returns The created ParticleSystem.
     */
    public createParticleSystem(name: string, capacity: number = 2000, emitter?: AbstractMesh | Vector3): ParticleSystem {
        const system = new ParticleSystem(name, capacity, this.particleScene);
        this._apply2DDefaults(system);

        if (emitter) {
            system.emitter = emitter;
        } else {
            const emitterMesh = this._createEmitterMesh(name);
            this._ownedEmitters.set(system, emitterMesh);
            system.emitter = emitterMesh;
        }

        this._managedSystems.add(system);
        return system;
    }

    /**
     * Creates a particle system from a Babylon.js .json particle definition.
     * @param url - URL to the .json particle definition.
     * @param position - Initial 2D world position.
     * @returns A promise resolving to the loaded particle system.
     */
    public async loadFromJsonAsync(url: string, position: { x: number; y: number }): Promise<IParticleSystem> {
        const system = await ParticleHelper.ParseFromFileAsync(null, url, this.particleScene, false, this._getRootUrl(url));
        this._apply2DDefaults(system);

        this._managedSystems.add(system);
        this.setEmitterPosition(system, position.x, position.y);

        return system;
    }

    /**
     * Sets the 2D world position of an emitter.
     * @param system - The particle system whose emitter should move.
     * @param x - World X coordinate.
     * @param y - World Y coordinate.
     */
    public setEmitterPosition(system: IParticleSystem, x: number, y: number): void {
        const emitter = this._getOrCreateEmitter(system);
        this._setEmitterCoordinates(emitter, x, y);
    }

    /**
     * Attaches a particle system's emitter to follow a Node2D each frame.
     * @param system - The particle system to attach.
     * @param node - The node whose world position the emitter should follow.
     */
    public attachToNode(system: IParticleSystem, node: Node2D): void {
        this._attachments.set(system, node);
    }

    /**
     * Detaches a previously attached particle system.
     * @param system - The particle system to detach.
     */
    public detachFromNode(system: IParticleSystem): void {
        this._attachments.delete(system);
    }

    /**
     * Registers an externally-created particle system with this helper.
     * @param particleSystem - The particle system to register.
     */
    public addParticleSystem(particleSystem: IParticleSystem): void {
        if (particleSystem.getScene() !== this.particleScene) {
            Logger.Warn("ParticleHelper2D.addParticleSystem: For best results, create or parse the particle system in the helper's particleScene.");
        }

        this._managedSystems.add(particleSystem);
    }

    /**
     * Removes and disposes a particle system.
     * @param system - The particle system to remove.
     */
    public removeParticleSystem(system: IParticleSystem): void {
        this.detachFromNode(system);
        this._managedSystems.delete(system);

        const ownedEmitter = this._ownedEmitters.get(system);
        this._ownedEmitters.delete(system);

        if (ownedEmitter && system.emitter === ownedEmitter) {
            system.emitter = null;
        }

        system.dispose();
        ownedEmitter?.dispose();
    }

    /**
     * Renders all active particle systems.
     * Syncs the internal orthographic camera and updates node-follow attachments.
     */
    public render(): void {
        if (this._camera) {
            this._syncOrthoCameraWith(this._camera);
        }

        for (const [system, node] of this._attachments) {
            const position = node.getWorldPosition(ParticleHelper2D._attachmentPositionScratch);
            const emitter = this._getOrCreateEmitter(system);
            this._setEmitterCoordinates(emitter, position.x, position.y);
        }

        this.particleScene.render();
    }

    /**
     * Disposes the helper, all managed particle systems, and the internal scene when owned.
     */
    public dispose(): void {
        const systems = Array.from(this._managedSystems);
        for (const system of systems) {
            this.removeParticleSystem(system);
        }

        this._attachments.clear();
        this._camera = null;

        if (!this._ownsScene && this.particleScene.activeCamera === this._orthoCamera) {
            this.particleScene.activeCamera = this._previousActiveCamera;
        }
        if (!this._ownsScene && this.particleScene.autoClear === false) {
            this.particleScene.autoClear = this._previousAutoClear;
        }

        this._orthoCamera.dispose();

        if (this._ownsScene) {
            this.particleScene.dispose();
        }
    }

    /**
     * Applies the default 2D bridge settings to a particle system.
     * @param system - The particle system to configure.
     */
    private _apply2DDefaults(system: IParticleSystem): void {
        system.isLocal = false;
        system.isBillboardBased = false;

        if (system instanceof ParticleSystem) {
            system.forceDepthWrite = false;
        }
    }

    /**
     * Synchronizes the internal orthographic camera with the 2D camera.
     * @param camera - The source Camera2D.
     */
    private _syncOrthoCameraWith(camera: Camera2D): void {
        const { scaleX, scaleY } = camera.effectiveScale;
        const safeScaleX = scaleX !== 0 ? scaleX : 1;
        const safeScaleY = scaleY !== 0 ? scaleY : 1;
        const halfWorldWidth = camera.viewportWidth / (2 * safeScaleX);
        const halfWorldHeight = camera.viewportHeight / (2 * safeScaleY);

        this._orthoCamera.position.set(camera.position.x, camera.position.y, -1);
        this._orthoCamera.orthoLeft = -halfWorldWidth;
        this._orthoCamera.orthoRight = halfWorldWidth;
        this._orthoCamera.orthoBottom = -halfWorldHeight;
        this._orthoCamera.orthoTop = halfWorldHeight;
        this._orthoCamera.rotation.z = camera.rotation;
    }

    /**
     * Gets the current emitter for a system, creating a helper-owned mesh when absent.
     * @param system - The particle system whose emitter should be resolved.
     * @returns The resolved emitter transform target.
     */
    private _getOrCreateEmitter(system: IParticleSystem): AbstractMesh | Vector3 {
        if (system.emitter) {
            return system.emitter;
        }

        const emitterMesh = this._createEmitterMesh(system.name);
        this._ownedEmitters.set(system, emitterMesh);
        system.emitter = emitterMesh;
        return emitterMesh;
    }

    /**
     * Applies a 2D position to either a mesh emitter or a Vector3 emitter.
     * @param emitter - The emitter transform target.
     * @param x - World X coordinate.
     * @param y - World Y coordinate.
     */
    private _setEmitterCoordinates(emitter: AbstractMesh | Vector3, x: number, y: number): void {
        if (emitter instanceof Vector3) {
            emitter.set(x, y, 0);
            return;
        }

        emitter.position.set(x, y, 0);
    }

    /**
     * Creates a non-rendering mesh used as a particle emitter anchor.
     * @param systemName - The source particle-system name.
     * @returns The emitter mesh.
     */
    private _createEmitterMesh(systemName: string): Mesh {
        const emitterMesh = new Mesh(`__particles2d_emitter_${systemName}__`, this.particleScene);
        emitterMesh.isVisible = false;
        emitterMesh.position.set(0, 0, 0);
        return emitterMesh;
    }

    /**
     * Derives the root URL used for relative resources inside particle JSON files.
     * @param url - The particle definition URL.
     * @returns The root URL prefix.
     */
    private _getRootUrl(url: string): string {
        const forwardSlashIndex = url.lastIndexOf("/");
        const backSlashIndex = url.lastIndexOf("\\");
        const separatorIndex = Math.max(forwardSlashIndex, backSlashIndex);

        if (separatorIndex === -1) {
            return "";
        }

        return url.slice(0, separatorIndex + 1);
    }
}
