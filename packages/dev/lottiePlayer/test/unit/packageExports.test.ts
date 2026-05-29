import { existsSync, readFileSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(currentDirectory, "../..");
const sourceRoot = path.resolve(packageRoot, "src");
const publicPackageRoot = path.resolve(packageRoot, "../../public/@babylonjs/lottiePlayer");

type PackageJsonWithExports = {
    exports?: Record<string, unknown>;
};

describe("Lottie package exports", () => {
    it("exposes root, local, and worker sub-entries without removing deep import compatibility", () => {
        const devPackageJson = JSON.parse(readFileSync(path.resolve(packageRoot, "package.json"), "utf8")) as PackageJsonWithExports;
        const publicPackageJson = JSON.parse(readFileSync(path.resolve(publicPackageRoot, "package.json"), "utf8")) as PackageJsonWithExports;

        expect(devPackageJson.exports?.["."]).toEqual({ types: "./dist/index.d.ts", default: "./dist/index.js" });
        expect(devPackageJson.exports?.["./local"]).toEqual({ types: "./dist/local.d.ts", default: "./dist/local.js" });
        expect(devPackageJson.exports?.["./worker"]).toEqual({ types: "./dist/worker.d.ts", default: "./dist/worker.js" });
        expect(devPackageJson.exports?.["./*"]).toEqual({ types: "./dist/*.d.ts", default: "./dist/*.js" });

        expect(publicPackageJson.exports?.["."]).toEqual({ types: "./index.d.ts", default: "./index.js" });
        expect(publicPackageJson.exports?.["./local"]).toEqual({ types: "./local.d.ts", default: "./local.js" });
        expect(publicPackageJson.exports?.["./worker"]).toEqual({ types: "./worker.d.ts", default: "./worker.js" });
        expect(publicPackageJson.exports?.["./*"]).toEqual({ types: "./*.d.ts", default: "./*.js" });
    });

    it("keeps the public worker sub-entry separate from the internal worker script", () => {
        const workerSubEntry = readFileSync(path.resolve(sourceRoot, "worker.ts"), "utf8");
        const localSubEntry = readFileSync(path.resolve(sourceRoot, "local.ts"), "utf8");
        const playerRuntimeSource = readFileSync(path.resolve(sourceRoot, "playerRuntime.ts"), "utf8");

        expect(existsSync(path.resolve(sourceRoot, "workerEntry.ts"))).toBe(true);
        expect(workerSubEntry).toContain('export { Player } from "./player";');
        expect(workerSubEntry).not.toContain("onmessage");
        expect(localSubEntry).toContain('export { LocalPlayer } from "./localPlayer";');
        expect(localSubEntry).not.toContain("workerEntry");
        expect(playerRuntimeSource).toContain('new URL("./workerEntry", import.meta.url)');
    });
});
