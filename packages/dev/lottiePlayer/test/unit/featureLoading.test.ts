import { readdirSync, readFileSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

import { ResolveFeatureConfiguration, ResolveRendererConfiguration } from "../../src/animationConfiguration";
import { type LottieFeatureSet } from "../../src/features/feature";
import { DetectLottieFeatures } from "../../src/load/detectFeatures";
import { LoadLottieFeatures } from "../../src/load/loadFeatures";
import { ParseAnimationAsync } from "../../src/load/parseAnimation";
import { type RawLayerType, type RawLottieAnimation, type RawLottieLayer } from "../../src/parsing/rawTypes";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(currentDirectory, "../..");
const loadSourceRoot = path.resolve(packageRoot, "src/load");
const sourceRoot = path.resolve(packageRoot, "src");

function makeLayer(layerType: RawLayerType, hidden = false): RawLottieLayer {
    return {
        ty: layerType,
        hd: hidden,
        ks: {},
    } as RawLottieLayer;
}

function makeAnimation(layers: RawLottieLayer[]): RawLottieAnimation {
    return {
        v: "5.9.0",
        fr: 30,
        ip: 0,
        op: 1,
        w: 64,
        h: 64,
        layers,
    };
}

function collectTypeScriptFiles(directory: string, files: string[] = []): string[] {
    const entries = readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
        const childPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            collectTypeScriptFiles(childPath, files);
        } else if (entry.isFile() && entry.name.endsWith(".ts")) {
            files.push(childPath);
        }
    }
    return files;
}

describe("detectLottieFeatures", () => {
    it("detects visible layer features in stable feature order", () => {
        const animation = makeAnimation([makeLayer(5), makeLayer(4), makeLayer(1)]);
        const featureConfig = ResolveFeatureConfiguration({});

        expect(DetectLottieFeatures(animation, featureConfig)).toEqual(["solid", "shape", "text"]);
    });

    it("ignores hidden layers", () => {
        const animation = makeAnimation([makeLayer(5, true), makeLayer(4, true), makeLayer(1, true)]);
        const featureConfig = ResolveFeatureConfiguration({});

        expect(DetectLottieFeatures(animation, featureConfig)).toEqual([]);
    });

    it("does not request the solid feature in Babylon 8 compatibility mode", () => {
        const animation = makeAnimation([makeLayer(1)]);
        const featureConfig = ResolveFeatureConfiguration({ compatibility: { solidLayerRendering: "babylon8" } });

        expect(DetectLottieFeatures(animation, featureConfig)).toEqual([]);
    });
});

describe("loadLottieFeatures", () => {
    it("loads exactly the detected feature modules", async () => {
        const animation = makeAnimation([makeLayer(4), makeLayer(5), makeLayer(1)]);
        const featureConfig = ResolveFeatureConfiguration({});
        const loadedFeatures = await LoadLottieFeatures(animation, featureConfig);

        expect(loadedFeatures.ids).toEqual(["solid", "shape", "text"]);
        expect(loadedFeatures.features.map((feature) => feature.id)).toEqual(["solid", "shape", "text"]);
        expect(loadedFeatures.features.map((feature) => feature.layerTypes)).toEqual([[1], [4], [5]]);
        expect(loadedFeatures.features.find((feature) => feature.id === "solid")?.solidLayer?.parseSolidLayer).toEqual(expect.any(Function));
        expect(loadedFeatures.features.find((feature) => feature.id === "text")?.textLayer?.parseTextLayer).toEqual(expect.any(Function));
    });

    it("does not load the solid feature in Babylon 8 compatibility mode", async () => {
        const animation = makeAnimation([makeLayer(1)]);
        const featureConfig = ResolveFeatureConfiguration({ compatibility: { solidLayerRendering: "babylon8" } });
        const loadedFeatures = await LoadLottieFeatures(animation, featureConfig);

        expect(loadedFeatures.ids).toEqual([]);
        expect(loadedFeatures.features).toEqual([]);
    });

    it("keeps detection and loader modules transport-agnostic", () => {
        const violations: string[] = [];
        const restrictedImportPattern = /(?:import\s+(?:[^"']*?\s+from\s*)?|import\s*\(\s*)["']([^"']*transport[^"']*)["']/g;

        for (const sourceFile of collectTypeScriptFiles(loadSourceRoot)) {
            const sourceText = readFileSync(sourceFile, "utf8");
            restrictedImportPattern.lastIndex = 0;

            let match: RegExpExecArray | null;
            while ((match = restrictedImportPattern.exec(sourceText)) !== null) {
                violations.push(`${path.relative(loadSourceRoot, sourceFile).replace(/\\/g, "/")} imports ${match[1]}`);
            }
        }

        expect(violations).toEqual([]);
    });
});

describe("text feature extraction boundaries", () => {
    it("keeps generic bounding box and sprite packing modules free of text implementation imports", () => {
        const genericModulePaths = ["maths/boundingBox.ts", "parsing/spritePacker.ts"];
        const forbiddenTextReferences = [/textLayout/, /GetTextBoundingBox/, /RawTextData/, /RawFont/];
        const violations: string[] = [];

        for (const relativePath of genericModulePaths) {
            const sourceText = readFileSync(path.join(sourceRoot, relativePath), "utf8");
            for (const pattern of forbiddenTextReferences) {
                if (pattern.test(sourceText)) {
                    violations.push(`${relativePath} contains ${pattern.source}`);
                }
            }
        }

        expect(violations).toEqual([]);
    });
});

describe("solid feature extraction boundaries", () => {
    it("keeps the layer dispatcher free of solid color parsing and atlas-cell generation", () => {
        const sourceText = readFileSync(path.join(sourceRoot, "parsing/buildAnimation.ts"), "utf8");
        const forbiddenSolidReferences = [/ParseCssColorString/, /Solid Rect \(atlas\)/, /Unsupported CSS color string/];
        const violations = forbiddenSolidReferences.filter((pattern) => pattern.test(sourceText)).map((pattern) => pattern.source);

        expect(violations).toEqual([]);
    });
});

describe("gradient draw sub-feature", () => {
    function makeShapeLayerWith(shapeTypes: string[]): RawLottieAnimation {
        const shapes = shapeTypes.map((ty) => ({ ty }));
        return makeAnimation([{ ty: 4, shapes } as unknown as RawLottieLayer]);
    }

    it("detects the gradient sub-feature only when a gradient item is present", () => {
        const featureConfig = ResolveFeatureConfiguration({});

        expect(DetectLottieFeatures(makeShapeLayerWith(["rc", "fl"]), featureConfig)).toEqual(["shape"]);
        expect(DetectLottieFeatures(makeShapeLayerWith(["rc", "gf"]), featureConfig)).toEqual(["shape", "shape-gradient"]);
        expect(DetectLottieFeatures(makeShapeLayerWith(["sh", "gs"]), featureConfig)).toEqual(["shape", "shape-gradient"]);
    });

    it("loads the gradient drawer module only when detected", async () => {
        const featureConfig = ResolveFeatureConfiguration({});

        const withoutGradient = await LoadLottieFeatures(makeShapeLayerWith(["rc", "fl"]), featureConfig);
        expect(withoutGradient.ids).toEqual(["shape"]);
        expect(withoutGradient.features.some((feature) => feature.shapeDrawer !== undefined)).toBe(false);

        const withGradient = await LoadLottieFeatures(makeShapeLayerWith(["rc", "gf"]), featureConfig);
        expect(withGradient.ids).toEqual(["shape", "shape-gradient"]);
        const gradientFeature = withGradient.features.find((feature) => feature.id === "shape-gradient");
        expect(gradientFeature?.shapeDrawer?.types).toEqual(["gf", "gs"]);
        expect(gradientFeature?.shapeDrawer?.draw).toEqual(expect.any(Function));
    });

    it("keeps the base shape rasterizer free of gradient drawing code", () => {
        const sourceText = readFileSync(path.join(sourceRoot, "features/shapes/drawShape.ts"), "utf8");
        const forbiddenGradientReferences = [/DrawGradientFill/, /DrawGradientStroke/, /createLinearGradient/, /createRadialGradient/, /addColorStop/];
        const violations = forbiddenGradientReferences.filter((pattern) => pattern.test(sourceText)).map((pattern) => pattern.source);

        expect(violations).toEqual([]);
    });
});

describe("parseAnimationAsync", () => {
    it("validates loaded feature metadata before delegating to the current parser", async () => {
        const mismatchedFeatureSet: LottieFeatureSet = {
            ids: ["text"],
            features: [{ id: "shape", layerTypes: [4] }],
        };

        await expect(
            ParseAnimationAsync(makeAnimation([]), mismatchedFeatureSet, ResolveFeatureConfiguration({}), ResolveRendererConfiguration({}, 1024, 1), {
                packer: null as any,
                renderingManager: null as any,
            })
        ).rejects.toThrow("Loaded Lottie feature shape did not match detected feature text");
    });
});
