import type { AbstractEngine } from "core/Engines/abstractEngine";
import type { Effect } from "core/Materials/effect";
import { Vector2 } from "core/Maths/math.vector";
import { Color4 } from "core/Maths/math.color";

/**
 * Types of 2D lights
 */
export enum LightType2D {
    /**
     * Point light — radiates in all directions from a position
     */
    Point = 0,
    /**
     * Spotlight — a cone-shaped light
     */
    Spot = 1,
    /**
     * Ambient light — uniform light everywhere (no position, no falloff)
     */
    Ambient = 2,
}

/**
 * Lighting rendering mode
 */
export enum LightingMode2D {
    /**
     * Forward: lights computed in the sprite fragment shader (fast, max 16 lights)
     */
    Forward = 0,
    /**
     * Deferred: sprites render to RT, then a fullscreen lighting pass composites
     */
    Deferred = 1,
}

/**
 * Maximum number of lights supported in forward mode.
 * Each light requires 4 uniform vec4s, so 16 lights = 64 vec4s.
 */
export const MAX_FORWARD_LIGHTS = 16;

/**
 * A 2D light source for dynamic lighting effects.
 * Supports point lights, spotlights, and ambient lighting.
 * Light data is packed into GPU uniforms for shader-based rendering.
 */
export class Light2D {
    /**
     * World position of the light
     */
    public position: Vector2 = Vector2.Zero();

    /**
     * Light color and intensity (alpha channel controls intensity)
     */
    public color: Color4 = new Color4(1, 1, 1, 1);

    /**
     * Maximum reach of the light in pixels. Beyond this distance, intensity is zero.
     */
    public radius: number = 200;

    /**
     * Type of light (point, spot, ambient)
     */
    public type: LightType2D = LightType2D.Point;

    /**
     * Intensity multiplier (0-∞). Default: 1
     */
    public intensity: number = 1;

    /**
     * Falloff exponent. Higher values = sharper falloff. Default: 2 (quadratic)
     */
    public falloff: number = 2;

    /**
     * Whether this light is active
     */
    public enabled: boolean = true;

    /**
     * For spotlights: the direction the light points (normalized)
     */
    public direction: Vector2 = new Vector2(0, 1);

    /**
     * For spotlights: the inner cone angle in radians (full intensity)
     */
    public innerAngle: number = Math.PI / 6;

    /**
     * For spotlights: the outer cone angle in radians (fades to zero)
     */
    public outerAngle: number = Math.PI / 4;

    /**
     * Collision layer bitmask — only affects sprites on matching layers
     */
    public layer: number = 0xffffffff;

    /**
     * Creates a new Light2D
     * @param type - The type of light
     * @param position - World position
     * @param color - Light color
     * @param radius - Light radius in pixels
     */
    constructor(type: LightType2D = LightType2D.Point, position: Vector2 = Vector2.Zero(), color: Color4 = new Color4(1, 1, 1, 1), radius: number = 200) {
        this.type = type;
        this.position = position;
        this.color = color;
        this.radius = radius;
    }
}

/**
 * Packed light data for GPU upload.
 * Each light is encoded into 4 vec4 uniforms:
 * - lightData[i*4+0]: (posX, posY, radius, type)
 * - lightData[i*4+1]: (colorR, colorG, colorB, intensity)
 * - lightData[i*4+2]: (dirX, dirY, innerAngle, outerAngle)
 * - lightData[i*4+3]: (falloff, 0, 0, 0)
 */
const _FLOATS_PER_LIGHT = 16; // 4 vec4s

/**
 * Manages a collection of 2D lights and uploads their data to GPU uniforms.
 * Supports two rendering modes:
 * - **Forward**: light calculations happen in the sprite fragment shader (max 16 lights)
 * - **Deferred**: sprites render to a render target, then a fullscreen lighting pass composites
 */
export class LightingManager2D {
    /**
     * Ambient light color applied to everything. Default: dark gray
     */
    public ambientColor: Color4 = new Color4(0.2, 0.2, 0.2, 1);

    /**
     * Lighting rendering mode
     */
    public mode: LightingMode2D = LightingMode2D.Forward;

    private _lights: Light2D[] = [];

    /**
     * Pre-allocated float array for light uniform data (max 16 lights × 16 floats)
     */
    private _lightUniformData: Float32Array = new Float32Array(MAX_FORWARD_LIGHTS * _FLOATS_PER_LIGHT);

    /**
     * Number of active lights packed into the uniform data
     */
    private _activeLightCount: number = 0;

    /**
     * All lights in the scene
     */
    public get lights(): readonly Light2D[] {
        return this._lights;
    }

    /**
     * Number of active (enabled) lights, clamped to MAX_FORWARD_LIGHTS in forward mode
     */
    public get activeLightCount(): number {
        return this._activeLightCount;
    }

    /**
     * Adds a light to the manager
     * @param light - The light to add
     */
    public addLight(light: Light2D): void {
        this._lights.push(light);
    }

    /**
     * Removes a light from the manager
     * @param light - The light to remove
     */
    public removeLight(light: Light2D): void {
        const idx = this._lights.indexOf(light);
        if (idx !== -1) {
            this._lights.splice(idx, 1);
        }
    }

    /**
     * Creates a point light and adds it to the manager
     * @param x - World X position
     * @param y - World Y position
     * @param color - Light color
     * @param radius - Light radius
     * @returns The created light
     */
    public createPointLight(x: number, y: number, color: Color4 = new Color4(1, 1, 1, 1), radius: number = 200): Light2D {
        const light = new Light2D(LightType2D.Point, new Vector2(x, y), color, radius);
        this.addLight(light);
        return light;
    }

    /**
     * Creates a spotlight and adds it to the manager
     * @param x - World X position
     * @param y - World Y position
     * @param direction - Light direction
     * @param color - Light color
     * @param radius - Light radius
     * @param innerAngle - Inner cone angle in radians
     * @param outerAngle - Outer cone angle in radians
     * @returns The created light
     */
    public createSpotLight(
        x: number,
        y: number,
        direction: Vector2,
        color: Color4 = new Color4(1, 1, 1, 1),
        radius: number = 300,
        innerAngle: number = Math.PI / 6,
        outerAngle: number = Math.PI / 4
    ): Light2D {
        const light = new Light2D(LightType2D.Spot, new Vector2(x, y), color, radius);
        light.direction = direction;
        light.innerAngle = innerAngle;
        light.outerAngle = outerAngle;
        this.addLight(light);
        return light;
    }

    /**
     * Packs enabled light data into a float array for GPU upload.
     * Call this once per frame before rendering.
     * @param cameraM - Optional 3x2 camera view matrix (Float32Array of 6 elements).
     *                  When provided, light positions are transformed to view space.
     * @returns The number of active lights packed
     */
    public packLightUniforms(cameraM?: Float32Array): number {
        const data = this._lightUniformData;
        let count = 0;
        const maxLights = MAX_FORWARD_LIGHTS;

        for (let i = 0; i < this._lights.length && count < maxLights; i++) {
            const light = this._lights[i];
            if (!light.enabled) {
                continue;
            }

            const offset = count * _FLOATS_PER_LIGHT;

            // Transform position to view space if camera provided
            let px = light.position.x;
            let py = light.position.y;
            if (cameraM) {
                px = cameraM[0] * light.position.x + cameraM[2] * light.position.y + cameraM[4];
                py = cameraM[1] * light.position.x + cameraM[3] * light.position.y + cameraM[5];
            }

            // vec4 0: (posX, posY, radius, type)
            data[offset] = px;
            data[offset + 1] = py;
            data[offset + 2] = light.radius;
            data[offset + 3] = light.type;

            // vec4 1: (colorR, colorG, colorB, intensity)
            data[offset + 4] = light.color.r;
            data[offset + 5] = light.color.g;
            data[offset + 6] = light.color.b;
            data[offset + 7] = light.intensity;

            // vec4 2: (dirX, dirY, innerAngle, outerAngle) — direction also needs rotation
            let dx = light.direction.x;
            let dy = light.direction.y;
            if (cameraM) {
                // Transform direction (rotation only, no translation)
                dx = cameraM[0] * light.direction.x + cameraM[2] * light.direction.y;
                dy = cameraM[1] * light.direction.x + cameraM[3] * light.direction.y;
            }
            data[offset + 8] = dx;
            data[offset + 9] = dy;
            data[offset + 10] = light.innerAngle;
            data[offset + 11] = light.outerAngle;

            // vec4 3: (falloff, 0, 0, 0)
            data[offset + 12] = light.falloff;
            data[offset + 13] = 0;
            data[offset + 14] = 0;
            data[offset + 15] = 0;

            count++;
        }

        this._activeLightCount = count;
        return count;
    }

    /**
     * Binds light uniform data to an Effect for forward rendering.
     * Must call packLightUniforms() first.
     * @param effect - The shader effect to bind uniforms to
     */
    public bindToEffect(effect: Effect): void {
        effect.setInt("lightCount", this._activeLightCount);
        effect.setFloat4("ambientLight", this.ambientColor.r, this.ambientColor.g, this.ambientColor.b, this.ambientColor.a);

        if (this._activeLightCount > 0) {
            effect.setArray4("lightData", Array.from(this._lightUniformData.subarray(0, this._activeLightCount * _FLOATS_PER_LIGHT)));
        }
    }

    /**
     * Removes all lights
     */
    public clear(): void {
        this._lights.length = 0;
        this._activeLightCount = 0;
    }

    /**
     * Disposes the lighting manager
     */
    public dispose(): void {
        this.clear();
    }
}
