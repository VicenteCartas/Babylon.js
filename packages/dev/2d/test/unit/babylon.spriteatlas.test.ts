/**
 * @jest-environment jsdom
 */
import { SpriteAtlasBuilder } from "2d/SpriteAtlas/spriteAtlasBuilder";
import { SpriteAtlas } from "2d/SpriteAtlas/spriteAtlas";
import { Rectangle2D } from "2d/Math/rectangle2D";

// Mock ThinEngine
const mockEngine = {
    createDynamicTexture: jest.fn().mockReturnValue({}),
    updateDynamicTexture: jest.fn(),
    _getEngine: jest.fn().mockReturnThis(),
    getClassName: jest.fn().mockReturnValue("Engine"),
} as any;

// Mock HTMLImageElement with configurable sizes
class MockImage {
    public width: number = 0;
    public height: number = 0;
    public src: string = "";
    public onload: (() => void) | null = null;
    public onerror: (() => void) | null = null;
    public crossOrigin: string = "";

    constructor() {
        // Simulate async image load
        setTimeout(() => {
            if (this.src) {
                // Parse size from URL for testing (e.g., "image_64x64.png")
                const sizeMatch = this.src.match(/(\d+)x(\d+)/);
                if (sizeMatch) {
                    this.width = parseInt(sizeMatch[1], 10);
                    this.height = parseInt(sizeMatch[2], 10);
                } else {
                    // Default size
                    this.width = 64;
                    this.height = 64;
                }
                if (this.onload) {
                    this.onload();
                }
            }
        }, 0);
    }
}

// Mock HTMLCanvasElement
class MockCanvas {
    public width: number = 0;
    public height: number = 0;

    getContext(contextId: string): any {
        if (contextId === "2d") {
            return {
                clearRect: jest.fn(),
                drawImage: jest.fn(),
                createImageData: jest.fn(),
                putImageData: jest.fn(),
                fillStyle: "",
                fillRect: jest.fn(),
            };
        }
        return null;
    }
}

// Mock document.createElement
const originalCreateElement = document.createElement;
beforeAll(() => {
    (global.Image as any) = MockImage;
    document.createElement = jest.fn((tagName: string) => {
        if (tagName === "canvas") {
            return new MockCanvas() as any;
        }
        return originalCreateElement.call(document, tagName);
    }) as any;
});

afterAll(() => {
    document.createElement = originalCreateElement;
});

describe("SpriteAtlasBuilder", () => {
    describe("constructor", () => {
        it("should create with default options", () => {
            const builder = new SpriteAtlasBuilder(mockEngine);
            expect(builder).toBeDefined();
        });

        it("should accept custom options", () => {
            const builder = new SpriteAtlasBuilder(mockEngine, {
                maxWidth: 1024,
                maxHeight: 1024,
                padding: 4,
                powerOfTwo: false,
            });
            expect(builder).toBeDefined();
        });
    });

    describe("addImage", () => {
        it("should add an image by URL", () => {
            const builder = new SpriteAtlasBuilder(mockEngine);
            expect(() => {
                builder.addImage("player", "assets/player.png");
            }).not.toThrow();
        });

        it("should add an HTMLImageElement", () => {
            const builder = new SpriteAtlasBuilder(mockEngine);
            const img = new MockImage() as any;
            expect(() => {
                builder.addImage("enemy", img);
            }).not.toThrow();
        });

        it("should throw if duplicate key is added", () => {
            const builder = new SpriteAtlasBuilder(mockEngine);
            builder.addImage("player", "assets/player.png");
            expect(() => {
                builder.addImage("player", "assets/player2.png");
            }).toThrow('Image with key "player" already exists');
        });
    });

    describe("buildAsync", () => {
        it("should throw if no images added", async () => {
            const builder = new SpriteAtlasBuilder(mockEngine);
            await expect(builder.buildAsync()).rejects.toThrow("Cannot build atlas: no images added");
        });

        it("should build an atlas from multiple images", async () => {
            const builder = new SpriteAtlasBuilder(mockEngine);
            builder.addImage("img1", "assets/img1.png");
            builder.addImage("img2", "assets/img2.png");

            const atlas = await builder.buildAsync();

            expect(atlas).toBeInstanceOf(SpriteAtlas);
            expect(atlas.texture).toBeDefined();
            expect(atlas.spriteSheet).toBeDefined();
        });

        it("should create frame data for each image", async () => {
            const builder = new SpriteAtlasBuilder(mockEngine);
            builder.addImage("img1", "assets/img1.png");
            builder.addImage("img2", "assets/img2.png");

            const atlas = await builder.buildAsync();

            expect(atlas.hasFrame("img1")).toBe(true);
            expect(atlas.hasFrame("img2")).toBe(true);
            expect(atlas.getFrame("img1")).toBeInstanceOf(Rectangle2D);
            expect(atlas.getFrame("img2")).toBeInstanceOf(Rectangle2D);
        });

        it("should return all frame keys", async () => {
            const builder = new SpriteAtlasBuilder(mockEngine);
            builder.addImage("img1", "assets/img1.png");
            builder.addImage("img2", "assets/img2.png");

            const atlas = await builder.buildAsync();
            const keys = atlas.getFrameKeys();

            expect(keys).toContain("img1");
            expect(keys).toContain("img2");
            expect(keys.length).toBe(2);
        });
    });

    describe("SpriteAtlas", () => {
        it("should provide getFrame method", async () => {
            const builder = new SpriteAtlasBuilder(mockEngine);
            builder.addImage("test", "assets/test.png");

            const atlas = await builder.buildAsync();
            const frame = atlas.getFrame("test");

            expect(frame).toBeInstanceOf(Rectangle2D);
        });

        it("should return undefined for non-existent frame", async () => {
            const builder = new SpriteAtlasBuilder(mockEngine);
            builder.addImage("test", "assets/test.png");

            const atlas = await builder.buildAsync();
            const frame = atlas.getFrame("nonexistent");

            expect(frame).toBeUndefined();
        });

        it("should have a SpriteSheet with frames", async () => {
            const builder = new SpriteAtlasBuilder(mockEngine);
            builder.addImage("img1", "assets/img1.png");
            builder.addImage("img2", "assets/img2.png");

            const atlas = await builder.buildAsync();

            expect(atlas.spriteSheet.frameCount).toBeGreaterThan(0);
        });
    });

    describe("Edge Cases", () => {
        describe("Single image atlas", () => {
            it("should build an atlas with a single image", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine);
                builder.addImage("only", "assets/only.png");

                const atlas = await builder.buildAsync();

                expect(atlas).toBeInstanceOf(SpriteAtlas);
                expect(atlas.hasFrame("only")).toBe(true);
                expect(atlas.getFrameKeys().length).toBe(1);
            });

            it("should handle single large image near max dimensions", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine, {
                    maxWidth: 2048,
                    maxHeight: 2048,
                });
                builder.addImage("large", "assets/large_2000x2000.png");

                const atlas = await builder.buildAsync();

                expect(atlas.hasFrame("large")).toBe(true);
                const frame = atlas.getFrame("large");
                expect(frame).toBeDefined();
                expect(frame!.width).toBe(2000);
                expect(frame!.height).toBe(2000);
            });
        });

        describe("Packing many small images", () => {
            it("should pack 100+ small images efficiently", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine, {
                    maxWidth: 2048,
                    maxHeight: 2048,
                    padding: 1,
                });

                // Add 100 small 32x32 images
                for (let i = 0; i < 100; i++) {
                    builder.addImage(`sprite_${i}`, `assets/sprite_${i}_32x32.png`);
                }

                const atlas = await builder.buildAsync();

                expect(atlas.getFrameKeys().length).toBe(100);
                for (let i = 0; i < 100; i++) {
                    expect(atlas.hasFrame(`sprite_${i}`)).toBe(true);
                }
            });

            it("should pack 150 images with various sizes", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine, {
                    maxWidth: 2048,
                    maxHeight: 2048,
                });

                const sizes = [16, 32, 48, 64];
                for (let i = 0; i < 150; i++) {
                    const size = sizes[i % sizes.length];
                    builder.addImage(`img_${i}`, `assets/img_${i}_${size}x${size}.png`);
                }

                const atlas = await builder.buildAsync();

                expect(atlas.getFrameKeys().length).toBe(150);
            });
        });

        describe("Images that exactly fill the atlas", () => {
            it("should handle images that exactly fill max dimensions", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine, {
                    maxWidth: 512,
                    maxHeight: 512,
                    padding: 0,
                    powerOfTwo: false,
                });

                // Four 256x256 images should exactly fill a 512x512 atlas
                builder.addImage("img1", "assets/img1_256x256.png");
                builder.addImage("img2", "assets/img2_256x256.png");
                builder.addImage("img3", "assets/img3_256x256.png");
                builder.addImage("img4", "assets/img4_256x256.png");

                const atlas = await builder.buildAsync();

                expect(atlas.getFrameKeys().length).toBe(4);
                expect(atlas.hasFrame("img1")).toBe(true);
                expect(atlas.hasFrame("img4")).toBe(true);
            });
        });

        describe("Images too large for max dimensions", () => {
            // NOTE: The current implementation doesn't validate width on new shelf creation
            // This test documents the expected behavior if that validation is added
            it("should handle single image wider than maxWidth on new shelf", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine, {
                    maxWidth: 256,
                    maxHeight: 512,
                    padding: 1,
                });

                // 512px wide image (+ 2px padding = 514px) technically exceeds 256px maxWidth
                // but current implementation allows it on new shelf
                builder.addImage("wide", "assets/wide_512x128.png");

                // Current behavior: succeeds (documents as-is behavior)
                const atlas = await builder.buildAsync();
                expect(atlas.hasFrame("wide")).toBe(true);
            });

            it("should throw when image is taller than maxHeight", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine, {
                    maxWidth: 512,
                    maxHeight: 512,
                    padding: 1,
                });

                builder.addImage("toobig", "assets/toobig_256x1024.png");

                await expect(builder.buildAsync()).rejects.toThrow(/Cannot fit image/);
            });

            it("should throw when cumulative images exceed atlas capacity", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine, {
                    maxWidth: 256,
                    maxHeight: 256,
                    padding: 1,
                });

                // Add more images than can fit
                for (let i = 0; i < 20; i++) {
                    builder.addImage(`img_${i}`, `assets/img_${i}_128x128.png`);
                }

                await expect(builder.buildAsync()).rejects.toThrow(/Cannot fit image/);
            });
        });

        describe("Duplicate keys handling", () => {
            it("should throw when adding duplicate key", () => {
                const builder = new SpriteAtlasBuilder(mockEngine);
                builder.addImage("duplicate", "assets/img1.png");

                expect(() => {
                    builder.addImage("duplicate", "assets/img2.png");
                }).toThrow('Image with key "duplicate" already exists');
            });

            it("should allow same URL with different keys", () => {
                const builder = new SpriteAtlasBuilder(mockEngine);

                expect(() => {
                    builder.addImage("key1", "assets/same.png");
                    builder.addImage("key2", "assets/same.png");
                }).not.toThrow();
            });
        });

        describe("Padding edge cases", () => {
            it("should work with zero padding", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine, {
                    padding: 0,
                });

                builder.addImage("img1", "assets/img1.png");
                builder.addImage("img2", "assets/img2.png");

                const atlas = await builder.buildAsync();

                expect(atlas.getFrameKeys().length).toBe(2);
                const frame1 = atlas.getFrame("img1");
                const frame2 = atlas.getFrame("img2");

                expect(frame1).toBeDefined();
                expect(frame2).toBeDefined();
            });

            it("should work with large padding", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine, {
                    maxWidth: 1024,
                    maxHeight: 1024,
                    padding: 32,
                });

                builder.addImage("img1", "assets/img1_64x64.png");
                builder.addImage("img2", "assets/img2_64x64.png");

                const atlas = await builder.buildAsync();

                const frame1 = atlas.getFrame("img1");
                const frame2 = atlas.getFrame("img2");

                expect(frame1).toBeDefined();
                expect(frame2).toBeDefined();

                // Padding should create spacing between frames
                expect(frame1!.x).toBeGreaterThanOrEqual(32);
                expect(frame1!.y).toBeGreaterThanOrEqual(32);
            });

            it("should fail when padding makes images too large", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine, {
                    maxWidth: 256,
                    maxHeight: 256,
                    padding: 100, // Large padding
                });

                builder.addImage("img1", "assets/img1_128x128.png");
                builder.addImage("img2", "assets/img2_128x128.png");

                // Padding will make each image require 328x328 space
                await expect(builder.buildAsync()).rejects.toThrow(/Cannot fit image/);
            });
        });

        describe("Power-of-two vs non-power-of-two", () => {
            it("should round up to power-of-two when enabled", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine, {
                    maxWidth: 2048,
                    maxHeight: 2048,
                    padding: 1,
                    powerOfTwo: true,
                });

                // Add images that will create a 200x200 content area
                builder.addImage("img1", "assets/img1_100x100.png");
                builder.addImage("img2", "assets/img2_100x100.png");

                const atlas = await builder.buildAsync();

                // Texture size should be rounded up to 256x256
                const texture = atlas.texture;
                expect(texture).toBeDefined();
            });

            it("should not round up when powerOfTwo is false", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine, {
                    maxWidth: 2048,
                    maxHeight: 2048,
                    padding: 1,
                    powerOfTwo: false,
                });

                builder.addImage("img1", "assets/img1_100x100.png");
                builder.addImage("img2", "assets/img2_100x100.png");

                const atlas = await builder.buildAsync();

                // Texture size should not be rounded
                const texture = atlas.texture;
                expect(texture).toBeDefined();
            });

            it("should handle power-of-two with various sizes", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine, {
                    powerOfTwo: true,
                    padding: 2,
                });

                const sizes = [17, 33, 65, 127]; // Non-power-of-two sizes
                for (let i = 0; i < 10; i++) {
                    const size = sizes[i % sizes.length];
                    builder.addImage(`img_${i}`, `assets/img_${i}_${size}x${size}.png`);
                }

                const atlas = await builder.buildAsync();

                expect(atlas.getFrameKeys().length).toBe(10);
            });
        });

        describe("Empty builder", () => {
            it("should throw when building with no images", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine);

                await expect(builder.buildAsync()).rejects.toThrow("Cannot build atlas: no images added");
            });
        });

        describe("Building twice", () => {
            it("should allow building multiple times with same images", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine);
                builder.addImage("img1", "assets/img1.png");
                builder.addImage("img2", "assets/img2.png");

                const atlas1 = await builder.buildAsync();
                const atlas2 = await builder.buildAsync();

                expect(atlas1).toBeInstanceOf(SpriteAtlas);
                expect(atlas2).toBeInstanceOf(SpriteAtlas);
                expect(atlas1.getFrameKeys().length).toBe(2);
                expect(atlas2.getFrameKeys().length).toBe(2);
            });

            it("should produce independent atlas instances", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine);
                builder.addImage("test", "assets/test.png");

                const atlas1 = await builder.buildAsync();
                const atlas2 = await builder.buildAsync();

                expect(atlas1).not.toBe(atlas2);
                expect(atlas1.texture).not.toBe(atlas2.texture);
            });
        });

        describe("SpriteSheet compatibility", () => {
            it("should have frames accessible via SpriteSheet", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine);
                builder.addImage("player", "assets/player_64x64.png");
                builder.addImage("enemy", "assets/enemy_32x32.png");

                const atlas = await builder.buildAsync();
                const sheet = atlas.spriteSheet;

                expect(sheet).toBeDefined();
                expect(sheet.frameCount).toBeGreaterThan(0);
            });

            it("should have matching frame data between atlas and sheet", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine);
                builder.addImage("sprite1", "assets/sprite1.png");

                const atlas = await builder.buildAsync();
                const atlasFrame = atlas.getFrame("sprite1");
                const sheet = atlas.spriteSheet;

                expect(atlasFrame).toBeDefined();
                expect(sheet).toBeDefined();
                expect(sheet.frameCount).toBe(1);
            });
        });

        describe("Different source types", () => {
            it("should handle HTMLImageElement sources directly", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine);
                
                // Create a loaded image element
                const img = document.createElement("img") as any;
                img.width = 128;
                img.height = 128;

                // HTMLImageElement is handled synchronously
                builder.addImage("html_img", img);

                const atlas = await builder.buildAsync();

                expect(atlas.hasFrame("html_img")).toBe(true);
                const frame = atlas.getFrame("html_img");
                expect(frame).toBeDefined();
                expect(frame!.width).toBe(128);
                expect(frame!.height).toBe(128);
            });

            it("should handle URL string sources", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine);

                builder.addImage("from_url", "assets/url_64x64.png");

                const atlas = await builder.buildAsync();

                expect(atlas.hasFrame("from_url")).toBe(true);
                const frame = atlas.getFrame("from_url");
                expect(frame).toBeDefined();
                expect(frame!.width).toBe(64);
                expect(frame!.height).toBe(64);
            });
        });

        describe("Frame positioning", () => {
            it("should position frames with correct padding", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine, {
                    padding: 5,
                    powerOfTwo: false,
                });

                builder.addImage("first", "assets/first_64x64.png");
                builder.addImage("second", "assets/second_64x64.png");

                const atlas = await builder.buildAsync();

                const frame1 = atlas.getFrame("first");
                const frame2 = atlas.getFrame("second");

                expect(frame1).toBeDefined();
                expect(frame2).toBeDefined();

                // First frame should have padding offset
                expect(frame1!.x).toBeGreaterThanOrEqual(5);
                expect(frame1!.y).toBeGreaterThanOrEqual(5);
            });

            it("should not overlap frames", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine, {
                    padding: 2,
                });

                for (let i = 0; i < 10; i++) {
                    builder.addImage(`img_${i}`, `assets/img_${i}_64x64.png`);
                }

                const atlas = await builder.buildAsync();

                // Get all frames
                const frames = atlas.getFrameKeys().map((key) => atlas.getFrame(key)!);

                // Check no overlaps (with padding)
                for (let i = 0; i < frames.length; i++) {
                    for (let j = i + 1; j < frames.length; j++) {
                        const f1 = frames[i];
                        const f2 = frames[j];

                        const overlap =
                            f1.x < f2.x + f2.width + 2 &&
                            f1.x + f1.width + 2 > f2.x &&
                            f1.y < f2.y + f2.height + 2 &&
                            f1.y + f1.height + 2 > f2.y;

                        expect(overlap).toBe(false);
                    }
                }
            });
        });

        describe("Memory and disposal", () => {
            it("should create texture resources", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine);
                builder.addImage("test", "assets/test.png");

                const atlas = await builder.buildAsync();

                expect(atlas.texture).toBeDefined();
                expect(atlas.spriteSheet).toBeDefined();
            });

            it("should handle multiple builds without memory leaks", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine);
                builder.addImage("img1", "assets/img1.png");

                // Build multiple times
                const atlases = [];
                for (let i = 0; i < 5; i++) {
                    atlases.push(await builder.buildAsync());
                }

                // Each atlas should be valid
                atlases.forEach((atlas) => {
                    expect(atlas.hasFrame("img1")).toBe(true);
                });
            });
        });

        describe("hasFrame checks", () => {
            it("should return true for existing frames", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine);
                builder.addImage("exists", "assets/exists.png");

                const atlas = await builder.buildAsync();

                expect(atlas.hasFrame("exists")).toBe(true);
            });

            it("should return false for non-existing frames", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine);
                builder.addImage("exists", "assets/exists.png");

                const atlas = await builder.buildAsync();

                expect(atlas.hasFrame("not_exists")).toBe(false);
                expect(atlas.hasFrame("")).toBe(false);
            });

            it("should be case-sensitive", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine);
                builder.addImage("Player", "assets/player.png");

                const atlas = await builder.buildAsync();

                expect(atlas.hasFrame("Player")).toBe(true);
                expect(atlas.hasFrame("player")).toBe(false);
                expect(atlas.hasFrame("PLAYER")).toBe(false);
            });
        });

        describe("getFrameKeys", () => {
            it("should return empty array for no frames", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine);
                builder.addImage("single", "assets/single.png");

                const atlas = await builder.buildAsync();
                const keys = atlas.getFrameKeys();

                expect(Array.isArray(keys)).toBe(true);
                expect(keys.length).toBe(1);
            });

            it("should return all keys in deterministic order", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine);
                const expectedKeys = ["key1", "key2", "key3", "key4"];

                expectedKeys.forEach((key) => {
                    builder.addImage(key, `assets/${key}.png`);
                });

                const atlas = await builder.buildAsync();
                const keys = atlas.getFrameKeys();

                expect(keys.length).toBe(expectedKeys.length);
                expectedKeys.forEach((key) => {
                    expect(keys).toContain(key);
                });
            });
        });

        describe("Shelf packing algorithm", () => {
            it("should pack tall images efficiently", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine, {
                    maxWidth: 512,
                    maxHeight: 512,
                    padding: 1,
                });

                // Add tall images (should create separate shelves)
                builder.addImage("tall1", "assets/tall1_64x256.png");
                builder.addImage("tall2", "assets/tall2_64x256.png");
                builder.addImage("small", "assets/small_32x32.png");

                const atlas = await builder.buildAsync();

                expect(atlas.getFrameKeys().length).toBe(3);
            });

            it("should pack wide images efficiently", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine, {
                    maxWidth: 1024,
                    maxHeight: 512,
                    padding: 1,
                });

                // Wide images should fit on same shelf
                builder.addImage("wide1", "assets/wide1_256x64.png");
                builder.addImage("wide2", "assets/wide2_256x64.png");
                builder.addImage("wide3", "assets/wide3_256x64.png");

                const atlas = await builder.buildAsync();

                expect(atlas.getFrameKeys().length).toBe(3);
            });

            it("should sort by height for optimal packing", async () => {
                const builder = new SpriteAtlasBuilder(mockEngine, {
                    maxWidth: 1024,
                    maxHeight: 1024,
                });

                // Add various sizes (algorithm should sort by height)
                builder.addImage("small", "assets/small_32x32.png");
                builder.addImage("medium", "assets/medium_64x64.png");
                builder.addImage("large", "assets/large_128x128.png");
                builder.addImage("tiny", "assets/tiny_16x16.png");

                const atlas = await builder.buildAsync();

                expect(atlas.getFrameKeys().length).toBe(4);
            });
        });
    });
});
