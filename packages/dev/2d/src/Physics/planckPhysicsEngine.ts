import { Observable } from "core/Misc/observable";
import { Vector2 } from "core/Maths/math.vector";
import * as planck from "planck";

import type { IRaycastHit2D } from "../Collision/collisionShapes";
import type { Rectangle2D } from "../Math/rectangle2D";
import type { Node2D } from "../Node2D/node2D";
import type {
    ICollisionEvent2D,
    IPhysicsBody2D,
    IPhysicsBody2DOptions,
    IPhysicsDebugBody2D,
    IPhysicsDebugDataSource2D,
    IPhysicsEngine2D,
    IPhysicsJoint2D,
    IPhysicsJoint2DOptions,
    ISensorEvent2D,
    OneWayDirection2D,
    PhysicsShape2DOptions,
} from "./physicsEngine2D";
import { PhysicsBodyType2D, PhysicsJointType2D } from "./physicsEngine2D";

interface IPlanckPhysicsEngineOptions {
    gravity?: Vector2 | { x: number; y: number };
    pixelsPerMeter?: number;
}

interface IOneWayPlatformData {
    direction: OneWayDirection2D;
}

interface IMutableCollisionEvent2D extends ICollisionEvent2D {
    other: IPhysicsBody2D;
    contactPoints: ReadonlyArray<Vector2>;
    normal: Vector2;
    impactSpeed: number;
}

interface IMutableSensorEvent2D extends ISensorEvent2D {
    other: IPhysicsBody2D;
}

/**
 * Internal wrapper linking a Planck body to a Node2D.
 */
class PlanckBody2D implements IPhysicsBody2D, IPhysicsDebugBody2D {
    /** @inheritdoc */
    public readonly node: Node2D;

    /**
     * The underlying Planck.js body.
     */
    public readonly planckBody: planck.Body;

    /** @inheritdoc */
    public readonly shape: PhysicsShape2DOptions;

    /** @inheritdoc */
    public readonly onCollisionBegin: Observable<ICollisionEvent2D> = new Observable<ICollisionEvent2D>();

    /** @inheritdoc */
    public readonly onCollisionEnd: Observable<ICollisionEvent2D> = new Observable<ICollisionEvent2D>();

    /** @inheritdoc */
    public readonly onSensorBegin: Observable<ISensorEvent2D> = new Observable<ISensorEvent2D>();

    /** @inheritdoc */
    public readonly onSensorEnd: Observable<ISensorEvent2D> = new Observable<ISensorEvent2D>();

    private readonly _engine: PlanckPhysicsEngine;
    private readonly _pixelsPerMeter: number;
    private _disposed = false;

    /**
     * Creates a new PlanckBody2D wrapper.
     * @param engine - Owning physics engine.
     * @param node - The attached Node2D.
     * @param body - The underlying Planck body.
     * @param shape - The original shape configuration.
     * @param pixelsPerMeter - Pixel-to-meter scale.
     */
    constructor(engine: PlanckPhysicsEngine, node: Node2D, body: planck.Body, shape: PhysicsShape2DOptions, pixelsPerMeter: number) {
        this._engine = engine;
        this.node = node;
        this.planckBody = body;
        this.shape = shape;
        this._pixelsPerMeter = pixelsPerMeter;
    }

    /** @inheritdoc */
    public get bodyType(): PhysicsBodyType2D {
        return PlanckPhysicsEngine._toBodyType(this.planckBody.getType());
    }

    /** @inheritdoc */
    public get linearVelocity(): Vector2 {
        const velocity = this.planckBody.getLinearVelocity();
        return new Vector2(this._toPixels(velocity.x), this._toPixels(velocity.y));
    }

    public set linearVelocity(value: Vector2) {
        this.planckBody.setLinearVelocity(planck.Vec2(this._toMeters(value.x), this._toMeters(value.y)));
        this.planckBody.setAwake(true);
    }

    /** @inheritdoc */
    public get angularVelocity(): number {
        return this.planckBody.getAngularVelocity();
    }

    public set angularVelocity(value: number) {
        this.planckBody.setAngularVelocity(value);
        this.planckBody.setAwake(true);
    }

    /** @inheritdoc */
    public get position(): Vector2 {
        const position = this.planckBody.getPosition();
        return new Vector2(this._toPixels(position.x), this._toPixels(position.y));
    }

    public set position(value: Vector2) {
        this.planckBody.setTransform(planck.Vec2(this._toMeters(value.x), this._toMeters(value.y)), this.planckBody.getAngle());
        this.node.position.x = value.x;
        this.node.position.y = value.y;
        this.node._markWorldTransformDirty();
        this.planckBody.setAwake(true);
    }

    /** @inheritdoc */
    public get rotation(): number {
        return this.planckBody.getAngle();
    }

    public set rotation(value: number) {
        this.planckBody.setTransform(this.planckBody.getPosition(), value);
        this.node.rotation = value;
        this.node._markWorldTransformDirty();
        this.planckBody.setAwake(true);
    }

    /** @inheritdoc */
    public get mass(): number {
        return this.planckBody.getMass();
    }

    /** @inheritdoc */
    public get isSleeping(): boolean {
        return !this.planckBody.isAwake();
    }

    /** @inheritdoc */
    public applyForce(force: Vector2): void {
        this.planckBody.applyForceToCenter(planck.Vec2(this._toMeters(force.x), this._toMeters(force.y)), true);
    }

    /** @inheritdoc */
    public applyForceAtPoint(force: Vector2, worldPoint: Vector2): void {
        this.planckBody.applyForce(
            planck.Vec2(this._toMeters(force.x), this._toMeters(force.y)),
            planck.Vec2(this._toMeters(worldPoint.x), this._toMeters(worldPoint.y)),
            true
        );
    }

    /** @inheritdoc */
    public applyImpulse(impulse: Vector2): void {
        this.planckBody.applyLinearImpulse(
            planck.Vec2(this._toMeters(impulse.x), this._toMeters(impulse.y)),
            this.planckBody.getWorldCenter(),
            true
        );
    }

    /** @inheritdoc */
    public applyTorque(torque: number): void {
        this.planckBody.applyTorque(torque, true);
    }

    /** @inheritdoc */
    public wakeUp(): void {
        this.planckBody.setAwake(true);
    }

    /** @inheritdoc */
    public setBodyType(type: PhysicsBodyType2D): void {
        this.planckBody.setType(PlanckPhysicsEngine._toPlanckBodyType(type));
        this.planckBody.setAwake(true);
    }

    /** @inheritdoc */
    public setSensor(isSensor: boolean): void {
        for (let fixture = this.planckBody.getFixtureList(); fixture; fixture = fixture.getNext()) {
            fixture.setSensor(isSensor);
        }
    }

    /** @inheritdoc */
    public setCollisionFilter(layer: number, mask: number): void {
        for (let fixture = this.planckBody.getFixtureList(); fixture; fixture = fixture.getNext()) {
            fixture.setFilterData({
                categoryBits: layer,
                maskBits: mask,
                groupIndex: 0,
            });
            fixture.refilter();
        }
    }

    /** @inheritdoc */
    public setOneWayPlatform(enabled: boolean, direction: OneWayDirection2D = "up"): void {
        this._engine._setBodyOneWayPlatform(this, enabled, direction);
    }

    /** @inheritdoc */
    public dispose(): void {
        if (this._disposed) {
            return;
        }

        this._engine._removeBodyInternal(this);
    }

    /**
     * Marks the wrapper as disposed.
     * @returns Nothing.
     */
    public _markDisposed(): void {
        this._disposed = true;
    }

    private _toMeters(px: number): number {
        return px / this._pixelsPerMeter;
    }

    private _toPixels(meters: number): number {
        return meters * this._pixelsPerMeter;
    }
}

/**
 * Internal wrapper around a Planck joint.
 */
class PlanckJoint2D implements IPhysicsJoint2D {
    /** @inheritdoc */
    public readonly type: PhysicsJointType2D;

    /** @inheritdoc */
    public readonly bodyA: IPhysicsBody2D;

    /** @inheritdoc */
    public readonly bodyB: IPhysicsBody2D;

    /**
     * The underlying Planck joint.
     */
    public readonly planckJoint: planck.Joint;

    private readonly _engine: PlanckPhysicsEngine;
    private _disposed = false;

    /**
     * Creates a new joint wrapper.
     * @param engine - Owning physics engine.
     * @param type - Joint type.
     * @param bodyA - First body.
     * @param bodyB - Second body.
     * @param planckJoint - The wrapped Planck joint.
     */
    constructor(engine: PlanckPhysicsEngine, type: PhysicsJointType2D, bodyA: IPhysicsBody2D, bodyB: IPhysicsBody2D, planckJoint: planck.Joint) {
        this._engine = engine;
        this.type = type;
        this.bodyA = bodyA;
        this.bodyB = bodyB;
        this.planckJoint = planckJoint;
    }

    /** @inheritdoc */
    public get isActive(): boolean {
        return !this._disposed;
    }

    /** @inheritdoc */
    public get motorSpeed(): number | undefined {
        switch (this.type) {
            case PhysicsJointType2D.Revolute:
                return (this.planckJoint as planck.RevoluteJoint).getMotorSpeed();
            case PhysicsJointType2D.Prismatic:
                return (this.planckJoint as planck.PrismaticJoint).getMotorSpeed();
            case PhysicsJointType2D.Wheel:
                return (this.planckJoint as planck.WheelJoint).getMotorSpeed();
            default:
                return undefined;
        }
    }

    public set motorSpeed(value: number | undefined) {
        if (value === undefined) {
            return;
        }

        switch (this.type) {
            case PhysicsJointType2D.Revolute:
                (this.planckJoint as planck.RevoluteJoint).setMotorSpeed(value);
                break;
            case PhysicsJointType2D.Prismatic:
                (this.planckJoint as planck.PrismaticJoint).setMotorSpeed(value);
                break;
            case PhysicsJointType2D.Wheel:
                (this.planckJoint as planck.WheelJoint).setMotorSpeed(value);
                break;
        }
    }

    /** @inheritdoc */
    public dispose(): void {
        if (this._disposed) {
            return;
        }

        this._engine._removeJointInternal(this);
    }

    /**
     * Marks the wrapper as disposed.
     * @returns Nothing.
     */
    public _markDisposed(): void {
        this._disposed = true;
    }
}

/**
 * Planck.js implementation of IPhysicsEngine2D.
 */
export class PlanckPhysicsEngine implements IPhysicsEngine2D, IPhysicsDebugDataSource2D {
    private readonly _world: planck.World;
    private readonly _bodies: PlanckBody2D[] = [];
    private readonly _bodyMap: Map<planck.Body, PlanckBody2D> = new Map();
    private readonly _fixtureMap: Map<planck.Fixture, PlanckBody2D> = new Map();
    private readonly _joints: PlanckJoint2D[] = [];
    private readonly _oneWayData: Map<planck.Fixture, IOneWayPlatformData> = new Map();
    private readonly _contactPointPool: Vector2[] = [new Vector2(0, 0), new Vector2(0, 0)];
    private readonly _contactPointViews: ReadonlyArray<ReadonlyArray<Vector2>>;
    private readonly _collisionEventA: IMutableCollisionEvent2D;
    private readonly _collisionEventB: IMutableCollisionEvent2D;
    private readonly _sensorEventA: IMutableSensorEvent2D;
    private readonly _sensorEventB: IMutableSensorEvent2D;
    private readonly _pixelsPerMeter: number;

    /**
     * Creates a new PlanckPhysicsEngine.
     * @param options - Physics engine configuration.
     */
    constructor(options: IPlanckPhysicsEngineOptions = {}) {
        const normalizedOptions = PlanckPhysicsEngine._normalizeOptions(options);
        this._pixelsPerMeter = normalizedOptions.pixelsPerMeter;
        this._contactPointViews = [[], [this._contactPointPool[0]], [this._contactPointPool[0], this._contactPointPool[1]]];
        this._collisionEventA = {
            other: null as never,
            contactPoints: this._contactPointViews[0],
            normal: new Vector2(0, 0),
            impactSpeed: 0,
        };
        this._collisionEventB = {
            other: null as never,
            contactPoints: this._contactPointViews[0],
            normal: new Vector2(0, 0),
            impactSpeed: 0,
        };
        this._sensorEventA = { other: null as never };
        this._sensorEventB = { other: null as never };

        this._world = new planck.World({
            gravity: planck.Vec2(this._toMeters(normalizedOptions.gravity.x), this._toMeters(normalizedOptions.gravity.y)),
        });

        this._world.on("begin-contact", (contact: planck.Contact) => {
            this._handleBeginContact(contact);
        });

        this._world.on("end-contact", (contact: planck.Contact) => {
            this._handleEndContact(contact);
        });

        this._world.on("pre-solve", (contact: planck.Contact) => {
            this._handlePreSolve(contact);
        });
    }

    /** @inheritdoc */
    public get gravity(): Vector2 {
        const gravity = this._world.getGravity();
        return new Vector2(this._toPixels(gravity.x), this._toPixels(gravity.y));
    }

    public set gravity(value: Vector2) {
        this._world.setGravity(planck.Vec2(this._toMeters(value.x), this._toMeters(value.y)));
    }

    /** @inheritdoc */
    public addBody(node: Node2D, options: IPhysicsBody2DOptions): IPhysicsBody2D {
        this._validateBodyOptions(options);

        const body = this._world.createBody({
            type: PlanckPhysicsEngine._toPlanckBodyType(options.bodyType),
            position: planck.Vec2(this._toMeters(node.position.x), this._toMeters(node.position.y)),
            angle: node.rotation,
            fixedRotation: options.fixedRotation ?? false,
            linearVelocity: options.linearVelocity
                ? planck.Vec2(this._toMeters(options.linearVelocity.x), this._toMeters(options.linearVelocity.y))
                : undefined,
            angularVelocity: options.angularVelocity,
            linearDamping: options.linearDamping ?? 0,
            angularDamping: options.angularDamping ?? 0,
        });

        const fixtureOptions = {
            density: options.density ?? 1,
            friction: options.friction ?? 0.3,
            restitution: options.restitution ?? 0,
            isSensor: options.isSensor ?? false,
            filterCategoryBits: options.layer ?? 0x0001,
            filterMaskBits: options.mask ?? 0xffff,
        };

        const fixtures = this._createFixtures(body, options.shape, fixtureOptions);
        const wrapper = new PlanckBody2D(this, node, body, options.shape, this._pixelsPerMeter);
        this._bodies.push(wrapper);
        this._bodyMap.set(body, wrapper);

        for (const fixture of fixtures) {
            this._fixtureMap.set(fixture, wrapper);
        }

        if (options.isOneWayPlatform) {
            wrapper.setOneWayPlatform(true, options.oneWayDirection);
        }

        return wrapper;
    }

    /** @inheritdoc */
    public removeBody(body: IPhysicsBody2D): void {
        body.dispose();
    }

    /** @inheritdoc */
    public addJoint(options: IPhysicsJoint2DOptions): IPhysicsJoint2D {
        const bodyA = options.bodyA as PlanckBody2D;
        const bodyB = options.bodyB as PlanckBody2D;
        const joint = this._createJoint(bodyA, bodyB, options);
        const createdJoint = this._world.createJoint(joint);

        if (!createdJoint) {
            throw new Error("Failed to create Planck joint.");
        }

        const wrapper = new PlanckJoint2D(this, options.type, bodyA, bodyB, createdJoint);
        this._joints.push(wrapper);
        return wrapper;
    }

    /** @inheritdoc */
    public removeJoint(joint: IPhysicsJoint2D): void {
        joint.dispose();
    }

    /** @inheritdoc */
    public step(deltaTime: number): void {
        this._world.step(deltaTime, 8, 3);

        for (const wrapper of this._bodies) {
            const position = wrapper.planckBody.getPosition();
            wrapper.node.position.x = this._toPixels(position.x);
            wrapper.node.position.y = this._toPixels(position.y);
            wrapper.node.rotation = wrapper.planckBody.getAngle();
            wrapper.node._markWorldTransformDirty();
        }
    }

    /** @inheritdoc */
    public raycast(origin: Vector2, direction: Vector2, maxDistance: number, layerMask: number = 0xffff): IRaycastHit2D[] {
        const length = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
        if (length < 1e-10 || maxDistance <= 0) {
            return [];
        }

        const ndx = direction.x / length;
        const ndy = direction.y / length;
        const p1 = planck.Vec2(this._toMeters(origin.x), this._toMeters(origin.y));
        const p2 = planck.Vec2(this._toMeters(origin.x + ndx * maxDistance), this._toMeters(origin.y + ndy * maxDistance));
        const hits: IRaycastHit2D[] = [];

        this._world.rayCast(p1, p2, (fixture: planck.Fixture, point: planck.Vec2, normal: planck.Vec2, fraction: number) => {
            if (!this._matchesLayerMask(fixture, layerMask)) {
                return 1;
            }

            hits.push({
                point: new Vector2(this._toPixels(point.x), this._toPixels(point.y)),
                normal: new Vector2(normal.x, normal.y),
                distance: fraction * maxDistance,
            });

            return 1;
        });

        hits.sort((a, b) => a.distance - b.distance);
        return hits;
    }

    /** @inheritdoc */
    public overlapRect(rect: Rectangle2D, layerMask: number = 0xffff): IPhysicsBody2D[] {
        if (rect.width <= 0 || rect.height <= 0) {
            return [];
        }

        const matches: PlanckBody2D[] = [];
        const seen = new Set<PlanckBody2D>();
        const queryShape = this._createRectangleQueryShape(rect);
        const queryTransform = new planck.Transform(
            planck.Vec2(this._toMeters(rect.centerX), this._toMeters(rect.centerY)),
            0
        );
        const aabb = planck.AABB(
            planck.Vec2(this._toMeters(rect.left), this._toMeters(rect.top)),
            planck.Vec2(this._toMeters(rect.right), this._toMeters(rect.bottom))
        );

        this._world.queryAABB(aabb, (fixture: planck.Fixture) => {
            if (!this._matchesLayerMask(fixture, layerMask)) {
                return true;
            }

            const body = this._fixtureMap.get(fixture);
            if (!body || seen.has(body)) {
                return true;
            }

            if (planck.testOverlap(fixture.getShape(), 0, queryShape, 0, fixture.getBody().getTransform(), queryTransform)) {
                seen.add(body);
                matches.push(body);
            }

            return true;
        });

        return matches;
    }

    /** @inheritdoc */
    public overlapCircle(center: Vector2, radius: number, layerMask: number = 0xffff): IPhysicsBody2D[] {
        if (radius <= 0) {
            return [];
        }

        const matches: PlanckBody2D[] = [];
        const seen = new Set<PlanckBody2D>();
        const centerMeters = planck.Vec2(this._toMeters(center.x), this._toMeters(center.y));
        const radiusMeters = this._toMeters(radius);
        const queryShape = planck.CircleShape(radiusMeters);
        const queryTransform = new planck.Transform(centerMeters, 0);
        const aabb = planck.AABB(
            planck.Vec2(centerMeters.x - radiusMeters, centerMeters.y - radiusMeters),
            planck.Vec2(centerMeters.x + radiusMeters, centerMeters.y + radiusMeters)
        );

        this._world.queryAABB(aabb, (fixture: planck.Fixture) => {
            if (!this._matchesLayerMask(fixture, layerMask)) {
                return true;
            }

            const body = this._fixtureMap.get(fixture);
            if (!body || seen.has(body)) {
                return true;
            }

            if (planck.testOverlap(fixture.getShape(), 0, queryShape, 0, fixture.getBody().getTransform(), queryTransform)) {
                seen.add(body);
                matches.push(body);
            }

            return true;
        });

        return matches;
    }

    /** @inheritdoc */
    public dispose(): void {
        for (const joint of this._joints.slice()) {
            joint.dispose();
        }

        for (const body of this._bodies.slice()) {
            body.dispose();
        }
    }

    /**
     * Returns debug body metadata for visualization.
     * @returns The current debug body metadata.
     * @internal
     */
    public _getDebugBodies(): readonly IPhysicsDebugBody2D[] {
        return this._bodies;
    }

    /**
     * Removes a body owned by this engine.
     * @param body - The body to remove.
     * @returns Nothing.
     * @internal
     */
    public _removeBodyInternal(body: PlanckBody2D): void {
        const index = this._bodies.indexOf(body);
        if (index === -1) {
            return;
        }

        for (let fixture = body.planckBody.getFixtureList(); fixture; fixture = fixture.getNext()) {
            this._fixtureMap.delete(fixture);
            this._oneWayData.delete(fixture);
        }

        this._world.destroyBody(body.planckBody);
        this._bodyMap.delete(body.planckBody);
        this._bodies.splice(index, 1);
        body._markDisposed();
    }

    /**
     * Removes a joint owned by this engine.
     * @param joint - The joint to remove.
     * @returns Nothing.
     * @internal
     */
    public _removeJointInternal(joint: PlanckJoint2D): void {
        const index = this._joints.indexOf(joint);
        if (index === -1) {
            return;
        }

        this._world.destroyJoint(joint.planckJoint);
        this._joints.splice(index, 1);
        joint._markDisposed();
    }

    /**
     * Applies or clears one-way platform metadata for a body.
     * @param body - The body to update.
     * @param enabled - Whether one-way behavior should be enabled.
     * @param direction - The blocking direction.
     * @returns Nothing.
     * @internal
     */
    public _setBodyOneWayPlatform(body: PlanckBody2D, enabled: boolean, direction: OneWayDirection2D): void {
        for (let fixture = body.planckBody.getFixtureList(); fixture; fixture = fixture.getNext()) {
            if (enabled) {
                this._oneWayData.set(fixture, { direction });
            } else {
                this._oneWayData.delete(fixture);
            }
        }
    }

    /**
     * Converts a Planck body type to the engine enum.
     * @param bodyType - The Planck body type string.
     * @returns The engine body type enum value.
     * @internal
     */
    public static _toBodyType(bodyType: planck.BodyType): PhysicsBodyType2D {
        switch (bodyType) {
            case "static":
                return PhysicsBodyType2D.Static;
            case "kinematic":
                return PhysicsBodyType2D.Kinematic;
            default:
                return PhysicsBodyType2D.Dynamic;
        }
    }

    /**
     * Converts the engine enum to a Planck body type.
     * @param bodyType - The engine body type enum value.
     * @returns The Planck body type string.
     * @internal
     */
    public static _toPlanckBodyType(bodyType: PhysicsBodyType2D): planck.BodyType {
        switch (bodyType) {
            case PhysicsBodyType2D.Static:
                return "static";
            case PhysicsBodyType2D.Kinematic:
                return "kinematic";
            default:
                return "dynamic";
        }
    }

    private _handleBeginContact(contact: planck.Contact): void {
        const fixtureA = contact.getFixtureA();
        const fixtureB = contact.getFixtureB();
        const bodyA = this._fixtureMap.get(fixtureA);
        const bodyB = this._fixtureMap.get(fixtureB);

        if (!bodyA || !bodyB) {
            return;
        }

        if (fixtureA.isSensor() || fixtureB.isSensor()) {
            this._sensorEventA.other = bodyB;
            this._sensorEventB.other = bodyA;
            bodyA.onSensorBegin.notifyObservers(this._sensorEventA);
            bodyB.onSensorBegin.notifyObservers(this._sensorEventB);
            return;
        }

        this._populateCollisionEvents(contact, bodyA, bodyB);
        bodyA.onCollisionBegin.notifyObservers(this._collisionEventA);
        bodyB.onCollisionBegin.notifyObservers(this._collisionEventB);
    }

    private _handleEndContact(contact: planck.Contact): void {
        const fixtureA = contact.getFixtureA();
        const fixtureB = contact.getFixtureB();
        const bodyA = this._fixtureMap.get(fixtureA);
        const bodyB = this._fixtureMap.get(fixtureB);

        if (!bodyA || !bodyB) {
            return;
        }

        if (fixtureA.isSensor() || fixtureB.isSensor()) {
            this._sensorEventA.other = bodyB;
            this._sensorEventB.other = bodyA;
            bodyA.onSensorEnd.notifyObservers(this._sensorEventA);
            bodyB.onSensorEnd.notifyObservers(this._sensorEventB);
            return;
        }

        this._collisionEventA.other = bodyB;
        this._collisionEventA.contactPoints = this._contactPointViews[0];
        this._collisionEventA.normal.x = 0;
        this._collisionEventA.normal.y = 0;
        this._collisionEventA.impactSpeed = 0;
        this._collisionEventB.other = bodyA;
        this._collisionEventB.contactPoints = this._contactPointViews[0];
        this._collisionEventB.normal.x = 0;
        this._collisionEventB.normal.y = 0;
        this._collisionEventB.impactSpeed = 0;
        bodyA.onCollisionEnd.notifyObservers(this._collisionEventA);
        bodyB.onCollisionEnd.notifyObservers(this._collisionEventB);
    }

    private _handlePreSolve(contact: planck.Contact): void {
        const fixtureA = contact.getFixtureA();
        const fixtureB = contact.getFixtureB();
        const oneWayA = this._oneWayData.get(fixtureA);
        const oneWayB = this._oneWayData.get(fixtureB);

        if (!oneWayA && !oneWayB) {
            return;
        }

        const manifold = contact.getWorldManifold(null);
        if (!manifold) {
            return;
        }

        const platformFixture = oneWayA ? fixtureA : fixtureB;
        const otherFixture = platformFixture === fixtureA ? fixtureB : fixtureA;
        const platformData = oneWayA ?? oneWayB;

        if (!platformData) {
            return;
        }

        let normalX = manifold.normal.x;
        let normalY = manifold.normal.y;
        if (platformFixture === fixtureB) {
            normalX = -normalX;
            normalY = -normalY;
        }

        let allowedNormalX = 0;
        let allowedNormalY = -1;
        switch (platformData.direction) {
            case "down":
                allowedNormalY = 1;
                break;
            case "left":
                allowedNormalX = -1;
                allowedNormalY = 0;
                break;
            case "right":
                allowedNormalX = 1;
                allowedNormalY = 0;
                break;
        }

        const alignment = normalX * allowedNormalX + normalY * allowedNormalY;
        const platformBody = platformFixture.getBody();
        const otherBody = otherFixture.getBody();
        const contactPoint = manifold.pointCount > 0 ? manifold.points[0] : platformBody.getWorldCenter();
        const platformVelocity = platformBody.getLinearVelocityFromWorldPoint(contactPoint);
        const otherVelocity = otherBody.getLinearVelocityFromWorldPoint(contactPoint);
        const relativeVelocityX = otherVelocity.x - platformVelocity.x;
        const relativeVelocityY = otherVelocity.y - platformVelocity.y;
        const approachSpeed = relativeVelocityX * allowedNormalX + relativeVelocityY * allowedNormalY;

        if (alignment < 0.5 || approachSpeed > 0) {
            contact.setEnabled(false);
        }
    }

    private _populateCollisionEvents(contact: planck.Contact, bodyA: PlanckBody2D, bodyB: PlanckBody2D): void {
        const manifold = contact.getWorldManifold(null);
        const pointCount = manifold?.pointCount ?? 0;
        const clampedPointCount = pointCount > 2 ? 2 : pointCount;

        for (let i = 0; i < clampedPointCount; i++) {
            const point = manifold!.points[i];
            this._contactPointPool[i].x = this._toPixels(point.x);
            this._contactPointPool[i].y = this._toPixels(point.y);
        }

        const contactPoint = clampedPointCount > 0 ? manifold!.points[0] : bodyA.planckBody.getWorldCenter();
        const velocityA = bodyA.planckBody.getLinearVelocityFromWorldPoint(contactPoint);
        const velocityB = bodyB.planckBody.getLinearVelocityFromWorldPoint(contactPoint);
        const relativeSpeed = this._toPixels(Math.sqrt((velocityA.x - velocityB.x) ** 2 + (velocityA.y - velocityB.y) ** 2));
        const normal = manifold?.normal ?? planck.Vec2(0, 0);

        this._collisionEventA.other = bodyB;
        this._collisionEventA.contactPoints = this._contactPointViews[clampedPointCount];
        this._collisionEventA.normal.x = -normal.x;
        this._collisionEventA.normal.y = -normal.y;
        this._collisionEventA.impactSpeed = relativeSpeed;

        this._collisionEventB.other = bodyA;
        this._collisionEventB.contactPoints = this._contactPointViews[clampedPointCount];
        this._collisionEventB.normal.x = normal.x;
        this._collisionEventB.normal.y = normal.y;
        this._collisionEventB.impactSpeed = relativeSpeed;
    }

    private _createFixtures(
        body: planck.Body,
        shapeOptions: PhysicsShape2DOptions,
        fixtureOptions: {
            density: number;
            friction: number;
            restitution: number;
            isSensor: boolean;
            filterCategoryBits: number;
            filterMaskBits: number;
        }
    ): planck.Fixture[] {
        const fixtures: planck.Fixture[] = [];

        const createFixture = (shape: planck.Shape): void => {
            fixtures.push(
                body.createFixture({
                    shape,
                    density: fixtureOptions.density,
                    friction: fixtureOptions.friction,
                    restitution: fixtureOptions.restitution,
                    isSensor: fixtureOptions.isSensor,
                    filterCategoryBits: fixtureOptions.filterCategoryBits,
                    filterMaskBits: fixtureOptions.filterMaskBits,
                })
            );
        };

        switch (shapeOptions.type) {
            case "box":
                createFixture(
                    planck.BoxShape(
                        this._toMeters(shapeOptions.width / 2),
                        this._toMeters(shapeOptions.height / 2),
                        planck.Vec2(0, 0),
                        shapeOptions.angle ?? 0
                    )
                );
                break;
            case "circle":
                createFixture(planck.CircleShape(this._toMeters(shapeOptions.radius)));
                break;
            case "polygon":
                createFixture(
                    planck.PolygonShape(shapeOptions.vertices.map((vertex) => planck.Vec2(this._toMeters(vertex.x), this._toMeters(vertex.y))))
                );
                break;
            case "edge": {
                const edge = planck.EdgeShape(
                    planck.Vec2(this._toMeters(shapeOptions.v1.x), this._toMeters(shapeOptions.v1.y)),
                    planck.Vec2(this._toMeters(shapeOptions.v2.x), this._toMeters(shapeOptions.v2.y))
                );
                if (shapeOptions.ghost) {
                    edge.setPrevVertex(planck.Vec2(this._toMeters(shapeOptions.v1.x), this._toMeters(shapeOptions.v1.y)));
                    edge.setNextVertex(planck.Vec2(this._toMeters(shapeOptions.v2.x), this._toMeters(shapeOptions.v2.y)));
                }
                createFixture(edge);
                break;
            }
            case "capsule":
                this._createCapsuleFixtures(shapeOptions.width, shapeOptions.height, createFixture);
                break;
        }

        return fixtures;
    }

    private _createCapsuleFixtures(width: number, height: number, createFixture: (shape: planck.Shape) => void): void {
        if (Math.abs(width - height) < 1e-5) {
            createFixture(planck.CircleShape(this._toMeters(width / 2)));
            return;
        }

        if (height > width) {
            const radius = width / 2;
            const innerHeight = height - width;
            if (innerHeight > 0) {
                createFixture(planck.BoxShape(this._toMeters(width / 2), this._toMeters(innerHeight / 2)));
            }
            const offset = innerHeight / 2;
            createFixture(planck.CircleShape(planck.Vec2(0, this._toMeters(-offset)), this._toMeters(radius)));
            createFixture(planck.CircleShape(planck.Vec2(0, this._toMeters(offset)), this._toMeters(radius)));
            return;
        }

        const radius = height / 2;
        const innerWidth = width - height;
        if (innerWidth > 0) {
            createFixture(planck.BoxShape(this._toMeters(innerWidth / 2), this._toMeters(height / 2)));
        }
        const offset = innerWidth / 2;
        createFixture(planck.CircleShape(planck.Vec2(this._toMeters(-offset), 0), this._toMeters(radius)));
        createFixture(planck.CircleShape(planck.Vec2(this._toMeters(offset), 0), this._toMeters(radius)));
    }

    private _createJoint(bodyA: PlanckBody2D, bodyB: PlanckBody2D, options: IPhysicsJoint2DOptions): planck.Joint {
        const anchorA = options.anchorA ?? Vector2.Zero();
        const anchorB = options.anchorB ?? Vector2.Zero();
        const worldAnchorA = bodyA.planckBody.getWorldPoint(planck.Vec2(this._toMeters(anchorA.x), this._toMeters(anchorA.y)));
        const worldAnchorB = bodyB.planckBody.getWorldPoint(planck.Vec2(this._toMeters(anchorB.x), this._toMeters(anchorB.y)));
        const defaultAnchor = planck.Vec2((worldAnchorA.x + worldAnchorB.x) * 0.5, (worldAnchorA.y + worldAnchorB.y) * 0.5);
        const axis = this._normalizeAxis(options.axis ?? new Vector2(1, 0));

        switch (options.type) {
            case PhysicsJointType2D.Distance:
                return planck.DistanceJoint(
                    {
                        collideConnected: options.collideConnected ?? false,
                        length: options.length !== undefined ? this._toMeters(options.length) : undefined,
                        frequencyHz: options.frequencyHz,
                        dampingRatio: options.dampingRatio,
                    },
                    bodyA.planckBody,
                    bodyB.planckBody,
                    worldAnchorA,
                    worldAnchorB
                );
            case PhysicsJointType2D.Revolute:
                return planck.RevoluteJoint(
                    {
                        collideConnected: options.collideConnected ?? false,
                        enableLimit: options.enableLimit,
                        lowerAngle: options.lowerAngle,
                        upperAngle: options.upperAngle,
                        enableMotor: options.enableMotor,
                        motorSpeed: options.motorSpeed,
                        maxMotorTorque: options.maxMotorTorque,
                    },
                    bodyA.planckBody,
                    bodyB.planckBody,
                    defaultAnchor
                );
            case PhysicsJointType2D.Prismatic:
                return planck.PrismaticJoint(
                    {
                        collideConnected: options.collideConnected ?? false,
                        enableLimit: options.enableLimit,
                        lowerTranslation: options.lowerAngle !== undefined ? this._toMeters(options.lowerAngle) : undefined,
                        upperTranslation: options.upperAngle !== undefined ? this._toMeters(options.upperAngle) : undefined,
                        enableMotor: options.enableMotor,
                        motorSpeed: options.motorSpeed,
                    },
                    bodyA.planckBody,
                    bodyB.planckBody,
                    defaultAnchor,
                    planck.Vec2(axis.x, axis.y)
                );
            case PhysicsJointType2D.Weld:
                return planck.WeldJoint(
                    {
                        collideConnected: options.collideConnected ?? false,
                        frequencyHz: options.frequencyHz,
                        dampingRatio: options.dampingRatio,
                    },
                    bodyA.planckBody,
                    bodyB.planckBody,
                    defaultAnchor
                );
            case PhysicsJointType2D.Rope:
                return planck.RopeJoint(
                    {
                        collideConnected: options.collideConnected ?? false,
                        maxLength: options.length !== undefined ? this._toMeters(options.length) : undefined,
                    },
                    bodyA.planckBody,
                    bodyB.planckBody,
                    defaultAnchor
                );
            case PhysicsJointType2D.Wheel:
                return planck.WheelJoint(
                    {
                        collideConnected: options.collideConnected ?? false,
                        enableMotor: options.enableMotor,
                        motorSpeed: options.motorSpeed,
                        maxMotorTorque: options.maxMotorTorque,
                        frequencyHz: options.frequencyHz,
                        dampingRatio: options.dampingRatio,
                    },
                    bodyA.planckBody,
                    bodyB.planckBody,
                    defaultAnchor,
                    planck.Vec2(axis.x, axis.y)
                );
            default:
                throw new Error("Unsupported joint type.");
        }
    }

    private _createRectangleQueryShape(rect: Rectangle2D): planck.PolygonShape {
        const halfWidth = this._toMeters(rect.width / 2);
        const halfHeight = this._toMeters(rect.height / 2);
        return planck.PolygonShape([
            planck.Vec2(-halfWidth, -halfHeight),
            planck.Vec2(halfWidth, -halfHeight),
            planck.Vec2(halfWidth, halfHeight),
            planck.Vec2(-halfWidth, halfHeight),
        ]);
    }

    private _matchesLayerMask(fixture: planck.Fixture, layerMask: number): boolean {
        return (fixture.getFilterCategoryBits() & layerMask) !== 0;
    }

    private _normalizeAxis(axis: Vector2): Vector2 {
        const length = Math.sqrt(axis.x * axis.x + axis.y * axis.y);
        if (length < 1e-10) {
            return new Vector2(1, 0);
        }

        return new Vector2(axis.x / length, axis.y / length);
    }

    private _validateBodyOptions(options: IPhysicsBody2DOptions): void {
        if ((options.layer ?? 0x0001) === 0) {
            throw new Error("Physics body layer must not be 0.");
        }

        this._validateShapeOptions(options.shape);
    }

    private _validateShapeOptions(shape: PhysicsShape2DOptions): void {
        switch (shape.type) {
            case "box":
                if (shape.width <= 0 || shape.height <= 0) {
                    throw new Error("Physics box shapes require width and height greater than 0.");
                }
                return;
            case "circle":
                if (shape.radius <= 0) {
                    throw new Error("Physics circle shapes require radius greater than 0.");
                }
                return;
            case "polygon":
                if (shape.vertices.length < 3 || shape.vertices.length > 8) {
                    throw new Error("Physics polygon shapes require between 3 and 8 vertices.");
                }
                return;
            case "capsule":
                if (shape.width <= 0 || shape.height <= 0) {
                    throw new Error("Physics capsule shapes require width and height greater than 0.");
                }
                return;
            case "edge": {
                const dx = shape.v2.x - shape.v1.x;
                const dy = shape.v2.y - shape.v1.y;
                if (dx * dx + dy * dy <= 1e-10) {
                    throw new Error("Physics edge shapes require two distinct vertices.");
                }
                return;
            }
        }
    }

    private _toMeters(px: number): number {
        return px / this._pixelsPerMeter;
    }

    private _toPixels(meters: number): number {
        return meters * this._pixelsPerMeter;
    }

    private static _normalizeOptions(options: IPlanckPhysicsEngineOptions): { gravity: Vector2; pixelsPerMeter: number } {
        const gravity = options.gravity ?? new Vector2(0, 980);
        return {
            gravity: new Vector2(gravity.x, gravity.y),
            pixelsPerMeter: options.pixelsPerMeter ?? 64,
        };
    }
}
