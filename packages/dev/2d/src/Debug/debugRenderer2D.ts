import type { AbstractEngine } from "core/Engines/abstractEngine";
import { Buffer, VertexBuffer } from "core/Buffers/buffer";
import { DrawWrapper } from "core/Materials/drawWrapper";
import type { Effect } from "core/Materials/effect";
import { ShaderStore } from "core/Engines/shaderStore";
import { ShaderLanguage } from "core/Materials/shaderLanguage";
import { Constants } from "core/Engines/constants";
import { Color4 } from "core/Maths/math.color";
import { TmpVectors, Vector2 } from "core/Maths/math.vector";
import type { IMatrixLike } from "core/Maths/math.like";
import type { Nullable } from "core/types";
import type { DataBuffer } from "core/Buffers/dataBuffer";

import type { Matrix2D } from "../Math/matrix2D";
import { SpatialGrid } from "../Collision/spatialGrid";
import type { IPhysicsEngine2D } from "../Physics/physicsEngine2D";
import { PhysicsBodyType2D } from "../Physics/physicsEngine2D";
import type { AStarPathfinder } from "../Pathfinding/aStarPathfinder";
import type { Grid2D } from "../Grid/grid2D";

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

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

// Register shaders
ShaderStore.ShadersStore["debug2DVertexShader"] = _DEBUG_VERT_GLSL;
ShaderStore.ShadersStore["debug2DPixelShader"] = _DEBUG_FRAG_GLSL;
ShaderStore.ShadersStoreWGSL["debug2DVertexShader"] = _DEBUG_VERT_WGSL;
ShaderStore.ShadersStoreWGSL["debug2DPixelShader"] = _DEBUG_FRAG_WGSL;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of floats per vertex: x, y, r, g, b, a */
const _FLOATS_PER_VERTEX = 6;

/** Number of segments to approximate a circle */
const _CIRCLE_SEGMENTS = 32;

/** Default maximum number of line segments per frame */
const _DEFAULT_LINE_CAPACITY = 16384;

/**
 * Pre-computed unit circle lookup table.
 * Contains [cos(angle), sin(angle)] pairs for each segment boundary,
 * avoiding per-frame trig calls in drawCircle.
 */
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

// ---------------------------------------------------------------------------
// DebugRenderer2D
// ---------------------------------------------------------------------------

/**
 * Wireframe debug overlay renderer for 2D scenes.
 * Draws collision shapes, physics bodies, spatial grid cells, and pathfinding grids
 * as colored line overlays on top of the normal sprite rendering.
 *
 * Toggle individual overlays with the {@link showColliders}, {@link showPhysicsBodies},
 * {@link showSpatialGrid}, and {@link showPathfindingGrid} flags.
 *
 * @example
 * ```typescript
 * const debug = new DebugRenderer2D(engine);
 * debug.spatialGrid = myGrid;
 * debug.physicsEngine = myPhysics;
 * scene.debugRenderer = debug;
 * // Debug overlays now render automatically each frame
 * ```
 */
export class DebugRenderer2D {
    // ─── Visibility toggles ──────────────────────────────────────────

    /**
     * Master toggle. When false, no debug rendering occurs.
     */
    public enabled: boolean = true;

    /**
     * Whether to draw collision shape outlines from the spatial grid
     */
    public showColliders: boolean = true;

    /**
     * Whether to draw physics body outlines
     */
    public showPhysicsBodies: boolean = true;

    /**
     * Whether to draw spatial grid cell boundaries
     */
    public showSpatialGrid: boolean = false;

    /**
     * Whether to draw the pathfinding grid (walkable/unwalkable cells)
     */
    public showPathfindingGrid: boolean = false;

    // ─── Colors ──────────────────────────────────────────────────────

    /**
     * Color for collision shape outlines
     */
    public colliderColor: Color4 = new Color4(0, 1, 0, 1);

    /**
     * Color for static physics body outlines
     */
    public physicsStaticColor: Color4 = new Color4(0.5, 0.5, 0.5, 1);

    /**
     * Color for dynamic physics body outlines
     */
    public physicsDynamicColor: Color4 = new Color4(0, 0.7, 1, 1);

    /**
     * Color for kinematic physics body outlines
     */
    public physicsKinematicColor: Color4 = new Color4(1, 0.5, 0, 1);

    /**
     * Color for spatial grid cell boundaries
     */
    public spatialGridColor: Color4 = new Color4(0.3, 0.3, 0.3, 0.5);

    /**
     * Color for walkable pathfinding cells
     */
    public walkableColor: Color4 = new Color4(0, 0.4, 0, 0.3);

    /**
     * Color for unwalkable pathfinding cells
     */
    public unwalkableColor: Color4 = new Color4(0.6, 0, 0, 0.3);

    // ─── Data sources ────────────────────────────────────────────────

    /**
     * The spatial grid to visualize colliders from.
     * Set this to your game's SpatialGrid instance.
     */
    public spatialGrid: SpatialGrid | null = null;

    /**
     * The physics engine to visualize bodies from.
     * Set this to your game's IPhysicsEngine2D instance.
     */
    public physicsEngine: IPhysicsEngine2D | null = null;

    /**
     * The A* pathfinder whose walkability grid should be drawn.
     * Must be paired with {@link pathfinderGrid} for coordinate conversion.
     */
    public pathfinder: AStarPathfinder | null = null;

    /**
     * The Grid2D used for pathfinding coordinate conversion (cellToWorld).
     * Required when {@link pathfinder} is set.
     */
    public pathfinderGrid: Grid2D | null = null;

    // ─── Internals ───────────────────────────────────────────────────

    private _engine: AbstractEngine;
    private _effect: Effect | null = null;
    private _drawWrapper: DrawWrapper | null = null;
    private _isReady: boolean = false;

    private _vertexData: Float32Array;
    private _buffer: Buffer | null = null;
    private _positionVB: VertexBuffer | null = null;
    private _colorVB: VertexBuffer | null = null;
    private _vertexBuffersMap: { [key: string]: VertexBuffer } = {};
    private _lineCount: number = 0;
    private _capacity: number;

    private _projViewData: Float32Array = new Float32Array(16);
    private _projViewMatrix: IMatrixLike;

    /**
     * Creates a new DebugRenderer2D
     * @param engine - The Babylon.js engine instance
     * @param lineCapacity - Maximum number of line segments per frame (default: 16384)
     */
    constructor(engine: AbstractEngine, lineCapacity: number = _DEFAULT_LINE_CAPACITY) {
        this._engine = engine;
        this._capacity = lineCapacity;

        // 2 vertices per line segment
        this._vertexData = new Float32Array(lineCapacity * 2 * _FLOATS_PER_VERTEX);

        const pvData = this._projViewData;
        // IMatrixLike.asArray() expects Tuple<number, 16>, but Float32Array is accepted at runtime.
        // The cast is confined here to keep the setMatrix() call site type-safe.
        this._projViewMatrix = {
            asArray: () => pvData as any,
            updateFlag: 0,
        };

        this._setupShader();
    }

    /**
     * Whether the debug renderer shaders are compiled and ready
     */
    public get isReady(): boolean {
        if (!this._isReady && this._effect && this._effect.isReady()) {
            this._isReady = true;
        }
        return this._isReady;
    }

    // ─── Setup ───────────────────────────────────────────────────────

    /**
     * Compiles the debug line shader and creates the GPU buffer and vertex buffer views.
     * Called once from the constructor.
     */
    private _setupShader(): void {
        const engine = this._engine;
        const shaderLanguage = engine.isWebGPU ? ShaderLanguage.WGSL : ShaderLanguage.GLSL;

        this._buffer = new Buffer(engine, this._vertexData, true, _FLOATS_PER_VERTEX);

        // Create vertex buffer views once and reuse every frame (B2 fix)
        this._positionVB = this._buffer.createVertexBuffer(VertexBuffer.PositionKind, 0, 2, _FLOATS_PER_VERTEX);
        this._colorVB = this._buffer.createVertexBuffer(VertexBuffer.ColorKind, 2, 4, _FLOATS_PER_VERTEX);
        this._vertexBuffersMap[VertexBuffer.PositionKind] = this._positionVB;
        this._vertexBuffersMap[VertexBuffer.ColorKind] = this._colorVB;

        this._effect = engine.createEffect(
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

        this._drawWrapper = new DrawWrapper(engine);
        this._drawWrapper.effect = this._effect;
    }

    // ─── Immediate-mode line API ─────────────────────────────────────

    /**
     * Draws a line segment between two points
     * @param x1 - Start X in world pixels
     * @param y1 - Start Y in world pixels
     * @param x2 - End X in world pixels
     * @param y2 - End Y in world pixels
     * @param color - Line color
     */
    public drawLine(x1: number, y1: number, x2: number, y2: number, color: Color4): void {
        if (this._lineCount >= this._capacity) {
            return;
        }
        const off = this._lineCount * 2 * _FLOATS_PER_VERTEX;
        const d = this._vertexData;

        d[off] = x1;
        d[off + 1] = y1;
        d[off + 2] = color.r;
        d[off + 3] = color.g;
        d[off + 4] = color.b;
        d[off + 5] = color.a;

        d[off + 6] = x2;
        d[off + 7] = y2;
        d[off + 8] = color.r;
        d[off + 9] = color.g;
        d[off + 10] = color.b;
        d[off + 11] = color.a;

        this._lineCount++;
    }

    /**
     * Draws a wireframe rectangle
     * @param x - Center X in world pixels
     * @param y - Center Y in world pixels
     * @param halfWidth - Half-width in pixels
     * @param halfHeight - Half-height in pixels
     * @param color - Line color
     */
    public drawRect(x: number, y: number, halfWidth: number, halfHeight: number, color: Color4): void {
        const l = x - halfWidth;
        const r = x + halfWidth;
        const t = y - halfHeight;
        const b = y + halfHeight;

        this.drawLine(l, t, r, t, color);
        this.drawLine(r, t, r, b, color);
        this.drawLine(r, b, l, b, color);
        this.drawLine(l, b, l, t, color);
    }

    /**
     * Draws a wireframe circle approximated with line segments.
     * Uses a pre-computed unit circle lookup table for the default segment count
     * to avoid per-frame trigonometry.
     * @param cx - Center X in world pixels
     * @param cy - Center Y in world pixels
     * @param radius - Radius in pixels
     * @param color - Line color
     * @param segments - Number of line segments (default: 32)
     */
    public drawCircle(cx: number, cy: number, radius: number, color: Color4, segments: number = _CIRCLE_SEGMENTS): void {
        if (segments === _CIRCLE_SEGMENTS) {
            // Fast path using pre-computed lookup table
            let prevX = cx + radius;
            let prevY = cy;

            for (let i = 0; i < _CIRCLE_SEGMENTS; i++) {
                const nx = cx + _UNIT_CIRCLE[i * 2] * radius;
                const ny = cy + _UNIT_CIRCLE[i * 2 + 1] * radius;
                this.drawLine(prevX, prevY, nx, ny, color);
                prevX = nx;
                prevY = ny;
            }
        } else {
            // Fallback for custom segment counts
            const step = (Math.PI * 2) / segments;
            let prevX = cx + radius;
            let prevY = cy;

            for (let i = 1; i <= segments; i++) {
                const angle = i * step;
                const nx = cx + Math.cos(angle) * radius;
                const ny = cy + Math.sin(angle) * radius;
                this.drawLine(prevX, prevY, nx, ny, color);
                prevX = nx;
                prevY = ny;
            }
        }
    }

    /**
     * Draws a wireframe polygon from an array of vertices
     * @param vertices - Array of Vector2 vertices (in world space)
     * @param color - Line color
     */
    public drawPolygon(vertices: Vector2[], color: Color4): void {
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
     * Draws a cross-hatch pattern (two diagonal lines) inside a rectangle.
     * Since the debug renderer uses GL_LINES, this approximates a "filled" area indicator.
     * @param x - Center X in world pixels
     * @param y - Center Y in world pixels
     * @param halfWidth - Half-width in pixels
     * @param halfHeight - Half-height in pixels
     * @param color - Line color
     */
    public drawCrossHatchRect(x: number, y: number, halfWidth: number, halfHeight: number, color: Color4): void {
        const l = x - halfWidth;
        const r = x + halfWidth;
        const t = y - halfHeight;
        const b = y + halfHeight;

        this.drawLine(l, t, r, b, color);
        this.drawLine(r, t, l, b, color);
    }

    // ─── Data source collection ──────────────────────────────────────

    /**
     * Iterates all configured data sources and emits debug line primitives
     * for the enabled overlay categories.
     */
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
        if (this.showPathfindingGrid && this.pathfinder && this.pathfinderGrid) {
            this._collectPathfindingGrid();
        }
    }

    /**
     * Emits line primitives for all collision shapes in the spatial grid.
     * Draws each shape as a wireframe outline at its world-space position.
     */
    private _collectColliders(): void {
        const grid = this.spatialGrid!;
        const entries = grid.allEntries;
        const color = this.colliderColor;

        for (const entry of entries) {
            const wp = entry.node.worldPosition;
            for (const shape of entry.shapes) {
                const cx = wp.x + shape.offset.x;
                const cy = wp.y + shape.offset.y;

                if (shape.type === "box") {
                    this.drawRect(cx, cy, shape.width / 2, shape.height / 2, color);
                } else if (shape.type === "circle") {
                    this.drawCircle(cx, cy, shape.radius, color);
                } else if (shape.type === "polygon") {
                    // Draw edges directly to avoid per-frame Vector2 allocations
                    const verts = shape.vertices;
                    for (let i = 0; i < verts.length; i++) {
                        const a = verts[i];
                        const b = verts[(i + 1) % verts.length];
                        this.drawLine(cx + a.x, cy + a.y, cx + b.x, cy + b.y, color);
                    }
                }
            }
        }
    }

    /**
     * Emits line primitives for all physics bodies, colored by body type
     * (static, dynamic, kinematic).
     */
    private _collectPhysicsBodies(): void {
        const engine = this.physicsEngine!;
        const bodies = engine.getAllBodies();

        for (const body of bodies) {
            const pos = body.node.worldPosition;
            const color = this._getPhysicsColor(body.bodyType);
            const shapeOpts = body.shapeOptions;

            if (!shapeOpts) {
                continue;
            }

            if (shapeOpts.type === "box") {
                this.drawRect(pos.x, pos.y, shapeOpts.width / 2, shapeOpts.height / 2, color);
            } else if (shapeOpts.type === "circle") {
                this.drawCircle(pos.x, pos.y, shapeOpts.radius, color);
            } else if (shapeOpts.type === "polygon") {
                // Draw edges directly to avoid per-frame Vector2 allocations
                const verts = shapeOpts.vertices;
                for (let i = 0; i < verts.length; i++) {
                    const a = verts[i];
                    const b = verts[(i + 1) % verts.length];
                    this.drawLine(pos.x + a.x, pos.y + a.y, pos.x + b.x, pos.y + b.y, color);
                }
            }
        }
    }

    /**
     * Maps a physics body type to its configured debug color.
     * @param bodyType - The body type enum value
     * @returns The corresponding Color4 for debug rendering
     */
    private _getPhysicsColor(bodyType: PhysicsBodyType2D): Color4 {
        switch (bodyType) {
            case PhysicsBodyType2D.Static:
                return this.physicsStaticColor;
            case PhysicsBodyType2D.Dynamic:
                return this.physicsDynamicColor;
            case PhysicsBodyType2D.Kinematic:
                return this.physicsKinematicColor;
            default:
                return this.physicsDynamicColor;
        }
    }

    /**
     * Emits line primitives for all occupied spatial grid cells as wireframe rectangles.
     * Uses {@link SpatialGrid.decodeCellKey} to decode the cell key into row/col coordinates.
     */
    private _collectSpatialGridCells(): void {
        const grid = this.spatialGrid!;
        const cs = grid.cellSize;
        const color = this.spatialGridColor;
        const keys = grid.occupiedCellKeys;

        for (const key of keys) {
            const { row, col } = SpatialGrid.decodeCellKey(key);
            const x = col * cs;
            const y = row * cs;

            this.drawLine(x, y, x + cs, y, color);
            this.drawLine(x + cs, y, x + cs, y + cs, color);
            this.drawLine(x + cs, y + cs, x, y + cs, color);
            this.drawLine(x, y + cs, x, y, color);
        }
    }

    /**
     * Emits line primitives for the pathfinding grid, drawing each cell as walkable
     * (outline only) or unwalkable (outline + cross-hatch fill).
     * Uses {@link Grid2D.cellToWorldToRef} to avoid per-cell Vector2 allocations.
     */
    private _collectPathfindingGrid(): void {
        const pf = this.pathfinder!;
        const grid = this.pathfinderGrid!;
        const walkColor = this.walkableColor;
        const wallColor = this.unwalkableColor;

        const width = pf.gridWidth;
        const height = pf.gridHeight;
        const tempVec = TmpVectors.Vector2[0];

        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
                const walkable = pf.isWalkable(col, row);
                grid.cellToWorldToRef(col, row, tempVec);
                const halfSize = grid.cellSize / 2;

                if (!walkable) {
                    this.drawCrossHatchRect(tempVec.x, tempVec.y, halfSize, halfSize, wallColor);
                    this.drawRect(tempVec.x, tempVec.y, halfSize, halfSize, wallColor);
                } else {
                    this.drawRect(tempVec.x, tempVec.y, halfSize, halfSize, walkColor);
                }
            }
        }
    }

    // ─── Render ──────────────────────────────────────────────────────

    /**
     * Renders all debug overlays for the current frame.
     * Called automatically by Scene2D when {@link Scene2D.debugRenderer} is set.
     * @param viewTransform - The camera view transform (from Camera2D.getViewTransform())
     * @param vpWidth - Viewport width in pixels
     * @param vpHeight - Viewport height in pixels
     */
    public render(viewTransform: Matrix2D, vpWidth: number, vpHeight: number): void {
        if (!this.enabled || !this.isReady) {
            return;
        }

        // Reset line buffer
        this._lineCount = 0;

        // Collect from data sources
        this._collectFromSources();

        if (this._lineCount === 0) {
            return;
        }

        const engine = this._engine;

        // Blend mode for alpha support
        engine.setAlphaMode(Constants.ALPHA_COMBINE);
        engine.setDepthBuffer(false);
        engine.setState(false);
        engine.enableEffect(this._drawWrapper!);

        // Build combined projection × view matrix
        // Orthographic projection (Y-down, top-left origin) same as SpriteBatchRenderer:
        // proj = diag(2/w, -2/h, 1, 1) with translation (-1, +1, 0, 0)
        // view = Matrix2D [a, b, c, d, tx, ty] as a 2D affine transform
        //
        // The combined projView embeds the 2D view matrix into the 4x4 projection:
        const vm = viewTransform.m;
        const p = this._projViewData;

        const px = 2.0 / vpWidth;
        const py = -2.0 / vpHeight;

        // Column 0
        p[0] = px * vm[0];
        p[1] = py * vm[1];
        p[2] = 0;
        p[3] = 0;

        // Column 1
        p[4] = px * vm[2];
        p[5] = py * vm[3];
        p[6] = 0;
        p[7] = 0;

        // Column 2
        p[8] = 0;
        p[9] = 0;
        p[10] = 1;
        p[11] = 0;

        // Column 3 (translation)
        p[12] = px * vm[4] - 1;
        p[13] = py * vm[5] + 1;
        p[14] = 0;
        p[15] = 1;

        this._projViewMatrix.updateFlag++;
        this._effect!.setMatrix("projView", this._projViewMatrix);

        // Upload vertex data and draw
        const vertexCount = this._lineCount * 2;
        this._buffer!.updateDirectly(this._vertexData, 0, vertexCount);

        engine.bindBuffers(this._vertexBuffersMap, null as Nullable<DataBuffer>, this._effect!);
        engine.drawArraysType(Constants.MATERIAL_LineListDrawMode, 0, vertexCount);

        // Restore engine state
        engine.setDepthBuffer(true);
        engine.setAlphaMode(Constants.ALPHA_DISABLE);
    }

    /**
     * Disposes the debug renderer and releases GPU resources
     */
    public dispose(): void {
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
