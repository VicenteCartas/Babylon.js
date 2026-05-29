import { type ThinSprite } from "core/Sprites/thinSprite";
import { type Nullable } from "core/types";

import { type ScalarProperty, type Vector2Property } from "../parsing/parsedTypes";

import { Node } from "./node";

/**
 * Temporary scale vector used during sprite updates for matrix decomposition.
 */
const TempScale = { x: 1, y: 1 };

/**
 * Represents a sprite in the scene graph.
 *
 * The node holds only renderer-agnostic transform state. The concrete sprite is supplied later
 * by a renderer adapter through {@link attachSprite}, so parsing and feature modules can build
 * the scene graph without depending on any specific rendering backend.
 */
export class SpriteNode extends Node {
    private _sprite: Nullable<ThinSprite> = null;
    private readonly _originalWidth: number;
    private readonly _originalHeight: number;

    private _firstTime = true;

    /**
     * Creates a new SpriteNode instance.
     * @param id Unique identifier for the sprite node.
     * @param originalWidth The unscaled sprite width in pixels.
     * @param originalHeight The unscaled sprite height in pixels.
     * @param position The position of the sprite in the scene.
     * @param rotation The rotation of the sprite in degrees.
     * @param scale The scale of the sprite in the scene.
     * @param opacity The opacity of the sprite.
     * @param parent The parent node in the scene graph.
     */
    public constructor(
        id: string,
        originalWidth: number,
        originalHeight: number,
        position?: Vector2Property,
        rotation?: ScalarProperty,
        scale?: Vector2Property,
        opacity?: ScalarProperty,
        parent?: Node
    ) {
        super(id, position, rotation, scale, opacity, parent);

        this._originalWidth = originalWidth;
        this._originalHeight = originalHeight;

        this._isShape = true;
    }

    /**
     * Attaches the concrete sprite driven by this node.
     * Called by the renderer adapter after parsing, once the rendering backend's sprite exists.
     * @param sprite The sprite to drive from this node's transform.
     */
    public attachSprite(sprite: ThinSprite): void {
        this._sprite = sprite;
        this._firstTime = true;
    }

    /**
     * Updates the node's properties based on the current frame of the animation.
     * @param frame Frame number we are playing in the animation.
     * @param isParentUpdated Whether the parent node has been updated.
     * @param isReset Whether the node is being reset.
     * @returns True if the node was updated, false otherwise.
     */
    public override update(frame: number, isParentUpdated = false, isReset = false): boolean {
        const isDirty = super.update(frame, isParentUpdated, isReset) || this._firstTime;

        const sprite = this._sprite;
        if (sprite === null) {
            return isDirty;
        }

        this._firstTime = false;

        if (isDirty) {
            const rotation = this.worldMatrix.decompose(TempScale, sprite.position);

            // Apply scaling to the original sprite dimensions
            sprite.width = this._originalWidth * TempScale.x;
            sprite.height = this._originalHeight * TempScale.y;

            // Rotation
            sprite.angle = rotation;
        }

        // Opacity
        sprite.color.a = this.opacity;

        return isDirty;
    }
}
