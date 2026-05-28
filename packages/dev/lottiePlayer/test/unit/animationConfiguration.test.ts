import { describe, expect, it } from "vitest";

import { ResolveFeatureConfiguration, ResolveRendererConfiguration, UpdateConfiguration } from "../../src/animationConfiguration";

describe("ResolveFeatureConfiguration", () => {
    it("resolves engine-free feature options without GPU caps", () => {
        const configuration = ResolveFeatureConfiguration({
            loopAnimation: true,
            easingSteps: 8,
            stopAtFrame: 12,
            debug: true,
            compatibility: { textLayerPlacement: "babylon8" },
            spriteAtlasWidth: 256,
            devicePixelRatio: 3,
        });

        expect(configuration).toEqual({
            loopAnimation: true,
            easingSteps: 8,
            supportDeviceLost: true,
            stopAtFrame: 12,
            debug: true,
            compatibility: {
                textLayerPlacement: "babylon8",
                solidLayerRendering: "spec",
            },
        });
    });
});

describe("ResolveRendererConfiguration", () => {
    it("resolves renderer-bound atlas and device pixel ratio options from GPU caps", () => {
        const configuration = ResolveRendererConfiguration({}, 4096, 1);

        expect(configuration.spriteAtlasWidth).toBe(4096);
        expect(configuration.spriteAtlasHeight).toBe(4096);
        expect(configuration.devicePixelRatio).toBe(2);
    });

    it("preserves explicit renderer options", () => {
        const configuration = ResolveRendererConfiguration({ spriteAtlasWidth: 512, spriteAtlasHeight: 256, devicePixelRatio: 3 }, 4096, 1);

        expect(configuration.spriteAtlasWidth).toBe(512);
        expect(configuration.spriteAtlasHeight).toBe(256);
        expect(configuration.devicePixelRatio).toBe(3);
    });
});

describe("UpdateConfiguration compatibility", () => {
    it("uses spec compatibility by default", () => {
        const configuration = UpdateConfiguration({}, 4096, 1);

        expect(configuration.compatibility).toEqual({
            textLayerPlacement: "spec",
            solidLayerRendering: "spec",
        });
    });

    it("allows text layer compatibility to be configured independently", () => {
        const configuration = UpdateConfiguration({ compatibility: { textLayerPlacement: "babylon8" } }, 4096, 1);

        expect(configuration.compatibility).toEqual({
            textLayerPlacement: "babylon8",
            solidLayerRendering: "spec",
        });
    });

    it("allows solid layer compatibility to be configured independently", () => {
        const configuration = UpdateConfiguration({ compatibility: { solidLayerRendering: "babylon8" } }, 4096, 1);

        expect(configuration.compatibility).toEqual({
            textLayerPlacement: "spec",
            solidLayerRendering: "babylon8",
        });
    });

    it("uses defaults when compatibility options are explicitly undefined", () => {
        const configuration = UpdateConfiguration({ compatibility: { textLayerPlacement: undefined, solidLayerRendering: undefined } }, 4096, 1);

        expect(configuration.compatibility).toEqual({
            textLayerPlacement: "spec",
            solidLayerRendering: "spec",
        });
    });
});
