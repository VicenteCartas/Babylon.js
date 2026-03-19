import { Logger } from "core/Misc/logger";

import { StateMachine2D } from "2d/StateMachine/stateMachine";

interface TestContext {
    health: number;
    playerDistance: number;
    log: string[];
}

function makeCtx(): TestContext {
    return { health: 100, playerDistance: 500, log: [] };
}

describe("StateMachine2D", () => {
    describe("startup and state queries", () => {
        it("should start from the constructor initial state", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx, "idle");

            fsm.addState({
                name: "idle",
                onEnter: (context, previousState) => {
                    context.log.push(`enter-idle-from-${previousState}`);
                },
            });

            fsm.start();

            expect(fsm.currentState).toBe("idle");
            expect(fsm.previousState).toBe("");
            expect(fsm.isRunning).toBe(true);
            expect(fsm.isStarted).toBe(true);
            expect(ctx.log).toEqual(["enter-idle-from-"]);
        });

        it("should support the legacy start(initialState) path", () => {
            const fsm = new StateMachine2D<object>({}, "");
            fsm.addState({ name: "idle" });

            fsm.start("idle");

            expect(fsm.currentState).toBe("idle");
            expect(fsm.isRunning).toBe(true);
        });

        it("should no-op when start is called while already running", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx, "idle");

            fsm.addState({
                name: "idle",
                onEnter: (context) => {
                    context.log.push("enter-idle");
                },
            });

            fsm.start();
            fsm.start();

            expect(ctx.log).toEqual(["enter-idle"]);
        });

        it("should stop and clear the current active state", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx, "idle");

            fsm.addState({
                name: "idle",
                onExit: (context, nextState) => {
                    context.log.push(`exit-idle-to-${nextState}`);
                },
            });

            fsm.start();
            fsm.stop();

            expect(fsm.isRunning).toBe(false);
            expect(fsm.currentState).toBe("");
            expect(fsm.previousState).toBe("idle");
            expect(ctx.log).toEqual(["exit-idle-to-"]);
        });
    });

    describe("state registration", () => {
        it("should replace an existing state with the same name", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx, "idle");

            fsm.addState({
                name: "idle",
                onEnter: (context) => {
                    context.log.push("first");
                },
            });
            fsm.addState({
                name: "idle",
                onEnter: (context) => {
                    context.log.push("second");
                },
            });

            fsm.start();

            expect(ctx.log).toEqual(["second"]);
        });

        it("should remove inactive states and reject removing the active state", () => {
            const fsm = new StateMachine2D<object>({}, "idle");
            fsm.addState({ name: "idle" });
            fsm.addState({ name: "walk" });
            fsm.removeState("walk");

            expect(fsm.hasState("walk")).toBe(false);

            fsm.start();
            expect(() => fsm.removeState("idle")).toThrow('Cannot remove active state "idle".');
        });
    });

    describe("automatic transitions", () => {
        it("should respect priority and skip onUpdate when a transition fires", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx, "idle");

            fsm.addState({
                name: "idle",
                onUpdate: (context) => {
                    context.log.push("idle-update");
                },
                onExit: (context, nextState) => {
                    context.log.push(`exit-idle-to-${nextState}`);
                },
            });
            fsm.addState({
                name: "chase",
                onEnter: (context, previousState) => {
                    context.log.push(`enter-chase-from-${previousState}`);
                },
            });
            fsm.addState({ name: "flee" });

            fsm.addTransition({
                from: "idle",
                to: "chase",
                condition: (context) => context.playerDistance < 100,
                priority: 1,
            });
            fsm.addTransition({
                from: "idle",
                to: "flee",
                condition: (context) => context.health < 20,
                priority: 10,
            });

            fsm.start();
            fsm.update(0.016);
            expect(ctx.log).toEqual(["idle-update"]);

            ctx.log.length = 0;
            ctx.playerDistance = 50;
            ctx.health = 10;
            fsm.update(0.016);

            expect(fsm.currentState).toBe("flee");
            expect(ctx.log).toEqual(["exit-idle-to-flee"]);
        });

        it("should evaluate state-specific transitions before wildcard transitions", () => {
            const ctx = makeCtx();
            ctx.health = 0;
            const fsm = new StateMachine2D<TestContext>(ctx, "idle");

            fsm.addState({ name: "idle" });
            fsm.addState({ name: "chase" });
            fsm.addState({ name: "dead" });

            fsm.addTransition({
                from: "idle",
                to: "chase",
                condition: () => true,
                priority: 1,
            });
            fsm.addTransition({
                from: "*",
                to: "dead",
                condition: (context) => context.health <= 0,
                priority: 100,
            });

            fsm.start();
            fsm.update(0.016);

            expect(fsm.currentState).toBe("chase");
        });

        it("should support optional transition chaining", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx, "a");

            fsm.addState({ name: "a" });
            fsm.addState({ name: "b" });
            fsm.addState({ name: "c" });
            fsm.addTransition({ from: "a", to: "b", condition: () => true });
            fsm.addTransition({ from: "b", to: "c", condition: () => true });

            fsm.start();
            fsm.update(0.016);
            expect(fsm.currentState).toBe("b");

            fsm.forceState("a");
            fsm.enableTransitionChaining = true;
            fsm.update(0.016);
            expect(fsm.currentState).toBe("c");
        });

        it("should warn when transition chaining reaches the configured limit", () => {
            const warnSpy = jest.spyOn(Logger, "Warn").mockImplementation(() => {});
            const fsm = new StateMachine2D<object>({}, "a");
            fsm.enableTransitionChaining = true;
            fsm.maxTransitionChainLength = 1;

            fsm.addState({ name: "a" });
            fsm.addState({ name: "b" });
            fsm.addState({ name: "c" });
            fsm.addTransition({ from: "a", to: "b", condition: () => true });
            fsm.addTransition({ from: "b", to: "c", condition: () => true });

            fsm.start();
            fsm.update(0.016);

            expect(fsm.currentState).toBe("b");
            expect(warnSpy).toHaveBeenCalledTimes(1);
            warnSpy.mockRestore();
        });
    });

    describe("named transitions", () => {
        it("should fire a named transition from the current state", () => {
            const fsm = new StateMachine2D<object>({}, "idle");
            fsm.addState({ name: "idle" });
            fsm.addState({ name: "attack" });
            fsm.addTransition({ from: "idle", to: "attack", name: "doAttack" });

            fsm.start();

            expect(fsm.trigger("doAttack")).toBe(true);
            expect(fsm.currentState).toBe("attack");
            expect(fsm.previousState).toBe("idle");
        });

        it("should support wildcard named transitions after state-specific ones", () => {
            const ctx = makeCtx();
            ctx.health = 0;
            const fsm = new StateMachine2D<TestContext>(ctx, "idle");

            fsm.addState({ name: "idle" });
            fsm.addState({ name: "attack" });
            fsm.addState({ name: "dead" });
            fsm.addTransition({ from: "idle", to: "attack", name: "doThing", priority: 1 });
            fsm.addTransition({ from: "*", to: "dead", name: "die", condition: (context) => context.health <= 0, priority: 100 });

            fsm.start();

            expect(fsm.trigger("doThing")).toBe(true);
            expect(fsm.currentState).toBe("attack");

            expect(fsm.trigger("die")).toBe(true);
            expect(fsm.currentState).toBe("dead");
        });

        it("should respect conditions on named transitions", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx, "idle");

            fsm.addState({ name: "idle" });
            fsm.addState({ name: "attack" });
            fsm.addTransition({
                from: "idle",
                to: "attack",
                name: "doAttack",
                condition: (context) => context.health > 50,
            });

            fsm.start();
            ctx.health = 10;

            expect(fsm.trigger("doAttack")).toBe(false);
            expect(fsm.currentState).toBe("idle");
        });
    });

    describe("transition removal and forceState", () => {
        it("should remove transitions by source and target", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx, "idle");

            fsm.addState({ name: "idle" });
            fsm.addState({ name: "walk" });
            fsm.addTransition({ from: "idle", to: "walk", condition: () => true });
            fsm.removeTransition("idle", "walk");

            fsm.start();
            fsm.update(0.016);

            expect(fsm.currentState).toBe("idle");
        });

        it("should force state immediately and start when stopped", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx, "idle");

            fsm.addState({
                name: "idle",
                onExit: (context) => {
                    context.log.push("exit-idle");
                },
            });
            fsm.addState({
                name: "dead",
                onEnter: (context, previousState) => {
                    context.log.push(`enter-dead-from-${previousState}`);
                },
            });

            fsm.forceState("dead");
            expect(fsm.currentState).toBe("dead");
            expect(ctx.log).toEqual(["enter-dead-from-"]);

            ctx.log.length = 0;
            fsm.addState({ name: "idle" });
            fsm.forceState("idle");
            expect(ctx.log).toEqual(["exit-idle", "enter-dead-from-idle"]);
        });
    });

    describe("observable and disposal", () => {
        it("should notify on state change", () => {
            const events: Array<{ previousState: string; currentState: string }> = [];
            const fsm = new StateMachine2D<object>({}, "idle");

            fsm.onStateChange.add((eventData) => {
                events.push({ previousState: eventData.previousState, currentState: eventData.currentState });
            });

            fsm.addState({ name: "idle" });
            fsm.addState({ name: "walk" });
            fsm.addTransition({ from: "idle", to: "walk", condition: () => true });

            fsm.start();
            fsm.update(0.016);

            expect(events).toEqual([{ previousState: "idle", currentState: "walk" }]);
        });

        it("should dispose all internal state", () => {
            const fsm = new StateMachine2D<object>({}, "idle");
            fsm.addState({ name: "idle" });
            fsm.start();

            fsm.dispose();

            expect(fsm.isRunning).toBe(false);
            expect(fsm.currentState).toBe("");
            expect(fsm.previousState).toBe("");
            expect(fsm.hasState("idle")).toBe(false);
        });
    });
});