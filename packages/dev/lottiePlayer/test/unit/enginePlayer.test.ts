import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { NullEngine } from "core/Engines/nullEngine";
import { EnginePlayer } from "../../src/enginePlayer";
import { ParseAnimation } from "../../src/animation/parse";
import { ValidateEngineFeatures } from "../../src/player/playerFactory";
import { type ILottieFile } from "../../src/animation/lottieRaw";
import { type ThinEngine } from "core/Engines/thinEngine";
import { type ThinNativeEngine } from "core/Engines/thinNativeEngine";
import { type NativeEngine } from "core/Engines/nativeEngine";
import { type LottieEngine } from "../../src/types";
import { AnimationController } from "../../src/rendering/animationController";

function EmptyAnimation(): ILottieFile {
    return { v: "5.7.0", w: 100, h: 100, ip: 0, op: 60, fr: 30, layers: [] };
}

describe("EnginePlayer", () => {
    it("accepts Babylon Native engine types through ThinEngine inheritance", () => {
        expectTypeOf<ThinNativeEngine>().toMatchTypeOf<LottieEngine>();
        expectTypeOf<NativeEngine>().toMatchTypeOf<LottieEngine>();
        expect(true).toBe(true);
    });

    it("uses but does not dispose the caller-owned engine", async () => {
        const engine = new NullEngine({ renderWidth: 100, renderHeight: 100 });
        const disposeEngine = vi.spyOn(engine, "dispose");
        const player = new EnginePlayer(engine);

        expect(
            await player.playAnimationAsync({
                animationSource: EmptyAnimation(),
                variables: null,
                configuration: { stopAtFrame: 0 },
            })
        ).toBe(true);
        expect(engine.activeRenderLoops).toHaveLength(1);

        player.dispose();
        expect(engine.activeRenderLoops).toHaveLength(0);
        expect(disposeEngine).not.toHaveBeenCalled();
        engine.dispose();
    });

    it("cannot start twice or restart after disposal", async () => {
        const engine = new NullEngine({ renderWidth: 100, renderHeight: 100 });
        const player = new EnginePlayer(engine);
        const input = { animationSource: EmptyAnimation(), variables: null, configuration: null };

        expect(await player.playAnimationAsync(input)).toBe(true);
        expect(await player.playAnimationAsync(input)).toBe(false);
        player.dispose();
        expect(await player.playAnimationAsync(input)).toBe(false);
        engine.dispose();
    });

    it("rejects a concurrent start while initialization is pending", async () => {
        const engine = new NullEngine({ renderWidth: 100, renderHeight: 100 });
        const player = new EnginePlayer(engine);
        const controller = { playAnimation: vi.fn(), dispose: vi.fn() } as unknown as AnimationController;
        let resolveController!: (value: AnimationController) => void;
        const pendingController = new Promise<AnimationController>((resolve) => (resolveController = resolve));
        const createController = vi.spyOn(AnimationController, "CreateWithEngineAsync").mockReturnValue(pendingController);
        const input = { animationSource: EmptyAnimation(), variables: null, configuration: null };
        try {
            const firstStart = player.playAnimationAsync(input);
            expect(await player.playAnimationAsync(input)).toBe(false);
            resolveController(controller);
            expect(await firstStart).toBe(true);
            expect(controller.playAnimation).toHaveBeenCalledOnce();
        } finally {
            player.dispose();
            createController.mockRestore();
            engine.dispose();
        }
    });

    it("disposes a controller that finishes initializing after the player is disposed", async () => {
        const engine = new NullEngine({ renderWidth: 100, renderHeight: 100 });
        const player = new EnginePlayer(engine);
        const controller = { playAnimation: vi.fn(), dispose: vi.fn() } as unknown as AnimationController;
        let resolveController!: (value: AnimationController) => void;
        const pendingController = new Promise<AnimationController>((resolve) => (resolveController = resolve));
        const createController = vi.spyOn(AnimationController, "CreateWithEngineAsync").mockReturnValue(pendingController);
        try {
            const starting = player.playAnimationAsync({ animationSource: EmptyAnimation(), variables: null, configuration: null });
            player.dispose();
            resolveController(controller);
            expect(await starting).toBe(false);
            expect(controller.playAnimation).not.toHaveBeenCalled();
            expect(controller.dispose).toHaveBeenCalledOnce();
        } finally {
            createController.mockRestore();
            engine.dispose();
        }
    });

    it("does not initialize after disposal during URL loading", async () => {
        const engine = new NullEngine({ renderWidth: 100, renderHeight: 100 });
        const player = new EnginePlayer(engine);
        let resolveFetch!: (value: Response) => void;
        const pendingFetch = new Promise<Response>((resolve) => (resolveFetch = resolve));
        const fetchAnimation = vi.spyOn(globalThis, "fetch").mockReturnValue(pendingFetch);
        const createController = vi.spyOn(AnimationController, "CreateWithEngineAsync");
        try {
            const starting = player.playAnimationAsync({ animationSource: "animation.json", variables: null, configuration: null });
            player.dispose();
            resolveFetch({ text: async () => JSON.stringify(EmptyAnimation()) } as Response);
            expect(await starting).toBe(false);
            expect(createController).not.toHaveBeenCalled();
        } finally {
            fetchAnimation.mockRestore();
            createController.mockRestore();
            engine.dispose();
        }
    });

    it("disposes a controller when render-loop startup fails and permits a retry", async () => {
        const engine = new NullEngine({ renderWidth: 100, renderHeight: 100 });
        const player = new EnginePlayer(engine);
        const failingController = {
            playAnimation: vi.fn(() => {
                throw new Error("startup failed");
            }),
            dispose: vi.fn(),
        } as unknown as AnimationController;
        const workingController = { playAnimation: vi.fn(), dispose: vi.fn() } as unknown as AnimationController;
        const createController = vi.spyOn(AnimationController, "CreateWithEngineAsync").mockResolvedValueOnce(failingController).mockResolvedValueOnce(workingController);
        const input = { animationSource: EmptyAnimation(), variables: null, configuration: null };
        try {
            await expect(player.playAnimationAsync(input)).rejects.toThrow("startup failed");
            expect(failingController.dispose).toHaveBeenCalledOnce();
            expect(await player.playAnimationAsync(input)).toBe(true);
            expect(workingController.playAnimation).toHaveBeenCalledOnce();
        } finally {
            player.dispose();
            createController.mockRestore();
            engine.dispose();
        }
    });

    it("unregisters its engine render loop when non-looping playback completes", async () => {
        vi.useFakeTimers();
        const engine = new NullEngine({ renderWidth: 100, renderHeight: 100 });
        engine.enableScissor = vi.fn();
        engine.disableScissor = vi.fn();
        engine.depthCullingState.depthTest = true;
        engine.depthCullingState.depthMask = true;
        const player = new EnginePlayer(engine);
        const animation = { ...EmptyAnimation(), op: 1 };
        try {
            await player.playAnimationAsync({ animationSource: animation, variables: null, configuration: null });
            expect(engine.activeRenderLoops).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(100);
            expect(engine.activeRenderLoops).toHaveLength(0);
            expect(engine.depthCullingState.depthTest).toBe(false);
            expect(engine.depthCullingState.depthMask).toBe(false);
        } finally {
            player.dispose();
            engine.dispose();
            vi.useRealTimers();
        }
    });
});

describe("ValidateEngineFeatures", () => {
    const nativeEngine = { name: "WebGL", shaderPlatformName: "NATIVE" } as ThinEngine;
    const webEngine = { name: "WebGL", shaderPlatformName: "WEBGL2", isStencilEnable: true } as ThinEngine;

    it("accepts ordinary shape layers on Native", () => {
        const animation = ParseAnimation({
            ...EmptyAnimation(),
            layers: [{ ind: 1, ty: 1, ks: {}, sc: "#ff0000", sw: 10, sh: 10, ip: 0, op: 60, st: 0 }],
        });
        expect(() => ValidateEngineFeatures(nativeEngine, animation)).not.toThrow();
    });

    it("rejects a browser engine without a stencil buffer", () => {
        const animation = ParseAnimation(EmptyAnimation());
        const engineWithoutStencil = { name: "WebGL", shaderPlatformName: "WEBGL2", isStencilEnable: false } as ThinEngine;
        expect(() => ValidateEngineFeatures(engineWithoutStencil, animation)).toThrow(/stencil enabled/);
    });

    it("rejects masks and mattes on Native", () => {
        const masked = ParseAnimation({
            ...EmptyAnimation(),
            layers: [
                {
                    ind: 1,
                    ty: 1,
                    ks: {},
                    sc: "#ff0000",
                    sw: 10,
                    sh: 10,
                    ip: 0,
                    op: 60,
                    st: 0,
                    masksProperties: [{ mode: "a", pt: { a: 0, k: { v: [], i: [], o: [], c: false } } }],
                },
            ],
        });
        expect(() => ValidateEngineFeatures(nativeEngine, masked)).toThrow(/masks and track mattes/);

        const matted = ParseAnimation({
            ...EmptyAnimation(),
            layers: [
                { ind: 2, ty: 1, ks: {}, sc: "#ffffff", sw: 10, sh: 10, ip: 0, op: 60, st: 0, td: 1 },
                { ind: 1, ty: 1, ks: {}, sc: "#ff0000", sw: 10, sh: 10, ip: 0, op: 60, st: 0, tt: 1 },
            ],
        });
        expect(() => ValidateEngineFeatures(nativeEngine, matted)).toThrow(/masks and track mattes/);
    });

    it("keeps masks and mattes available on WebGL", () => {
        const animation = ParseAnimation({
            ...EmptyAnimation(),
            layers: [
                { ind: 2, ty: 1, ks: {}, sc: "#ffffff", sw: 10, sh: 10, ip: 0, op: 60, st: 0, td: 1 },
                { ind: 1, ty: 1, ks: {}, sc: "#ff0000", sw: 10, sh: 10, ip: 0, op: 60, st: 0, tt: 1 },
            ],
        });
        expect(() => ValidateEngineFeatures(webEngine, animation)).not.toThrow();
    });
});
