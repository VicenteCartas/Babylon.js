import { Vector2 } from "core/Maths/math.vector";
import * as planck from "planck";

import type { Node2D } from "../Node2D/node2D";
import type { IRaycastHit2D } from "../Collision/collisionShapes";
import type { IPhysicsEngine2D, IPhysicsBody2D, IPhysicsBody2DOptions, PhysicsContactCallback } from "./physicsEngine2D";
import { PhysicsBodyType2D } from "./physicsEngine2D";

/**
 * Pixels-per-meter scale factor.
 * Planck.js uses meters internally; this converts between pixel coordinates and physics units.
 */
const PixelsPerMeter = 50;

/**
 * Converts pixels to meters
 * @param px - Value in pixels
 * @returns Value in meters
 */
function toMeters(px: number): number {
    return px / PixelsPerMeter;
}

/**
 * Converts meters to pixels
 * @param m - Value in meters
 * @returns Value in pixels
 */
function toPixels(m: number): number {
    return m * PixelsPerMeter;
}

/**
 * Internal wrapper linking a Planck body to a Node2D
 */
class PlanckBody2D implements IPhysicsBody2D {
    /**
     * The Node2D this body is attached to
     */
    public readonly node: Node2D;

    /**
     * The underlying Planck.js body
     */
    public readonly planckBody: planck.Body;

    /**
     * Creates a new PlanckBody2D wrapper
     * @param node - The Node2D
     * @param body - The Planck body
     */
    constructor(node: Node2D, body: planck.Body) {
        this.node = node;
        this.planckBody = body;
    }

    /** @inheritdoc */
    public setLinearVelocity(velocity: Vector2): void {
        this.planckBody.setLinearVelocity(planck.Vec2(toMeters(velocity.x), toMeters(velocity.y)));
    }

    /** @inheritdoc */
    public getLinearVelocity(): Vector2 {
        const v = this.planckBody.getLinearVelocity();
        return new Vector2(toPixels(v.x), toPixels(v.y));
    }

    /** @inheritdoc */
    public applyForce(force: Vector2): void {
        this.planckBody.applyForceToCenter(planck.Vec2(toMeters(force.x), toMeters(force.y)), true);
    }

    /** @inheritdoc */
    public applyImpulse(impulse: Vector2): void {
        this.planckBody.applyLinearImpulse(planck.Vec2(toMeters(impulse.x), toMeters(impulse.y)), this.planckBody.getWorldCenter(), true);
    }

    /** @inheritdoc */
    public getMass(): number {
        return this.planckBody.getMass();
    }
}

/**
 * Planck.js implementation of IPhysicsEngine2D.
 * Default 2D physics backend for @babylonjs/2d.
 *
 * Uses Y-down coordinate system matching the 2D engine convention.
 * Internally converts between pixel coordinates and Planck's meter-based system.
 */
export class PlanckPhysicsEngine implements IPhysicsEngine2D {
    private _world: planck.World;
    private _bodies: PlanckBody2D[] = [];
    private _beginContactCallbacks: PhysicsContactCallback[] = [];
    private _endContactCallbacks: PhysicsContactCallback[] = [];
    private _bodyMap: Map<planck.Body, PlanckBody2D> = new Map();

    /**
     * Creates a new PlanckPhysicsEngine
     * @param gravity - Gravity in pixels/second^2 (default: 0, 980 for Y-down)
     */
    constructor(gravity: Vector2 = new Vector2(0, 980)) {
        this._world = new planck.World({
            gravity: planck.Vec2(toMeters(gravity.x), toMeters(gravity.y)),
        });

        // Set up contact listeners
        this._world.on("begin-contact", (contact: planck.Contact) => {
            const bodyA = this._bodyMap.get(contact.getFixtureA().getBody());
            const bodyB = this._bodyMap.get(contact.getFixtureB().getBody());
            if (bodyA && bodyB) {
                for (const cb of this._beginContactCallbacks) {
                    cb(bodyA, bodyB);
                }
            }
        });

        this._world.on("end-contact", (contact: planck.Contact) => {
            const bodyA = this._bodyMap.get(contact.getFixtureA().getBody());
            const bodyB = this._bodyMap.get(contact.getFixtureB().getBody());
            if (bodyA && bodyB) {
                for (const cb of this._endContactCallbacks) {
                    cb(bodyA, bodyB);
                }
            }
        });
    }

    /** @inheritdoc */
    public setGravity(gravity: Vector2): void {
        this._world.setGravity(planck.Vec2(toMeters(gravity.x), toMeters(gravity.y)));
    }

    /** @inheritdoc */
    public getGravity(): Vector2 {
        const g = this._world.getGravity();
        return new Vector2(toPixels(g.x), toPixels(g.y));
    }

    /** @inheritdoc */
    public addBody(node: Node2D, options: IPhysicsBody2DOptions): IPhysicsBody2D {
        let bodyType: "static" | "dynamic" | "kinematic";
        switch (options.bodyType) {
            case PhysicsBodyType2D.Static:
                bodyType = "static";
                break;
            case PhysicsBodyType2D.Dynamic:
                bodyType = "dynamic";
                break;
            case PhysicsBodyType2D.Kinematic:
                bodyType = "kinematic";
                break;
        }

        const body = this._world.createBody({
            type: bodyType,
            position: planck.Vec2(toMeters(node.position.x), toMeters(node.position.y)),
            angle: node.rotation,
            fixedRotation: options.fixedRotation ?? false,
        });

        // Create fixture shape
        let shape: planck.Shape;
        switch (options.shape.type) {
            case "box":
                shape = planck.Box(toMeters(options.shape.width / 2), toMeters(options.shape.height / 2));
                break;
            case "circle":
                shape = planck.Circle(toMeters(options.shape.radius));
                break;
            case "polygon": {
                const verts = options.shape.vertices.map((v) => planck.Vec2(toMeters(v.x), toMeters(v.y)));
                shape = planck.Polygon(verts);
                break;
            }
        }

        body.createFixture({
            shape: shape,
            density: options.density ?? 1,
            friction: options.friction ?? 0.3,
            restitution: options.restitution ?? 0,
            isSensor: options.isSensor ?? false,
            filterCategoryBits: options.layer ?? 1,
            filterMaskBits: options.mask ?? 0xffff,
        });

        const wrapper = new PlanckBody2D(node, body);
        this._bodies.push(wrapper);
        this._bodyMap.set(body, wrapper);

        return wrapper;
    }

    /** @inheritdoc */
    public removeBody(body: IPhysicsBody2D): void {
        const planckBody = body as PlanckBody2D;
        this._world.destroyBody(planckBody.planckBody);
        this._bodyMap.delete(planckBody.planckBody);

        const index = this._bodies.indexOf(planckBody);
        if (index !== -1) {
            this._bodies.splice(index, 1);
        }
    }

    /** @inheritdoc */
    public step(deltaTime: number): void {
        this._world.step(deltaTime, 8, 3);

        // Sync physics bodies back to Node2D transforms
        for (const wrapper of this._bodies) {
            const pos = wrapper.planckBody.getPosition();
            wrapper.node.position.x = toPixels(pos.x);
            wrapper.node.position.y = toPixels(pos.y);
            wrapper.node.rotation = wrapper.planckBody.getAngle();
        }
    }

    /** @inheritdoc */
    public raycast(origin: Vector2, direction: Vector2, maxDistance: number, _mask?: number): IRaycastHit2D | null {
        const len = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
        if (len < 1e-10) {
            return null;
        }
        const ndx = direction.x / len;
        const ndy = direction.y / len;

        const p1 = planck.Vec2(toMeters(origin.x), toMeters(origin.y));
        const p2 = planck.Vec2(toMeters(origin.x + ndx * maxDistance), toMeters(origin.y + ndy * maxDistance));

        let closestHit: IRaycastHit2D | null = null;

        this._world.rayCast(p1, p2, (fixture: planck.Fixture, point: planck.Vec2, normal: planck.Vec2, fraction: number) => {
            const hitPoint = new Vector2(toPixels(point.x), toPixels(point.y));
            const hitNormal = new Vector2(normal.x, normal.y);
            const hitDist = fraction * maxDistance;

            if (!closestHit || hitDist < closestHit.distance) {
                closestHit = {
                    point: hitPoint,
                    normal: hitNormal,
                    distance: hitDist,
                };
            }
            return fraction;
        });

        return closestHit;
    }

    /** @inheritdoc */
    public onBeginContact(callback: PhysicsContactCallback): void {
        this._beginContactCallbacks.push(callback);
    }

    /** @inheritdoc */
    public onEndContact(callback: PhysicsContactCallback): void {
        this._endContactCallbacks.push(callback);
    }

    /** @inheritdoc */
    public dispose(): void {
        for (const wrapper of this._bodies) {
            this._world.destroyBody(wrapper.planckBody);
        }
        this._bodies.length = 0;
        this._bodyMap.clear();
        this._beginContactCallbacks.length = 0;
        this._endContactCallbacks.length = 0;
    }
}
