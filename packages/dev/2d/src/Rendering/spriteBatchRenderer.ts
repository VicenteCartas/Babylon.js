import type { AbstractEngine } from "core/Engines/abstractEngine";
import type { ThinTexture } from "core/Materials/Textures/thinTexture";
import type { DataBuffer } from "core/Buffers/dataBuffer";
import { Buffer, VertexBuffer } from "core/Buffers/buffer";
import { DrawWrapper } from "core/Materials/drawWrapper";
import { Effect } from "core/Materials/effect";
import { ShaderStore } from "core/Engines/shaderStore";
import { ShaderLanguage } from "core/Materials/shaderLanguage";
import { Constants } from "core/Engines/constants";

import { Matrix2D } from "../Math/matrix2D";
import type { LightingManager2D } from "../Lighting/light2D";


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const _MAX_TEXTURES = 8;

const _SAMPLER_NAMES: string[] = [];
for (let i = 0; i < _MAX_TEXTURES; i++) {
    _SAMPLER_NAMES.push(`texture${i}`);
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

// Binary-search texture lookup (max 3 branches instead of 7)
const _TEXTURE_SAMPLE_FN = `
vec4 sampleTex() {
    int idx = int(vTextureIndex + 0.5);
    if (idx < 4) {
        if (idx < 2) {
            if (idx == 0) return texture2D(texture0, vUV);
            return texture2D(texture1, vUV);
        }
        if (idx == 2) return texture2D(texture2, vUV);
        return texture2D(texture3, vUV);
    }
    if (idx < 6) {
        if (idx == 4) return texture2D(texture4, vUV);
        return texture2D(texture5, vUV);
    }
    if (idx == 6) return texture2D(texture6, vUV);
    return texture2D(texture7, vUV);
}`;

const _FRAG_SHADER = `
#ifdef PIXEL_PERFECT
#extension GL_OES_standard_derivatives : enable
#endif
precision highp float;

varying vec2 vUV;
varying vec4 vColor;
varying float vTextureIndex;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;
uniform sampler2D texture3;
uniform sampler2D texture4;
uniform sampler2D texture5;
uniform sampler2D texture6;
uniform sampler2D texture7;

${_TEXTURE_SAMPLE_FN}

void main(void) {
    vec4 texColor = sampleTex();
    vec4 finalColor = texColor * vColor;

#ifdef PIXEL_PERFECT
    float alpha = finalColor.a;
    alpha = clamp((alpha - 0.5) / max(fwidth(alpha), 0.001) + 0.5, 0.0, 1.0);
    finalColor.a = alpha;
#endif

    if (finalColor.a < 0.01) {
        discard;
    }

    gl_FragColor = finalColor;
}
`;

// Non-instanced: 4 vertices per quad with per-vertex transform
const _VERT_SHADER = `
precision highp float;

attribute vec2 position;
attribute vec2 uv;
attribute vec4 color;
attribute vec4 cellInfo;
attribute vec4 transform0;
attribute vec2 transform1;

uniform mat4 projection;

varying vec2 vUV;
varying vec4 vColor;
varying float vTextureIndex;

void main(void) {
    vec2 transformed = vec2(
        transform0.x * position.x + transform0.z * position.y + transform1.x,
        transform0.y * position.x + transform0.w * position.y + transform1.y
    );
    gl_Position = projection * vec4(transformed, 0.0, 1.0);
    vUV = uv;
    vColor = color;
    vTextureIndex = cellInfo.x;
}
`;

// Instanced: 4 shared corner vertices + per-instance sprite data
const _VERT_INSTANCED_SHADER = `
precision highp float;

attribute vec2 corner;

attribute vec4 iTransform0;
attribute vec2 iTransform1;
attribute vec2 iSize;
attribute vec4 iColor;
attribute vec4 iCell;
attribute float iTexIdx;

uniform mat4 projection;

varying vec2 vUV;
varying vec4 vColor;
varying float vTextureIndex;

void main(void) {
    vec2 pos = (corner - 0.5) * iSize;
    vec2 transformed = vec2(
        iTransform0.x * pos.x + iTransform0.z * pos.y + iTransform1.x,
        iTransform0.y * pos.x + iTransform0.w * pos.y + iTransform1.y
    );
    gl_Position = projection * vec4(transformed, 0.0, 1.0);
    vUV = mix(iCell.xy, iCell.zw, corner);
    vColor = iColor;
    vTextureIndex = iTexIdx;
}
`;

// Register shaders with the Effect store
Effect.ShadersStore["sprite2DVertexShader"] = _VERT_SHADER;
Effect.ShadersStore["sprite2DFragmentShader"] = _FRAG_SHADER;
Effect.ShadersStore["sprite2DInstancedVertexShader"] = _VERT_INSTANCED_SHADER;
Effect.ShadersStore["sprite2DInstancedFragmentShader"] = _FRAG_SHADER;

// ---------------------------------------------------------------------------
// Forward-lit shader variants
// ---------------------------------------------------------------------------

const _LIGHTING_FRAG_FN = `
// Light data: 4 vec4s per light
// [i*4+0]: (posX, posY, radius, type)  type: 0=point, 1=spot, 2=ambient
// [i*4+1]: (colorR, colorG, colorB, intensity)
// [i*4+2]: (dirX, dirY, innerAngle, outerAngle)
// [i*4+3]: (falloff, 0, 0, 0)
uniform int lightCount;
uniform vec4 ambientLight;
uniform vec4 lightData[${16 * 4}];

vec3 computeLighting(vec2 worldPos) {
    vec3 lit = ambientLight.rgb;
    for (int i = 0; i < ${16}; i++) {
        if (i >= lightCount) break;
        int base = i * 4;
        vec4 d0 = lightData[base];
        vec4 d1 = lightData[base + 1];
        vec4 d2 = lightData[base + 2];
        vec4 d3 = lightData[base + 3];

        float lightType = d0.w;
        vec3 lColor = d1.rgb;
        float lIntensity = d1.w;

        // Ambient light: uniform contribution
        if (lightType > 1.5) {
            lit += lColor * lIntensity;
            continue;
        }

        vec2 lPos = d0.xy;
        float lRadius = d0.z;
        float lFalloff = d3.x;

        vec2 delta = worldPos - lPos;
        float dist = length(delta);
        if (dist >= lRadius) continue;

        float t = dist / lRadius;
        float atten = pow(1.0 - t, lFalloff);

        // Spotlight cone attenuation
        if (lightType > 0.5) {
            vec2 lDir = normalize(d2.xy);
            float innerA = d2.z;
            float outerA = d2.w;
            vec2 toFrag = delta / max(dist, 0.001);
            float cosAngle = dot(lDir, toFrag);
            float angle = acos(clamp(cosAngle, -1.0, 1.0));
            if (angle > outerA) continue;
            if (angle > innerA) {
                atten *= 1.0 - (angle - innerA) / (outerA - innerA);
            }
        }

        lit += lColor * lIntensity * atten;
    }
    return min(lit, vec3(1.0));
}`;

const _LIT_FRAG_SHADER = `
#ifdef PIXEL_PERFECT
#extension GL_OES_standard_derivatives : enable
#endif
precision highp float;

varying vec2 vUV;
varying vec4 vColor;
varying float vTextureIndex;
varying vec2 vWorldPos;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;
uniform sampler2D texture3;
uniform sampler2D texture4;
uniform sampler2D texture5;
uniform sampler2D texture6;
uniform sampler2D texture7;

${_TEXTURE_SAMPLE_FN}
${_LIGHTING_FRAG_FN}

void main(void) {
    vec4 texColor = sampleTex();
    vec4 finalColor = texColor * vColor;

#ifdef PIXEL_PERFECT
    float alpha = finalColor.a;
    alpha = clamp((alpha - 0.5) / max(fwidth(alpha), 0.001) + 0.5, 0.0, 1.0);
    finalColor.a = alpha;
#endif

    if (finalColor.a < 0.01) {
        discard;
    }

    // Apply lighting to the color (preserve alpha)
    vec3 lighting = computeLighting(vWorldPos);
    finalColor.rgb *= lighting;

    gl_FragColor = finalColor;
}
`;

// Non-instanced lit vertex shader: passes world position
const _LIT_VERT_SHADER = `
precision highp float;

attribute vec2 position;
attribute vec2 uv;
attribute vec4 color;
attribute vec4 cellInfo;
attribute vec4 transform0;
attribute vec2 transform1;

uniform mat4 projection;

varying vec2 vUV;
varying vec4 vColor;
varying float vTextureIndex;
varying vec2 vWorldPos;

void main(void) {
    vec2 transformed = vec2(
        transform0.x * position.x + transform0.z * position.y + transform1.x,
        transform0.y * position.x + transform0.w * position.y + transform1.y
    );
    gl_Position = projection * vec4(transformed, 0.0, 1.0);
    vWorldPos = transformed;
    vUV = uv;
    vColor = color;
    vTextureIndex = cellInfo.x;
}
`;

// Instanced lit vertex shader: passes world position
const _LIT_VERT_INSTANCED_SHADER = `
precision highp float;

attribute vec2 corner;

attribute vec4 iTransform0;
attribute vec2 iTransform1;
attribute vec2 iSize;
attribute vec4 iColor;
attribute vec4 iCell;
attribute float iTexIdx;

uniform mat4 projection;

varying vec2 vUV;
varying vec4 vColor;
varying float vTextureIndex;
varying vec2 vWorldPos;

void main(void) {
    vec2 pos = (corner - 0.5) * iSize;
    vec2 transformed = vec2(
        iTransform0.x * pos.x + iTransform0.z * pos.y + iTransform1.x,
        iTransform0.y * pos.x + iTransform0.w * pos.y + iTransform1.y
    );
    gl_Position = projection * vec4(transformed, 0.0, 1.0);
    vWorldPos = transformed;
    vUV = mix(iCell.xy, iCell.zw, corner);
    vColor = iColor;
    vTextureIndex = iTexIdx;
}
`;

// Register lit shaders
Effect.ShadersStore["sprite2DLitVertexShader"] = _LIT_VERT_SHADER;
Effect.ShadersStore["sprite2DLitFragmentShader"] = _LIT_FRAG_SHADER;
Effect.ShadersStore["sprite2DLitInstancedVertexShader"] = _LIT_VERT_INSTANCED_SHADER;
Effect.ShadersStore["sprite2DLitInstancedFragmentShader"] = _LIT_FRAG_SHADER;

// ---------------------------------------------------------------------------
// WGSL shader variants (for WebGPU)
// ---------------------------------------------------------------------------

const _WGSL_FRAG_SHADER = `
varying vUV: vec2f;
varying vColor: vec4f;
varying vTextureIndex: f32;

var texture0Sampler: sampler;
var texture0: texture_2d<f32>;
var texture1Sampler: sampler;
var texture1: texture_2d<f32>;
var texture2Sampler: sampler;
var texture2: texture_2d<f32>;
var texture3Sampler: sampler;
var texture3: texture_2d<f32>;
var texture4Sampler: sampler;
var texture4: texture_2d<f32>;
var texture5Sampler: sampler;
var texture5: texture_2d<f32>;
var texture6Sampler: sampler;
var texture6: texture_2d<f32>;
var texture7Sampler: sampler;
var texture7: texture_2d<f32>;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    var uv: vec2f = input.vUV;
    var idx: i32 = i32(input.vTextureIndex + 0.5);
    var texColor: vec4f;
    if (idx < 4) {
        if (idx < 2) {
            if (idx == 0) { texColor = textureSampleLevel(texture0, texture0Sampler, uv, 0.0); }
            else { texColor = textureSampleLevel(texture1, texture1Sampler, uv, 0.0); }
        } else {
            if (idx == 2) { texColor = textureSampleLevel(texture2, texture2Sampler, uv, 0.0); }
            else { texColor = textureSampleLevel(texture3, texture3Sampler, uv, 0.0); }
        }
    } else {
        if (idx < 6) {
            if (idx == 4) { texColor = textureSampleLevel(texture4, texture4Sampler, uv, 0.0); }
            else { texColor = textureSampleLevel(texture5, texture5Sampler, uv, 0.0); }
        } else {
            if (idx == 6) { texColor = textureSampleLevel(texture6, texture6Sampler, uv, 0.0); }
            else { texColor = textureSampleLevel(texture7, texture7Sampler, uv, 0.0); }
        }
    }
    var finalColor: vec4f = texColor * input.vColor;

    if (finalColor.a < 0.01) {
        discard;
    }

    fragmentOutputs.color = finalColor;
}
`;

const _WGSL_VERT_SHADER = `
attribute position: vec2f;
attribute uv: vec2f;
attribute color: vec4f;
attribute cellInfo: vec4f;
attribute transform0: vec4f;
attribute transform1: vec2f;

uniform projection: mat4x4f;

varying vUV: vec2f;
varying vColor: vec4f;
varying vTextureIndex: f32;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    var transformed: vec2f = vec2f(
        input.transform0.x * input.position.x + input.transform0.z * input.position.y + input.transform1.x,
        input.transform0.y * input.position.x + input.transform0.w * input.position.y + input.transform1.y
    );
    vertexOutputs.position = uniforms.projection * vec4f(transformed, 0.0, 1.0);
    vertexOutputs.vUV = input.uv;
    vertexOutputs.vColor = input.color;
    vertexOutputs.vTextureIndex = input.cellInfo.x;
}
`;

const _WGSL_VERT_INSTANCED_SHADER = `
attribute corner: vec2f;

attribute iTransform0: vec4f;
attribute iTransform1: vec2f;
attribute iSize: vec2f;
attribute iColor: vec4f;
attribute iCell: vec4f;
attribute iTexIdx: f32;

uniform projection: mat4x4f;

varying vUV: vec2f;
varying vColor: vec4f;
varying vTextureIndex: f32;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    var pos: vec2f = (input.corner - vec2f(0.5)) * input.iSize;
    var transformed: vec2f = vec2f(
        input.iTransform0.x * pos.x + input.iTransform0.z * pos.y + input.iTransform1.x,
        input.iTransform0.y * pos.x + input.iTransform0.w * pos.y + input.iTransform1.y
    );
    vertexOutputs.position = uniforms.projection * vec4f(transformed, 0.0, 1.0);
    vertexOutputs.vUV = mix(input.iCell.xy, input.iCell.zw, input.corner);
    vertexOutputs.vColor = input.iColor;
    vertexOutputs.vTextureIndex = input.iTexIdx;
}
`;

// Lit WGSL variants

const _WGSL_LIGHTING_FRAG_FN = `
uniform lightCount: i32;
uniform ambientLight: vec4f;
uniform lightData: array<vec4f, ${16 * 4}>;

fn computeLighting(worldPos: vec2f) -> vec3f {
    var lit: vec3f = uniforms.ambientLight.rgb;
    for (var i: i32 = 0; i < ${16}; i = i + 1) {
        if (i >= uniforms.lightCount) { break; }
        var base: i32 = i * 4;
        var d0: vec4f = uniforms.lightData[base];
        var d1: vec4f = uniforms.lightData[base + 1];
        var d2: vec4f = uniforms.lightData[base + 2];
        var d3: vec4f = uniforms.lightData[base + 3];

        var lightType: f32 = d0.w;
        var lColor: vec3f = d1.rgb;
        var lIntensity: f32 = d1.w;

        if (lightType > 1.5) {
            lit = lit + lColor * lIntensity;
            continue;
        }

        var lPos: vec2f = d0.xy;
        var lRadius: f32 = d0.z;
        var lFalloff: f32 = d3.x;

        var delta: vec2f = worldPos - lPos;
        var dist: f32 = length(delta);
        if (dist >= lRadius) { continue; }

        var t: f32 = dist / lRadius;
        var atten: f32 = pow(1.0 - t, lFalloff);

        if (lightType > 0.5) {
            var lDir: vec2f = normalize(d2.xy);
            var innerA: f32 = d2.z;
            var outerA: f32 = d2.w;
            var toFrag: vec2f = delta / max(dist, 0.001);
            var cosAngle: f32 = dot(lDir, toFrag);
            var angle: f32 = acos(clamp(cosAngle, -1.0, 1.0));
            if (angle > outerA) { continue; }
            if (angle > innerA) {
                atten = atten * (1.0 - (angle - innerA) / (outerA - innerA));
            }
        }

        lit = lit + lColor * lIntensity * atten;
    }
    return min(lit, vec3f(1.0));
}`;

const _WGSL_LIT_FRAG_SHADER = `
varying vUV: vec2f;
varying vColor: vec4f;
varying vTextureIndex: f32;
varying vWorldPos: vec2f;

var texture0Sampler: sampler;
var texture0: texture_2d<f32>;
var texture1Sampler: sampler;
var texture1: texture_2d<f32>;
var texture2Sampler: sampler;
var texture2: texture_2d<f32>;
var texture3Sampler: sampler;
var texture3: texture_2d<f32>;
var texture4Sampler: sampler;
var texture4: texture_2d<f32>;
var texture5Sampler: sampler;
var texture5: texture_2d<f32>;
var texture6Sampler: sampler;
var texture6: texture_2d<f32>;
var texture7Sampler: sampler;
var texture7: texture_2d<f32>;

${_WGSL_LIGHTING_FRAG_FN}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    var uv: vec2f = input.vUV;
    var idx: i32 = i32(input.vTextureIndex + 0.5);
    var texColor: vec4f;
    if (idx < 4) {
        if (idx < 2) {
            if (idx == 0) { texColor = textureSampleLevel(texture0, texture0Sampler, uv, 0.0); }
            else { texColor = textureSampleLevel(texture1, texture1Sampler, uv, 0.0); }
        } else {
            if (idx == 2) { texColor = textureSampleLevel(texture2, texture2Sampler, uv, 0.0); }
            else { texColor = textureSampleLevel(texture3, texture3Sampler, uv, 0.0); }
        }
    } else {
        if (idx < 6) {
            if (idx == 4) { texColor = textureSampleLevel(texture4, texture4Sampler, uv, 0.0); }
            else { texColor = textureSampleLevel(texture5, texture5Sampler, uv, 0.0); }
        } else {
            if (idx == 6) { texColor = textureSampleLevel(texture6, texture6Sampler, uv, 0.0); }
            else { texColor = textureSampleLevel(texture7, texture7Sampler, uv, 0.0); }
        }
    }
    var finalColor: vec4f = texColor * input.vColor;

    if (finalColor.a < 0.01) {
        discard;
    }

    var lighting: vec3f = computeLighting(input.vWorldPos);
    finalColor = vec4f(finalColor.rgb * lighting, finalColor.a);

    fragmentOutputs.color = finalColor;
}
`;

const _WGSL_LIT_VERT_SHADER = `
attribute position: vec2f;
attribute uv: vec2f;
attribute color: vec4f;
attribute cellInfo: vec4f;
attribute transform0: vec4f;
attribute transform1: vec2f;

uniform projection: mat4x4f;

varying vUV: vec2f;
varying vColor: vec4f;
varying vTextureIndex: f32;
varying vWorldPos: vec2f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    var transformed: vec2f = vec2f(
        input.transform0.x * input.position.x + input.transform0.z * input.position.y + input.transform1.x,
        input.transform0.y * input.position.x + input.transform0.w * input.position.y + input.transform1.y
    );
    vertexOutputs.position = uniforms.projection * vec4f(transformed, 0.0, 1.0);
    vertexOutputs.vWorldPos = transformed;
    vertexOutputs.vUV = input.uv;
    vertexOutputs.vColor = input.color;
    vertexOutputs.vTextureIndex = input.cellInfo.x;
}
`;

const _WGSL_LIT_VERT_INSTANCED_SHADER = `
attribute corner: vec2f;

attribute iTransform0: vec4f;
attribute iTransform1: vec2f;
attribute iSize: vec2f;
attribute iColor: vec4f;
attribute iCell: vec4f;
attribute iTexIdx: f32;

uniform projection: mat4x4f;

varying vUV: vec2f;
varying vColor: vec4f;
varying vTextureIndex: f32;
varying vWorldPos: vec2f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    var pos: vec2f = (input.corner - vec2f(0.5)) * input.iSize;
    var transformed: vec2f = vec2f(
        input.iTransform0.x * pos.x + input.iTransform0.z * pos.y + input.iTransform1.x,
        input.iTransform0.y * pos.x + input.iTransform0.w * pos.y + input.iTransform1.y
    );
    vertexOutputs.position = uniforms.projection * vec4f(transformed, 0.0, 1.0);
    vertexOutputs.vWorldPos = transformed;
    vertexOutputs.vUV = mix(input.iCell.xy, input.iCell.zw, input.corner);
    vertexOutputs.vColor = input.iColor;
    vertexOutputs.vTextureIndex = input.iTexIdx;
}
`;

// Register WGSL shaders
ShaderStore.ShadersStoreWGSL["sprite2DVertexShader"] = _WGSL_VERT_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DFragmentShader"] = _WGSL_FRAG_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DInstancedVertexShader"] = _WGSL_VERT_INSTANCED_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DInstancedFragmentShader"] = _WGSL_FRAG_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DLitVertexShader"] = _WGSL_LIT_VERT_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DLitFragmentShader"] = _WGSL_LIT_FRAG_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DLitInstancedVertexShader"] = _WGSL_LIT_VERT_INSTANCED_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DLitInstancedFragmentShader"] = _WGSL_LIT_FRAG_SHADER;

// ---------------------------------------------------------------------------
// ISprite2DRenderData
// ---------------------------------------------------------------------------

/**
 * Data for a single sprite to be rendered by the batch renderer
 */
export interface ISprite2DRenderData {
    /**
     * The world transform of the sprite (3x2 affine matrix)
     */
    worldTransform: Matrix2D;
    /**
     * Width in pixels
     */
    width: number;
    /**
     * Height in pixels
     */
    height: number;
    /**
     * Tint color (r, g, b, a) with premultiplied worldAlpha
     */
    r: number;
    /**
     * Green component
     */
    g: number;
    /**
     * Blue component
     */
    b: number;
    /**
     * Alpha component
     */
    a: number;
    /**
     * Source rectangle in normalized UV coordinates [u, v, uWidth, vHeight]
     */
    cellU: number;
    /**
     * Source V coordinate
     */
    cellV: number;
    /**
     * Source width in UV space
     */
    cellW: number;
    /**
     * Source height in UV space
     */
    cellH: number;
    /**
     * Whether to flip horizontally
     */
    flipX: boolean;
    /**
     * Whether to flip vertically
     */
    flipY: boolean;
    /**
     * Whether the texture was loaded with invertY (v=0 at bottom).
     * When true, the renderer flips V so the image appears right-side up.
     */
    invertY: boolean;
    /**
     * The texture to render
     */
    texture: ThinTexture;
    /**
     * Z-index for sorting
     */
    zIndex: number;
    /**
     * Sorting layer — sprites in lower layers render behind higher layers
     */
    sortingLayer: number;
}

// ---------------------------------------------------------------------------
// SpriteBatchRenderer
// ---------------------------------------------------------------------------

/**
 * Batched 2D sprite renderer with GPU instancing and multi-texture support.
 *
 * Optimizations over a naive approach:
 * - **Multi-texture batching**: up to 8 textures per draw call, eliminating
 *   most texture-switch flushes. A typical 2D game renders in 1 draw call.
 * - **GPU instancing** (when supported): 4 shared corner vertices + 17 floats
 *   per sprite instance, ~4× less CPU→GPU data transfer than non-instanced.
 * - **Pixel-perfect mode**: optional `fwidth()`-based alpha sharpening for
 *   crisp pixel-art edges at any zoom level.
 * - **VAO caching**: persistent vertex buffer map enables the engine's internal
 *   Vertex Array Object reuse.
 * - **Partial buffer uploads**: only the used portion of the dynamic buffer is
 *   uploaded each flush.
 */
export class SpriteBatchRenderer {
    // Non-instanced layout: 18 floats/vertex, 4 vertices/quad
    private static readonly _FLOATS_PER_VERTEX = 18;
    private static readonly _VERTS_PER_QUAD = 4;
    private static readonly _INDICES_PER_QUAD = 6;
    private static readonly _FLOATS_PER_QUAD = 18 * 4;

    // Instanced layout: 17 floats/instance
    private static readonly _FLOATS_PER_INSTANCE = 17;

    private _engine: AbstractEngine;
    private _capacity: number;
    private _useInstancing: boolean;

    // Shader effect + draw wrapper
    private _drawWrapper: DrawWrapper;
    private _effect: Effect;
    private _isReady: boolean = false;
    private _shaderLanguage: ShaderLanguage;

    // Lit shader variant
    private _litDrawWrapper: DrawWrapper | null = null;
    private _litEffect: Effect | null = null;
    private _isLitReady: boolean = false;

    /**
     * When set, enables forward lighting in the sprite shader.
     * The manager's packLightUniforms() is called automatically before each render.
     */
    public lightingManager: LightingManager2D | null = null;

    /**
     * Fallback texture used to fill unused texture slots on WebGPU.
     * WebGPU requires all declared texture bindings to be bound.
     */
    public fallbackTexture: ThinTexture | null = null;

    // Persistent vertex buffers map (enables VAO caching)
    private _vertexBuffersMap: { [key: string]: VertexBuffer } = {};

    // Non-instanced resources
    private _vertexData!: Float32Array;
    private _buffer!: Buffer;
    private _indexBuffer!: DataBuffer;

    // Instanced resources
    private _cornerBuffer!: Buffer;
    private _instanceData!: Float32Array;
    private _instanceBuffer!: Buffer;

    // Multi-texture slot tracking
    private _textureSlots: (ThinTexture | null)[] = new Array(_MAX_TEXTURES).fill(null);
    private _textureSlotCount: number = 0;

    // Pre-allocated projection matrix to avoid per-frame allocation
    private _projectionData = new Float32Array(16);
    private _projectionMatrix: { toArray: () => Float32Array; asArray: () => Float32Array; updateFlag: number };

    // Quad corner positions for non-instanced path
    private static readonly _CORNERS = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
    ];

    /**
     * Creates a new SpriteBatchRenderer.
     * @param engine - The Babylon engine instance
     * @param capacity - Maximum number of sprites per batch (default: 10000)
     * @param pixelPerfect - Enable fwidth()-based alpha sharpening for pixel art (default: false)
     */
    constructor(engine: AbstractEngine, capacity: number = 10000, pixelPerfect: boolean = false) {
        this._engine = engine;
        this._capacity = capacity;
        this._useInstancing = engine.getCaps().instancedArrays;
        this._shaderLanguage = engine.isWebGPU ? ShaderLanguage.WGSL : ShaderLanguage.GLSL;

        const projData = this._projectionData;
        this._projectionMatrix = {
            toArray: () => projData,
            asArray: () => projData,
            updateFlag: 0,
        };

        const defines = pixelPerfect && engine.getCaps().standardDerivatives ? "#define PIXEL_PERFECT\n" : "";

        if (this._useInstancing) {
            this._setupInstanced(capacity, defines);
        } else {
            this._setupNonInstanced(capacity, defines);
        }
    }

    // -----------------------------------------------------------------------
    // Setup
    // -----------------------------------------------------------------------

    private _setupInstanced(capacity: number, defines: string): void {
        const engine = this._engine;

        // Static quad corners (triangle-strip order: TL, TR, BL, BR)
        const cornerData = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
        this._cornerBuffer = new Buffer(engine, cornerData, false, 2);

        // Dynamic per-instance buffer
        const stride = SpriteBatchRenderer._FLOATS_PER_INSTANCE;
        this._instanceData = new Float32Array(capacity * stride);
        this._instanceBuffer = new Buffer(engine, this._instanceData, true, stride);

        // Build vertex buffers map (persistent for VAO caching)
        this._vertexBuffersMap["corner"] = this._cornerBuffer.createVertexBuffer("corner", 0, 2, 2, false);
        this._vertexBuffersMap["iTransform0"] = this._instanceBuffer.createVertexBuffer("iTransform0", 0, 4, stride, true);
        this._vertexBuffersMap["iTransform1"] = this._instanceBuffer.createVertexBuffer("iTransform1", 4, 2, stride, true);
        this._vertexBuffersMap["iSize"] = this._instanceBuffer.createVertexBuffer("iSize", 6, 2, stride, true);
        this._vertexBuffersMap["iColor"] = this._instanceBuffer.createVertexBuffer("iColor", 8, 4, stride, true);
        this._vertexBuffersMap["iCell"] = this._instanceBuffer.createVertexBuffer("iCell", 12, 4, stride, true);
        this._vertexBuffersMap["iTexIdx"] = this._instanceBuffer.createVertexBuffer("iTexIdx", 16, 1, stride, true);

        this._effect = engine.createEffect(
            { vertex: "sprite2DInstanced", fragment: "sprite2DInstanced" },
            ["corner", "iTransform0", "iTransform1", "iSize", "iColor", "iCell", "iTexIdx"],
            ["projection"],
            _SAMPLER_NAMES,
            defines,
            undefined, undefined, undefined, undefined,
            this._shaderLanguage
        );

        this._drawWrapper = new DrawWrapper(engine);
        if (this._drawWrapper.drawContext) {
            this._drawWrapper.drawContext.useInstancing = true;
        }
        this._drawWrapper.effect = this._effect;
        this._effect.onCompiled = () => {
            this._isReady = true;
        };

        // Lit variant (same attributes, different shaders + extra uniforms)
        const litUniforms = ["projection", "lightCount", "ambientLight", "lightData"];
        this._litEffect = engine.createEffect(
            { vertex: "sprite2DLitInstanced", fragment: "sprite2DLitInstanced" },
            ["corner", "iTransform0", "iTransform1", "iSize", "iColor", "iCell", "iTexIdx"],
            litUniforms,
            _SAMPLER_NAMES,
            defines,
            undefined, undefined, undefined, undefined,
            this._shaderLanguage
        );
        this._litDrawWrapper = new DrawWrapper(engine);
        if (this._litDrawWrapper.drawContext) {
            this._litDrawWrapper.drawContext.useInstancing = true;
        }
        this._litDrawWrapper.effect = this._litEffect;
        this._litEffect.onCompiled = () => {
            this._isLitReady = true;
        };
    }

    private _setupNonInstanced(capacity: number, defines: string): void {
        const engine = this._engine;
        const stride = SpriteBatchRenderer._FLOATS_PER_VERTEX;

        this._vertexData = new Float32Array(capacity * SpriteBatchRenderer._FLOATS_PER_QUAD);
        this._buffer = new Buffer(engine, this._vertexData, true, stride);

        // Build vertex buffers map (persistent for VAO caching)
        this._vertexBuffersMap[VertexBuffer.PositionKind] = this._buffer.createVertexBuffer(VertexBuffer.PositionKind, 0, 2, stride);
        this._vertexBuffersMap[VertexBuffer.UVKind] = this._buffer.createVertexBuffer(VertexBuffer.UVKind, 2, 2, stride);
        this._vertexBuffersMap[VertexBuffer.ColorKind] = this._buffer.createVertexBuffer(VertexBuffer.ColorKind, 4, 4, stride);
        this._vertexBuffersMap["cellInfo"] = this._buffer.createVertexBuffer("cellInfo", 8, 4, stride);
        this._vertexBuffersMap["transform0"] = this._buffer.createVertexBuffer("transform0", 12, 4, stride);
        this._vertexBuffersMap["transform1"] = this._buffer.createVertexBuffer("transform1", 16, 2, stride);

        // Index buffer
        const indices = new Uint32Array(capacity * SpriteBatchRenderer._INDICES_PER_QUAD);
        for (let i = 0; i < capacity; i++) {
            const vi = i * 4;
            const ii = i * 6;
            indices[ii] = vi;
            indices[ii + 1] = vi + 1;
            indices[ii + 2] = vi + 2;
            indices[ii + 3] = vi;
            indices[ii + 4] = vi + 2;
            indices[ii + 5] = vi + 3;
        }
        this._indexBuffer = engine.createIndexBuffer(indices);

        this._effect = engine.createEffect(
            "sprite2D",
            [VertexBuffer.PositionKind, VertexBuffer.UVKind, VertexBuffer.ColorKind, "cellInfo", "transform0", "transform1"],
            ["projection"],
            _SAMPLER_NAMES,
            defines,
            undefined, undefined, undefined, undefined,
            this._shaderLanguage
        );

        this._drawWrapper = new DrawWrapper(engine);
        this._drawWrapper.effect = this._effect;
        this._effect.onCompiled = () => {
            this._isReady = true;
        };

        // Lit variant
        const litUniforms = ["projection", "lightCount", "ambientLight", "lightData"];
        this._litEffect = engine.createEffect(
            "sprite2DLit",
            [VertexBuffer.PositionKind, VertexBuffer.UVKind, VertexBuffer.ColorKind, "cellInfo", "transform0", "transform1"],
            litUniforms,
            _SAMPLER_NAMES,
            defines,
            undefined, undefined, undefined, undefined,
            this._shaderLanguage
        );
        this._litDrawWrapper = new DrawWrapper(engine);
        this._litDrawWrapper.effect = this._litEffect;
        this._litEffect.onCompiled = () => {
            this._isLitReady = true;
        };
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Whether the renderer is ready (shaders compiled)
     */
    public get isReady(): boolean {
        if (!this._isReady && this._effect.isReady()) {
            this._isReady = true;
        }
        return this._isReady;
    }

    /**
     * Whether the lit shader variant is ready
     */
    public get isLitReady(): boolean {
        if (!this._isLitReady && this._litEffect && this._litEffect.isReady()) {
            this._isLitReady = true;
        }
        return this._isLitReady;
    }

    /**
     * Renders a batch of sprite data.
     * @param sprites - Array of sprite render data, sorted by z-index
     * @param viewportWidth - Width of the viewport in pixels
     * @param viewportHeight - Height of the viewport in pixels
     * @param cameraTransform - The camera's inverse world transform (to convert world → view)
     */
    public render(sprites: ISprite2DRenderData[], viewportWidth: number, viewportHeight: number, cameraTransform: Matrix2D): void {
        if (!this.isReady || sprites.length === 0) {
            return;
        }

        const useLit = this.lightingManager !== null && this.lightingManager.activeLightCount > 0 && this.isLitReady;
        const activeEffect = useLit ? this._litEffect! : this._effect;
        const activeWrapper = useLit ? this._litDrawWrapper! : this._drawWrapper;
        this._activeEffect = activeEffect;

        const engine = this._engine;
        engine.setAlphaMode(Constants.ALPHA_COMBINE);
        engine.setDepthBuffer(false);
        engine.setState(false); // Disable backface culling for 2D quads
        engine.enableEffect(activeWrapper);

        // Update orthographic projection (Y-down, top-left origin)
        const p = this._projectionData;
        p[0] = 2.0 / viewportWidth;
        p[5] = -2.0 / viewportHeight;
        p[10] = 1;
        p[12] = -1;
        p[13] = 1;
        p[15] = 1;
        this._projectionMatrix.updateFlag++;
        activeEffect.setMatrix("projection", this._projectionMatrix as any);

        // Bind lighting uniforms if using lit shader
        if (useLit) {
            this.lightingManager!.bindToEffect(activeEffect);
        }

        if (this._useInstancing) {
            this._renderInstanced(sprites, cameraTransform);
        } else {
            this._renderNonInstanced(sprites, cameraTransform);
        }

        engine.setDepthBuffer(true);
        engine.setAlphaMode(Constants.ALPHA_DISABLE);
    }

    /**
     * Disposes of the renderer and its GPU resources
     */
    public dispose(): void {
        if (this._buffer) {
            this._buffer.dispose();
        }
        if (this._indexBuffer) {
            this._engine._releaseBuffer(this._indexBuffer);
        }
        if (this._cornerBuffer) {
            this._cornerBuffer.dispose();
        }
        if (this._instanceBuffer) {
            this._instanceBuffer.dispose();
        }
        this._effect.dispose();
    }

    // -----------------------------------------------------------------------
    // Multi-texture slot management
    // -----------------------------------------------------------------------

    /**
     * Returns the slot index for a texture, assigning a new slot if needed.
     * Returns -1 if all slots are full (caller must flush).
     */
    private _getTextureSlot(texture: ThinTexture): number {
        for (let i = 0; i < this._textureSlotCount; i++) {
            if (this._textureSlots[i] === texture) {
                return i;
            }
        }
        if (this._textureSlotCount < _MAX_TEXTURES) {
            this._textureSlots[this._textureSlotCount] = texture;
            return this._textureSlotCount++;
        }
        return -1;
    }

    private _resetTextureSlots(): void {
        for (let i = 0; i < this._textureSlotCount; i++) {
            this._textureSlots[i] = null;
        }
        this._textureSlotCount = 0;
    }

    private _activeEffect: Effect = null!;

    private _bindTextures(): void {
        for (let i = 0; i < this._textureSlotCount; i++) {
            this._activeEffect.setTexture(`texture${i}`, this._textureSlots[i]);
        }
        // WebGPU requires all declared texture bindings to be bound
        if (this._engine.isWebGPU && this.fallbackTexture) {
            for (let i = this._textureSlotCount; i < _MAX_TEXTURES; i++) {
                this._activeEffect.setTexture(`texture${i}`, this.fallbackTexture);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Instanced render path
    // -----------------------------------------------------------------------

    private _renderInstanced(sprites: ISprite2DRenderData[], cameraTransform: Matrix2D): void {
        const cm = cameraTransform.m;
        const stride = SpriteBatchRenderer._FLOATS_PER_INSTANCE;
        const data = this._instanceData;
        let count = 0;

        for (let i = 0; i < sprites.length; i++) {
            const sprite = sprites[i];

            let texSlot = this._getTextureSlot(sprite.texture);
            if (texSlot === -1 || count >= this._capacity) {
                this._flushInstanced(count);
                count = 0;
                texSlot = this._getTextureSlot(sprite.texture);
            }

            // Combined camera × sprite world transform
            const wt = sprite.worldTransform.m;
            const ca = cm[0] * wt[0] + cm[2] * wt[1];
            const cb = cm[1] * wt[0] + cm[3] * wt[1];
            const cc = cm[0] * wt[2] + cm[2] * wt[3];
            const cd = cm[1] * wt[2] + cm[3] * wt[3];
            const ctx = cm[0] * wt[4] + cm[2] * wt[5] + cm[4];
            const cty = cm[1] * wt[4] + cm[3] * wt[5] + cm[5];

            // UV corners (pre-baked with flip)
            // Babylon textures default to invertY=true, so v=0 is bottom of image.
            // Flip V so the top of the quad samples the top of the source rect.
            let u0 = sprite.cellU;
            let v0 = sprite.invertY ? 1.0 - sprite.cellV : sprite.cellV;
            let u1 = sprite.cellU + sprite.cellW;
            let v1 = sprite.invertY ? 1.0 - sprite.cellV - sprite.cellH : sprite.cellV + sprite.cellH;
            if (sprite.flipX) {
                const t = u0;
                u0 = u1;
                u1 = t;
            }
            if (sprite.flipY) {
                const t = v0;
                v0 = v1;
                v1 = t;
            }

            const off = count * stride;
            data[off] = ca;
            data[off + 1] = cb;
            data[off + 2] = cc;
            data[off + 3] = cd;
            data[off + 4] = ctx;
            data[off + 5] = cty;
            data[off + 6] = sprite.width;
            data[off + 7] = sprite.height;
            data[off + 8] = sprite.r;
            data[off + 9] = sprite.g;
            data[off + 10] = sprite.b;
            data[off + 11] = sprite.a;
            data[off + 12] = u0;
            data[off + 13] = v0;
            data[off + 14] = u1;
            data[off + 15] = v1;
            data[off + 16] = texSlot;

            count++;
        }

        if (count > 0) {
            this._flushInstanced(count);
        }
    }

    private _flushInstanced(count: number): void {
        if (count === 0) {
            return;
        }
        this._bindTextures();
        this._instanceBuffer.updateDirectly(this._instanceData, 0, count);
        this._engine.bindBuffers(this._vertexBuffersMap, null as any, this._effect);
        this._engine.drawArraysType(Constants.MATERIAL_TriangleStripDrawMode, 0, 4, count);
        this._resetTextureSlots();
    }

    // -----------------------------------------------------------------------
    // Non-instanced render path (fallback)
    // -----------------------------------------------------------------------

    private _renderNonInstanced(sprites: ISprite2DRenderData[], cameraTransform: Matrix2D): void {
        const cm = cameraTransform.m;
        const vd = this._vertexData;
        let count = 0;

        for (let i = 0; i < sprites.length; i++) {
            const sprite = sprites[i];

            let texSlot = this._getTextureSlot(sprite.texture);
            if (texSlot === -1 || count >= this._capacity) {
                this._flushNonInstanced(count);
                count = 0;
                texSlot = this._getTextureSlot(sprite.texture);
            }

            // Combined camera × sprite world transform
            const wt = sprite.worldTransform.m;
            const ca = cm[0] * wt[0] + cm[2] * wt[1];
            const cb = cm[1] * wt[0] + cm[3] * wt[1];
            const cc = cm[0] * wt[2] + cm[2] * wt[3];
            const cd = cm[1] * wt[2] + cm[3] * wt[3];
            const ctx = cm[0] * wt[4] + cm[2] * wt[5] + cm[4];
            const cty = cm[1] * wt[4] + cm[3] * wt[5] + cm[5];

            const w = sprite.width;
            const h = sprite.height;

            // UV corners (pre-baked with flip)
            // Babylon textures default to invertY=true, so v=0 is bottom of image.
            // Flip V so the top of the quad samples the top of the source rect.
            let u0 = sprite.cellU;
            let v0 = sprite.invertY ? 1.0 - sprite.cellV : sprite.cellV;
            let u1 = sprite.cellU + sprite.cellW;
            let v1 = sprite.invertY ? 1.0 - sprite.cellV - sprite.cellH : sprite.cellV + sprite.cellH;
            if (sprite.flipX) {
                const t = u0;
                u0 = u1;
                u1 = t;
            }
            if (sprite.flipY) {
                const t = v0;
                v0 = v1;
                v1 = t;
            }

            const uvs = [
                [u0, v0],
                [u1, v0],
                [u1, v1],
                [u0, v1],
            ];

            const baseOffset = count * SpriteBatchRenderer._FLOATS_PER_QUAD;
            for (let v = 0; v < 4; v++) {
                const corner = SpriteBatchRenderer._CORNERS[v];
                const off = baseOffset + v * SpriteBatchRenderer._FLOATS_PER_VERTEX;

                // Position (local, centered)
                vd[off] = (corner[0] - 0.5) * w;
                vd[off + 1] = (corner[1] - 0.5) * h;

                // UV (pre-baked)
                vd[off + 2] = uvs[v][0];
                vd[off + 3] = uvs[v][1];

                // Color
                vd[off + 4] = sprite.r;
                vd[off + 5] = sprite.g;
                vd[off + 6] = sprite.b;
                vd[off + 7] = sprite.a;

                // cellInfo: x = texture index, yzw unused
                vd[off + 8] = texSlot;
                vd[off + 9] = 0;
                vd[off + 10] = 0;
                vd[off + 11] = 0;

                // Transform (combined camera × world)
                vd[off + 12] = ca;
                vd[off + 13] = cb;
                vd[off + 14] = cc;
                vd[off + 15] = cd;
                vd[off + 16] = ctx;
                vd[off + 17] = cty;
            }

            count++;
        }

        if (count > 0) {
            this._flushNonInstanced(count);
        }
    }

    private _flushNonInstanced(count: number): void {
        if (count === 0) {
            return;
        }
        this._bindTextures();
        this._buffer.updateDirectly(this._vertexData, 0, count * SpriteBatchRenderer._VERTS_PER_QUAD);
        this._engine.bindBuffers(this._vertexBuffersMap, this._indexBuffer, this._effect);
        this._engine.drawElementsType(Constants.MATERIAL_TriangleFillMode, 0, count * SpriteBatchRenderer._INDICES_PER_QUAD);
        this._resetTextureSlots();
    }
}
