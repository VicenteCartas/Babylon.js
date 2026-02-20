import { Engine } from "core/Engines/engine";
import { Scene2D } from "2d/Scene2D/scene2D";
import { Sprite2D } from "2d/Sprite2D/sprite2D";
import { Color4 } from "core/Maths/math.color";
import { Vector2 } from "core/Maths/math.vector";

/**
 * Minimal 2D rendering test — just renders colored rectangles on screen.
 * Use to diagnose rendering pipeline issues.
 */
export async function Main(_searchParams: URLSearchParams): Promise<void> {
    const mainDiv = document.getElementById("main-div") as HTMLDivElement;
    mainDiv.style.cssText = "width:100%;height:100%;margin:0;padding:0;overflow:hidden;";
    document.body.style.cssText = "margin:0;padding:0;overflow:hidden;";

    const canvas = document.createElement("canvas");
    canvas.id = "game-canvas";
    canvas.style.cssText = "width:100%;height:100%;display:block;background:#333;";
    mainDiv.appendChild(canvas);

    const debugDiv = document.createElement("div");
    debugDiv.style.cssText = "position:absolute;top:10px;left:10px;color:#0f0;font-family:monospace;font-size:14px;z-index:10;pointer-events:none;background:rgba(0,0,0,0.8);padding:12px;border-radius:4px;white-space:pre;";
    mainDiv.appendChild(debugDiv);

    const engine = new Engine(canvas, true);
    engine.resize();

    const W = engine.getRenderWidth();
    const H = engine.getRenderHeight();

    debugDiv.textContent = `Canvas client: ${canvas.clientWidth}x${canvas.clientHeight}
Canvas backing: ${canvas.width}x${canvas.height}
Engine render: ${W}x${H}
DPR: ${window.devicePixelRatio}`;

    const scene = new Scene2D(engine);
    scene.backgroundColor = new Color4(0.15, 0.15, 0.2, 1);

    // No camera — render in raw screen-pixel coordinates
    // Place sprites at known pixel positions to verify rendering

    // Red square: top-left quadrant, 200×200 at (100, 100)
    const red = new Sprite2D("red");
    red.width = 200;
    red.height = 200;
    red.position = new Vector2(100, 100);
    red.tint = new Color4(1, 0, 0, 1);
    scene.addNode(red);

    // Green square: center of screen
    const green = new Sprite2D("green");
    green.width = 200;
    green.height = 200;
    green.position = new Vector2(W / 2 - 100, H / 2 - 100);
    green.tint = new Color4(0, 1, 0, 1);
    scene.addNode(green);

    // Blue square: bottom-right quadrant
    const blue = new Sprite2D("blue");
    blue.width = 200;
    blue.height = 200;
    blue.position = new Vector2(W - 300, H - 300);
    blue.tint = new Color4(0, 0, 1, 1);
    scene.addNode(blue);

    // Yellow small square: exact center pixel
    const yellow = new Sprite2D("yellow");
    yellow.width = 50;
    yellow.height = 50;
    yellow.position = new Vector2(W / 2 - 25, H / 2 - 25);
    yellow.tint = new Color4(1, 1, 0, 1);
    yellow.zIndex = 1;
    scene.addNode(yellow);

    engine.runRenderLoop(() => {
        scene.render();
    });

    window.addEventListener("resize", () => {
        engine.resize();
    });
}
