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
import type { RenderCommand2D, MaskPushRenderCommand, IPushRectMaskCommand, IPushSpriteMaskCommand } from "../Masking/renderCommand2D";
import { MaskStateManager } from "../Masking/maskStateManager";
import type { SceneTransition2D } from "../Transition/sceneTransition2D";

interface IRenderEntry2D {
    type: "sprite" | "group";
    sortKey: number;
    insertionOrder: number;
    spriteData: ISprite2DRenderData | null;
    pushCommand: IPushRectMaskCommand | IPushSpriteMaskCommand | null;
    children: IRenderEntry2D[];
}

const _identityViewProjection = Matrix2D.Identity();

function _packSortKey(sortingLayer: number, zIndex: number): number {
    return (sortingLayer << 16) | (zIndex & 0xffff);
}

function _compareRenderEntries(left: IRenderEntry2D, right: IRenderEntry2D): number {
    if (left.sortKey !== right.sortKey) {
        return left.sortKey - right.sortKey;
    }
    return left.insertionOrder - right.insertionOrder;
}

function _compareSpriteRenderData(left: ISprite2DRenderData, right: ISprite2DRenderData): number {
    if (left.sortKey !== right.sortKey) {
        return left.sortKey - right.sortKey;
    }
    return left.insertionOrder - right.insertionOrder;
}

function _createMaskRectRenderData(): ISprite2DRenderData {
    return {
        worldTransform: Matrix2D.Identity(),
        texture: null!,
        uvs: [0, 0, 1, 1],
        color: [1, 1, 1, 1],
        width: 0,
        height: 0,
        alphaMode: Constants.ALPHA_DISABLE,
        sortKey: 0,
        insertionOrder: 0,
        lit: false,
        scrollFactorX: 1,
        scrollFactorY: 1,
    };
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
    /** Reusable screen-space quads for inverted RectMask2D stencil rendering. */
    private _maskScreenRectSpritePoolTemp: ISprite2DRenderData[] = [
        _createMaskRectRenderData(),
        _createMaskRectRenderData(),
        _createMaskRectRenderData(),
        _createMaskRectRenderData(),
    ];
    /** Reusable batch view over the current inverted rect stencil quads. */
    private _maskScreenRectSpriteBatchTemp: ISprite2DRenderData[] = [];
    /** Reusable stack mirroring active mask push commands while processing render commands. */
    private _maskPushCommandStackTemp: MaskPushRenderCommand[] = [];
    /** Reusable sorted sprite buffer for the no-mask fast path. */
    private _sortedSpriteDataTemp: ISprite2DRenderData[] = [];
    /** Reusable per-node render-data collection buffer for non-sprite renderables. */
    private _nodeRenderDataTemp: ISprite2DRenderData[] = [];
    /** Reusable view-projection matrix used when a render pass applies a screen-space offset. */
    private _offsetViewProjectionTemp: Matrix2D = Matrix2D.Identity();
    private _maskStateManager: MaskStateManager | null = null;
    /** Timestamp (ms) of the last auto-update, for computing dt independently of the 3D engine */
    private _lastAutoUpdateTime: number = -1;
    /**
     * Internal overlay nodes rendered on top of rootNodes but not exposed
     * in the public `rootNodes` array. Used by SceneTransition2D.
     * @internal
     */
    private _overlayNodes: Node2D[] = [];
    private _activeTransition: SceneTransition2D | null = null;

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

        if (this._activeTransition && this._activeTransition.isRunning) {
            this._activeTransition.cancel();
        }

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
     * @internal
     * Iterates all nodes currently owned by the scene without allocating a temporary array.
     * @param callback - Callback invoked for each node.
     * @returns Nothing.
     */
    public _forEachNode(callback: (node: Node2D) => void): void {
        for (const node of this._allNodes.values()) {
            callback(node);
        }
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
     * @internal
     * Associates a running scene transition with this scene.
     * @param transition - The transition to attach.
     */
    public _attachSceneTransition(transition: SceneTransition2D): void {
        this._activeTransition = transition;
    }

    /**
     * @internal
     * Removes a previously attached scene transition.
     * @param transition - The transition to detach.
     */
    public _detachSceneTransition(transition: SceneTransition2D): void {
        if (this._activeTransition === transition) {
            this._activeTransition = null;
        }
    }

    /**
     * @internal
     * Gets the currently attached scene transition, if any.
     * @returns The active transition or null.
     */
    public _getSceneTransition(): SceneTransition2D | null {
        return this._activeTransition;
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
                sortKey: 0,
                insertionOrder: 0,
                spriteData: null,
                pushCommand: null,
                children: [],
            });
        }

        const entry = this._renderEntryPool[this._renderEntryCount];
        this._renderEntryCount++;
        entry.type = "sprite";
        entry.sortKey = 0;
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
                entry.sortKey = spriteData.sortKey;
                entry.insertionOrder = spriteData.insertionOrder;
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
        entry.sortKey = spriteData.sortKey;
        entry.insertionOrder = insertionOrder;
        entries.push(entry);
    }

    private _appendCollectedRenderEntries(entries: IRenderEntry2D[], node: RenderableNode2D): void {
        const collected = this._nodeRenderDataTemp;
        collected.length = 0;
        node._collectRenderData(collected, this._getWhiteTexture());

        for (let i = 0; i < collected.length; i++) {
            const spriteData = collected[i];
            const insertionOrder = this._nextRenderInsertionOrder++;
            spriteData.insertionOrder = insertionOrder;
            this._spriteDataPool[this._spriteDataCount] = spriteData;
            this._spriteDataCount++;

            const entry = this._acquireRenderEntry();
            entry.type = "sprite";
            entry.spriteData = spriteData;
            entry.sortKey = spriteData.sortKey;
            entry.insertionOrder = insertionOrder;
            entries.push(entry);
        }

        collected.length = 0;
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
                groupEntry.sortKey = _packSortKey(node.sortingLayer, node.worldZIndex);
                groupEntry.insertionOrder = this._nextRenderInsertionOrder++;
                groupEntry.pushCommand = mask instanceof RectMask2D ? { type: RenderCommandType.PushRectMask, rectMask: mask, maskOwner: node } : { type: RenderCommandType.PushSpriteMask, spriteMask: mask as SpriteMask2D, maskOwner: node };
                targetEntries = groupEntry.children;
                this._hasMasks = true;
            }
        }

        if (node instanceof Sprite2D) {
            this._appendSpriteEntry(targetEntries, node, worldAlpha, worldScrollFactorX, worldScrollFactorY);
        } else if (node instanceof RenderableNode2D) {
            this._appendCollectedRenderEntries(targetEntries, node);
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
            commands.push({ type: RenderCommandType.PopMask });
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
        viewProjection: Readonly<Matrix2D>,
        vpWidth: number,
        vpHeight: number,
        camPos: { x: number; y: number } | null
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

        const spriteBatch = this._spriteBatchTemp;
        spriteBatch.length = 0;
        const maskPushCommands = this._maskPushCommandStackTemp;
        maskPushCommands.length = 0;
        const tempLocalRect = new Rectangle2D();
        const tempViewportRect = new Rectangle2D();

        const flushSpriteBatch = () => {
            if (spriteBatch.length > 0) {
                renderer.render(spriteBatch, viewProjection, this.lightingManager, vpWidth, vpHeight);
                spriteBatch.length = 0;
            }
        };

        for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i];

            switch (cmd.type) {
                case RenderCommandType.Sprite: {
                    spriteBatch.push(cmd.spriteData);
                    break;
                }

                case RenderCommandType.PushRectMask: {
                    flushSpriteBatch();
                    this._resolveRectMaskLocalRect(cmd.rectMask, cmd.maskOwner, tempLocalRect);
                    this._computeMaskViewportRect(tempLocalRect, cmd.maskOwner, viewProjection, camPos, tempViewportRect);

                    if (cmd.rectMask.inverted) {
                        this._renderInvertedRectMaskStencil(tempViewportRect, renderer, vpWidth, vpHeight, maskMgr, false);
                        maskMgr.pushSpriteMask(false);
                    } else {
                        this._clampRectToViewport(tempViewportRect, vpWidth, vpHeight, tempViewportRect);
                        maskMgr.pushRectMask(tempViewportRect, false);
                    }

                    maskPushCommands.push(cmd);
                    break;
                }

                case RenderCommandType.PushSpriteMask: {
                    flushSpriteBatch();

                    const mask = cmd.spriteMask;
                    const maskSpriteData = this._collectMaskSpriteData(mask.sprite);
                    if (maskSpriteData.length > 0) {
                        maskMgr.beginStencilMaskWrite();
                        renderer.renderMaskSprites(maskSpriteData, mask.alphaThreshold, vpWidth, vpHeight, viewProjection, camPos);
                    }

                    maskMgr.pushSpriteMask(mask.inverted);
                    maskPushCommands.push(cmd);
                    break;
                }

                case RenderCommandType.PopMask: {
                    flushSpriteBatch();

                    const pushCommand = maskPushCommands.pop();
                    if (!pushCommand) {
                        break;
                    }

                    if (pushCommand.type === RenderCommandType.PushSpriteMask) {
                        const mask = pushCommand.spriteMask;
                        const maskSpriteData = this._collectMaskSpriteData(mask.sprite);
                        if (maskSpriteData.length > 0) {
                            maskMgr.beginStencilMaskErase();
                            renderer.renderMaskSprites(maskSpriteData, mask.alphaThreshold, vpWidth, vpHeight, viewProjection, camPos);
                        }
                    } else if (pushCommand.rectMask.inverted) {
                        this._resolveRectMaskLocalRect(pushCommand.rectMask, pushCommand.maskOwner, tempLocalRect);
                        this._computeMaskViewportRect(tempLocalRect, pushCommand.maskOwner, viewProjection, camPos, tempViewportRect);
                        this._renderInvertedRectMaskStencil(tempViewportRect, renderer, vpWidth, vpHeight, maskMgr, true);
                    }

                    maskMgr.popMask();
                    break;
                }
            }
        }

        flushSpriteBatch();
        maskPushCommands.length = 0;

        engine.setDepthBuffer(true);
        engine.setAlphaMode(Constants.ALPHA_DISABLE);
    }

    /**
     * Transforms a RectMask2D local rectangle into viewport pixels.
     */
    private _computeMaskViewportRect(
        localRect: Readonly<Rectangle2D>,
        owner: RenderableNode2D,
        viewTransform: Readonly<Matrix2D>,
        camPos: { x: number; y: number } | null,
        outRect: Rectangle2D
    ): void {
        const wtm = owner.worldTransform.m;
        const cm = viewTransform.m;

        const sfx = owner.worldScrollFactorX;
        const sfy = owner.worldScrollFactorY;
        let parallaxDx = 0;
        let parallaxDy = 0;
        if ((sfx !== 1 || sfy !== 1) && camPos) {
            parallaxDx = camPos.x * (1 - sfx);
            parallaxDy = camPos.y * (1 - sfy);
        }

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        const cx0 = localRect.x;
        const cy0 = localRect.y;
        const cx1 = localRect.x + localRect.width;
        const cy1 = localRect.y;
        const cx2 = localRect.x + localRect.width;
        const cy2 = localRect.y + localRect.height;
        const cx3 = localRect.x;
        const cy3 = localRect.y + localRect.height;

        for (let ci = 0; ci < 4; ci++) {
            const px = ci === 0 ? cx0 : ci === 1 ? cx1 : ci === 2 ? cx2 : cx3;
            const py = ci === 0 ? cy0 : ci === 1 ? cy1 : ci === 2 ? cy2 : cy3;
            const wx = wtm[0] * px + wtm[2] * py + wtm[4] + parallaxDx;
            const wy = wtm[1] * px + wtm[3] * py + wtm[5] + parallaxDy;
            const vx = cm[0] * wx + cm[2] * wy + cm[4];
            const vy = cm[1] * wx + cm[3] * wy + cm[5];
            if (vx < minX) {
                minX = vx;
            }
            if (vy < minY) {
                minY = vy;
            }
            if (vx > maxX) {
                maxX = vx;
            }
            if (vy > maxY) {
                maxY = vy;
            }
        }

        outRect.set(minX, minY, maxX - minX, maxY - minY);
    }

    private _clampRectToViewport(rect: Readonly<Rectangle2D>, vpWidth: number, vpHeight: number, outRect: Rectangle2D): void {
        const left = Math.min(Math.max(rect.x, 0), vpWidth);
        const top = Math.min(Math.max(rect.y, 0), vpHeight);
        const right = Math.min(Math.max(rect.x + rect.width, 0), vpWidth);
        const bottom = Math.min(Math.max(rect.y + rect.height, 0), vpHeight);
        outRect.set(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
    }

    private _resolveRectMaskLocalRect(mask: RectMask2D, owner: RenderableNode2D, outRect: Rectangle2D): void {
        const rect = mask.rect;
        let x = rect.x;
        let y = rect.y;
        let width = rect.width;
        let height = rect.height;

        if ((width <= 0 || height <= 0) && owner._getMaskLocalBounds(outRect)) {
            if (width <= 0) {
                x = outRect.x + rect.x;
                width = outRect.width;
            }
            if (height <= 0) {
                y = outRect.y + rect.y;
                height = outRect.height;
            }
        }

        const padding = mask.padding;
        outRect.x = x - padding;
        outRect.y = y - padding;
        outRect.width = Math.max(0, width + padding * 2);
        outRect.height = Math.max(0, height + padding * 2);
    }

    private _renderInvertedRectMaskStencil(
        viewportRect: Readonly<Rectangle2D>,
        renderer: SpriteBatchRenderer,
        vpWidth: number,
        vpHeight: number,
        maskMgr: MaskStateManager,
        erase: boolean
    ): void {
        const maskSprites = this._collectInvertedRectMaskSprites(viewportRect, vpWidth, vpHeight);
        if (maskSprites.length === 0) {
            return;
        }

        if (erase) {
            maskMgr.beginStencilMaskErase();
        } else {
            maskMgr.beginStencilMaskWrite();
        }

        renderer.renderMaskSprites(maskSprites, 0.5, vpWidth, vpHeight, _identityViewProjection, null);
    }

    private _collectInvertedRectMaskSprites(viewportRect: Readonly<Rectangle2D>, vpWidth: number, vpHeight: number): ISprite2DRenderData[] {
        const batch = this._maskScreenRectSpriteBatchTemp;
        batch.length = 0;

        if (vpWidth <= 0 || vpHeight <= 0) {
            return batch;
        }

        const left = Math.min(Math.max(viewportRect.x, 0), vpWidth);
        const top = Math.min(Math.max(viewportRect.y, 0), vpHeight);
        const right = Math.min(Math.max(viewportRect.x + viewportRect.width, 0), vpWidth);
        const bottom = Math.min(Math.max(viewportRect.y + viewportRect.height, 0), vpHeight);
        const overlapWidth = Math.max(0, right - left);
        const overlapHeight = Math.max(0, bottom - top);

        if (overlapWidth <= 0 || overlapHeight <= 0) {
            this._appendScreenMaskRectSprite(batch, 0, 0, vpWidth, vpHeight);
            return batch;
        }

        if (top > 0) {
            this._appendScreenMaskRectSprite(batch, 0, 0, vpWidth, top);
        }
        if (bottom < vpHeight) {
            this._appendScreenMaskRectSprite(batch, 0, bottom, vpWidth, vpHeight - bottom);
        }
        if (left > 0) {
            this._appendScreenMaskRectSprite(batch, 0, top, left, overlapHeight);
        }
        if (right < vpWidth) {
            this._appendScreenMaskRectSprite(batch, right, top, vpWidth - right, overlapHeight);
        }

        return batch;
    }

    private _appendScreenMaskRectSprite(batch: ISprite2DRenderData[], x: number, y: number, width: number, height: number): void {
        if (width <= 0 || height <= 0) {
            return;
        }

        const sprite = this._maskScreenRectSpritePoolTemp[batch.length];
        this._populateMaskRectSprite(sprite, _identityViewProjection, x, y, x + width, y + height, 1, 1);
        batch.push(sprite);
    }

    private _populateMaskRectSprite(
        target: ISprite2DRenderData,
        worldTransform: Matrix2D,
        left: number,
        top: number,
        right: number,
        bottom: number,
        scrollFactorX: number,
        scrollFactorY: number
    ): void {
        target.worldTransform = worldTransform;
        target.texture = this._getWhiteTexture();
        target.width = Math.max(0, right - left);
        target.height = Math.max(0, bottom - top);
        target.alphaMode = Constants.ALPHA_DISABLE;
        target.sortKey = 0;
        target.insertionOrder = 0;
        target.lit = false;
        target.localLeft = left;
        target.localTop = top;
        target.localRight = right;
        target.localBottom = bottom;
        target.uvs[0] = 0;
        target.uvs[1] = 0;
        target.uvs[2] = 1;
        target.uvs[3] = 1;
        target.color[0] = 1;
        target.color[1] = 1;
        target.color[2] = 1;
        target.color[3] = 1;
        target.uvOriginU = 0;
        target.uvOriginV = 0;
        target.uvAxisXU = 1;
        target.uvAxisXV = 0;
        target.uvAxisYU = 0;
        target.uvAxisYV = 1;
        target.scrollFactorX = scrollFactorX;
        target.scrollFactorY = scrollFactorY;
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
        const transition = this._activeTransition;
        if (transition && transition.isRunning) {
            transition._render(true, true, true, deltaTime);
            return;
        }

        const engine = this.engine;
        engine.beginFrame();
        this._renderContentDirect(true, true, deltaTime);
        engine.endFrame();
    }

    /**
     * Renders the scene content without calling engine.beginFrame/endFrame.
     * @param clear - Whether to clear the framebuffer before rendering.
     * @param autoUpdate - Whether to automatically update camera and nodes.
     * @param deltaTime - Optional caller-supplied delta time in seconds.
     */
    public renderContent(clear: boolean = true, autoUpdate: boolean = true, deltaTime?: number): void {
        const transition = this._activeTransition;
        if (transition && transition.isRunning) {
            transition._render(false, clear, autoUpdate, deltaTime);
            return;
        }

        this._renderContentDirect(clear, autoUpdate, deltaTime);
    }

    /**
     * @internal
     * Renders this scene's own content without transition interception.
     * @param clear - Whether to clear the framebuffer before rendering.
     * @param autoUpdate - Whether to automatically update camera and nodes.
     * @param deltaTime - Optional caller-supplied delta time in seconds.
     */
    public _renderContentDirect(clear: boolean = true, autoUpdate: boolean = true, deltaTime?: number): void {
        const engine = this.engine;

        this.onBeforeRender.notifyObservers(this);

        if (autoUpdate) {
            const resolvedDeltaTime = deltaTime ?? this._computeDeltaTime();
            if (this.camera) {
                this.camera.update(resolvedDeltaTime, engine.getRenderWidth(), engine.getRenderHeight());
            }
            this.update(resolvedDeltaTime);
        }

        this._renderPreparedContent(clear, null, 0, 0);
        this.onAfterRender.notifyObservers(this);
    }

    /**
     * @internal
     * Renders a single node subtree into the currently bound framebuffer.
     * @param rootNode - Root node whose subtree should be rendered.
     * @param clear - Whether to clear before rendering.
     * @param viewportOffsetX - Horizontal screen-space offset in pixels.
     * @param viewportOffsetY - Vertical screen-space offset in pixels.
     */
    public _renderSubtreeContent(rootNode: Node2D, clear: boolean = true, viewportOffsetX: number = 0, viewportOffsetY: number = 0): void {
        this.onBeforeRender.notifyObservers(this);
        this._renderPreparedContent(clear, rootNode, viewportOffsetX, viewportOffsetY);
        this.onAfterRender.notifyObservers(this);
    }

    private _renderPreparedContent(clear: boolean, rootNode: Node2D | null, viewportOffsetX: number, viewportOffsetY: number): void {
        const engine = this.engine;
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

            if (rootNode) {
                this._collectRenderEntries(rootNode, this._renderEntries, 1, 1, 1);
            } else {
                for (const root of this._rootNodes) {
                    this._collectRenderEntries(root, this._renderEntries, 1, 1, 1);
                }
                for (const overlay of this._overlayNodes) {
                    this._collectRenderEntries(overlay, this._renderEntries, 1, 1, 1);
                }
            }

            const vpWidth = engine.getRenderWidth();
            const vpHeight = engine.getRenderHeight();
            const viewProjection = this._resolveViewProjection(viewportOffsetX, viewportOffsetY);
            const camPos = this.camera ? this.camera.position : null;

            if (this._hasMasks) {
                this._sortRenderEntries(this._renderEntries);
                this._flattenRenderEntries(this._renderEntries, this._renderCommands);

                this._processRenderCommands(this._renderCommands, renderer, viewProjection, vpWidth, vpHeight, camPos);
            } else if (this._spriteDataCount > 0) {
                const sortedSprites = this._sortedSpriteDataTemp;
                sortedSprites.length = this._spriteDataCount;
                for (let i = 0; i < this._spriteDataCount; i++) {
                    sortedSprites[i] = this._spriteDataPool[i];
                }
                sortedSprites.sort(_compareSpriteRenderData);

                renderer.render(sortedSprites, viewProjection, this.lightingManager, vpWidth, vpHeight);
            }

            if (this.debugRenderer && this.debugRenderer.enabled) {
                if (rootNode === null && viewportOffsetX === 0 && viewportOffsetY === 0) {
                    this.debugRenderer.render(this, this.camera);
                } else {
                    this.debugRenderer.render(viewProjection, vpWidth, vpHeight);
                }
            }
        }

        this._hasMasksLastFrame = this._hasMasks;
    }

    private _resolveViewProjection(viewportOffsetX: number, viewportOffsetY: number): Readonly<Matrix2D> {
        const baseViewProjection = this.camera ? this.camera.getViewProjectionMatrix() : _identityViewProjection;
        if (viewportOffsetX === 0 && viewportOffsetY === 0) {
            return baseViewProjection;
        }

        const offsetViewProjection = this._offsetViewProjectionTemp;
        offsetViewProjection.copyFrom(baseViewProjection);
        offsetViewProjection.m[4] += viewportOffsetX;
        offsetViewProjection.m[5] += viewportOffsetY;
        return offsetViewProjection;
    }

    public dispose(): void {
        if (this._isDisposed) {
            return;
        }

        if (this._activeTransition && this._activeTransition.isRunning) {
            this._activeTransition.cancel();
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
        this._nodeRenderDataTemp.length = 0;
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







