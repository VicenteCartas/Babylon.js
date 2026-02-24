/* eslint-disable @typescript-eslint/no-unused-vars */
// ---------------------------------------------------------------------------
// Mocks — variables prefixed with "mock" are auto-hoisted by jest alongside
// jest.mock() calls, avoiding temporal-dead-zone issues with const.
// ---------------------------------------------------------------------------

const mockBufferDispose = jest.fn();
const mockBufferUpdate = jest.fn();
const mockCreateVB = jest.fn().mockReturnValue({ dispose: jest.fn() });

jest.mock("core/Buffers/buffer", () => ({
    Buffer: jest.fn().mockImplementation(() => ({
        updateDirectly: mockBufferUpdate,
        createVertexBuffer: mockCreateVB,
        dispose: mockBufferDispose,
    })),
    VertexBuffer: {
        PositionKind: "position",
        ColorKind: "color",
    },
}));

jest.mock("core/Materials/drawWrapper", () => ({
    DrawWrapper: jest.fn().mockImplementation(() => ({ effect: null })),
}));

jest.mock("core/Engines/shaderStore", () => ({
    ShaderStore: {
        ShadersStore: {} as Record<string, string>,
        ShadersStoreWGSL: {} as Record<string, string>,
    },
}));

jest.mock("core/Materials/shaderLanguage", () => ({
    ShaderLanguage: { GLSL: 0, WGSL: 1 },
}));

jest.mock("core/Engines/constants", () => ({
    Constants: {
        ALPHA_COMBINE: 1,
        ALPHA_DISABLE: 0,
        MATERIAL_LineListDrawMode: 1,
    },
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { DebugRenderer2D } from "2d/Debug/debugRenderer2D";
import { Color4 } from "core/Maths/math.color";
import { Vector2 } from "core/Maths/math.vector";
import { Matrix2D } from "2d/Math/matrix2D";
import { Node2D } from "2d/Node2D/node2D";
import { PhysicsBodyType2D } from "2d/Physics/physicsEngine2D";
import type { IPhysicsEngine2D, IPhysicsBody2D } from "2d/Physics/physicsEngine2D";
import type { SpatialGrid, ICollisionEntry } from "2d/Collision/spatialGrid";
import type { AStarPathfinder } from "2d/Pathfinding/aStarPathfinder";
import type { Grid2D } from "2d/Grid/grid2D";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockEngine() {
    const effect = {
        isReady: jest.fn().mockReturnValue(true),
        setMatrix: jest.fn(),
        dispose: jest.fn(),
    };
    return {
        isWebGPU: false,
        createEffect: jest.fn().mockReturnValue(effect),
        setAlphaMode: jest.fn(),
        setDepthBuffer: jest.fn(),
        setState: jest.fn(),
        enableEffect: jest.fn(),
        bindBuffers: jest.fn(),
        drawArraysType: jest.fn(),
        _effect: effect,
    } as any;
}

/** Read the private _lineCount field */
function lineCount(debug: DebugRenderer2D): number {
    return (debug as any)._lineCount;
}

/** Read the private _vertexData field */
function vData(debug: DebugRenderer2D): Float32Array {
    return (debug as any)._vertexData;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DebugRenderer2D", () => {
    let mockEngine: ReturnType<typeof createMockEngine>;
    let debug: DebugRenderer2D;

    beforeEach(() => {
        mockEngine = createMockEngine();
        debug = new DebugRenderer2D(mockEngine);
        // Clear call history produced by the constructor while keeping mock implementations
        jest.clearAllMocks();
    });

    afterEach(() => {
        debug.dispose();
    });

    // ─── Default properties ──────────────────────────────────────────

    describe("default properties", () => {
        it("should be enabled by default", () => {
            expect(debug.enabled).toBe(true);
        });

        it("should show colliders by default", () => {
            expect(debug.showColliders).toBe(true);
        });

        it("should show physics bodies by default", () => {
            expect(debug.showPhysicsBodies).toBe(true);
        });

        it("should not show spatial grid by default", () => {
            expect(debug.showSpatialGrid).toBe(false);
        });

        it("should not show pathfinding grid by default", () => {
            expect(debug.showPathfindingGrid).toBe(false);
        });

        it("should have green collider color", () => {
            expect(debug.colliderColor).toEqual(new Color4(0, 1, 0, 1));
        });

        it("should have gray static physics color", () => {
            expect(debug.physicsStaticColor).toEqual(new Color4(0.5, 0.5, 0.5, 1));
        });

        it("should have blue dynamic physics color", () => {
            expect(debug.physicsDynamicColor).toEqual(new Color4(0, 0.7, 1, 1));
        });

        it("should have orange kinematic physics color", () => {
            expect(debug.physicsKinematicColor).toEqual(new Color4(1, 0.5, 0, 1));
        });

        it("should have no spatial grid assigned", () => {
            expect(debug.spatialGrid).toBeNull();
        });

        it("should have no physics engine assigned", () => {
            expect(debug.physicsEngine).toBeNull();
        });

        it("should have no pathfinder assigned", () => {
            expect(debug.pathfinder).toBeNull();
        });

        it("should have no pathfinder grid assigned", () => {
            expect(debug.pathfinderGrid).toBeNull();
        });
    });

    // ─── drawLine ────────────────────────────────────────────────────

    describe("drawLine", () => {
        it("should increment line count", () => {
            debug.drawLine(0, 0, 100, 100, new Color4(1, 0, 0, 1));
            expect(lineCount(debug)).toBe(1);
        });

        it("should write vertex data for both endpoints", () => {
            const color = new Color4(1, 0.5, 0.25, 0.75);
            debug.drawLine(10, 20, 30, 40, color);

            const d = vData(debug);
            // Vertex 0: x, y, r, g, b, a
            expect(d[0]).toBe(10);
            expect(d[1]).toBe(20);
            expect(d[2]).toBe(1);
            expect(d[3]).toBe(0.5);
            expect(d[4]).toBe(0.25);
            expect(d[5]).toBe(0.75);
            // Vertex 1
            expect(d[6]).toBe(30);
            expect(d[7]).toBe(40);
            expect(d[8]).toBe(1);
            expect(d[9]).toBe(0.5);
            expect(d[10]).toBe(0.25);
            expect(d[11]).toBe(0.75);
        });

        it("should accumulate multiple lines", () => {
            const c = new Color4(1, 1, 1, 1);
            debug.drawLine(0, 0, 1, 1, c);
            debug.drawLine(2, 2, 3, 3, c);
            debug.drawLine(4, 4, 5, 5, c);
            expect(lineCount(debug)).toBe(3);
        });

        it("should not exceed line capacity", () => {
            const small = new DebugRenderer2D(mockEngine, 2);
            const c = new Color4(1, 1, 1, 1);
            small.drawLine(0, 0, 1, 1, c);
            small.drawLine(2, 2, 3, 3, c);
            small.drawLine(4, 4, 5, 5, c); // Beyond capacity — ignored
            expect(lineCount(small)).toBe(2);
            small.dispose();
        });
    });

    // ─── drawRect ────────────────────────────────────────────────────

    describe("drawRect", () => {
        it("should draw 4 lines for a rectangle", () => {
            debug.drawRect(50, 50, 10, 10, new Color4(0, 1, 0, 1));
            expect(lineCount(debug)).toBe(4);
        });

        it("should use correct corner positions", () => {
            const color = new Color4(1, 1, 1, 1);
            debug.drawRect(100, 200, 20, 30, color);

            const d = vData(debug);
            const stride = 12; // 2 vertices × 6 floats per vertex

            // Line 0: top edge (l,t)→(r,t) = (80,170)→(120,170)
            expect(d[0]).toBe(80);
            expect(d[1]).toBe(170);
            expect(d[6]).toBe(120);
            expect(d[7]).toBe(170);

            // Line 1: right edge (r,t)→(r,b) = (120,170)→(120,230)
            expect(d[stride]).toBe(120);
            expect(d[stride + 1]).toBe(170);
            expect(d[stride + 6]).toBe(120);
            expect(d[stride + 7]).toBe(230);
        });
    });

    // ─── drawCircle ──────────────────────────────────────────────────

    describe("drawCircle", () => {
        it("should draw the default 32 segments", () => {
            debug.drawCircle(0, 0, 50, new Color4(1, 0, 0, 1));
            expect(lineCount(debug)).toBe(32);
        });

        it("should respect custom segment count", () => {
            debug.drawCircle(0, 0, 50, new Color4(1, 0, 0, 1), 8);
            expect(lineCount(debug)).toBe(8);
        });

        it("should produce a closed loop (last endpoint equals first)", () => {
            debug.drawCircle(100, 100, 25, new Color4(1, 1, 1, 1), 4);
            const d = vData(debug);
            // 4 segments → 4 lines. First vertex of first line should match last vertex of last line.
            const firstX = d[0]; // cx + radius = 125
            const firstY = d[1]; // cy = 100
            // Last segment (index 3): end vertex at offset 3*12 + 6
            const lastEndX = d[3 * 12 + 6];
            const lastEndY = d[3 * 12 + 7];
            expect(lastEndX).toBeCloseTo(firstX, 5);
            expect(lastEndY).toBeCloseTo(firstY, 5);
        });
    });

    // ─── drawPolygon ─────────────────────────────────────────────────

    describe("drawPolygon", () => {
        it("should draw one line per polygon edge (closed loop)", () => {
            const verts = [new Vector2(0, 0), new Vector2(10, 0), new Vector2(10, 10), new Vector2(0, 10)];
            debug.drawPolygon(verts, new Color4(1, 1, 0, 1));
            expect(lineCount(debug)).toBe(4);
        });

        it("should draw 3 lines for a triangle", () => {
            const tri = [new Vector2(0, 0), new Vector2(5, -5), new Vector2(10, 0)];
            debug.drawPolygon(tri, new Color4(1, 0, 1, 1));
            expect(lineCount(debug)).toBe(3);
        });

        it("should draw nothing for fewer than 2 vertices", () => {
            debug.drawPolygon([new Vector2(0, 0)], new Color4(1, 1, 1, 1));
            expect(lineCount(debug)).toBe(0);

            debug.drawPolygon([], new Color4(1, 1, 1, 1));
            expect(lineCount(debug)).toBe(0);
        });
    });

    // ─── drawFilledRect ──────────────────────────────────────────────

    describe("drawFilledRect", () => {
        it("should draw 2 diagonal lines", () => {
            debug.drawFilledRect(50, 50, 10, 10, new Color4(0.5, 0, 0, 0.3));
            expect(lineCount(debug)).toBe(2);
        });
    });

    // ─── isReady ─────────────────────────────────────────────────────

    describe("isReady", () => {
        it("should report ready when effect is ready", () => {
            mockEngine._effect.isReady.mockReturnValue(true);
            expect(debug.isReady).toBe(true);
        });

        it("should report not ready when effect is not ready", () => {
            const eng = createMockEngine();
            eng._effect.isReady.mockReturnValue(false);
            const d = new DebugRenderer2D(eng);
            expect(d.isReady).toBe(false);
            d.dispose();
        });
    });

    // ─── render (integration with data sources) ──────────────────────

    describe("render", () => {
        it("should not render when disabled", () => {
            debug.enabled = false;
            debug.render(Matrix2D.Identity(), 800, 600);
            expect(mockEngine.drawArraysType).not.toHaveBeenCalled();
        });

        it("should not render when there are no lines from data sources", () => {
            // No data sources assigned → _collectFromSources produces 0 lines
            debug.render(Matrix2D.Identity(), 800, 600);
            expect(mockEngine.drawArraysType).not.toHaveBeenCalled();
        });

        it("should call engine draw when data sources produce lines", () => {
            mockEngine._effect.isReady.mockReturnValue(true);
            void debug.isReady;

            const node = new Node2D("box");
            node.position = new Vector2(50, 50);
            debug.spatialGrid = {
                allEntries: [
                    {
                        node,
                        shapes: [{ type: "box", offset: new Vector2(0, 0), width: 20, height: 20 }],
                        layer: 1,
                        mask: 0xffffffff,
                    },
                ] as ICollisionEntry[],
                cellSize: 64,
                occupiedCellKeys: (function* (): Generator<number> {})(),
            } as unknown as SpatialGrid;
            debug.showColliders = true;

            debug.render(Matrix2D.Identity(), 800, 600);

            expect(mockEngine.setAlphaMode).toHaveBeenCalled();
            expect(mockEngine.drawArraysType).toHaveBeenCalled();
        });

        it("should set projView matrix uniform", () => {
            mockEngine._effect.isReady.mockReturnValue(true);
            void debug.isReady;

            const node = new Node2D("n");
            node.position = new Vector2(100, 100);
            debug.spatialGrid = {
                allEntries: [
                    {
                        node,
                        shapes: [{ type: "circle", offset: new Vector2(0, 0), radius: 10 }],
                        layer: 1,
                        mask: 0xffffffff,
                    },
                ] as ICollisionEntry[],
                cellSize: 64,
                occupiedCellKeys: (function* (): Generator<number> {})(),
            } as unknown as SpatialGrid;

            debug.render(Matrix2D.Identity(), 800, 600);

            expect(mockEngine._effect.setMatrix).toHaveBeenCalledWith("projView", expect.anything());
        });

        it("should restore engine state after rendering", () => {
            mockEngine._effect.isReady.mockReturnValue(true);
            void debug.isReady;

            const node = new Node2D("n");
            node.position = new Vector2(0, 0);
            debug.spatialGrid = {
                allEntries: [
                    {
                        node,
                        shapes: [{ type: "box", offset: new Vector2(0, 0), width: 10, height: 10 }],
                        layer: 1,
                        mask: 0xffffffff,
                    },
                ] as ICollisionEntry[],
                cellSize: 64,
                occupiedCellKeys: (function* (): Generator<number> {})(),
            } as unknown as SpatialGrid;

            debug.render(Matrix2D.Identity(), 800, 600);

            // Should restore depth buffer and disable alpha at the end
            const depthCalls = mockEngine.setDepthBuffer.mock.calls;
            expect(depthCalls[depthCalls.length - 1][0]).toBe(true);
            const alphaCalls = mockEngine.setAlphaMode.mock.calls;
            expect(alphaCalls[alphaCalls.length - 1][0]).toBe(0); // ALPHA_DISABLE
        });
    });

    // ─── Collider collection from spatial grid ───────────────────────

    describe("collider collection", () => {
        it("should draw box colliders from spatial grid", () => {
            mockEngine._effect.isReady.mockReturnValue(true);
            void debug.isReady;

            const node = new Node2D("box");
            node.position = new Vector2(100, 100);
            debug.spatialGrid = {
                allEntries: [
                    {
                        node,
                        shapes: [{ type: "box", offset: new Vector2(0, 0), width: 40, height: 20 }],
                        layer: 1,
                        mask: 0xffffffff,
                    },
                ] as ICollisionEntry[],
                cellSize: 64,
                occupiedCellKeys: (function* (): Generator<number> {})(),
            } as unknown as SpatialGrid;
            debug.showColliders = true;

            debug.render(Matrix2D.Identity(), 800, 600);

            // Box → drawRect → 4 lines → 8 vertices
            const vertexCount = mockEngine.drawArraysType.mock.calls[0][2];
            expect(vertexCount).toBe(4 * 2);
        });

        it("should draw circle colliders from spatial grid", () => {
            mockEngine._effect.isReady.mockReturnValue(true);
            void debug.isReady;

            const node = new Node2D("circle");
            node.position = new Vector2(50, 50);
            debug.spatialGrid = {
                allEntries: [
                    {
                        node,
                        shapes: [{ type: "circle", offset: new Vector2(0, 0), radius: 15 }],
                        layer: 1,
                        mask: 0xffffffff,
                    },
                ] as ICollisionEntry[],
                cellSize: 64,
                occupiedCellKeys: (function* (): Generator<number> {})(),
            } as unknown as SpatialGrid;

            debug.render(Matrix2D.Identity(), 800, 600);

            // Circle → 32 segments → 64 vertices
            const vertexCount = mockEngine.drawArraysType.mock.calls[0][2];
            expect(vertexCount).toBe(32 * 2);
        });

        it("should draw polygon colliders from spatial grid", () => {
            mockEngine._effect.isReady.mockReturnValue(true);
            void debug.isReady;

            const node = new Node2D("poly");
            node.position = new Vector2(0, 0);
            debug.spatialGrid = {
                allEntries: [
                    {
                        node,
                        shapes: [
                            {
                                type: "polygon",
                                offset: new Vector2(0, 0),
                                vertices: [new Vector2(-10, -10), new Vector2(10, -10), new Vector2(10, 10)],
                            },
                        ],
                        layer: 1,
                        mask: 0xffffffff,
                    },
                ] as ICollisionEntry[],
                cellSize: 64,
                occupiedCellKeys: (function* (): Generator<number> {})(),
            } as unknown as SpatialGrid;

            debug.render(Matrix2D.Identity(), 800, 600);

            // Triangle (3 edges) → 3 lines → 6 vertices
            const vertexCount = mockEngine.drawArraysType.mock.calls[0][2];
            expect(vertexCount).toBe(3 * 2);
        });

        it("should not draw colliders when showColliders is false", () => {
            mockEngine._effect.isReady.mockReturnValue(true);
            void debug.isReady;

            const node = new Node2D("b");
            node.position = new Vector2(0, 0);
            debug.spatialGrid = {
                allEntries: [
                    {
                        node,
                        shapes: [{ type: "box", offset: new Vector2(0, 0), width: 10, height: 10 }],
                        layer: 1,
                        mask: 0xffffffff,
                    },
                ] as ICollisionEntry[],
                cellSize: 64,
                occupiedCellKeys: (function* (): Generator<number> {})(),
            } as unknown as SpatialGrid;
            debug.showColliders = false;
            debug.showSpatialGrid = false;

            debug.render(Matrix2D.Identity(), 800, 600);

            expect(mockEngine.drawArraysType).not.toHaveBeenCalled();
        });
    });

    // ─── Physics body collection ─────────────────────────────────────

    describe("physics body collection", () => {
        function makeMockPhysicsEngine(bodies: IPhysicsBody2D[]): IPhysicsEngine2D {
            return {
                getAllBodies: jest.fn().mockReturnValue(bodies),
                setGravity: jest.fn(),
                getGravity: jest.fn(),
                addBody: jest.fn(),
                removeBody: jest.fn(),
                step: jest.fn(),
                raycast: jest.fn(),
                onBeginContact: jest.fn(),
                onEndContact: jest.fn(),
                dispose: jest.fn(),
            } as IPhysicsEngine2D;
        }

        function makeMockBody(
            name: string,
            x: number,
            y: number,
            bodyType: PhysicsBodyType2D,
            shape: any
        ): IPhysicsBody2D {
            const node = new Node2D(name);
            node.position = new Vector2(x, y);
            return {
                node,
                bodyType,
                shapeOptions: shape,
                setLinearVelocity: jest.fn(),
                getLinearVelocity: jest.fn().mockReturnValue(new Vector2(0, 0)),
                applyForce: jest.fn(),
                applyImpulse: jest.fn(),
                getMass: jest.fn().mockReturnValue(bodyType === PhysicsBodyType2D.Static ? 0 : 1),
            };
        }

        it("should draw dynamic box physics bodies", () => {
            mockEngine._effect.isReady.mockReturnValue(true);
            void debug.isReady;

            const body = makeMockBody("dynBox", 100, 100, PhysicsBodyType2D.Dynamic, {
                type: "box",
                width: 32,
                height: 32,
            });

            debug.physicsEngine = makeMockPhysicsEngine([body]);
            debug.showPhysicsBodies = true;
            debug.showColliders = false;

            debug.render(Matrix2D.Identity(), 800, 600);

            // Box → 4 lines → 8 vertices
            const vertexCount = mockEngine.drawArraysType.mock.calls[0][2];
            expect(vertexCount).toBe(4 * 2);
        });

        it("should use correct color for static bodies", () => {
            mockEngine._effect.isReady.mockReturnValue(true);
            void debug.isReady;

            const body = makeMockBody("staticBox", 0, 0, PhysicsBodyType2D.Static, {
                type: "box",
                width: 10,
                height: 10,
            });

            debug.physicsEngine = makeMockPhysicsEngine([body]);
            debug.showPhysicsBodies = true;
            debug.showColliders = false;

            debug.render(Matrix2D.Identity(), 800, 600);

            // Verify vertex data was written with physicsStaticColor
            const d = vData(debug);
            expect(d[2]).toBe(debug.physicsStaticColor.r);
            expect(d[3]).toBe(debug.physicsStaticColor.g);
            expect(d[4]).toBe(debug.physicsStaticColor.b);
            expect(d[5]).toBe(debug.physicsStaticColor.a);
        });

        it("should draw circle physics bodies", () => {
            mockEngine._effect.isReady.mockReturnValue(true);
            void debug.isReady;

            const body = makeMockBody("circle", 50, 50, PhysicsBodyType2D.Dynamic, {
                type: "circle",
                radius: 20,
            });

            debug.physicsEngine = makeMockPhysicsEngine([body]);
            debug.showPhysicsBodies = true;
            debug.showColliders = false;

            debug.render(Matrix2D.Identity(), 800, 600);

            // Circle → 32 segments → 64 vertices
            const vertexCount = mockEngine.drawArraysType.mock.calls[0][2];
            expect(vertexCount).toBe(32 * 2);
        });

        it("should draw polygon physics bodies", () => {
            mockEngine._effect.isReady.mockReturnValue(true);
            void debug.isReady;

            const body = makeMockBody("poly", 0, 0, PhysicsBodyType2D.Kinematic, {
                type: "polygon",
                vertices: [new Vector2(-10, -10), new Vector2(10, -10), new Vector2(10, 10), new Vector2(-10, 10)],
            });

            debug.physicsEngine = makeMockPhysicsEngine([body]);
            debug.showPhysicsBodies = true;
            debug.showColliders = false;

            debug.render(Matrix2D.Identity(), 800, 600);

            // Quad (4 edges) → 4 lines → 8 vertices
            const vertexCount = mockEngine.drawArraysType.mock.calls[0][2];
            expect(vertexCount).toBe(4 * 2);
        });

        it("should not draw physics bodies when showPhysicsBodies is false", () => {
            mockEngine._effect.isReady.mockReturnValue(true);
            void debug.isReady;

            const body = makeMockBody("hidden", 0, 0, PhysicsBodyType2D.Dynamic, {
                type: "box",
                width: 10,
                height: 10,
            });

            debug.physicsEngine = makeMockPhysicsEngine([body]);
            debug.showPhysicsBodies = false;
            debug.showColliders = false;

            debug.render(Matrix2D.Identity(), 800, 600);

            expect(mockEngine.drawArraysType).not.toHaveBeenCalled();
        });
    });

    // ─── Spatial grid cell outlines ──────────────────────────────────

    describe("spatial grid cell collection", () => {
        it("should draw grid cell outlines when showSpatialGrid is true", () => {
            mockEngine._effect.isReady.mockReturnValue(true);
            void debug.isReady;

            // Two occupied cells with keys (row=0,col=0) and (row=0,col=1)
            debug.spatialGrid = {
                allEntries: [] as ICollisionEntry[],
                cellSize: 64,
                occupiedCellKeys: [0 * 100000 + 0, 0 * 100000 + 1][Symbol.iterator](),
            } as unknown as SpatialGrid;

            debug.showColliders = false;
            debug.showSpatialGrid = true;

            debug.render(Matrix2D.Identity(), 800, 600);

            // 2 cells × 4 lines each = 8 lines → 16 vertices
            const vertexCount = mockEngine.drawArraysType.mock.calls[0][2];
            expect(vertexCount).toBe(16);
        });
    });

    // ─── Pathfinding grid overlay ────────────────────────────────────

    describe("pathfinding grid collection", () => {
        it("should draw walkable and unwalkable cells", () => {
            mockEngine._effect.isReady.mockReturnValue(true);
            void debug.isReady;

            // 2×2 grid: (0,0) unwalkable, rest walkable
            const mockPathfinder = {
                gridWidth: 2,
                gridHeight: 2,
                isWalkable: (col: number, row: number) => !(col === 0 && row === 0),
            } as unknown as AStarPathfinder;

            const mockGrid = {
                cellToWorld: (col: number, row: number) => new Vector2(col * 32 + 16, row * 32 + 16),
                cellSize: 32,
            } as unknown as Grid2D;

            debug.pathfinder = mockPathfinder;
            debug.pathfinderGrid = mockGrid;
            debug.showPathfindingGrid = true;
            debug.showColliders = false;

            debug.render(Matrix2D.Identity(), 800, 600);

            // Unwalkable (1 cell): drawFilledRect (2 lines) + drawRect (4 lines) = 6
            // Walkable   (3 cells): drawRect (4 lines) each = 12
            // Total = 18 lines → 36 vertices
            const vertexCount = mockEngine.drawArraysType.mock.calls[0][2];
            expect(vertexCount).toBe(18 * 2);
        });
    });

    // ─── dispose ─────────────────────────────────────────────────────

    describe("dispose", () => {
        it("should dispose buffer and effect", () => {
            debug.dispose();
            expect(mockBufferDispose).toHaveBeenCalled();
            expect(mockEngine._effect.dispose).toHaveBeenCalled();
        });

        it("should be safe to call dispose twice", () => {
            debug.dispose();
            expect(() => debug.dispose()).not.toThrow();
        });
    });

    // ─── Visibility toggle mutations ─────────────────────────────────

    describe("visibility toggles", () => {
        it("should allow toggling all flags", () => {
            debug.enabled = false;
            debug.showColliders = false;
            debug.showPhysicsBodies = false;
            debug.showSpatialGrid = true;
            debug.showPathfindingGrid = true;

            expect(debug.enabled).toBe(false);
            expect(debug.showColliders).toBe(false);
            expect(debug.showPhysicsBodies).toBe(false);
            expect(debug.showSpatialGrid).toBe(true);
            expect(debug.showPathfindingGrid).toBe(true);
        });

        it("should allow changing colors", () => {
            const custom = new Color4(0.1, 0.2, 0.3, 0.4);
            debug.colliderColor = custom;
            expect(debug.colliderColor).toBe(custom);
        });
    });
});
