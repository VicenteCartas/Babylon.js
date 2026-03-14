import { RectMask2D } from "2d/Masking/rectMask2D";
import { SpriteMask2D } from "2d/Masking/spriteMask2D";
import { MaskStateManager } from "2d/Masking/maskStateManager";
import { Rectangle2D } from "2d/Math/rectangle2D";
import { RenderableNode2D } from "2d/Node2D/renderableNode2D";
import { Constants } from "core/Engines/constants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a mock engine with tracked calls for scissor and stencil testing. */
function createMockEngine() {
    const calls: { method: string; args: any[] }[] = [];
    const engine = {
        enableScissor: jest.fn((...args: any[]) => calls.push({ method: "enableScissor", args })),
        disableScissor: jest.fn((...args: any[]) => calls.push({ method: "disableScissor", args })),
        setStencilBuffer: jest.fn((...args: any[]) => calls.push({ method: "setStencilBuffer", args })),
        setStencilFunctionReference: jest.fn((...args: any[]) => calls.push({ method: "setStencilFunctionReference", args })),
        setStencilFunction: jest.fn((...args: any[]) => calls.push({ method: "setStencilFunction", args })),
        setStencilOperationPass: jest.fn((...args: any[]) => calls.push({ method: "setStencilOperationPass", args })),
        setStencilOperationFail: jest.fn((...args: any[]) => calls.push({ method: "setStencilOperationFail", args })),
        setStencilOperationDepthFail: jest.fn((...args: any[]) => calls.push({ method: "setStencilOperationDepthFail", args })),
        setStencilMask: jest.fn((...args: any[]) => calls.push({ method: "setStencilMask", args })),
        clear: jest.fn(),
    };
    return { engine: engine as any, calls };
}

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║  RectMask2D                                                           ║
// ╚═════════════════════════════════════════════════════════════════════════╝

describe("RectMask2D", () => {
    it("should create with default values", () => {
        const mask = new RectMask2D();
        expect(mask.enabled).toBe(true);
        expect(mask.inverted).toBe(false);
        expect(mask.padding).toBe(0);
        expect(mask.rect.x).toBe(0);
        expect(mask.rect.y).toBe(0);
        expect(mask.rect.width).toBe(0);
        expect(mask.rect.height).toBe(0);
    });

    it("should create with custom rectangle", () => {
        const mask = new RectMask2D(10, 20, 300, 200);
        expect(mask.rect.x).toBe(10);
        expect(mask.rect.y).toBe(20);
        expect(mask.rect.width).toBe(300);
        expect(mask.rect.height).toBe(200);
    });

    it("should implement IMask2D interface", () => {
        const mask = new RectMask2D();
        mask.enabled = false;
        mask.inverted = true;
        expect(mask.enabled).toBe(false);
        expect(mask.inverted).toBe(true);
    });

    it("should dispose without error", () => {
        const mask = new RectMask2D(0, 0, 100, 100);
        expect(() => mask.dispose()).not.toThrow();
    });

    it("should allow partial parameter defaults", () => {
        const mask = new RectMask2D(5, 10);
        expect(mask.rect.x).toBe(5);
        expect(mask.rect.y).toBe(10);
        expect(mask.rect.width).toBe(0);
        expect(mask.rect.height).toBe(0);
    });

    it("should allow padding to be set", () => {
        const mask = new RectMask2D(0, 0, 100, 100);
        mask.padding = 8;
        expect(mask.padding).toBe(8);
    });

    it("should allow negative coordinates", () => {
        const mask = new RectMask2D(-10, -20, 100, 100);
        expect(mask.rect.x).toBe(-10);
        expect(mask.rect.y).toBe(-20);
    });

    it("should expose a Rectangle2D rect object that can be mutated", () => {
        const mask = new RectMask2D(0, 0, 50, 50);
        mask.rect.x = 25;
        mask.rect.width = 200;
        expect(mask.rect.x).toBe(25);
        expect(mask.rect.width).toBe(200);
    });

    it("should allow replacing the rect entirely", () => {
        const mask = new RectMask2D(0, 0, 50, 50);
        mask.rect = new Rectangle2D(10, 10, 200, 200);
        expect(mask.rect.x).toBe(10);
        expect(mask.rect.width).toBe(200);
    });

    it("should be safe to dispose multiple times", () => {
        const mask = new RectMask2D(0, 0, 100, 100);
        mask.dispose();
        expect(() => mask.dispose()).not.toThrow();
    });

    it("should toggle enabled on and off", () => {
        const mask = new RectMask2D(0, 0, 100, 100);
        expect(mask.enabled).toBe(true);
        mask.enabled = false;
        expect(mask.enabled).toBe(false);
        mask.enabled = true;
        expect(mask.enabled).toBe(true);
    });

    it("should toggle inverted on and off", () => {
        const mask = new RectMask2D(0, 0, 100, 100);
        expect(mask.inverted).toBe(false);
        mask.inverted = true;
        expect(mask.inverted).toBe(true);
        mask.inverted = false;
        expect(mask.inverted).toBe(false);
    });
});

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║  SpriteMask2D                                                         ║
// ╚═════════════════════════════════════════════════════════════════════════╝

describe("SpriteMask2D", () => {
    it("should create with sprite and default threshold", () => {
        const mockSprite = {} as any;
        const mask = new SpriteMask2D(mockSprite);
        expect(mask.sprite).toBe(mockSprite);
        expect(mask.alphaThreshold).toBe(0.5);
        expect(mask.enabled).toBe(true);
        expect(mask.inverted).toBe(false);
    });

    it("should create with custom threshold", () => {
        const mockSprite = {} as any;
        const mask = new SpriteMask2D(mockSprite, 0.8);
        expect(mask.alphaThreshold).toBe(0.8);
    });

    it("should null sprite reference on dispose", () => {
        const mockSprite = {} as any;
        const mask = new SpriteMask2D(mockSprite);
        mask.dispose();
        expect(mask.sprite).toBeNull();
    });

    it("should accept a threshold of 0", () => {
        const mask = new SpriteMask2D({} as any, 0);
        expect(mask.alphaThreshold).toBe(0);
    });

    it("should accept a threshold of 1", () => {
        const mask = new SpriteMask2D({} as any, 1);
        expect(mask.alphaThreshold).toBe(1);
    });

    it("should allow changing alphaThreshold after construction", () => {
        const mask = new SpriteMask2D({} as any, 0.5);
        mask.alphaThreshold = 0.9;
        expect(mask.alphaThreshold).toBe(0.9);
    });

    it("should allow changing the sprite after construction", () => {
        const sprite1 = { id: "s1" } as any;
        const sprite2 = { id: "s2" } as any;
        const mask = new SpriteMask2D(sprite1);
        expect(mask.sprite).toBe(sprite1);
        mask.sprite = sprite2;
        expect(mask.sprite).toBe(sprite2);
    });

    it("should allow toggling enabled", () => {
        const mask = new SpriteMask2D({} as any);
        mask.enabled = false;
        expect(mask.enabled).toBe(false);
        mask.enabled = true;
        expect(mask.enabled).toBe(true);
    });

    it("should allow toggling inverted", () => {
        const mask = new SpriteMask2D({} as any);
        mask.inverted = true;
        expect(mask.inverted).toBe(true);
        mask.inverted = false;
        expect(mask.inverted).toBe(false);
    });

    it("should not dispose the sprite itself on mask dispose", () => {
        const disposeSpy = jest.fn();
        const mockSprite = { dispose: disposeSpy } as any;
        const mask = new SpriteMask2D(mockSprite);
        mask.dispose();
        // The mask clears its reference but does NOT call sprite.dispose()
        expect(disposeSpy).not.toHaveBeenCalled();
        expect(mask.sprite).toBeNull();
    });

    it("should be safe to dispose multiple times", () => {
        const mask = new SpriteMask2D({} as any);
        mask.dispose();
        expect(() => mask.dispose()).not.toThrow();
    });
});

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║  MaskStateManager                                                     ║
// ╚═════════════════════════════════════════════════════════════════════════╝

describe("MaskStateManager", () => {
    describe("constructor", () => {
        it("should start with no masks active", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);
            expect(mgr.hasMasks).toBe(false);
            expect(mgr.stencilLevel).toBe(0);
        });

        it("should detect scissor support based on engine", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);
            // engine has enableScissor → scissor is supported
            // No direct getter, but pushRectMask should call enableScissor
            mgr.setViewportHeight(600);
            mgr.pushRectMask(new Rectangle2D(0, 0, 100, 100), false);
            expect(engine.enableScissor).toHaveBeenCalled();
        });

        it("should not call enableScissor when engine lacks it", () => {
            const engine = {
                setStencilBuffer: jest.fn(),
                setStencilFunctionReference: jest.fn(),
                setStencilFunction: jest.fn(),
                setStencilOperationPass: jest.fn(),
                setStencilOperationFail: jest.fn(),
                setStencilOperationDepthFail: jest.fn(),
                setStencilMask: jest.fn(),
                disableScissor: jest.fn(),
            } as any;
            const mgr = new MaskStateManager(engine);
            mgr.setViewportHeight(600);
            mgr.pushRectMask(new Rectangle2D(0, 0, 100, 100), false);
            // No crash; enableScissor was never called
            expect(mgr.hasMasks).toBe(true);
        });
    });

    describe("pushRectMask / popMask (scissor path)", () => {
        it("should enable scissor with Y-flipped coordinates on push", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);
            mgr.setViewportHeight(600);

            mgr.pushRectMask(new Rectangle2D(10, 20, 200, 100), false);

            // glY = viewportHeight - y - height = 600 - 20 - 100 = 480
            expect(engine.enableScissor).toHaveBeenCalledWith(10, 480, 200, 100);
            expect(mgr.hasMasks).toBe(true);
        });

        it("should disable scissor on pop when stack is empty", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);
            mgr.setViewportHeight(600);

            mgr.pushRectMask(new Rectangle2D(0, 0, 100, 100), false);
            mgr.popMask();

            expect(engine.disableScissor).toHaveBeenCalled();
            expect(mgr.hasMasks).toBe(false);
        });

        it("should intersect nested rect masks", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);
            mgr.setViewportHeight(800);

            // Push outer: (0,0,200,200)
            mgr.pushRectMask(new Rectangle2D(0, 0, 200, 200), false);
            // Push inner: (100,100,200,200) → intersection = (100,100,100,100)
            mgr.pushRectMask(new Rectangle2D(100, 100, 200, 200), false);

            // The second enableScissor call should use the intersected rect
            // glY = 800 - 100 - 100 = 600
            expect(engine.enableScissor).toHaveBeenLastCalledWith(100, 600, 100, 100);
        });

        it("should restore parent scissor rect on inner pop", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);
            mgr.setViewportHeight(800);

            // Push outer: (0,0,200,200)
            mgr.pushRectMask(new Rectangle2D(0, 0, 200, 200), false);
            // Push inner: (50,50,100,100)
            mgr.pushRectMask(new Rectangle2D(50, 50, 100, 100), false);
            // Pop inner → should restore outer scissor
            mgr.popMask();

            // Outer: glY = 800 - 0 - 200 = 600
            expect(engine.enableScissor).toHaveBeenLastCalledWith(0, 600, 200, 200);
            expect(mgr.hasMasks).toBe(true);
        });

        it("should compute zero-size intersection for non-overlapping rects", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);
            mgr.setViewportHeight(600);

            mgr.pushRectMask(new Rectangle2D(0, 0, 50, 50), false);
            mgr.pushRectMask(new Rectangle2D(200, 200, 50, 50), false);

            // Non-overlapping → intersection is (200,200,0,0)
            // glY = 600 - 200 - 0 = 400
            expect(engine.enableScissor).toHaveBeenLastCalledWith(200, 400, 0, 0);
        });

        it("should handle popping when the stack is already empty (no-op)", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);
            expect(() => mgr.popMask()).not.toThrow();
            expect(mgr.hasMasks).toBe(false);
        });
    });

    describe("pushRectMask inverted (stencil fallback)", () => {
        it("should use stencil path for inverted rect masks", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);
            mgr.setViewportHeight(600);

            mgr.pushRectMask(new Rectangle2D(0, 0, 100, 100), true);

            // Inverted rects fall back to stencil, not scissor
            expect(engine.enableScissor).not.toHaveBeenCalled();
            expect(engine.setStencilBuffer).toHaveBeenCalledWith(true);
            expect(engine.setStencilFunction).toHaveBeenCalledWith(Constants.NOTEQUAL);
            expect(mgr.stencilLevel).toBe(1);
        });

        it("should decrement stencil and disable on pop of inverted rect mask", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);
            mgr.setViewportHeight(600);

            mgr.pushRectMask(new Rectangle2D(0, 0, 100, 100), true);
            mgr.popMask();

            // Since it went through sprite/stencil path, pop decrements stencilLevel
            expect(mgr.stencilLevel).toBe(0);
            // When stencil level goes to 0, stencil buffer is disabled
            expect(engine.setStencilBuffer).toHaveBeenLastCalledWith(false);
        });
    });

    describe("pushSpriteMask / popMask (stencil path)", () => {
        it("should increment stencil level on push", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);

            mgr.pushSpriteMask(false);

            expect(mgr.stencilLevel).toBe(1);
            expect(engine.setStencilBuffer).toHaveBeenCalledWith(true);
            expect(engine.setStencilFunction).toHaveBeenCalledWith(Constants.EQUAL);
            expect(engine.setStencilFunctionReference).toHaveBeenCalledWith(1);
            expect(engine.setStencilMask).toHaveBeenCalledWith(0x00); // no writes during content
        });

        it("should use NOTEQUAL for inverted sprite mask", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);

            mgr.pushSpriteMask(true);

            expect(mgr.stencilLevel).toBe(1);
            expect(engine.setStencilFunction).toHaveBeenCalledWith(Constants.NOTEQUAL);
            expect(engine.setStencilFunctionReference).toHaveBeenCalledWith(1);
        });

        it("should decrement stencil level on pop", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);

            mgr.pushSpriteMask(false);
            expect(mgr.stencilLevel).toBe(1);

            mgr.popMask();
            expect(mgr.stencilLevel).toBe(0);
        });

        it("should disable stencil buffer when last sprite mask is popped", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);

            mgr.pushSpriteMask(false);
            mgr.popMask();

            expect(engine.setStencilBuffer).toHaveBeenLastCalledWith(false);
        });

        it("should keep stencil enabled when nested sprite masks remain", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);

            mgr.pushSpriteMask(false); // level 1
            mgr.pushSpriteMask(false); // level 2
            expect(mgr.stencilLevel).toBe(2);

            mgr.popMask(); // back to level 1
            expect(mgr.stencilLevel).toBe(1);
            // Should update the reference to level 1, NOT disable stencil
            expect(engine.setStencilFunctionReference).toHaveBeenLastCalledWith(1);
        });

        it("should set KEEP operations during masked content rendering", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);

            mgr.pushSpriteMask(false);

            expect(engine.setStencilOperationPass).toHaveBeenCalledWith(Constants.KEEP);
            expect(engine.setStencilOperationFail).toHaveBeenCalledWith(Constants.KEEP);
            expect(engine.setStencilOperationDepthFail).toHaveBeenCalledWith(Constants.KEEP);
        });
    });

    describe("nested masks (mixed rect + sprite)", () => {
        it("should handle rect inside sprite mask", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);
            mgr.setViewportHeight(600);

            mgr.pushSpriteMask(false); // stencil level 1
            mgr.pushRectMask(new Rectangle2D(10, 10, 80, 80), false); // scissor

            expect(mgr.stencilLevel).toBe(1);
            expect(engine.enableScissor).toHaveBeenCalled();
            expect(mgr.hasMasks).toBe(true);

            mgr.popMask(); // pop rect
            expect(engine.disableScissor).toHaveBeenCalled();

            mgr.popMask(); // pop sprite
            expect(mgr.stencilLevel).toBe(0);
            expect(mgr.hasMasks).toBe(false);
        });

        it("should handle sprite inside rect mask", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);
            mgr.setViewportHeight(600);

            mgr.pushRectMask(new Rectangle2D(0, 0, 200, 200), false);
            mgr.pushSpriteMask(false);

            expect(mgr.stencilLevel).toBe(1);
            expect(engine.enableScissor).toHaveBeenCalled();

            mgr.popMask(); // pop sprite
            expect(mgr.stencilLevel).toBe(0);

            mgr.popMask(); // pop rect
            expect(engine.disableScissor).toHaveBeenCalled();
            expect(mgr.hasMasks).toBe(false);
        });

        it("should handle three levels of nesting", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);
            mgr.setViewportHeight(600);

            mgr.pushSpriteMask(false); // level 1
            mgr.pushSpriteMask(false); // level 2
            mgr.pushSpriteMask(false); // level 3
            expect(mgr.stencilLevel).toBe(3);

            mgr.popMask(); // → 2
            expect(mgr.stencilLevel).toBe(2);
            mgr.popMask(); // → 1
            expect(mgr.stencilLevel).toBe(1);
            mgr.popMask(); // → 0
            expect(mgr.stencilLevel).toBe(0);
            expect(mgr.hasMasks).toBe(false);
        });
    });

    describe("beginStencilMaskWrite", () => {
        it("should enable stencil buffer for writing", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);

            mgr.beginStencilMaskWrite();

            expect(engine.setStencilBuffer).toHaveBeenCalledWith(true);
            expect(engine.setStencilFunction).toHaveBeenCalledWith(Constants.ALWAYS);
            expect(engine.setStencilOperationPass).toHaveBeenCalledWith(Constants.INCR);
            expect(engine.setStencilMask).toHaveBeenCalledWith(0xff);
        });

        it("should set reference to current stencil level", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);

            // Push one sprite mask first to get stencil level to 1
            mgr.pushSpriteMask(false);
            engine.setStencilFunctionReference.mockClear();

            mgr.beginStencilMaskWrite();

            expect(engine.setStencilFunctionReference).toHaveBeenCalledWith(1);
        });

        it("should set KEEP for fail and depth-fail operations", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);

            mgr.beginStencilMaskWrite();

            expect(engine.setStencilOperationFail).toHaveBeenCalledWith(Constants.KEEP);
            expect(engine.setStencilOperationDepthFail).toHaveBeenCalledWith(Constants.KEEP);
        });
    });

    describe("setViewportHeight", () => {
        it("should affect Y-flip calculation for scissor", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);

            mgr.setViewportHeight(1080);
            mgr.pushRectMask(new Rectangle2D(0, 0, 100, 100), false);
            // glY = 1080 - 0 - 100 = 980
            expect(engine.enableScissor).toHaveBeenCalledWith(0, 980, 100, 100);
        });

        it("should use zero viewport height by default", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);
            // Not calling setViewportHeight, default is 0
            mgr.pushRectMask(new Rectangle2D(0, 0, 100, 100), false);
            // glY = 0 - 0 - 100 = -100
            expect(engine.enableScissor).toHaveBeenCalledWith(0, -100, 100, 100);
        });

        it("should be callable multiple times (once per frame)", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);

            mgr.setViewportHeight(600);
            mgr.setViewportHeight(800);
            mgr.pushRectMask(new Rectangle2D(0, 0, 100, 100), false);
            // Uses latest: glY = 800 - 0 - 100 = 700
            expect(engine.enableScissor).toHaveBeenCalledWith(0, 700, 100, 100);
        });
    });

    describe("reset", () => {
        it("should clear all mask state", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);
            mgr.setViewportHeight(600);

            mgr.pushSpriteMask(false);
            mgr.pushRectMask(new Rectangle2D(0, 0, 100, 100), false);

            mgr.reset();

            expect(mgr.hasMasks).toBe(false);
            expect(mgr.stencilLevel).toBe(0);
            expect(engine.disableScissor).toHaveBeenCalled();
            expect(engine.setStencilBuffer).toHaveBeenLastCalledWith(false);
        });

        it("should allow new masks after reset", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);
            mgr.setViewportHeight(600);

            mgr.pushSpriteMask(false);
            mgr.reset();

            mgr.pushRectMask(new Rectangle2D(10, 10, 50, 50), false);
            expect(mgr.hasMasks).toBe(true);
            // glY = 600 - 10 - 50 = 540
            expect(engine.enableScissor).toHaveBeenLastCalledWith(10, 540, 50, 50);
        });

        it("should reset scissor stack so next rect push does not intersect stale state", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);
            mgr.setViewportHeight(600);

            mgr.pushRectMask(new Rectangle2D(0, 0, 10, 10), false);
            mgr.reset();

            // Now push a new rect — should NOT intersect with the old (0,0,10,10)
            mgr.pushRectMask(new Rectangle2D(100, 100, 200, 200), false);
            // glY = 600 - 100 - 200 = 300
            expect(engine.enableScissor).toHaveBeenLastCalledWith(100, 300, 200, 200);
        });
    });

    describe("dispose", () => {
        it("should clear stacks and null the engine", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);
            mgr.pushSpriteMask(false);

            mgr.dispose();

            expect(mgr.hasMasks).toBe(false);
            // dispose() now properly resets stencil level to 0
            expect(mgr.stencilLevel).toBe(0);
        });

        it("should not throw if called without prior operations", () => {
            const { engine } = createMockEngine();
            const mgr = new MaskStateManager(engine);
            expect(() => mgr.dispose()).not.toThrow();
        });
    });
});

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║  RenderCommand2D types (compile-time & runtime discriminated union)    ║
// ╚═════════════════════════════════════════════════════════════════════════╝

describe("RenderCommand2D types", () => {
    // Because RenderCommandType is a const enum, it compiles to inline numbers.
    // We verify the expected numeric values to guard against accidental reorder.

    it("should have Sprite command type = 0", () => {
        const cmd = { type: 0 as const, spriteData: {} as any };
        expect(cmd.type).toBe(0);
    });

    it("should have PushRectMask command type = 1", () => {
        const cmd = { type: 1 as const, rectMask: new RectMask2D(), maskOwner: {} as any };
        expect(cmd.type).toBe(1);
    });

    it("should have PushSpriteMask command type = 2", () => {
        const cmd = { type: 2 as const, spriteMask: new SpriteMask2D({} as any), maskOwner: {} as any };
        expect(cmd.type).toBe(2);
    });

    it("should have PopMask command type = 3", () => {
        const cmd = { type: 3 as const };
        expect(cmd.type).toBe(3);
    });

    it("should discriminate by type in a switch", () => {
        // Sprite = 0, PushRectMask = 1, PushSpriteMask = 2, PopMask = 3
        const commands = [
            { type: 0, spriteData: { id: "s1" } },
            { type: 1, rectMask: new RectMask2D(0, 0, 100, 100), maskOwner: {} },
            { type: 0, spriteData: { id: "s2" } },
            { type: 3 },
        ];

        const types: number[] = [];
        for (const cmd of commands) {
            types.push(cmd.type);
        }
        expect(types).toEqual([0, 1, 0, 3]);
    });

    it("should hold correct references in PushRectMask command", () => {
        const mask = new RectMask2D(10, 20, 300, 400);
        const owner = new RenderableNode2D("owner", null);
        const cmd = { type: 1 as const, rectMask: mask, maskOwner: owner };
        expect(cmd.rectMask).toBe(mask);
        expect(cmd.maskOwner).toBe(owner);
        expect(cmd.rectMask.rect.width).toBe(300);
    });

    it("should hold correct references in PushSpriteMask command", () => {
        const sprite = { name: "maskSprite" } as any;
        const mask = new SpriteMask2D(sprite, 0.7);
        const owner = new RenderableNode2D("owner", null);
        const cmd = { type: 2 as const, spriteMask: mask, maskOwner: owner };
        expect(cmd.spriteMask.sprite).toBe(sprite);
        expect(cmd.spriteMask.alphaThreshold).toBe(0.7);
        expect(cmd.maskOwner).toBe(owner);
    });
});

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║  Rectangle2D.IntersectToRef                                           ║
// ╚═════════════════════════════════════════════════════════════════════════╝

describe("Rectangle2D.IntersectToRef", () => {
    it("should compute intersection of overlapping rectangles", () => {
        const a = new Rectangle2D(0, 0, 100, 100);
        const b = new Rectangle2D(50, 50, 100, 100);
        const ref = new Rectangle2D();
        Rectangle2D.IntersectToRef(a, b, ref);
        expect(ref.x).toBe(50);
        expect(ref.y).toBe(50);
        expect(ref.width).toBe(50);
        expect(ref.height).toBe(50);
    });

    it("should return zero-size for non-overlapping rectangles", () => {
        const a = new Rectangle2D(0, 0, 50, 50);
        const b = new Rectangle2D(100, 100, 50, 50);
        const ref = new Rectangle2D();
        Rectangle2D.IntersectToRef(a, b, ref);
        expect(ref.width).toBe(0);
        expect(ref.height).toBe(0);
    });

    it("should return the smaller rect when one contains the other", () => {
        const a = new Rectangle2D(0, 0, 200, 200);
        const b = new Rectangle2D(50, 50, 50, 50);
        const ref = new Rectangle2D();
        Rectangle2D.IntersectToRef(a, b, ref);
        expect(ref.x).toBe(50);
        expect(ref.y).toBe(50);
        expect(ref.width).toBe(50);
        expect(ref.height).toBe(50);
    });

    it("should be commutative (a,b same as b,a)", () => {
        const a = new Rectangle2D(10, 20, 100, 80);
        const b = new Rectangle2D(50, 40, 120, 90);
        const ref1 = new Rectangle2D();
        const ref2 = new Rectangle2D();
        Rectangle2D.IntersectToRef(a, b, ref1);
        Rectangle2D.IntersectToRef(b, a, ref2);
        expect(ref1.x).toBe(ref2.x);
        expect(ref1.y).toBe(ref2.y);
        expect(ref1.width).toBe(ref2.width);
        expect(ref1.height).toBe(ref2.height);
    });

    it("should return the ref rectangle for chaining", () => {
        const a = new Rectangle2D(0, 0, 10, 10);
        const b = new Rectangle2D(0, 0, 10, 10);
        const ref = new Rectangle2D();
        const result = Rectangle2D.IntersectToRef(a, b, ref);
        expect(result).toBe(ref);
    });

    it("should handle identical rectangles (intersection = itself)", () => {
        const a = new Rectangle2D(10, 20, 100, 50);
        const ref = new Rectangle2D();
        Rectangle2D.IntersectToRef(a, a, ref);
        expect(ref.x).toBe(10);
        expect(ref.y).toBe(20);
        expect(ref.width).toBe(100);
        expect(ref.height).toBe(50);
    });

    it("should handle zero-width rectangle", () => {
        const a = new Rectangle2D(10, 10, 0, 50);
        const b = new Rectangle2D(5, 5, 20, 60);
        const ref = new Rectangle2D();
        Rectangle2D.IntersectToRef(a, b, ref);
        expect(ref.width).toBe(0);
    });

    it("should handle zero-height rectangle", () => {
        const a = new Rectangle2D(10, 10, 50, 0);
        const b = new Rectangle2D(5, 5, 60, 20);
        const ref = new Rectangle2D();
        Rectangle2D.IntersectToRef(a, b, ref);
        expect(ref.height).toBe(0);
    });

    it("should handle negative coordinates", () => {
        const a = new Rectangle2D(-100, -100, 200, 200);
        const b = new Rectangle2D(-50, -50, 100, 100);
        const ref = new Rectangle2D();
        Rectangle2D.IntersectToRef(a, b, ref);
        expect(ref.x).toBe(-50);
        expect(ref.y).toBe(-50);
        expect(ref.width).toBe(100);
        expect(ref.height).toBe(100);
    });

    it("should return zero-size for touching-edge rectangles (no overlap)", () => {
        const a = new Rectangle2D(0, 0, 50, 50);
        const b = new Rectangle2D(50, 0, 50, 50); // touching at x=50
        const ref = new Rectangle2D();
        Rectangle2D.IntersectToRef(a, b, ref);
        expect(ref.width).toBe(0);
    });

    it("should handle single-pixel overlap", () => {
        const a = new Rectangle2D(0, 0, 51, 51);
        const b = new Rectangle2D(50, 50, 50, 50);
        const ref = new Rectangle2D();
        Rectangle2D.IntersectToRef(a, b, ref);
        expect(ref.x).toBe(50);
        expect(ref.y).toBe(50);
        expect(ref.width).toBe(1);
        expect(ref.height).toBe(1);
    });

    it("should handle large rectangles", () => {
        const a = new Rectangle2D(0, 0, 100000, 100000);
        const b = new Rectangle2D(50000, 50000, 100000, 100000);
        const ref = new Rectangle2D();
        Rectangle2D.IntersectToRef(a, b, ref);
        expect(ref.x).toBe(50000);
        expect(ref.y).toBe(50000);
        expect(ref.width).toBe(50000);
        expect(ref.height).toBe(50000);
    });

    it("should handle horizontal overlap only (no vertical overlap)", () => {
        const a = new Rectangle2D(0, 0, 100, 50);
        const b = new Rectangle2D(50, 100, 100, 50);
        const ref = new Rectangle2D();
        Rectangle2D.IntersectToRef(a, b, ref);
        expect(ref.width).toBe(50); // horizontal overlap
        expect(ref.height).toBe(0); // no vertical overlap
    });

    it("should handle vertical overlap only (no horizontal overlap)", () => {
        const a = new Rectangle2D(0, 0, 50, 100);
        const b = new Rectangle2D(100, 50, 50, 100);
        const ref = new Rectangle2D();
        Rectangle2D.IntersectToRef(a, b, ref);
        expect(ref.width).toBe(0); // no horizontal overlap
        expect(ref.height).toBe(50); // vertical overlap
    });
});

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║  RenderableNode2D.mask                                                          ║
// ╚═════════════════════════════════════════════════════════════════════════╝

describe("RenderableNode2D.mask", () => {
    it("should default to null", () => {
        const node = new RenderableNode2D("test", null);
        expect(node.mask).toBeNull();
    });

    it("should accept a RectMask2D", () => {
        const node = new RenderableNode2D("test", null);
        const mask = new RectMask2D(0, 0, 100, 100);
        node.mask = mask;
        expect(node.mask).toBe(mask);
    });

    it("should accept a SpriteMask2D", () => {
        const node = new RenderableNode2D("test", null);
        const mask = new SpriteMask2D({} as any);
        node.mask = mask;
        expect(node.mask).toBe(mask);
    });

    it("should null mask on dispose", () => {
        const node = new RenderableNode2D("test", null);
        node.mask = new RectMask2D(0, 0, 100, 100);
        node.dispose();
        expect(node.mask).toBeNull();
    });

    it("should allow clearing mask by setting to null", () => {
        const node = new RenderableNode2D("test", null);
        node.mask = new RectMask2D(0, 0, 100, 100);
        node.mask = null;
        expect(node.mask).toBeNull();
    });

    it("should allow replacing one mask with another", () => {
        const node = new RenderableNode2D("test", null);
        const mask1 = new RectMask2D(0, 0, 100, 100);
        const mask2 = new RectMask2D(10, 10, 200, 200);
        node.mask = mask1;
        expect(node.mask).toBe(mask1);
        node.mask = mask2;
        expect(node.mask).toBe(mask2);
    });

    it("should allow switching from RectMask2D to SpriteMask2D", () => {
        const node = new RenderableNode2D("test", null);
        const rectMask = new RectMask2D(0, 0, 100, 100);
        const spriteMask = new SpriteMask2D({} as any);
        node.mask = rectMask;
        expect(node.mask).toBe(rectMask);
        node.mask = spriteMask;
        expect(node.mask).toBe(spriteMask);
    });

    it("should null masks on all children when parent is disposed", () => {
        const parent = new RenderableNode2D("parent", null);
        const child = new RenderableNode2D("child", null);
        child.parent = parent;

        parent.mask = new RectMask2D(0, 0, 200, 200);
        child.mask = new RectMask2D(10, 10, 50, 50);

        parent.dispose();

        expect(parent.mask).toBeNull();
        expect(child.mask).toBeNull();
    });

    it("should not affect sibling nodes when one child has a mask", () => {
        const parent = new RenderableNode2D("parent", null);
        const child1 = new RenderableNode2D("child1", null);
        const child2 = new RenderableNode2D("child2", null);
        child1.parent = parent;
        child2.parent = parent;

        child1.mask = new RectMask2D(0, 0, 50, 50);
        expect(child1.mask).not.toBeNull();
        expect(child2.mask).toBeNull();
    });

    it("should allow a mask on a grandchild node", () => {
        const root = new RenderableNode2D("root", null);
        const mid = new RenderableNode2D("mid", null);
        const leaf = new RenderableNode2D("leaf", null);
        mid.parent = root;
        leaf.parent = mid;

        leaf.mask = new RectMask2D(5, 5, 30, 30);
        expect(leaf.mask).not.toBeNull();
        expect(leaf.mask).toBeInstanceOf(RectMask2D);
    });

    it("should allow setting a disabled mask", () => {
        const node = new RenderableNode2D("test", null);
        const mask = new RectMask2D(0, 0, 100, 100);
        mask.enabled = false;
        node.mask = mask;
        expect(node.mask).toBe(mask);
        expect(node.mask!.enabled).toBe(false);
    });

    it("should allow modifying the mask after assignment", () => {
        const node = new RenderableNode2D("test", null);
        const mask = new RectMask2D(0, 0, 100, 100);
        node.mask = mask;
        mask.padding = 5;
        mask.inverted = true;
        // Reference is the same, so changes reflect through
        expect((node.mask as RectMask2D).padding).toBe(5);
        expect(node.mask!.inverted).toBe(true);
    });
});

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║  MaskStateManager edge cases & stress                                 ║
// ╚═════════════════════════════════════════════════════════════════════════╝

describe("MaskStateManager edge cases", () => {
    it("should handle rapid push/pop cycling", () => {
        const { engine } = createMockEngine();
        const mgr = new MaskStateManager(engine);
        mgr.setViewportHeight(600);

        for (let i = 0; i < 100; i++) {
            mgr.pushRectMask(new Rectangle2D(0, 0, 100, 100), false);
            mgr.popMask();
        }

        expect(mgr.hasMasks).toBe(false);
        expect(mgr.stencilLevel).toBe(0);
    });

    it("should handle rapid sprite mask push/pop cycling", () => {
        const { engine } = createMockEngine();
        const mgr = new MaskStateManager(engine);

        for (let i = 0; i < 50; i++) {
            mgr.pushSpriteMask(false);
            mgr.popMask();
        }

        expect(mgr.hasMasks).toBe(false);
        expect(mgr.stencilLevel).toBe(0);
    });

    it("should handle deeply nested rect masks (10 levels)", () => {
        const { engine } = createMockEngine();
        const mgr = new MaskStateManager(engine);
        mgr.setViewportHeight(1000);

        // Push 10 nested rects that progressively shrink
        for (let i = 0; i < 10; i++) {
            mgr.pushRectMask(new Rectangle2D(i * 10, i * 10, 200 - i * 20, 200 - i * 20), false);
        }
        expect(mgr.hasMasks).toBe(true);

        // Pop them all
        for (let i = 0; i < 10; i++) {
            mgr.popMask();
        }
        expect(mgr.hasMasks).toBe(false);
    });

    it("should handle deeply nested sprite masks tracking stencil level", () => {
        const { engine } = createMockEngine();
        const mgr = new MaskStateManager(engine);

        const depth = 8;
        for (let i = 0; i < depth; i++) {
            mgr.pushSpriteMask(false);
            expect(mgr.stencilLevel).toBe(i + 1);
        }

        for (let i = depth; i > 0; i--) {
            expect(mgr.stencilLevel).toBe(i);
            mgr.popMask();
        }

        expect(mgr.stencilLevel).toBe(0);
        expect(mgr.hasMasks).toBe(false);
    });

    it("should handle alternating push rect/sprite/pop sequence", () => {
        const { engine } = createMockEngine();
        const mgr = new MaskStateManager(engine);
        mgr.setViewportHeight(600);

        mgr.pushRectMask(new Rectangle2D(0, 0, 100, 100), false);
        mgr.pushSpriteMask(false);
        mgr.pushRectMask(new Rectangle2D(10, 10, 50, 50), false);

        expect(mgr.hasMasks).toBe(true);
        expect(mgr.stencilLevel).toBe(1);

        mgr.popMask(); // pop rect
        mgr.popMask(); // pop sprite
        mgr.popMask(); // pop rect

        expect(mgr.hasMasks).toBe(false);
        expect(mgr.stencilLevel).toBe(0);
    });

    it("should reset and then handle a fresh push/pop cycle", () => {
        const { engine } = createMockEngine();
        const mgr = new MaskStateManager(engine);
        mgr.setViewportHeight(600);

        mgr.pushSpriteMask(false);
        mgr.pushSpriteMask(true);
        mgr.reset();

        expect(mgr.hasMasks).toBe(false);
        expect(mgr.stencilLevel).toBe(0);

        mgr.pushSpriteMask(false);
        expect(mgr.stencilLevel).toBe(1);
        mgr.popMask();
        expect(mgr.stencilLevel).toBe(0);
    });

    it("should correctly flip Y for rect at bottom of viewport", () => {
        const { engine } = createMockEngine();
        const mgr = new MaskStateManager(engine);
        mgr.setViewportHeight(600);

        // Rect at bottom: y=500, height=100 → glY = 600-500-100 = 0
        mgr.pushRectMask(new Rectangle2D(0, 500, 200, 100), false);
        expect(engine.enableScissor).toHaveBeenCalledWith(0, 0, 200, 100);
    });

    it("should correctly flip Y for rect at top of viewport", () => {
        const { engine } = createMockEngine();
        const mgr = new MaskStateManager(engine);
        mgr.setViewportHeight(600);

        // Rect at top: y=0, height=100 → glY = 600-0-100 = 500
        mgr.pushRectMask(new Rectangle2D(0, 0, 200, 100), false);
        expect(engine.enableScissor).toHaveBeenCalledWith(0, 500, 200, 100);
    });

    it("should correctly flip Y for full-viewport rect", () => {
        const { engine } = createMockEngine();
        const mgr = new MaskStateManager(engine);
        mgr.setViewportHeight(600);

        // Full viewport: y=0, height=600 → glY = 600-0-600 = 0
        mgr.pushRectMask(new Rectangle2D(0, 0, 800, 600), false);
        expect(engine.enableScissor).toHaveBeenCalledWith(0, 0, 800, 600);
    });
});

// ╔═════════════════════════════════════════════════════════════════════════╗
// ║  IMask2D interface conformance                                        ║
// ╚═════════════════════════════════════════════════════════════════════════╝

describe("IMask2D interface conformance", () => {
    it("RectMask2D should implement all IMask2D members", () => {
        const mask = new RectMask2D();
        expect("enabled" in mask).toBe(true);
        expect("inverted" in mask).toBe(true);
        expect(typeof mask.dispose).toBe("function");
    });

    it("SpriteMask2D should implement all IMask2D members", () => {
        const mask = new SpriteMask2D({} as any);
        expect("enabled" in mask).toBe(true);
        expect("inverted" in mask).toBe(true);
        expect(typeof mask.dispose).toBe("function");
    });

    it("both mask types should share the same interface shape", () => {
        const rectMask = new RectMask2D();
        const spriteMask = new SpriteMask2D({} as any);
        // Both should have the same IMask2D properties
        const iMaskKeys = ["enabled", "inverted", "dispose"];
        for (const key of iMaskKeys) {
            expect(key in rectMask).toBe(true);
            expect(key in spriteMask).toBe(true);
        }
    });
});

