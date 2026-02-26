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
import { Rectangle2D } from "../Math/rectangle2D";
import { SpriteBatchRenderer } from "../Rendering/spriteBatchRenderer";
import type { ISprite2DRenderData } from "../Rendering/spriteBatchRenderer";
import type { LightingManager2D } from "../Lighting/light2D";
import type { DebugRenderer2D } from "../Debug/debugRenderer2D";
import { Scene2DStore } from "./scene2DStore";
import { RectMask2D } from "../Masking/rectMask2D";
import { SpriteMask2D } from "../Masking/spriteMask2D";
import { RenderCommandType } from "../Masking/renderCommand2D";
import type { RenderCommand2D, ISpriteRenderCommand, IPushRectMaskCommand, IPushSpriteMaskCommand } from "../Masking/renderCommand2D";
import { MaskStateManager } from "../Masking/maskStateManager";

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
     * Minimum sorting layer that renders without lighting.
     * Sprites with `sortingLayer >= unlitSortingLayerMin` bypass the
     * lit shader, which is useful for HUD elements that should not
     * be affected by in-world lights.
     * Set to `Infinity` (default) to light everything.
     */
    public unlitSortingLayerMin: number = Infinity;

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
    private _hasMasks: boolean = false;
    private _hasMasksLastFrame: boolean = false;
    private _renderCommands: RenderCommand2D[] = [];
    /** Reusable array for sprite batch in _processRenderCommands (W3: avoid per-frame allocation) */
    private _spriteBatchTemp: ISprite2DRenderData[] = [];
    /** Reusable array for mask sprite data in _processRenderCommands */
    private _maskSpriteDataTemp: ISprite2DRenderData[] = [];
    private _maskStateManager: MaskStateManager | null = null;
    /**
     * Internal overlay nodes rendered on top of rootNodes but not exposed
     * in the public `rootNodes` array. Used by SceneTransition2D.
     * @internal
     */
    private _overlayNodes: Node2D[] = [];

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
     * Adds an internal overlay node that renders on top of the scene but is
     * not included in the public `rootNodes` array.
     * @param node - The overlay node to add
     * @internal
     */
    public _addOverlay(node: Node2D): void {
        if (this._overlayNodes.indexOf(node) === -1) {
            this._overlayNodes.push(node);
        }
        node._setScene(this);
    }

    /**
     * Removes an internal overlay node previously added with `_addOverlay`.
     * @param node - The overlay node to remove
     * @internal
     */
    public _removeOverlay(node: Node2D): void {
        const index = this._overlayNodes.indexOf(node);
        if (index !== -1) {
            this._overlayNodes.splice(index, 1);
        }
        node._setScene(null);
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
     * Recursively collects render commands including mask push/pop boundaries.
     * Sprites within each mask group are sorted locally.
     */
    private _collectRenderCommands(node: Node2D, commands: RenderCommand2D[]): void {
        if (!node.visible || node.worldAlpha <= 0) {
            return;
        }

        const mask = node.mask;
        const hasMask = mask !== null && mask.enabled;
        let pushCommand: IPushRectMaskCommand | IPushSpriteMaskCommand | null = null;
        let groupStartIndex = -1;

        if (hasMask) {
            this._hasMasks = true;
            groupStartIndex = commands.length;

            if (mask instanceof RectMask2D) {
                pushCommand = { type: RenderCommandType.PushRectMask, rectMask: mask, maskOwner: node };
                commands.push(pushCommand);
            } else if (mask instanceof SpriteMask2D) {
                pushCommand = { type: RenderCommandType.PushSpriteMask, spriteMask: mask, maskOwner: node };
                commands.push(pushCommand);
            }
        }

        // Collect this node's sprite data
        if (node instanceof Sprite2D) {
            const beforeLen = this._spriteDataPool.length;
            node._collectRenderData(this._spriteDataPool, this._getWhiteTexture());
            // Emit sprite commands for any new entries
            for (let i = beforeLen; i < this._spriteDataPool.length; i++) {
                commands.push({ type: RenderCommandType.Sprite, spriteData: this._spriteDataPool[i] });
            }
        }

        // Recurse children
        for (const child of node.children) {
            this._collectRenderCommands(child, commands);
        }

        if (hasMask && groupStartIndex >= 0 && pushCommand) {
            // Sort sprite commands within this mask group (between push and pop)
            const pushIdx = groupStartIndex;
            const popIdx = commands.length;
            // Count sprite-only vs other commands in this range
            let hasOther = false;
            let spriteCount = 0;
            for (let i = pushIdx + 1; i < popIdx; i++) {
                if (commands[i].type === RenderCommandType.Sprite) {
                    spriteCount++;
                } else {
                    hasOther = true;
                    break;
                }
            }

            // Only sort if there are no nested masks (simple case)
            if (!hasOther && spriteCount > 1) {
                // All commands in this range are sprites — safe to sort in-place
                const start = pushIdx + 1;
                const subArray = commands as ISpriteRenderCommand[];
                // In-place insertion sort (fast for small arrays, no allocation)
                for (let i = start + 1; i < popIdx; i++) {
                    const cmd = subArray[i];
                    const sd = cmd.spriteData;
                    let j = i - 1;
                    while (j >= start) {
                        const prev = subArray[j];
                        const pd = prev.spriteData;
                        if (pd.sortingLayer !== sd.sortingLayer ? pd.sortingLayer > sd.sortingLayer : pd.zIndex > sd.zIndex) {
                            subArray[j + 1] = prev;
                            j--;
                        } else {
                            break;
                        }
                    }
                    subArray[j + 1] = cmd;
                }
            }

            commands.push({ type: RenderCommandType.PopMask, pushCommand });
        }
    }

    /**
     * Processes the render command list, executing mask push/pop and sprite batching.
     * This method owns the global engine state (depth, alpha, cull) for the entire
     * command sequence. Uses renderer.renderBatch() to avoid state conflicts.
     */
    private _processRenderCommands(
        commands: RenderCommand2D[],
        renderer: SpriteBatchRenderer,
        viewTransform: Matrix2D,
        vpWidth: number,
        vpHeight: number,
        camPos: { x: number; y: number } | null,
        unlitSortingLayerMin: number = Infinity
    ): void {
        if (!this._maskStateManager) {
            this._maskStateManager = new MaskStateManager(this.engine);
        }
        const maskMgr = this._maskStateManager;
        maskMgr.reset();
        maskMgr.setViewportHeight(vpHeight);

        const engine = this.engine;
        engine.setAlphaMode(Constants.ALPHA_COMBINE);
        engine.setDepthBuffer(false);
        engine.setState(false);

        // Reuse pre-allocated arrays
        const spriteBatch = this._spriteBatchTemp;
        spriteBatch.length = 0;

        const flushSpriteBatch = () => {
            if (spriteBatch.length > 0) {
                // Toggle lighting based on whether this batch is above the unlit threshold
                const batchLayer = spriteBatch[0].sortingLayer;
                renderer.lightingManager = (batchLayer < unlitSortingLayerMin) ? this.lightingManager : null;
                renderer.renderBatch(spriteBatch, vpWidth, vpHeight, viewTransform, camPos);
                spriteBatch.length = 0;
            }
        };

        // Reusable rect for PushRectMask viewport conversion
        const tempViewportRect = new Rectangle2D();

        for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i];

            switch (cmd.type) {
                case RenderCommandType.Sprite: {
                    // Flush if crossing the lit/unlit boundary
                    const sd = cmd.spriteData;
                    if (spriteBatch.length > 0) {
                        const prevLayer = spriteBatch[0].sortingLayer;
                        const prevLit = prevLayer < unlitSortingLayerMin;
                        const currLit = sd.sortingLayer < unlitSortingLayerMin;
                        if (prevLit !== currLit) {
                            flushSpriteBatch();
                        }
                    }
                    spriteBatch.push(sd);
                    break;
                }

                case RenderCommandType.PushRectMask: {
                    flushSpriteBatch();
                    this._pushRectMaskToGPU(cmd, viewTransform, camPos, maskMgr, tempViewportRect);
                    break;
                }

                case RenderCommandType.PushSpriteMask: {
                    flushSpriteBatch();

                    const mask = cmd.spriteMask;
                    const sprite = mask.sprite;

                    // Collect the mask sprite's render data
                    const maskSpriteData = this._maskSpriteDataTemp;
                    maskSpriteData.length = 0;
                    sprite._collectRenderData(maskSpriteData, this._getWhiteTexture());

                    if (maskSpriteData.length > 0) {
                        // Configure stencil for mask writing (INCR)
                        maskMgr.beginStencilMaskWrite();

                        // Render the mask sprite into the stencil buffer
                        renderer.renderMaskSprite(maskSpriteData[0], mask.alphaThreshold, vpWidth, vpHeight, viewTransform, camPos);
                    }

                    // Configure stencil for masked content rendering
                    maskMgr.pushSpriteMask(mask.inverted);
                    break;
                }

                case RenderCommandType.PopMask: {
                    flushSpriteBatch();

                    // For sprite masks, re-render the mask sprite with DECR to undo stencil writes
                    const pushCmd = cmd.pushCommand;
                    if (pushCmd.type === RenderCommandType.PushSpriteMask) {
                        const mask = pushCmd.spriteMask;
                        const sprite = mask.sprite;
                        const maskSpriteData = this._maskSpriteDataTemp;
                        maskSpriteData.length = 0;
                        sprite._collectRenderData(maskSpriteData, this._getWhiteTexture());

                        if (maskSpriteData.length > 0) {
                            // Configure stencil for mask erasing (DECR)
                            maskMgr.beginStencilMaskErase();
                            renderer.renderMaskSprite(maskSpriteData[0], mask.alphaThreshold, vpWidth, vpHeight, viewTransform, camPos);
                        }
                    }

                    maskMgr.popMask();
                    break;
                }
            }
        }

        flushSpriteBatch();

        engine.setDepthBuffer(true);
        engine.setAlphaMode(Constants.ALPHA_DISABLE);
    }

    /**
     * Transforms a PushRectMask command's local-space rectangle into viewport
     * space and pushes it onto the mask state manager.
     */
    private _pushRectMaskToGPU(
        cmd: IPushRectMaskCommand,
        viewTransform: Matrix2D,
        camPos: { x: number; y: number } | null,
        maskMgr: MaskStateManager,
        outRect: Rectangle2D
    ): void {
        const mask = cmd.rectMask;
        const owner = cmd.maskOwner;
        const wt = owner.worldTransform;
        const r = mask.rect;
        const pad = mask.padding;

        const lx = r.x - pad;
        const ly = r.y - pad;
        const lw = r.width + pad * 2;
        const lh = r.height + pad * 2;

        const wtm = wt.m;
        const cm = viewTransform.m;

        // Parallax correction
        const sfx = owner.worldScrollFactorX;
        const sfy = owner.worldScrollFactorY;
        let parallaxDx = 0;
        let parallaxDy = 0;
        if ((sfx !== 1 || sfy !== 1) && camPos) {
            parallaxDx = camPos.x * (1 - sfx);
            parallaxDy = camPos.y * (1 - sfy);
        }

        // Compute AABB of transformed corners (unrolled — no temp arrays)
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const cx0 = lx, cy0 = ly;
        const cx1 = lx + lw, cy1 = ly;
        const cx2 = lx + lw, cy2 = ly + lh;
        const cx3 = lx, cy3 = ly + lh;

        for (let ci = 0; ci < 4; ci++) {
            const px = ci === 0 ? cx0 : ci === 1 ? cx1 : ci === 2 ? cx2 : cx3;
            const py = ci === 0 ? cy0 : ci === 1 ? cy1 : ci === 2 ? cy2 : cy3;
            const wx = wtm[0] * px + wtm[2] * py + wtm[4] + parallaxDx;
            const wy = wtm[1] * px + wtm[3] * py + wtm[5] + parallaxDy;
            const vx = cm[0] * wx + cm[2] * wy + cm[4];
            const vy = cm[1] * wx + cm[3] * wy + cm[5];
            if (vx < minX) { minX = vx; }
            if (vy < minY) { minY = vy; }
            if (vx > maxX) { maxX = vx; }
            if (vy > maxY) { maxY = vy; }
        }

        outRect.x = minX;
        outRect.y = minY;
        outRect.width = maxX - minX;
        outRect.height = maxY - minY;
        maskMgr.pushRectMask(outRect, mask.inverted);
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
            engine.clear(this.backgroundColor, true, true, this._hasMasksLastFrame);
        }

        if (renderer.isReady) {
            // Provide fallback texture for unused WebGPU texture slots
            renderer.fallbackTexture = this._getWhiteTexture();

            // Reset mask tracking for this frame
            this._hasMasks = false;

            // Collect visible sprites and detect masks
            this._spriteDataPool.length = 0;
            this._renderCommands.length = 0;

            // First pass: collect render commands (detects masks)
            for (const root of this._rootNodes) {
                this._collectRenderCommands(root, this._renderCommands);
            }

            // Collect overlay nodes (internal, not in rootNodes — e.g. transition overlays)
            for (const overlay of this._overlayNodes) {
                this._collectRenderCommands(overlay, this._renderCommands);
            }

            // Always use the actual engine render dimensions for the projection
            const vpWidth = engine.getRenderWidth();
            const vpHeight = engine.getRenderHeight();

            if (this._hasMasks) {
                // Mask path: process render commands with push/pop mask orchestration
                const viewTransform = this.camera ? this.camera.getViewTransform() : Matrix2D.Identity();

                // Pack light uniforms for the mask path
                if (this.lightingManager) {
                    this.lightingManager.packLightUniforms(viewTransform.m);
                }

                const camPos = this.camera ? this.camera.position : null;
                const unlitMin = this.unlitSortingLayerMin;
                this._processRenderCommands(this._renderCommands, renderer, viewTransform, vpWidth, vpHeight, camPos, unlitMin);
            } else if (this._spriteDataPool.length > 0) {
                // Fast path (no masks): existing flat sort + batch render
                this._spriteDataPool.sort((a, b) => {
                    return a.sortingLayer !== b.sortingLayer ? a.sortingLayer - b.sortingLayer : a.zIndex - b.zIndex;
                });

                const viewTransform = this.camera ? this.camera.getViewTransform() : Matrix2D.Identity();
                const camPos = this.camera ? this.camera.position : null;

                // Split lit / unlit sprites at the unlitSortingLayerMin boundary.
                // Because the pool is sorted by sortingLayer, a binary search finds
                // the first unlit sprite and we render two contiguous slices.
                const unlitMin = this.unlitSortingLayerMin;
                const hasLighting = this.lightingManager !== null;
                const needsSplit = hasLighting && unlitMin !== Infinity;

                if (needsSplit) {
                    // Find first sprite at or above the unlit threshold
                    let splitIdx = this._spriteDataPool.length;
                    for (let i = 0; i < this._spriteDataPool.length; i++) {
                        if (this._spriteDataPool[i].sortingLayer >= unlitMin) {
                            splitIdx = i;
                            break;
                        }
                    }

                    // Render lit sprites
                    if (splitIdx > 0) {
                        this.lightingManager!.packLightUniforms(viewTransform.m);
                        renderer.lightingManager = this.lightingManager;
                        renderer.render(this._spriteDataPool.slice(0, splitIdx), vpWidth, vpHeight, viewTransform, camPos);
                    }

                    // Render unlit sprites (HUD etc.)
                    if (splitIdx < this._spriteDataPool.length) {
                        renderer.lightingManager = null;
                        renderer.render(this._spriteDataPool.slice(splitIdx), vpWidth, vpHeight, viewTransform, camPos);
                    }
                } else {
                    if (hasLighting) {
                        this.lightingManager!.packLightUniforms(viewTransform.m);
                        renderer.lightingManager = this.lightingManager;
                    } else {
                        renderer.lightingManager = null;
                    }
                    renderer.render(this._spriteDataPool, vpWidth, vpHeight, viewTransform, camPos);
                }
            }

            // Render debug overlays (after sprites, before onAfterRender)
            if (this.debugRenderer && this.debugRenderer.enabled) {
                const debugViewTransform = this.camera ? this.camera.getViewTransform() : Matrix2D.Identity();
                this.debugRenderer.render(debugViewTransform, vpWidth, vpHeight);
            }
        }

        this._hasMasksLastFrame = this._hasMasks;
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
        this._overlayNodes.length = 0;
        this._allNodes.clear();

        if (this._batchRenderer) {
            this._batchRenderer.dispose();
            this._batchRenderer = null;
        }

        if (this._maskStateManager) {
            this._maskStateManager.dispose();
            this._maskStateManager = null;
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

        if (Scene2DStore._LastCreatedScene === this) {
            Scene2DStore._LastCreatedScene = null;
        }

        this._isDisposed = true;
    }
}
