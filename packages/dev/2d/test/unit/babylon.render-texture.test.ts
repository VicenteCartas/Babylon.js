import { RenderTexture2D } from "2d/RenderTexture/renderTexture2D";
import type { IRenderTexture2DOptions } from "2d/RenderTexture/renderTexture2D";
import { Constants } from "core/Engines/constants";

/**
 * Creates a mock RenderTargetWrapper.
 * Must have `shareDepth` so ThinTexture's constructor recognises it as a wrapper,
 * and `texture: null` so no InternalTexture engine look-ups are attempted.
 */
function mockRenderTarget() {
    return {
        shareDepth: false,
        texture: null,
        dispose: jest.fn(),
    };
}

/**
 * Minimal engine mock with the methods used by RenderTexture2D.
 * Each call to `createRenderTargetTexture` returns a fresh mock RT.
 */
function mockEngine() {
    return {
        createRenderTargetTexture: jest.fn(() => mockRenderTarget()),
        bindFramebuffer: jest.fn(),
        restoreDefaultFramebuffer: jest.fn(),
        readPixels: jest.fn(() => Promise.resolve(new Uint8Array(16))),
        unbindAllTextures: jest.fn(),
    } as any;
}

/** Minimal Scene2D mock with a spy on renderContent */
function mockScene() {
    return {
        renderContent: jest.fn(),
    } as any;
}

describe("RenderTexture2D", () => {
    // -----------------------------------------------------------
    // Construction
    // -----------------------------------------------------------
    describe("constructor", () => {
        it("should store the name", () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("minimap", engine, 256, 128);
            expect(rt.name).toBe("minimap");
        });

        it("should expose correct width and height", () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("rt", engine, 512, 256);
            expect(rt.width).toBe(512);
            expect(rt.height).toBe(256);
        });

        it("should call engine.createRenderTargetTexture with size and default options", () => {
            const engine = mockEngine();
            new RenderTexture2D("rt", engine, 320, 240);

            expect(engine.createRenderTargetTexture).toHaveBeenCalledTimes(1);

            const [size, opts] = engine.createRenderTargetTexture.mock.calls[0];
            expect(size).toEqual({ width: 320, height: 240 });
            // Defaults
            expect(opts.generateMipMaps).toBe(false);
            expect(opts.samplingMode).toBe(Constants.TEXTURE_BILINEAR_SAMPLINGMODE);
            expect(opts.format).toBe(Constants.TEXTUREFORMAT_RGBA);
            expect(opts.type).toBe(Constants.TEXTURETYPE_UNSIGNED_BYTE);
            expect(opts.generateDepthBuffer).toBe(false);
            expect(opts.generateStencilBuffer).toBe(false);
            expect(opts.label).toBe("rt");
        });

        it("should not be disposed initially", () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("rt", engine, 64, 64);
            expect(rt.isDisposed).toBe(false);
        });
    });

    // -----------------------------------------------------------
    // Construction with custom options
    // -----------------------------------------------------------
    describe("constructor with options", () => {
        it("should forward custom options to createRenderTargetTexture", () => {
            const engine = mockEngine();
            const options: IRenderTexture2DOptions = {
                generateMipMaps: true,
                samplingMode: Constants.TEXTURE_NEAREST_SAMPLINGMODE,
                format: Constants.TEXTUREFORMAT_RGBA_INTEGER,
                type: Constants.TEXTURETYPE_FLOAT,
                generateDepthBuffer: true,
                generateStencilBuffer: true,
            };

            new RenderTexture2D("custom", engine, 128, 128, options);

            const [, opts] = engine.createRenderTargetTexture.mock.calls[0];
            expect(opts.generateMipMaps).toBe(true);
            expect(opts.samplingMode).toBe(Constants.TEXTURE_NEAREST_SAMPLINGMODE);
            expect(opts.format).toBe(Constants.TEXTUREFORMAT_RGBA_INTEGER);
            expect(opts.type).toBe(Constants.TEXTURETYPE_FLOAT);
            expect(opts.generateDepthBuffer).toBe(true);
            expect(opts.generateStencilBuffer).toBe(true);
        });

        it("should default unspecified options while honouring provided ones", () => {
            const engine = mockEngine();
            const options: IRenderTexture2DOptions = {
                generateMipMaps: true,
                // All others left unset
            };

            new RenderTexture2D("partial", engine, 64, 64, options);

            const [, opts] = engine.createRenderTargetTexture.mock.calls[0];
            expect(opts.generateMipMaps).toBe(true);
            expect(opts.samplingMode).toBe(Constants.TEXTURE_BILINEAR_SAMPLINGMODE);
            expect(opts.format).toBe(Constants.TEXTUREFORMAT_RGBA);
            expect(opts.type).toBe(Constants.TEXTURETYPE_UNSIGNED_BYTE);
            expect(opts.generateDepthBuffer).toBe(false);
            expect(opts.generateStencilBuffer).toBe(false);
        });
    });

    // -----------------------------------------------------------
    // texture getter
    // -----------------------------------------------------------
    describe("texture getter", () => {
        it("should return a ThinTexture with CLAMP wrap modes", () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("rt", engine, 64, 64);
            const tex = rt.texture;

            expect(tex).toBeDefined();
            expect(tex.wrapU).toBe(Constants.TEXTURE_CLAMP_ADDRESSMODE);
            expect(tex.wrapV).toBe(Constants.TEXTURE_CLAMP_ADDRESSMODE);
        });

        it("should cache the ThinTexture across multiple accesses", () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("rt", engine, 64, 64);

            const first = rt.texture;
            const second = rt.texture;
            expect(first).toBe(second);
        });
    });

    // -----------------------------------------------------------
    // renderTarget getter
    // -----------------------------------------------------------
    describe("renderTarget getter", () => {
        it("should return the RenderTargetWrapper created by the engine", () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("rt", engine, 64, 64);

            const rtw = rt.renderTarget;
            expect(rtw).toBe(engine.createRenderTargetTexture.mock.results[0].value);
        });
    });

    // -----------------------------------------------------------
    // renderScene
    // -----------------------------------------------------------
    describe("renderScene", () => {
        it("should bind FBO, call renderContent(true), then restore default FB", () => {
            const engine = mockEngine();
            const scene = mockScene();
            const rt = new RenderTexture2D("rt", engine, 128, 128);

            const callOrder: string[] = [];
            engine.unbindAllTextures.mockImplementation(() => callOrder.push("unbindTex"));
            engine.bindFramebuffer.mockImplementation(() => callOrder.push("bind"));
            scene.renderContent.mockImplementation(() => callOrder.push("render"));
            engine.restoreDefaultFramebuffer.mockImplementation(() => callOrder.push("restore"));

            rt.renderScene(scene);

            expect(callOrder).toEqual(["unbindTex", "bind", "render", "restore"]);
            expect(engine.bindFramebuffer).toHaveBeenCalledWith(rt.renderTarget);
            expect(scene.renderContent).toHaveBeenCalledWith(true);
        });

        it("should default clear parameter to true", () => {
            const engine = mockEngine();
            const scene = mockScene();
            const rt = new RenderTexture2D("rt", engine, 64, 64);

            rt.renderScene(scene);

            expect(scene.renderContent).toHaveBeenCalledWith(true);
        });

        it("should pass clear=false to renderContent when specified", () => {
            const engine = mockEngine();
            const scene = mockScene();
            const rt = new RenderTexture2D("rt", engine, 64, 64);

            rt.renderScene(scene, false);

            expect(scene.renderContent).toHaveBeenCalledWith(false);
        });

        it("should pass clear=true explicitly when specified", () => {
            const engine = mockEngine();
            const scene = mockScene();
            const rt = new RenderTexture2D("rt", engine, 64, 64);

            rt.renderScene(scene, true);

            expect(scene.renderContent).toHaveBeenCalledWith(true);
        });
    });

    // -----------------------------------------------------------
    // resize
    // -----------------------------------------------------------
    describe("resize", () => {
        it("should change width and height", () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("rt", engine, 128, 128);

            rt.resize(256, 512);

            expect(rt.width).toBe(256);
            expect(rt.height).toBe(512);
        });

        it("should dispose the old render target and create a new one", () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("rt", engine, 128, 128);

            const oldRT = rt.renderTarget;
            rt.resize(256, 256);

            expect(oldRT.dispose).toHaveBeenCalledTimes(1);
            expect(engine.createRenderTargetTexture).toHaveBeenCalledTimes(2); // once in ctor, once in resize
            expect(rt.renderTarget).not.toBe(oldRT);
        });

        it("should create new render target with updated dimensions", () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("rt", engine, 128, 128);

            rt.resize(64, 32);

            const [size] = engine.createRenderTargetTexture.mock.calls[1];
            expect(size).toEqual({ width: 64, height: 32 });
        });

        it("should invalidate cached ThinTexture", () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("rt", engine, 128, 128);

            const oldTex = rt.texture;
            rt.resize(256, 256);
            const newTex = rt.texture;

            // After resize, a fresh ThinTexture should be created
            expect(newTex).not.toBe(oldTex);
        });

        it("should be a no-op when dimensions are the same", () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("rt", engine, 128, 128);
            const originalRT = rt.renderTarget;

            rt.resize(128, 128);

            // No additional createRenderTargetTexture call
            expect(engine.createRenderTargetTexture).toHaveBeenCalledTimes(1);
            expect(originalRT.dispose).not.toHaveBeenCalled();
            expect(rt.renderTarget).toBe(originalRT);
        });

        it("should not be a no-op when only width changes", () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("rt", engine, 128, 128);

            rt.resize(256, 128);

            expect(engine.createRenderTargetTexture).toHaveBeenCalledTimes(2);
            expect(rt.width).toBe(256);
            expect(rt.height).toBe(128);
        });

        it("should not be a no-op when only height changes", () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("rt", engine, 128, 128);

            rt.resize(128, 256);

            expect(engine.createRenderTargetTexture).toHaveBeenCalledTimes(2);
            expect(rt.width).toBe(128);
            expect(rt.height).toBe(256);
        });
    });

    // -----------------------------------------------------------
    // readPixelsAsync
    // -----------------------------------------------------------
    describe("readPixelsAsync", () => {
        it("should bind FBO, read pixels, then restore default FB", async () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("rt", engine, 4, 4);
            const expectedPixels = new Uint8Array([1, 2, 3, 4]);
            engine.readPixels.mockResolvedValue(expectedPixels);

            const callOrder: string[] = [];
            engine.bindFramebuffer.mockImplementation(() => callOrder.push("bind"));
            engine.readPixels.mockImplementation(() => {
                callOrder.push("read");
                return Promise.resolve(expectedPixels);
            });
            engine.restoreDefaultFramebuffer.mockImplementation(() => callOrder.push("restore"));

            const result = await rt.readPixelsAsync();

            expect(callOrder).toEqual(["bind", "read", "restore"]);
            expect(result).toBe(expectedPixels);
        });

        it("should bind the correct render target", async () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("rt", engine, 8, 8);

            await rt.readPixelsAsync();

            expect(engine.bindFramebuffer).toHaveBeenCalledWith(rt.renderTarget);
        });

        it("should pass width and height to readPixels", async () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("rt", engine, 16, 32);

            await rt.readPixelsAsync();

            expect(engine.readPixels).toHaveBeenCalledWith(0, 0, 16, 32, true, true);
        });
    });

    // -----------------------------------------------------------
    // dispose
    // -----------------------------------------------------------
    describe("dispose", () => {
        it("should set isDisposed to true", () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("rt", engine, 64, 64);

            rt.dispose();

            expect(rt.isDisposed).toBe(true);
        });

        it("should dispose the render target", () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("rt", engine, 64, 64);
            const rtw = rt.renderTarget;

            rt.dispose();

            expect(rtw.dispose).toHaveBeenCalledTimes(1);
        });

        it("should be a no-op when called twice", () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("rt", engine, 64, 64);
            const rtw = rt.renderTarget;

            rt.dispose();
            rt.dispose();

            // dispose on the render target wrapper should only be called once
            expect(rtw.dispose).toHaveBeenCalledTimes(1);
            expect(rt.isDisposed).toBe(true);
        });

        it("should not throw when called twice", () => {
            const engine = mockEngine();
            const rt = new RenderTexture2D("rt", engine, 64, 64);

            rt.dispose();
            expect(() => rt.dispose()).not.toThrow();
        });
    });
});
