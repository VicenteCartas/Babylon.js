import { type ThinEngine } from "core/Engines/thinEngine";

/** Stencil methods implemented directly by ThinNativeEngine without prototype registration. */
export interface INativeStencilEngine {
    setStencilBuffer(enable: boolean): void;
    setStencilMask(mask: number): void;
    setStencilFunction(func: number): void;
    setStencilFunctionReference(reference: number): void;
    setStencilOperationFail(operation: number): void;
    setStencilOperationDepthFail(operation: number): void;
    setStencilOperationPass(operation: number): void;
}

interface IScissorEngine {
    enableScissor(x: number, y: number, width: number, height: number): void;
    disableScissor(): void;
}

interface IWebGLThinEngine {
    _gl?: WebGLRenderingContext | WebGL2RenderingContext;
}

/**
 * Identifies Babylon Native across core versions where engine.name was still reported as WebGL.
 * @param engine The engine to inspect.
 * @returns True for ThinNativeEngine and NativeEngine.
 */
export function IsNativeEngine(engine: ThinEngine): boolean {
    return engine.shaderPlatformName === "NATIVE";
}

/**
 * Gets the immediate Native stencil API.
 * @param engine A Babylon Native engine.
 * @returns The Native stencil interface.
 */
export function GetNativeStencilEngine(engine: ThinEngine): INativeStencilEngine {
    return engine as unknown as INativeStencilEngine;
}

/**
 * Enables the engine's scissor test without relying on version-specific prototype extensions.
 * @param engine The engine to configure.
 * @param x The lower-left x coordinate in drawing-buffer pixels.
 * @param y The lower-left y coordinate in drawing-buffer pixels.
 * @param width The scissor width in drawing-buffer pixels.
 * @param height The scissor height in drawing-buffer pixels.
 */
export function EnableEngineScissor(engine: ThinEngine, x: number, y: number, width: number, height: number): void {
    if (IsNativeEngine(engine)) {
        (engine as unknown as IScissorEngine).enableScissor(x, y, width, height);
        return;
    }
    const gl = (engine as unknown as IWebGLThinEngine)._gl;
    if (!gl) {
        (engine as unknown as IScissorEngine).enableScissor(x, y, width, height);
        return;
    }
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, width, height);
}

/**
 * Disables the engine's scissor test without relying on version-specific prototype extensions.
 * @param engine The engine to configure.
 */
export function DisableEngineScissor(engine: ThinEngine): void {
    if (IsNativeEngine(engine)) {
        (engine as unknown as IScissorEngine).disableScissor();
        return;
    }
    const gl = (engine as unknown as IWebGLThinEngine)._gl;
    if (!gl) {
        (engine as unknown as IScissorEngine).disableScissor();
        return;
    }
    gl.disable(gl.SCISSOR_TEST);
}
