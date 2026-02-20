import { Engine } from "core/Engines/engine";
import { Constants } from "core/Engines/constants";
import { DynamicTexture } from "core/Materials/Textures/dynamicTexture";

import { Scene2D } from "2d/Scene2D/scene2D";
import { Sprite2D } from "2d/Sprite2D/sprite2D";
import { Camera2D, ScaleMode } from "2d/Camera2D/camera2D";
import { InputMap2D } from "2d/Input/inputMap2D";
import { Grid2D, GridTopology } from "2d/Grid/grid2D";
import { AStarPathfinder } from "2d/Pathfinding/aStarPathfinder";
import { Tween, TweenManager } from "2d/Tween/tween";
import { Easing } from "2d/Tween/easing";
import { Text2D } from "2d/Text2D/text2D";
import { NineSliceSprite2D } from "2d/NineSlice/nineSliceSprite2D";
import { StateMachine2D } from "2d/StateMachine/stateMachine";
import { Vector2 } from "core/Maths/math.vector";
import { Color4 } from "core/Maths/math.color";

const GRID_W = 10;
const GRID_H = 8;
const CELL = 64;

interface IUnit {
    sprite: Sprite2D;
    col: number;
    row: number;
    team: number; // 0=player, 1=enemy
    hp: number;
    maxHp: number;
    movePoints: number;
    attackRange: number;
    damage: number;
    hasMoved: boolean;
    hasAttacked: boolean;
}

/**
 * Turn-based tactics demo — "Tactics Grid"
 * Demonstrates: Grid2D, AStarPathfinder, Tween/Easing, InputMap2D, Camera2D,
 *               NineSliceSprite2D (UI panels), Text2D (HUD), StateMachine2D (enemy AI)
 */
export async function Main(_searchParams: URLSearchParams): Promise<void> {
    const mainDiv = document.getElementById("main-div") as HTMLDivElement;
    mainDiv.style.cssText = "width:100%;height:100%;margin:0;padding:0;overflow:hidden;background:#1a1a2e;";
    document.body.style.cssText = "margin:0;padding:0;overflow:hidden;";

    const canvas = document.createElement("canvas");
    canvas.id = "game-canvas";
    canvas.style.cssText = "width:100%;height:100%;display:block;background:#1a1a2e;";
    mainDiv.appendChild(canvas);

    const overlay = document.createElement("div");
    overlay.style.cssText = "position:absolute;top:10px;left:10px;color:#fff;font-family:monospace;font-size:13px;z-index:10;pointer-events:none;background:rgba(0,0,0,0.5);padding:8px;border-radius:4px;";
    mainDiv.appendChild(overlay);

    const engine = new Engine(canvas, true);
    engine.resize();
    const scene = new Scene2D(engine);
    scene.backgroundColor = new Color4(0.1, 0.1, 0.18, 1); // Dark navy

    const grid = new Grid2D(GRID_W, GRID_H, CELL, GridTopology.Square);
    const camera = new Camera2D();
    camera.setViewport(engine.getRenderWidth(), engine.getRenderHeight());
    camera.setDesignResolution(GRID_W * CELL + 40, GRID_H * CELL + 40, ScaleMode.FIT);
    camera.position = new Vector2((GRID_W * CELL) / 2, (GRID_H * CELL) / 2);
    scene.camera = camera;

    const input = new InputMap2D(engine, camera);
    input.defineAction("click", { type: "mouseButton", button: 0 });
    input.defineAction("endTurn", { type: "key", key: "KeyE" }, { type: "key", key: "Enter" });

    // Terrain: 0=grass, 1=wall
    const terrain: number[][] = [];
    for (let r = 0; r < GRID_H; r++) {
        terrain[r] = new Array(GRID_W).fill(0);
    }
    // Add some walls
    const walls = [[3, 2], [3, 3], [3, 4], [6, 3], [6, 4], [6, 5]];
    for (const [c, r] of walls) {
        if (r < GRID_H && c < GRID_W) { terrain[r][c] = 1; }
    }

    // Render grid tiles
    for (let r = 0; r < GRID_H; r++) {
        for (let c = 0; c < GRID_W; c++) {
            const pos = grid.cellToWorld(c, r);
            const tile = new Sprite2D(`tile_${c}_${r}`);
            scene.addNode(tile);
            tile.width = CELL - 2;
            tile.height = CELL - 2;
            tile.position = pos;
            tile.zIndex = 0;
            tile.tint = terrain[r][c] === 1
                ? new Color4(0.3, 0.25, 0.2, 1)
                : new Color4(0.2, 0.35, 0.2, 1);
        }
    }

    // Units
    const units: IUnit[] = [];
    const unitDefs = [
        { col: 1, row: 1, team: 0, hp: 10, move: 3, atk: 1, dmg: 3, color: new Color4(0.3, 0.6, 1, 1) },
        { col: 1, row: 5, team: 0, hp: 8, move: 4, atk: 1, dmg: 2, color: new Color4(0.4, 0.7, 1, 1) },
        { col: 0, row: 3, team: 0, hp: 12, move: 2, atk: 1, dmg: 4, color: new Color4(0.2, 0.5, 0.9, 1) },
        { col: 8, row: 1, team: 1, hp: 8, move: 3, atk: 1, dmg: 3, color: new Color4(1, 0.3, 0.3, 1) },
        { col: 8, row: 5, team: 1, hp: 10, move: 2, atk: 1, dmg: 2, color: new Color4(0.9, 0.2, 0.2, 1) },
        { col: 9, row: 3, team: 1, hp: 6, move: 4, atk: 2, dmg: 2, color: new Color4(1, 0.4, 0.2, 1) },
    ];

    for (const def of unitDefs) {
        const s = new Sprite2D(`unit_${def.col}_${def.row}`);
        scene.addNode(s);
        s.width = CELL * 0.6;
        s.height = CELL * 0.6;
        s.position = grid.cellToWorld(def.col, def.row);
        s.tint = def.color;
        s.zIndex = 10;

        units.push({
            sprite: s,
            col: def.col,
            row: def.row,
            team: def.team,
            hp: def.hp,
            maxHp: def.hp,
            movePoints: def.move,
            attackRange: def.atk,
            damage: def.dmg,
            hasMoved: false,
            hasAttacked: false,
        });
    }

    // Highlight sprites for movement/attack range
    const highlights: Sprite2D[] = [];
    function clearHighlights(): void {
        for (const h of highlights) { h.visible = false; }
    }
    function showHighlight(col: number, row: number, color: Color4): void {
        let h = highlights.find((s) => !s.visible);
        if (!h) {
            h = new Sprite2D(`hl_${highlights.length}`);
            scene.addNode(h);
            h.width = CELL - 4;
            h.height = CELL - 4;
            h.zIndex = 5;
            highlights.push(h);
        }
        h.position = grid.cellToWorld(col, row);
        h.tint = color;
        h.visible = true;
    }

    // ─── NineSliceSprite2D + Text2D HUD ──────────────────────────────
    const DESIGN_W = GRID_W * CELL + 40;
    const DESIGN_H = GRID_H * CELL + 40;
    const TEXT_SCALE = 0.5;

    // Create a 9-slice panel texture (16×16, 3px border)
    const panelCanvas = document.createElement("canvas");
    panelCanvas.width = 16;
    panelCanvas.height = 16;
    const pCtx = panelCanvas.getContext("2d")!;
    pCtx.fillStyle = "rgba(20, 20, 50, 0.85)";
    pCtx.fillRect(0, 0, 16, 16);
    pCtx.strokeStyle = "#6688cc";
    pCtx.lineWidth = 2;
    pCtx.strokeRect(1, 1, 14, 14);

    const panelTex = new DynamicTexture("panelTex", panelCanvas, null, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE);
    panelTex._texture = engine.createDynamicTexture(16, 16, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE);
    (engine as any).updateDynamicTexture(panelTex._texture, panelCanvas, false);

    // Status panel (bottom center)
    const statusPanel = new NineSliceSprite2D("statusPanel", panelTex);
    statusPanel.setUniformBorders(3);
    statusPanel.sortingLayer = 100;
    statusPanel.zIndex = 0;
    scene.addNode(statusPanel);

    const statusText = new Text2D("statusText", engine, "", {
        font: "11px monospace",
        color: "#88ff88",
        textAlign: "center",
        textBaseline: "middle",
    });
    statusText.sortingLayer = 100;
    statusText.zIndex = 1;
    statusText.scale = new Vector2(TEXT_SCALE, TEXT_SCALE);
    scene.addNode(statusText);

    // Turn info panel (top center)
    const turnPanel = new NineSliceSprite2D("turnPanel", panelTex);
    turnPanel.setUniformBorders(3);
    turnPanel.sortingLayer = 100;
    turnPanel.zIndex = 0;
    scene.addNode(turnPanel);

    const turnText = new Text2D("turnText", engine, "", {
        font: "12px monospace",
        color: "#ffffff",
        textAlign: "center",
        textBaseline: "middle",
    });
    turnText.sortingLayer = 100;
    turnText.zIndex = 1;
    turnText.scale = new Vector2(TEXT_SCALE, TEXT_SCALE);
    scene.addNode(turnText);

    function updateHUD(): void {
        const cx = camera.position.x;
        const cy = camera.position.y;

        // Turn info at top
        const teamName = currentTeam === 0 ? "PLAYER TURN" : "ENEMY TURN";
        turnText.text = `Turn ${turnNumber} - ${teamName}`;
        turnText.position.x = cx;
        turnText.position.y = cy - DESIGN_H / 2 + 16;
        turnPanel.position.x = cx;
        turnPanel.position.y = cy - DESIGN_H / 2 + 16;
        turnPanel.width = (turnText.width * TEXT_SCALE) + 16;
        turnPanel.height = (turnText.height * TEXT_SCALE) + 8;

        // Status bar at bottom
        const alive = units.filter((u) => u.hp > 0);
        const playerAlive = alive.filter((u) => u.team === 0).length;
        const enemyAlive = alive.filter((u) => u.team === 1).length;
        let status = `Blue: ${playerAlive}  Red: ${enemyAlive}`;
        if (selectedUnit) {
            status += `  |  HP ${selectedUnit.hp}/${selectedUnit.maxHp}  ATK ${selectedUnit.damage}  MOV ${selectedUnit.movePoints}`;
        }
        if (playerAlive === 0) { status = "DEFEAT - All player units destroyed!"; }
        if (enemyAlive === 0) { status = "VICTORY - All enemies defeated!"; }
        statusText.text = status;
        statusText.position.x = cx;
        statusText.position.y = cy + DESIGN_H / 2 - 16;
        statusPanel.position.x = cx;
        statusPanel.position.y = cy + DESIGN_H / 2 - 16;
        statusPanel.width = (statusText.width * TEXT_SCALE) + 16;
        statusPanel.height = (statusText.height * TEXT_SCALE) + 8;
    }

    // ─── StateMachine2D — enemy AI ───────────────────────────────────
    interface IEnemyAIContext {
        enemy: IUnit;
        closestPlayer: IUnit | null;
        distToClosest: number;
        targetCol: number;
        targetRow: number;
        attackTarget: IUnit | null;
    }

    function createEnemyFSM(enemy: IUnit): StateMachine2D<IEnemyAIContext> {
        const ctx: IEnemyAIContext = {
            enemy, closestPlayer: null, distToClosest: Infinity,
            targetCol: enemy.col, targetRow: enemy.row, attackTarget: null,
        };
        const fsm = new StateMachine2D(ctx);

        fsm.addState({
            name: "idle",
            onEnter: () => {
                // Find closest player
                const players = units.filter((u) => u.team === 0 && u.hp > 0);
                if (players.length > 0) {
                    let best = players[0];
                    let bestD = grid.distance(enemy.col, enemy.row, best.col, best.row);
                    for (const p of players) {
                        const d = grid.distance(enemy.col, enemy.row, p.col, p.row);
                        if (d < bestD) { best = p; bestD = d; }
                    }
                    ctx.closestPlayer = best;
                    ctx.distToClosest = bestD;
                } else {
                    ctx.closestPlayer = null;
                    ctx.distToClosest = Infinity;
                }
                ctx.targetCol = enemy.col;
                ctx.targetRow = enemy.row;
                ctx.attackTarget = null;
            },
        });

        fsm.addState({
            name: "approach",
            onEnter: () => {
                if (!ctx.closestPlayer) { return; }
                const pf = buildPathfinder();
                const reach = pf.getReachableCells(enemy.col, enemy.row, enemy.movePoints);
                let bestCell = { col: enemy.col, row: enemy.row, cost: 0 };
                let bestDist = ctx.distToClosest;

                for (const cell of reach) {
                    const d = grid.distance(cell.col, cell.row, ctx.closestPlayer.col, ctx.closestPlayer.row);
                    if (d < bestDist) { bestDist = d; bestCell = cell; }
                }

                // Store decision — don't move sprite yet
                ctx.targetCol = bestCell.col;
                ctx.targetRow = bestCell.row;
                ctx.distToClosest = bestDist;
            },
        });

        fsm.addState({
            name: "attack",
            onEnter: () => {
                if (!ctx.closestPlayer || ctx.closestPlayer.hp <= 0) { return; }
                if (ctx.distToClosest <= enemy.attackRange) {
                    ctx.attackTarget = ctx.closestPlayer;
                }
            },
        });

        fsm.addState({
            name: "retreat",
            onEnter: () => {
                if (!ctx.closestPlayer) { return; }
                const pf = buildPathfinder();
                const reach = pf.getReachableCells(enemy.col, enemy.row, enemy.movePoints);
                let bestCell = { col: enemy.col, row: enemy.row, cost: 0 };
                let bestDist = ctx.distToClosest;

                for (const cell of reach) {
                    const d = grid.distance(cell.col, cell.row, ctx.closestPlayer.col, ctx.closestPlayer.row);
                    if (d > bestDist) { bestDist = d; bestCell = cell; }
                }

                ctx.targetCol = bestCell.col;
                ctx.targetRow = bestCell.row;
            },
        });

        // Transitions
        // One-shot transitions: idle→decision→action, no cycling back
        fsm.addTransition({ name: "scan", from: "idle", to: "approach", condition: (c) => c.closestPlayer !== null && c.enemy.hp > c.enemy.maxHp * 0.3 });
        fsm.addTransition({ name: "low_hp", from: "idle", to: "retreat", condition: (c) => c.closestPlayer !== null && c.enemy.hp <= c.enemy.maxHp * 0.3 });
        fsm.addTransition({ name: "in_range", from: "approach", to: "attack", condition: (c) => c.distToClosest <= c.enemy.attackRange });

        return fsm;
    }

    // Game state
    let currentTeam = 0;
    let phase: "select" | "move" | "attack" = "select";
    let selectedUnit: IUnit | null = null;
    let reachableCells: Array<{ col: number; row: number; cost: number }> = [];
    let turnNumber = 1;
    let isAnimating = false;
    const tweens = new TweenManager();

    function getUnitAt(col: number, row: number): IUnit | undefined {
        return units.find((u) => u.col === col && u.row === row && u.hp > 0);
    }

    function buildPathfinder(): AStarPathfinder {
        return new AStarPathfinder({
            width: GRID_W,
            height: GRID_H,
            isWalkable: (col, row) => terrain[row]?.[col] === 0 && !getUnitAt(col, row),
        });
    }

    function endTurn(): void {
        currentTeam = currentTeam === 0 ? 1 : 0;
        phase = "select";
        selectedUnit = null;
        reachableCells = [];
        clearHighlights();
        for (const u of units) {
            if (u.team === currentTeam) {
                u.hasMoved = false;
                u.hasAttacked = false;
            }
        }
        turnNumber++;

        // StateMachine2D-driven AI for team 1 (animated)
        if (currentTeam === 1) {
            isAnimating = true;
            runEnemyAI(() => {
                // After all enemies finish, switch back to player
                currentTeam = 0;
                phase = "select";
                for (const u of units) {
                    if (u.team === 0) { u.hasMoved = false; u.hasAttacked = false; }
                }
                turnNumber++;
                isAnimating = false;
            });
        }
    }

    /** Animate enemy actions one at a time, then call onDone */
    function runEnemyAI(onDone: () => void): void {
        const enemies = units.filter((u) => u.team === 1 && u.hp > 0);

        // Collect decisions from FSM — update logical positions sequentially
        // so each enemy's pathfinder sees previous enemies' new positions
        interface IEnemyAction { enemy: IUnit; startCol: number; startRow: number; targetCol: number; targetRow: number; attackTarget: IUnit | null }
        const actions: IEnemyAction[] = [];
        for (const enemy of enemies) {
            const startCol = enemy.col;
            const startRow = enemy.row;
            const fsm = createEnemyFSM(enemy);
            fsm.start("idle");
            // 2 ticks: idle→approach/retreat, then approach→attack if in range
            fsm.update(0);
            fsm.update(0);
            const targetCol: number = (fsm as any)._context.targetCol;
            const targetRow: number = (fsm as any)._context.targetRow;
            const attackTarget: IUnit | null = (fsm as any)._context.attackTarget;

            // Commit logical position immediately so next enemy sees updated board
            enemy.col = targetCol;
            enemy.row = targetRow;

            actions.push({ enemy, startCol, startRow, targetCol, targetRow, attackTarget });
        }

        // Animate sequentially: move → attack → next enemy → ...
        let cumulativeDelay = 0;
        const MOVE_DUR = 0.3;
        const ATK_DUR = 0.3;

        for (const action of actions) {
            const { enemy, startCol, startRow, targetCol, targetRow, attackTarget } = action;
            const needsMove = targetCol !== startCol || targetRow !== startRow;

            if (needsMove) {
                const startPos = grid.cellToWorld(startCol, startRow);
                const endPos = grid.cellToWorld(targetCol, targetRow);
                const delay = cumulativeDelay;

                tweens.add(new Tween({ from: startPos.x, to: endPos.x }, MOVE_DUR, Easing.QuadInOut)
                    .setDelay(delay)
                    .onUpdate((v) => { enemy.sprite.position.x = v; })
                    .start());
                tweens.add(new Tween({ from: startPos.y, to: endPos.y }, MOVE_DUR, Easing.QuadInOut)
                    .setDelay(delay)
                    .onUpdate((v) => { enemy.sprite.position.y = v; })
                    .start());

                cumulativeDelay += MOVE_DUR + 0.05;
            }

            if (attackTarget && attackTarget.hp > 0) {
                const atkDelay = cumulativeDelay;
                const target = attackTarget;
                const origTint = target.sprite.tint.clone();
                let damageApplied = false;
                tweens.add(new Tween({ from: 1, to: 0 }, ATK_DUR, Easing.QuadOut)
                    .setDelay(atkDelay)
                    .onUpdate((t) => {
                        if (!damageApplied) {
                            damageApplied = true;
                            target.hp -= enemy.damage;
                            target.sprite.tint = new Color4(1, 1, 1, 1);
                        }
                        target.sprite.tint.r = origTint.r + (1 - origTint.r) * t;
                        target.sprite.tint.g = origTint.g + (1 - origTint.g) * t;
                        target.sprite.tint.b = origTint.b + (1 - origTint.b) * t;
                    })
                    .onComplete(() => {
                        if (target.hp <= 0) { target.sprite.visible = false; }
                    })
                    .start());
                cumulativeDelay += ATK_DUR + 0.05;
            }
        }

        // Fire completion after all animations
        if (cumulativeDelay > 0) {
            tweens.add(new Tween({ from: 0, to: 1 }, 0.01, Easing.Linear)
                .setDelay(cumulativeDelay)
                .onComplete(onDone)
                .start());
        } else {
            onDone();
        }
    }

    function updateOverlay(): void {
        const teamName = currentTeam === 0 ? "Player (Blue)" : "Enemy (Red)";
        overlay.innerHTML = `Turn ${turnNumber} — ${teamName} &nbsp; Click unit → move → attack &nbsp; Press E to end turn` +
            `<br><br><b>Features:</b> Grid2D (square), AStarPathfinder (reachable cells), Tween/Easing,` +
            `<br>&nbsp;&nbsp;NineSliceSprite2D (UI panels), Text2D (HUD), StateMachine2D (enemy AI), InputMap2D, Camera2D` +
            `<br><b>Sources:</b> Grid/grid2D.ts · Pathfinding/aStarPathfinder.ts · Tween/tween.ts · NineSlice/nineSliceSprite2D.ts` +
            `<br>&nbsp;&nbsp;Text2D/text2D.ts · StateMachine/stateMachine.ts · Input/inputMap2D.ts`;
    }

    // Game loop
    engine.runRenderLoop(() => {
        const dt = engine.getDeltaTime() / 1000;
        input.update();

        // End turn
        if (input.isActionPressed("endTurn") && currentTeam === 0) {
            endTurn();
        }

        // Click handling
        if (input.isActionPressed("click") && currentTeam === 0 && !isAnimating) {
            const worldPos = input.pointerWorldPosition;
            const cell = grid.worldToCell(worldPos.x, worldPos.y);

            if (grid.inBounds(cell.col, cell.row)) {
                if (phase === "select") {
                    const u = getUnitAt(cell.col, cell.row);
                    if (u && u.team === 0 && !u.hasMoved) {
                        selectedUnit = u;
                        phase = "move";
                        const pf = buildPathfinder();
                        reachableCells = pf.getReachableCells(u.col, u.row, u.movePoints);
                        clearHighlights();
                        for (const rc of reachableCells) {
                            showHighlight(rc.col, rc.row, new Color4(0.3, 0.5, 1, 0.3));
                        }
                        // Show attack range
                        const atkCells = grid.getCellsInRange(u.col, u.row, u.attackRange);
                        for (const ac of atkCells) {
                            const enemy = getUnitAt(ac.col, ac.row);
                            if (enemy && enemy.team !== 0) {
                                showHighlight(ac.col, ac.row, new Color4(1, 0.3, 0.3, 0.4));
                            }
                        }
                    }
                } else if (phase === "move" && selectedUnit && !isAnimating) {
                    // Allow attacking an enemy in range without moving first
                    const target = getUnitAt(cell.col, cell.row);
                    if (target && target.team !== 0) {
                        const dist = grid.distance(selectedUnit.col, selectedUnit.row, cell.col, cell.row);
                        if (dist <= selectedUnit.attackRange) {
                            target.hp -= selectedUnit.damage;
                            // Hit flash
                            const origTint = target.sprite.tint.clone();
                            target.sprite.tint = new Color4(1, 1, 1, 1);
                            tweens.add(new Tween({ from: 1, to: 0 }, 0.3, Easing.QuadOut)
                                .onUpdate((t) => {
                                    target.sprite.tint.r = origTint.r + (1 - origTint.r) * t;
                                    target.sprite.tint.g = origTint.g + (1 - origTint.g) * t;
                                    target.sprite.tint.b = origTint.b + (1 - origTint.b) * t;
                                })
                                .onComplete(() => {
                                    if (target.hp <= 0) { target.sprite.visible = false; }
                                })
                                .start());
                            selectedUnit.hasMoved = true;
                            selectedUnit.hasAttacked = true;
                            phase = "select";
                            selectedUnit = null;
                            clearHighlights();
                        }
                    }

                    const isReachable = reachableCells.some((c) => c.col === cell.col && c.row === cell.row);
                    if (isReachable && phase === "move") {
                        const movingUnit = selectedUnit;
                        const targetPos = grid.cellToWorld(cell.col, cell.row);
                        const startX = movingUnit.sprite.position.x;
                        const startY = movingUnit.sprite.position.y;
                        movingUnit.col = cell.col;
                        movingUnit.row = cell.row;
                        movingUnit.hasMoved = true;
                        isAnimating = true;
                        clearHighlights();

                        // Smooth movement tween
                        const twX = new Tween({ from: startX, to: targetPos.x }, 0.3, Easing.QuadInOut)
                            .onUpdate((v) => { movingUnit.sprite.position.x = v; });
                        const twY = new Tween({ from: startY, to: targetPos.y }, 0.3, Easing.QuadInOut)
                            .onUpdate((v) => { movingUnit.sprite.position.y = v; })
                            .onComplete(() => {
                                isAnimating = false;
                                phase = "attack";
                                // Show attack range from new position
                                const atkCells = grid.getCellsInRange(cell.col, cell.row, movingUnit.attackRange);
                                for (const ac of atkCells) {
                                    const enemy = getUnitAt(ac.col, ac.row);
                                    if (enemy && enemy.team !== 0) {
                                        showHighlight(ac.col, ac.row, new Color4(1, 0.3, 0.3, 0.5));
                                    }
                                }
                            });
                        tweens.add(twX.start());
                        tweens.add(twY.start());
                    }
                } else if (phase === "attack" && selectedUnit) {
                    const target = getUnitAt(cell.col, cell.row);
                    if (target && target.team !== 0) {
                        const dist = grid.distance(selectedUnit.col, selectedUnit.row, cell.col, cell.row);
                        if (dist <= selectedUnit.attackRange) {
                            target.hp -= selectedUnit.damage;
                            // Hit flash
                            const origTint = target.sprite.tint.clone();
                            target.sprite.tint = new Color4(1, 1, 1, 1);
                            tweens.add(new Tween({ from: 1, to: 0 }, 0.3, Easing.QuadOut)
                                .onUpdate((t) => {
                                    target.sprite.tint.r = origTint.r + (1 - origTint.r) * t;
                                    target.sprite.tint.g = origTint.g + (1 - origTint.g) * t;
                                    target.sprite.tint.b = origTint.b + (1 - origTint.b) * t;
                                })
                                .onComplete(() => {
                                    if (target.hp <= 0) { target.sprite.visible = false; }
                                })
                                .start());
                            selectedUnit.hasAttacked = true;
                        }
                    }
                    // Done with this unit
                    phase = "select";
                    selectedUnit = null;
                    clearHighlights();
                }
            }
        }

        updateOverlay();
        updateHUD();
        tweens.update(dt);
        scene.update(dt);
        camera.update(dt);
        scene.render();
    });

    window.addEventListener("resize", () => {
        engine.resize();
        camera.setViewport(engine.getRenderWidth(), engine.getRenderHeight());
    });
}
