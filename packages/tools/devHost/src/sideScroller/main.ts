import { Engine } from "core/Engines/engine";
import { Constants } from "core/Engines/constants";
import { DynamicTexture } from "core/Materials/Textures/dynamicTexture";

import { Scene2D } from "2d/Scene2D/scene2D";
import { Node2D } from "2d/Node2D/node2D";
import { Sprite2D } from "2d/Sprite2D/sprite2D";
import { Camera2D, ScaleMode } from "2d/Camera2D/camera2D";
import { Rectangle2D } from "2d/Math/rectangle2D";
import { InputMap2D } from "2d/Input/inputMap2D";
import { PlanckPhysicsEngine } from "2d/Physics/planckPhysicsEngine";
import { PhysicsBodyType2D } from "2d/Physics/physicsEngine2D";
import type { IPhysicsBody2D } from "2d/Physics/physicsEngine2D";
import { StateMachine2D } from "2d/StateMachine/stateMachine";
import { NineSliceSprite2D } from "2d/NineSlice/nineSliceSprite2D";
import { Text2D } from "2d/Text2D/text2D";
import { LightingManager2D } from "2d/Lighting/light2D";
import { DebugRenderer2D } from "2d/Debug/debugRenderer2D";
import { ObjectPool } from "2d/ObjectPool/objectPool";
import type { IPoolable } from "2d/ObjectPool/objectPool";
import { SpriteAtlasBuilder } from "2d/SpriteAtlas/spriteAtlasBuilder";
import type { SpriteAtlas } from "2d/SpriteAtlas/spriteAtlas";
import { RenderTexture2D } from "2d/RenderTexture/renderTexture2D";
import { SpatialAudio2D } from "2d/Audio/spatialAudio2D";
import { Tween } from "2d/Tween/tween";
import { TweenManager } from "2d/Tween/tween";
import { Easing } from "2d/Tween/easing";
import { Vector2, Vector3 } from "core/Maths/math.vector";
import { Color4 } from "core/Maths/math.color";
import { ParticleSystem } from "core/Particles/particleSystem";
import { ParticleHelper2D } from "2d/Particles/particleHelper2D";

// ─── Procedural Audio Helpers ────────────────────────────────────────
// Uses the Web Audio API OscillatorNode directly to produce retro-style
// beeps and chirps without any external audio files.

/** Shared AudioContext — created lazily on first user gesture. */
let _audioCtx: AudioContext | null = null;

/**
 * Returns the shared AudioContext, creating it on demand.
 * Call only from a user-gesture handler so browsers allow playback.
 */
function getAudioContext(): AudioContext {
    if (!_audioCtx) {
        _audioCtx = new AudioContext();
    }
    // Resume if suspended (browser autoplay policy)
    if (_audioCtx.state === "suspended") {
        _audioCtx.resume();
    }
    return _audioCtx;
}

/**
 * Play a simple constant-frequency tone with an exponential decay envelope.
 * @param frequency - Oscillator frequency in Hz
 * @param duration  - Length of the tone in seconds
 * @param type      - Waveform: "sine" | "square" | "sawtooth" | "triangle"
 * @param volume    - Peak gain (0–1, keep low ~0.1)
 */
function playTone(
    frequency: number,
    duration: number,
    type: OscillatorType = "square",
    volume: number = 0.1
): void {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
}

/**
 * Play a frequency-sweep tone (chirp / pew / whoosh).
 * The frequency ramps linearly from `startFreq` to `endFreq` over `duration`.
 * @param startFreq - Starting frequency in Hz
 * @param endFreq   - Ending frequency in Hz
 * @param duration  - Sweep length in seconds
 * @param type      - Waveform type
 * @param volume    - Peak gain
 */
function playSweep(
    startFreq: number,
    endFreq: number,
    duration: number,
    type: OscillatorType = "square",
    volume: number = 0.1
): void {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(endFreq, ctx.currentTime + duration);
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
}

// Convenience wrappers for each game event — keeps inline code tidy.
/** Rising chirp (300→600 Hz, 0.1 s) */
function sfxJump(): void { playSweep(300, 600, 0.1, "square", 0.08); }
/** Sawtooth whoosh (150 Hz, 0.15 s) */
function sfxDash(): void { playTone(150, 0.15, "sawtooth", 0.1); }
/** Descending pew (800→200 Hz, 0.08 s) */
function sfxShoot(): void { playSweep(800, 200, 0.08, "square", 0.07); }
/** Pleasant ding (880 Hz sine, 0.15 s) */
function sfxCollect(): void { playTone(880, 0.15, "sine", 0.1); }
/** Low thud (100 Hz square, 0.1 s) */
function sfxEnemyHit(): void { playTone(100, 0.1, "square", 0.1); }

/**
 * Side-scroller demo — "Hollow Knight lite"
 * Demonstrates: Sprite2D, Camera2D follow, Node2D.scrollFactor (built-in parallax),
 *               Physics2D, InputMap2D, StateMachine2D (enemy AI), Text2D (HUD),
 *               NineSliceSprite2D (panels),
 *               LightingManager2D (GPU forward lighting — player glow + collectible lights),
 *               ObjectPool (bullet pooling for zero-GC shooting),
 *               **SpriteAtlasBuilder** (runtime atlas packing for batch rendering),
 *               **SpatialAudio2D** + procedural SFX (Web Audio oscillators)
 */
export async function Main(_searchParams: URLSearchParams): Promise<void> {
    const mainDiv = document.getElementById("main-div") as HTMLDivElement;

    // Style the container
    mainDiv.style.cssText = "width:100%;height:100%;margin:0;padding:0;overflow:hidden;background:#1a1a2e;";
    document.body.style.cssText = "margin:0;padding:0;overflow:hidden;";

    const canvas = document.createElement("canvas");
    canvas.id = "game-canvas";
    canvas.style.cssText = "width:100%;height:100%;display:block;background:#1a1a2e;";
    mainDiv.appendChild(canvas);

    const engine= new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });

    // Force canvas to match its display size
    engine.resize();

    const scene = new Scene2D(engine);
    scene.backgroundColor = new Color4(0.1, 0.1, 0.18, 1); // Dark navy
    const W = engine.getRenderWidth();
    const H = engine.getRenderHeight();

    // ─── Physics ─────────────────────────────────────────────────────
    const physics = new PlanckPhysicsEngine(new Vector2(0, 1800));

    // ─── Camera ──────────────────────────────────────────────────────
    const camera = new Camera2D();
    camera.setViewport(W, H);
    camera.setDesignResolution(480, 270, ScaleMode.FIT);
    scene.camera = camera;

    // ─── GPU Lighting ────────────────────────────────────────────────
    const lighting = new LightingManager2D();
    lighting.ambientColor = new Color4(0.25, 0.22, 0.30, 1); // Visible base lighting — platforms readable everywhere
    const playerLight = lighting.createPointLight(0, 0, new Color4(1.0, 0.95, 0.7, 1), 260);
    playerLight.intensity = 1.8;
    playerLight.falloff = 1.2;

    // Warm torches at platforms
    const torch1 = lighting.createPointLight(7 * 40 + 20, 13 * 40 - 30, new Color4(1.0, 0.6, 0.2, 1), 180);
    torch1.intensity = 1.5;
    torch1.falloff = 1.0;
    const torch2 = lighting.createPointLight(38 * 40 + 20, 10 * 40 - 30, new Color4(1.0, 0.6, 0.2, 1), 180);
    torch2.intensity = 1.5;
    torch2.falloff = 1.0;

    // Danger zone light
    const dangerLight = lighting.createPointLight(52 * 40 + 20, 12 * 40 - 30, new Color4(1.0, 0.15, 0.1, 1), 200);
    dangerLight.intensity = 1.2;
    dangerLight.falloff = 1.0;

    scene.lightingManager = lighting;
    scene.unlitSortingLayerMin = 1000; // HUD elements (sortingLayer >= 1000) render without lighting

    // ─── TweenManager (shared for all game tweens) ──────────────────
    const tweenManager = new TweenManager();

    const input= new InputMap2D(engine, camera);
    input.defineAction("moveRight", { type: "key", key: "ArrowRight" }, { type: "key", key: "KeyD" });
    input.defineAction("moveLeft", { type: "key", key: "ArrowLeft" }, { type: "key", key: "KeyA" });
    input.defineAction("jump", { type: "key", key: "Space" }, { type: "key", key: "ArrowUp" }, { type: "key", key: "KeyW" });
    input.defineAction("dash", { type: "key", key: "ShiftLeft" }, { type: "key", key: "ShiftRight" });
    input.defineAction("shoot", { type: "key", key: "KeyX" }, { type: "key", key: "KeyZ" });

    // ─── SpatialAudio2D (positional audio listener tracking) ─────────
    // We create the utility early so it's ready to sync each frame.
    // The AudioContext itself is created lazily by getAudioContext() the
    // first time the player presses a key (respecting autoplay policy).
    const spatialAudio = new SpatialAudio2D(engine);

    // ─── Particles (ParticleHelper2D) ────────────────────────────────────
    const particleHelper = new ParticleHelper2D(engine);
    particleHelper.camera = camera;

    // Particle texture — small white circle via canvas (required by core ParticleSystem)
    const particleCanvas = document.createElement("canvas");
    particleCanvas.width = 8;
    particleCanvas.height = 8;
    const partCtx = particleCanvas.getContext("2d")!;
    partCtx.fillStyle = "#ffffff";
    partCtx.beginPath();
    partCtx.arc(4, 4, 3, 0, Math.PI * 2);
    partCtx.fill();
    const particleTex = new DynamicTexture("particleTex", particleCanvas, particleHelper.scene, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE);
    particleTex._texture = engine.createDynamicTexture(8, 8, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE);
    engine.updateDynamicTexture(particleTex._texture, particleCanvas, false);

    // Landing dust (manual emit bursts)
    const dustPS = particleHelper.createParticleSystem("dust", 30);
    dustPS.emitter = new Vector3(0, 0, 0);
    dustPS.minSize = 2;
    dustPS.maxSize = 5;
    dustPS.minLifeTime = 0.15;
    dustPS.maxLifeTime = 0.3;
    dustPS.emitRate = 0; // Manual bursts only
    dustPS.gravity = new Vector3(0, -50, 0); // Float up (Y-down, so negative = up)
    dustPS.minEmitPower = 20;
    dustPS.maxEmitPower = 50;
    dustPS.direction1 = new Vector3(-1, -0.5, 0);
    dustPS.direction2 = new Vector3(1, -0.5, 0);
    dustPS.color1 = new Color4(0.6, 0.5, 0.3, 0.8);
    dustPS.color2 = new Color4(0.4, 0.35, 0.25, 0.6);
    dustPS.colorDead = new Color4(0.3, 0.25, 0.2, 0);
    dustPS.blendMode = 2; // BLENDMODE_ADD
    dustPS.particleTexture = particleTex;
    dustPS.start();

    // Bullet impact sparks
    const sparkPS = particleHelper.createParticleSystem("sparks", 20);
    sparkPS.emitter = new Vector3(0, 0, 0);
    sparkPS.minSize = 1;
    sparkPS.maxSize = 3;
    sparkPS.minLifeTime = 0.1;
    sparkPS.maxLifeTime = 0.2;
    sparkPS.emitRate = 0;
    sparkPS.gravity = new Vector3(0, 100, 0);
    sparkPS.minEmitPower = 40;
    sparkPS.maxEmitPower = 80;
    sparkPS.direction1 = new Vector3(-1, -1, 0);
    sparkPS.direction2 = new Vector3(1, 0.5, 0);
    sparkPS.color1 = new Color4(0.3, 0.9, 1.0, 1);
    sparkPS.color2 = new Color4(0.5, 0.7, 1.0, 0.8);
    sparkPS.colorDead = new Color4(0.1, 0.3, 0.5, 0);
    sparkPS.blendMode = 2;
    sparkPS.particleTexture = particleTex;
    sparkPS.start();

    // Collectible pickup burst
    const collectPS = particleHelper.createParticleSystem("collect", 30);
    collectPS.emitter = new Vector3(0, 0, 0);
    collectPS.minSize = 1.5;
    collectPS.maxSize = 3;
    collectPS.minLifeTime = 0.15;
    collectPS.maxLifeTime = 0.35;
    collectPS.emitRate = 0;
    collectPS.gravity = new Vector3(0, -80, 0); // Fast upward pull (Y-down)
    collectPS.minEmitPower = 60;
    collectPS.maxEmitPower = 120;
    collectPS.direction1 = new Vector3(-0.8, -1, 0);
    collectPS.direction2 = new Vector3(0.8, -0.6, 0);
    collectPS.color1 = new Color4(1.0, 0.95, 0.5, 1);
    collectPS.color2 = new Color4(1.0, 0.8, 0.2, 0.9);
    collectPS.colorDead = new Color4(1.0, 0.6, 0.0, 0);
    collectPS.blendMode = 2;
    collectPS.particleTexture = particleTex;
    collectPS.start();

    // Ambient floating motes
    const ambientPS = particleHelper.createParticleSystem("ambient", 40);
    ambientPS.emitter = new Vector3(0, 0, 0); // Will follow camera
    ambientPS.minSize = 1;
    ambientPS.maxSize = 2;
    ambientPS.minLifeTime = 3;
    ambientPS.maxLifeTime = 6;
    ambientPS.emitRate = 5;
    ambientPS.gravity = new Vector3(0, -5, 0); // Slow upward drift
    ambientPS.minEmitPower = 2;
    ambientPS.maxEmitPower = 8;
    ambientPS.direction1 = new Vector3(-0.5, -1, 0);
    ambientPS.direction2 = new Vector3(0.5, 0, 0);
    ambientPS.color1 = new Color4(0.5, 0.8, 1.0, 0.3);
    ambientPS.color2 = new Color4(0.3, 0.6, 0.9, 0.2);
    ambientPS.colorDead = new Color4(0.2, 0.4, 0.7, 0);
    ambientPS.minEmitBox = new Vector3(-200, -100, 0);
    ambientPS.maxEmitBox = new Vector3(200, 100, 0);
    ambientPS.blendMode = 2;
    ambientPS.particleTexture = particleTex;
    ambientPS.start();

    // ═══ SpriteAtlasBuilder — Pack all game sprites into a single texture ═══
    console.time("⏱ SpriteAtlasBuilder: Total atlas build time");
    
    // Build atlas with all sprite types used in the game
    const atlasBuilder = new SpriteAtlasBuilder(engine, {
        maxWidth: 2048,
        maxHeight: 2048,
        padding: 2,
        powerOfTwo: true,
    });

    // Terrain tiles (3 variants × 2 surface types = 6)
    for (let v = 0; v < 3; v++) {
        atlasBuilder.addImage(`terrain_${v}`, createTerrainSprite(40, 40, v, false));
        atlasBuilder.addImage(`terrain_top_${v}`, createTerrainSprite(40, 40, v, true));
    }

    // Characters
    atlasBuilder.addImage("player", createPlayerSprite(28, 44));
    atlasBuilder.addImage("enemy", createEnemySprite(30, 30));

    // Items
    atlasBuilder.addImage("collectible", createGemSprite(16, 16));
    atlasBuilder.addImage("bullet", createBulletSprite(12, 6));

    // Parallax background elements
    for (let i = 0; i < 3; i++) {
        atlasBuilder.addImage(`bg_far_${i}`, createFarBgSprite(128, 96, i));
        atlasBuilder.addImage(`bg_mid_${i}`, createMidBgSprite(64, 80, i));
        atlasBuilder.addImage(`bg_near_${i}`, createNearBgSprite(48, 56, i));
    }

    // Build the atlas asynchronously
    const gameAtlas: SpriteAtlas = await atlasBuilder.buildAsync();
    console.timeEnd("⏱ SpriteAtlasBuilder: Total atlas build time");
    
    // Log atlas efficiency
    const atlasSize = gameAtlas.texture.getSize();
    console.log(`✅ SpriteAtlasBuilder: Packed ${gameAtlas.getFrameKeys().length} sprites into ${atlasSize.width}x${atlasSize.height} atlas`);
    console.log(`📦 Atlas frames: ${gameAtlas.getFrameKeys().join(", ")}`);
    console.log(`🎯 Before: ${gameAtlas.getFrameKeys().length} separate textures → After: 1 shared atlas texture`);
    console.log(`💡 This enables SpriteBatchRenderer to batch all sprites with the same atlas into a single draw call!`);

    // ═══ End SpriteAtlasBuilder Demo ═══

    // ─── DebugRenderer2D ─────────────────────────────────────────────
    const debugRenderer = new DebugRenderer2D(engine);
    debugRenderer.physicsEngine = physics;
    debugRenderer.enabled = false;
    let debugMode = false;

    // Toggle debug mode with F3
    window.addEventListener("keydown", (e) => {
        if (e.key === "F3") {
            e.preventDefault();
            debugMode = !debugMode;
            debugRenderer.enabled = debugMode;
            debugRenderer.showPhysicsBodies = debugMode;
        }
    });

    // ─── Level Layout ────────────────────────────────────────────────
    const TILE = 40;
    const LEVEL_WIDTH = 80; // tiles
    const LEVEL_HEIGHT = 20; // tiles

    // Generate procedural level
    const level = generateLevel(LEVEL_WIDTH, LEVEL_HEIGHT);

    // ─── Create Terrain Sprites + Physics ────────────────────────────
    const terrainParent = new Node2D("terrain");
    scene.addNode(terrainParent);

    // Visual sprites — one per tile (using SpriteAtlas)
    for (let row = 0; row < LEVEL_HEIGHT; row++) {
        for (let col = 0; col < LEVEL_WIDTH; col++) {
            if (level[row][col] === 1) {
                const tile = new Sprite2D(`tile_${col}_${row}`);
                tile.parent = terrainParent;
                tile.width = TILE;
                tile.height = TILE;
                tile.position = new Vector2(col * TILE + TILE / 2, row * TILE + TILE / 2);
                
                // Use atlas texture and frame — pick surface variant if air above
                const isTop = row === 0 || level[row - 1][col] === 0;
                const variant = (col + row * 3) % 3;
                const textureKey = isTop ? `terrain_top_${variant}` : `terrain_${variant}`;
                tile.texture = gameAtlas.texture;
                tile.sourceRect = gameAtlas.getFrame(textureKey);
                tile.tint = getTileColor(row, level);
            }
        }
    }

    // Merged physics bodies — one per horizontal run of tiles (eliminates tile-seam ghost collisions)
    // Build horizontal runs per row, then merge vertically to eliminate ghost-vertex seams
    type TerrainRun = { row: number; startCol: number; width: number };
    const runs: TerrainRun[] = [];
    for (let row = 0; row < LEVEL_HEIGHT; row++) {
        let runStart = -1;
        for (let col = 0; col <= LEVEL_WIDTH; col++) {
            const isTile = col < LEVEL_WIDTH && level[row][col] === 1;
            if (isTile && runStart === -1) {
                runStart = col;
            } else if (!isTile && runStart !== -1) {
                runs.push({ row, startCol: runStart, width: col - runStart });
                runStart = -1;
            }
        }
    }

    // Sort by (startCol, width, row) so vertically adjacent same-span runs are consecutive
    runs.sort((a, b) => a.startCol - b.startCol || a.width - b.width || a.row - b.row);

    // Merge vertically adjacent runs with same startCol and width
    let i = 0;
    while (i < runs.length) {
        const startCol = runs[i].startCol;
        const w = runs[i].width;
        let topRow = runs[i].row;
        let bottomRow = topRow;
        let j = i + 1;
        while (j < runs.length && runs[j].startCol === startCol && runs[j].width === w && runs[j].row === bottomRow + 1) {
            bottomRow = runs[j].row;
            j++;
        }
        const heightInTiles = bottomRow - topRow + 1;
        const bodyNode = new Node2D(`terrain_body_${topRow}_${startCol}`);
        bodyNode.parent = terrainParent;
        bodyNode.position = new Vector2(
            startCol * TILE + (w * TILE) / 2,
            topRow * TILE + (heightInTiles * TILE) / 2
        );
        physics.addBody(bodyNode, {
            bodyType: PhysicsBodyType2D.Static,
            shape: { type: "box", width: w * TILE, height: heightInTiles * TILE },
        });
        i = j;
    }

    // ─── Parallax Backgrounds ────────────────────────────────────────
    // Scroll factors are set on parent nodes via Node2D.scrollFactorX/Y — no per-frame update needed.
    createParallaxLayers(scene, LEVEL_WIDTH * TILE, gameAtlas);

    // ─── Star Field (very far background) ────────────────────────────
    {
        const starsParent = new Node2D("bg_stars");
        scene.addNode(starsParent);
        starsParent.zIndex = -110;
        starsParent.scrollFactorX = 0.05;
        starsParent.scrollFactorY = 1.0; // Full vertical scroll — stays in sky, no floating

        const starCanvas = document.createElement("canvas");
        starCanvas.width = 2;
        starCanvas.height = 2;
        const sCtx = starCanvas.getContext("2d")!;
        sCtx.fillStyle = "#ffffff";
        sCtx.fillRect(0, 0, 2, 2);
        const starTex = new DynamicTexture("starTex", starCanvas, null, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE);
        starTex._texture = engine.createDynamicTexture(2, 2, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE);
        engine.updateDynamicTexture(starTex._texture, starCanvas, false);

        for (let i = 0; i < 40; i++) {
            const star = new Sprite2D(`star_${i}`, null);
            star.parent = starsParent;
            star.width = 1 + Math.random() * 2;
            star.height = star.width;
            star.position.x = Math.random() * LEVEL_WIDTH * TILE;
            star.position.y = -200 + Math.random() * 400; // Sky area above terrain
            star.texture = starTex;
            star.alpha = 0.3 + Math.random() * 0.7;
            star.tint = new Color4(
                (0.7 + Math.random() * 0.3) * 3,
                (0.7 + Math.random() * 0.3) * 3,
                1.0 * 3,
                1
            );
        }
    }

    // ─── Player ──────────────────────────────────────────────────────
    const player = new Sprite2D("player");
    scene.addNode(player);
    player.width = 28;
    player.height = 44;
    player.position = new Vector2(3 * TILE + TILE / 2, 5 * TILE);
    player.texture = gameAtlas.texture;
    player.sourceRect = gameAtlas.getFrame("player");
    player.tint = new Color4(0.3, 0.9, 0.5, 1);

    const playerBody = physics.addBody(player, {
        bodyType: PhysicsBodyType2D.Dynamic,
        shape: { type: "box", width: 24, height: 40 },
        fixedRotation: true,
        friction: 0,
        density: 1,
    });

    // ─── Enemies ─────────────────────────────────────────────────────
    const enemies = createEnemies(scene, physics, TILE, gameAtlas);

    // ─── Collectibles ────────────────────────────────────────────────
    const collectibles = createCollectibles(scene, TILE, lighting, gameAtlas);

    // ─── Projectile Pool (ObjectPool) ────────────────────────────────
    const { bulletPool, activeBullets } = createBulletPool(scene, physics, lighting, gameAtlas);

    // ─── Camera Follow ───────────────────────────────────────────────
    camera.lockedTarget = player;
    camera.lerpSpeed = 0.06;
    camera.bounds = new Rectangle2D(0, 0, LEVEL_WIDTH * TILE, LEVEL_HEIGHT * TILE);

    // ─── HUD (Text2D + NineSliceSprite2D) ────────────────────────────
    const DESIGN_W = 480;
    const DESIGN_H = 270;

    // ─── RenderTexture2D — Dash Trail / Afterimage ───────────────────
    // Renders the scene to an offscreen texture each frame, then displays
    // that texture as a full-screen sprite behind everything at low alpha.
    // The trail sprite is hidden during RT capture to avoid reading from
    // and writing to the same texture simultaneously. During dashes, the
    // player's ghost appears as a faint afterimage.
    const trailRT = new RenderTexture2D("dashTrail", engine, DESIGN_W, DESIGN_H);

    const trailSprite = new Sprite2D("trailSprite");
    scene.addNode(trailSprite);
    trailSprite.width = DESIGN_W;
    trailSprite.height = DESIGN_H;
    trailSprite.texture = trailRT.texture;
    trailSprite.sortingLayer = 1; // Above gameplay, below HUD
    trailSprite.alpha = 0;
    trailSprite.visible = false;

    // Create a 9-slice panel texture: 16×16 with 2px lighter border, dark interior
    const panelCanvas = document.createElement("canvas");
    panelCanvas.width = 16;
    panelCanvas.height = 16;
    const pCtx = panelCanvas.getContext("2d")!;
    pCtx.fillStyle = "rgba(100, 180, 255, 0.5)";
    pCtx.fillRect(0, 0, 16, 16);
    pCtx.fillStyle = "rgba(10, 15, 30, 0.8)";
    pCtx.fillRect(2, 2, 12, 12);

    const panelTex = new DynamicTexture("panelTex", panelCanvas, null, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE);
    panelTex._texture = engine.createDynamicTexture(16, 16, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE);
    engine.updateDynamicTexture(panelTex._texture, panelCanvas, false);

    // Score panel using NineSliceSprite2D
    const scorePanel = new NineSliceSprite2D("scorePanel", panelTex);
    scorePanel.setUniformBorders(2);
    scorePanel.width = 58;
    scorePanel.height = 14;
    scorePanel.sortingLayer = 1000;
    scorePanel.zIndex = 0;
    scene.addNode(scorePanel);

    // Score text using Text2D — render at 2× then scale 0.5 for crisp text
    const TEXT_SCALE = 0.5;
    const scoreText = new Text2D("scoreText", "Score: 0 / 17", {
        font: "bold 14px monospace",
        color: "#ffffff",
        textAlign: "center",
        textBaseline: "middle",
    });
    scoreText.sortingLayer = 1000;
    scoreText.zIndex = 1;
    scoreText.scale = new Vector2(TEXT_SCALE, TEXT_SCALE);
    scene.addNode(scoreText);

    // Debug text using Text2D (replaces HTML debug overlay)
    const debugText = new Text2D("debugText", "", {
        font: "12px monospace",
        color: "#00ff66",
    });
    debugText.sortingLayer = 1000;
    debugText.zIndex = 1;
    debugText.scale = new Vector2(TEXT_SCALE, TEXT_SCALE);
    scene.addNode(debugText);

    // Debug mode indicator
    const debugIndicator = new Text2D("debugIndicator", "", {
        font: "bold 14px monospace",
        color: "#ff0000",
    });
    debugIndicator.sortingLayer = 1001;
    debugIndicator.zIndex = 2;
    debugIndicator.scale = new Vector2(TEXT_SCALE, TEXT_SCALE);
    scene.addNode(debugIndicator);

    // ─── Control Hints — fade out after 5 seconds ───────────────────
    const hintText = new Text2D("hintText", "← → Move  |  Space Jump  |  Shift Dash  |  X Shoot  |  F3 Debug", {
        font: "bold 10px monospace",
        color: "#aaccff",
        textAlign: "center",
        textBaseline: "middle",
    });
    hintText.sortingLayer = 1000;
    hintText.zIndex = 2;
    hintText.scale = new Vector2(TEXT_SCALE, TEXT_SCALE);
    scene.addNode(hintText);

    // Auto-fade the hints after 5 seconds
    setTimeout(() => {
        tweenManager.add(
            Tween.Create(1.0, 0.0, 2.0, Easing.QuadOut, (value: number) => {
                hintText.alpha = value;
            })
        );
    }, 5000);

    // Health bar background (NineSlice)
    const healthPanel = new NineSliceSprite2D("healthPanel", panelTex);
    healthPanel.setUniformBorders(2);
    healthPanel.width = 52;
    healthPanel.height = 10;
    healthPanel.sortingLayer = 1000;
    healthPanel.zIndex = 0;
    scene.addNode(healthPanel);

    // Health bar fill (simple Sprite2D with red-to-green tinting)
    const healthFillCanvas = document.createElement("canvas");
    healthFillCanvas.width = 4;
    healthFillCanvas.height = 4;
    const hfCtx = healthFillCanvas.getContext("2d")!;
    hfCtx.fillStyle = "#ffffff";
    hfCtx.fillRect(0, 0, 4, 4);
    const healthFillTex = new DynamicTexture("healthFillTex", healthFillCanvas, null, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE);
    healthFillTex._texture = engine.createDynamicTexture(4, 4, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE);
    engine.updateDynamicTexture(healthFillTex._texture, healthFillCanvas, false);

    const healthFill = new Sprite2D("healthFill");
    healthFill.texture = healthFillTex;
    healthFill.width = 48;
    healthFill.height = 6;
    healthFill.sortingLayer = 1000;
    healthFill.zIndex = 1;
    healthFill.tint = new Color4(0.3, 0.9, 0.3, 1);
    scene.addNode(healthFill);

    // Health label
    const healthLabel = new Text2D("healthLabel", "HP", {
        font: "bold 8px monospace",
        color: "#ff6666",
        textAlign: "right",
        textBaseline: "middle",
    });
    healthLabel.sortingLayer = 1000;
    healthLabel.zIndex = 2;
    healthLabel.scale = new Vector2(TEXT_SCALE, TEXT_SCALE);
    scene.addNode(healthLabel);

    // Title text with subtle alpha pulse
    const titleText = new Text2D("titleText", "BABYLON.JS 2D", {
        font: "bold 10px monospace",
        color: "#6688cc",
        textAlign: "center",
        textBaseline: "middle",
    });
    titleText.sortingLayer = 1000;
    titleText.zIndex = 2;
    titleText.scale = new Vector2(TEXT_SCALE, TEXT_SCALE);
    scene.addNode(titleText);

    // Gem icon next to score
    const gemIcon = new Sprite2D("gemIcon");
    gemIcon.texture = gameAtlas.texture;
    gemIcon.sourceRect = gameAtlas.getFrame("collectible");
    gemIcon.width = 10;
    gemIcon.height = 10;
    gemIcon.sortingLayer = 1000;
    gemIcon.zIndex = 1;
    scene.addNode(gemIcon);

    // Helper: position HUD elements relative to camera viewport edges
    function updateHUD() {
        const cx = camera.position.x;
        const cy = camera.position.y;
        // Compute actual visible world half-extents (handles resize + design resolution)
        const { scaleX, scaleY } = camera.effectiveScale;
        const hw = camera.viewportWidth / (2 * scaleX);
        const hh = camera.viewportHeight / (2 * scaleY);

        // Health bar — top-left (label to the left of the bar)
        const hlw = healthLabel.width * TEXT_SCALE;
        const hpX = cx - hw + hlw + 30;
        const hpY = cy - hh + 8;
        healthPanel.position.x = hpX;
        healthPanel.position.y = hpY;
        const healthRatio = playerHealth / MAX_HEALTH;
        healthFill.width = 48 * healthRatio;
        healthFill.position.x = hpX - (48 - healthFill.width) / 2;
        healthFill.position.y = hpY;
        // Color: green → yellow → red
        healthFill.tint = healthRatio > 0.5
            ? new Color4(0.3, 0.9, 0.3, 1)
            : healthRatio > 0.25
                ? new Color4(0.9, 0.9, 0.2, 1)
                : new Color4(0.9, 0.2, 0.2, 1);
        healthLabel.position.x = cx - hw + hlw / 2 + 2;
        healthLabel.position.y = hpY;

        // Score panel + gem icon + text — top-right
        const tw = scoreText.width * TEXT_SCALE;
        const th = scoreText.height * TEXT_SCALE;
        const panelW = tw + 16; // Extra space for gem icon
        const panelH = th + 4;
        scorePanel.width = panelW;
        scorePanel.height = panelH;
        const hudX = cx + hw - panelW / 2 - 4;
        const hudY = cy - hh + panelH / 2 + 4;
        scorePanel.position.x = hudX;
        scorePanel.position.y = hudY;
        gemIcon.position.x = hudX - panelW / 2 + 8;
        gemIcon.position.y = hudY;
        scoreText.position.x = hudX + 4;
        scoreText.position.y = hudY;

        // Title — top-center
        titleText.position.x = cx;
        titleText.position.y = cy - hh + 8;

        // Debug text — bottom-left
        const dtw = debugText.width * TEXT_SCALE;
        const dth = debugText.height * TEXT_SCALE;
        debugText.position.x = cx - hw + dtw / 2 + 4;
        debugText.position.y = cy + hh - dth / 2 - 4;

        // Debug mode indicator — top-left (below health bar)
        if (debugMode) {
            debugIndicator.text = "[F3] DEBUG";
            const diw = debugIndicator.width * TEXT_SCALE;
            const dih = debugIndicator.height * TEXT_SCALE;
            debugIndicator.position.x = cx - hw + diw / 2 + 4;
            debugIndicator.position.y = cy - hh + dih / 2 + 18;
        } else {
            debugIndicator.text = "";
        }

        // Control hints — bottom center
        const hth = hintText.height * TEXT_SCALE;
        hintText.position.x = cx;
        hintText.position.y = cy + hh - hth / 2 - 6;
    }

    // ─── Player State ────────────────────────────────────────────────
    let onGround = false;
    let wasInAir = false;
    let jumpBuffer = 0;
    let coyoteTime = 0;
    let dashCooldown = 0;
    let isDashing = false;
    let dashTimer = 0;
    let dashDir = 1;
    let dashJustStarted = false;
    let skidTimer = 0;
    let trailFade = 0;
    let facingRight = true;
    let score = 0;
    let playerHealth = 3;
    const MAX_HEALTH = 3;
    let shootCooldown = 0;
    const MOVE_SPEED = 350;
    const JUMP_FORCE = 800;
    const DASH_SPEED = 800;
    const DASH_DURATION = 0.15;
    const DASH_COOLDOWN = 0.5;
    const SHOOT_COOLDOWN = 0.25;

    // Ground detection via contact callbacks
    let groundContacts = 0;
    physics.onBeginContact((a, b) => {
        if (a.node === player || b.node === player) {
            const other = a.node === player ? b : a;
            // Check if contact is from below (feet)
            if (other.node.position.y > player.position.y + 10) {
                groundContacts++;
                onGround = true;
                coyoteTime = 0.1;
            }
        }
    });
    physics.onEndContact((a, b) => {
        if (a.node === player || b.node === player) {
            const other = a.node === player ? b : a;
            if (other.node.position.y > player.position.y + 10) {
                groundContacts = Math.max(0, groundContacts - 1);
                if (groundContacts === 0) {
                    onGround = false;
                }
            }
        }
    });

    // ─── Game Loop ───────────────────────────────────────────────────
    let lastTime = performance.now();

    engine.runRenderLoop(() => {
        const now = performance.now();
        const dt = Math.min((now - lastTime) / 1000, 0.05); // Cap at 50ms
        lastTime = now;

        input.update();

        // ── Player Movement ──
        // Landing shake
        if (onGround && wasInAir) {
            camera.shake(2, 0.1);
            dustPS.emitter = new Vector3(player.position.x, player.position.y + 20, 0);
            dustPS.manualEmitCount = 8;
            player.scale = new Vector2(1.2, 0.7);
            tweenManager.add(Tween.Create(0.7, 1.0, 0.15, Easing.BounceOut)
                .onUpdate((v: number) => { player.scale.y = v; }));
            tweenManager.add(Tween.Create(1.2, 1.0, 0.15, Easing.BounceOut)
                .onUpdate((v: number) => { player.scale.x = v; }));
        }
        wasInAir = !onGround;

        const vel = playerBody.getLinearVelocity();
        let moveX = 0;

        if (!isDashing) {
            if (input.isActionDown("moveRight")) {
                moveX = 1;
                facingRight = true;
            }
            if (input.isActionDown("moveLeft")) {
                moveX = -1;
                facingRight = false;
            }
            player.flipX = !facingRight;
        }

        // Jump buffer
        if (input.isActionPressed("jump")) {
            jumpBuffer = 0.1;
        }
        jumpBuffer = Math.max(0, jumpBuffer - dt);

        // Coyote time — keep refreshed while on ground
        if (onGround) {
            coyoteTime = 0.1;
        } else {
            coyoteTime = Math.max(0, coyoteTime - dt);
        }

        // Jump
        if (jumpBuffer > 0 && coyoteTime > 0 && !isDashing) {
            playerBody.setLinearVelocity(new Vector2(vel.x, -JUMP_FORCE));
            jumpBuffer = 0;
            coyoteTime = 0;
            onGround = false;
            sfxJump(); // 🔊 Rising chirp
            player.scale = new Vector2(0.8, 1.3);
            tweenManager.add(Tween.Create(1.3, 1.0, 0.1, Easing.QuadOut)
                .onUpdate((v: number) => { player.scale.y = v; }));
            tweenManager.add(Tween.Create(0.8, 1.0, 0.1, Easing.QuadOut)
                .onUpdate((v: number) => { player.scale.x = v; }));
            camera.shake(1.5, 0.06);
        }

        // Reset ground if moving upward
        if (vel.y < -50) {
            onGround = false;
        }

        // Shoot
        shootCooldown = Math.max(0, shootCooldown - dt);
        if (input.isActionPressed("shoot") && shootCooldown <= 0) {
            shootCooldown = SHOOT_COOLDOWN;
            const bullet = bulletPool.acquire();
            const offsetX = facingRight ? 20 : -20;
            bullet.spawn(player.position.x + offsetX, player.position.y, facingRight ? 1 : -1);
            activeBullets.push(bullet);
            sfxShoot(); // 🔊 Descending pew
        }

        // Dash
        dashCooldown = Math.max(0, dashCooldown - dt);
        if (input.isActionPressed("dash") && dashCooldown <= 0 && !isDashing) {
            isDashing = true;
            dashTimer = DASH_DURATION;
            dashCooldown = DASH_COOLDOWN;
            dashDir = facingRight ? 1 : -1;
            dashJustStarted = true;
            trailFade = 1.0;
            sfxDash(); // 🔊 Sawtooth whoosh
            camera.shake(2, 0.08);
            // Dash stretch
            player.scale = new Vector2(1.4, 0.8);
            tweenManager.add(Tween.Create(1.4, 1.0, 0.12, Easing.QuadOut)
                .onUpdate((v: number) => { player.scale.x = v; }));
            tweenManager.add(Tween.Create(0.8, 1.0, 0.12, Easing.QuadOut)
                .onUpdate((v: number) => { player.scale.y = v; }));
        }

        if (isDashing) {
            dashTimer -= dt;
            if (dashTimer <= 0) {
                isDashing = false;
                skidTimer = 0.1; // Brief deceleration
            } else {
                playerBody.setLinearVelocity(new Vector2(dashDir * DASH_SPEED, 0));
                player.tint = new Color4(0.8, 1.0, 0.8, 0.7); // Flash during dash
            }
        } else {
            // Re-read velocity so jump's Y component isn't overwritten by stale `vel`
            const currentVel = playerBody.getLinearVelocity();
            if (skidTimer > 0) {
                skidTimer -= dt;
                // Skid: gradually reduce speed from dash velocity to normal
                const skidFactor = skidTimer / 0.1;
                const skidSpeed = moveX * MOVE_SPEED + dashDir * DASH_SPEED * skidFactor * 0.5;
                playerBody.setLinearVelocity(new Vector2(skidSpeed, currentVel.y));
            } else {
                playerBody.setLinearVelocity(new Vector2(moveX * MOVE_SPEED, currentVel.y));
            }
            player.tint = new Color4(0.3, 0.9, 0.5, 1);
        }

        // ── Enemy AI ──
        // Camera look-ahead — offset toward facing direction
        const targetOffsetX = facingRight ? 40 : -40;
        camera.followOffset.x += (targetOffsetX - camera.followOffset.x) * 0.05;

        for (const enemy of enemies) {
            updateEnemy(enemy, player, dt);
            // Enemy contact damage
            if (enemy.context.playerDist < 35 && playerHealth > 0 && dashCooldown < DASH_COOLDOWN - 0.3) {
                playerHealth--;
                camera.shake(4, 0.15);
                player.tint = new Color4(1, 0.3, 0.3, 1);
                tweenManager.add(Tween.Create(0.3, 1.0, 0.3, Easing.QuadOut)
                    .onUpdate((v: number) => {
                        player.tint.g = v * 0.9;
                        player.tint.b = v * 0.5;
                    }));
                // Brief invincibility via dash cooldown reuse
                dashCooldown = DASH_COOLDOWN;
            }
        }

        // ── Bullet Updates ──
        updateBullets(bulletPool, activeBullets, enemies, dt, camera, tweenManager, sparkPS);

        // ── Collectibles ──
        const px = player.position.x;
        const py = player.position.y;

        // Update player light position
        playerLight.position.x = px;
        playerLight.position.y = py;

        for (const c of collectibles) {
            if (!c.collected) {
                const dx = c.sprite.position.x - px;
                const dy = c.sprite.position.y - py;
                if (dx * dx + dy * dy < 600) {
                    c.collected = true;
                    score++;
                    collectPS.emitter = new Vector3(c.sprite.position.x, c.sprite.position.y, 0);
                    collectPS.manualEmitCount = 15;
                    // Pickup burst: scale up + fade out
                    tweenManager.add(Tween.Create(1.0, 1.8, 0.3, Easing.QuadOut)
                        .onUpdate((v: number) => {
                            c.sprite.scale.x = v;
                            c.sprite.scale.y = v;
                        }));
                    tweenManager.add(Tween.Create(1.0, 0.0, 0.3, Easing.QuadOut)
                        .onUpdate((v: number) => { c.sprite.alpha = v; }));
                    // Score text bump
                    scoreText.scale = new Vector2(TEXT_SCALE * 1.3, TEXT_SCALE * 1.3);
                    tweenManager.add(Tween.Create(TEXT_SCALE * 1.3, TEXT_SCALE, 0.2, Easing.BackOut)
                        .onUpdate((v: number) => {
                            scoreText.scale.x = v;
                            scoreText.scale.y = v;
                        }));
                    if (c.light) { c.light.enabled = false; }
                    sfxCollect(); // 🔊 Pleasant ding
                }
            }
            // Bobbing animation + light follows
            if (!c.collected) {
                c.sprite.position.y = c.baseY + Math.sin(now / 400 + c.phase) * 4;
                if (c.light) { c.light.position.y = c.sprite.position.y; }
            }
        }

        // ── Physics Step ──
        physics.step(dt);

        // ── Scene + Camera Update ──
        scene.update(dt);
        tweenManager.update(dt);
        camera.update(dt);

        // Ambient motes follow camera
        ambientPS.emitter = new Vector3(camera.position.x, camera.position.y, 0);

        // ── SpatialAudio2D — sync listener to camera position ──
        // This keeps the Web Audio API listener centered on the camera so
        // any future spatial sounds (e.g. positional enemy audio) pan
        // correctly relative to the viewport.
        if (_audioCtx) {
            spatialAudio.update(camera);
        }

        // ── HUD Update (Text2D + NineSliceSprite2D) ──
        // Torch flicker
        const flickerTime = performance.now() / 1000;
        torch1.intensity = 1.5 + Math.sin(flickerTime * 8) * 0.3 + Math.sin(flickerTime * 13) * 0.15;
        torch2.intensity = 1.5 + Math.sin(flickerTime * 7 + 2) * 0.3 + Math.sin(flickerTime * 11 + 1) * 0.15;

        // Title text alpha pulse
        titleText.alpha = 0.6 + Math.sin(performance.now() / 1500) * 0.3;

        scoreText.text= `Score: ${score} / ${collectibles.length}`;
        debugText.text = `FPS: ${engine.getFps().toFixed(0)} | Pos: ${player.position.x.toFixed(0)},${player.position.y.toFixed(0)} | Ground: ${onGround} | Pool: ${bulletPool.activeCount}/${bulletPool.totalCreated}`;
        updateHUD();

        // ── RenderTexture2D: Dash Trail Afterimage ──
        // During dashes, stamp only the player into the RT (no clear) to
        // accumulate ghost positions. Temporarily swap the camera viewport
        // to the RT dimensions so the view transform offset matches the
        // projection, then restore the canvas viewport afterward.
        if (isDashing) {
            // Save and swap camera viewport to match RT dimensions
            const savedVpW = camera.viewportWidth;
            const savedVpH = camera.viewportHeight;
            camera.setViewport(DESIGN_W, DESIGN_H);

            // Hide everything except the player for a focused afterimage
            const roots = scene.rootNodes;
            const savedVis: boolean[] = [];
            for (let i = 0; i < roots.length; i++) {
                savedVis[i] = roots[i].visible;
                if (roots[i] !== player) {
                    roots[i].visible = false;
                }
            }

            trailRT.renderScene(scene, dashJustStarted);
            dashJustStarted = false;

            // Restore visibility
            for (let i = 0; i < roots.length; i++) {
                roots[i].visible = savedVis[i];
            }
            camera.setViewport(savedVpW, savedVpH);

            trailSprite.visible = true;
            trailSprite.alpha = 0.5;
        } else if (trailFade > 0) {
            trailFade = Math.max(0, trailFade - dt * 3);
            trailSprite.alpha = trailFade * 0.5;
            trailSprite.visible = trailFade > 0.01;
        } else {
            trailSprite.visible = false;
        }
        trailSprite.position.x = camera.position.x;
        trailSprite.position.y = camera.position.y;

        scene.render();

        // ── Particles (rendered on top of scene, below debug) ──
        particleHelper.render();

        // ── DebugRenderer2D ──
        if (debugMode && debugRenderer.isReady) {
            const viewTransform = camera.getViewTransform();
            const vpWidth = engine.getRenderWidth();
            const vpHeight = engine.getRenderHeight();
            debugRenderer.render(viewTransform, vpWidth, vpHeight);
        }
    });

    window.addEventListener("resize", () => {
        engine.resize();
        camera.setViewport(engine.getRenderWidth(), engine.getRenderHeight());
    });
}

// ─── Level Generation ────────────────────────────────────────────────
function generateLevel(width: number, height: number): number[][] {
    const level: number[][] = [];
    for (let r = 0; r < height; r++) {
        level[r] = new Array(width).fill(0);
    }

    // Floor
    for (let c = 0; c < width; c++) {
        level[height - 1][c] = 1;
        level[height - 2][c] = 1;
    }

    // Walls
    for (let r = 0; r < height; r++) {
        level[r][0] = 1;
        level[r][width - 1] = 1;
    }

    // Platforms
    const platformDefs = [
        { x: 5, y: 14, w: 6 },
        { x: 14, y: 12, w: 5 },
        { x: 22, y: 10, w: 7 },
        { x: 8, y: 8, w: 5 },
        { x: 16, y: 6, w: 8 },
        { x: 30, y: 14, w: 4 },
        { x: 36, y: 11, w: 6 },
        { x: 44, y: 9, w: 5 },
        { x: 50, y: 13, w: 7 },
        { x: 58, y: 10, w: 5 },
        { x: 65, y: 7, w: 6 },
        { x: 40, y: 5, w: 4 },
        { x: 55, y: 4, w: 5 },
        { x: 70, y: 14, w: 8 },
    ];

    for (const p of platformDefs) {
        for (let c = p.x; c < p.x + p.w && c < width; c++) {
            if (c >= 0 && c < width && p.y >= 0 && p.y < height) {
                level[p.y][c] = 1;
            }
        }
    }

    // Some pillars / walls
    const walls = [
        { x: 12, y1: 14, y2: 17 },
        { x: 28, y1: 12, y2: 17 },
        { x: 48, y1: 11, y2: 17 },
        { x: 63, y1: 8, y2: 17 },
    ];
    for (const w of walls) {
        for (let r = w.y1; r <= w.y2 && r < height; r++) {
            if (w.x >= 0 && w.x < width) {
                level[r][w.x] = 1;
            }
        }
    }

    return level;
}

// ─── Pixel-Art Sprite Generators ─────────────────────────────────────

/** Create a pixel-art player sprite — small character with head, body, legs, dark outline */
function createPlayerSprite(width: number, height: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    const outline = "#1a2a1a";
    const bodyLight = "#5ddb6e";
    const bodyDark = "#2d8a3a";
    const eyeColor = "#ffffff";

    // Body outline
    ctx.fillStyle = outline;
    ctx.fillRect(8, 0, 12, 4); // top of head
    ctx.fillRect(6, 4, 16, 2); // head sides
    ctx.fillRect(4, 6, 20, 28); // body block
    ctx.fillRect(6, 34, 6, 10); // left leg
    ctx.fillRect(16, 34, 6, 10); // right leg

    // Body fill
    ctx.fillStyle = bodyLight;
    ctx.fillRect(10, 2, 8, 2); // inner head top
    ctx.fillRect(8, 4, 12, 6); // head fill
    ctx.fillRect(6, 10, 16, 22); // torso
    ctx.fillStyle = bodyDark;
    ctx.fillRect(6, 22, 16, 10); // lower torso (darker)
    ctx.fillRect(8, 34, 4, 8); // left leg inner
    ctx.fillRect(16, 34, 4, 8); // right leg inner (gap = 4px stride)

    // Eyes
    ctx.fillStyle = eyeColor;
    ctx.fillRect(10, 6, 2, 2);
    ctx.fillRect(16, 6, 2, 2);

    // Belt detail
    ctx.fillStyle = "#8B7355";
    ctx.fillRect(6, 20, 16, 2);

    return c;
}

/** Create a pixel-art enemy sprite — angular slime/blob shape with angry eyes */
function createEnemySprite(width: number, height: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    const outline = "#2a0a0a";
    const bodyLight = "#e03030";
    const bodyDark = "#8a1515";

    // Blob shape (wider at bottom)
    ctx.fillStyle = outline;
    ctx.fillRect(8, 2, 14, 4); // top
    ctx.fillRect(4, 6, 22, 4); // upper mid
    ctx.fillRect(2, 10, 26, 12); // body
    ctx.fillRect(0, 22, 30, 8); // base (widest)

    // Fill
    ctx.fillStyle = bodyLight;
    ctx.fillRect(10, 4, 10, 2);
    ctx.fillRect(6, 6, 18, 4);
    ctx.fillRect(4, 10, 22, 10);
    ctx.fillStyle = bodyDark;
    ctx.fillRect(2, 20, 26, 8);

    // Angry eyes
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(8, 10, 4, 4);
    ctx.fillRect(18, 10, 4, 4);
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(10, 12, 2, 2);
    ctx.fillRect(20, 12, 2, 2);

    // Angry eyebrows (angled down toward center)
    ctx.fillStyle = outline;
    ctx.fillRect(7, 8, 6, 2);
    ctx.fillRect(17, 8, 6, 2);

    return c;
}

/** Create a terrain tile with cracks, grass tufts on surface tiles */
function createTerrainSprite(width: number, height: number, variant: number, isTopSurface: boolean): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    // Base stone fill
    const baseColors = ["#3a3545", "#35304a", "#2e2940"];
    ctx.fillStyle = baseColors[variant % 3];
    ctx.fillRect(0, 0, width, height);

    // Darker border
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(0, 0, width, 1);
    ctx.fillRect(0, 0, 1, height);
    ctx.fillRect(width - 1, 0, 1, height);
    ctx.fillRect(0, height - 1, width, 1);

    // Noise dots for texture
    const rng = (variant * 7 + 13) % 97;
    for (let i = 0; i < 6; i++) {
        const nx = ((rng * (i + 1) * 31) % (width - 4)) + 2;
        const ny = ((rng * (i + 1) * 47) % (height - 4)) + 2;
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(nx, ny, 2, 2);
    }

    // Crack lines
    if (variant % 2 === 0) {
        ctx.fillStyle = "rgba(0,0,0,0.2)";
        ctx.fillRect(12, 8, 1, 12);
        ctx.fillRect(13, 18, 1, 8);
        ctx.fillRect(26, 4, 1, 16);
    }

    // Grass tufts on top-surface tiles
    if (isTopSurface) {
        ctx.fillStyle = "#4a7a3a";
        ctx.fillRect(4, 0, 2, 3);
        ctx.fillRect(12, 0, 3, 4);
        ctx.fillRect(22, 0, 2, 3);
        ctx.fillRect(32, 0, 3, 2);
        ctx.fillStyle = "#6aaa4a";
        ctx.fillRect(5, 0, 1, 2);
        ctx.fillRect(13, 0, 1, 3);
        ctx.fillRect(23, 0, 1, 2);
    }

    return c;
}

/** Create a gem collectible with faceted highlight */
function createGemSprite(width: number, height: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    // Octagonal gem shape
    ctx.fillStyle = "#e8a820";
    ctx.fillRect(4, 0, 8, 2); // top
    ctx.fillRect(2, 2, 12, 4); // upper
    ctx.fillRect(0, 6, 16, 4); // middle (widest)
    ctx.fillRect(2, 10, 12, 4); // lower
    ctx.fillRect(4, 14, 8, 2); // bottom

    // Inner highlight (upper-left)
    ctx.fillStyle = "#ffd86a";
    ctx.fillRect(4, 2, 6, 2);
    ctx.fillRect(2, 4, 4, 4);

    // Dark facet (lower-right)
    ctx.fillStyle = "#b07810";
    ctx.fillRect(8, 10, 6, 4);
    ctx.fillRect(6, 12, 4, 2);

    // Sparkle pixel
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(4, 4, 2, 2);

    return c;
}

/** Create a bullet/projectile with gradient glow */
function createBulletSprite(width: number, height: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    // Outer glow
    ctx.fillStyle = "rgba(50, 180, 255, 0.3)";
    ctx.fillRect(0, 0, width, height);

    // Core
    ctx.fillStyle = "#40c8ff";
    ctx.fillRect(2, 1, width - 4, height - 2);

    // Bright center
    ctx.fillStyle = "#b0f0ff";
    ctx.fillRect(3, 2, width - 6, height - 4);

    // Hot pixel
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(4, 2, 2, 2);

    return c;
}

/** Create a distant mountain/hill silhouette for far parallax */
function createFarBgSprite(width: number, height: number, seed: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    // White silhouette — tint handles color, lighting handles brightness
    ctx.fillStyle = "#ffffff";
    const peakX = width * 0.3 + (seed % 5) * width * 0.1;
    const peakY = height * 0.15 + (seed % 3) * height * 0.05;
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(peakX * 0.3, height * 0.5);
    ctx.lineTo(peakX, peakY);
    ctx.lineTo(peakX + width * 0.2, height * 0.35);
    ctx.lineTo(width * 0.8, height * 0.6);
    ctx.lineTo(width, height * 0.7);
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();

    // Slight highlight on peak
    ctx.fillStyle = "rgba(200, 200, 255, 0.3)";
    ctx.fillRect(Math.floor(peakX) - 2, Math.floor(peakY), 4, 4);

    return c;
}

/** Create a mid-distance tree/ruin silhouette */
function createMidBgSprite(width: number, height: number, seed: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = "#ffffff";
    if (seed % 2 === 0) {
        // Dead tree
        const trunkX = width * 0.4;
        ctx.fillRect(trunkX, height * 0.2, 4, height * 0.8);
        ctx.fillRect(trunkX - 8, height * 0.3, 12, 3);
        ctx.fillRect(trunkX + 2, height * 0.15, 10, 3);
        ctx.fillRect(trunkX - 4, height * 0.5, 6, 3);
    } else {
        // Ruined building
        ctx.fillRect(4, height * 0.3, width - 8, height * 0.7);
        ctx.fillRect(2, height * 0.3, width - 4, 4);
        ctx.clearRect(10, height * 0.45, 6, 8);
        ctx.clearRect(width - 16, height * 0.45, 6, 8);
        ctx.clearRect(width * 0.6, height * 0.3, 8, 10);
    }

    return c;
}

/** Create a near foreground rock/bush */
function createNearBgSprite(width: number, height: number, seed: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    if (seed % 2 === 0) {
        // Rock
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(4, height * 0.3, width - 8, height * 0.7);
        ctx.fillRect(8, height * 0.2, width - 16, height * 0.15);
        ctx.fillStyle = "rgba(200, 200, 255, 0.3)";
        ctx.fillRect(6, height * 0.3, 4, height * 0.3);
    } else {
        // Glowing fungus cluster
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(8, height * 0.5, width - 16, height * 0.5);
        ctx.fillRect(4, height * 0.3, 6, 8);
        ctx.fillRect(14, height * 0.2, 8, 10);
        ctx.fillRect(width - 12, height * 0.35, 6, 8);
        // Glow spots (brighter)
        ctx.fillStyle = "rgba(180, 255, 230, 0.6)";
        ctx.fillRect(5, height * 0.3, 4, 4);
        ctx.fillRect(16, height * 0.2, 4, 4);
        ctx.fillRect(width - 11, height * 0.35, 4, 4);
    }

    return c;
}

// ─── Tile Colors ─────────────────────────────────────────────────────
function getTileColor(row: number, level: number[][]): Color4 {
    const h = level.length;
    const t = 1 - row / h;
    const r = 0.15 + t * 0.15;
    const g = 0.2 + t * 0.2;
    const b = 0.3 + t * 0.25;
    return new Color4(r, g, b, 1);
}

// ─── Parallax ────────────────────────────────────────────────────────
interface IParallaxLayer {
    parent: Node2D;
    sprites: Sprite2D[];
    factor: number;
}

function createParallaxLayers(scene: Scene2D, levelWidth: number, atlas: SpriteAtlas): IParallaxLayer[] {
    const layers: IParallaxLayer[] = [];
    // Ground Y in world coords (floor is at row 18, TILE=40)
    const groundY = 18 * 40;

    const layerDefs = [
        {
            color: new Color4(1.2, 1.0, 2.4, 0.25), // Faint blue-violet mountains
            factor: 0.1, count: 5, sizeMin: 100, sizeMax: 180,
            atlasPrefix: "bg_far",
        },
        {
            color: new Color4(1.0, 0.8, 2.0, 0.2), // Subtle purple trees/ruins
            factor: 0.3, count: 4, sizeMin: 40, sizeMax: 70,
            atlasPrefix: "bg_mid",
        },
        {
            color: new Color4(0.8, 0.7, 1.6, 0.18), // Near rocks/bushes
            factor: 0.5, count: 3, sizeMin: 18, sizeMax: 32,
            atlasPrefix: "bg_near",
        },
    ];

    for (const def of layerDefs) {
        const parent = new Node2D(`bg_layer_${def.factor}`);
        scene.addNode(parent);
        parent.zIndex = -100 + def.factor * 10;
        parent.scrollFactorX = def.factor;
        parent.scrollFactorY = 1.0; // Full vertical scroll — prevents floating when climbing
        const sprites: Sprite2D[] = [];

        for (let i = 0; i < def.count; i++) {
            // Pass null to avoid auto-adding to scene rootNodes (parent handles hierarchy)
            const s = new Sprite2D(`bg_${def.factor}_${i}`, null);
            s.parent = parent;
            const size = def.sizeMin + Math.random() * (def.sizeMax - def.sizeMin);
            s.width = size * (0.8 + Math.random() * 0.4);
            s.height = size;
            // Spread evenly across level width with jitter to avoid clustering
            const spacing = levelWidth / def.count;
            s.position.x = spacing * i + Math.random() * spacing * 0.6;
            // Bottom-align to ground floor (row 18). +2px overlap prevents sub-pixel gap.
            s.position.y = groundY - s.height / 2 + 2;
            s.texture = atlas.texture;
            s.sourceRect = atlas.getFrame(`${def.atlasPrefix}_${i % 3}`);
            s.tint = def.color;
            sprites.push(s);
        }

        layers.push({ parent, sprites, factor: def.factor });
    }

    return layers;
}

// ─── Enemies ─────────────────────────────────────────────────────────
interface IEnemyContext {
    sprite: Sprite2D;
    body: IPhysicsBody2D;
    patrolLeft: number;
    patrolRight: number;
    direction: number;
    speed: number;
    chaseRange: number;
    playerDist: number;
    playerDx: number;
}

interface IEnemy {
    sprite: Sprite2D;
    body: IPhysicsBody2D;
    fsm: StateMachine2D<IEnemyContext>;
    context: IEnemyContext;
}

function createEnemies(scene: Scene2D, physics: PlanckPhysicsEngine, tileSize: number, atlas: SpriteAtlas): IEnemy[] {
    const enemies: IEnemy[] = [];
    const enemyDefs = [
        { x: 7, y: 13, range: 3 },
        { x: 16, y: 11, range: 2 },
        { x: 25, y: 9, range: 3 },
        { x: 38, y: 10, range: 4 },
        { x: 52, y: 12, range: 3 },
        { x: 67, y: 6, range: 3 },
        { x: 73, y: 13, range: 4 },
    ];

    for (const def of enemyDefs) {
        const s = new Sprite2D(`enemy_${def.x}`);
        scene.addNode(s);
        s.width = 30;
        s.height = 30;
        s.position = new Vector2(def.x * tileSize + tileSize / 2, def.y * tileSize - tileSize / 2);
        s.texture = atlas.texture;
        s.sourceRect = atlas.getFrame("enemy");
        s.tint = new Color4(0.9, 0.2, 0.2, 1);

        const body = physics.addBody(s, {
            bodyType: PhysicsBodyType2D.Dynamic,
            shape: { type: "box", width: 26, height: 26 },
            fixedRotation: true,
            friction: 0,
        });

        const ctx: IEnemyContext = {
            sprite: s,
            body,
            patrolLeft: (def.x - def.range) * tileSize,
            patrolRight: (def.x + def.range) * tileSize,
            direction: 1,
            speed: 80 + Math.random() * 60,
            chaseRange: 200,
            playerDist: 9999,
            playerDx: 0,
        };

        // StateMachine2D — enemy AI with auto-transitions
        const fsm = new StateMachine2D<IEnemyContext>(ctx);

        fsm.addState({
            name: "patrol",
            onEnter: (c) => {
                c.sprite.tint = new Color4(0.9, 0.2, 0.2, 1);
            },
            onUpdate: (c) => {
                if (c.sprite.position.x > c.patrolRight) {
                    c.direction = -1;
                } else if (c.sprite.position.x < c.patrolLeft) {
                    c.direction = 1;
                }
                const vel = c.body.getLinearVelocity();
                c.body.setLinearVelocity(new Vector2(c.direction * c.speed, vel.y));
                c.sprite.flipX = c.direction < 0;
            },
        });

        fsm.addState({
            name: "chase",
            onEnter: (c) => {
                c.sprite.tint = new Color4(1.0, 0.4, 0.1, 1);
            },
            onUpdate: (c) => {
                const chaseDir = c.playerDx > 0 ? 1 : -1;
                const vel = c.body.getLinearVelocity();
                c.body.setLinearVelocity(new Vector2(chaseDir * c.speed * 1.5, vel.y));
                c.sprite.flipX = chaseDir < 0;
            },
        });

        fsm.addTransition({
            from: "patrol",
            to: "chase",
            condition: (c) => c.playerDist < c.chaseRange,
        });
        fsm.addTransition({
            from: "chase",
            to: "patrol",
            condition: (c) => c.playerDist >= c.chaseRange,
        });

        fsm.start("patrol");
        enemies.push({ sprite: s, body, fsm, context: ctx });
    }

    return enemies;
}

function updateEnemy(enemy: IEnemy, player: Sprite2D, dt: number): void {
    const dx = player.position.x - enemy.sprite.position.x;
    const dy = player.position.y - enemy.sprite.position.y;
    enemy.context.playerDist = Math.sqrt(dx * dx + dy * dy);
    enemy.context.playerDx = dx;
    enemy.fsm.update(dt);
}

// ─── Collectibles ────────────────────────────────────────────────────
interface ICollectible {
    sprite: Sprite2D;
    baseY: number;
    phase: number;
    collected: boolean;
    light?: any;
}

function createCollectibles(scene: Scene2D, tileSize: number, lighting: LightingManager2D, atlas: SpriteAtlas): ICollectible[] {
    const collectibles: ICollectible[] = [];
    const positions = [
        { x: 7, y: 13 },
        { x: 9, y: 13 },
        { x: 16, y: 11 },
        { x: 24, y: 9 },
        { x: 26, y: 9 },
        { x: 10, y: 7 },
        { x: 18, y: 5 },
        { x: 20, y: 5 },
        { x: 32, y: 13 },
        { x: 38, y: 10 },
        { x: 46, y: 8 },
        { x: 52, y: 12 },
        { x: 60, y: 9 },
        { x: 67, y: 6 },
        { x: 42, y: 4 },
        { x: 57, y: 3 },
        { x: 74, y: 13 },
    ];

    for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        const x = pos.x * tileSize + tileSize / 2;
        const y = pos.y * tileSize - tileSize / 2;

        const s = new Sprite2D(`collectible_${pos.x}_${pos.y}`);
        scene.addNode(s);
        s.width = 16;
        s.height = 16;
        s.position = new Vector2(x, y);
        s.texture = atlas.texture;
        s.sourceRect = atlas.getFrame("collectible");
        s.tint = new Color4(1.0, 0.85, 0.1, 1);
        s.zIndex = 5;

        // Glow on every other collectible (stay under 16-light limit)
        let cLight: any = null;
        if (i % 2 === 0) {
            cLight = lighting.createPointLight(x, y, new Color4(1, 0.9, 0.3, 1), 100);
            cLight.intensity = 1.0;
            cLight.falloff = 1.2;
        }

        collectibles.push({
            sprite: s,
            baseY: y,
            phase: Math.random() * Math.PI * 2,
            collected: false,
            light: cLight,
        });
    }

    return collectibles;
}

// ─── Bullet Pooling (ObjectPool) ─────────────────────────────────────
interface IBullet extends IPoolable {
    sprite: Sprite2D;
    body: IPhysicsBody2D;
    lifetime: number;
    maxLifetime: number;
    velocity: Vector2;
    active: boolean;
    light?: any;
    spawn(x: number, y: number, direction: number): void;
    update(dt: number): void;
}

function createBulletPool(scene: Scene2D, physics: PlanckPhysicsEngine, lighting: LightingManager2D, atlas: SpriteAtlas) {
    const BULLET_SPEED = 600;
    const BULLET_LIFETIME = 2.0;
    const activeBullets: IBullet[] = []; // Track active bullets externally (pool doesn't expose this)

    const pool = new ObjectPool<IBullet>({
        factory: () => {
            const sprite = new Sprite2D(`bullet_${pool.totalCreated}`);
            sprite.width = 12;
            sprite.height = 6;
            sprite.texture = atlas.texture;
            sprite.sourceRect = atlas.getFrame("bullet");
            sprite.tint = new Color4(0.2, 0.8, 1.0, 1);
            sprite.alpha = 0; // Start hidden
            sprite.zIndex = 10;
            scene.addNode(sprite);

            const body = physics.addBody(sprite, {
                bodyType: PhysicsBodyType2D.Dynamic,
                shape: { type: "box", width: 12, height: 6 },
                fixedRotation: true,
                bullet: true, // Planck continuous collision detection
                friction: 0,
                density: 0.1,
            });

            // Bullet light (cyan glow)
            const light = lighting.createPointLight(0, 0, new Color4(0.2, 0.9, 1.0, 1), 80);
            light.intensity = 0.8;
            light.falloff = 1.5;
            light.enabled = false;

            const bullet: IBullet = {
                sprite,
                body,
                lifetime: 0,
                maxLifetime: BULLET_LIFETIME,
                velocity: new Vector2(0, 0),
                active: false,
                light,

                spawn(x: number, y: number, direction: number) {
                    this.body.setPosition(new Vector2(x, y));
                    this.sprite.alpha = 1;
                    this.sprite.flipX = direction < 0;
                    this.velocity.x = direction * BULLET_SPEED;
                    this.velocity.y = 0;
                    this.body.setLinearVelocity(this.velocity);
                    this.lifetime = 0;
                    this.active = true;
                    if (this.light) {
                        this.light.position.x = x;
                        this.light.position.y = y;
                        this.light.enabled = true;
                    }
                },

                update(dt: number) {
                    if (!this.active) { return; }
                    this.lifetime += dt;
                    // Update light position
                    if (this.light) {
                        this.light.position.x = this.sprite.position.x;
                        this.light.position.y = this.sprite.position.y;
                        this.light.intensity = 0.6 + Math.sin(this.lifetime * 20) * 0.4;
                    }
                },

                // IPoolable lifecycle hooks
                onAcquire() {
                    // Called automatically by pool.acquire()
                },

                onRelease() {
                    // Called automatically by pool.release()
                    this.active = false;
                    this.sprite.alpha = 0;
                    if (this.light) { this.light.enabled = false; }
                }
            };

            return bullet;
        },

        reset: (bullet) => {
            // Reset state when released back to pool (called before onRelease)
            bullet.lifetime = 0;
            bullet.active = false;
            bullet.sprite.alpha = 0;
            bullet.body.setPosition(new Vector2(-9999, -9999));
            bullet.body.setLinearVelocity(new Vector2(0, 0));
            if (bullet.light) { bullet.light.enabled = false; }
        },

        maxPoolSize: 50,
        name: "BulletPool"
    });

    // Pre-warm the pool to avoid allocation spikes during gameplay
    pool.prewarm(20);

    return { bulletPool: pool, activeBullets };
}

function updateBullets(
    bulletPool: ObjectPool<IBullet>,
    activeBullets: IBullet[],
    enemies: IEnemy[],
    dt: number,
    camera: Camera2D,
    tweenManager: TweenManager,
    sparkPS: ParticleSystem
): void {
    // Update all active bullets and check for expiration / collisions
    for (let i = activeBullets.length - 1; i >= 0; i--) {
        const bullet = activeBullets[i];
        bullet.update(dt);

        // Expire bullet if lifetime exceeded
        if (bullet.lifetime > bullet.maxLifetime) {
            bulletPool.release(bullet);
            activeBullets.splice(i, 1);
            continue;
        }

        // Check collision with enemies (simple distance check)
        for (const enemy of enemies) {
            const dx = bullet.sprite.position.x - enemy.sprite.position.x;
            const dy = bullet.sprite.position.y - enemy.sprite.position.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < 900) { // ~30px radius
                // Hit! Flash enemy and release bullet
                sfxEnemyHit(); // 🔊 Low thud
                camera.shake(3, 0.12);
                sparkPS.emitter = new Vector3(bullet.sprite.position.x, bullet.sprite.position.y, 0);
                sparkPS.manualEmitCount = 6;
                // Hit flash + scale pop via Tween
                enemy.sprite.tint = new Color4(1, 1, 1, 1);
                enemy.sprite.scale = new Vector2(1.4, 1.4);
                tweenManager.add(Tween.Create(1.4, 1.0, 0.2, Easing.ElasticOut)
                    .onUpdate((v: number) => {
                        enemy.sprite.scale.x = v;
                        enemy.sprite.scale.y = v;
                    })
                    .onComplete(() => {
                        enemy.sprite.tint = enemy.context.playerDist < enemy.context.chaseRange
                            ? new Color4(1.0, 0.4, 0.1, 1)
                            : new Color4(0.9, 0.2, 0.2, 1);
                    }));
                bulletPool.release(bullet);
                activeBullets.splice(i, 1);
                break;
            }
        }
    }
}
