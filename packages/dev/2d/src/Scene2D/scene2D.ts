import type { AbstractEngine } from "core/Engines/abstractEngine";
import type { Scene } from "core/scene";
import { Color4 } from "core/Maths/math.color";
import { Observable } from "core/Misc/observable";
import { RawTexture } from "core/Materials/Textures/rawTexture";
import type { ThinTexture } from "core/Materials/Textures/thinTexture";
import { Constants } from "core/Engines/constants";
import type { Nullable } from "core/types";

import { Node2D } from "../Node2D/node2D";
import { Sprite2D } from "../Sprite2D/sprite2D";
import { Camera2D } from "../Camera2D/camera2D";
import { Matrix2D } from "../Math/matrix2D";
import { SpriteBatchRenderer } from "../Rendering/spriteBatchRenderer";
import type { ISprite2DRenderData } from "../Rendering/spriteBatchRenderer";
import type { LightingManager2D } from "../Lighting/light2D";
import type { DebugRenderer2D } from "../Debug/debugRenderer2D";
import { Scene2DStore } from "./scene2DStore";

/**
 * Represents a 2D scene that manages a hierarchy of Node2D entities.
 * Uses Y-down, top-left origin coordinate system.
 * Shares the Engine instance from @babylonjs/core for GPU access.
 */
export class Scene2D {
    /**
     * The underlying engine (shared with core)
     */
    public readonly engine: AbstractEngine;

    /**
     * Background clear color for the 2D scene
     */
    public backgroundColor: Color4 = new Color4(0, 0, 0, 1);

    /**
     * The active 2D camera. If null, renders with identity view (no scroll/zoom).
     */
    public camera: Camera2D | null = null;

    /**
     * Optional lighting manager for GPU-based 2D lighting.
     * When set, the sprite batch renderer uses a lit shader variant.
     */
    public lightingManager: LightingManager2D | null = null;

    /**
     * Optional debug renderer for drawing wireframe overlays
     * (collision shapes, physics bodies, spatial grid, pathfinding grid).
     * When set, debug rendering occurs automatically after sprite rendering.
     */
    public debugRenderer: DebugRenderer2D | null = null;

    /**
     * Observable triggered before rendering
     */
    public onBeforeRender: Observable<Scene2D> = new Observable<Scene2D>();

    /**
     * Observable triggered after rendering
     */
    public onAfterRender: Observable<Scene2D> = new Observable<Scene2D>();

    /**
     * Observable triggered when the scene is disposed
     */
    public onDispose: Observable<Scene2D> = new Observable<Scene2D>();

    /**
     * Observable triggered when the scene becomes ready (all shaders compiled)
     */
    public onReadyObservable: Observable<Scene2D> = new Observable<Scene2D>();

    private _rootNodes: Node2D[] = [];
    private _allNodes: Map<string, Node2D> = new Map();
    private _isDisposed: boolean = false;
    private _batchRenderer: SpriteBatchRenderer | null = null;
    private _whiteTexture: RawTexture | null = null;
    private _spriteDataPool: ISprite2DRenderData[] = [];
    private _executeWhenReadyTimeoutId: Nullable<ReturnType<typeof setTimeout>> = null;

    /**
     * Creates a new Scene2D
     * @param engine - The Babylon.js engine instance to use for rendering
     * @param linkedScene - Optional core Scene to link readiness with.
     *   When provided, the 3D scene's `isReady()` will return false until the
     *   2D scene's shaders are compiled, so `scene.executeWhenReady()` waits
     *   for both scenes automatically.
     */
    constructor(engine: AbstractEngine, linkedScene?: Scene) {
        this.engine = engine;
        Scene2DStore._LastCreatedScene = this;
        // Eagerly create the batch renderer so shader compilation starts immediately
        this._batchRenderer = new SpriteBatchRenderer(engine);

        // Link readiness to the 3D scene if provided
        if (linkedScene) {
            linkedScene.addPendingData(this);
            this.executeWhenReady(() => {
                linkedScene.removePendingData(this);
            });
        }
    }

    /**
     * The top-level nodes in the scene (nodes with no parent)
     */
    public get rootNodes(): readonly Node2D[] {
        return this._rootNodes;
    }

    /**
     * Whether this scene has been disposed
     */
    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    /**
     * Whether the scene is ready to render (all shaders compiled).
     * @returns true when the batch renderer's effects are compiled
     */
    public isReady(): boolean {
        return this._getBatchRenderer().isReady;
    }

    /**
     * Registers a callback to execute as soon as the scene is ready.
     * If the scene is already ready, the callback fires on the next check cycle.
     * @param func - The callback to execute when ready
     */
    public executeWhenReady(func: () => void): void {
        this.onReadyObservable.addOnce(func);

        if (this._executeWhenReadyTimeoutId !== null) {
            return;
        }

        this._checkIsReady();
    }

    /**
     * Returns a promise that resolves when the scene is ready to render.
     * @returns A promise that resolves when all shaders are compiled
     */
    public whenReadyAsync(): Promise<void> {
        return new Promise((resolve) => {
            this.executeWhenReady(() => {
                resolve();
            });
        });
    }

    private _checkIsReady(): void {
        if (this._isDisposed) {
            this._executeWhenReadyTimeoutId = null;
            return;
        }

        if (this.isReady()) {
            this.onReadyObservable.notifyObservers(this);
            this.onReadyObservable.clear();
            this._executeWhenReadyTimeoutId = null;
            return;
        }

        this._executeWhenReadyTimeoutId = setTimeout(() => {
            this._checkIsReady();
        }, 16);
    }

    /**
     * Adds a root node to the scene
     * @param node - The node to add
     */
    public addNode(node: Node2D): void {
        if (node.parent) {
            return;
        }

        // Remove from previous scene if different
        if (node.scene && node.scene !== this) {
            node.scene.removeNode(node);
        }

        if (this._rootNodes.indexOf(node) === -1) {
            this._rootNodes.push(node);
        }
        node._setScene(this);
        this._registerNode(node);
    }

    /**
     * Removes a root node from the scene
     * @param node - The node to remove
     */
    public removeNode(node: Node2D): void {
        const index = this._rootNodes.indexOf(node);
        if (index !== -1) {
            this._rootNodes.splice(index, 1);
        }
        node._setScene(null);
        this._unregisterNode(node);
    }

    /**
     * Registers a node in the scene's lookup table
     * @param node - The node to register
     */
    private _registerNode(node: Node2D): void {
        this._allNodes.set(node.id, node);
        for (const child of node.children) {
            this._registerNode(child);
        }
    }

    /**
     * Unregisters a node from the scene's lookup table
     * @param node - The node to unregister
     */
    private _unregisterNode(node: Node2D): void {
        this._allNodes.delete(node.id);
        for (const child of node.children) {
            this._unregisterNode(child);
        }
    }

    /**
     * Finds a node by its unique id
     * @param id - The id to search for
     * @returns The node if found, or null
     */
    public getNodeById(id: string): Node2D | null {
        return this._allNodes.get(id) ?? null;
    }

    /**
     * Gets all registered nodes in the scene
     * @returns An array of all nodes
     */
    public getAllNodes(): Node2D[] {
        return Array.from(this._allNodes.values());
    }

    /**
     * Updates all nodes in the scene
     * @param deltaTime - Time elapsed since last frame in seconds
     */
    public update(deltaTime: number): void {
        for (const node of this._rootNodes) {
            node.update(deltaTime);
        }
    }

    /**
     * Gets or creates the 1x1 white fallback texture (for untextured sprites)
     */
    private _getWhiteTexture(): ThinTexture {
        if (!this._whiteTexture) {
            this._whiteTexture = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, this.engine, false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE);
        }
        return this._whiteTexture;
    }

    /**
     * Gets the batch renderer (always initialized in constructor)
     */
    private _getBatchRenderer(): SpriteBatchRenderer {
        return this._batchRenderer!;
    }

    /**
     * Recursively collects visible Sprite2D nodes from the scene graph
     */
    private _collectSprites(node: Node2D, list: ISprite2DRenderData[]): void {
        if (!node.visible || node.worldAlpha <= 0) {
            return;
        }

        if (node instanceof Sprite2D) {
            node._collectRenderData(list, this._getWhiteTexture());
        }

        for (const child of node.children) {
            this._collectSprites(child, list);
        }
    }

    /**
     * Renders the 2D scene.
     * Collects all visible Sprite2D nodes, sorts by zIndex, batches by texture,
     * and submits draw calls via the SpriteBatchRenderer.
     */
    public render(): void {
        const engine = this.engine;
        engine.beginFrame();
        this.renderContent();
        engine.endFrame();
    }

    /**
     * Renders the scene content (clear, collect sprites, draw) without
     * calling engine.beginFrame()/endFrame(). Useful for compositing
     * multiple scenes in a single frame (e.g., slide transitions).
     * @param clear - Whether to clear the framebuffer before rendering. Default: true.
     */
    public renderContent(clear: boolean = true): void {
        const engine = this.engine;

        this.onBeforeRender.notifyObservers(this);

        // Set GL viewport to full canvas (critical — without this, rendering uses stale viewport)
        engine.setViewport({ x: 0, y: 0, width: 1, height: 1 });

        const renderer = this._getBatchRenderer();

        if (clear) {
            engine.clear(this.backgroundColor, true, true, false);
        }

        if (renderer.isReady) {
            // Provide fallback texture for unused WebGPU texture slots
            renderer.fallbackTexture = this._getWhiteTexture();

            // Collect visible sprites
            this._spriteDataPool.length = 0;
            for (const root of this._rootNodes) {
                this._collectSprites(root, this._spriteDataPool);
            }

            // Always use the actual engine render dimensions for the projection
            const vpWidth = engine.getRenderWidth();
            const vpHeight = engine.getRenderHeight();

            if (this._spriteDataPool.length > 0) {
                // Sort by sorting layer first, then zIndex within the same layer
                this._spriteDataPool.sort((a, b) => {
                    return a.sortingLayer !== b.sortingLayer ? a.sortingLayer - b.sortingLayer : a.zIndex - b.zIndex;
                });

                // Compute camera view transform
                const viewTransform = this.camera ? this.camera.getViewTransform() : Matrix2D.Identity();

                // Pack light uniforms in view space and wire to renderer
                if (this.lightingManager) {
                    this.lightingManager.packLightUniforms(viewTransform.m);
                    renderer.lightingManager = this.lightingManager;
                } else {
                    renderer.lightingManager = null;
                }

                // Render the batch
                renderer.render(this._spriteDataPool, vpWidth, vpHeight, viewTransform);
            }

            // Render debug overlays (after sprites, before onAfterRender)
            if (this.debugRenderer && this.debugRenderer.enabled) {
                const debugViewTransform = this.camera ? this.camera.getViewTransform() : Matrix2D.Identity();
                this.debugRenderer.render(debugViewTransform, vpWidth, vpHeight);
            }
        }

        this.onAfterRender.notifyObservers(this);
    }

    /**
     * Disposes the scene and all its nodes
     */
    public dispose(): void {
        if (this._isDisposed) {
            return;
        }

        // Clear readiness polling
        if (this._executeWhenReadyTimeoutId !== null) {
            clearTimeout(this._executeWhenReadyTimeoutId);
            this._executeWhenReadyTimeoutId = null;
        }

        // Dispose all root nodes (which will recursively dispose children)
        const rootsCopy = [...this._rootNodes];
        for (const node of rootsCopy) {
            node.dispose();
        }

        this._rootNodes.length = 0;
        this._allNodes.clear();

        if (this._batchRenderer) {
            this._batchRenderer.dispose();
            this._batchRenderer = null;
        }

        if (this.debugRenderer) {
            this.debugRenderer.dispose();
            this.debugRenderer = null;
        }

        if (this._whiteTexture) {
            this._whiteTexture.dispose();
            this._whiteTexture = null;
        }

        this.onDispose.notifyObservers(this);
        this.onBeforeRender.clear();
        this.onAfterRender.clear();
        this.onDispose.clear();
        this.onReadyObservable.clear();

        this._isDisposed = true;
    }
}
