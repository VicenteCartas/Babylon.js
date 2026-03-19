import type { Observable } from "core/Misc/observable";
import { Vector2 } from "core/Maths/math.vector";

import type { IRaycastHit2D } from "../Collision/collisionShapes";
import type { Rectangle2D } from "../Math/rectangle2D";
import type { Node2D } from "../Node2D/node2D";

/**
 * Body type for 2D physics bodies.
 */
export enum PhysicsBodyType2D {
    /**
     * Static bodies do not move and are not affected by forces.
     */
    Static = 0,
    /**
     * Dynamic bodies are fully simulated.
     */
    Dynamic = 1,
    /**
     * Kinematic bodies move via velocity and are not affected by gravity.
     */
    Kinematic = 2,
}

/**
 * Supported joint types for 2D physics bodies.
 */
export enum PhysicsJointType2D {
    /**
     * Maintains a fixed distance between two anchor points.
     */
    Distance = 0,
    /**
     * Constrains two bodies around a pivot point.
     */
    Revolute = 1,
    /**
     * Constrains motion along an axis.
     */
    Prismatic = 2,
    /**
     * Fuses two bodies together.
     */
    Weld = 3,
    /**
     * Limits the maximum distance between two bodies.
     */
    Rope = 4,
    /**
     * Simulates a wheel suspension joint.
     */
    Wheel = 5,
}

/**
 * Allowed one-way platform directions.
 */
export type OneWayDirection2D = "up" | "down" | "left" | "right";

/**
 * Shape definition for creating physics bodies.
 */
export type PhysicsShape2DOptions =
    | { type: "box"; width: number; height: number; angle?: number }
    | { type: "circle"; radius: number }
    | { type: "polygon"; vertices: Vector2[] }
    | { type: "capsule"; width: number; height: number }
    | { type: "edge"; v1: Vector2; v2: Vector2; ghost?: boolean };

/**
 * Options for creating a 2D physics body.
 */
export interface IPhysicsBody2DOptions {
    /**
     * Body type (static, dynamic, kinematic).
     */
    bodyType: PhysicsBodyType2D;
    /**
     * Collision shape definition.
     */
    shape: PhysicsShape2DOptions;
    /**
     * Density affecting the computed mass. Default: 1.
     */
    density?: number;
    /**
     * Friction coefficient. Default: 0.3.
     */
    friction?: number;
    /**
     * Restitution / bounciness. Default: 0.
     */
    restitution?: number;
    /**
     * Whether the body acts as a sensor. Default: false.
     */
    isSensor?: boolean;
    /**
     * Whether the body should be prevented from rotating. Default: false.
     */
    fixedRotation?: boolean;
    /**
     * Collision layer bitmask. Default: 1.
     */
    layer?: number;
    /**
     * Collision mask bitmask. Default: 0xFFFF.
     */
    mask?: number;
    /**
     * Initial linear velocity in pixels per second.
     */
    linearVelocity?: Vector2;
    /**
     * Initial angular velocity in radians per second.
     */
    angularVelocity?: number;
    /**
     * Linear damping. Default: 0.
     */
    linearDamping?: number;
    /**
     * Angular damping. Default: 0.
     */
    angularDamping?: number;
    /**
     * Enables one-way platform behavior. Default: false.
     */
    isOneWayPlatform?: boolean;
    /**
     * The blocking direction for a one-way platform. Default: "up".
     */
    oneWayDirection?: OneWayDirection2D;
}

/**
 * Collision event payload emitted by physics bodies.
 */
export interface ICollisionEvent2D {
    /**
     * The other body involved in the collision.
     */
    readonly other: IPhysicsBody2D;
    /**
     * Contact points valid only for the callback frame.
     */
    readonly contactPoints: ReadonlyArray<Vector2>;
    /**
     * Contact normal pointing from the other body into this body.
     */
    readonly normal: Vector2;
    /**
     * Relative impact speed in pixels per second.
     */
    readonly impactSpeed: number;
}

/**
 * Sensor overlap event payload emitted by physics bodies.
 */
export interface ISensorEvent2D {
    /**
     * The other body involved in the overlap.
     */
    readonly other: IPhysicsBody2D;
}

/**
 * Joint creation options.
 */
export interface IPhysicsJoint2DOptions {
    /**
     * The joint type to create.
     */
    type: PhysicsJointType2D;
    /**
     * The first connected body.
     */
    bodyA: IPhysicsBody2D;
    /**
     * The second connected body.
     */
    bodyB: IPhysicsBody2D;
    /**
     * Local-space anchor on body A. Default: body center.
     */
    anchorA?: Vector2;
    /**
     * Local-space anchor on body B. Default: body center.
     */
    anchorB?: Vector2;
    /**
     * Whether connected bodies can collide. Default: false.
     */
    collideConnected?: boolean;
    /**
     * Target length for distance and rope joints.
     */
    length?: number;
    /**
     * Softness frequency for spring-style joints.
     */
    frequencyHz?: number;
    /**
     * Spring damping ratio.
     */
    dampingRatio?: number;
    /**
     * Enables joint limits for supported joint types.
     */
    enableLimit?: boolean;
    /**
     * Lower angle limit in radians for revolute joints.
     * Lower translation limit in pixels for prismatic joints.
     */
    lowerAngle?: number;
    /**
     * Upper angle limit in radians for revolute joints.
     * Upper translation limit in pixels for prismatic joints.
     */
    upperAngle?: number;
    /**
     * Enables a motor for supported joint types.
     */
    enableMotor?: boolean;
    /**
     * Motor speed in radians or units per second, depending on joint type.
     */
    motorSpeed?: number;
    /**
     * Maximum motor torque for revolute and wheel joints.
     */
    maxMotorTorque?: number;
    /**
     * Local axis direction for prismatic and wheel joints. Default: (1, 0).
     */
    axis?: Vector2;
}

/**
 * Handle to an active 2D physics joint.
 */
export interface IPhysicsJoint2D {
    /**
     * The joint type.
     */
    readonly type: PhysicsJointType2D;
    /**
     * The first connected body.
     */
    readonly bodyA: IPhysicsBody2D;
    /**
     * The second connected body.
     */
    readonly bodyB: IPhysicsBody2D;
    /**
     * Whether the joint is still active.
     */
    readonly isActive: boolean;
    /**
     * Motor speed for supported joint types.
     */
    motorSpeed?: number;
    /**
     * Disposes the joint and removes it from the simulation.
     * @returns Nothing.
     */
    dispose(): void;
}

/**
 * Handle to a physics body in the simulation.
 * Returned by {@link IPhysicsEngine2D.addBody}.
 */
export interface IPhysicsBody2D {
    /**
     * The Node2D this body is attached to.
     */
    readonly node: Node2D;
    /**
     * Gets or sets the linear velocity in pixels per second.
     */
    linearVelocity: Vector2;
    /**
     * Gets or sets the angular velocity in radians per second.
     */
    angularVelocity: number;
    /**
     * Gets or sets the body world position in pixels.
     */
    position: Vector2;
    /**
     * Gets or sets the body world rotation in radians.
     */
    rotation: number;
    /**
     * The computed body mass.
     */
    readonly mass: number;
    /**
     * Whether the body is currently sleeping.
     */
    readonly isSleeping: boolean;
    /**
     * Fires when this body begins touching another non-sensor body.
     */
    readonly onCollisionBegin: Observable<ICollisionEvent2D>;
    /**
     * Fires when this body stops touching another non-sensor body.
     */
    readonly onCollisionEnd: Observable<ICollisionEvent2D>;
    /**
     * Fires when this body begins overlapping a sensor interaction.
     */
    readonly onSensorBegin: Observable<ISensorEvent2D>;
    /**
     * Fires when this body ends overlapping a sensor interaction.
     */
    readonly onSensorEnd: Observable<ISensorEvent2D>;
    /**
     * Applies a world-space force at the body's center.
     * @param force - The force vector.
     * @returns Nothing.
     */
    applyForce(force: Vector2): void;
    /**
     * Applies a world-space force at a world-space point.
     * @param force - The force vector.
     * @param worldPoint - The world-space application point.
     * @returns Nothing.
     */
    applyForceAtPoint(force: Vector2, worldPoint: Vector2): void;
    /**
     * Applies an impulse at the body's center.
     * @param impulse - The impulse vector.
     * @returns Nothing.
     */
    applyImpulse(impulse: Vector2): void;
    /**
     * Applies torque to the body.
     * @param torque - The torque value.
     * @returns Nothing.
     */
    applyTorque(torque: number): void;
    /**
     * Wakes the body if it is sleeping.
     * @returns Nothing.
     */
    wakeUp(): void;
    /**
     * Changes the body type at runtime.
     * @param type - The new body type.
     * @returns Nothing.
     */
    setBodyType(type: PhysicsBodyType2D): void;
    /**
     * Enables or disables sensor behavior for all fixtures on the body.
     * @param isSensor - Whether fixtures should behave as sensors.
     * @returns Nothing.
     */
    setSensor(isSensor: boolean): void;
    /**
     * Updates the body's collision layer and mask.
     * @param layer - The collision layer bitmask.
     * @param mask - The collision mask bitmask.
     * @returns Nothing.
     */
    setCollisionFilter(layer: number, mask: number): void;
    /**
     * Enables or disables one-way platform behavior for the body.
     * @param enabled - Whether one-way behavior should be enabled.
     * @param direction - The one-way blocking direction.
     * @returns Nothing.
     */
    setOneWayPlatform(enabled: boolean, direction?: OneWayDirection2D): void;
    /**
     * Disposes the body and removes it from the simulation.
     * @returns Nothing.
     */
    dispose(): void;
}

/**
 * Plugin interface for 2D physics engines.
 */
export interface IPhysicsEngine2D {
    /**
     * Gets or sets gravity in pixels per second squared.
     */
    gravity: Vector2;
    /**
     * Adds a physics body attached to a Node2D.
     * @param node - The node to drive from simulation.
     * @param options - The body configuration.
     * @returns The created body wrapper.
     */
    addBody(node: Node2D, options: IPhysicsBody2DOptions): IPhysicsBody2D;
    /**
     * Removes a physics body from the simulation.
     * @param body - The body to remove.
     * @returns Nothing.
     */
    removeBody(body: IPhysicsBody2D): void;
    /**
     * Adds a joint connecting two bodies.
     * @param options - The joint configuration.
     * @returns The created joint wrapper.
     */
    addJoint(options: IPhysicsJoint2DOptions): IPhysicsJoint2D;
    /**
     * Removes a joint from the simulation.
     * @param joint - The joint to remove.
     * @returns Nothing.
     */
    removeJoint(joint: IPhysicsJoint2D): void;
    /**
     * Casts a ray and returns all hits sorted by distance.
     * @param origin - Ray origin in world pixels.
     * @param direction - Ray direction.
     * @param maxDistance - Maximum ray distance in pixels.
     * @param layerMask - Optional collision layer filter.
     * @returns Raycast hits sorted nearest-first.
     */
    raycast(origin: Vector2, direction: Vector2, maxDistance: number, layerMask?: number): IRaycastHit2D[];
    /**
     * Returns bodies overlapping a rectangle.
     * @param rect - The rectangle in world pixels.
     * @param layerMask - Optional collision layer filter.
     * @returns Overlapping bodies.
     */
    overlapRect(rect: Rectangle2D, layerMask?: number): IPhysicsBody2D[];
    /**
     * Returns bodies overlapping a circle.
     * @param center - The circle center in world pixels.
     * @param radius - The circle radius in pixels.
     * @param layerMask - Optional collision layer filter.
     * @returns Overlapping bodies.
     */
    overlapCircle(center: Vector2, radius: number, layerMask?: number): IPhysicsBody2D[];
    /**
     * Steps the physics simulation.
     * @param deltaTime - Time step in seconds.
     * @returns Nothing.
     */
    step(deltaTime: number): void;
    /**
     * Disposes the physics engine and all managed bodies and joints.
     * @returns Nothing.
     */
    dispose(): void;
}

/**
 * Debug body metadata exposed to engine-internal tooling.
 * @internal
 */
export interface IPhysicsDebugBody2D {
    /**
     * The Node2D driven by the body.
     */
    readonly node: Node2D;
    /**
     * The current body type.
     */
    readonly bodyType: PhysicsBodyType2D;
    /**
     * The body shape definition.
     */
    readonly shape: PhysicsShape2DOptions;
}

/**
 * Internal debug data source contract for physics backends.
 * @internal
 */
export interface IPhysicsDebugDataSource2D {
    /**
     * Returns debug body metadata for the current world state.
     * @returns The current debug body metadata.
     */
    _getDebugBodies(): readonly IPhysicsDebugBody2D[];
}
