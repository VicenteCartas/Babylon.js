import { build, type BuildResult, type OutputFile } from "esbuild";
import * as path from "path";
import { fileURLToPath } from "url";
import { beforeAll, describe, expect, it } from "vitest";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(currentDirectory, "../..");
const sourceRoot = path.resolve(packageRoot, "src");

// Markers that only appear in the gradient drawing implementation. If any of these land in a chunk,
// that chunk carries gradient code and would be downloaded/parsed when fetched.
const gradientMarkerPattern = /createLinearGradient|createRadialGradient|addColorStop/;

// A gradient-free animation must never download gradient code, but the gradient chunk must still be a
// real, substantial module (not an empty husk) so this floor proves the code actually moved out of the
// base shape chunk. The chunk measures a few KB in practice; the floor is a conservative lower bound.
const gradientChunkMinBytes = 1000;

function getChunkName(outputFile: OutputFile): string {
    return path.basename(outputFile.path);
}

function hasGradientCode(outputFile: OutputFile): boolean {
    return gradientMarkerPattern.test(outputFile.text);
}

describe("feature bundle splitting", () => {
    let outputFiles: OutputFile[];

    // Bundle the feature registry exactly as it is consumed at runtime: each descriptor's
    // `loadAsync: () => import(...)` becomes a code-split chunk. Only Lottie source is bundled; bare
    // specifiers (e.g. `core/...`) are externalized so chunk sizes reflect feature code alone.
    beforeAll(async () => {
        const result: BuildResult = await build({
            entryPoints: [path.join(sourceRoot, "load/featureRegistry.ts")],
            bundle: true,
            splitting: true,
            format: "esm",
            write: false,
            outdir: "out",
            logLevel: "silent",
            entryNames: "[name]",
            chunkNames: "[name]-[hash]",
            plugins: [
                {
                    name: "external-bare-specifiers",
                    setup(builder) {
                        builder.onResolve({ filter: /^[^./]/ }, (args) => (args.kind === "entry-point" ? undefined : { path: args.path, external: true }));
                    },
                },
            ],
        });

        outputFiles = result.outputFiles ?? [];
    });

    it("emits a distinct gradient chunk separate from the base shape chunk", () => {
        const shapeChunk = outputFiles.find((file) => getChunkName(file).startsWith("shape-"));
        const gradientChunk = outputFiles.find((file) => getChunkName(file).startsWith("gradient-"));

        expect(shapeChunk, "expected a code-split base shape chunk").toBeDefined();
        expect(gradientChunk, "expected a code-split gradient chunk").toBeDefined();
        expect(getChunkName(shapeChunk!)).not.toEqual(getChunkName(gradientChunk!));
    });

    it("(positive tooth) ships gradient code in a non-trivial dedicated chunk", () => {
        const gradientChunks = outputFiles.filter(hasGradientCode);

        // Gradient drawing code must live in exactly one chunk: the dedicated gradient chunk.
        expect(gradientChunks.map(getChunkName)).toEqual([expect.stringMatching(/^gradient-/)]);
        expect(gradientChunks[0].contents.length).toBeGreaterThan(gradientChunkMinBytes);
    });

    it("(negative tooth) keeps gradient code out of every chunk a gradient-free animation downloads", () => {
        // A gradient-free animation loads the entry registry plus the shape feature and any shared
        // chunks, but never the gradient chunk. None of those may contain a single gradient byte.
        const gradientFreeDownloadSet = outputFiles.filter((file) => !getChunkName(file).startsWith("gradient-"));
        const leaks = gradientFreeDownloadSet.filter(hasGradientCode).map(getChunkName);

        expect(leaks).toEqual([]);
    });
});
