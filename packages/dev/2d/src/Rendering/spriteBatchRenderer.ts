import type { AbstractEngine } from "core/Engines/abstractEngine";
import type { ThinTexture } from "core/Materials/Textures/thinTexture";
import type { DataBuffer } from "core/Buffers/dataBuffer";
import { Buffer, VertexBuffer } from "core/Buffers/buffer";
import { DrawWrapper } from "core/Materials/drawWrapper";
import { Effect } from "core/Materials/effect";
import { ShaderStore } from "core/Engines/shaderStore";
import { ShaderLanguage } from "core/Materials/shaderLanguage";
import { Constants } from "core/Engines/constants";
import type { IMatrixLike } from "core/Maths/math.like";
import { Vector2 } from "core/Maths/math.vector";

import { LightingMode2D } from "../Lighting/light2D";
import type { LightingManager2D } from "../Lighting/light2D";
import { Matrix2D } from "../Math/matrix2D";


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const _MAX_TEXTURES = 8;

type MatrixTuple16 = [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
];

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

const _MSDF_FRAG_SHADER = `
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
uniform float screenPxRange;

${_TEXTURE_SAMPLE_FN}

float median(float r, float g, float b) {
    return max(min(r, g), min(max(r, g), b));
}

void main(void) {
    vec3 sampleColor = sampleTex().rgb;
    float signedDistance = median(sampleColor.r, sampleColor.g, sampleColor.b) - 0.5;
    float opacity = clamp(signedDistance * max(screenPxRange, 1.0) + 0.5, 0.0, 1.0);
    vec4 finalColor = vec4(vColor.rgb, vColor.a * opacity);

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
attribute vec4 iLocalRect;
attribute vec4 iColor;
attribute vec2 iUvOrigin;
attribute vec2 iUvAxisX;
attribute vec2 iUvAxisY;
attribute float iTexIdx;

uniform mat4 projection;

varying vec2 vUV;
varying vec4 vColor;
varying float vTextureIndex;

void main(void) {
    vec2 pos = vec2(
        mix(iLocalRect.x, iLocalRect.z, corner.x),
        mix(iLocalRect.y, iLocalRect.w, corner.y)
    );
    vec2 transformed = vec2(
        iTransform0.x * pos.x + iTransform0.z * pos.y + iTransform1.x,
        iTransform0.y * pos.x + iTransform0.w * pos.y + iTransform1.y
    );
    gl_Position = projection * vec4(transformed, 0.0, 1.0);
    vUV = iUvOrigin + iUvAxisX * corner.x + iUvAxisY * corner.y;
    vColor = iColor;
    vTextureIndex = iTexIdx;
}
`;

// Register shaders with the Effect store
Effect.ShadersStore["sprite2DVertexShader"] = _VERT_SHADER;
Effect.ShadersStore["sprite2DFragmentShader"] = _FRAG_SHADER;
Effect.ShadersStore["sprite2DInstancedVertexShader"] = _VERT_INSTANCED_SHADER;
Effect.ShadersStore["sprite2DInstancedFragmentShader"] = _FRAG_SHADER;
Effect.ShadersStore["sprite2DMsdfVertexShader"] = _VERT_SHADER;
Effect.ShadersStore["sprite2DMsdfFragmentShader"] = _MSDF_FRAG_SHADER;
Effect.ShadersStore["sprite2DMsdfInstancedVertexShader"] = _VERT_INSTANCED_SHADER;
Effect.ShadersStore["sprite2DMsdfInstancedFragmentShader"] = _MSDF_FRAG_SHADER;

// ---------------------------------------------------------------------------
// Forward-lit shader variants
// ---------------------------------------------------------------------------

const _LIGHTING_FRAG_FN = `
// Light data: 4 vec4s per light
// [i*4+0]: (posX, posY, radius, type)  type: 0=point, 1=spot, 2=ambient
// [i*4+1]: (colorR, colorG, colorB, intensity)
// [i*4+2]: (falloff, spotAngle, spotConeAngle, spotSoftness)
// [i*4+3]: (zHeight, 0, 0, 0)
uniform int activeLightCount;
uniform vec3 ambientColor;
uniform float shadowStrength;
uniform vec4 lightData[${16 * 4}];

vec3 computeLighting(vec2 worldPos) {
    vec3 lit = ambientColor;
    for (int i = 0; i < ${16}; i++) {
        if (i >= activeLightCount) {
            break;
        }

        int base = i * 4;
        vec4 d0 = lightData[base];
        vec4 d1 = lightData[base + 1];
        vec4 d2 = lightData[base + 2];

        int lightType = int(d0.w + 0.5);
        if (lightType == 2) {
            lit += d1.rgb * d1.a;
            continue;
        }

        vec2 toLight = d0.xy - worldPos;
        float dist = length(toLight);
        if (dist >= d0.z) {
            continue;
        }

        float atten = pow(max(0.0, 1.0 - dist / d0.z), max(d2.x, 0.0001));

        if (lightType == 1) {
            float outerAngle = max(d2.z, 0.0);
            float innerAngle = max(outerAngle * (1.0 - clamp(d2.w, 0.0, 1.0)), 0.0);
            float outerCos = cos(outerAngle);
            float innerCos = cos(innerAngle);
            vec2 lightDir = vec2(cos(d2.y), sin(d2.y));
            vec2 toFragment = -toLight / max(dist, 0.001);
            float spotFactor = dot(toFragment, lightDir);
            if (spotFactor <= outerCos) {
                continue;
            }

            if (d2.w > 0.001) {
                float coneRange = max(innerCos - outerCos, 0.001);
                float spotAtten = clamp((spotFactor - outerCos) / coneRange, 0.0, 1.0);
                atten *= spotAtten;
            }
        }

        lit += d1.rgb * d1.a * atten;
    }

    return clamp(lit, vec3(0.0), vec3(1.0));
}

vec3 applyLighting(vec3 baseColor, vec3 lighting) {
    vec3 lightMultiplier = mix(vec3(shadowStrength), vec3(1.0), lighting);
    return baseColor * lightMultiplier;
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

    vec3 lighting = computeLighting(vWorldPos);
    finalColor.rgb = applyLighting(finalColor.rgb, lighting);

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
attribute vec4 iLocalRect;
attribute vec4 iColor;
attribute vec2 iUvOrigin;
attribute vec2 iUvAxisX;
attribute vec2 iUvAxisY;
attribute float iTexIdx;

uniform mat4 projection;

varying vec2 vUV;
varying vec4 vColor;
varying float vTextureIndex;
varying vec2 vWorldPos;

void main(void) {
    vec2 pos = vec2(
        mix(iLocalRect.x, iLocalRect.z, corner.x),
        mix(iLocalRect.y, iLocalRect.w, corner.y)
    );
    vec2 transformed = vec2(
        iTransform0.x * pos.x + iTransform0.z * pos.y + iTransform1.x,
        iTransform0.y * pos.x + iTransform0.w * pos.y + iTransform1.y
    );
    gl_Position = projection * vec4(transformed, 0.0, 1.0);
    vWorldPos = transformed;
    vUV = iUvOrigin + iUvAxisX * corner.x + iUvAxisY * corner.y;
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

const _WGSL_MSDF_FRAG_SHADER = `
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

uniform screenPxRange: f32;

fn median3(value: vec3f) -> f32 {
    return max(min(value.x, value.y), min(max(value.x, value.y), value.z));
}

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

    var signedDistance: f32 = median3(texColor.rgb) - 0.5;
    var opacity: f32 = clamp(signedDistance * max(uniforms.screenPxRange, 1.0) + 0.5, 0.0, 1.0);
    var finalColor: vec4f = vec4f(input.vColor.rgb, input.vColor.a * opacity);

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
attribute iLocalRect: vec4f;
attribute iColor: vec4f;
attribute iUvOrigin: vec2f;
attribute iUvAxisX: vec2f;
attribute iUvAxisY: vec2f;
attribute iTexIdx: f32;

uniform projection: mat4x4f;

varying vUV: vec2f;
varying vColor: vec4f;
varying vTextureIndex: f32;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    var pos: vec2f = vec2f(
        mix(input.iLocalRect.x, input.iLocalRect.z, input.corner.x),
        mix(input.iLocalRect.y, input.iLocalRect.w, input.corner.y)
    );
    var transformed: vec2f = vec2f(
        input.iTransform0.x * pos.x + input.iTransform0.z * pos.y + input.iTransform1.x,
        input.iTransform0.y * pos.x + input.iTransform0.w * pos.y + input.iTransform1.y
    );
    vertexOutputs.position = uniforms.projection * vec4f(transformed, 0.0, 1.0);
    vertexOutputs.vUV = input.iUvOrigin + input.iUvAxisX * input.corner.x + input.iUvAxisY * input.corner.y;
    vertexOutputs.vColor = input.iColor;
    vertexOutputs.vTextureIndex = input.iTexIdx;
}
`;

// Lit WGSL variants

const _WGSL_LIGHTING_FRAG_FN = `
uniform activeLightCount: i32;
uniform ambientColor: vec3f;
uniform shadowStrength: f32;
uniform lightData: array<vec4f, ${16 * 4}>;

fn computeLighting(worldPos: vec2f) -> vec3f {
    var lit: vec3f = uniforms.ambientColor;
    for (var i: i32 = 0; i < ${16}; i = i + 1) {
        if (i >= uniforms.activeLightCount) {
            break;
        }

        var base: i32 = i * 4;
        var d0: vec4f = uniforms.lightData[base];
        var d1: vec4f = uniforms.lightData[base + 1];
        var d2: vec4f = uniforms.lightData[base + 2];

        var lightType: i32 = i32(d0.w + 0.5);
        if (lightType == 2) {
            lit = lit + d1.rgb * d1.a;
            continue;
        }

        var toLight: vec2f = d0.xy - worldPos;
        var dist: f32 = length(toLight);
        if (dist >= d0.z) {
            continue;
        }

        var atten: f32 = pow(max(0.0, 1.0 - dist / d0.z), max(d2.x, 0.0001));

        if (lightType == 1) {
            var outerAngle: f32 = max(d2.z, 0.0);
            var innerAngle: f32 = max(outerAngle * (1.0 - clamp(d2.w, 0.0, 1.0)), 0.0);
            var outerCos: f32 = cos(outerAngle);
            var innerCos: f32 = cos(innerAngle);
            var lightDir: vec2f = vec2f(cos(d2.y), sin(d2.y));
            var toFragment: vec2f = -toLight / max(dist, 0.001);
            var spotFactor: f32 = dot(toFragment, lightDir);
            if (spotFactor <= outerCos) {
                continue;
            }

            if (d2.w > 0.001) {
                var coneRange: f32 = max(innerCos - outerCos, 0.001);
                var spotAtten: f32 = clamp((spotFactor - outerCos) / coneRange, 0.0, 1.0);
                atten = atten * spotAtten;
            }
        }

        lit = lit + d1.rgb * d1.a * atten;
    }

    return clamp(lit, vec3f(0.0), vec3f(1.0));
}

fn applyLighting(baseColor: vec3f, lighting: vec3f) -> vec3f {
    var lightMultiplier: vec3f = mix(vec3f(uniforms.shadowStrength), vec3f(1.0), lighting);
    return baseColor * lightMultiplier;
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
    finalColor = vec4f(applyLighting(finalColor.rgb, lighting), finalColor.a);

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
attribute iLocalRect: vec4f;
attribute iColor: vec4f;
attribute iUvOrigin: vec2f;
attribute iUvAxisX: vec2f;
attribute iUvAxisY: vec2f;
attribute iTexIdx: f32;

uniform projection: mat4x4f;

varying vUV: vec2f;
varying vColor: vec4f;
varying vTextureIndex: f32;
varying vWorldPos: vec2f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    var pos: vec2f = vec2f(
        mix(input.iLocalRect.x, input.iLocalRect.z, input.corner.x),
        mix(input.iLocalRect.y, input.iLocalRect.w, input.corner.y)
    );
    var transformed: vec2f = vec2f(
        input.iTransform0.x * pos.x + input.iTransform0.z * pos.y + input.iTransform1.x,
        input.iTransform0.y * pos.x + input.iTransform0.w * pos.y + input.iTransform1.y
    );
    vertexOutputs.position = uniforms.projection * vec4f(transformed, 0.0, 1.0);
    vertexOutputs.vWorldPos = transformed;
    vertexOutputs.vUV = input.iUvOrigin + input.iUvAxisX * input.corner.x + input.iUvAxisY * input.corner.y;
    vertexOutputs.vColor = input.iColor;
    vertexOutputs.vTextureIndex = input.iTexIdx;
}
`;

// Register WGSL shaders
ShaderStore.ShadersStoreWGSL["sprite2DVertexShader"] = _WGSL_VERT_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DFragmentShader"] = _WGSL_FRAG_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DInstancedVertexShader"] = _WGSL_VERT_INSTANCED_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DInstancedFragmentShader"] = _WGSL_FRAG_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DMsdfVertexShader"] = _WGSL_VERT_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DMsdfFragmentShader"] = _WGSL_MSDF_FRAG_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DMsdfInstancedVertexShader"] = _WGSL_VERT_INSTANCED_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DMsdfInstancedFragmentShader"] = _WGSL_MSDF_FRAG_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DLitVertexShader"] = _WGSL_LIT_VERT_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DLitFragmentShader"] = _WGSL_LIT_FRAG_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DLitInstancedVertexShader"] = _WGSL_LIT_VERT_INSTANCED_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DLitInstancedFragmentShader"] = _WGSL_LIT_FRAG_SHADER;

// ---------------------------------------------------------------------------
// Mask shader variants (stencil-only rendering with configurable alpha threshold)
// ---------------------------------------------------------------------------

const _MASK_FRAG_SHADER = `
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
uniform float alphaThreshold;

${_TEXTURE_SAMPLE_FN}

void main(void) {
    vec4 texColor = sampleTex();
    vec4 finalColor = texColor * vColor;

    if (finalColor.a < alphaThreshold) {
        discard;
    }

    gl_FragColor = vec4(1.0);
}
`;

const _WGSL_MASK_FRAG_SHADER = `
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

uniform alphaThreshold: f32;

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

    if (finalColor.a < uniforms.alphaThreshold) {
        discard;
    }

    fragmentOutputs.color = vec4f(1.0);
}
`;

// Mask shaders reuse the base vertex shaders (same attributes/varyings)
Effect.ShadersStore["sprite2DMaskVertexShader"] = _VERT_SHADER;
Effect.ShadersStore["sprite2DMaskFragmentShader"] = _MASK_FRAG_SHADER;
Effect.ShadersStore["sprite2DMaskInstancedVertexShader"] = _VERT_INSTANCED_SHADER;
Effect.ShadersStore["sprite2DMaskInstancedFragmentShader"] = _MASK_FRAG_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DMaskVertexShader"] = _WGSL_VERT_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DMaskFragmentShader"] = _WGSL_MASK_FRAG_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DMaskInstancedVertexShader"] = _WGSL_VERT_INSTANCED_SHADER;
ShaderStore.ShadersStoreWGSL["sprite2DMaskInstancedFragmentShader"] = _WGSL_MASK_FRAG_SHADER;

// ---------------------------------------------------------------------------
// ISprite2DRenderData
// ---------------------------------------------------------------------------

/**
 * Data for a single sprite to be rendered by the batch renderer
 */
export interface ISprite2DRenderData {
    /** Precomputed world transform (3x2 affine matrix). */
    worldTransform: Matrix2D;
    /** Texture bound for this sprite. */
    texture: ThinTexture;
    /** UV bounds packed as [u0, v0, u1, v1]. */
    uvs: [number, number, number, number];
    /** Premultiplied tint * alpha as [r, g, b, a]. */
    color: [number, number, number, number];
    /** Display width in pixels. */
    width: number;
    /** Display height in pixels. */
    height: number;
    /** Alpha blend mode. */
    alphaMode: number;
    /** Packed sort key: (sortingLayer << 16) | (zIndex & 0xffff). */
    sortKey: number;
    /** Stable insertion-order tiebreaker. */
    insertionOrder: number;
    /** Whether this sprite uses the lit shader variant. */
    lit: boolean;
    /** Whether this sprite uses the MSDF shader variant. */
    msdf?: boolean;
    /** Per-batch screen pixel range used by the MSDF shader. */
    msdfScreenPxRange?: number;
    /** Left edge of the local quad in sprite space. */
    localLeft?: number;
    /** Top edge of the local quad in sprite space. */
    localTop?: number;
    /** Right edge of the local quad in sprite space. */
    localRight?: number;
    /** Bottom edge of the local quad in sprite space. */
    localBottom?: number;
    /** Base UV for corner (0, 0). */
    uvOriginU?: number;
    /** Base UV for corner (0, 0). */
    uvOriginV?: number;
    /** UV delta applied across the X axis. */
    uvAxisXU?: number;
    /** UV delta applied across the X axis. */
    uvAxisXV?: number;
    /** UV delta applied across the Y axis. */
    uvAxisYU?: number;
    /** UV delta applied across the Y axis. */
    uvAxisYV?: number;
    /** Horizontal scroll factor for parallax. */
    scrollFactorX?: number;
    /** Vertical scroll factor for parallax. */
    scrollFactorY?: number;
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

    // Instanced layout: 24 floats/instance (17 live values + reserved padding)
    private static readonly _FLOATS_PER_INSTANCE = 24;

    private _engine: AbstractEngine;
    private _useInstancing: boolean;

    /** Maximum number of textures bound per draw call. */
    public readonly maxTexturesPerBatch: number;

    /** Maximum instances emitted in a single draw call. */
    public readonly maxInstancesPerBatch: number;

    // Shader effect + draw wrapper
    private _drawWrapper: DrawWrapper;
    private _effect: Effect;
    private _isReady: boolean = false;
    private _shaderLanguage: ShaderLanguage;

    // Lit shader variant
    private _litDrawWrapper: DrawWrapper | null = null;
    private _litEffect: Effect | null = null;
    private _isLitReady: boolean = false;

    // Mask shader variant (stencil-only rendering with alphaThreshold)
    private _maskDrawWrapper: DrawWrapper | null = null;
    private _maskEffect: Effect | null = null;
    private _isMaskReady: boolean = false;

    // MSDF shader variant
    private _msdfDrawWrapper: DrawWrapper | null = null;
    private _msdfEffect: Effect | null = null;
    private _isMsdfReady: boolean = false;

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
    private _textureSlotMap: Map<ThinTexture, number> = new Map();
    private _textureSlots: ThinTexture[] = new Array(_MAX_TEXTURES) as ThinTexture[];
    private _textureSlotCount: number = 0;

    // Per-frame debug stats
    private _drawCallCount: number = 0;
    private _spriteCount: number = 0;
    private _statsFrameId: number = -1;

    // Pre-allocated projection matrix to avoid per-frame allocation
    private _projectionData: MatrixTuple16 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    private _projectionMatrix: IMatrixLike;
    private _activeViewProjection: Readonly<Matrix2D> = Matrix2D.Identity();
    private _activeLightingManager: LightingManager2D | null = null;
    private _activeMaskAlphaThreshold: number = 0;
    private _activeMsdfScreenPxRange: number = 1;
    private _cameraWorldX: number = 0;
    private _cameraWorldY: number = 0;
    private _cameraWorldPosition: Vector2 = Vector2.Zero();
    private _inverseViewProjection: Matrix2D = Matrix2D.Identity();

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
     * @param capacity - Maximum number of sprites per batch (default: 16384)
     * @param pixelPerfect - Enable fwidth()-based alpha sharpening for pixel art (default: false)
     */
    constructor(engine: AbstractEngine, capacity: number = 16384, pixelPerfect: boolean = false) {
        this._engine = engine;
        this.maxInstancesPerBatch = capacity;
        const caps = engine.getCaps();
        this.maxTexturesPerBatch = Math.max(1, Math.min(_MAX_TEXTURES, caps.maxTexturesImageUnits || _MAX_TEXTURES));
        this._useInstancing = caps.instancedArrays;
        this._shaderLanguage = engine.isWebGPU ? ShaderLanguage.WGSL : ShaderLanguage.GLSL;

        const projData = this._projectionData;
        this._projectionMatrix = {
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
        this._vertexBuffersMap["iLocalRect"] = this._instanceBuffer.createVertexBuffer("iLocalRect", 6, 4, stride, true);
        this._vertexBuffersMap["iColor"] = this._instanceBuffer.createVertexBuffer("iColor", 10, 4, stride, true);
        this._vertexBuffersMap["iUvOrigin"] = this._instanceBuffer.createVertexBuffer("iUvOrigin", 14, 2, stride, true);
        this._vertexBuffersMap["iUvAxisX"] = this._instanceBuffer.createVertexBuffer("iUvAxisX", 16, 2, stride, true);
        this._vertexBuffersMap["iUvAxisY"] = this._instanceBuffer.createVertexBuffer("iUvAxisY", 18, 2, stride, true);
        this._vertexBuffersMap["iTexIdx"] = this._instanceBuffer.createVertexBuffer("iTexIdx", 20, 1, stride, true);

        this._effect = engine.createEffect(
            { vertex: "sprite2DInstanced", fragment: "sprite2DInstanced" },
            ["corner", "iTransform0", "iTransform1", "iLocalRect", "iColor", "iUvOrigin", "iUvAxisX", "iUvAxisY", "iTexIdx"],
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
        const litUniforms = ["projection", "activeLightCount", "ambientColor", "shadowStrength", "lightData"];
        this._litEffect = engine.createEffect(
            { vertex: "sprite2DLitInstanced", fragment: "sprite2DLitInstanced" },
            ["corner", "iTransform0", "iTransform1", "iLocalRect", "iColor", "iUvOrigin", "iUvAxisX", "iUvAxisY", "iTexIdx"],
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

        this._msdfEffect = engine.createEffect(
            { vertex: "sprite2DMsdfInstanced", fragment: "sprite2DMsdfInstanced" },
            ["corner", "iTransform0", "iTransform1", "iLocalRect", "iColor", "iUvOrigin", "iUvAxisX", "iUvAxisY", "iTexIdx"],
            ["projection", "screenPxRange"],
            _SAMPLER_NAMES,
            defines,
            undefined, undefined, undefined, undefined,
            this._shaderLanguage
        );
        this._msdfDrawWrapper = new DrawWrapper(engine);
        if (this._msdfDrawWrapper.drawContext) {
            this._msdfDrawWrapper.drawContext.useInstancing = true;
        }
        this._msdfDrawWrapper.effect = this._msdfEffect;
        this._msdfEffect.onCompiled = () => {
            this._isMsdfReady = true;
        };

        // Mask variant (same attributes, alphaThreshold uniform)
        this._maskEffect = engine.createEffect(
            { vertex: "sprite2DMaskInstanced", fragment: "sprite2DMaskInstanced" },
            ["corner", "iTransform0", "iTransform1", "iLocalRect", "iColor", "iUvOrigin", "iUvAxisX", "iUvAxisY", "iTexIdx"],
            ["projection", "alphaThreshold"],
            _SAMPLER_NAMES,
            defines,
            undefined, undefined, undefined, undefined,
            this._shaderLanguage
        );
        this._maskDrawWrapper = new DrawWrapper(engine);
        if (this._maskDrawWrapper.drawContext) {
            this._maskDrawWrapper.drawContext.useInstancing = true;
        }
        this._maskDrawWrapper.effect = this._maskEffect;
        this._maskEffect.onCompiled = () => {
            this._isMaskReady = true;
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
        const litUniforms = ["projection", "activeLightCount", "ambientColor", "shadowStrength", "lightData"];
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

        this._msdfEffect = engine.createEffect(
            "sprite2DMsdf",
            [VertexBuffer.PositionKind, VertexBuffer.UVKind, VertexBuffer.ColorKind, "cellInfo", "transform0", "transform1"],
            ["projection", "screenPxRange"],
            _SAMPLER_NAMES,
            defines,
            undefined, undefined, undefined, undefined,
            this._shaderLanguage
        );
        this._msdfDrawWrapper = new DrawWrapper(engine);
        this._msdfDrawWrapper.effect = this._msdfEffect;
        this._msdfEffect.onCompiled = () => {
            this._isMsdfReady = true;
        };

        // Mask variant
        this._maskEffect = engine.createEffect(
            "sprite2DMask",
            [VertexBuffer.PositionKind, VertexBuffer.UVKind, VertexBuffer.ColorKind, "cellInfo", "transform0", "transform1"],
            ["projection", "alphaThreshold"],
            _SAMPLER_NAMES,
            defines,
            undefined, undefined, undefined, undefined,
            this._shaderLanguage
        );
        this._maskDrawWrapper = new DrawWrapper(engine);
        this._maskDrawWrapper.effect = this._maskEffect;
        this._maskEffect.onCompiled = () => {
            this._isMaskReady = true;
        };
    }

    /**
     * Whether the renderer is ready (shaders compiled)
     */
    public get isReady(): boolean {
        if (!this._isReady && this._effect.isReady()) {
            this._isReady = true;
        }
        return this._isReady && this.isMsdfReady;
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
     * Whether the mask shader variant is ready
     */
    public get isMaskReady(): boolean {
        if (!this._isMaskReady && this._maskEffect && this._maskEffect.isReady()) {
            this._isMaskReady = true;
        }
        return this._isMaskReady;
    }

    /**
     * Whether the MSDF shader variant is ready.
     */
    public get isMsdfReady(): boolean {
        if (!this._isMsdfReady && this._msdfEffect && this._msdfEffect.isReady()) {
            this._isMsdfReady = true;
        }
        return this._isMsdfReady;
    }

    /** Gets the number of draw calls issued during the last rendered frame. */
    public get drawCallCount(): number {
        return this._drawCallCount;
    }

    /** Gets the number of sprites submitted during the last rendered frame. */
    public get spriteCount(): number {
        return this._spriteCount;
    }
    /** Reusable single-element array to avoid per-call allocation in renderMaskSprite */
    private _singleSpriteArray: ISprite2DRenderData[] = [];

    /**
     * Renders a single sprite into the stencil buffer using the mask shader.
     * @param sprite - The mask sprite render data.
     * @param alphaThreshold - Alpha cutoff for the stencil discard.
     * @param viewportWidth - Viewport width in pixels.
     * @param viewportHeight - Viewport height in pixels.
     * @param viewProjection - World-to-screen transform.
     * @param cameraWorldPosition - Optional camera world position for parallax.
     * @internal
     */
    public renderMaskSprite(
        sprite: ISprite2DRenderData,
        alphaThreshold: number,
        viewportWidth: number,
        viewportHeight: number,
        viewProjection: Readonly<Matrix2D>,
        cameraWorldPosition?: { x: number; y: number } | null
    ): void {
        this._singleSpriteArray[0] = sprite;
        this.renderMaskSprites(this._singleSpriteArray, alphaThreshold, viewportWidth, viewportHeight, viewProjection, cameraWorldPosition);
        this._singleSpriteArray.length = 0;
    }

    /**
     * Renders one or more sprites into the stencil buffer using the mask shader.
     * @param sprites - Sorted mask sprite render data.
     * @param alphaThreshold - Alpha cutoff for the stencil discard.
     * @param viewportWidth - Viewport width in pixels.
     * @param viewportHeight - Viewport height in pixels.
     * @param viewProjection - World-to-screen transform.
     * @param cameraWorldPosition - Optional camera world position for parallax.
     * @internal
     */
    public renderMaskSprites(
        sprites: ISprite2DRenderData[],
        alphaThreshold: number,
        viewportWidth: number,
        viewportHeight: number,
        viewProjection: Readonly<Matrix2D>,
        cameraWorldPosition?: { x: number; y: number } | null
    ): void {
        this._beginStatsFrame();
        if (!this.isMaskReady || sprites.length === 0) {
            return;
        }

        const engine = this._engine;
        engine.setColorWrite(false);
        engine.setDepthBuffer(false);
        engine.setAlphaMode(Constants.ALPHA_DISABLE);
        engine.setState(false);

        this._prepareRenderContext(viewProjection, null, viewportWidth, viewportHeight, cameraWorldPosition, alphaThreshold);
        this._renderBatches(sprites, true);

        engine.setColorWrite(true);
        engine.setDepthBuffer(false);
    }

    /**
     * Renders a sorted list of sprite render data.
     * @param sprites - Sorted sprite render data.
     * @param viewProjection - Combined world-to-screen matrix from Camera2D.
     * @param lightingManager - Active lighting manager, or null for unlit rendering.
     * @param viewportWidth - Viewport width in pixels.
     * @param viewportHeight - Viewport height in pixels.
     */
    public render(
        sprites: ISprite2DRenderData[],
        viewProjection: Readonly<Matrix2D>,
        lightingManager: LightingManager2D | null,
        viewportWidth: number,
        viewportHeight: number
    ): void {
        this._beginStatsFrame();
        if (!this.isReady || sprites.length === 0) {
            return;
        }

        const engine = this._engine;
        engine.setAlphaMode(Constants.ALPHA_COMBINE);
        engine.setDepthBuffer(false);
        engine.setState(false);

        this._prepareRenderContext(viewProjection, lightingManager, viewportWidth, viewportHeight);
        this._renderBatches(sprites, false);

        engine.setDepthBuffer(true);
        engine.setAlphaMode(Constants.ALPHA_DISABLE);
    }

    /**
     * Flushes a single batch to the GPU.
     * @param sprites - Source sprite array.
     * @param start - Start index of the batch.
     * @param count - Number of sprites in the batch.
     * @param textureSlots - Texture slots assigned for the batch.
     * @param alphaMode - Alpha mode for the batch.
     * @param lit - Whether the batch uses the lit shader variant.
     * @param maskMode - Whether the mask shader variant should be used.
     */
    public flush(
        sprites: ISprite2DRenderData[],
        start: number,
        count: number,
        textureSlots: ThinTexture[],
        alphaMode: number,
        lit: boolean,
        maskMode: boolean,
        msdfMode: boolean,
        msdfScreenPxRange: number
    ): void {
        if (count <= 0) {
            return;
        }

        if (textureSlots !== this._textureSlots) {
            this._syncTextureSlots(textureSlots);
        }

        const useMsdf = msdfMode && this._canUseMsdf(maskMode);
        const useLit = !useMsdf && lit && this._canUseForwardLighting(maskMode);
        if (!maskMode) {
            this._engine.setAlphaMode(alphaMode);
        }

        this._activeMsdfScreenPxRange = msdfScreenPxRange;
        this._bindEffect(useLit, maskMode, useMsdf);

        if (this._useInstancing) {
            this._renderInstancedRange(sprites, start, count);
            this._drawInstanced(count);
        } else {
            this._renderNonInstancedRange(sprites, start, count);
            this._drawNonInstanced(count);
        }

        this._drawCallCount++;
        this._spriteCount += count;
        this._resetTextureSlots();
    }

    private _prepareRenderContext(
        viewProjection: Readonly<Matrix2D>,
        lightingManager: LightingManager2D | null,
        viewportWidth: number,
        viewportHeight: number,
        cameraWorldPosition?: { x: number; y: number } | null,
        maskAlphaThreshold: number = 0
    ): void {
        this._activeViewProjection = viewProjection;
        this._activeLightingManager = lightingManager;
        this._activeMaskAlphaThreshold = maskAlphaThreshold;
        this._updateProjection(viewportWidth, viewportHeight);

        if (cameraWorldPosition) {
            this._cameraWorldX = cameraWorldPosition.x;
            this._cameraWorldY = cameraWorldPosition.y;
        } else {
            this._resolveCameraWorldPosition(viewProjection, viewportWidth, viewportHeight);
        }

        this._cameraWorldPosition.x = this._cameraWorldX;
        this._cameraWorldPosition.y = this._cameraWorldY;
    }

    private _updateProjection(viewportWidth: number, viewportHeight: number): void {
        const p = this._projectionData;
        p[0] = 2.0 / viewportWidth;
        p[1] = 0;
        p[2] = 0;
        p[3] = 0;
        p[4] = 0;
        p[5] = -2.0 / viewportHeight;
        p[6] = 0;
        p[7] = 0;
        p[8] = 0;
        p[9] = 0;
        p[10] = 1;
        p[11] = 0;
        p[12] = -1;
        p[13] = 1;
        p[14] = 0;
        p[15] = 1;
        this._projectionMatrix.updateFlag++;
    }

    private _resolveCameraWorldPosition(viewProjection: Readonly<Matrix2D>, viewportWidth: number, viewportHeight: number): void {
        const matrix = viewProjection.m;
        if (matrix[0] === 1 && matrix[1] === 0 && matrix[2] === 0 && matrix[3] === 1 && matrix[4] === 0 && matrix[5] === 0) {
            this._cameraWorldX = 0;
            this._cameraWorldY = 0;
            return;
        }

        if (!viewProjection.invertToRef(this._inverseViewProjection)) {
            this._cameraWorldX = 0;
            this._cameraWorldY = 0;
            return;
        }

        const inverse = this._inverseViewProjection.m;
        const screenCenterX = viewportWidth * 0.5;
        const screenCenterY = viewportHeight * 0.5;
        this._cameraWorldX = inverse[0] * screenCenterX + inverse[2] * screenCenterY + inverse[4];
        this._cameraWorldY = inverse[1] * screenCenterX + inverse[3] * screenCenterY + inverse[5];
    }

    private _bindEffect(useLit: boolean, maskMode: boolean, msdfMode: boolean): void {
        let effect: Effect;
        let drawWrapper: DrawWrapper;

        if (maskMode) {
            effect = this._maskEffect!;
            drawWrapper = this._maskDrawWrapper!;
        } else if (msdfMode) {
            effect = this._msdfEffect!;
            drawWrapper = this._msdfDrawWrapper!;
        } else if (useLit) {
            effect = this._litEffect!;
            drawWrapper = this._litDrawWrapper!;
        } else {
            effect = this._effect;
            drawWrapper = this._drawWrapper;
        }

        this._activeEffect = effect;
        this._engine.enableEffect(drawWrapper);
        this._applyStates();
        effect.setMatrix("projection", this._projectionMatrix);

        if (maskMode) {
            effect.setFloat("alphaThreshold", this._activeMaskAlphaThreshold);
        } else if (msdfMode) {
            effect.setFloat("screenPxRange", this._activeMsdfScreenPxRange);
        } else if (useLit && this._activeLightingManager) {
            this._activeLightingManager.uploadUniforms(effect, this._cameraWorldPosition);
        }
    }

    private _canUseForwardLighting(maskMode: boolean): boolean {
        return !maskMode && this._activeLightingManager !== null && this._activeLightingManager.mode === LightingMode2D.Forward && this.isLitReady;
    }

    private _canUseMsdf(maskMode: boolean): boolean {
        return !maskMode && this.isMsdfReady;
    }

    private _renderBatches(sprites: ISprite2DRenderData[], maskMode: boolean): void {
        this._resetTextureSlots();

        let batchStart = 0;
        let batchCount = 0;
        let batchAlphaMode = maskMode ? Constants.ALPHA_DISABLE : Constants.ALPHA_COMBINE;
        let batchLit = false;
        let batchMsdf = false;
        let batchMsdfScreenPxRange = 0;

        for (let i = 0; i < sprites.length; i++) {
            const sprite = sprites[i];
            const spriteAlphaMode = maskMode ? Constants.ALPHA_DISABLE : sprite.alphaMode;
            const spriteMsdf = !maskMode && sprite.msdf === true;
            const spriteMsdfScreenPxRange = sprite.msdfScreenPxRange ?? 0;
            const spriteLit = !spriteMsdf && this._canUseForwardLighting(maskMode) && sprite.lit;

            if (batchCount > 0 && (
                spriteAlphaMode !== batchAlphaMode ||
                spriteLit !== batchLit ||
                spriteMsdf !== batchMsdf ||
                (spriteMsdf && spriteMsdfScreenPxRange !== batchMsdfScreenPxRange) ||
                batchCount >= this.maxInstancesPerBatch
            )) {
                this.flush(sprites, batchStart, batchCount, this._textureSlots, batchAlphaMode, batchLit, maskMode, batchMsdf, batchMsdfScreenPxRange);
                batchCount = 0;
            }

            if (batchCount === 0) {
                batchStart = i;
                batchAlphaMode = spriteAlphaMode;
                batchLit = spriteLit;
                batchMsdf = spriteMsdf;
                batchMsdfScreenPxRange = spriteMsdfScreenPxRange;
            }

            if (!this._textureSlotMap.has(sprite.texture) && this._textureSlotCount >= this.maxTexturesPerBatch) {
                this.flush(sprites, batchStart, batchCount, this._textureSlots, batchAlphaMode, batchLit, maskMode, batchMsdf, batchMsdfScreenPxRange);
                batchStart = i;
                batchCount = 0;
                batchAlphaMode = spriteAlphaMode;
                batchLit = spriteLit;
                batchMsdf = spriteMsdf;
                batchMsdfScreenPxRange = spriteMsdfScreenPxRange;
            }

            this._getTextureSlot(sprite.texture);
            batchCount++;
        }

        if (batchCount > 0) {
            this.flush(sprites, batchStart, batchCount, this._textureSlots, batchAlphaMode, batchLit, maskMode, batchMsdf, batchMsdfScreenPxRange);
        }
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
        if (this._maskEffect) {
            this._maskEffect.dispose();
        }
        if (this._litEffect) {
            this._litEffect.dispose();
        }
        if (this._msdfEffect) {
            this._msdfEffect.dispose();
        }
        if (this._litDrawWrapper) {
            this._litDrawWrapper.dispose();
        }
        if (this._maskDrawWrapper) {
            this._maskDrawWrapper.dispose();
        }
        if (this._msdfDrawWrapper) {
            this._msdfDrawWrapper.dispose();
        }
    }

    // -----------------------------------------------------------------------
    // Multi-texture slot management
    // -----------------------------------------------------------------------
    /**
     * Returns the slot index for a texture, assigning a new slot if needed.
     * @param texture - Texture to look up.
     * @returns Assigned texture slot index.
     */
    private _getTextureSlot(texture: ThinTexture): number {
        const existingSlot = this._textureSlotMap.get(texture);
        if (existingSlot !== undefined) {
            return existingSlot;
        }

        const slot = this._textureSlotCount;
        this._textureSlotMap.set(texture, slot);
        this._textureSlots[slot] = texture;
        this._textureSlotCount++;
        return slot;
    }

    private _syncTextureSlots(textureSlots: ThinTexture[]): void {
        this._textureSlotMap.clear();
        this._textureSlotCount = Math.min(textureSlots.length, this.maxTexturesPerBatch);
        for (let i = 0; i < this._textureSlotCount; i++) {
            const texture = textureSlots[i];
            this._textureSlots[i] = texture;
            this._textureSlotMap.set(texture, i);
        }
    }

    private _resetTextureSlots(): void {
        this._textureSlotMap.clear();
        this._textureSlotCount = 0;
    }

    private _activeEffect: Effect = null!;

    private _beginStatsFrame(): void {
        const frameId = this._engine.frameId;
        if (typeof frameId !== "number") {
            if (this._statsFrameId === -1) {
                this._statsFrameId = 0;
                this._drawCallCount = 0;
                this._spriteCount = 0;
            }
            return;
        }

        if (frameId !== this._statsFrameId) {
            this._statsFrameId = frameId;
            this._drawCallCount = 0;
            this._spriteCount = 0;
        }
    }

    private _bindTextures(): void {
        for (let i = 0; i < this._textureSlotCount; i++) {
            this._activeEffect.setTexture(`texture${i}`, this._textureSlots[i]);
        }
        if (this._engine.isWebGPU && this.fallbackTexture) {
            for (let i = this._textureSlotCount; i < _MAX_TEXTURES; i++) {
                this._activeEffect.setTexture(`texture${i}`, this.fallbackTexture);
            }
        }
    }

    private _applyStates(): void {
        const engine = this._engine as AbstractEngine & { applyStates?: () => void };
        engine.applyStates?.();
    }

    // -----------------------------------------------------------------------
    // Instanced render path
    // -----------------------------------------------------------------------
    private _renderInstancedRange(sprites: ISprite2DRenderData[], start: number, count: number): void {
        const cm = this._activeViewProjection.m;
        const stride = SpriteBatchRenderer._FLOATS_PER_INSTANCE;
        const data = this._instanceData;

        for (let i = 0; i < count; i++) {
            const sprite = sprites[start + i];
            const wt = sprite.worldTransform.m;
            const texSlot = this._textureSlotMap.get(sprite.texture) ?? 0;
            const color = sprite.color;
            const packedUvs = sprite.uvs;

            const ca = cm[0] * wt[0] + cm[2] * wt[1];
            const cb = cm[1] * wt[0] + cm[3] * wt[1];
            const cc = cm[0] * wt[2] + cm[2] * wt[3];
            const cd = cm[1] * wt[2] + cm[3] * wt[3];
            let ctx = cm[0] * wt[4] + cm[2] * wt[5] + cm[4];
            let cty = cm[1] * wt[4] + cm[3] * wt[5] + cm[5];

            const sfx = sprite.scrollFactorX ?? 1;
            const sfy = sprite.scrollFactorY ?? 1;
            if (sfx !== 1 || sfy !== 1) {
                const dx = this._cameraWorldX * (1 - sfx);
                const dy = this._cameraWorldY * (1 - sfy);
                ctx += cm[0] * dx + cm[2] * dy;
                cty += cm[1] * dx + cm[3] * dy;
            }

            const localLeft = sprite.localLeft ?? -sprite.width * 0.5;
            const localTop = sprite.localTop ?? -sprite.height * 0.5;
            const localRight = sprite.localRight ?? sprite.width * 0.5;
            const localBottom = sprite.localBottom ?? sprite.height * 0.5;
            const uvOriginU = sprite.uvOriginU ?? packedUvs[0];
            const uvOriginV = sprite.uvOriginV ?? packedUvs[1];
            const uvAxisXU = sprite.uvAxisXU ?? (packedUvs[2] - packedUvs[0]);
            const uvAxisXV = sprite.uvAxisXV ?? 0;
            const uvAxisYU = sprite.uvAxisYU ?? 0;
            const uvAxisYV = sprite.uvAxisYV ?? (packedUvs[3] - packedUvs[1]);

            const off = i * stride;
            data[off] = ca;
            data[off + 1] = cb;
            data[off + 2] = cc;
            data[off + 3] = cd;
            data[off + 4] = ctx;
            data[off + 5] = cty;
            data[off + 6] = localLeft;
            data[off + 7] = localTop;
            data[off + 8] = localRight;
            data[off + 9] = localBottom;
            data[off + 10] = color[0];
            data[off + 11] = color[1];
            data[off + 12] = color[2];
            data[off + 13] = color[3];
            data[off + 14] = uvOriginU;
            data[off + 15] = uvOriginV;
            data[off + 16] = uvAxisXU;
            data[off + 17] = uvAxisXV;
            data[off + 18] = uvAxisYU;
            data[off + 19] = uvAxisYV;
            data[off + 20] = texSlot;
        }
    }

    private _drawInstanced(count: number): void {
        this._bindTextures();
        this._applyStates();
        this._instanceBuffer.updateDirectly(this._instanceData, 0, count);
        this._engine.bindBuffers(this._vertexBuffersMap, null as never, this._activeEffect);
        this._engine.drawArraysType(Constants.MATERIAL_TriangleStripDrawMode, 0, 4, count);
    }

    // -----------------------------------------------------------------------
    // Non-instanced render path (fallback)
    // -----------------------------------------------------------------------

    private _renderNonInstancedRange(sprites: ISprite2DRenderData[], start: number, count: number): void {
        const cm = this._activeViewProjection.m;
        const vd = this._vertexData;

        for (let i = 0; i < count; i++) {
            const sprite = sprites[start + i];
            const wt = sprite.worldTransform.m;
            const texSlot = this._textureSlotMap.get(sprite.texture) ?? 0;
            const color = sprite.color;
            const packedUvs = sprite.uvs;

            const ca = cm[0] * wt[0] + cm[2] * wt[1];
            const cb = cm[1] * wt[0] + cm[3] * wt[1];
            const cc = cm[0] * wt[2] + cm[2] * wt[3];
            const cd = cm[1] * wt[2] + cm[3] * wt[3];
            let ctx = cm[0] * wt[4] + cm[2] * wt[5] + cm[4];
            let cty = cm[1] * wt[4] + cm[3] * wt[5] + cm[5];

            const sfx = sprite.scrollFactorX ?? 1;
            const sfy = sprite.scrollFactorY ?? 1;
            if (sfx !== 1 || sfy !== 1) {
                const dx = this._cameraWorldX * (1 - sfx);
                const dy = this._cameraWorldY * (1 - sfy);
                ctx += cm[0] * dx + cm[2] * dy;
                cty += cm[1] * dx + cm[3] * dy;
            }

            const localLeft = sprite.localLeft ?? -sprite.width * 0.5;
            const localTop = sprite.localTop ?? -sprite.height * 0.5;
            const localRight = sprite.localRight ?? sprite.width * 0.5;
            const localBottom = sprite.localBottom ?? sprite.height * 0.5;
            const uvOriginU = sprite.uvOriginU ?? packedUvs[0];
            const uvOriginV = sprite.uvOriginV ?? packedUvs[1];
            const uvAxisXU = sprite.uvAxisXU ?? (packedUvs[2] - packedUvs[0]);
            const uvAxisXV = sprite.uvAxisXV ?? 0;
            const uvAxisYU = sprite.uvAxisYU ?? 0;
            const uvAxisYV = sprite.uvAxisYV ?? (packedUvs[3] - packedUvs[1]);

            const baseOffset = i * SpriteBatchRenderer._FLOATS_PER_QUAD;
            for (let v = 0; v < 4; v++) {
                const corner = SpriteBatchRenderer._CORNERS[v];
                const off = baseOffset + v * SpriteBatchRenderer._FLOATS_PER_VERTEX;
                vd[off] = corner[0] === 0 ? localLeft : localRight;
                vd[off + 1] = corner[1] === 0 ? localTop : localBottom;
                vd[off + 2] = uvOriginU + uvAxisXU * corner[0] + uvAxisYU * corner[1];
                vd[off + 3] = uvOriginV + uvAxisXV * corner[0] + uvAxisYV * corner[1];
                vd[off + 4] = color[0];
                vd[off + 5] = color[1];
                vd[off + 6] = color[2];
                vd[off + 7] = color[3];
                vd[off + 8] = texSlot;
                vd[off + 9] = 0;
                vd[off + 10] = 0;
                vd[off + 11] = 0;
                vd[off + 12] = ca;
                vd[off + 13] = cb;
                vd[off + 14] = cc;
                vd[off + 15] = cd;
                vd[off + 16] = ctx;
                vd[off + 17] = cty;
            }
        }
    }

    private _drawNonInstanced(count: number): void {
        this._bindTextures();
        this._applyStates();
        this._buffer.updateDirectly(this._vertexData, 0, count * SpriteBatchRenderer._VERTS_PER_QUAD);
        this._engine.bindBuffers(this._vertexBuffersMap, this._indexBuffer, this._activeEffect);
        this._engine.drawElementsType(Constants.MATERIAL_TriangleFillMode, 0, count * SpriteBatchRenderer._INDICES_PER_QUAD);
    }
}



















