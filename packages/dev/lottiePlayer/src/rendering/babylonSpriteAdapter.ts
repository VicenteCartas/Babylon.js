import { ThinSprite } from "core/Sprites/thinSprite";

import { type LottieSpriteRecord } from "../parsing/spriteRecord";
import { type SpritePacker } from "../parsing/spritePacker";
import { type RenderingManager } from "./renderingManager";

/**
 * Translates renderer-agnostic {@link LottieSpriteRecord}s produced by parsing into Babylon
 * `ThinSprite`s, attaches each sprite to its scene-graph node, registers it for rendering, and
 * finalizes the rendering manager. This adapter is the only place that knows about the Babylon
 * sprite API; replacing the rendering backend means replacing this module, not the parser or
 * feature modules.
 * @param records Sprite records emitted during parsing, in creation order.
 * @param packer Sprite atlas packer holding the finalized atlas page textures.
 * @param renderingManager Rendering manager that batches and draws the sprites.
 */
export function MaterializeSpriteRecords(records: readonly LottieSpriteRecord[], packer: SpritePacker, renderingManager: RenderingManager): void {
    for (let i = 0; i < records.length; i++) {
        const record = records[i];

        const sprite = new ThinSprite();
        sprite._xOffset = record.uOffset;
        sprite._yOffset = record.vOffset;
        sprite._xSize = record.uSize;
        sprite._ySize = record.vSize;
        sprite.width = record.width;
        sprite.height = record.height;
        sprite.invertV = record.invertV;

        record.node.attachSprite(sprite);
        renderingManager.addSprite(sprite, record.layerOrder, record.atlasIndex);
    }

    // Sprites are registered; finalize the renderer with the packed atlas textures.
    renderingManager.ready(packer.textures);
}
