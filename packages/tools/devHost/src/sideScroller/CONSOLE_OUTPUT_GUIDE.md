# SpriteAtlasBuilder Demo — Console Output Guide

When you run the side-scroller demo with SpriteAtlasBuilder integration, you should see the following console output:

---

## Expected Console Output

\\\
⏱ SpriteAtlasBuilder: Total atlas build time: 45ms
✅ SpriteAtlasBuilder: Packed 10 sprites into 256x256 atlas
📦 Atlas frames: terrain_rock, terrain_dirt, terrain_stone, player, enemy, collectible, bullet, bg_far, bg_mid, bg_near
🎯 Before: 10 separate textures → After: 1 shared atlas texture
💡 This enables SpriteBatchRenderer to batch all sprites with the same atlas into a single draw call!
\\\

---

## What Each Log Means

### 1. Build Time
\\\
⏱ SpriteAtlasBuilder: Total atlas build time: 45ms
\\\
- Time to load all source images and pack them into the atlas
- Includes canvas creation, image loading, shelf packing algorithm, and final composite
- Typical range: 30-100ms depending on sprite count and size

### 2. Atlas Size
\\\
✅ SpriteAtlasBuilder: Packed 10 sprites into 256x256 atlas
\\\
- 10 distinct sprite types were added to the builder
- Final atlas texture is 256×256 (power of 2, with padding)
- Size is automatically calculated based on content

### 3. Frame List
\\\
📦 Atlas frames: terrain_rock, terrain_dirt, terrain_stone, ...
\\\
- All sprite keys that were added to the builder
- Each key maps to a specific Rectangle2D region in the atlas
- Used with \gameAtlas.getFrame("key")\ to lookup sprite bounds

### 4. Before/After Comparison
\\\
🎯 Before: 10 separate textures → After: 1 shared atlas texture
\\\
- Demonstrates the batching benefit
- In production, you might pack 50-200 sprites into a single atlas
- Reduces texture switches during rendering

### 5. Performance Benefit
\\\
💡 This enables SpriteBatchRenderer to batch all sprites...
\\\
- SpriteBatchRenderer groups sprites by texture
- Before: 10 different textures = potentially 10+ draw calls
- After: 1 shared atlas = 1 draw call per sorting layer

---

## Verifying the Integration Works

### Visual Checks
1. **Terrain tiles** — Should appear with subtle texture variation (rock, dirt, stone)
2. **Player sprite** — Green character should render correctly
3. **Enemies** — Red enemies should render correctly
4. **Collectibles** — Gold coins should appear with glow effect
5. **Bullets** — Cyan projectiles when you press X
6. **Parallax backgrounds** — Layers of rectangles scrolling at different speeds

### Debug Mode (Press F3)
- Enable physics debug overlay
- Sprites should still render correctly over the debug visualization

### Performance
- Game should run smoothly at 60 FPS
- No texture loading delays after initial atlas build
- No visual artifacts or texture bleeding (thanks to 2px padding)

---

## Troubleshooting

### If you see magenta (pink) sprites:
- The atlas frame lookup failed
- Check that the key passed to \getFrame()\ matches what was added to the builder

### If sprites are stretched/squashed:
- The \sourceRect\ might be incorrect
- Verify \sprite.width\ and \sprite.height\ match the intended display size

### If the console shows errors:
- Check the browser developer console (F12)
- Look for TypeScript compilation errors or runtime exceptions

---

## Code Snippet Reference

### How to Use the Atlas in Your Own Code

\\\	ypescript
// 1. Create the builder
const builder = new SpriteAtlasBuilder(engine, {
    maxWidth: 2048,
    maxHeight: 2048,
    padding: 2,
    powerOfTwo: true,
});

// 2. Add images (URL, HTMLImageElement, or BaseTexture)
builder.addImage("mySprite", "assets/sprite.png");
builder.addImage("myOtherSprite", canvasElement);

// 3. Build the atlas
const atlas = await builder.buildAsync();

// 4. Use with Sprite2D
const sprite = new Sprite2D("sprite1", scene);
sprite.texture = atlas.texture;
sprite.sourceRect = atlas.getFrame("mySprite");
\\\

### Helper: Creating Canvas Textures
\\\	ypescript
function createSpriteTexture(width: number, height: number, color: Color4): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = \gba(\, \, \, \)\;
    ctx.fillRect(0, 0, width, height);
    return canvas;
}
\\\

---

## Production Best Practices

1. **Load at Startup**: Build atlases during a loading screen
2. **Multiple Atlases**: Group related sprites (UI, characters, environment) into separate atlases
3. **Power of Two**: Keep \powerOfTwo: true\ for GPU compatibility
4. **Padding**: Use at least 1-2px padding to prevent texture bleeding
5. **Size Limits**: Stay under 4096×4096 for broad device support
6. **Cache Results**: Save the atlas texture for reuse across scenes

---

## Links
- API Source: \packages/dev/2d/src/SpriteAtlas/spriteAtlasBuilder.ts\
- Demo Source: \packages/tools/devHost/src/sideScroller/main.ts\
- Integration Report: \packages/tools/devHost/src/sideScroller/SPRITE_ATLAS_INTEGRATION.md\
- Feature Coverage: \packages/tools/devHost/src/2D_FEATURE_COVERAGE.md\

---

**Status**: ✅ Ready to test
**Dev Host**: http://localhost:1338/?exp=sidescroller
**Press F12**: Open browser console to see atlas build logs
