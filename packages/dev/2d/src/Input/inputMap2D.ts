import type { AbstractEngine } from "core/Engines/abstractEngine";
import { DeviceSourceManager } from "core/DeviceInput/InputDevices/deviceSourceManager";
import { DeviceType, PointerInput } from "core/DeviceInput/InputDevices/deviceEnums";
import type { DeviceSource } from "core/DeviceInput/InputDevices/deviceSource";
import type { IPointerEvent } from "core/Events/deviceInputEvents";
import { Vector2 } from "core/Maths/math.vector";

import type { Camera2D } from "../Camera2D/camera2D";

/**
 * Types of input bindings supported by InputMap2D
 */
export type InputBinding =
    | { type: "key"; key: string }
    | { type: "mouseButton"; button: number }
    | { type: "gamepadButton"; button: number }
    | { type: "gamepadAxis"; axis: number; direction: 1 | -1 };

/**
 * Internal state for a single action
 */
interface IActionState {
    bindings: InputBinding[];
    down: boolean;
    pressed: boolean;
    released: boolean;
}

// Maps mouseButton index (0=left, 1=middle, 2=right) to PointerInput enum
type _PointerButtonInput = PointerInput.LeftClick | PointerInput.MiddleClick | PointerInput.RightClick;
const _BUTTON_TO_POINTER_INPUT: _PointerButtonInput[] = [PointerInput.LeftClick, PointerInput.MiddleClick, PointerInput.RightClick];

// Standard gamepad axis-to-stick mapping for DeviceSourceManager
// Raw gamepad axes [0..3] map to stick inputs [17..20] in the Xbox/DualShock layout
const _GAMEPAD_AXIS_OFFSET = 17;

// All gamepad device types to poll
const _GAMEPAD_TYPES: DeviceType[] = [DeviceType.Xbox, DeviceType.DualShock, DeviceType.DualSense, DeviceType.Switch];

/**
 * Maps abstract game actions to physical input bindings (keyboard, mouse, touch, gamepad).
 * Provides frame-accurate pressed/released detection and axis queries.
 *
 * Uses Babylon.js core DeviceSourceManager for pointer (mouse + touch) and gamepad
 * input, giving automatic support for touch devices and standardized gamepad handling.
 * Keyboard input uses native event.code for modern, layout-independent key detection.
 *
 * Usage:
 * ```typescript
 * const input = new InputMap2D(engine);
 * input.defineAction("jump", { type: "key", key: "Space" }, { type: "gamepadButton", button: 0 });
 * input.defineAction("moveRight", { type: "key", key: "ArrowRight" }, { type: "key", key: "KeyD" });
 *
 * // In game loop:
 * input.update();
 * if (input.isActionPressed("jump")) { ... }
 * ```
 */
export class InputMap2D {
    private _actions: Map<string, IActionState> = new Map();
    private _keysDown: Set<string> = new Set();
    private _pointerScreenPosition: Vector2 = Vector2.Zero();
    private _camera: Camera2D | null = null;
    private _canvas: HTMLCanvasElement;
    private _disposed: boolean = false;
    private _deviceSourceManager: DeviceSourceManager;

    // Bound keyboard event handlers for cleanup
    private _onKeyDown: (e: KeyboardEvent) => void;
    private _onKeyUp: (e: KeyboardEvent) => void;

    /**
     * Creates a new InputMap2D
     * @param engine - The Babylon.js engine instance (used for DeviceSourceManager and canvas access)
     * @param camera - Optional camera for screen-to-world pointer conversion
     */
    constructor(engine: AbstractEngine, camera?: Camera2D) {
        this._canvas = engine.getRenderingCanvas()!;
        this._camera = camera ?? null;
        this._deviceSourceManager = new DeviceSourceManager(engine);

        // Keyboard: use native event.code for layout-independent key detection
        this._onKeyDown = (e: KeyboardEvent) => {
            this._keysDown.add(e.code);
        };
        this._onKeyUp = (e: KeyboardEvent) => {
            this._keysDown.delete(e.code);
        };
        window.addEventListener("keydown", this._onKeyDown);
        window.addEventListener("keyup", this._onKeyUp);

        // Pointer (mouse + touch): track position via DeviceSourceManager observables
        this._deviceSourceManager.onDeviceConnectedObservable.add((deviceSource) => {
            if (deviceSource.deviceType === DeviceType.Mouse || deviceSource.deviceType === DeviceType.Touch) {
                this._setupPointerDevice(deviceSource as DeviceSource<DeviceType.Mouse> | DeviceSource<DeviceType.Touch>);
            }
        });
    }

    /**
     * Subscribes to pointer device events for position tracking.
     * Called for both Mouse and Touch device sources.
     */
    private _setupPointerDevice(deviceSource: DeviceSource<DeviceType.Mouse> | DeviceSource<DeviceType.Touch>): void {
        deviceSource.onInputChangedObservable.add((event) => {
            const pointerEvent = event as unknown as IPointerEvent;
            if (pointerEvent.clientX !== undefined) {
                const rect = this._canvas.getBoundingClientRect();
                const scaleX = rect.width > 0 ? this._canvas.width / rect.width : 1;
                const scaleY = rect.height > 0 ? this._canvas.height / rect.height : 1;
                this._pointerScreenPosition.x = (pointerEvent.clientX - rect.left) * scaleX;
                this._pointerScreenPosition.y = (pointerEvent.clientY - rect.top) * scaleY;
            }
        });
    }

    /**
     * Defines an action with one or more input bindings
     * @param name - The action name (e.g., "jump", "moveLeft")
     * @param bindings - One or more input bindings
     */
    public defineAction(name: string, ...bindings: InputBinding[]): void {
        this._actions.set(name, {
            bindings,
            down: false,
            pressed: false,
            released: false,
        });
    }

    /**
     * Updates action states. Must be called once per frame, before querying actions.
     * Resolves pressed/released transitions for the current frame.
     */
    public update(): void {
        for (const [, state] of this._actions) {
            const wasDown = state.down;
            state.down = this._isAnyBindingDown(state.bindings);
            state.pressed = state.down && !wasDown;
            state.released = !state.down && wasDown;
        }
    }

    /**
     * Whether the action is currently held down
     * @param name - The action name
     * @returns True if any binding for this action is active
     */
    public isActionDown(name: string): boolean {
        return this._actions.get(name)?.down ?? false;
    }

    /**
     * Whether the action was just pressed this frame
     * @param name - The action name
     * @returns True if the action transitioned from up to down this frame
     */
    public isActionPressed(name: string): boolean {
        return this._actions.get(name)?.pressed ?? false;
    }

    /**
     * Whether the action was just released this frame
     * @param name - The action name
     * @returns True if the action transitioned from down to up this frame
     */
    public isActionReleased(name: string): boolean {
        return this._actions.get(name)?.released ?? false;
    }

    /**
     * Gets an analog axis value for an action (for gamepad axes).
     * Returns -1 or 1 for digital inputs (keys), or the analog value for gamepad axes.
     * @param name - The action name
     * @returns A value from -1 to 1
     */
    public getAxis(name: string): number {
        const state = this._actions.get(name);
        if (!state) {
            return 0;
        }

        for (const binding of state.bindings) {
            if (binding.type === "gamepadAxis") {
                for (const gpType of _GAMEPAD_TYPES) {
                    const gp = this._deviceSourceManager.getDeviceSource(gpType);
                    if (gp) {
                        const value = gp.getInput(binding.axis + _GAMEPAD_AXIS_OFFSET) as number;
                        if (Math.abs(value) > 0.15) {
                            return value * binding.direction;
                        }
                    }
                }
            } else if (this._isBindingDown(binding)) {
                return 1;
            }
        }
        return 0;
    }

    /**
     * Current pointer position in screen pixels (render-buffer space, DPI-corrected)
     */
    public get pointerScreenPosition(): Vector2 {
        return this._pointerScreenPosition;
    }

    /**
     * Current pointer position in world coordinates (requires camera)
     */
    public get pointerWorldPosition(): Vector2 {
        if (this._camera) {
            return this._camera.screenToWorld(this._pointerScreenPosition);
        }
        return this._pointerScreenPosition.clone();
    }

    /**
     * Sets the camera used for screen-to-world conversion
     * @param camera - The Camera2D instance
     */
    public set camera(camera: Camera2D | null) {
        this._camera = camera;
    }

    /**
     * Whether a specific pointer button is currently down (mouse or touch).
     * Touch is treated as button 0 (left click).
     * @param button - Pointer button index (0 = left/touch, 1 = middle, 2 = right)
     * @returns True if the button is held down
     */
    public isPointerDown(button: number = 0): boolean {
        const pointerInput = _BUTTON_TO_POINTER_INPUT[button];
        if (pointerInput === undefined) {
            return false;
        }

        const mouse = this._deviceSourceManager.getDeviceSource(DeviceType.Mouse);
        if (mouse && mouse.getInput(pointerInput)) {
            return true;
        }

        // Touch counts as button 0
        if (button === 0) {
            const touches = this._deviceSourceManager.getDeviceSources(DeviceType.Touch);
            for (const touch of touches) {
                if (touch.getInput(PointerInput.LeftClick)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Checks if a specific binding is currently active.
     * Polls DeviceSourceManager for pointer and gamepad state.
     */
    private _isBindingDown(binding: InputBinding): boolean {
        switch (binding.type) {
            case "key":
                return this._keysDown.has(binding.key);
            case "mouseButton": {
                const pointerInput = _BUTTON_TO_POINTER_INPUT[binding.button];
                if (pointerInput === undefined) {
                    return false;
                }

                // Check mouse
                const mouse = this._deviceSourceManager.getDeviceSource(DeviceType.Mouse);
                if (mouse && mouse.getInput(pointerInput)) {
                    return true;
                }

                // Check touch (touch = button 0)
                if (binding.button === 0) {
                    const touches = this._deviceSourceManager.getDeviceSources(DeviceType.Touch);
                    for (const touch of touches) {
                        if (touch.getInput(PointerInput.LeftClick)) {
                            return true;
                        }
                    }
                }

                return false;
            }
            case "gamepadButton": {
                for (const gpType of _GAMEPAD_TYPES) {
                    const gp = this._deviceSourceManager.getDeviceSource(gpType);
                    if (gp && gp.getInput(binding.button)) {
                        return true;
                    }
                }
                return false;
            }
            case "gamepadAxis": {
                for (const gpType of _GAMEPAD_TYPES) {
                    const gp = this._deviceSourceManager.getDeviceSource(gpType);
                    if (gp) {
                        const value = gp.getInput(binding.axis + _GAMEPAD_AXIS_OFFSET) as number;
                        if (value * binding.direction > 0.15) {
                            return true;
                        }
                    }
                }
                return false;
            }
            default:
                return false;
        }
    }

    /**
     * Checks if any binding in the array is currently active
     */
    private _isAnyBindingDown(bindings: InputBinding[]): boolean {
        for (const binding of bindings) {
            if (this._isBindingDown(binding)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Disposes of the input manager and removes event listeners
     */
    public dispose(): void {
        if (this._disposed) {
            return;
        }
        window.removeEventListener("keydown", this._onKeyDown);
        window.removeEventListener("keyup", this._onKeyUp);
        this._deviceSourceManager.dispose();
        this._disposed = true;
    }
}
