import type { AbstractEngine } from "core/Engines/abstractEngine";
import type { Effect } from "core/Materials/effect";
import { Color4 } from "core/Maths/math.color";
import { Vector2 } from "core/Maths/math.vector";

/**
 * Types of 2D lights.
 */
export enum LightType2D {
    /**
     * Point light — radiates in all directions from a position.
     */
    Point = 0,
    /**
     * Spotlight — a cone-shaped light.
     */
    Spot = 1,
    /**
     * Ambient light — uniform light everywhere (no position, no falloff).
     */
    Ambient = 2,
}

/**
 * Lighting rendering mode.
 */
export enum LightingMode2D {
    /**
     * Forward: lights computed in the sprite fragment shader.
     */
    Forward = 0,
    /**
     * Deferred: reserved for a future fullscreen lighting pass.
     */
    Deferred = 1,
}

/**
 * Maximum number of lights supported in forward mode.
 */
export const MAX_FORWARD_LIGHTS = 16;

const _FLOATS_PER_LIGHT = 16;
const _DEFAULT_LIGHT_RADIUS = 200;
const _DEFAULT_SPOT_CONE_ANGLE = Math.PI / 6;
const _DEFAULT_SPOT_DIRECTION_X = 1;
const _DEFAULT_SPOT_DIRECTION_Y = 0;
const _DEFAULT_Z_HEIGHT = 50;

function _clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

/**
 * A dynamic 2D light source.
 */
export class Light2D {
    /**
     * World-space position (Y-down, pixels). Ignored for ambient lights.
     */
    public position: Vector2;

    /**
     * Light color. Alpha is not used for brightness.
     */
    public color: Color4;

    /**
     * Maximum radius in pixels. Ignored for ambient lights.
     */
    public radius: number;

    /**
     * Light type.
     */
    public type: LightType2D;

    /**
     * Brightness multiplier [0..∞].
     */
    public intensity: number;

    /**
     * Falloff exponent. Ignored for ambient lights.
     */
    public falloff: number;

    /**
     * Whether the light is active.
     */
    public enabled: boolean;

    /**
     * Compatibility layer bitmask retained for backward compatibility.
     */
    public layer: number;

    /**
     * Z-height of the light above the sprite plane.
     */
    public zHeight: number;

    private _spotAngle: number;
    private _spotConeAngle: number;
    private _spotSoftness: number;
    private _direction: Vector2;
    private _innerAngle: number;
    private _outerAngle: number;

    /**
     * Direction of the spotlight cone in radians.
     */
    public get spotAngle(): number {
        return this._spotAngle;
    }

    public set spotAngle(value: number) {
        this._spotAngle = value;
        this._syncDirectionFromAngle();
    }

    /**
     * Half-angle of the spot cone in radians.
     */
    public get spotConeAngle(): number {
        return this._spotConeAngle;
    }

    public set spotConeAngle(value: number) {
        this._spotConeAngle = value;
        this._outerAngle = value;
        this._innerAngle = value * (1 - this._spotSoftness);
    }

    /**
     * Softness of the spot cone edge [0..1].
     */
    public get spotSoftness(): number {
        return this._spotSoftness;
    }

    public set spotSoftness(value: number) {
        this._spotSoftness = _clamp01(value);
        this._innerAngle = this._outerAngle * (1 - this._spotSoftness);
        this._spotConeAngle = this._outerAngle;
    }

    /**
     * Backward-compatible spotlight direction vector.
     */
    public get direction(): Vector2 {
        return this._direction;
    }

    public set direction(value: Vector2) {
        this._direction.copyFrom(value);
        this._spotAngle = Math.atan2(value.y, value.x);
    }

    /**
     * Backward-compatible inner spotlight angle.
     */
    public get innerAngle(): number {
        return this._innerAngle;
    }

    public set innerAngle(value: number) {
        this._innerAngle = value;
        this._spotSoftness = this._outerAngle > 0 ? _clamp01(1 - value / this._outerAngle) : 0;
    }

    /**
     * Backward-compatible outer spotlight angle.
     */
    public get outerAngle(): number {
        return this._outerAngle;
    }

    public set outerAngle(value: number) {
        this._outerAngle = value;
        this._spotConeAngle = value;
        this._spotSoftness = value > 0 ? _clamp01(1 - this._innerAngle / value) : 0;
    }

    /**
     * Creates a new light.
     * @param type - Optional light type.
     * @param position - Optional initial world position.
     * @param color - Optional initial light color.
     * @param radius - Optional initial light radius.
     */
    constructor(
        type: LightType2D = LightType2D.Point,
        position: Vector2 = Vector2.Zero(),
        color: Color4 = new Color4(1, 1, 1, 1),
        radius: number = _DEFAULT_LIGHT_RADIUS
    ) {
        this.position = position;
        this.color = color;
        this.radius = radius;
        this.type = type;
        this.intensity = 1;
        this.falloff = 2;
        this.enabled = true;
        this.layer = 0xffffffff;
        this.zHeight = _DEFAULT_Z_HEIGHT;
        this._spotAngle = 0;
        this._spotConeAngle = _DEFAULT_SPOT_CONE_ANGLE;
        this._spotSoftness = 0;
        this._direction = new Vector2(_DEFAULT_SPOT_DIRECTION_X, _DEFAULT_SPOT_DIRECTION_Y);
        this._innerAngle = _DEFAULT_SPOT_CONE_ANGLE;
        this._outerAngle = _DEFAULT_SPOT_CONE_ANGLE;
        this._syncDirectionFromAngle();
    }

    /**
     * Disposes the light.
     * @returns Nothing.
     */
    public dispose(): void {
        // No GPU resources are owned by individual lights today.
    }

    private _syncDirectionFromAngle(): void {
        this._direction.x = Math.cos(this._spotAngle);
        this._direction.y = Math.sin(this._spotAngle);
    }
}

/**
 * Manages a collection of Light2D instances and uploads their data to the GPU.
 */
export class LightingManager2D {
    /**
     * Rendering mode.
     */
    public mode: LightingMode2D;

    /**
     * Ambient light color applied when no ambient light exists.
     */
    public ambientColor: Color4;

    /**
     * Darkening factor applied to unlit areas [0..1].
     */
    public get shadowStrength(): number {
        return this._shadowStrength;
    }

    public set shadowStrength(value: number) {
        this._shadowStrength = _clamp01(value);
    }

    private _activeLightCount: number;
    private _lightDataArray: Float32Array;
    private _lights: Light2D[];
    private _lightRegistrationOrder: Map<Light2D, number>;
    private _nextLightRegistrationOrder: number;
    private _shadowStrength: number;
    private _sortedLights: Light2D[];

    /**
     * All registered lights.
     */
    public get lights(): ReadonlyArray<Light2D> {
        return this._lights;
    }

    /**
     * Number of active lights selected for forward rendering.
     */
    public get activeLightCount(): number {
        return this._activeLightCount;
    }

    /**
     * Creates a new lighting manager.
     * @param engine - Optional engine reference retained for future GPU resource ownership.
     */
    constructor(engine?: AbstractEngine) {
        void engine;
        this.mode = LightingMode2D.Forward;
        this.ambientColor = new Color4(0, 0, 0, 1);
        this.shadowStrength = 0;
        this._activeLightCount = 0;
        this._lightDataArray = new Float32Array(MAX_FORWARD_LIGHTS * _FLOATS_PER_LIGHT);
        this._lights = [];
        this._lightRegistrationOrder = new Map();
        this._nextLightRegistrationOrder = 0;
        this._shadowStrength = 0;
        this._sortedLights = [];
    }

    /**
     * Registers a light.
     * @param light - The light to register.
     * @returns Nothing.
     */
    public addLight(light: Light2D): void {
        if (this._lights.indexOf(light) !== -1) {
            return;
        }

        this._lights.push(light);
        this._lightRegistrationOrder.set(light, this._nextLightRegistrationOrder++);
    }

    /**
     * Removes a light.
     * @param light - The light to remove.
     * @returns Nothing.
     */
    public removeLight(light: Light2D): void {
        const index = this._lights.indexOf(light);
        if (index === -1) {
            return;
        }

        this._lights.splice(index, 1);
        this._lightRegistrationOrder.delete(light);
    }

    /**
     * Uploads spec-aligned light uniforms to an effect.
     * @param effect - The effect receiving the uniform data.
     * @param cameraPosition - Camera center in world space for light prioritization.
     * @returns Nothing.
     */
    public uploadUniforms(effect: Effect, cameraPosition: Vector2): void {
        const selectedLights = this._selectLights(cameraPosition);
        const data = this._lightDataArray;
        data.fill(0);

        let count = 0;
        for (let i = 0; i < selectedLights.length && count < MAX_FORWARD_LIGHTS; i++) {
            const light = selectedLights[i];
            const offset = count * _FLOATS_PER_LIGHT;

            data[offset] = light.position.x;
            data[offset + 1] = light.position.y;
            data[offset + 2] = light.radius;
            data[offset + 3] = light.type;

            data[offset + 4] = light.color.r;
            data[offset + 5] = light.color.g;
            data[offset + 6] = light.color.b;
            data[offset + 7] = light.intensity;

            data[offset + 8] = light.falloff;
            data[offset + 9] = light.spotAngle;
            data[offset + 10] = light.spotConeAngle;
            data[offset + 11] = light.spotSoftness;

            data[offset + 12] = light.zHeight;
            data[offset + 13] = 0;
            data[offset + 14] = 0;
            data[offset + 15] = 0;
            count++;
        }

        this._activeLightCount = count;
        effect.setInt("activeLightCount", count);
        effect.setFloat3("ambientColor", this.ambientColor.r, this.ambientColor.g, this.ambientColor.b);
        effect.setFloat("shadowStrength", this.shadowStrength);
        effect.setFloatArray("lightData", data);
    }

    /**
     * Creates and registers a point light.
     * @param x - World X position.
     * @param y - World Y position.
     * @param color - Optional light color.
     * @param radius - Optional light radius.
     * @returns The created light.
     */
    public createPointLight(x: number, y: number, color: Color4 = new Color4(1, 1, 1, 1), radius: number = _DEFAULT_LIGHT_RADIUS): Light2D {
        const light = new Light2D(LightType2D.Point, new Vector2(x, y), color, radius);
        this.addLight(light);
        return light;
    }

    /**
     * Creates and registers a spotlight.
     * @param x - World X position.
     * @param y - World Y position.
     * @param direction - Spotlight direction vector.
     * @param color - Optional light color.
     * @param radius - Optional light radius.
     * @param innerAngle - Optional inner cone angle.
     * @param outerAngle - Optional outer cone angle.
     * @returns The created light.
     */
    public createSpotLight(
        x: number,
        y: number,
        direction: Vector2,
        color: Color4 = new Color4(1, 1, 1, 1),
        radius: number = 300,
        innerAngle: number = _DEFAULT_SPOT_CONE_ANGLE,
        outerAngle: number = _DEFAULT_SPOT_CONE_ANGLE
    ): Light2D {
        const light = new Light2D(LightType2D.Spot, new Vector2(x, y), color, radius);
        light.direction = direction;
        light.innerAngle = innerAngle;
        light.outerAngle = outerAngle;
        this.addLight(light);
        return light;
    }

    /**
     * Removes all registered lights.
     * @returns Nothing.
     */
    public clear(): void {
        this._lights.length = 0;
        this._lightRegistrationOrder.clear();
        this._nextLightRegistrationOrder = 0;
        this._sortedLights.length = 0;
        this._activeLightCount = 0;
        this._lightDataArray.fill(0);
    }

    /**
     * Disposes the manager.
     * @returns Nothing.
     */
    public dispose(): void {
        this.clear();
    }

    private _selectLights(cameraPosition?: Vector2): Light2D[] {
        const sortedLights = this._sortedLights;
        sortedLights.length = 0;

        for (let i = 0; i < this._lights.length; i++) {
            const light = this._lights[i];
            if (!light.enabled) {
                continue;
            }

            sortedLights.push(light);
        }

        if (sortedLights.length <= MAX_FORWARD_LIGHTS) {
            return sortedLights;
        }

        sortedLights.sort((left, right) => {
            const leftDistance = this._getPriorityDistanceSquared(left, cameraPosition);
            const rightDistance = this._getPriorityDistanceSquared(right, cameraPosition);
            if (leftDistance !== rightDistance) {
                return leftDistance - rightDistance;
            }

            if (left.intensity !== right.intensity) {
                return right.intensity - left.intensity;
            }

            return this._getLightRegistrationOrder(left) - this._getLightRegistrationOrder(right);
        });

        return sortedLights;
    }

    private _getLightRegistrationOrder(light: Light2D): number {
        return this._lightRegistrationOrder.get(light) ?? Number.MAX_SAFE_INTEGER;
    }

    private _getPriorityDistanceSquared(light: Light2D, cameraPosition?: Vector2): number {
        if (light.type === LightType2D.Ambient || !cameraPosition) {
            return 0;
        }

        const dx = light.position.x - cameraPosition.x;
        const dy = light.position.y - cameraPosition.y;
        return dx * dx + dy * dy;
    }
}
