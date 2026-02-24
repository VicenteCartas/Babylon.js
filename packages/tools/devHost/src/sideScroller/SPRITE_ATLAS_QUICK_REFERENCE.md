# SpriteAtlasBuilder — Quick Reference Card

## Basic Usage (3 Steps)

\\\	ypescript
import { SpriteAtlasBuilder } from "2d/SpriteAtlas/spriteAtlasBuilder";

// 1. Create builder
const builder = new SpriteAtlasBuilder(engine, {
    maxWidth: 2048,      // Max atlas width (default: 2048)
    maxHeight: 2048,     // Max atlas height (default: 2048)
    padding: 2,          // Padding between sprites (default: 1)
    powerOfTwo: true,    // Round up to power-of-two (default: true)
});

// 2. Add images
builder.addImage("player", "assets/player.png");           // From URL
builder.addImage("enemy", canvasElement);                  // From canvas
builder.addImage("bullet", existingBabylonTexture);       // From texture

// 3. Build atlas
const atlas = await builder.buildAsync();
\\\

---

## Using the Atlas with Sprite2D

\\\	ypescript
const sprite = new Sprite2D("mySprite", scene);
sprite.texture = atlas.texture;
sprite.sourceRect = atlas.getFrame("player");
sprite.width = 32;
sprite.height = 48;
\\\

---

## SpriteAtlas API

\\\	ypescript
// Get frame by key
const frame = atlas.getFrame("player");
// → Rectangle2D { x, y, width, height }

// Check if frame exists
if (atlas.hasFrame("enemy")) { ... }

// Get all frame keys
const allKeys = atlas.getFrameKeys();
// → ["player", "enemy", "bullet", ...]

// Access the packed texture
const texture = atlas.texture;
// → BaseTexture (use with Sprite2D.texture)

// Get the SpriteSheet (for animations)
const sheet = atlas.spriteSheet;
// → SpriteSheet (compatible with AnimatedSprite2D)
\\\

---

## Configuration Options

\\\	ypescript
interface ISpriteAtlasBuilderOptions {
    maxWidth?: number;      // Default: 2048
    maxHeight?: number;     // Default: 2048
    padding?: number;       // Default: 1 (use 2 for safety)
    powerOfTwo?: boolean;   // Default: true
}
\\\

---

## Packing Algorithm

Uses **shelf-first-fit** algorithm:
1. Sort sprites by height (tallest first)
2. Create horizontal "shelves"
3. Place sprites left-to-right on shelves
4. Create new shelf when current is full
5. Fail if max height exceeded

Result: Efficient packing with minimal wasted space.

---

## Best Practices

1. **Group related sprites**: UI, characters, environment
2. **Use power-of-two**: Better GPU compatibility
3. **Add padding**: Prevents texture bleeding (use 2px minimum)
4. **Build at startup**: During loading screen
5. **Stay under 4096×4096**: Broad device support
6. **Multiple atlases**: Don't pack everything into one

---

## Production Example

\\\	ypescript
// Loading screen phase
async function loadGameAssets(engine: Engine): Promise<GameAssets> {
    const uiBuilder = new SpriteAtlasBuilder(engine);
    uiBuilder.addImage("button", "assets/ui/button.png");
    uiBuilder.addImage("panel", "assets/ui/panel.png");
    uiBuilder.addImage("icon_health", "assets/ui/health.png");
    const uiAtlas = await uiBuilder.buildAsync();

    const characterBuilder = new SpriteAtlasBuilder(engine);
    characterBuilder.addImage("player_idle", "assets/player_idle.png");
    characterBuilder.addImage("player_run", "assets/player_run.png");
    characterBuilder.addImage("enemy_1", "assets/enemy1.png");
    const characterAtlas = await characterBuilder.buildAsync();

    return { uiAtlas, characterAtlas };
}
\\\

---

## Performance Tips

- **Build once**: Cache the atlas, reuse across scenes
- **Load in parallel**: Use \Promise.all([atlas1, atlas2, ...])\
- **Monitor size**: Check \tlas.texture.getSize()\ in console
- **Profile draw calls**: Use browser DevTools GPU profiler

---

## Error Handling

\\\	ypescript
try {
    const atlas = await builder.buildAsync();
} catch (error) {
    if (error.message.includes("Cannot fit image")) {
        // Atlas too small — increase maxWidth/maxHeight
    } else if (error.message.includes("no images added")) {
        // Forgot to call addImage()
    }
}
\\\

---

## Debug Output

\\\	ypescript
const atlas = await builder.buildAsync();
console.log(\Packed \ sprites\);
console.log(\Atlas size: \x\\);
console.log(\Frames:\, atlas.getFrameKeys());
\\\

---

## Links

- **API Source**: packages/dev/2d/src/SpriteAtlas/spriteAtlasBuilder.ts
- **Demo**: packages/tools/devHost/src/sideScroller/main.ts (line ~93)
- **Full Integration Report**: sideScroller/SPRITE_ATLAS_INTEGRATION.md

---

**Version**: 1.0.0  
**Status**: ✅ Production-ready  
**Coverage**: Side-Scroller demo  
