# Babylon.js 2D Game Engine

A full-featured 2D game engine package for [Babylon.js](https://www.babylonjs.com).

## Features

- **Scene2D / Node2D** — Independent 2D scene graph with Y-down coordinate system
- **Sprite2D / AnimatedSprite2D** — Textured quads with sprite sheet animation
- **Camera2D** — Follow, zoom, bounds clamping, screen shake
- **Tilemap2D** — Tiled .tmj map loading with collision layers
- **Physics2D** — Plugin architecture with Planck.js (Box2D) backend
- **Collision2D** — Box, circle, polygon shapes with spatial grid
- **InputMap2D** — Action-based input mapping for keyboard, mouse, touch, gamepad
- **Pathfinding** — A* on square and hex grids with weighted costs
- **Grid System** — Square and hex grid utilities, coordinate conversion, range/LOS queries
- **Isometric** — Diamond and staggered isometric coordinate systems
- **Lighting** — Point, spot, and ambient 2D lights
- **Particles** — Lightweight CPU particle emitter with pooling
- **State Machine** — Generic FSM for AI and animation

## Installation

```bash
npm install @babylonjs/2d @babylonjs/core
```

## Quick Start

```typescript
import { Engine } from "@babylonjs/core";
import { Scene2D, Sprite2D, Camera2D } from "@babylonjs/2d";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const engine = new Engine(canvas);
const scene = new Scene2D(engine);

const camera = new Camera2D();
camera.setViewport(engine.getRenderWidth(), engine.getRenderHeight());
scene.camera = camera;

const sprite = new Sprite2D("player");
sprite.width = 32;
sprite.height = 32;
sprite.position.x = 100;
sprite.position.y = 100;
scene.addNode(sprite);

engine.runRenderLoop(() => {
    scene.update(1 / 60);
    camera.update(1 / 60);
    scene.render();
});
```

## Documentation

Full documentation at [doc.babylonjs.com](https://doc.babylonjs.com/features/featuresDeepDive/2d).
