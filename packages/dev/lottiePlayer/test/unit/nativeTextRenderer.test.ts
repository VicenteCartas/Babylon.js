import { describe, expect, it, vi } from "vitest";

import { type ThinEngine } from "core/Engines/thinEngine";
import { CreateTextRenderer } from "../../src/rendering/vector/textRenderer";
import { type IParsedLayer } from "../../src/animation/parse";

function CreateTextLayer(ind = 1): IParsedLayer {
    return {
        kind: 5,
        ind,
        name: "text",
        transform: {},
        ip: 0,
        op: 60,
        st: 0,
        ops: [],
        text: {
            text: "Native",
            family: "Test",
            weight: 400,
            style: "normal",
            size: 20,
            color: [1, 1, 1, 1],
            justify: 0,
            letterSpacing: 0,
            lineHeight: 24,
        },
    };
}

describe("CreateTextRenderer", () => {
    it("uses the engine Canvas2D implementation and preserves CSS fill colors", () => {
        const context = {
            font: "",
            letterSpacing: "",
            textBaseline: "alphabetic",
            fillStyle: "",
            scale: vi.fn(),
            measureText: vi.fn((text: string) => ({ width: text.length * 10, fontBoundingBoxAscent: 16, fontBoundingBoxDescent: 4 })),
            fillText: vi.fn(),
        };
        const canvas = { width: 1, height: 1, getContext: vi.fn(() => context) };
        const effect = { isReady: () => true, dispose: vi.fn() };
        let engine: ThinEngine;
        const internalTexture = { getEngine: () => engine };
        const mockEngine = {
            createCanvas: vi.fn(() => canvas),
            createEffect: vi.fn(() => effect),
            createDynamicTexture: vi.fn(() => internalTexture),
            updateDynamicTexture: vi.fn(),
        };
        engine = mockEngine as unknown as ThinEngine;

        const layer = CreateTextLayer();
        layer.text!.color = "rgba(255, 255, 255, 0.8)";
        CreateTextRenderer(engine, [layer]);

        expect(mockEngine.createCanvas).toHaveBeenCalledWith(1, 1);
        expect(mockEngine.updateDynamicTexture).toHaveBeenCalledWith(internalTexture, canvas, false, false);
        expect(context.fillStyle).toBe("rgba(255, 255, 255, 0.8)");
    });

    it("treats Babylon Native Canvas textures as premultiplied", () => {
        const context = {
            font: "",
            letterSpacing: "",
            textBaseline: "alphabetic",
            fillStyle: "",
            scale: vi.fn(),
            measureText: vi.fn((text: string) => ({ width: text.length * 10, fontBoundingBoxAscent: 16, fontBoundingBoxDescent: 4 })),
            fillText: vi.fn(),
        };
        const canvas = { width: 1, height: 1, getContext: vi.fn(() => context) };
        const effect = { isReady: () => true, setFloat4: vi.fn(), setTexture: vi.fn(), dispose: vi.fn() };
        let engine: ThinEngine;
        const internalTexture = { getEngine: () => engine, dispose: vi.fn() };
        const mockEngine = {
            name: "WebGL",
            shaderPlatformName: "NATIVE",
            stencilState: {},
            createCanvas: vi.fn(() => canvas),
            createEffect: vi.fn(() => effect),
            createDynamicTexture: vi.fn(() => internalTexture),
            updateDynamicTexture: vi.fn(),
            createDynamicVertexBuffer: vi.fn(() => ({})),
            updateDynamicVertexBuffer: vi.fn(),
            enableEffect: vi.fn(),
            bindBuffers: vi.fn(),
            setColorWrite: vi.fn(),
            setState: vi.fn(),
            setStencilBuffer: vi.fn(),
            setAlphaMode: vi.fn(),
            drawArraysType: vi.fn(),
            _releaseBuffer: vi.fn(),
        };
        engine = mockEngine as unknown as ThinEngine;
        const layer = CreateTextLayer();
        const renderer = CreateTextRenderer(engine, [layer]);
        const frame = { frame: 0, screenW: 100, screenH: 100 };

        renderer.beginFrame(frame);
        const token = renderer.emitLayer(layer, [1, 0, 0, 1, 0, 0], 1, frame);
        renderer.flush(frame);
        renderer.recordLayer(token);

        expect(effect.setFloat4).toHaveBeenCalledWith("uSourcePremultiplied", 1, 0, 0, 0);
        expect(mockEngine.bindBuffers).toHaveBeenCalledWith(
            expect.objectContaining({ position: expect.anything(), uv: expect.anything(), alpha: expect.anything() }),
            null,
            effect
        );
        const vertexData = mockEngine.createDynamicVertexBuffer.mock.calls[0][0] as Float32Array;
        expect(vertexData.length % 5).toBe(0);
        renderer.dispose();
    });

    it("releases prior and current textures when an upload fails", () => {
        const context = {
            font: "",
            letterSpacing: "",
            textBaseline: "alphabetic",
            fillStyle: "",
            scale: vi.fn(),
            measureText: vi.fn((text: string) => ({ width: text.length * 10, fontBoundingBoxAscent: 16, fontBoundingBoxDescent: 4 })),
            fillText: vi.fn(),
        };
        const canvas = { width: 1, height: 1, getContext: vi.fn(() => context) };
        let engine: ThinEngine;
        const textures = [
            { getEngine: () => engine, dispose: vi.fn() },
            { getEngine: () => engine, dispose: vi.fn() },
        ];
        const mockEngine = {
            createCanvas: vi.fn(() => canvas),
            createDynamicTexture: vi.fn().mockReturnValueOnce(textures[0]).mockReturnValueOnce(textures[1]),
            updateDynamicTexture: vi
                .fn()
                .mockImplementationOnce(() => undefined)
                .mockImplementationOnce(() => {
                    throw new Error("upload failed");
                }),
        };
        engine = mockEngine as unknown as ThinEngine;

        expect(() => CreateTextRenderer(engine, [CreateTextLayer(1), CreateTextLayer(2)])).toThrow("upload failed");
        expect(textures[0].dispose).toHaveBeenCalledOnce();
        expect(textures[1].dispose).toHaveBeenCalledOnce();
    });

    it("fails clearly when no Canvas2D implementation exists", () => {
        const effect = { isReady: () => true, dispose: vi.fn() };
        const engine = { createEffect: vi.fn(() => effect) } as unknown as ThinEngine;
        const originalOffscreenCanvas = globalThis.OffscreenCanvas;
        const originalDocument = globalThis.document;
        // Vitest's node environment has neither API, but preserve them in case the environment changes.
        Object.assign(globalThis, { OffscreenCanvas: undefined, document: undefined });
        try {
            expect(() => CreateTextRenderer(engine, [CreateTextLayer()])).toThrow(/engine\.createCanvas/);
        } finally {
            Object.assign(globalThis, { OffscreenCanvas: originalOffscreenCanvas, document: originalDocument });
        }
    });
});
