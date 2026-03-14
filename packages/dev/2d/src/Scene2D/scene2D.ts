import type { AbstractEngine } from "core/Engines/abstractEngine";
import type { Scene } from "core/scene";
import { Color4 } from "core/Maths/math.color";
import { Observable } from "core/Misc/observable";
import { RawTexture } from "core/Materials/Textures/rawTexture";
import type { ThinTexture } from "core/Materials/Textures/thinTexture";
import { Constants } from "core/Engines/constants";
import type { Nullable } from "core/types";

import { Node2D } from "../Node2D/node2D";
import { RenderableNode2D } from "../Node2D/renderableNode2D";
import { Sprite2D } from "../Sprite2D/sprite2D";
import { NineSliceSprite2D } from "../NineSlice/nineSliceSprite2D";
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
import type { RenderCommand2D, IPushRectMaskCommand, IPushSpriteMaskCommand } from "../Masking/renderCommand2D";
import { MaskStateManager } from "../Masking/maskStateManager";

interface IRenderEntry2D {
    type: "sprite" | "group";
    sortingLayer: number;
    zIndex: number;
    insertionOrder: number;
    spriteData: ISprite2DRenderData | null;
    pushCommand: IPushRectMaskCommand | IPushSpriteMaskCommand | null;
    children: IRenderEntry2D[];
}

const _identityViewTransform = Matrix2D.Identity();

function _compareRenderEntries(left: IRenderEntry2D, right: IRenderEntry2D): number {
    if (left.sortingLayer !== right.sortingLayer) {
        return left.sortingLayer - right.sortingLayer;
    }
    if (left.zIndex !== right.zIndex) {
        return left.zIndex - right.zIndex;
    }
    return left.insertionOrder - right.insertionOrder;
}

function _compareSpriteRenderData(left: ISprite2DRenderData, right: ISprite2DRenderData): number {
    if (left.sortingLayer !== right.sortingLayer) {
        return left.sortingLayer - right.sortingLayer;
    }
    if (left.zIndex !== right.zIndex) {
        return left.zIndex - right.zIndex;
    }
    return (left.insertionOrder ?? 0) - (right.insertionOrder ?? 0);
}
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
    public get camera(): Camera2D | null {
        return this._camera;
    }

    public set camera(value: Camera2D | null) {
        if (this._camera === value) {
            return;
        }

        if (this._camera) {
            this._camera._setScene(null);
        }

        this._camera = value;

        if (this._camera) {
            this._camera._setScene(this);
        }
    }

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

    private _camera: Camera2D | null = null;
    private _rootNodes: Node2D[] = [];
    private _allNodes: Map<string, Node2D> = new Map();
    private _isDisposed: boolean = false;
    private _batchRenderer: SpriteBatchRenderer | null = null;
    private _whiteTexture: RawTexture | null = null;
    private _spriteDataPool: ISprite2DRenderData[] = [];
    private _spriteDataCount: number = 0;
    private _executeWhenReadyTimeoutId: Nullable<ReturnType<typeof setTimeout>> = null;
    private _hasMasks: boolean = false;
    private _hasMasksLastFrame: boolean = false;
    private _renderCommands: RenderCommand2D[] = [];
    private _renderEntries: IRenderEntry2D[] = [];
    private _renderEntryPool: IRenderEntry2D[] = [];
    private _renderEntryCount: number = 0;
    private _nextRenderInsertionOrder: number = 0;
    /** Reusable array for sprite batch in _processRenderCommands (W3: avoid per-frame allocation) */
    private _spriteBatchTemp: ISprite2DRenderData[] = [];
    /** Reusable array for mask sprite data in _processRenderCommands */
    private _maskSpriteDataTemp: ISprite2DRenderData[] = [];
    /** Reusable sorted sprite buffer for the no-mask fast path. */
    private _sortedSpriteDataTemp: ISprite2DRenderData[] = [];
    /** Reusable lit sprite buffer for the no-mask fast path. */
    private _litSpriteDataTemp: ISprite2DRenderData[] = [];
    /** Reusable unlit sprite buffer for the no-mask fast path. */
    private _unlitSpriteDataTemp: ISprite2DRenderData[] = [];
    private _maskStateManager: MaskStateManager | null = null;
    /** Timestamp (ms) of the last auto-update, for computing dt independently of the 3D engine */
    private _lastAutoUpdateTime: number = -1;
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
        // when the caller provides a real Babylon engine. Unit tests frequently use
        // minimal mock objects that do not implement the rendering surface area.
        if (this._canCreateBatchRenderer()) {
            this._batchRenderer = new SpriteBatchRenderer(engine);
        }

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
     * Whether this scene has been disposed.
     */
    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    /**
     * Whether the scene is ready to render (all shaders compiled).
     * @returns true when the batch renderer's effects are compiled.
     */
    public isReady(): boolean {
        if (!this._batchRenderer) {
            return false;
        }
        return this._batchRenderer.isReady;
    }

    /**
     * Registers a callback to execute as soon as the scene is ready.
     * @param func - The callback to execute when ready.
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
     * @returns A promise that resolves when all shaders are compiled.
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
     * Adds a root node to the scene.
     * @param node - The node to add.
     */
    public addRootNode(node: Node2D): void {
        if (node.parent) {
            return;
        }

        if (node.scene && node.scene !== this) {
            node.scene.removeRootNode(node);
        }

        this._addRootNodeDirect(node);
        this._attachNodeTree(node);
    }

    /**
     * Backward-compatible alias for addRootNode.
     * @param node - The node to add.
     */
    public addNode(node: Node2D): void {
        this.addRootNode(node);
    }

    /**
     * Removes a root node from the scene without disposing it.
     * @param node - The node to remove.
     */
    public removeRootNode(node: Node2D): void {
        if (node.parent) {
            return;
        }

        this._removeRootNodeDirect(node);
        this._detachNodeTree(node);
    }

    /**
     * Backward-compatible alias for removeRootNode.
     * @param node - The node to remove.
     */
    public removeNode(node: Node2D): void {
        this.removeRootNode(node);
    }

    /**
     * Adds an internal overlay node that renders on top of the scene but is
     * not included in the public rootNodes array.
     * @param node - The overlay node to add.
     * @internal
     */
    public _addOverlay(node: Node2D): void {
        if (node.parent) {
            node.parent.removeChild(node);
        }

        if (node.scene && node.scene !== this) {
            if (node.scene._isOverlayNode(node)) {
                node.scene._removeOverlay(node);
            } else {
                node.scene.removeRootNode(node);
            }
        }

        if (this._overlayNodes.indexOf(node) === -1) {
            this._overlayNodes.push(node);
        }
        this._attachNodeTree(node);
    }

    /**
     * Removes an internal overlay node previously added with _addOverlay.
     * @param node - The overlay node to remove.
     * @internal
     */
    public _removeOverlay(node: Node2D): void {
        const index = this._overlayNodes.indexOf(node);
        if (index !== -1) {
            this._overlayNodes.splice(index, 1);
        }
        this._detachNodeTree(node);
    }

    /**
     * Finds a node by its unique id.
     * @param id - The id to search for.
     * @returns The node if found, or null.
     */
    public getNodeById(id: string): Node2D | null {
        return this._allNodes.get(id) ?? null;
    }

    /**
     * Finds all nodes matching a predicate.
     * @param predicate - Predicate used to select nodes.
     * @returns Matching nodes.
     */
    public findNodes(predicate: (node: Node2D) => boolean): Node2D[] {
        const matches: Node2D[] = [];
        this._allNodes.forEach((node) => {
            if (predicate(node)) {
                matches.push(node);
            }
        });
        return matches;
    }

    /**
     * Gets all registered nodes in the scene.
     * @returns An array of all nodes.
     */
    public getAllNodes(): Node2D[] {
        return Array.from(this._allNodes.values());
    }

    /**
     * Updates all nodes in the scene.
     * @param deltaTime - Time elapsed since last frame in seconds.
     */
    public update(deltaTime: number): void {
        for (const node of this._rootNodes) {
            this._updateNodeRecursive(node, deltaTime);
        }
        for (const overlayNode of this._overlayNodes) {
            this._updateNodeRecursive(overlayNode, deltaTime);
        }
    }

    /**
     * @internal
     */
    public _attachNodeTree(node: Node2D): void {
        if (node.scene !== this) {
            node._setScene(this);
        }
        this._allNodes.set(node.id, node);
        node._markWorldTransformDirty();
        node._markWorldRenderStateDirty();
        for (const child of node.children) {
            this._attachNodeTree(child);
        }
    }

    /**
     * @internal
     */
    public _detachNodeTree(node: Node2D): void {
        this._allNodes.delete(node.id);
        node._setScene(null);
        node._markWorldTransformDirty();
        node._markWorldRenderStateDirty();
        for (const child of node.children) {
            this._detachNodeTree(child);
        }
    }

    /**
     * @internal
     */
    public _addRootNodeDirect(node: Node2D): void {
        if (this._rootNodes.indexOf(node) === -1) {
            this._rootNodes.push(node);
        }
    }

    /**
     * @internal
     */
    public _removeRootNodeDirect(node: Node2D): void {
        const index = this._rootNodes.indexOf(node);
        if (index !== -1) {
            this._rootNodes.splice(index, 1);
        }
    }

    /**
     * @internal
     */
    public _isOverlayNode(node: Node2D): boolean {
        return this._overlayNodes.indexOf(node) !== -1;
    }

    /**
     * Gets or creates the 1x1 white fallback texture (for untextured sprites).
     */
    private _getWhiteTexture(): ThinTexture {
        if (!this._whiteTexture) {
            this._whiteTexture = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, this.engine, false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE);
        }
        return this._whiteTexture;
    }

    private _canCreateBatchRenderer(): boolean {
        const engine = this.engine as AbstractEngine & { getCaps?: () => unknown };
        return typeof engine.getCaps === "function";
    }

    /**
     * Gets or lazily creates the batch renderer.
     */
    private _getBatchRenderer(): SpriteBatchRenderer {
        if (!this._batchRenderer) {
            if (!this._canCreateBatchRenderer()) {
                throw new Error("Scene2D rendering requires an engine with getCaps().");
            }
            this._batchRenderer = new SpriteBatchRenderer(this.engine);
        }
        return this._batchRenderer;
    }

    private _allocateSpriteRenderData(): ISprite2DRenderData {
        if (this._spriteDataCount >= this._spriteDataPool.length) {
            this._spriteDataPool.push({} as ISprite2DRenderData);
        }
        const renderData = this._spriteDataPool[this._spriteDataCount];
        this._spriteDataCount++;
        return renderData;
    }

    private _acquireRenderEntry(): IRenderEntry2D {
        if (this._renderEntryCount >= this._renderEntryPool.length) {
            this._renderEntryPool.push({
                type: "sprite",
                sortingLayer: 0,
                zIndex: 0,
                insertionOrder: 0,
                spriteData: null,
                pushCommand: null,
                children: [],
            });
        }

        const entry = this._renderEntryPool[this._renderEntryCount];
        this._renderEntryCount++;
        entry.type = "sprite";
        entry.sortingLayer = 0;
        entry.zIndex = 0;
        entry.insertionOrder = 0;
        entry.spriteData = null;
        entry.pushCommand = null;
        entry.children.length = 0;
        return entry;
    }

    private _updateNodeRecursive(node: Node2D, deltaTime: number): void {
        if (node instanceof RenderableNode2D && !node.visible) {
            return;
        }

        node._updateForScene(deltaTime);
        for (const child of node.children) {
            this._updateNodeRecursive(child, deltaTime);
        }
    }

    private _appendSpriteEntry(entries: IRenderEntry2D[], sprite: Sprite2D, worldAlpha: number, worldScrollFactorX: number, worldScrollFactorY: number): void {
        const fallbackTexture = this._getWhiteTexture();
        const worldZIndex = sprite.worldZIndex;

        if (sprite instanceof NineSliceSprite2D) {
            const emittedCount = sprite._appendRenderData(this._spriteDataPool, fallbackTexture, worldAlpha, worldScrollFactorX, worldScrollFactorY, worldZIndex, this._nextRenderInsertionOrder, (_index: number) => {
                return this._allocateSpriteRenderData();
            });

            for (let i = 0; i < emittedCount; i++) {
                const spriteData = this._spriteDataPool[this._spriteDataCount - emittedCount + i];
                const entry = this._acquireRenderEntry();
                entry.type = "sprite";
                entry.spriteData = spriteData;
                entry.sortingLayer = spriteData.sortingLayer;
                entry.zIndex = spriteData.zIndex;
                entry.insertionOrder = spriteData.insertionOrder ?? 0;
                entries.push(entry);
            }

            this._nextRenderInsertionOrder += emittedCount;
            return;
        }

        const spriteData = this._allocateSpriteRenderData();
        const insertionOrder = this._nextRenderInsertionOrder++;
        if (!sprite._writeRenderDataTo(spriteData, fallbackTexture, worldAlpha, worldScrollFactorX, worldScrollFactorY, worldZIndex, insertionOrder)) {
            this._spriteDataCount--;
            return;
        }

        const entry = this._acquireRenderEntry();
        entry.type = "sprite";
        entry.spriteData = spriteData;
        entry.sortingLayer = spriteData.sortingLayer;
        entry.zIndex = spriteData.zIndex;
        entry.insertionOrder = insertionOrder;
        entries.push(entry);
    }

    private _collectRenderEntries(node: Node2D, entries: IRenderEntry2D[], parentAlpha: number, parentScrollFactorX: number, parentScrollFactorY: number): void {
        let worldAlpha = parentAlpha;
        let worldScrollFactorX = parentScrollFactorX;
        let worldScrollFactorY = parentScrollFactorY;

        let targetEntries = entries;
        let groupEntry: IRenderEntry2D | null = null;

        if (node instanceof RenderableNode2D) {
            if (!node.visible) {
                return;
            }

            worldAlpha *= node.alpha;
            if (worldAlpha <= 0) {
                return;
            }

            worldScrollFactorX *= node.scrollFactorX;
            worldScrollFactorY *= node.scrollFactorY;

            const mask = node.mask;
            if (mask && mask.enabled) {
                groupEntry = this._acquireRenderEntry();
                groupEntry.type = "group";
                groupEntry.sortingLayer = node.sortingLayer;
                groupEntry.zIndex = node.worldZIndex;
                groupEntry.insertionOrder = this._nextRenderInsertionOrder++;
                groupEntry.pushCommand = mask instanceof RectMask2D ? { type: RenderCommandType.PushRectMask, rectMask: mask, maskOwner: node } : { type: RenderCommandType.PushSpriteMask, spriteMask: mask as SpriteMask2D, maskOwner: node };
                targetEntries = groupEntry.children;
                this._hasMasks = true;
            }
        }

        if (node instanceof Sprite2D) {
            this._appendSpriteEntry(targetEntries, node, worldAlpha, worldScrollFactorX, worldScrollFactorY);
        }

        for (const child of node.children) {
            this._collectRenderEntries(child, targetEntries, worldAlpha, worldScrollFactorX, worldScrollFactorY);
        }

        if (groupEntry) {
            entries.push(groupEntry);
        }
    }

    private _sortRenderEntries(entries: IRenderEntry2D[]): void {
        for (const entry of entries) {
            if (entry.type === "group") {
                this._sortRenderEntries(entry.children);
            }
        }

        entries.sort(_compareRenderEntries);
    }

    private _flattenRenderEntries(entries: IRenderEntry2D[], commands: RenderCommand2D[]): void {
        for (const entry of entries) {
            if (entry.type === "sprite") {
                commands.push({ type: RenderCommandType.Sprite, spriteData: entry.spriteData! });
                continue;
            }

            const pushCommand = entry.pushCommand!;
            commands.push(pushCommand);
            this._flattenRenderEntries(entry.children, commands);
            commands.push({ type: RenderCommandType.PopMask, pushCommand });
        }
    }

    private _collectMaskSpriteData(sprite: Sprite2D): ISprite2DRenderData[] {
        const maskSpriteData = this._maskSpriteDataTemp;
        const fallbackTexture = this._getWhiteTexture();

        if (sprite instanceof NineSliceSprite2D) {
            const emittedCount = sprite._appendRenderData(maskSpriteData, fallbackTexture, sprite.worldAlpha, sprite.worldScrollFactorX, sprite.worldScrollFactorY, sprite.worldZIndex, 0, (index: number) => {
                let renderData = maskSpriteData[index];
                if (!renderData) {
                    renderData = {} as ISprite2DRenderData;
                    maskSpriteData[index] = renderData;
                }
                return renderData;
            });
            maskSpriteData.length = emittedCount;
            return maskSpriteData;
        }

        let renderData = maskSpriteData[0];
        if (!renderData) {
            renderData = {} as ISprite2DRenderData;
            maskSpriteData[0] = renderData;
        }

        if (sprite._writeRenderDataTo(renderData, fallbackTexture, sprite.worldAlpha, sprite.worldScrollFactorX, sprite.worldScrollFactorY, sprite.worldZIndex, 0)) {
            maskSpriteData.length = 1;
        } else {
            maskSpriteData.length = 0;
        }

        return maskSpriteData;
    }

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
                    const maskSpriteData = this._collectMaskSpriteData(sprite);

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
                        const maskSpriteData = this._collectMaskSpriteData(sprite);

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

        // Compute AABB of transformed corners (unrolled ΓÇö no temp arrays)
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
     * Computes delta time in seconds since the last auto-update call,
     * using `performance.now()` so it works correctly even when called
     * after a 3D scene has already consumed the engine's frame delta.
     * @internal
     */
    private _computeDeltaTime(): number {
        const now = performance.now();
        if (this._lastAutoUpdateTime < 0) {
            this._lastAutoUpdateTime = now;
            return 0;
        }
        const dt = (now - this._lastAutoUpdateTime) / 1000;
        this._lastAutoUpdateTime = now;
        return dt;
    }

    /**
     * Renders the 2D scene (standalone mode ΓÇö owns the full frame).
     * Computes delta time, updates the camera and all nodes, then renders.
     * This is the simplest render loop: just call `scene2D.render()` each frame.
     */
    public render(): void;
    public render(deltaTime: number): void;
    public render(deltaTime?: number): void {
        const engine = this.engine;
        engine.beginFrame();
        this.renderContent(true, true, deltaTime);
        engine.endFrame();
    }

    /**
     * Renders the scene content without calling engine.beginFrame/endFrame.
     * @param clear - Whether to clear the framebuffer before rendering.
     * @param autoUpdate - Whether to automatically update camera and nodes.
     * @param deltaTime - Optional caller-supplied delta time in seconds.
     */
    public renderContent(clear: boolean = true, autoUpdate: boolean = true, deltaTime?: number): void {
        const engine = this.engine;

        this.onBeforeRender.notifyObservers(this);

        if (autoUpdate) {
            const resolvedDeltaTime = deltaTime ?? this._computeDeltaTime();
            if (this.camera) {
                this.camera.update(resolvedDeltaTime, engine.getRenderWidth(), engine.getRenderHeight());
            }
            this.update(resolvedDeltaTime);
        }

        engine.setViewport({ x: 0, y: 0, width: 1, height: 1 });

        const renderer = this._getBatchRenderer();
        if (clear) {
            engine.clear(this.backgroundColor, true, true, this._hasMasksLastFrame);
        }

        if (renderer.isReady) {
            renderer.fallbackTexture = this._getWhiteTexture();
            this._hasMasks = false;
            this._spriteDataCount = 0;
            this._renderEntryCount = 0;
            this._nextRenderInsertionOrder = 0;
            this._renderEntries.length = 0;
            this._renderCommands.length = 0;

            for (const root of this._rootNodes) {
                this._collectRenderEntries(root, this._renderEntries, 1, 1, 1);
            }
            for (const overlay of this._overlayNodes) {
                this._collectRenderEntries(overlay, this._renderEntries, 1, 1, 1);
            }

            const vpWidth = engine.getRenderWidth();
            const vpHeight = engine.getRenderHeight();
            const viewTransform = this.camera ? this.camera.getViewTransform() : _identityViewTransform;
            const camPos = this.camera ? this.camera.position : null;
            const unlitMin = this.unlitSortingLayerMin;

            if (this._hasMasks) {
                this._sortRenderEntries(this._renderEntries);
                this._flattenRenderEntries(this._renderEntries, this._renderCommands);

                if (this.lightingManager) {
                    this.lightingManager.packLightUniforms(viewTransform.m);
                }

                this._processRenderCommands(this._renderCommands, renderer, viewTransform, vpWidth, vpHeight, camPos, unlitMin);
            } else if (this._spriteDataCount > 0) {
                const sortedSprites = this._sortedSpriteDataTemp;
                sortedSprites.length = this._spriteDataCount;
                for (let i = 0; i < this._spriteDataCount; i++) {
                    sortedSprites[i] = this._spriteDataPool[i];
                }
                sortedSprites.sort(_compareSpriteRenderData);

                const hasLighting = this.lightingManager !== null;
                const needsSplit = hasLighting && unlitMin !== Infinity;
                if (needsSplit) {
                    const litSprites = this._litSpriteDataTemp;
                    const unlitSprites = this._unlitSpriteDataTemp;
                    litSprites.length = 0;
                    unlitSprites.length = 0;

                    for (let i = 0; i < sortedSprites.length; i++) {
                        const sprite = sortedSprites[i];
                        if (sprite.sortingLayer < unlitMin) {
                            litSprites.push(sprite);
                        } else {
                            unlitSprites.push(sprite);
                        }
                    }

                    if (litSprites.length > 0) {
                        this.lightingManager!.packLightUniforms(viewTransform.m);
                        renderer.lightingManager = this.lightingManager;
                        renderer.render(litSprites, vpWidth, vpHeight, viewTransform, camPos);
                    }

                    if (unlitSprites.length > 0) {
                        renderer.lightingManager = null;
                        renderer.render(unlitSprites, vpWidth, vpHeight, viewTransform, camPos);
                    }
                } else {
                    if (hasLighting) {
                        this.lightingManager!.packLightUniforms(viewTransform.m);
                        renderer.lightingManager = this.lightingManager;
                    } else {
                        renderer.lightingManager = null;
                    }
                    renderer.render(sortedSprites, vpWidth, vpHeight, viewTransform, camPos);
                }
            }

            if (this.debugRenderer && this.debugRenderer.enabled) {
                this.debugRenderer.render(viewTransform, vpWidth, vpHeight);
            }
        }

        this._hasMasksLastFrame = this._hasMasks;
        this.onAfterRender.notifyObservers(this);
    }
    public dispose(): void {
        if (this._isDisposed) {
            return;
        }

        if (this._executeWhenReadyTimeoutId !== null) {
            clearTimeout(this._executeWhenReadyTimeoutId);
            this._executeWhenReadyTimeoutId = null;
        }

        const rootsCopy = [...this._rootNodes];
        for (const node of rootsCopy) {
            node.dispose();
        }

        const overlaysCopy = [...this._overlayNodes];
        for (const overlay of overlaysCopy) {
            overlay.dispose();
        }

        this._rootNodes.length = 0;
        this._overlayNodes.length = 0;
        this._allNodes.clear();
        this._renderEntries.length = 0;
        this._renderCommands.length = 0;
        this._sortedSpriteDataTemp.length = 0;
        this._litSpriteDataTemp.length = 0;
        this._unlitSpriteDataTemp.length = 0;
        this._spriteBatchTemp.length = 0;
        this._maskSpriteDataTemp.length = 0;
        this._spriteDataCount = 0;
        this._renderEntryCount = 0;

        if (this._camera) {
            this._camera._setScene(null);
            this._camera = null;
        }

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







