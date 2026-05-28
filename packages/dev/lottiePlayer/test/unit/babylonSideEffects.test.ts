import { readdirSync, readFileSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(currentDirectory, "../..");
const sourceRoot = path.resolve(packageRoot, "src");
const allowedSideEffectModule = "rendering/babylonSideEffects.ts";
const restrictedImportPattern = /(?:import\s+(?:[^"']*?\s+from\s*)?|import\s*\(\s*)["'](core\/(?:Engines\/Extensions\/[^"']+|Shaders\/sprites\.[^"']+))["']/g;

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

function toSourceRelativePath(filePath: string): string {
    return path.relative(sourceRoot, filePath).replace(/\\/g, "/");
}

describe("Lottie Babylon rendering side effects", () => {
    it("keeps Babylon engine extension and sprite shader imports in the rendering shim", () => {
        const violations: string[] = [];

        for (const sourceFile of collectTypeScriptFiles(sourceRoot)) {
            const relativePath = toSourceRelativePath(sourceFile);
            if (relativePath === allowedSideEffectModule) {
                continue;
            }

            const sourceText = readFileSync(sourceFile, "utf8");
            restrictedImportPattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = restrictedImportPattern.exec(sourceText)) !== null) {
                violations.push(`${relativePath} imports ${match[1]}`);
            }
        }

        expect(violations).toEqual([]);
    });

    it("keeps package sideEffects allow-lists limited to the rendering shim", () => {
        const devPackageJson = JSON.parse(readFileSync(path.resolve(packageRoot, "package.json"), "utf8")) as { sideEffects?: unknown };
        const publicPackageJson = JSON.parse(readFileSync(path.resolve(packageRoot, "../../public/@babylonjs/lottiePlayer/package.json"), "utf8")) as { sideEffects?: unknown };

        expect(devPackageJson.sideEffects).toEqual(["./src/rendering/babylonSideEffects.ts"]);
        expect(publicPackageJson.sideEffects).toEqual(["./rendering/babylonSideEffects.js"]);
    });
});
