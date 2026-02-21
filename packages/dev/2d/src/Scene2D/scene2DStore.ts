import type { Scene2D } from "./scene2D";

/**
 * Static store for Scene2D instances.
 * Avoids circular dependency between Node2D and Scene2D
 * (same pattern as core's EngineStore).
 */
export class Scene2DStore {
    /** @internal */
    public static _LastCreatedScene: Scene2D | null = null;

    /**
     * Gets the last created Scene2D instance
     */
    public static get LastCreatedScene(): Scene2D | null {
        return this._LastCreatedScene;
    }
}
