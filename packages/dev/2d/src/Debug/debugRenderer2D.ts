import type { AbstractEngine } from "core/Engines/abstractEngine";
import { Buffer, VertexBuffer } from "core/Buffers/buffer";
import type { DataBuffer } from "core/Buffers/dataBuffer";
import { Constants } from "core/Engines/constants";
import { ShaderStore } from "core/Engines/shaderStore";
import { Color4 } from "core/Maths/math.color";
import type { IMatrixLike } from "core/Maths/math.like";
import { TmpVectors, Vector2 } from "core/Maths/math.vector";
import { Logger } from "core/Misc/logger";
import { DrawWrapper } from "core/Materials/drawWrapper";
import type { Effect } from "core/Materials/effect";
import { ShaderLanguage } from "core/Materials/shaderLanguage";
import type { Nullable } from "core/types";

import { SpatialGrid } from "../Collision/spatialGrid";
import type { Grid2D } from "../Grid/grid2D";
import type { IsometricGrid } from "../Isometric/isometricGrid";
import { Matrix2D } from "../Math/matrix2D";
import { Rectangle2D } from "../Math/rectangle2D";
import type { AStarPathfinder } from "../Pathfinding/aStarPathfinder";
import type { IPhysicsDebugDataSource2D, IPhysicsEngine2D, PhysicsShape2DOptions } from "../Physics/physicsEngine2D";
import type { Camera2D } from "../Camera2D/camera2D";
import type { Scene2D } from "../Scene2D/scene2D";
import type { Node2D } from "../Node2D/node2D";

const _DEBUG_VERT_GLSL = `
precision highp float;

attribute vec2 position;
attribute vec4 color;

uniform mat4 projView;

varying vec4 vColor;

void main(void) {
    gl_Position = projView * vec4(position, 0.0, 1.0);
    vColor = color;
}
`;

const _DEBUG_FRAG_GLSL = `
precision highp float;

varying vec4 vColor;

void main(void) {
    gl_FragColor = vColor;
}
`;

const _DEBUG_VERT_WGSL = `
attribute position: vec2f;
attribute color: vec4f;

uniform projView: mat4x4f;

varying vColor: vec4f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    vertexOutputs.position = uniforms.projView * vec4f(input.position, 0.0, 1.0);
    vertexOutputs.vColor = input.color;
}
`;

const _DEBUG_FRAG_WGSL = `
varying vColor: vec4f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    fragmentOutputs.color = input.vColor;
}
`;

ShaderStore.ShadersStore["debug2DVertexShader"] = _DEBUG_VERT_GLSL;
ShaderStore.ShadersStore["debug2DPixelShader"] = _DEBUG_FRAG_GLSL;
ShaderStore.ShadersStoreWGSL["debug2DVertexShader"] = _DEBUG_VERT_WGSL;
ShaderStore.ShadersStoreWGSL["debug2DPixelShader"] = _DEBUG_FRAG_WGSL;

const _FLOATS_PER_VERTEX = 6;
const _CIRCLE_SEGMENTS = 32;
const _DEFAULT_LINE_CAPACITY = 16384;
const _DEFAULT_POINT_SIZE = 4;

const _UNIT_CIRCLE: Float64Array = (() => {
    const table = new Float64Array(_CIRCLE_SEGMENTS * 2);
    const step = (Math.PI * 2) / _CIRCLE_SEGMENTS;
    for (let i = 0; i < _CIRCLE_SEGMENTS; i++) {
        const angle = (i + 1) * step;
        table[i * 2] = Math.cos(angle);
        table[i * 2 + 1] = Math.sin(angle);
    }
    return table;
})();

type MatrixTuple16 = [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
];

interface ISizedNodeLike {
    width?: number;
    height?: number;
    getDisplayWidth?(): number;
    getDisplayHeight?(): number;
    getMeasuredWidth?(): number;
    getMeasuredHeight?(): number;
}

/**
 * Renders wireframe debug overlays using line primitives.
 */
export class DebugRenderer2D {
    private static readonly _IdentityViewTransform = Matrix2D.Identity();

    /** Master toggle for all debug rendering. */
    public enabled: boolean = true;
    /** Show collision shape outlines. */
    public showColliders: boolean = true;
    /** Show physics body outlines. */
    public showPhysicsBodies: boolean = true;
    /** Show occupied spatial-grid cell outlines. */
    public showSpatialGrid: boolean = false;
    /** Show pathfinding visualization. */
    public showPathfinding: boolean = false;
    /** Show camera bounds when render(scene, camera) is used. */
    public showCameraBounds: boolean = false;
    /** Show node bounds when render(scene, camera) is used. */
    public showNodeBounds: boolean = false;
    /** Requested line width in pixels. The current renderer uses the platform line primitive width. */
    public lineWidth: number = 1;

    /** Color for collision shape outlines. */
    public colliderColor: Color4 = new Color4(0, 1, 0, 1);
    /** Color for physics body outlines. */
    public physicsColor: Color4 = new Color4(0, 0.7, 1, 1);
    /** Color for spatial-grid lines. */
    public gridColor: Color4 = new Color4(0.3, 0.3, 0.3, 0.5);
    /** Color for pathfinding and camera overlays. */
    public pathfindingColor: Color4 = new Color4(0, 0.4, 0, 0.3);

    /** Spatial grid data source. */
    public spatialGrid: SpatialGrid | null = null;
    /** Physics engine data source. */
    public physicsEngine: IPhysicsEngine2D | null = null;
    /** Pathfinder data source. */
    public pathfinder: AStarPathfinder | null = null;
    /** Pathfinding grid data source. */
    public pathfinderGrid: Grid2D | IsometricGrid | null = null;

    private readonly _engine: AbstractEngine;
    private _effect: Effect | null = null;
    private _drawWrapper: DrawWrapper | null = null;
    private _isReady: boolean = false;
    private readonly _vertexData: Float32Array;
    private _buffer: Buffer | null = null;
    private _positionVB: VertexBuffer | null = null;
    private _colorVB: VertexBuffer | null = null;
    private readonly _vertexBuffersMap: { [key: string]: VertexBuffer } = {};
    private _lineCount: number = 0;
    private _customLineCount: number = 0;
    private readonly _capacity: number;
    private _didWarnCapacity: boolean = false;
    private readonly _projViewData: MatrixTuple16 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    private readonly _projViewMatrix: IMatrixLike;
    private readonly _cameraBounds: Rectangle2D = new Rectangle2D();

    /**
     * Creates a new DebugRenderer2D.
     * @param engine - The Babylon.js engine instance.
     * @param lineCapacity - Maximum number of line segments per frame.
     */
    constructor(engine: AbstractEngine, lineCapacity: number = _DEFAULT_LINE_CAPACITY) {
        this._engine = engine;
        this._capacity = lineCapacity;
        this._vertexData = new Float32Array(lineCapacity * 2 * _FLOATS_PER_VERTEX);

        const pvData = this._projViewData;
        this._projViewMatrix = {
            asArray: () => pvData,
            updateFlag: 0,
        };

        this._setupShader();
    }


    /**
     * Whether the debug renderer shader is compiled and ready.
     * @returns True when the shader is ready.
     */
    public get isReady(): boolean {
        if (!this._isReady && this._effect && this._effect.isReady()) {
            this._isReady = true;
        }
        return this._isReady;
    }

    /**
     * Registers a physics engine for debug visualization.
     * @param physics - The physics engine.
     * @returns Nothing.
     */
    public setPhysicsEngine(physics: IPhysicsEngine2D): void {
        this.physicsEngine = physics;
    }

    /**
     * Registers a spatial grid for debug visualization.
     * @param grid - The spatial grid.
     * @returns Nothing.
     */
    public setSpatialGrid(grid: SpatialGrid): void {
        this.spatialGrid = grid;
    }

    /**
     * Registers a pathfinder for debug visualization.
     * @param finder - The pathfinder.
     * @returns Nothing.
     */
    public setPathfinder(finder: AStarPathfinder): void {
        this.pathfinder = finder;
    }

    /**
     * Clears all queued one-frame custom draw calls.
     * @returns Nothing.
     */
    public clear(): void {
        this._customLineCount = 0;
    }

    private _setupShader(): void {
        const shaderLanguage = this._engine.isWebGPU ? ShaderLanguage.WGSL : ShaderLanguage.GLSL;
        this._buffer = new Buffer(this._engine, this._vertexData, true, _FLOATS_PER_VERTEX);
        this._positionVB = this._buffer.createVertexBuffer(VertexBuffer.PositionKind, 0, 2, _FLOATS_PER_VERTEX);
        this._colorVB = this._buffer.createVertexBuffer(VertexBuffer.ColorKind, 2, 4, _FLOATS_PER_VERTEX);
        this._vertexBuffersMap[VertexBuffer.PositionKind] = this._positionVB;
        this._vertexBuffersMap[VertexBuffer.ColorKind] = this._colorVB;
        this._effect = this._engine.createEffect(
            "debug2D",
            [VertexBuffer.PositionKind, VertexBuffer.ColorKind],
            ["projView"],
            [],
            "",
            undefined,
            undefined,
            undefined,
            undefined,
            shaderLanguage
        );
        this._drawWrapper = new DrawWrapper(this._engine);
        this._drawWrapper.effect = this._effect;
    }

    private _warnCapacityExceeded(): void {
        if (!this._didWarnCapacity) {
            this._didWarnCapacity = true;
            Logger.Warn(`DebugRenderer2D line capacity of ${this._capacity} was exceeded; excess debug draw calls were dropped.`);
        }
    }

    private _writeLineAt(index: number, x1: number, y1: number, x2: number, y2: number, color: Color4): void {
        const offset = index * 2 * _FLOATS_PER_VERTEX;
        const d = this._vertexData;

        d[offset] = x1;
        d[offset + 1] = y1;
        d[offset + 2] = color.r;
        d[offset + 3] = color.g;
        d[offset + 4] = color.b;
        d[offset + 5] = color.a;

        d[offset + 6] = x2;
        d[offset + 7] = y2;
        d[offset + 8] = color.r;
        d[offset + 9] = color.g;
        d[offset + 10] = color.b;
        d[offset + 11] = color.a;
    }

    private _queueLine(x1: number, y1: number, x2: number, y2: number, color: Color4): void {
        if (this._customLineCount >= this._capacity) {
            this._warnCapacityExceeded();
            return;
        }

        this._writeLineAt(this._customLineCount, x1, y1, x2, y2, color);
        this._customLineCount++;
        if (this._lineCount < this._customLineCount) {
            this._lineCount = this._customLineCount;
        }
    }

    private _appendLine(x1: number, y1: number, x2: number, y2: number, color: Color4): void {
        if (this._lineCount >= this._capacity) {
            this._warnCapacityExceeded();
            return;
        }

        this._writeLineAt(this._lineCount, x1, y1, x2, y2, color);
        this._lineCount++;
    }

    private _appendRectTopLeft(x: number, y: number, width: number, height: number, color: Color4): void {
        const right = x + width;
        const bottom = y + height;
        this._appendLine(x, y, right, y, color);
        this._appendLine(right, y, right, bottom, color);
        this._appendLine(right, bottom, x, bottom, color);
        this._appendLine(x, bottom, x, y, color);
    }

    private _appendRectCentered(x: number, y: number, halfWidth: number, halfHeight: number, color: Color4): void {
        this._appendRectTopLeft(x - halfWidth, y - halfHeight, halfWidth * 2, halfHeight * 2, color);
    }

    private _appendCrossHatchRectCentered(x: number, y: number, halfWidth: number, halfHeight: number, color: Color4): void {
        const left = x - halfWidth;
        const right = x + halfWidth;
        const top = y - halfHeight;
        const bottom = y + halfHeight;
        this._appendLine(left, top, right, bottom, color);
        this._appendLine(right, top, left, bottom, color);
    }

    private _emitCircle(cx: number, cy: number, radius: number, segments: number, color: Color4, queue: boolean): void {
        if (segments <= 0) {
            return;
        }

        let prevX = cx + radius;
        let prevY = cy;

        if (segments === _CIRCLE_SEGMENTS) {
            for (let i = 0; i < _CIRCLE_SEGMENTS; i++) {
                const nx = cx + _UNIT_CIRCLE[i * 2] * radius;
                const ny = cy + _UNIT_CIRCLE[i * 2 + 1] * radius;
                if (queue) {
                    this._queueLine(prevX, prevY, nx, ny, color);
                } else {
                    this._appendLine(prevX, prevY, nx, ny, color);
                }
                prevX = nx;
                prevY = ny;
            }
            return;
        }

        const step = (Math.PI * 2) / segments;
        for (let i = 1; i <= segments; i++) {
            const angle = i * step;
            const nx = cx + Math.cos(angle) * radius;
            const ny = cy + Math.sin(angle) * radius;
            if (queue) {
                this._queueLine(prevX, prevY, nx, ny, color);
            } else {
                this._appendLine(prevX, prevY, nx, ny, color);
            }
            prevX = nx;
            prevY = ny;
        }
    }

    private _appendCircle(cx: number, cy: number, radius: number, segments: number, color: Color4): void {
        this._emitCircle(cx, cy, radius, segments, color, false);
    }

    private _appendRotatedSegment(
        centerX: number,
        centerY: number,
        rotation: number,
        ax: number,
        ay: number,
        bx: number,
        by: number,
        color: Color4
    ): void {
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const worldAx = centerX + ax * cos - ay * sin;
        const worldAy = centerY + ax * sin + ay * cos;
        const worldBx = centerX + bx * cos - by * sin;
        const worldBy = centerY + bx * sin + by * cos;
        this._appendLine(worldAx, worldAy, worldBx, worldBy, color);
    }

    private _appendRotatedPolygon(centerX: number, centerY: number, rotation: number, vertices: readonly Vector2[], color: Color4): void {
        for (let i = 0; i < vertices.length; i++) {
            const a = vertices[i];
            const b = vertices[(i + 1) % vertices.length];
            this._appendRotatedSegment(centerX, centerY, rotation, a.x, a.y, b.x, b.y, color);
        }
    }

    private _appendRotatedRectangle(centerX: number, centerY: number, halfWidth: number, halfHeight: number, rotation: number, color: Color4): void {
        this._appendRotatedSegment(centerX, centerY, rotation, -halfWidth, -halfHeight, halfWidth, -halfHeight, color);
        this._appendRotatedSegment(centerX, centerY, rotation, halfWidth, -halfHeight, halfWidth, halfHeight, color);
        this._appendRotatedSegment(centerX, centerY, rotation, halfWidth, halfHeight, -halfWidth, halfHeight, color);
        this._appendRotatedSegment(centerX, centerY, rotation, -halfWidth, halfHeight, -halfWidth, -halfHeight, color);
    }

    private _appendPhysicsShape(centerX: number, centerY: number, rotation: number, shape: PhysicsShape2DOptions, color: Color4): void {
        switch (shape.type) {
            case "box":
                this._appendRotatedRectangle(centerX, centerY, shape.width / 2, shape.height / 2, rotation + (shape.angle ?? 0), color);
                return;
            case "circle":
                this._appendCircle(centerX, centerY, shape.radius, _CIRCLE_SEGMENTS, color);
                return;
            case "polygon":
                this._appendRotatedPolygon(centerX, centerY, rotation, shape.vertices, color);
                return;
            case "edge":
                this._appendRotatedSegment(centerX, centerY, rotation, shape.v1.x, shape.v1.y, shape.v2.x, shape.v2.y, color);
                return;
            case "capsule": {
                if (Math.abs(shape.width - shape.height) < 1e-5) {
                    this._appendCircle(centerX, centerY, shape.width / 2, _CIRCLE_SEGMENTS, color);
                    return;
                }

                const cos = Math.cos(rotation);
                const sin = Math.sin(rotation);

                if (shape.height > shape.width) {
                    const radius = shape.width / 2;
                    const offset = (shape.height - shape.width) / 2;
                    this._appendCircle(centerX + offset * sin, centerY - offset * cos, radius, _CIRCLE_SEGMENTS, color);
                    this._appendCircle(centerX - offset * sin, centerY + offset * cos, radius, _CIRCLE_SEGMENTS, color);
                    this._appendRotatedSegment(centerX, centerY, rotation, -radius, -offset, -radius, offset, color);
                    this._appendRotatedSegment(centerX, centerY, rotation, radius, -offset, radius, offset, color);
                    return;
                }

                const radius = shape.height / 2;
                const offset = (shape.width - shape.height) / 2;
                this._appendCircle(centerX - offset * cos, centerY - offset * sin, radius, _CIRCLE_SEGMENTS, color);
                this._appendCircle(centerX + offset * cos, centerY + offset * sin, radius, _CIRCLE_SEGMENTS, color);
                this._appendRotatedSegment(centerX, centerY, rotation, -offset, -radius, offset, -radius, color);
                this._appendRotatedSegment(centerX, centerY, rotation, -offset, radius, offset, radius, color);
                return;
            }
        }
    }

    private _tryGetNodeSize(node: Node2D): { width: number; height: number } | null {
        const sizedNode = node as Node2D & ISizedNodeLike;
        let width: number | undefined;
        let height: number | undefined;

        if (typeof sizedNode.getDisplayWidth === "function" && typeof sizedNode.getDisplayHeight === "function") {
            width = sizedNode.getDisplayWidth();
            height = sizedNode.getDisplayHeight();
        } else if (typeof sizedNode.getMeasuredWidth === "function" && typeof sizedNode.getMeasuredHeight === "function") {
            width = sizedNode.getMeasuredWidth();
            height = sizedNode.getMeasuredHeight();
        } else if (typeof sizedNode.width === "number" && typeof sizedNode.height === "number") {
            width = sizedNode.width;
            height = sizedNode.height;
        }

        if (width === undefined || height === undefined || width <= 0 || height <= 0) {
            return null;
        }

        return { width, height };
    }

    private _collectNodeBounds(scene: Scene2D): void {
        const p0 = TmpVectors.Vector2[0];
        const p1 = TmpVectors.Vector2[1];
        const p2 = TmpVectors.Vector2[2];
        const p3 = TmpVectors.Vector2[3];

        scene._forEachNode((node) => {
            const size = this._tryGetNodeSize(node);
            if (!size) {
                return;
            }

            const transform = node.worldTransform;
            transform.transformPoint(0, 0, p0);
            transform.transformPoint(size.width, 0, p1);
            transform.transformPoint(size.width, size.height, p2);
            transform.transformPoint(0, size.height, p3);

            const minX = Math.min(p0.x, p1.x, p2.x, p3.x);
            const minY = Math.min(p0.y, p1.y, p2.y, p3.y);
            const maxX = Math.max(p0.x, p1.x, p2.x, p3.x);
            const maxY = Math.max(p0.y, p1.y, p2.y, p3.y);

            this._appendRectTopLeft(minX, minY, maxX - minX, maxY - minY, this.gridColor);
        });
    }

    private _collectCameraBounds(camera: Camera2D): void {
        camera.getVisibleWorldRectToRef(this._cameraBounds);
        if (this._cameraBounds.width <= 0 || this._cameraBounds.height <= 0) {
            return;
        }

        this._appendRectTopLeft(this._cameraBounds.x, this._cameraBounds.y, this._cameraBounds.width, this._cameraBounds.height, this.pathfindingColor);
    }

    private _collectFromSources(): void {
        if (this.showColliders && this.spatialGrid) {
            this._collectColliders();
        }
        if (this.showPhysicsBodies && this.physicsEngine) {
            this._collectPhysicsBodies();
        }
        if (this.showSpatialGrid && this.spatialGrid) {
            this._collectSpatialGridCells();
        }
        if (this.showPathfinding && this.pathfinder && this.pathfinderGrid) {
            this._collectPathfindingGrid();
        }
    }

    private _collectColliders(): void {
        const entries = this.spatialGrid!.allEntries;
        const color = this.colliderColor;

        for (const entry of entries) {
            const wp = entry.node.worldPosition;
            for (const shape of entry.shapes) {
                const cx = wp.x + shape.offset.x;
                const cy = wp.y + shape.offset.y;

                if (shape.type === "box") {
                    this._appendRectCentered(cx, cy, shape.width / 2, shape.height / 2, color);
                } else if (shape.type === "circle") {
                    this._appendCircle(cx, cy, shape.radius, _CIRCLE_SEGMENTS, color);
                } else if (shape.type === "polygon") {
                    const vertices = shape.vertices;
                    for (let i = 0; i < vertices.length; i++) {
                        const a = vertices[i];
                        const b = vertices[(i + 1) % vertices.length];
                        this._appendLine(cx + a.x, cy + a.y, cx + b.x, cy + b.y, color);
                    }
                }
            }
        }
    }

    private _collectPhysicsBodies(): void {
        const debugSource = this.physicsEngine as IPhysicsEngine2D & Partial<IPhysicsDebugDataSource2D>;
        if (typeof debugSource._getDebugBodies !== "function") {
            return;
        }

        const bodies = debugSource._getDebugBodies();
        for (const body of bodies) {
            const pos = body.node.worldPosition;
            this._appendPhysicsShape(pos.x, pos.y, body.node.rotation, body.shape, this.physicsColor);
        }
    }

    private _collectSpatialGridCells(): void {
        const cellSize = this.spatialGrid!.cellSize;
        const color = this.gridColor;

        for (const key of this.spatialGrid!.occupiedCellKeys) {
            const { row, col } = SpatialGrid.decodeCellKey(key);
            const x = col * cellSize;
            const y = row * cellSize;
            this._appendRectTopLeft(x, y, cellSize, cellSize, color);
        }
    }

    private _collectPathfindingGrid(): void {
        const pathfinder = this.pathfinder!;
        const grid = this.pathfinderGrid!;
        const width = pathfinder.gridWidth;
        const height = pathfinder.gridHeight;
        const tempVec = TmpVectors.Vector2[0];
        const isGrid2D = "cellToWorldToRef" in grid;
        const halfSize = isGrid2D ? (grid as Grid2D).cellSize / 2 : Math.min((grid as IsometricGrid).tileWidth, (grid as IsometricGrid).tileHeight) / 2;

        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
                const walkable = pathfinder.isWalkable(col, row);

                if (isGrid2D) {
                    (grid as Grid2D).cellToWorldToRef(col, row, tempVec);
                } else {
                    const pos = (grid as IsometricGrid).tileToWorld(col, row);
                    tempVec.x = pos.x;
                    tempVec.y = pos.y;
                }

                if (walkable) {
                    this._appendRectCentered(tempVec.x, tempVec.y, halfSize, halfSize, this.pathfindingColor);
                } else {
                    this._appendCrossHatchRectCentered(tempVec.x, tempVec.y, halfSize, halfSize, this.pathfindingColor);
                    this._appendRectCentered(tempVec.x, tempVec.y, halfSize, halfSize, this.pathfindingColor);
                }
            }
        }
    }

    /**
     * Draws a world-space line for one frame.
     * @param x1 - Start X coordinate.
     * @param y1 - Start Y coordinate.
     * @param x2 - End X coordinate.
     * @param y2 - End Y coordinate.
     * @param color - Optional line color.
     * @returns Nothing.
     */
    public drawLine(x1: number, y1: number, x2: number, y2: number, color: Color4 = this.colliderColor): void {
        this._queueLine(x1, y1, x2, y2, color);
    }

    /**
     * Draws a world-space rectangle outline for one frame.
     * @param x - Top-left X coordinate.
     * @param y - Top-left Y coordinate.
     * @param width - Rectangle width.
     * @param height - Rectangle height.
     * @param color - Optional line color.
     * @returns Nothing.
     */
    public drawRect(x: number, y: number, width: number, height: number, color: Color4 = this.colliderColor): void {
        const right = x + width;
        const bottom = y + height;
        this.drawLine(x, y, right, y, color);
        this.drawLine(right, y, right, bottom, color);
        this.drawLine(right, bottom, x, bottom, color);
        this.drawLine(x, bottom, x, y, color);
    }

    /**
     * Draws a world-space circle outline for one frame.
     * @param cx - Center X coordinate.
     * @param cy - Center Y coordinate.
     * @param radius - Circle radius.
     * @param segmentsOrColor - Optional segment count or color.
     * @param color - Optional line color when segment count is supplied.
     * @returns Nothing.
     */
    public drawCircle(cx: number, cy: number, radius: number, segmentsOrColor?: number | Color4, color?: Color4): void {
        const segments = typeof segmentsOrColor === "number" ? segmentsOrColor : _CIRCLE_SEGMENTS;
        const resolvedColor = segmentsOrColor instanceof Color4 ? segmentsOrColor : color ?? this.colliderColor;
        this._emitCircle(cx, cy, radius, segments, resolvedColor, true);
    }

    /**
     * Draws a world-space point as a small crosshair for one frame.
     * @param x - Point X coordinate.
     * @param y - Point Y coordinate.
     * @param size - Crosshair size.
     * @param color - Optional line color.
     * @returns Nothing.
     */
    public drawPoint(x: number, y: number, size: number = _DEFAULT_POINT_SIZE, color: Color4 = this.colliderColor): void {
        const half = size * 0.5;
        this.drawLine(x - half, y, x + half, y, color);
        this.drawLine(x, y - half, x, y + half, color);
    }

    /**
     * Draws a world-space polygon outline for one frame.
     * @param vertices - Polygon vertices.
     * @param color - Optional line color.
     * @returns Nothing.
     */
    public drawPolygon(vertices: Vector2[], color: Color4 = this.colliderColor): void {
        if (vertices.length < 2) {
            return;
        }

        for (let i = 0; i < vertices.length; i++) {
            const a = vertices[i];
            const b = vertices[(i + 1) % vertices.length];
            this.drawLine(a.x, a.y, b.x, b.y, color);
        }
    }

    /**
     * Draws a centered cross-hatch rectangle for one frame.
     * @param x - Center X coordinate.
     * @param y - Center Y coordinate.
     * @param halfWidth - Half-width.
     * @param halfHeight - Half-height.
     * @param color - Optional line color.
     * @returns Nothing.
     */
    public drawCrossHatchRect(x: number, y: number, halfWidth: number, halfHeight: number, color: Color4 = this.colliderColor): void {
        const left = x - halfWidth;
        const right = x + halfWidth;
        const top = y - halfHeight;
        const bottom = y + halfHeight;
        this.drawLine(left, top, right, bottom, color);
        this.drawLine(right, top, left, bottom, color);
    }

    /**
     * Renders all overlays using the scene/camera overload.
     * @param scene - The scene whose overlays should be rendered.
     * @param camera - The active camera, or null.
     */
    public render(scene: Scene2D, camera: Camera2D | null): void;
    /**
     * Renders all overlays using an explicit view transform and viewport.
     * @param viewTransform - The view transform.
     * @param vpWidth - Viewport width.
     * @param vpHeight - Viewport height.
     */
    public render(viewTransform: Matrix2D, vpWidth: number, vpHeight: number): void;
    public render(sceneOrViewTransform: Scene2D | Matrix2D, cameraOrWidth: Camera2D | number | null, vpHeight?: number): void {
        if (sceneOrViewTransform instanceof Matrix2D) {
            this._renderInternal(sceneOrViewTransform, cameraOrWidth as number, vpHeight ?? 0, null, null);
            return;
        }

        const scene = sceneOrViewTransform;
        const camera = (typeof cameraOrWidth === "number" ? null : cameraOrWidth) ?? scene.camera;
        const vpWidth = camera?.viewportWidth || scene.engine.getRenderWidth();
        const resolvedVpHeight = camera?.viewportHeight || scene.engine.getRenderHeight();
        const viewTransform = camera ? camera.getViewTransform() : DebugRenderer2D._IdentityViewTransform;
        this._renderInternal(viewTransform, vpWidth, resolvedVpHeight, scene, camera);
    }

    private _renderInternal(viewTransform: Matrix2D, vpWidth: number, vpHeight: number, scene: Scene2D | null, camera: Camera2D | null): void {
        this._lineCount = this._customLineCount;
        this._customLineCount = 0;
        this._didWarnCapacity = false;

        if (!this.enabled || !this.isReady) {
            this._lineCount = 0;
            return;
        }

        this._collectFromSources();

        if (scene) {
            if (this.showCameraBounds && camera) {
                this._collectCameraBounds(camera);
            }
            if (this.showNodeBounds) {
                this._collectNodeBounds(scene);
            }
        }

        if (this._lineCount === 0) {
            return;
        }

        const engine = this._engine;
        engine.setAlphaMode(Constants.ALPHA_COMBINE);
        engine.setDepthBuffer(false);
        engine.setState(false);
        engine.enableEffect(this._drawWrapper!);

        const vm = viewTransform.m;
        const p = this._projViewData;
        const px = vpWidth === 0 ? 0 : 2.0 / vpWidth;
        const py = vpHeight === 0 ? 0 : -2.0 / vpHeight;

        p[0] = px * vm[0];
        p[1] = py * vm[1];
        p[2] = 0;
        p[3] = 0;

        p[4] = px * vm[2];
        p[5] = py * vm[3];
        p[6] = 0;
        p[7] = 0;

        p[8] = 0;
        p[9] = 0;
        p[10] = 1;
        p[11] = 0;

        p[12] = px * vm[4] - 1;
        p[13] = py * vm[5] + 1;
        p[14] = 0;
        p[15] = 1;

        this._projViewMatrix.updateFlag++;
        this._effect!.setMatrix("projView", this._projViewMatrix);

        const vertexCount = this._lineCount * 2;
        this._buffer!.updateDirectly(this._vertexData, 0, vertexCount);
        engine.bindBuffers(this._vertexBuffersMap, null as Nullable<DataBuffer>, this._effect!);
        engine.drawArraysType(Constants.MATERIAL_LineListDrawMode, 0, vertexCount);

        engine.setDepthBuffer(true);
        engine.setAlphaMode(Constants.ALPHA_DISABLE);
        this._lineCount = 0;
    }

    /**
     * Disposes the debug renderer and GPU resources.
     * @returns Nothing.
     */
    public dispose(): void {
        this._customLineCount = 0;
        this._lineCount = 0;

        if (this._positionVB) {
            this._positionVB.dispose();
            this._positionVB = null;
        }
        if (this._colorVB) {
            this._colorVB.dispose();
            this._colorVB = null;
        }
        if (this._buffer) {
            this._buffer.dispose();
            this._buffer = null;
        }
        if (this._effect) {
            this._effect.dispose();
            this._effect = null;
        }

        this._drawWrapper = null;
    }
}
