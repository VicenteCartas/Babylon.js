import { Vector2 } from "core/Maths/math.vector";

import type { Node2D } from "../Node2D/node2D";
import type { IRaycastHit2D } from "../Collision/collisionShapes";

/**
 * Body type for 2D physics bodies
 */
export enum PhysicsBodyType2D {
    /**
     * Static bodies do not move and are not affected by forces (e.g., terrain, walls)
     */
    Static = 0,
    /**
     * Dynamic bodies are fully simulated (affected by gravity, forces, collisions)
     */
    Dynamic = 1,
    /**
     * Kinematic bodies move by setting velocity directly, not affected by forces
     */
    Kinematic = 2,
}

/**
 * Shape definition for creating physics bodies
 */
export type PhysicsShape2DOptions =
    | { type: "box"; width: number; height: number }
    | { type: "circle"; radius: number }
    | { type: "polygon"; vertices: Vector2[] };

/**
 * Options for creating a 2D physics body
 */
export interface IPhysicsBody2DOptions {
    /**
     * Body type (static, dynamic, kinematic)
     */
    bodyType: PhysicsBodyType2D;
    /**
     * Collision shape
     */
    shape: PhysicsShape2DOptions;
    /**
     * Density (affects mass). Default: 1
     */
    density?: number;
    /**
     * Friction coefficient (0-1). Default: 0.3
     */
    friction?: number;
    /**
     * Restitution/bounciness (0-1). Default: 0
     */
    restitution?: number;
    /**
     * Whether this is a sensor (detects overlap but doesn't collide). Default: false
     */
    isSensor?: boolean;
    /**
     * Whether to prevent rotation. Default: false
     */
    fixedRotation?: boolean;
    /**
     * Collision layer bitmask. Default: 1
     */
    layer?: number;
    /**
     * Collision mask bitmask. Default: 0xFFFFFFFF
     */
    mask?: number;
}

/**
 * Handle to a physics body in the simulation.
 * Returned by IPhysicsEngine2D.addBody().
 */
export interface IPhysicsBody2D {
    /**
     * The Node2D this body is attached to
     */
    readonly node: Node2D;
    /**
     * The body type (static, dynamic, kinematic)
     */
    readonly bodyType: PhysicsBodyType2D;
    /**
     * The shape options used to create this body (for debug rendering)
     */
    readonly shapeOptions: PhysicsShape2DOptions;
    /**
     * Sets the linear velocity
     * @param velocity - Velocity in pixels/second
     */
    setLinearVelocity(velocity: Vector2): void;
    /**
     * Gets the current linear velocity
     * @returns Velocity in pixels/second
     */
    getLinearVelocity(): Vector2;
    /**
     * Applies a force at the body's center of mass
     * @param force - Force vector
     */
    applyForce(force: Vector2): void;
    /**
     * Applies an impulse at the body's center of mass
     * @param impulse - Impulse vector
     */
    applyImpulse(impulse: Vector2): void;
    /**
     * Gets the body's mass
     * @returns Mass in kg
     */
    getMass(): number;
}

/**
 * Callback for physics collision events
 */
export type PhysicsContactCallback = (bodyA: IPhysicsBody2D, bodyB: IPhysicsBody2D) => void;

/**
 * Plugin interface for 2D physics engines.
 * Mirrors the pattern of Babylon's 3D physics (IPhysicsEngine with Havok/Ammo backends).
 * Default implementation: PlanckPhysicsEngine (Planck.js).
 */
export interface IPhysicsEngine2D {
    /**
     * Sets the gravity vector
     * @param gravity - Gravity in pixels/second^2 (e.g., new Vector2(0, 980) for Y-down)
     */
    setGravity(gravity: Vector2): void;
    /**
     * Gets the current gravity vector
     * @returns Gravity vector
     */
    getGravity(): Vector2;
    /**
     * Adds a physics body to the simulation attached to a Node2D
     * @param node - The node to attach the body to
     * @param options - Body configuration
     * @returns A handle to the created body
     */
    addBody(node: Node2D, options: IPhysicsBody2DOptions): IPhysicsBody2D;
    /**
     * Removes a physics body from the simulation
     * @param body - The body to remove
     */
    removeBody(body: IPhysicsBody2D): void;
    /**
     * Steps the physics simulation
     * @param deltaTime - Time step in seconds
     */
    step(deltaTime: number): void;
    /**
     * Casts a ray and returns the closest hit
     * @param origin - Ray origin in world pixels
     * @param direction - Ray direction (will be normalized)
     * @param maxDistance - Maximum distance in pixels
     * @param mask - Collision mask filter
     * @returns The closest hit, or null
     */
    raycast(origin: Vector2, direction: Vector2, maxDistance: number, mask?: number): IRaycastHit2D | null;
    /**
     * Registers a callback for when two bodies begin contact
     * @param callback - The callback function
     */
    onBeginContact(callback: PhysicsContactCallback): void;
    /**
     * Registers a callback for when two bodies end contact
     * @param callback - The callback function
     */
    onEndContact(callback: PhysicsContactCallback): void;
    /**
     * Disposes the physics engine and all bodies
     */
    dispose(): void;
    /**
     * Gets all physics bodies currently in the simulation.
     * Primarily used for debug rendering.
     * @returns An array of all physics bodies
     */
    getAllBodies(): IPhysicsBody2D[];
}
