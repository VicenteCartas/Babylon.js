import { AnimatedSprite2D } from "2d/AnimatedSprite2D/animatedSprite2D";
import { Rectangle2D } from "2d/Math/rectangle2D";
import { SpriteSheet } from "2d/SpriteSheet/spriteSheet";
import { Logger } from "core/Misc/logger";

const mockTexture = { getSize: () => ({ width: 128, height: 128 }) } as any;

function createAnimatedSprite(): { sheet: SpriteSheet; sprite: AnimatedSprite2D } {
    const sheet = SpriteSheet.fromGrid(mockTexture, 32, 32);
    const sprite = new AnimatedSprite2D("hero", sheet);
    sprite.addClip({ name: "walk", frames: [0, 1, 2, 3], fps: 10 });
    sprite.addClip({ name: "idle", frames: [0], fps: 1 });
    sprite.addClip({ name: "attack", frames: [4, 5, 6], fps: 12, loop: false });
    return { sheet, sprite };
}

describe("AnimatedSprite2D", () => {
    let sheet: SpriteSheet;
    let sprite: AnimatedSprite2D;

    beforeEach(() => {
        const setup = createAnimatedSprite();
        sheet = setup.sheet;
        sprite = setup.sprite;
    });

    describe("constructor", () => {
        it("should set the sprite sheet", () => {
            expect(sprite.spriteSheet).toBe(sheet);
        });

        it("should set the texture from the sprite sheet", () => {
            expect(sprite.texture).toBe(mockTexture);
        });

        it("should start stopped with no current clip", () => {
            expect(sprite.currentClip).toBeNull();
            expect(sprite.currentFrameIndex).toBe(0);
            expect(sprite.isPaused).toBe(false);
        });

        it("should have default playbackSpeed of 1", () => {
            expect(sprite.playbackSpeed).toBe(1);
        });
    });

    describe("play", () => {
        it("should start playing a clip", () => {
            sprite.play("walk");
            expect(sprite.currentClip).toBe("walk");
            expect(sprite.currentFrameIndex).toBe(0);
            expect(sprite.isPaused).toBe(false);
        });

        it("should set sourceRect to the first frame", () => {
            sprite.play("walk");
            const frame0 = sheet.getFrameRect(0, new Rectangle2D());
            expect(sprite.sourceRect).toEqual(frame0);
        });

        it("should not restart the same clip unless forceRestart is true", () => {
            sprite.play("walk");
            sprite.advanceTime(0.15);
            const frameBefore = sprite.currentFrameIndex;
            sprite.play("walk");
            expect(sprite.currentFrameIndex).toBe(frameBefore);
        });

        it("should restart the same clip when forceRestart is true", () => {
            sprite.play("walk");
            sprite.advanceTime(0.15);
            sprite.play("walk", true);
            expect(sprite.currentClip).toBe("walk");
            expect(sprite.currentFrameIndex).toBe(0);
        });

        it("should switch to a different clip", () => {
            sprite.play("walk");
            sprite.advanceTime(0.15);
            sprite.play("attack");
            expect(sprite.currentClip).toBe("attack");
            expect(sprite.currentFrameIndex).toBe(0);
        });

        it("should ignore unknown clip names", () => {
            const warnSpy = jest.spyOn(Logger, "Warn").mockImplementation(() => {});

            try {
                sprite.play("nonexistent");
                expect(sprite.currentClip).toBeNull();
                expect(sprite.currentFrameIndex).toBe(0);
            } finally {
                warnSpy.mockRestore();
            }
        });
    });

    describe("pause / resume / stop", () => {
        it("should pause the current clip without advancing", () => {
            sprite.play("walk");
            sprite.advanceTime(0.15);
            const frame = sprite.currentFrameIndex;

            sprite.pause();
            expect(sprite.isPaused).toBe(true);

            sprite.advanceTime(0.5);
            expect(sprite.currentFrameIndex).toBe(frame);
        });

        it("should resume a paused clip", () => {
            sprite.play("walk");
            sprite.advanceTime(0.15);
            sprite.pause();
            sprite.resume();

            expect(sprite.isPaused).toBe(false);
            sprite.advanceTime(0.1);
            expect(sprite.currentFrameIndex).toBe(2);
        });

        it("should stop playback and reset to the first frame", () => {
            sprite.play("walk");
            sprite.advanceTime(0.15);
            sprite.stop();

            expect(sprite.currentClip).toBeNull();
            expect(sprite.currentFrameIndex).toBe(0);
            expect(sprite.isPaused).toBe(false);
        });
    });

    describe("frame advancement", () => {
        it("should auto-advance through the onUpdate hook", () => {
            sprite.play("walk");
            sprite.update(0.1);
            expect(sprite.currentFrameIndex).toBe(1);
        });

        it("should loop clips by default", () => {
            const loops: string[] = [];
            sprite.onLoop.add((clipName) => loops.push(clipName));

            sprite.play("walk");
            sprite.advanceTime(0.4);

            expect(sprite.currentClip).toBe("walk");
            expect(sprite.currentFrameIndex).toBe(0);
            expect(loops).toEqual(["walk"]);
        });

        it("should stop at the last frame for non-looping clips", () => {
            sprite.play("attack");
            sprite.advanceTime(0.5);

            expect(sprite.currentClip).toBeNull();
            expect(sprite.currentFrameIndex).toBe(2);
        });

        it("should respect playbackSpeed", () => {
            sprite.playbackSpeed = 2;
            sprite.play("walk");
            sprite.advanceTime(0.05);
            expect(sprite.currentFrameIndex).toBe(1);
        });

        it("should not advance while stopped", () => {
            sprite.play("walk");
            sprite.stop();
            sprite.advanceTime(1.0);
            expect(sprite.currentFrameIndex).toBe(0);
        });

        it("should skip multiple frames when deltaTime is large", () => {
            sprite.play("walk");
            sprite.advanceTime(0.25);
            expect(sprite.currentFrameIndex).toBe(2);
        });

        it("should clamp gotoFrame to the clip bounds", () => {
            sprite.play("walk");
            sprite.gotoFrame(99);
            expect(sprite.currentFrameIndex).toBe(3);

            sprite.gotoFrame(-2);
            expect(sprite.currentFrameIndex).toBe(0);
        });

        it("should support ping-pong looping clips", () => {
            sprite.addClip({ name: "ping", frames: [0, 1, 2], fps: 10, loop: true, pingPong: true });
            sprite.play("ping");

            sprite.advanceTime(0.1);
            expect(sprite.currentFrameIndex).toBe(1);

            sprite.advanceTime(0.1);
            expect(sprite.currentFrameIndex).toBe(2);

            sprite.advanceTime(0.1);
            expect(sprite.currentFrameIndex).toBe(1);

            sprite.advanceTime(0.1);
            expect(sprite.currentFrameIndex).toBe(0);
        });
    });

    describe("observables", () => {
        it("should fire onFrameChange when the displayed frame changes", () => {
            const frames: number[] = [];
            sprite.onFrameChange.add((frameIndex) => frames.push(frameIndex));

            sprite.play("walk");
            sprite.advanceTime(0.1);

            expect(frames).toEqual([0, 1]);
        });

        it("should fire onAnimationEnd for non-looping clips", () => {
            const ended: string[] = [];
            sprite.onAnimationEnd.add((clipName) => ended.push(clipName));

            sprite.play("attack");
            sprite.advanceTime(0.5);

            expect(ended).toEqual(["attack"]);
        });

        it("should fire onLoop when a looping clip wraps", () => {
            const loops: string[] = [];
            sprite.onLoop.add((clipName) => loops.push(clipName));

            sprite.play("walk");
            sprite.advanceTime(0.4);

            expect(loops).toEqual(["walk"]);
        });
    });

    describe("dispose", () => {
        it("should clear observables", () => {
            let called = false;
            sprite.onAnimationEnd.add(() => {
                called = true;
            });

            sprite.dispose();
            sprite.onAnimationEnd.notifyObservers("walk");

            expect(called).toBe(false);
        });
    });
});
