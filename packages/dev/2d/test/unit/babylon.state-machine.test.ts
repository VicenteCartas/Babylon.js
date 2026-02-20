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
    describe("basic state management", () => {
        it("should register and start in initial state", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx);

            fsm.addState({ name: "idle" });
            fsm.addState({ name: "walk" });
            fsm.start("idle");

            expect(fsm.currentState).toBe("idle");
            expect(fsm.isStarted).toBe(true);
        });

        it("should call onEnter when starting", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx);

            fsm.addState({
                name: "idle",
                onEnter: (c, prev) => {
                    c.log.push(`enter-idle-from-${prev}`);
                },
            });
            fsm.start("idle");

            expect(ctx.log).toEqual(["enter-idle-from-"]);
        });

        it("should call onUpdate each frame", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx);

            fsm.addState({
                name: "idle",
                onUpdate: (c, dt) => {
                    c.log.push(`update-${dt}`);
                },
            });
            fsm.start("idle");
            fsm.update(0.016);
            fsm.update(0.016);

            expect(ctx.log.length).toBe(2);
        });

        it("should throw when adding duplicate state", () => {
            const fsm = new StateMachine2D(null);
            fsm.addState({ name: "idle" });
            expect(() => fsm.addState({ name: "idle" })).toThrow('State "idle" already exists');
        });

        it("should throw when starting with unknown state", () => {
            const fsm = new StateMachine2D(null);
            expect(() => fsm.start("nonexistent")).toThrow('State "nonexistent" not found');
        });

        it("should not update if not started", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx);
            fsm.addState({
                name: "idle",
                onUpdate: (c) => c.log.push("updated"),
            });
            fsm.update(0.016);
            expect(ctx.log.length).toBe(0);
        });

        it("should support hasState", () => {
            const fsm = new StateMachine2D(null);
            fsm.addState({ name: "idle" });
            expect(fsm.hasState("idle")).toBe(true);
            expect(fsm.hasState("walk")).toBe(false);
        });

        it("should support chaining", () => {
            const fsm = new StateMachine2D(null);
            const result = fsm.addState({ name: "idle" }).addState({ name: "walk" });
            expect(result).toBe(fsm);
        });
    });

    describe("auto-transitions", () => {
        it("should transition when condition becomes true", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx);

            fsm.addState({
                name: "idle",
                onExit: (c, next) => c.log.push(`exit-idle-to-${next}`),
            });
            fsm.addState({
                name: "chase",
                onEnter: (c, prev) => c.log.push(`enter-chase-from-${prev}`),
            });
            fsm.addTransition({
                from: "idle",
                to: "chase",
                condition: (c) => c.playerDistance < 100,
            });

            fsm.start("idle");
            expect(fsm.currentState).toBe("idle");

            // Distance still large — no transition
            fsm.update(0.016);
            expect(fsm.currentState).toBe("idle");

            // Player comes close
            ctx.playerDistance = 50;
            fsm.update(0.016);
            expect(fsm.currentState).toBe("chase");
            expect(ctx.log).toContain("exit-idle-to-chase");
            expect(ctx.log).toContain("enter-chase-from-idle");
        });

        it("should respect priority ordering", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx);

            fsm.addState({ name: "idle" });
            fsm.addState({ name: "flee" });
            fsm.addState({ name: "chase" });

            // Both conditions will be true, but flee has higher priority
            fsm.addTransition({
                from: "idle",
                to: "chase",
                condition: (c) => c.playerDistance < 100,
                priority: 1,
            });
            fsm.addTransition({
                from: "idle",
                to: "flee",
                condition: (c) => c.health < 20,
                priority: 10,
            });

            fsm.start("idle");
            ctx.playerDistance = 50;
            ctx.health = 10;
            fsm.update(0.016);

            expect(fsm.currentState).toBe("flee");
        });

        it("should only fire one transition per update", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx);

            fsm.addState({
                name: "a",
                onExit: (c) => c.log.push("exit-a"),
            });
            fsm.addState({
                name: "b",
                onEnter: (c) => c.log.push("enter-b"),
            });
            fsm.addState({
                name: "c",
                onEnter: (c) => c.log.push("enter-c"),
            });

            fsm.addTransition({ from: "a", to: "b", condition: () => true });
            fsm.addTransition({ from: "b", to: "c", condition: () => true });

            fsm.start("a");
            fsm.update(0.016);

            // Should only go A → B, not A → B → C in one update
            expect(fsm.currentState).toBe("b");
        });

        it("should not transition to same state", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx);

            fsm.addState({
                name: "idle",
                onEnter: (c) => c.log.push("enter"),
                onExit: (c) => c.log.push("exit"),
            });
            fsm.addTransition({ from: "idle", to: "idle", condition: () => true });

            fsm.start("idle");
            ctx.log.length = 0; // Clear initial onEnter
            fsm.update(0.016);

            // Should not re-enter same state
            expect(ctx.log.length).toBe(0);
        });
    });

    describe("named triggers", () => {
        it("should fire named transition", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx);

            fsm.addState({ name: "idle" });
            fsm.addState({ name: "attack" });
            fsm.addTransition({ from: "idle", to: "attack", name: "doAttack" });

            fsm.start("idle");
            const fired = fsm.trigger("doAttack");

            expect(fired).toBe(true);
            expect(fsm.currentState).toBe("attack");
        });

        it("should not fire if from state doesn't match", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx);

            fsm.addState({ name: "idle" });
            fsm.addState({ name: "attack" });
            fsm.addState({ name: "dead" });
            fsm.addTransition({ from: "attack", to: "dead", name: "die" });

            fsm.start("idle");
            const fired = fsm.trigger("die");

            expect(fired).toBe(false);
            expect(fsm.currentState).toBe("idle");
        });

        it("should not fire if guard fails", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx);

            fsm.addState({ name: "idle" });
            fsm.addState({ name: "attack" });
            fsm.addTransition({
                from: "idle",
                to: "attack",
                name: "doAttack",
                condition: (c) => c.health > 50,
            });

            fsm.start("idle");
            ctx.health = 10;
            const fired = fsm.trigger("doAttack");

            expect(fired).toBe(false);
            expect(fsm.currentState).toBe("idle");
        });

        it("should return false for unknown transition name", () => {
            const fsm = new StateMachine2D(null);
            fsm.addState({ name: "idle" });
            fsm.start("idle");
            expect(fsm.trigger("nonexistent")).toBe(false);
        });
    });

    describe("forceState", () => {
        it("should bypass guards and transition immediately", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx);

            fsm.addState({
                name: "idle",
                onExit: (c) => c.log.push("exit-idle"),
            });
            fsm.addState({
                name: "dead",
                onEnter: (c) => c.log.push("enter-dead"),
            });

            fsm.start("idle");
            fsm.forceState("dead");

            expect(fsm.currentState).toBe("dead");
            expect(ctx.log).toContain("exit-idle");
            expect(ctx.log).toContain("enter-dead");
        });

        it("should start the machine if not started", () => {
            const fsm = new StateMachine2D(null);
            fsm.addState({ name: "idle" });
            fsm.forceState("idle");

            expect(fsm.isStarted).toBe(true);
            expect(fsm.currentState).toBe("idle");
        });

        it("should throw for unknown state", () => {
            const fsm = new StateMachine2D(null);
            expect(() => fsm.forceState("nonexistent")).toThrow('State "nonexistent" not found');
        });
    });

    describe("onStateChange observable", () => {
        it("should notify on state change", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx);
            const events: { prev: string; curr: string }[] = [];

            fsm.onStateChange.add((evt) => {
                events.push({ prev: evt.previousState, curr: evt.currentState });
            });

            fsm.addState({ name: "idle" });
            fsm.addState({ name: "walk" });
            fsm.addTransition({ from: "idle", to: "walk", condition: () => true });

            fsm.start("idle");
            fsm.update(0.016);

            expect(events.length).toBe(1);
            expect(events[0]).toEqual({ prev: "idle", curr: "walk" });
        });
    });

    describe("transition validation", () => {
        it("should throw when adding transition with unknown from state", () => {
            const fsm = new StateMachine2D(null);
            fsm.addState({ name: "idle" });
            expect(() =>
                fsm.addTransition({ from: "nonexistent", to: "idle" })
            ).toThrow('Source state "nonexistent" not found');
        });

        it("should throw when adding transition with unknown to state", () => {
            const fsm = new StateMachine2D(null);
            fsm.addState({ name: "idle" });
            expect(() =>
                fsm.addTransition({ from: "idle", to: "nonexistent" })
            ).toThrow('Target state "nonexistent" not found');
        });
    });

    describe("dispose", () => {
        it("should reset all state", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx);

            fsm.addState({ name: "idle" });
            fsm.addState({ name: "walk" });
            fsm.addTransition({ from: "idle", to: "walk", condition: () => true });
            fsm.start("idle");

            fsm.dispose();

            expect(fsm.isStarted).toBe(false);
            expect(fsm.currentState).toBe("");
            expect(fsm.hasState("idle")).toBe(false);
        });
    });

    describe("real-world: enemy AI", () => {
        it("should model a patrol/chase/flee AI", () => {
            const ctx = makeCtx();
            const fsm = new StateMachine2D<TestContext>(ctx);

            fsm.addState({
                name: "patrol",
                onEnter: (c) => c.log.push("patrolling"),
                onUpdate: (c) => c.log.push("patrolUpdate"),
            });
            fsm.addState({
                name: "chase",
                onEnter: (c) => c.log.push("chasing"),
            });
            fsm.addState({
                name: "flee",
                onEnter: (c) => c.log.push("fleeing"),
            });

            fsm.addTransition({
                from: "patrol",
                to: "chase",
                condition: (c) => c.playerDistance < 100,
                priority: 1,
            });
            fsm.addTransition({
                from: "patrol",
                to: "flee",
                condition: (c) => c.health < 20,
                priority: 10,
            });
            fsm.addTransition({
                from: "chase",
                to: "flee",
                condition: (c) => c.health < 20,
            });
            fsm.addTransition({
                from: "chase",
                to: "patrol",
                condition: (c) => c.playerDistance > 200,
            });

            fsm.start("patrol");
            expect(fsm.currentState).toBe("patrol");

            fsm.update(0.016);
            expect(fsm.currentState).toBe("patrol");
            expect(ctx.log).toContain("patrolUpdate");

            // Player approaches
            ctx.playerDistance = 50;
            fsm.update(0.016);
            expect(fsm.currentState).toBe("chase");

            // Player retreats
            ctx.playerDistance = 300;
            fsm.update(0.016);
            expect(fsm.currentState).toBe("patrol");

            // Low health triggers flee from patrol
            ctx.health = 10;
            ctx.playerDistance = 50;
            fsm.update(0.016);
            // Flee has higher priority than chase
            expect(fsm.currentState).toBe("flee");
        });
    });
});
