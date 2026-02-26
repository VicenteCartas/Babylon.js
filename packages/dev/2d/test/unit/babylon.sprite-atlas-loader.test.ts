/**
 * @jest-environment jsdom
 */
import { SpriteAtlas } from "2d/SpriteAtlas/spriteAtlas";
import { Rectangle2D } from "2d/Math/rectangle2D";
import { Tools } from "core/Misc/tools";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock texture that satisfies BaseTexture.getSize() */
const mockTexture = (w: number, h: number) => ({ getSize: () => ({ width: w, height: h }) }) as any;

// ---------------------------------------------------------------------------
// FromJson
// ---------------------------------------------------------------------------
describe("SpriteAtlas.FromJson", () => {
    it("should parse JSON Hash format with correct frame keys and rectangles", () => {
        // Arrange
        const data = {
            frames: {
                player_idle: { frame: { x: 0, y: 0, w: 32, h: 48 } },
                player_run: { frame: { x: 32, y: 0, w: 32, h: 48 } },
            },
        };
        const tex = mockTexture(256, 256);

        // Act
        const atlas = SpriteAtlas.FromJson(data, tex);

        // Assert
        expect(atlas.hasFrame("player_idle")).toBe(true);
        expect(atlas.hasFrame("player_run")).toBe(true);

        const idle = atlas.getFrame("player_idle")!;
        expect(idle).toBeInstanceOf(Rectangle2D);
        expect(idle.x).toBe(0);
        expect(idle.y).toBe(0);
        expect(idle.width).toBe(32);
        expect(idle.height).toBe(48);

        const run = atlas.getFrame("player_run")!;
        expect(run.x).toBe(32);
        expect(run.y).toBe(0);
        expect(run.width).toBe(32);
        expect(run.height).toBe(48);
    });

    it("should parse JSON Array format using filename as keys", () => {
        // Arrange
        const data = {
            frames: [
                { filename: "coin_0", frame: { x: 0, y: 0, w: 16, h: 16 } },
                { filename: "coin_1", frame: { x: 16, y: 0, w: 16, h: 16 } },
                { filename: "coin_2", frame: { x: 32, y: 0, w: 16, h: 16 } },
            ],
        };
        const tex = mockTexture(128, 128);

        // Act
        const atlas = SpriteAtlas.FromJson(data, tex);

        // Assert
        expect(atlas.hasFrame("coin_0")).toBe(true);
        expect(atlas.hasFrame("coin_1")).toBe(true);
        expect(atlas.hasFrame("coin_2")).toBe(true);

        const f1 = atlas.getFrame("coin_1")!;
        expect(f1.x).toBe(16);
        expect(f1.y).toBe(0);
        expect(f1.width).toBe(16);
        expect(f1.height).toBe(16);
    });

    it("should contain all frames accessible via getFrame and getFrameKeys", () => {
        // Arrange — mix of sizes
        const data = {
            frames: {
                a: { frame: { x: 0, y: 0, w: 10, h: 20 } },
                b: { frame: { x: 10, y: 0, w: 30, h: 40 } },
                c: { frame: { x: 40, y: 0, w: 50, h: 60 } },
                d: { frame: { x: 0, y: 60, w: 70, h: 80 } },
            },
        };
        const tex = mockTexture(512, 512);

        // Act
        const atlas = SpriteAtlas.FromJson(data, tex);

        // Assert
        const keys = atlas.getFrameKeys();
        expect(keys).toHaveLength(4);
        expect(keys).toContain("a");
        expect(keys).toContain("b");
        expect(keys).toContain("c");
        expect(keys).toContain("d");

        // Every key should resolve to a Rectangle2D
        for (const key of keys) {
            expect(atlas.getFrame(key)).toBeInstanceOf(Rectangle2D);
        }
    });

    it("should create a valid SpriteSheet with matching frame count", () => {
        // Arrange
        const data = {
            frames: {
                f1: { frame: { x: 0, y: 0, w: 32, h: 32 } },
                f2: { frame: { x: 32, y: 0, w: 32, h: 32 } },
                f3: { frame: { x: 64, y: 0, w: 32, h: 32 } },
            },
        };
        const tex = mockTexture(256, 256);

        // Act
        const atlas = SpriteAtlas.FromJson(data, tex);

        // Assert
        expect(atlas.spriteSheet).toBeDefined();
        expect(atlas.spriteSheet.texture).toBe(tex);
        expect(atlas.spriteSheet.frameCount).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// FromXml
// ---------------------------------------------------------------------------
describe("SpriteAtlas.FromXml", () => {
    /** Helper to build a Starling/Sparrow XML string and parse it. */
    const parseXml = (xml: string): Document => {
        return new DOMParser().parseFromString(xml, "text/xml");
    };

    it("should parse Starling/Sparrow SubTexture elements correctly", () => {
        // Arrange
        const xmlDoc = parseXml(`
            <TextureAtlas imagePath="sheet.png">
                <SubTexture name="hero_idle" x="0" y="0" width="64" height="64" />
                <SubTexture name="hero_run" x="64" y="0" width="64" height="64" />
            </TextureAtlas>
        `);
        const tex = mockTexture(256, 256);

        // Act
        const atlas = SpriteAtlas.FromXml(xmlDoc, tex);

        // Assert
        expect(atlas.hasFrame("hero_idle")).toBe(true);
        expect(atlas.hasFrame("hero_run")).toBe(true);

        const idle = atlas.getFrame("hero_idle")!;
        expect(idle.x).toBe(0);
        expect(idle.y).toBe(0);
        expect(idle.width).toBe(64);
        expect(idle.height).toBe(64);

        const run = atlas.getFrame("hero_run")!;
        expect(run.x).toBe(64);
        expect(run.y).toBe(0);
        expect(run.width).toBe(64);
        expect(run.height).toBe(64);
    });

    it("should handle multiple SubTextures and list all via getFrameKeys", () => {
        // Arrange
        const xmlDoc = parseXml(`
            <TextureAtlas imagePath="atlas.png">
                <SubTexture name="a" x="0"  y="0"  width="10" height="20" />
                <SubTexture name="b" x="10" y="0"  width="30" height="40" />
                <SubTexture name="c" x="40" y="0"  width="50" height="60" />
                <SubTexture name="d" x="0"  y="60" width="70" height="80" />
                <SubTexture name="e" x="70" y="60" width="90" height="100" />
            </TextureAtlas>
        `);
        const tex = mockTexture(512, 512);

        // Act
        const atlas = SpriteAtlas.FromXml(xmlDoc, tex);

        // Assert
        const keys = atlas.getFrameKeys();
        expect(keys).toHaveLength(5);
        expect(keys).toEqual(expect.arrayContaining(["a", "b", "c", "d", "e"]));
    });

    it("should fall back to frame_N when name attribute is missing", () => {
        // Arrange — omit name on the second SubTexture
        const xmlDoc = parseXml(`
            <TextureAtlas imagePath="atlas.png">
                <SubTexture name="named" x="0" y="0" width="32" height="32" />
                <SubTexture x="32" y="0" width="32" height="32" />
            </TextureAtlas>
        `);
        const tex = mockTexture(256, 256);

        // Act
        const atlas = SpriteAtlas.FromXml(xmlDoc, tex);

        // Assert
        expect(atlas.hasFrame("named")).toBe(true);
        // Second SubTexture has index 1 → fallback key "frame_1"
        expect(atlas.hasFrame("frame_1")).toBe(true);
        expect(atlas.getFrameKeys()).toHaveLength(2);

        const fallback = atlas.getFrame("frame_1")!;
        expect(fallback.x).toBe(32);
        expect(fallback.width).toBe(32);
    });

    it("should create a valid SpriteSheet with matching frame count", () => {
        // Arrange
        const xmlDoc = parseXml(`
            <TextureAtlas imagePath="sheet.png">
                <SubTexture name="s1" x="0"  y="0"  width="16" height="16" />
                <SubTexture name="s2" x="16" y="0"  width="16" height="16" />
                <SubTexture name="s3" x="32" y="0"  width="16" height="16" />
                <SubTexture name="s4" x="48" y="0"  width="16" height="16" />
            </TextureAtlas>
        `);
        const tex = mockTexture(256, 256);

        // Act
        const atlas = SpriteAtlas.FromXml(xmlDoc, tex);

        // Assert
        expect(atlas.spriteSheet).toBeDefined();
        expect(atlas.spriteSheet.texture).toBe(tex);
        expect(atlas.spriteSheet.frameCount).toBe(4);
    });
});

// ---------------------------------------------------------------------------
// LoadJsonAsync / LoadXmlAsync
// ---------------------------------------------------------------------------
describe("SpriteAtlas.LoadJsonAsync", () => {
    // We need to mock: Tools.LoadFileAsync, Image constructor, document.createElement("canvas"),
    // and HtmlElementTexture (via its module).

    const OriginalImage = global.Image;
    const originalCreateElement = document.createElement.bind(document);

    /** Minimal mock canvas + 2d context */
    class MockCanvas {
        public width = 0;
        public height = 0;
        getContext(_id: string): any {
            return { drawImage: jest.fn() };
        }
    }

    beforeEach(() => {
        // Reset mocks between tests
        jest.restoreAllMocks();

        // Mock document.createElement to return a MockCanvas for "canvas"
        document.createElement = jest.fn((tag: string) => {
            if (tag === "canvas") {
                return new MockCanvas() as any;
            }
            return originalCreateElement(tag);
        }) as any;
    });

    afterAll(() => {
        global.Image = OriginalImage;
        document.createElement = originalCreateElement;
    });

    it("should fetch JSON and texture in parallel and return a SpriteAtlas", async () => {
        // Arrange — mock Tools.LoadFileAsync to return JSON string
        const jsonPayload = {
            frames: {
                enemy_idle: { frame: { x: 0, y: 0, w: 48, h: 48 } },
                enemy_walk: { frame: { x: 48, y: 0, w: 48, h: 48 } },
            },
        };

        jest.spyOn(Tools, "LoadFileAsync").mockResolvedValue(JSON.stringify(jsonPayload));

        // Mock Image constructor — fire onload synchronously after src is set
        (global as any).Image = class {
            public width = 128;
            public height = 128;
            public crossOrigin = "";
            public onload: (() => void) | null = null;
            public onerror: (() => void) | null = null;
            private _src = "";
            get src() {
                return this._src;
            }
            set src(v: string) {
                this._src = v;
                // Fire onload asynchronously (microtask) to mimic real Image
                Promise.resolve().then(() => this.onload?.());
            }
        };

        // Mock engine — HtmlElementTexture constructor reads engine via options.engine
        const mockEngine = {} as any;

        // We also need to mock HtmlElementTexture. Since it's imported inside spriteAtlas.ts,
        // we can't easily intercept it from here. Instead we rely on jsdom + mocked canvas.
        // The real HtmlElementTexture constructor will run; we mock its engine dependency.
        // To prevent it from crashing we provide minimal engine stubs.
        mockEngine._getEngine = () => mockEngine;
        mockEngine.getClassName = () => "ThinEngine";
        mockEngine.createDynamicTexture = jest.fn().mockReturnValue({});
        mockEngine.updateDynamicTexture = jest.fn();

        // Act
        const atlas = await SpriteAtlas.LoadJsonAsync("http://example.com/atlas.json", "http://example.com/atlas.png", mockEngine);

        // Assert
        expect(atlas).toBeInstanceOf(SpriteAtlas);
        expect(atlas.hasFrame("enemy_idle")).toBe(true);
        expect(atlas.hasFrame("enemy_walk")).toBe(true);
        expect(atlas.getFrameKeys()).toHaveLength(2);

        const f = atlas.getFrame("enemy_idle")!;
        expect(f.x).toBe(0);
        expect(f.y).toBe(0);
        expect(f.width).toBe(48);
        expect(f.height).toBe(48);

        expect(Tools.LoadFileAsync).toHaveBeenCalledWith("http://example.com/atlas.json", false);
    });

    it("should reject with descriptive error when JSON fetch fails", async () => {
        // Arrange — mock Tools.LoadFileAsync to reject
        jest.spyOn(Tools, "LoadFileAsync").mockRejectedValue(new Error("Unable to load http://example.com/missing.json"));

        // Image mock — won't matter because fetch fails first
        (global as any).Image = class {
            public crossOrigin = "";
            public onload: (() => void) | null = null;
            public onerror: (() => void) | null = null;
            set src(_v: string) {
                Promise.resolve().then(() => this.onerror?.());
            }
        };

        const mockEngine = {} as any;

        // Act & Assert
        await expect(SpriteAtlas.LoadJsonAsync("http://example.com/missing.json", "http://example.com/atlas.png", mockEngine)).rejects.toThrow(
            /Unable to load/
        );
    });
});

describe("SpriteAtlas.LoadXmlAsync", () => {
    const OriginalImage = global.Image;
    const originalCreateElement = document.createElement.bind(document);

    class MockCanvas {
        public width = 0;
        public height = 0;
        getContext(_id: string): any {
            return { drawImage: jest.fn() };
        }
    }

    beforeEach(() => {
        jest.restoreAllMocks();

        document.createElement = jest.fn((tag: string) => {
            if (tag === "canvas") {
                return new MockCanvas() as any;
            }
            return originalCreateElement(tag);
        }) as any;
    });

    afterAll(() => {
        global.Image = OriginalImage;
        document.createElement = originalCreateElement;
    });

    it("should fetch XML and texture in parallel and return a SpriteAtlas", async () => {
        // Arrange
        const xmlString = `
            <TextureAtlas imagePath="atlas.png">
                <SubTexture name="gem_blue" x="0" y="0" width="24" height="24" />
                <SubTexture name="gem_red"  x="24" y="0" width="24" height="24" />
                <SubTexture name="gem_green" x="48" y="0" width="24" height="24" />
            </TextureAtlas>
        `;

        jest.spyOn(Tools, "LoadFileAsync").mockResolvedValue(xmlString);

        (global as any).Image = class {
            public width = 256;
            public height = 256;
            public crossOrigin = "";
            public onload: (() => void) | null = null;
            public onerror: (() => void) | null = null;
            private _src = "";
            get src() {
                return this._src;
            }
            set src(v: string) {
                this._src = v;
                Promise.resolve().then(() => this.onload?.());
            }
        };

        const mockEngine: any = {
            _getEngine: function () {
                return this;
            },
            getClassName: () => "ThinEngine",
            createDynamicTexture: jest.fn().mockReturnValue({}),
            updateDynamicTexture: jest.fn(),
        };

        // Act
        const atlas = await SpriteAtlas.LoadXmlAsync("http://example.com/atlas.xml", "http://example.com/atlas.png", mockEngine);

        // Assert
        expect(atlas).toBeInstanceOf(SpriteAtlas);
        expect(atlas.hasFrame("gem_blue")).toBe(true);
        expect(atlas.hasFrame("gem_red")).toBe(true);
        expect(atlas.hasFrame("gem_green")).toBe(true);
        expect(atlas.getFrameKeys()).toHaveLength(3);

        const blue = atlas.getFrame("gem_blue")!;
        expect(blue.x).toBe(0);
        expect(blue.y).toBe(0);
        expect(blue.width).toBe(24);
        expect(blue.height).toBe(24);

        expect(Tools.LoadFileAsync).toHaveBeenCalledWith("http://example.com/atlas.xml", false);
    });

    it("should reject with descriptive error when XML fetch fails", async () => {
        // Arrange — mock Tools.LoadFileAsync to reject
        jest.spyOn(Tools, "LoadFileAsync").mockRejectedValue(new Error("Unable to load http://example.com/bad.xml"));

        (global as any).Image = class {
            public crossOrigin = "";
            public onload: (() => void) | null = null;
            public onerror: (() => void) | null = null;
            set src(_v: string) {
                Promise.resolve().then(() => this.onerror?.());
            }
        };

        const mockEngine = {} as any;

        // Act & Assert
        await expect(SpriteAtlas.LoadXmlAsync("http://example.com/bad.xml", "http://example.com/atlas.png", mockEngine)).rejects.toThrow(
            /Unable to load/
        );
    });
});
