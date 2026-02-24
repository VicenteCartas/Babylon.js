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
import { Vector2 } from "core/Maths/math.vector";
import { Color4 } from "core/Maths/math.color";

/**
 * Side-scroller demo — "Hollow Knight lite"
 * Demonstrates: Sprite2D, Camera2D follow, Physics2D, InputMap2D, parallax,
 *               StateMachine2D (enemy AI), Text2D (HUD), NineSliceSprite2D (panels),
 *               LightingManager2D (GPU forward lighting — player glow + collectible lights),
 *               ObjectPool (bullet pooling for zero-GC shooting)
 *               **SpriteAtlasBuilder** (runtime atlas packing for batch rendering)
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

    // Instructions overlay
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:absolute;top:10px;left:10px;color:#fff;font-family:monospace;font-size:14px;z-index:10;pointer-events:none;background:rgba(0,0,0,0.5);padding:8px;border-radius:4px;";
    overlay.innerHTML = "← → Move &nbsp; Space Jump &nbsp; Shift Dash &nbsp; X Shoot &nbsp; <b>F3 Debug</b><br>Babylon.js 2D Side-Scroller Demo" +
        `<br><br><b>Features:</b> Scene2D, Sprite2D, Camera2D (follow + parallax), InputMap2D, PlanckPhysicsEngine,` +
        `<br>&nbsp;&nbsp;StateMachine2D (enemy AI), Text2D (HUD), NineSliceSprite2D (panel), LightingManager2D (GPU),` +
        `<br>&nbsp;&nbsp;<b>ObjectPool</b> (zero-GC bullet recycling), <b>SpriteAtlasBuilder</b> (runtime atlas packing),` +
        `<br>&nbsp;&nbsp;<b>DebugRenderer2D</b> (physics overlay)` +
        `<br><b>Sources:</b> Scene2D/scene2D.ts · Sprite2D/sprite2D.ts · Camera2D/camera2D.ts · Input/inputMap2D.ts` +
        `<br>&nbsp;&nbsp;Physics/planckPhysicsEngine.ts · StateMachine/stateMachine.ts · Lighting/light2D.ts` +
        `<br>&nbsp;&nbsp;<b>ObjectPool/objectPool.ts · SpriteAtlas/spriteAtlasBuilder.ts · Debug/debugRenderer2D.ts</b>`;
    mainDiv.appendChild(overlay);

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });

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
    lighting.ambientColor = new Color4(0.08, 0.06, 0.12, 1); // Very dark purple ambient
    const playerLight = lighting.createPointLight(0, 0, new Color4(1.0, 0.95, 0.7, 1), 260);
    playerLight.intensity = 1.8;
    playerLight.falloff = 1.2;
    scene.lightingManager = lighting;

    const input= new InputMap2D(engine, camera);
    input.defineAction("moveRight", { type: "key", key: "ArrowRight" }, { type: "key", key: "KeyD" });
    input.defineAction("moveLeft", { type: "key", key: "ArrowLeft" }, { type: "key", key: "KeyA" });
    input.defineAction("jump", { type: "key", key: "Space" }, { type: "key", key: "ArrowUp" }, { type: "key", key: "KeyW" });
    input.defineAction("dash", { type: "key", key: "ShiftLeft" }, { type: "key", key: "ShiftRight" });
    input.defineAction("shoot", { type: "key", key: "KeyX" }, { type: "key", key: "KeyZ" });

    // ═══ SpriteAtlasBuilder — Pack all game sprites into a single texture ═══
    console.time("⏱ SpriteAtlasBuilder: Total atlas build time");
    
    // Helper: Create a simple canvas texture with a solid color and optional glow
    function createSpriteTexture(width: number, height: number, color: Color4, glow = false): HTMLCanvasElement {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        
        // Fill with color
        ctx.fillStyle = `rgba(${color.r * 255}, ${color.g * 255}, ${color.b * 255}, ${color.a})`;
        ctx.fillRect(0, 0, width, height);
        
        // Add simple visual detail (border or glow)
        if (glow) {
            ctx.shadowBlur = 8;
            ctx.shadowColor = ctx.fillStyle;
            ctx.fillRect(width * 0.2, height * 0.2, width * 0.6, height * 0.6);
        } else {
            ctx.strokeStyle = `rgba(${color.r * 255 * 0.7}, ${color.g * 255 * 0.7}, ${color.b * 255 * 0.7}, ${color.a})`;
            ctx.lineWidth = 2;
            ctx.strokeRect(1, 1, width - 2, height - 2);
        }
        
        return canvas;
    }

    // Build atlas with all sprite types used in the game
    const atlasBuilder = new SpriteAtlasBuilder(engine, {
        maxWidth: 2048,
        maxHeight: 2048,
        padding: 2,
        powerOfTwo: true,
    });

    // Terrain tiles (multiple variants for visual variety)
    atlasBuilder.addImage("terrain_rock", createSpriteTexture(40, 40, new Color4(0.25, 0.2, 0.18, 1)));
    atlasBuilder.addImage("terrain_dirt", createSpriteTexture(40, 40, new Color4(0.3, 0.25, 0.2, 1)));
    atlasBuilder.addImage("terrain_stone", createSpriteTexture(40, 40, new Color4(0.2, 0.2, 0.22, 1)));
    
    // Characters
    atlasBuilder.addImage("player", createSpriteTexture(28, 44, new Color4(0.3, 0.9, 0.5, 1)));
    atlasBuilder.addImage("enemy", createSpriteTexture(30, 30, new Color4(0.9, 0.2, 0.2, 1)));
    
    // Items
    atlasBuilder.addImage("collectible", createSpriteTexture(16, 16, new Color4(1.0, 0.85, 0.3, 1), true));
    atlasBuilder.addImage("bullet", createSpriteTexture(12, 6, new Color4(0.2, 0.8, 1.0, 1)));
    
    // Parallax background elements
    atlasBuilder.addImage("bg_far", createSpriteTexture(64, 64, new Color4(0.05, 0.05, 0.15, 0.8)));
    atlasBuilder.addImage("bg_mid", createSpriteTexture(48, 48, new Color4(0.08, 0.08, 0.2, 0.8)));
    atlasBuilder.addImage("bg_near", createSpriteTexture(32, 32, new Color4(0.1, 0.1, 0.25, 0.8)));

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
    const terrainTextures = ["terrain_rock", "terrain_dirt", "terrain_stone"];
    for (let row = 0; row < LEVEL_HEIGHT; row++) {
        for (let col = 0; col < LEVEL_WIDTH; col++) {
            if (level[row][col] === 1) {
                const tile = new Sprite2D(`tile_${col}_${row}`);
                tile.parent = terrainParent;
                tile.width = TILE;
                tile.height = TILE;
                tile.position = new Vector2(col * TILE + TILE / 2, row * TILE + TILE / 2);
                
                // Use atlas texture and frame
                const textureKey = terrainTextures[(col + row * 3) % terrainTextures.length];
                tile.texture = gameAtlas.texture;
                tile.sourceRect = gameAtlas.getFrame(textureKey);
                tile.tint = getTileColor(row, level);
            }
        }
    }

    // Merged physics bodies — one per horizontal run of tiles (eliminates tile-seam ghost collisions)
    for (let row = 0; row < LEVEL_HEIGHT; row++) {
        let runStart = -1;
        for (let col = 0; col <= LEVEL_WIDTH; col++) {
            const isTile = col < LEVEL_WIDTH && level[row][col] === 1;
            if (isTile && runStart === -1) {
                runStart = col;
            } else if (!isTile && runStart !== -1) {
                const runLen = col - runStart;
                const bodyNode = new Node2D(`terrain_body_${row}_${runStart}`);
                bodyNode.parent = terrainParent;
                bodyNode.position = new Vector2(
                    runStart * TILE + (runLen * TILE) / 2,
                    row * TILE + TILE / 2
                );
                physics.addBody(bodyNode, {
                    bodyType: PhysicsBodyType2D.Static,
                    shape: { type: "box", width: runLen * TILE, height: TILE },
                });
                runStart = -1;
            }
        }
    }

    // ─── Parallax Backgrounds ────────────────────────────────────────
    const parallaxLayers = createParallaxLayers(scene, LEVEL_WIDTH * TILE, gameAtlas);

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
        friction: 0.2,
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
    camera.lerpSpeed = 0.08;
    camera.bounds = new Rectangle2D(0, 0, LEVEL_WIDTH * TILE, LEVEL_HEIGHT * TILE);

    // ─── HUD (Text2D + NineSliceSprite2D) ────────────────────────────
    const DESIGN_W = 480;
    const DESIGN_H = 270;

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

    // Helper: position HUD elements relative to camera in design coords
    function updateHUD() {
        const cx = camera.position.x;
        const cy = camera.position.y;
        const hw = DESIGN_W / 2;
        const hh = DESIGN_H / 2;

        // Compute scaled text size for panel fitting
        const tw = scoreText.width * TEXT_SCALE;
        const th = scoreText.height * TEXT_SCALE;
        const panelW = tw + 8;
        const panelH = th + 4;
        scorePanel.width = panelW;
        scorePanel.height = panelH;

        // Score panel + text: top-right, both share same center
        const hudX = cx + hw - panelW / 2 - 4;
        const hudY = cy - hh + panelH / 2 + 4;
        scorePanel.position.x = hudX;
        scorePanel.position.y = hudY;
        scoreText.position.x = hudX;
        scoreText.position.y = hudY;

        // Debug text: bottom-left
        const dtw = debugText.width * TEXT_SCALE;
        const dth = debugText.height * TEXT_SCALE;
        debugText.position.x = cx - hw + dtw / 2 + 4;
        debugText.position.y = cy + hh - dth / 2 - 4;

        // Debug mode indicator: top-left
        if (debugMode) {
            debugIndicator.text = "[F3] DEBUG";
            const diw = debugIndicator.width * TEXT_SCALE;
            const dih = debugIndicator.height * TEXT_SCALE;
            debugIndicator.position.x = cx - hw + diw / 2 + 4;
            debugIndicator.position.y = cy - hh + dih / 2 + 4;
        } else {
            debugIndicator.text = "";
        }
    }

    // ─── Player State ────────────────────────────────────────────────
    let onGround = false;
    let jumpBuffer = 0;
    let coyoteTime = 0;
    let dashCooldown = 0;
    let isDashing = false;
    let dashTimer = 0;
    let dashDir = 1;
    let facingRight = true;
    let score = 0;
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
        }

        // Dash
        dashCooldown = Math.max(0, dashCooldown - dt);
        if (input.isActionPressed("dash") && dashCooldown <= 0 && !isDashing) {
            isDashing = true;
            dashTimer = DASH_DURATION;
            dashCooldown = DASH_COOLDOWN;
            dashDir = facingRight ? 1 : -1;
        }

        if (isDashing) {
            dashTimer -= dt;
            if (dashTimer <= 0) {
                isDashing = false;
            } else {
                playerBody.setLinearVelocity(new Vector2(dashDir * DASH_SPEED, 0));
                player.tint = new Color4(0.8, 1.0, 0.8, 0.7); // Flash during dash
            }
        } else {
            // Re-read velocity so jump's Y component isn't overwritten by stale `vel`
            const currentVel = playerBody.getLinearVelocity();
            playerBody.setLinearVelocity(new Vector2(moveX * MOVE_SPEED, currentVel.y));
            player.tint = new Color4(0.3, 0.9, 0.5, 1);
        }

        // ── Enemy AI ──
        for (const enemy of enemies) {
            updateEnemy(enemy, player, dt);
        }

        // ── Bullet Updates ──
        updateBullets(bulletPool, activeBullets, enemies, dt);

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
                    c.sprite.alpha = 0;
                    score++;
                    if (c.light) { c.light.enabled = false; }
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

        // ── Parallax Scrolling ──
        // Offset each parallax layer based on camera position and its scroll factor.
        // A factor of 0 = fully static (infinite distance), 1 = moves with camera (foreground).
        const camX = camera.position.x;
        const camY = camera.position.y;
        for (const layer of parallaxLayers) {
            layer.parent.position.x = -camX * (1 - layer.factor);
            layer.parent.position.y = -camY * (1 - layer.factor) * 0.5;
        }

        // ── Scene + Camera Update ──
        scene.update(dt);
        camera.update(dt);

        // ── HUD Update (Text2D + NineSliceSprite2D) ──
        scoreText.text = `Score: ${score} / ${collectibles.length}`;
        debugText.text = `FPS: ${engine.getFps().toFixed(0)} | Pos: ${player.position.x.toFixed(0)},${player.position.y.toFixed(0)} | Ground: ${onGround} | Pool: ${bulletPool.activeCount}/${bulletPool.totalCreated}`;
        updateHUD();

        scene.render();

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
    const layerDefs = [
        { color: new Color4(0.05, 0.05, 0.15, 1), factor: 0.1, count: 20, sizeMin: 60, sizeMax: 200, yRange: [0, 0.5], atlasKey: "bg_far" },
        { color: new Color4(0.08, 0.08, 0.2, 1), factor: 0.3, count: 15, sizeMin: 40, sizeMax: 120, yRange: [0.1, 0.7], atlasKey: "bg_mid" },
        { color: new Color4(0.1, 0.1, 0.25, 1), factor: 0.5, count: 12, sizeMin: 30, sizeMax: 80, yRange: [0.2, 0.8], atlasKey: "bg_near" },
    ];

    for (const def of layerDefs) {
        const parent = new Node2D(`bg_layer_${def.factor}`);
        scene.addNode(parent);
        parent.zIndex = -100 + def.factor * 10;
        const sprites: Sprite2D[] = [];

        for (let i = 0; i < def.count; i++) {
            const s = new Sprite2D(`bg_${def.factor}_${i}`);
            s.parent = parent;
            const size = def.sizeMin + Math.random() * (def.sizeMax - def.sizeMin);
            s.width = size * (0.8 + Math.random() * 0.4);
            s.height = size;
            s.position.x = Math.random() * levelWidth;
            s.position.y = def.yRange[0] * 800 + Math.random() * (def.yRange[1] - def.yRange[0]) * 800;
            s.texture = atlas.texture;
            s.sourceRect = atlas.getFrame(def.atlasKey);
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
            friction: 0.5,
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
                    this.sprite.position.x = x;
                    this.sprite.position.y = y;
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
            bullet.sprite.position.x = -9999; // Move offscreen
            bullet.sprite.position.y = -9999;
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
    dt: number
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
            if (distSq < 400) { // ~20px radius
                // Hit! Flash enemy and release bullet
                enemy.sprite.tint = new Color4(1, 1, 1, 1);
                setTimeout(() => {
                    if (enemy.sprite.tint.r === 1 && enemy.sprite.tint.g === 1) {
                        enemy.sprite.tint = enemy.context.playerDist < enemy.context.chaseRange
                            ? new Color4(1.0, 0.4, 0.1, 1) // Chase color
                            : new Color4(0.9, 0.2, 0.2, 1); // Patrol color
                    }
                }, 100);
                bulletPool.release(bullet);
                activeBullets.splice(i, 1);
                break;
            }
        }
    }
}
