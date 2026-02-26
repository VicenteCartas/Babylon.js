import { Easing } from "2d/Tween/easing";
import { Tween, TweenState, TweenManager } from "2d/Tween/tween";

describe("Easing", () => {
    const easings: Array<[string, (t: number) => number]> = [
        ["Linear", Easing.Linear],
        ["QuadIn", Easing.QuadIn],
        ["QuadOut", Easing.QuadOut],
        ["QuadInOut", Easing.QuadInOut],
        ["CubicIn", Easing.CubicIn],
        ["CubicOut", Easing.CubicOut],
        ["CubicInOut", Easing.CubicInOut],
        ["SineIn", Easing.SineIn],
        ["SineOut", Easing.SineOut],
        ["SineInOut", Easing.SineInOut],
        ["ExpoIn", Easing.ExpoIn],
        ["ExpoOut", Easing.ExpoOut],
        ["BackIn", Easing.BackIn],
        ["BackOut", Easing.BackOut],
        ["ElasticOut", Easing.ElasticOut],
        ["BounceOut", Easing.BounceOut],
    ];

    it.each(easings)("%s should return 0 at t=0", (_name, fn) => {
        expect(fn(0)).toBeCloseTo(0, 5);
    });

    it.each(easings)("%s should return 1 at t=1", (_name, fn) => {
        expect(fn(1)).toBeCloseTo(1, 5);
    });

    it("Linear should be identity", () => {
        expect(Easing.Linear(0.5)).toBe(0.5);
        expect(Easing.Linear(0.25)).toBe(0.25);
    });

    it("QuadIn should accelerate (midpoint < 0.5)", () => {
        expect(Easing.QuadIn(0.5)).toBeLessThan(0.5);
    });

    it("QuadOut should decelerate (midpoint > 0.5)", () => {
        expect(Easing.QuadOut(0.5)).toBeGreaterThan(0.5);
    });

    it("CubicInOut should be symmetric around 0.5", () => {
        expect(Easing.CubicInOut(0.5)).toBeCloseTo(0.5, 5);
    });

    it("BounceOut should produce multiple bounces", () => {
        // Check several points are valid (0-1 range, progressing)
        const values = [0.1, 0.3, 0.5, 0.7, 0.9].map(Easing.BounceOut);
        for (const v of values) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
        }
    });

    it("BackIn should go negative at start", () => {
        expect(Easing.BackIn(0.1)).toBeLessThan(0);
    });

    it("BackOut should overshoot past 1", () => {
        expect(Easing.BackOut(0.9)).toBeGreaterThan(1);
    });
});

describe("Tween", () => {
    describe("basic interpolation", () => {
        it("should interpolate from 0 to 100 linearly", () => {
            let value = 0;
            const tw = new Tween({ from: 0, to: 100 }, 1)
                .onUpdate((v) => { value = v; })
                .start();

            tw.update(0.5);
            expect(value).toBeCloseTo(50, 5);

            tw.update(0.5);
            expect(value).toBeCloseTo(100, 5);
            expect(tw.isComplete).toBe(true);
        });

        it("should interpolate with easing", () => {
            let value = 0;
            const tw = new Tween({ from: 0, to: 100 }, 1, Easing.QuadIn)
                .onUpdate((v) => { value = v; })
                .start();

            tw.update(0.5);
            // QuadIn(0.5) = 0.25, so value should be 25
            expect(value).toBeCloseTo(25, 5);
        });

        it("should interpolate negative ranges", () => {
            let value = 0;
            const tw = new Tween({ from: 100, to: -100 }, 1)
                .onUpdate((v) => { value = v; })
                .start();

            tw.update(0.5);
            expect(value).toBeCloseTo(0, 5);

            tw.update(0.5);
            expect(value).toBeCloseTo(-100, 5);
        });

        it("should handle zero duration (instant)", () => {
            let value = 0;
            let complete = false;
            const tw = new Tween({ from: 0, to: 42 }, 0)
                .onUpdate((v) => { value = v; })
                .onComplete(() => { complete = true; })
                .start();

            tw.update(0.001);
            expect(value).toBe(42);
            expect(complete).toBe(true);
            expect(tw.isComplete).toBe(true);
        });
    });

    describe("delay", () => {
        it("should wait before starting", () => {
            let value = 0;
            const tw = new Tween({ from: 0, to: 100 }, 1)
                .setDelay(0.5)
                .onUpdate((v) => { value = v; })
                .start();

            tw.update(0.3); // Still in delay
            expect(value).toBe(0);
            expect(tw.state).toBe(TweenState.Pending);

            tw.update(0.7); // 0.5 delay + 0.5 active = at 50%
            expect(value).toBeCloseTo(50, 5);
        });
    });

    describe("state", () => {
        it("should transition through states correctly", () => {
            const tw = new Tween({ from: 0, to: 100 }, 1).start();

            expect(tw.state).toBe(TweenState.Pending);

            tw.update(0.1);
            expect(tw.state).toBe(TweenState.Running);

            tw.update(1.0);
            expect(tw.state).toBe(TweenState.Complete);
        });

        it("should not update after complete", () => {
            let updateCount = 0;
            const tw = new Tween({ from: 0, to: 100 }, 0.5)
                .onUpdate(() => { updateCount++; })
                .start();

            tw.update(1.0); // Complete
            const count = updateCount;
            tw.update(1.0); // Should be ignored
            expect(updateCount).toBe(count);
        });

        it("progress should reflect completion", () => {
            const tw = new Tween({ from: 0, to: 100 }, 1).start();
            expect(tw.progress).toBe(0);

            tw.update(0.5);
            expect(tw.progress).toBeCloseTo(0.5, 5);

            tw.update(0.5);
            expect(tw.progress).toBe(1);
        });
    });

    describe("callbacks and observables", () => {
        it("should fire onComplete when done", () => {
            let complete = false;
            const tw = new Tween({ from: 0, to: 100 }, 0.5)
                .onComplete(() => { complete = true; })
                .start();

            tw.update(0.5);
            expect(complete).toBe(true);
        });

        it("should fire onCompleteObservable", () => {
            let observed = false;
            const tw = new Tween({ from: 0, to: 100 }, 0.5).start();
            tw.onCompleteObservable.add(() => { observed = true; });

            tw.update(0.5);
            expect(observed).toBe(true);
        });

        it("should fire onUpdateObservable each frame", () => {
            const values: number[] = [];
            const tw = new Tween({ from: 0, to: 100 }, 1).start();
            tw.onUpdateObservable.add((v) => { values.push(v); });

            tw.update(0.25);
            tw.update(0.25);
            tw.update(0.25);
            expect(values.length).toBe(3);
        });
    });

    describe("loop and repeat", () => {
        it("should repeat the specified number of times", () => {
            let completeCount = 0;
            const values: number[] = [];
            const tw = new Tween({ from: 0, to: 100 }, 0.5)
                .setRepeat(2)
                .onUpdate((v) => { values.push(v); })
                .onComplete(() => { completeCount++; })
                .start();

            tw.update(0.5); // First play complete
            tw.update(0.5); // Repeat 1 complete
            tw.update(0.5); // Repeat 2 complete — done
            expect(tw.isComplete).toBe(true);
            expect(completeCount).toBe(1);
        });

        it("should yoyo (reverse) on repeat", () => {
            const values: number[] = [];
            const tw = new Tween({ from: 0, to: 100 }, 1)
                .setRepeat(1, true)
                .onUpdate((v) => { values.push(v); })
                .start();

            // Forward
            tw.update(1.0);
            const forwardEnd = values[values.length - 1];
            expect(forwardEnd).toBeCloseTo(100, 0);

            // Reverse (yoyo)
            tw.update(0.5);
            const mid = values[values.length - 1];
            expect(mid).toBeCloseTo(50, 0);

            tw.update(0.5);
            const reverseEnd = values[values.length - 1];
            expect(reverseEnd).toBeCloseTo(0, 0);
        });
    });

    describe("chaining", () => {
        it("should start chained tween on completion", () => {
            let firstDone = false;
            let secondStarted = false;

            const second = new Tween({ from: 200, to: 300 }, 0.5)
                .onUpdate(() => { secondStarted = true; });

            const first = new Tween({ from: 0, to: 100 }, 0.5)
                .onComplete(() => { firstDone = true; })
                .chain(second)
                .start();

            first.update(0.5);
            expect(firstDone).toBe(true);
            expect(second.state).not.toBe(TweenState.Complete);

            // Second should now be started
            second.update(0.5);
            expect(secondStarted).toBe(true);
            expect(second.isComplete).toBe(true);
        });
    });

    describe("complete and stop", () => {
        it("complete() should jump to final value", () => {
            let value = 0;
            let complete = false;
            const tw = new Tween({ from: 0, to: 100 }, 10)
                .onUpdate((v) => { value = v; })
                .onComplete(() => { complete = true; })
                .start();

            tw.update(0.1);
            tw.complete();
            expect(value).toBe(100);
            expect(complete).toBe(true);
        });

        it("stop() should freeze at current value without onComplete", () => {
            let value = 0;
            let complete = false;
            const tw = new Tween({ from: 0, to: 100 }, 1)
                .onUpdate((v) => { value = v; })
                .onComplete(() => { complete = true; })
                .start();

            tw.update(0.5);
            const stoppedValue = value;
            tw.stop();
            expect(tw.isComplete).toBe(true);
            expect(complete).toBe(false);
            expect(value).toBe(stoppedValue);
        });
    });

    describe("static factory", () => {
        it("Create should create and start a tween", () => {
            let value = 0;
            const tw = Tween.Create(0, 100, 1, Easing.Linear, (v) => { value = v; });
            expect(tw.state).not.toBe(TweenState.Complete);

            tw.update(1.0);
            expect(value).toBeCloseTo(100, 5);
        });
    });

    describe("dispose", () => {
        it("should clear callbacks and mark complete", () => {
            let updateCount = 0;
            const tw = new Tween({ from: 0, to: 100 }, 1)
                .onUpdate(() => { updateCount++; })
                .start();

            tw.update(0.1);
            const count = updateCount;
            tw.dispose();
            tw.update(0.5);
            expect(updateCount).toBe(count); // No more updates
            expect(tw.isComplete).toBe(true);
        });
    });
});

describe("TweenManager", () => {
    it("should update all tweens and remove completed ones", () => {
        const manager = new TweenManager();
        let v1 = 0;
        let v2 = 0;

        manager.add(new Tween({ from: 0, to: 100 }, 0.5).onUpdate((v) => { v1 = v; }).start());
        manager.add(new Tween({ from: 0, to: 200 }, 1.0).onUpdate((v) => { v2 = v; }).start());
        expect(manager.count).toBe(2);

        manager.update(0.5);
        expect(v1).toBeCloseTo(100, 5);
        expect(v2).toBeCloseTo(100, 5);
        expect(manager.count).toBe(1); // First tween removed

        manager.update(0.5);
        expect(v2).toBeCloseTo(200, 5);
        expect(manager.count).toBe(0);
    });

    it("stopAll should stop and remove all tweens", () => {
        const manager = new TweenManager();
        manager.add(new Tween({ from: 0, to: 100 }, 1).start());
        manager.add(new Tween({ from: 0, to: 100 }, 1).start());
        expect(manager.count).toBe(2);

        manager.stopAll();
        expect(manager.count).toBe(0);
    });

    it("dispose should clean up everything", () => {
        const manager = new TweenManager();
        manager.add(new Tween({ from: 0, to: 100 }, 1).start());
        manager.dispose();
        expect(manager.count).toBe(0);
    });
});
