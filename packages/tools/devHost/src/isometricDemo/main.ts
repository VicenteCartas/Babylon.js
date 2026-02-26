import { Engine } from "core/Engines/engine";

import { Scene2D } from "2d/Scene2D/scene2D";
import { Sprite2D } from "2d/Sprite2D/sprite2D";
import { Camera2D, ScaleMode } from "2d/Camera2D/camera2D";
import { InputMap2D } from "2d/Input/inputMap2D";
import { IsometricGrid, IsometricOrientation } from "2d/Isometric/isometricGrid";
import { AStarPathfinder } from "2d/Pathfinding/aStarPathfinder";
import { Tilemap2D } from "2d/Tilemap/tilemap2D";
import { Tween, TweenManager } from "2d/Tween/tween";
import { Easing } from "2d/Tween/easing";
import { Text2D } from "2d/Text2D/text2D";
import { DebugRenderer2D } from "2d/Debug/debugRenderer2D";
import { RenderTexture2D } from "2d/RenderTexture/renderTexture2D";
import { Vector2 } from "core/Maths/math.vector";
import { Color4 } from "core/Maths/math.color";

const MAP_W = 20;
const MAP_H = 20;
const TILE_W = 64;
const TILE_H = 32;

// GID mapping: 1=water, 2=water-alt, 3=grass, 4=tree
const TILE_COLORS: Record<number, Color4> = {
    1: new Color4(0.2, 0.4, 0.7, 1),     // Water (dark)
    2: new Color4(0.25, 0.45, 0.75, 1),   // Water (light — animation frame)
    3: new Color4(0.3, 0.6, 0.3, 1),      // Grass
    4: new Color4(0.1, 0.4, 0.15, 1),     // Tree
};
const TILE_NAMES: Record<number, string> = { 1: "Water", 2: "Water", 3: "Grass", 4: "Tree" };

/**
 * Isometric demo — "Micro City"
 * Demonstrates: IsometricGrid, AStarPathfinder, Camera2D, InputMap2D, Sprite2D,
 *               Tilemap2D (animated tiles), Tween (smooth movement), Text2D (HUD)
 */
export async function Main(_searchParams: URLSearchParams): Promise<void> {
    const mainDiv = document.getElementById("main-div") as HTMLDivElement;
    mainDiv.style.cssText = "width:100%;height:100%;margin:0;padding:0;overflow:hidden;background:#2a3a2a;";
    document.body.style.cssText = "margin:0;padding:0;overflow:hidden;";

    const canvas = document.createElement("canvas");
    canvas.id = "game-canvas";
    canvas.style.cssText = "width:100%;height:100%;display:block;background:#2a3a2a;";
    mainDiv.appendChild(canvas);

    const overlay = document.createElement("div");
    overlay.style.cssText = "position:absolute;top:10px;left:10px;color:#fff;font-family:monospace;font-size:13px;z-index:10;pointer-events:none;background:rgba(0,0,0,0.5);padding:8px;border-radius:4px;";
    overlay.innerHTML = "WASD/Arrows Pan &nbsp; Click to move unit &nbsp; <b>F3 Debug</b><br>Babylon.js 2D Isometric Demo" +
        `<br><br><b>Features:</b> IsometricGrid, AStarPathfinder, Camera2D (pan + design resolution), InputMap2D, Sprite2D,` +
        `<br>&nbsp;&nbsp;Tilemap2D (animated water tiles), Tween (smooth path movement), Text2D (hover info),` +
        `<br>&nbsp;&nbsp;<b>DebugRenderer2D</b> (pathfinding grid overlay), <b>RenderTexture2D</b> (minimap)` +
        `<br><b>Sources:</b> Isometric/isometricGrid.ts · Pathfinding/aStarPathfinder.ts · Tilemap/tilemap2D.ts` +
        `<br>&nbsp;&nbsp;Tween/tween.ts · Text2D/text2D.ts · Camera2D/camera2D.ts · Input/inputMap2D.ts · <b>Debug/debugRenderer2D.ts</b>` +
        `<br>&nbsp;&nbsp;<b>RenderTexture/renderTexture2D.ts</b>`;
    mainDiv.appendChild(overlay);

    const engine = new Engine(canvas, true);
    engine.resize();
    const scene = new Scene2D(engine);
    scene.backgroundColor = new Color4(0.16, 0.23, 0.16, 1); // Dark green
    const isoGrid = new IsometricGrid(MAP_W, MAP_H, TILE_W, TILE_H, IsometricOrientation.Diamond);

    // Camera
    const camera = new Camera2D();
    camera.setViewport(engine.getRenderWidth(), engine.getRenderHeight());
    camera.setDesignResolution(640, 360, ScaleMode.FIT);
    camera.position = new Vector2(0, MAP_H * TILE_H / 2);
    scene.camera = camera;

    // Input
    const input = new InputMap2D(engine, camera);
    input.defineAction("panUp", { type: "key", key: "ArrowUp" }, { type: "key", key: "KeyW" });
    input.defineAction("panDown", { type: "key", key: "ArrowDown" }, { type: "key", key: "KeyS" });
    input.defineAction("panLeft", { type: "key", key: "ArrowLeft" }, { type: "key", key: "KeyA" });
    input.defineAction("panRight", { type: "key", key: "ArrowRight" }, { type: "key", key: "KeyD" });
    input.defineAction("click", { type: "mouseButton", button: 0 });

    // Terrain — procedural, stored in Tilemap2D for animated tile support
    const terrainGids: number[] = [];
    for (let r = 0; r < MAP_H; r++) {
        for (let c = 0; c < MAP_W; c++) {
            const noise = Math.sin(c * 0.5) * Math.cos(r * 0.3) + Math.random() * 0.3;
            const gid = noise > 0.5 ? 4 : noise > -0.2 ? 3 : 1; // 1=water, 3=grass, 4=tree
            terrainGids.push(gid);
        }
    }
    terrainGids[0] = 3; // Ensure start is walkable

    // Build a Tilemap2D so we can use animated tiles
    const mockTexture = { getSize: () => ({ width: 64, height: 64 }) } as any;
    const tiledData = {
        width: MAP_W, height: MAP_H, tilewidth: TILE_W, tileheight: TILE_H,
        tilesets: [{
            firstgid: 1, image: "tiles.png", columns: 4, tilecount: 4,
            imagewidth: 256, imageheight: 64,
            tiles: [{
                id: 0, // Water (GID 1) — animate between water-dark and water-light
                animation: [
                    { tileid: 0, duration: 800 },
                    { tileid: 1, duration: 800 },
                ],
            }],
        }],
        layers: [{ type: "tilelayer", name: "ground", data: terrainGids, width: MAP_W, height: MAP_H }],
    };
    const tilemap = Tilemap2D.FromTiled(tiledData, new Map([["tiles.png", mockTexture]]));

    // Helper to get terrain type from GID
    function getBaseGid(col: number, row: number): number {
        return terrainGids[row * MAP_W + col];
    }

    // Isometric diamond skew: transforms rectangular sprites into diamond shapes.
    // skewX/skewY create the shear, different scaleX/scaleY preserve the 2:1 aspect ratio.
    const ISO_SKEW_X = Math.atan2(TILE_W, TILE_H); // atan(2) ≈ 1.1071
    const ISO_SKEW_Y = Math.atan2(TILE_H, TILE_W); // atan(0.5) ≈ 0.4636
    const ISO_SCALE_X = 0.5 / Math.cos(ISO_SKEW_Y); // ≈ 0.559
    const ISO_SCALE_Y = 0.5 / Math.cos(ISO_SKEW_X); // ≈ 1.118

    // Create tile sprites
    const tileSprites: Sprite2D[][] = [];
    for (let r = 0; r < MAP_H; r++) {
        tileSprites[r] = [];
        for (let c = 0; c < MAP_W; c++) {
            const pos = isoGrid.tileToWorld(c, r);
            const s = new Sprite2D(`tile_${c}_${r}`);
            scene.addNode(s);
            s.width = TILE_W;
            s.height = TILE_H;
            s.position = pos;
            s.zIndex = isoGrid.getDepth(c, r);
            s.skewX = ISO_SKEW_X;
            s.skewY = ISO_SKEW_Y;
            s.scale = new Vector2(ISO_SCALE_X, ISO_SCALE_Y);

            const gid = getBaseGid(c, r);
            s.tint = TILE_COLORS[gid] ?? new Color4(1, 0, 1, 1);
            tileSprites[r][c] = s;
        }
    }

    // Pathfinder — only grass (GID 3) is walkable
    const pathfinder = new AStarPathfinder({
        width: MAP_W,
        height: MAP_H,
        isWalkable: (col, row) => getBaseGid(col, row) === 3,
    });

    // ─── DebugRenderer2D ─────────────────────────────────────────────
    const debugRenderer = new DebugRenderer2D(engine);
    debugRenderer.pathfinder = pathfinder;
    debugRenderer.pathfinderGrid = isoGrid;
    debugRenderer.enabled = false;
    let debugMode = false;

    // Toggle debug mode with F3
    window.addEventListener("keydown", (e) => {
        if (e.key === "F3") {
            e.preventDefault();
            debugMode = !debugMode;
            debugRenderer.enabled = debugMode;
            debugRenderer.showPathfindingGrid = debugMode;
        }
    });

    // Unit (sorting layer 1 — always renders above ground tiles)
    const unit = new Sprite2D("unit");
    scene.addNode(unit);
    unit.width = 24;
    unit.height = 36;
    unit.tint = new Color4(0.9, 0.7, 0.2, 1);
    unit.sortingLayer = 1;
    let unitCol = 0;
    let unitRow = 0;
    unit.position = isoGrid.tileToWorld(unitCol, unitRow);
    unit.zIndex = isoGrid.getDepth(unitCol, unitRow) + 0.5;

    // Tween-based movement
    const tweenMgr = new TweenManager();
    let isMoving = false;

    function startTweenPath(worldPath: Vector2[], finalCol: number, finalRow: number): void {
        isMoving = true;
        let cumulativeDelay = 0;

        for (let i = 1; i < worldPath.length; i++) {
            const from = worldPath[i - 1];
            const to = worldPath[i];
            const dist = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
            const dur = dist / 120; // 120 px/sec

            const seg = new Tween({ from: 0, to: 1 }, dur, Easing.SineInOut)
                .setDelay(cumulativeDelay)
                .onUpdate((t) => {
                    unit.position.x = from.x + (to.x - from.x) * t;
                    unit.position.y = from.y + (to.y - from.y) * t;
                    unit.zIndex = Math.max(from.y, to.y) * 2 / TILE_H + 0.5;
                });

            // Last segment: mark movement complete
            if (i === worldPath.length - 1) {
                seg.onComplete(() => {
                    unitCol = finalCol;
                    unitRow = finalRow;
                    isMoving = false;
                });
            }

            tweenMgr.add(seg.start());
            cumulativeDelay += dur;
        }
    }

    // Highlight sprite for selected tile (sorting layer 2 — above everything)
    const highlight = new Sprite2D("highlight");
    scene.addNode(highlight);
    highlight.width = TILE_W;
    highlight.height = TILE_H;
    highlight.tint = new Color4(1, 1, 0.5, 0.3);
    highlight.sortingLayer = 2;
    highlight.skewX = ISO_SKEW_X;
    highlight.skewY = ISO_SKEW_Y;
    highlight.scale = new Vector2(ISO_SCALE_X, ISO_SCALE_Y);

    // ─── Text2D HUD ──────────────────────────────────────────────────
    const DESIGN_W = 640;
    const DESIGN_H = 360;
    const TEXT_SCALE = 0.5;

    const hoverText = new Text2D("hoverText", "", {
        font: "12px monospace",
        color: "#ffffff",
        textAlign: "center",
        textBaseline: "middle",
    });
    hoverText.sortingLayer = 1000;
    hoverText.scale = new Vector2(TEXT_SCALE, TEXT_SCALE);
    scene.addNode(hoverText);

    // Debug mode indicator
    const debugIndicator = new Text2D("debugIndicator", "", {
        font: "bold 14px monospace",
        color: "#ff0000",
        textAlign: "left",
        textBaseline: "top",
    });
    debugIndicator.sortingLayer = 1001;
    debugIndicator.scale = new Vector2(TEXT_SCALE, TEXT_SCALE);
    scene.addNode(debugIndicator);

    // ─── RenderTexture2D — Minimap ──────────────────────────────────
    // Creates a zoomed-out view of the entire map rendered to an offscreen
    // texture, displayed as a small sprite in the bottom-right corner.
    // A second Camera2D is used with a wider view to capture the full map.
    const MINIMAP_SIZE = 100;
    const minimapRT = new RenderTexture2D("minimap", engine, MINIMAP_SIZE, MINIMAP_SIZE);

    // Minimap camera: zoomed out to show the entire map
    const minimapCamera = new Camera2D();
    minimapCamera.setViewport(MINIMAP_SIZE, MINIMAP_SIZE);
    // Center on the map and zoom out enough to see all tiles
    const mapCenterX = isoGrid.tileToWorld(MAP_W / 2, MAP_H / 2).x;
    const mapCenterY = isoGrid.tileToWorld(MAP_W / 2, MAP_H / 2).y;
    minimapCamera.position = new Vector2(mapCenterX, mapCenterY);
    minimapCamera.setDesignResolution(MAP_W * TILE_W, MAP_H * TILE_H, ScaleMode.FIT);

    // Semi-transparent border behind the minimap
    const minimapBorder = new Sprite2D("minimapBorder");
    scene.addNode(minimapBorder);
    minimapBorder.width = MINIMAP_SIZE + 4;
    minimapBorder.height = MINIMAP_SIZE + 4;
    minimapBorder.tint = new Color4(0.1, 0.15, 0.1, 0.7);
    minimapBorder.sortingLayer = 999;

    // Minimap sprite: displays the RT content
    const minimapSprite = new Sprite2D("minimapSprite");
    scene.addNode(minimapSprite);
    minimapSprite.width = MINIMAP_SIZE;
    minimapSprite.height = MINIMAP_SIZE;
    minimapSprite.texture = minimapRT.texture;
    minimapSprite.sortingLayer = 1000;
    let minimapFrameCounter = 0;

    // Game loop
    let lastTime = performance.now();

    engine.runRenderLoop(() => {
        const now = performance.now();
        const dt = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;

        input.update();

        // Camera pan
        const PAN_SPEED = 300;
        if (input.isActionDown("panUp")) { camera.position.y -= PAN_SPEED * dt; }
        if (input.isActionDown("panDown")) { camera.position.y += PAN_SPEED * dt; }
        if (input.isActionDown("panLeft")) { camera.position.x -= PAN_SPEED * dt; }
        if (input.isActionDown("panRight")) { camera.position.x += PAN_SPEED * dt; }

        // Mouse hover → highlight tile + HUD text
        const worldPos = input.pointerWorldPosition;
        const hoverTile = isoGrid.worldToTile(worldPos.x, worldPos.y);
        if (isoGrid.inBounds(hoverTile.col, hoverTile.row)) {
            highlight.position = isoGrid.tileToWorld(hoverTile.col, hoverTile.row);
            highlight.visible = true;
            const gid = getBaseGid(hoverTile.col, hoverTile.row);
            const tileName = TILE_NAMES[gid] ?? "Unknown";
            hoverText.text = `[${hoverTile.col},${hoverTile.row}] ${tileName}`;
        } else {
            highlight.visible = false;
            hoverText.text = "";
        }

        // Position hover text at bottom-center of screen
        const cx = camera.position.x;
        const cy = camera.position.y;
        hoverText.position.x = cx;
        hoverText.position.y = cy + DESIGN_H / 2 - 10;

        // Debug mode indicator: top-left
        if (debugMode) {
            debugIndicator.text = "[F3] DEBUG";
            debugIndicator.position.x = cx - DESIGN_W / 2 + 4;
            debugIndicator.position.y = cy - DESIGN_H / 2 + 4;
        } else {
            debugIndicator.text = "";
        }

        // Click → pathfind and move (using Tween)
        if (input.isActionPressed("click") && !isMoving) {
            if (isoGrid.inBounds(hoverTile.col, hoverTile.row) && getBaseGid(hoverTile.col, hoverTile.row) === 3) {
                const path = pathfinder.findPath(unitCol, unitRow, hoverTile.col, hoverTile.row);
                if (path.length > 1) {
                    const worldPath = path.map((p) => isoGrid.tileToWorld(p.col, p.row));
                    startTweenPath(worldPath, path[path.length - 1].col, path[path.length - 1].row);
                }
            }
        }

        // Update tweens
        tweenMgr.update(dt);

        // Update animated tiles (water shimmer)
        tilemap.update(dt);
        for (let r = 0; r < MAP_H; r++) {
            for (let c = 0; c < MAP_W; c++) {
                const baseGid = getBaseGid(c, r);
                if (baseGid === 1) { // Only water tiles animate
                    const displayGid = tilemap.getDisplayTileId(baseGid);
                    tileSprites[r][c].tint = TILE_COLORS[displayGid];
                }
            }
        }

        // Standing depth when not moving
        if (!isMoving) {
            unit.zIndex = (unit.position.y * 2 / TILE_H) + 0.5;
        }

        // ── RenderTexture2D: Minimap capture (every 6 frames for perf) ──
        // Position minimap in bottom-right corner, relative to camera
        const minimapX = cx + DESIGN_W / 2 - MINIMAP_SIZE / 2 - 6;
        const minimapY = cy + DESIGN_H / 2 - MINIMAP_SIZE / 2 - 6;
        minimapBorder.position.x = minimapX;
        minimapBorder.position.y = minimapY;
        minimapSprite.position.x = minimapX;
        minimapSprite.position.y = minimapY;

        minimapFrameCounter++;
        if (minimapFrameCounter % 6 === 0) {
            // Hide HUD elements so they don't appear in the minimap
            minimapSprite.visible = false;
            minimapBorder.visible = false;
            hoverText.visible = false;
            debugIndicator.visible = false;
            highlight.visible = false;
            // Swap to minimap camera, render to RT, then restore
            scene.camera = minimapCamera;
            minimapRT.renderScene(scene, true);
            scene.camera = camera;
            // Restore visibility
            minimapSprite.visible = true;
            minimapBorder.visible = true;
            hoverText.visible = true;
            debugIndicator.visible = true;
            highlight.visible = true;
        }

        scene.update(dt);
        camera.update(dt);
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
