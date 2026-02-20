import { Node2D } from "2d/Node2D/node2D";
import { PlanckPhysicsEngine } from "2d/Physics/planckPhysicsEngine";
import { PhysicsBodyType2D } from "2d/Physics/physicsEngine2D";
import { Vector2 } from "core/Maths/math.vector";

describe("PlanckPhysicsEngine", () => {
    let engine: PlanckPhysicsEngine;

    beforeEach(() => {
        engine = new PlanckPhysicsEngine(new Vector2(0, 980));
    });

    afterEach(() => {
        engine.dispose();
    });

    describe("gravity", () => {
        it("should return configured gravity", () => {
            const g = engine.getGravity();
            expect(g.x).toBeCloseTo(0);
            expect(g.y).toBeCloseTo(980);
        });

        it("should update gravity", () => {
            engine.setGravity(new Vector2(0, 0));
            const g = engine.getGravity();
            expect(g.x).toBeCloseTo(0);
            expect(g.y).toBeCloseTo(0);
        });
    });

    describe("addBody / removeBody", () => {
        it("should create a dynamic body with box shape", () => {
            const node = new Node2D("box");
            node.position = new Vector2(100, 100);
            const body = engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: { type: "box", width: 32, height: 32 },
            });
            expect(body).toBeDefined();
            expect(body.node).toBe(node);
            expect(body.getMass()).toBeGreaterThan(0);
        });

        it("should create a static body with circle shape", () => {
            const node = new Node2D("circle");
            const body = engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Static,
                shape: { type: "circle", radius: 16 },
            });
            expect(body).toBeDefined();
            // Static bodies have zero mass
            expect(body.getMass()).toBe(0);
        });

        it("should create a kinematic body", () => {
            const node = new Node2D("kinematic");
            const body = engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Kinematic,
                shape: { type: "box", width: 20, height: 20 },
            });
            expect(body).toBeDefined();
        });

        it("should create a body with polygon shape", () => {
            const node = new Node2D("poly");
            const body = engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: {
                    type: "polygon",
                    vertices: [new Vector2(-16, -16), new Vector2(16, -16), new Vector2(16, 16), new Vector2(-16, 16)],
                },
            });
            expect(body).toBeDefined();
        });

        it("should remove a body", () => {
            const node = new Node2D("box");
            const body = engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: { type: "box", width: 32, height: 32 },
            });
            // Should not throw
            engine.removeBody(body);
        });
    });

    describe("step", () => {
        it("should move dynamic body under gravity", () => {
            const node = new Node2D("falling");
            node.position = new Vector2(100, 0);
            engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: { type: "box", width: 32, height: 32 },
            });

            // Step several frames
            for (let i = 0; i < 10; i++) {
                engine.step(1 / 60);
            }

            // Y should have increased (gravity pulling down in Y-down)
            expect(node.position.y).toBeGreaterThan(0);
        });

        it("should not move static body", () => {
            const node = new Node2D("ground");
            node.position = new Vector2(200, 500);
            engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Static,
                shape: { type: "box", width: 200, height: 20 },
            });

            engine.step(1 / 60);
            engine.step(1 / 60);

            expect(node.position.x).toBeCloseTo(200);
            expect(node.position.y).toBeCloseTo(500);
        });
    });

    describe("velocity", () => {
        it("should set and get linear velocity", () => {
            const node = new Node2D("mover");
            const body = engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: { type: "box", width: 10, height: 10 },
            });

            body.setLinearVelocity(new Vector2(200, 0));
            const v = body.getLinearVelocity();
            expect(v.x).toBeCloseTo(200, 0);
        });

        it("should apply impulse", () => {
            const node = new Node2D("impulse");
            // Use zero gravity to isolate impulse effect
            engine.setGravity(new Vector2(0, 0));

            const body = engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: { type: "box", width: 10, height: 10 },
            });

            body.applyImpulse(new Vector2(100, 0));
            engine.step(1 / 60);

            const v = body.getLinearVelocity();
            expect(v.x).toBeGreaterThan(0);
        });
    });

    describe("contact callbacks", () => {
        it("should fire beginContact when bodies collide", () => {
            engine.setGravity(new Vector2(0, 0));

            const nodeA = new Node2D("a");
            nodeA.position = new Vector2(0, 0);
            const bodyA = engine.addBody(nodeA, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: { type: "box", width: 20, height: 20 },
            });

            const nodeB = new Node2D("b");
            nodeB.position = new Vector2(30, 0);
            engine.addBody(nodeB, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: { type: "box", width: 20, height: 20 },
            });

            let contacted = false;
            engine.onBeginContact(() => {
                contacted = true;
            });

            // Push A towards B
            bodyA.setLinearVelocity(new Vector2(500, 0));

            // Step enough for collision
            for (let i = 0; i < 30; i++) {
                engine.step(1 / 60);
            }

            expect(contacted).toBe(true);
        });
    });

    describe("fixedRotation", () => {
        it("should prevent rotation when fixedRotation is true", () => {
            const node = new Node2D("fixed");
            node.position = new Vector2(100, 100);
            engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: { type: "box", width: 32, height: 32 },
                fixedRotation: true,
            });

            for (let i = 0; i < 10; i++) {
                engine.step(1 / 60);
            }

            expect(node.rotation).toBeCloseTo(0);
        });
    });

    describe("sensor", () => {
        it("should create sensor body", () => {
            const node = new Node2D("sensor");
            const body = engine.addBody(node, {
                bodyType: PhysicsBodyType2D.Static,
                shape: { type: "box", width: 50, height: 50 },
                isSensor: true,
            });
            expect(body).toBeDefined();
        });
    });

    describe("dispose", () => {
        it("should clean up all bodies", () => {
            const n1 = new Node2D("a");
            const n2 = new Node2D("b");
            engine.addBody(n1, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: { type: "box", width: 10, height: 10 },
            });
            engine.addBody(n2, {
                bodyType: PhysicsBodyType2D.Static,
                shape: { type: "circle", radius: 5 },
            });

            // Should not throw
            engine.dispose();
        });
    });
});
