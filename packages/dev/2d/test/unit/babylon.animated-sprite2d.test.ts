import { AnimatedSprite2D } from "2d/AnimatedSprite2D/animatedSprite2D";
import { SpriteSheet } from "2d/SpriteSheet/spriteSheet";

const mockTexture = { getSize: () => ({ width: 128, height: 128 }) } as any;

function createSheet(): SpriteSheet {
    const sheet = SpriteSheet.FromGrid(mockTexture, 32, 32);
    sheet.defineAnimation("walk", [0, 1, 2, 3], 10);
    sheet.defineAnimation("idle", [0], 1);
    sheet.defineAnimation("attack", [4, 5, 6], 12);
    return sheet;
}

describe("AnimatedSprite2D", () => {
    let sheet: SpriteSheet;
    let sprite: AnimatedSprite2D;

    beforeEach(() => {
        sheet = createSheet();
        sprite = new AnimatedSprite2D("hero", sheet);
    });

    describe("constructor", () => {
        it("should set the sprite sheet", () => {
            expect(sprite.spriteSheet).toBe(sheet);
        });

        it("should set the texture from the sprite sheet", () => {
            expect(sprite.texture).toBe(mockTexture);
        });

        it("should not be playing initially", () => {
            expect(sprite.isPlaying).toBe(false);
            expect(sprite.currentAnimation).toBe("");
        });

        it("should have default speed of 1", () => {
            expect(sprite.speed).toBe(1);
        });
    });

    describe("play", () => {
        it("should start playing an animation", () => {
            sprite.play("walk");
            expect(sprite.isPlaying).toBe(true);
            expect(sprite.currentAnimation).toBe("walk");
            expect(sprite.currentFrame).toBe(0);
        });

        it("should set sourceRect to the first frame", () => {
            sprite.play("walk");
            const frame0 = sheet.getFrame(0);
            expect(sprite.sourceRect).toEqual(frame0);
        });

        it("should not restart if already playing the same animation", () => {
            sprite.play("walk");
            // Advance a few frames
            sprite.update(0.15);
            const frameBefore = sprite.currentFrame;
            sprite.play("walk");
            expect(sprite.currentFrame).toBe(frameBefore);
        });

        it("should restart if playing a different animation", () => {
            sprite.play("walk");
            sprite.update(0.15);
            sprite.play("attack");
            expect(sprite.currentAnimation).toBe("attack");
            expect(sprite.currentFrame).toBe(0);
        });

        it("should ignore unknown animation names", () => {
            sprite.play("nonexistent");
            expect(sprite.isPlaying).toBe(false);
        });
    });

    describe("stop / pause", () => {
        it("should stop the animation", () => {
            sprite.play("walk");
            sprite.stop();
            expect(sprite.isPlaying).toBe(false);
        });

        it("should pause the animation", () => {
            sprite.play("walk");
            sprite.update(0.15);
            const frame = sprite.currentFrame;
            sprite.pause();
            expect(sprite.isPlaying).toBe(false);
            sprite.update(0.5);
            expect(sprite.currentFrame).toBe(frame);
        });
    });

    describe("update / frame advancement", () => {
        it("should advance frames based on deltaTime and frameRate", () => {
            sprite.play("walk"); // 10fps → 0.1s per frame
            sprite.update(0.1);
            expect(sprite.currentFrame).toBe(1);
        });

        it("should loop when loop is true", () => {
            sprite.play("walk", true); // 4 frames at 10fps
            // Advance past last frame
            sprite.update(0.4);
            expect(sprite.isPlaying).toBe(true);
            expect(sprite.currentFrame).toBeLessThan(4);
        });

        it("should stop at last frame when loop is false", () => {
            sprite.play("walk", false); // 4 frames at 10fps
            sprite.update(0.5); // Well past the end
            expect(sprite.isPlaying).toBe(false);
            expect(sprite.currentFrame).toBe(3); // Last frame
        });

        it("should respect speed multiplier", () => {
            sprite.speed = 2;
            sprite.play("walk"); // 10fps → 0.1s per frame, but 2x speed → 0.05s per frame
            sprite.update(0.05);
            expect(sprite.currentFrame).toBe(1);
        });

        it("should not advance when not playing", () => {
            sprite.play("walk");
            sprite.stop();
            sprite.update(1.0);
            expect(sprite.currentFrame).toBe(0);
        });

        it("should skip multiple frames when dt is large", () => {
            sprite.play("walk"); // 10fps, 4 frames
            sprite.update(0.25); // Should advance 2 frames
            expect(sprite.currentFrame).toBe(2);
        });
    });

    describe("observables", () => {
        it("should fire onFrameChange when frame changes", () => {
            const frames: number[] = [];
            sprite.onFrameChange.add((f) => frames.push(f));
            sprite.play("walk");
            expect(frames).toEqual([0]); // Initial frame
            sprite.update(0.1);
            expect(frames).toEqual([0, 1]);
        });

        it("should fire onAnimationEnd when non-looping animation finishes", () => {
            const ended: string[] = [];
            sprite.onAnimationEnd.add((name) => ended.push(name));
            sprite.play("walk", false);
            sprite.update(0.5);
            expect(ended).toEqual(["walk"]);
        });

        it("should not fire onAnimationEnd for looping animations", () => {
            const ended: string[] = [];
            sprite.onAnimationEnd.add((name) => ended.push(name));
            sprite.play("walk", true);
            sprite.update(2.0); // Many loops
            expect(ended).toHaveLength(0);
        });
    });

    describe("dispose", () => {
        it("should clear observables", () => {
            let called = false;
            sprite.onAnimationEnd.add(() => { called = true; });
            sprite.dispose();
            sprite.onAnimationEnd.notifyObservers("walk");
            expect(called).toBe(false);
        });
    });
});
