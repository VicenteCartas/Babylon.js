import { describe, expect, it, vi } from "vitest";

import { Constants } from "core/Engines/constants";
import { type ThinEngine } from "core/Engines/thinEngine";
import { CreateFillRenderer } from "../../src/rendering/vector/fillRenderer";
import { type IParsedLayer } from "../../src/animation/parse";

function Static(value: unknown) {
    return { a: 0 as const, k: value };
}

function CreateMockEngine(shaderPlatformName: "NATIVE" | "WEBGL2") {
    const effect = {
        isReady: () => true,
        setFloat2: vi.fn(),
        setInt: vi.fn(),
        setFloat: vi.fn(),
        setFloat4: vi.fn(),
        setFloatArray: vi.fn(),
        setFloatArray4: vi.fn(),
        dispose: vi.fn(),
    };
    const mock = {
        name: "WebGL",
        shaderPlatformName,
        stencilState: {},
        createEffect: vi.fn(() => effect),
        createDynamicVertexBuffer: vi.fn(() => ({})),
        updateDynamicVertexBuffer: vi.fn(),
        bindBuffers: vi.fn(),
        enableEffect: vi.fn(),
        setColorWrite: vi.fn(),
        setState: vi.fn(),
        setAlphaMode: vi.fn(),
        drawArraysType: vi.fn(),
        _releaseBuffer: vi.fn(),
        setStencilBuffer: vi.fn(),
        setStencilMask: vi.fn(),
        setStencilFunction: vi.fn(),
        setStencilFunctionReference: vi.fn(),
        setStencilFunctionMask: vi.fn(),
        setStencilOperationFail: vi.fn(),
        setStencilOperationDepthFail: vi.fn(),
        setStencilOperationPass: vi.fn(),
    };
    return { engine: mock as unknown as ThinEngine, mock, effect };
}

function CreateRectLayer(stroke = false): IParsedLayer {
    return {
        kind: 4,
        ind: 1,
        name: "rect",
        transform: {},
        ip: 0,
        op: 60,
        st: 0,
        ops: [
            {
                contours: [{ rect: { p: Static([50, 50]), s: Static([100, 100]) } }],
                groupTransforms: [],
                paint: { kind: "solid", color: Static([1, 0, 0, 1]) },
                stroke: stroke ? { width: Static(10), lineCap: 1 } : undefined,
            },
        ],
    };
}

function RenderRect(engine: ThinEngine, stroke = false) {
    const renderer = CreateFillRenderer(engine);
    const ctx = { frame: 0, screenW: 100, screenH: 100 };
    renderer.beginFrame(ctx);
    const token = renderer.emitLayer(CreateRectLayer(stroke), [1, 0, 0, 1, 0, 0], 1, ctx);
    renderer.flush(ctx);
    renderer.recordLayer(token);
    return renderer;
}

describe("CreateFillRenderer stencil strategy", () => {
    it("uses cull-twice winding and immediate stencil setters on Native", () => {
        const { engine, mock } = CreateMockEngine("NATIVE");
        const renderer = RenderRect(engine);

        // Two winding passes plus one cover pass.
        expect(mock.drawArraysType).toHaveBeenCalledTimes(3);
        expect(mock.setState).toHaveBeenCalledWith(true, 0, true, false, true);
        expect(mock.setState).toHaveBeenCalledWith(true, 0, true, true, true);
        expect(mock.setStencilOperationPass).toHaveBeenCalledWith(Constants.INCR);
        expect(mock.setStencilOperationPass).toHaveBeenCalledWith(Constants.DECR);
        expect(mock.setStencilOperationPass).toHaveBeenCalledWith(Constants.ZERO);
        expect(mock.bindBuffers).toHaveBeenCalledWith(expect.objectContaining({ position: expect.anything() }), null, expect.anything());
        renderer.dispose();
    });

    it("uses binary replacement for overlapping Native stroke geometry", () => {
        const { engine, mock } = CreateMockEngine("NATIVE");
        const renderer = RenderRect(engine, true);

        expect(mock.drawArraysType).toHaveBeenCalledTimes(2);
        expect(mock.setStencilFunctionReference).toHaveBeenCalledWith(1);
        expect(mock.setStencilOperationPass).toHaveBeenNthCalledWith(1, Constants.REPLACE);
        expect(mock.setStencilOperationPass).toHaveBeenNthCalledWith(2, Constants.ZERO);
        renderer.dispose();
    });

    it("keeps the one-pass two-sided stencil path on WebGL", () => {
        const { engine, mock } = CreateMockEngine("WEBGL2");
        const renderer = RenderRect(engine);

        // One winding pass plus one cover pass.
        expect(mock.drawArraysType).toHaveBeenCalledTimes(2);
        expect(mock.setStencilBuffer).not.toHaveBeenCalled();
        renderer.dispose();
    });
});
