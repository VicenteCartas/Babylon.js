/* eslint-disable @typescript-eslint/no-restricted-imports */
import * as Game2D from "../../../../dev/2d/src/index";

/**
 * Legacy support, defining window.BABYLON.Game2D (global variable).
 *
 * This is the entry point for the UMD module.
 * The entry point for a future ESM package should be index.ts
 */
const GlobalObject = typeof global !== "undefined" ? global : typeof window !== "undefined" ? window : undefined;
if (typeof GlobalObject !== "undefined") {
    (<any>GlobalObject).BABYLON = (<any>GlobalObject).BABYLON || {};
    (<any>GlobalObject).BABYLON.Game2D = Game2D;
}

export * from "../../../../dev/2d/src/index";
