import type { AbstractEngine } from "core/Engines/abstractEngine";
import { DeviceSourceManager } from "core/DeviceInput/InputDevices/deviceSourceManager";
import { DeviceType, PointerInput } from "core/DeviceInput/InputDevices/deviceEnums";
import { Vector2 } from "core/Maths/math.vector";

import type { Camera2D } from "../Camera2D/camera2D";
import { Rectangle2D } from "../Math/rectangle2D";

/**
 * Describes one physical input that can trigger an action.
 */
export type InputBinding =
    | { type: "key"; key: string }
    | { type: "mouseButton"; button: 0 | 1 | 2 }
    | { type: "gamepadButton"; button: number; gamepadIndex?: number }
    | { type: "gamepadAxis"; axis: number; direction: 1 | -1; deadZone?: number; gamepadIndex?: number }
    | { type: "touchButton"; touchId?: number }
    | { type: "virtualButton"; id: string };

/**
 * Configuration for input buffering on a specific action.
 */
export interface IInputBufferConfig {
    /** Buffer window in seconds. */
    bufferWindow: number;
}

/**
 * Configuration for an on-screen virtual joystick or button.
 */
export interface IVirtualJoystickConfig {
    /** Unique identifier for this control. */
    id: string;
    /** Type of virtual control. */
    type: "joystick" | "button";
    /** Screen-space rectangle in physical pixels. */
    rect: Rectangle2D;
    /** Dead zone radius in pixels for joystick controls. */
    deadZoneRadius?: number;
}

/** @internal */
interface IActionState {
    bindings: InputBinding[];
    down: boolean;
    pressed: boolean;
    released: boolean;
    strength: number;
    buffered: boolean;
    bufferTime: number;
}

/** @internal */
interface IVirtualControlState {
    config: IVirtualJoystickConfig;
    touchId: number | null;
    down: boolean;
    value: Vector2;
    origin: Vector2;
}

type _PointerButtonInput = PointerInput.LeftClick | PointerInput.MiddleClick | PointerInput.RightClick;

const _BUTTON_TO_POINTER_INPUT: _PointerButtonInput[] = [PointerInput.LeftClick, PointerInput.MiddleClick, PointerInput.RightClick];
const _GAMEPAD_AXIS_OFFSET = 17;
const _DEFAULT_GAMEPAD_DEAD_ZONE = 0.15;
const _GAMEPAD_TYPES: DeviceType[] = [DeviceType.Xbox, DeviceType.DualShock, DeviceType.DualSense, DeviceType.Switch];

/**
 * Maps abstract game actions to physical input bindings.
 * Provides frame-accurate pressed/released/down queries and analog axis values.
 */
export class InputMap2D {
    private _actions: Map<string, IActionState> = new Map();
    private _bufferConfigs: Map<string, IInputBufferConfig> = new Map();
    private _virtualControls: Map<string, IVirtualControlState> = new Map();
    private _keysDown: Set<string> = new Set();
    private _touchPositions: Map<number, Vector2> = new Map();
    private _activeTouchIds: number[] = [];
    private _pointerScreenPosition: Vector2 = Vector2.Zero();
    private _pointerWorldPosition: Vector2 = Vector2.Zero();
    private _camera: Camera2D | null = null;
    private _canvas: HTMLCanvasElement;
    private _disposed: boolean = false;
    private _deviceSourceManager: DeviceSourceManager;

    private _onCanvasPointerDown: () => void;
    private _onKeyDown: (event: KeyboardEvent) => void;
    private _onKeyUp: (event: KeyboardEvent) => void;

    /**
     * Creates a new InputMap2D.
     * @param engine - The Babylon.js engine instance.
     * @param camera - Optional camera for screen-to-world pointer conversion.
     */
    constructor(engine: AbstractEngine, camera?: Camera2D) {
        const canvas = engine.getRenderingCanvas();
        if (!canvas) {
            throw new Error("InputMap2D requires an engine with a rendering canvas.");
        }

        this._canvas = canvas;
        this._camera = camera ?? null;
        this._deviceSourceManager = new DeviceSourceManager(engine);

        if (this._canvas.tabIndex < 0) {
            this._canvas.tabIndex = 0;
        }

        this._onCanvasPointerDown = () => {
            this._canvas.focus();
        };
        this._onKeyDown = (event: KeyboardEvent) => {
            this._keysDown.add(event.code);
        };
        this._onKeyUp = (event: KeyboardEvent) => {
            this._keysDown.delete(event.code);
        };

        this._canvas.addEventListener("pointerdown", this._onCanvasPointerDown);
        this._canvas.addEventListener("keydown", this._onKeyDown);
        this._canvas.addEventListener("keyup", this._onKeyUp);
    }

    /**
     * Defines or redefines an action with one or more bindings.
     * If the action already exists, its bindings are replaced.
     * @param actionName - Unique action identifier.
     * @param bindings - One or more input bindings.
     * @returns Nothing.
     */
    public defineAction(actionName: string, ...bindings: InputBinding[]): void {
        this._validateActionName(actionName);
        this._validateBindings(bindings);

        this._actions.set(actionName, {
            bindings: bindings.slice(),
            down: false,
            pressed: false,
            released: false,
            strength: 0,
            buffered: false,
            bufferTime: 0,
        });
    }

    /**
     * Removes an action and all its bindings.
     * @param actionName - Action to remove.
     * @returns Nothing.
     */
    public removeAction(actionName: string): void {
        this._actions.delete(actionName);
        this._bufferConfigs.delete(actionName);
    }

    /**
     * Adds additional bindings to an existing action without replacing current ones.
     * @param actionName - Action to modify.
     * @param bindings - Bindings to append.
     * @returns Nothing.
     */
    public addBindings(actionName: string, ...bindings: InputBinding[]): void {
        this._validateActionName(actionName);
        this._validateBindings(bindings);

        const state = this._actions.get(actionName);
        if (!state) {
            throw new Error(`InputMap2D action "${actionName}" is not defined.`);
        }

        state.bindings.push(...bindings);
    }

    /**
     * Enables input buffering for an action.
     * @param actionName - Action to buffer.
     * @param config - Buffer configuration.
     * @returns Nothing.
     */
    public enableInputBuffer(actionName: string, config: IInputBufferConfig): void {
        this._validateActionName(actionName);
        if (!this._actions.has(actionName)) {
            throw new Error(`InputMap2D action "${actionName}" is not defined.`);
        }

        if (!config || !Number.isFinite(config.bufferWindow) || config.bufferWindow < 0) {
            throw new Error("InputMap2D bufferWindow must be a finite number greater than or equal to zero.");
        }

        this._bufferConfigs.set(actionName, {
            bufferWindow: config.bufferWindow,
        });
    }

    /**
     * Disables input buffering for an action.
     * @param actionName - Action to update.
     * @returns Nothing.
     */
    public disableInputBuffer(actionName: string): void {
        this._bufferConfigs.delete(actionName);

        const state = this._actions.get(actionName);
        if (!state) {
            return;
        }

        state.buffered = false;
        state.bufferTime = 0;
    }

    /**
     * True if the action is currently held down.
     * @param actionName - Action to query.
     * @returns True when any binding is active.
     */
    public isActionDown(actionName: string): boolean {
        return this._actions.get(actionName)?.down ?? false;
    }

    /**
     * True for exactly one frame when the action transitions from up to down.
     * When buffering is enabled, buffered presses remain visible after release
     * until the buffer window expires or is consumed.
     * @param actionName - Action to query.
     * @returns True when the action is newly pressed or has a pending buffered press.
     */
    public isActionPressed(actionName: string): boolean {
        const state = this._actions.get(actionName);
        if (!state) {
            return false;
        }

        return state.pressed || (!state.down && state.buffered);
    }

    /**
     * True for exactly one frame when the action transitions from down to up.
     * @param actionName - Action to query.
     * @returns True when the action is newly released.
     */
    public isActionReleased(actionName: string): boolean {
        return this._actions.get(actionName)?.released ?? false;
    }

    /**
     * Returns the analog strength of the action in the [0..1] range.
     * @param actionName - Action to query.
     * @returns Analog strength or zero when undefined.
     */
    public getActionStrength(actionName: string): number {
        return this._actions.get(actionName)?.strength ?? 0;
    }

    /**
     * Returns a [-1..1] axis value combining a negative and positive action.
     * @param negativeAction - Action contributing negative direction.
     * @param positiveAction - Action contributing positive direction.
     * @returns Axis value in the [-1..1] range.
     */
    public getAxis(negativeAction: string, positiveAction: string): number {
        const negative = this.getActionStrength(negativeAction);
        const positive = this.getActionStrength(positiveAction);
        return Math.max(-1, Math.min(1, positive - negative));
    }

    /**
     * Returns a normalized 2D vector from four directional actions.
     * @param leftAction - Action contributing negative X.
     * @param rightAction - Action contributing positive X.
     * @param upAction - Action contributing negative Y.
     * @param downAction - Action contributing positive Y.
     * @param out - Output vector.
     * @returns The provided output vector.
     */
    public getVector(leftAction: string, rightAction: string, upAction: string, downAction: string, out: Vector2): Vector2 {
        out.x = this.getAxis(leftAction, rightAction);
        out.y = this.getAxis(upAction, downAction);

        const lengthSquared = out.x * out.x + out.y * out.y;
        if (lengthSquared > 1) {
            const invLength = 1 / Math.sqrt(lengthSquared);
            out.x *= invLength;
            out.y *= invLength;
        }

        return out;
    }

    /**
     * Consumes a buffered press for the given action.
     * Returns true and clears the buffer if a press is pending.
     * @param actionName - Action to consume.
     * @returns True if a buffered or freshly pressed action was available.
     */
    public consumeBufferedAction(actionName: string): boolean {
        const state = this._actions.get(actionName);
        if (!state) {
            return false;
        }

        if (!state.buffered && !state.pressed) {
            return false;
        }

        state.buffered = false;
        state.bufferTime = 0;
        return true;
    }

    /**
     * Current pointer position in screen space.
     * @returns A cached pointer position.
     */
    public get pointerScreenPosition(): Vector2 {
        return this._pointerScreenPosition;
    }

    /**
     * Current pointer position in world space.
     * Returns (0, 0) if no camera is set.
     * @returns A cached pointer world position.
     */
    public get pointerWorldPosition(): Vector2 {
        return this._pointerWorldPosition;
    }

    /**
     * Number of active touch points.
     * @returns Active touch count.
     */
    public get touchCount(): number {
        return this._activeTouchIds.length;
    }

    /**
     * Gets the screen position of a specific touch point.
     * @param touchIndex - Active touch index.
     * @param out - Output vector.
     * @returns The provided output vector or null if the touch is not active.
     */
    public getTouchPosition(touchIndex: number, out: Vector2): Vector2 | null {
        const touchId = this._activeTouchIds[touchIndex];
        if (touchId === undefined) {
            return null;
        }

        const position = this._touchPositions.get(touchId);
        if (!position) {
            return null;
        }

        out.x = position.x;
        out.y = position.y;
        return out;
    }

    /**
     * Registers a virtual joystick or button for on-screen touch controls.
     * @param config - Virtual control configuration.
     * @returns Nothing.
     */
    public addVirtualControl(config: IVirtualJoystickConfig): void {
        this._validateVirtualControlConfig(config);

        this._virtualControls.set(config.id, {
            config: {
                id: config.id,
                type: config.type,
                rect: config.rect.clone(),
                deadZoneRadius: config.deadZoneRadius,
            },
            touchId: null,
            down: false,
            value: Vector2.Zero(),
            origin: Vector2.Zero(),
        });
    }

    /**
     * Removes a virtual control by id.
     * @param id - Virtual control id.
     * @returns Nothing.
     */
    public removeVirtualControl(id: string): void {
        this._virtualControls.delete(id);
    }

    /**
     * Returns the current value of a virtual joystick.
     * @param id - Virtual joystick id.
     * @param out - Output vector.
     * @returns The provided output vector.
     */
    public getVirtualJoystick(id: string, out: Vector2): Vector2 {
        const control = this._virtualControls.get(id);
        if (!control || control.config.type !== "joystick") {
            out.x = 0;
            out.y = 0;
            return out;
        }

        out.x = control.value.x;
        out.y = control.value.y;
        return out;
    }

    /**
     * Returns true if the virtual button with the given id is currently pressed.
     * @param id - Virtual button id.
     * @returns True when the virtual button is active.
     */
    public isVirtualButtonDown(id: string): boolean {
        const control = this._virtualControls.get(id);
        if (control && control.config.type === "button") {
            return control.down;
        }

        const suffixLength = this._getVirtualDirectionSuffixLength(id);
        if (suffixLength === 0) {
            return false;
        }

        const joystick = this._virtualControls.get(id.slice(0, -suffixLength));
        if (!joystick || joystick.config.type !== "joystick") {
            return false;
        }

        if (id.endsWith("_left")) {
            return joystick.value.x < 0;
        }
        if (id.endsWith("_right")) {
            return joystick.value.x > 0;
        }
        if (id.endsWith("_up")) {
            return joystick.value.y < 0;
        }

        return joystick.value.y > 0;
    }

    /**
     * Updates all input state for the current frame.
     * Must be called once per frame before scene.render().
     * @param deltaTime - Time since last frame in seconds.
     * @returns Nothing.
     */
    public update(deltaTime: number): void {
        if (this._disposed) {
            return;
        }

        if (!Number.isFinite(deltaTime) || deltaTime < 0) {
            throw new Error("InputMap2D update requires a finite deltaTime greater than or equal to zero.");
        }

        this._resetFrameState();
        this._refreshTouches();
        this._updatePointer();
        this._updateVirtualControls();
        this._evaluateActions();
        this._updateBuffers(deltaTime);
    }

    /**
     * Sets the active camera for pointer world-space conversion.
     * @param camera - Camera to use.
     * @returns Nothing.
     */
    public setCamera(camera: Camera2D): void {
        this._camera = camera;
        this._updatePointerWorldPosition();
    }

    /**
     * Disposes event listeners and the DeviceSourceManager.
     * @returns Nothing.
     */
    public dispose(): void {
        if (this._disposed) {
            return;
        }

        this._canvas.removeEventListener("pointerdown", this._onCanvasPointerDown);
        this._canvas.removeEventListener("keydown", this._onKeyDown);
        this._canvas.removeEventListener("keyup", this._onKeyUp);
        this._deviceSourceManager.dispose();
        this._actions.clear();
        this._bufferConfigs.clear();
        this._virtualControls.clear();
        this._touchPositions.clear();
        this._activeTouchIds.length = 0;
        this._keysDown.clear();
        this._disposed = true;
    }

    private _resetFrameState(): void {
        for (const [, state] of this._actions) {
            state.pressed = false;
            state.released = false;
        }
    }

    private _evaluateActions(): void {
        for (const [, state] of this._actions) {
            const wasDown = state.down;
            let down = false;
            let strength = 0;

            for (const binding of state.bindings) {
                const bindingStrength = this._getBindingStrength(binding);
                if (bindingStrength <= 0) {
                    continue;
                }

                down = true;
                if (bindingStrength > strength) {
                    strength = bindingStrength;
                }
            }

            state.down = down;
            state.strength = strength;
            state.pressed = down && !wasDown;
            state.released = !down && wasDown;
        }
    }

    private _updateBuffers(deltaTime: number): void {
        for (const [actionName, state] of this._actions) {
            if (state.buffered) {
                state.bufferTime -= deltaTime;
                if (state.bufferTime <= 0) {
                    state.buffered = false;
                    state.bufferTime = 0;
                }
            }

            if (!state.pressed) {
                continue;
            }

            const config = this._bufferConfigs.get(actionName);
            if (!config || config.bufferWindow <= 0) {
                continue;
            }

            state.buffered = true;
            state.bufferTime = config.bufferWindow;
        }
    }

    private _updatePointer(): void {
        const mouse = this._deviceSourceManager.getDeviceSource(DeviceType.Mouse);
        if (mouse) {
            this._pointerScreenPosition.x = mouse.getInput(PointerInput.Horizontal);
            this._pointerScreenPosition.y = mouse.getInput(PointerInput.Vertical);
        } else if (this._activeTouchIds.length > 0) {
            const position = this._touchPositions.get(this._activeTouchIds[0]);
            if (position) {
                this._pointerScreenPosition.x = position.x;
                this._pointerScreenPosition.y = position.y;
            }
        }

        this._updatePointerWorldPosition();
    }

    private _updatePointerWorldPosition(): void {
        if (this._camera) {
            this._camera.screenToWorld(this._pointerScreenPosition, this._pointerWorldPosition);
            return;
        }

        this._pointerWorldPosition.x = 0;
        this._pointerWorldPosition.y = 0;
    }

    private _refreshTouches(): void {
        this._activeTouchIds.length = 0;

        const touches = this._deviceSourceManager.getDeviceSources(DeviceType.Touch);
        for (const touch of touches) {
            if (!touch.getInput(PointerInput.LeftClick)) {
                continue;
            }

            this._activeTouchIds.push(touch.deviceSlot);
            const position = this._getOrCreateTouchPosition(touch.deviceSlot);
            position.x = touch.getInput(PointerInput.Horizontal);
            position.y = touch.getInput(PointerInput.Vertical);
        }

        for (const touchId of this._touchPositions.keys()) {
            if (!this._isTouchActive(touchId)) {
                this._touchPositions.delete(touchId);
            }
        }
    }

    private _getOrCreateTouchPosition(touchId: number): Vector2 {
        const existingPosition = this._touchPositions.get(touchId);
        if (existingPosition) {
            return existingPosition;
        }

        const position = Vector2.Zero();
        this._touchPositions.set(touchId, position);
        return position;
    }

    private _isTouchActive(touchId: number): boolean {
        for (let index = 0; index < this._activeTouchIds.length; index++) {
            if (this._activeTouchIds[index] === touchId) {
                return true;
            }
        }

        return false;
    }

    private _updateVirtualControls(): void {
        for (const [, control] of this._virtualControls) {
            if (control.touchId !== null && !this._isTouchActive(control.touchId)) {
                control.touchId = null;
                control.origin.x = 0;
                control.origin.y = 0;
            }
        }

        for (let touchIndex = 0; touchIndex < this._activeTouchIds.length; touchIndex++) {
            const touchId = this._activeTouchIds[touchIndex];
            if (this._isVirtualTouchClaimed(touchId)) {
                continue;
            }

            const touchPosition = this._touchPositions.get(touchId);
            if (!touchPosition) {
                continue;
            }

            for (const [, control] of this._virtualControls) {
                if (control.touchId !== null || !control.config.rect.containsPoint(touchPosition.x, touchPosition.y)) {
                    continue;
                }

                control.touchId = touchId;
                control.origin.x = touchPosition.x;
                control.origin.y = touchPosition.y;
                break;
            }
        }

        for (const [, control] of this._virtualControls) {
            control.down = false;
            control.value.x = 0;
            control.value.y = 0;

            if (control.touchId === null) {
                continue;
            }

            const touchPosition = this._touchPositions.get(control.touchId);
            if (!touchPosition) {
                control.touchId = null;
                control.origin.x = 0;
                control.origin.y = 0;
                continue;
            }

            control.down = true;
            if (control.config.type === "button") {
                continue;
            }

            this._evaluateVirtualJoystick(control, touchPosition);
        }
    }

    private _isVirtualTouchClaimed(touchId: number): boolean {
        for (const [, control] of this._virtualControls) {
            if (control.touchId === touchId) {
                return true;
            }
        }

        return false;
    }

    private _evaluateVirtualJoystick(control: IVirtualControlState, touchPosition: Vector2): void {
        const radius = Math.min(control.config.rect.width, control.config.rect.height) * 0.5;
        if (radius <= 0) {
            return;
        }

        const dx = touchPosition.x - control.origin.x;
        const dy = touchPosition.y - control.origin.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const deadZone = Math.max(0, Math.min(control.config.deadZoneRadius ?? 0, radius));
        if (distance <= deadZone || distance <= 0) {
            return;
        }

        const clampedDistance = Math.min(distance, radius);
        const magnitudeDenominator = radius - deadZone;
        const magnitude = magnitudeDenominator > 0 ? (clampedDistance - deadZone) / magnitudeDenominator : 1;
        control.value.x = (dx / distance) * magnitude;
        control.value.y = (dy / distance) * magnitude;
    }

    private _getBindingStrength(binding: InputBinding): number {
        switch (binding.type) {
            case "key":
                return this._keysDown.has(binding.key) ? 1 : 0;
            case "mouseButton": {
                const pointerInput = _BUTTON_TO_POINTER_INPUT[binding.button];
                if (pointerInput === undefined) {
                    return 0;
                }

                const mouse = this._deviceSourceManager.getDeviceSource(DeviceType.Mouse);
                return mouse && mouse.getInput(pointerInput) ? 1 : 0;
            }
            case "gamepadButton":
                return this._getGamepadButtonStrength(binding.button, binding.gamepadIndex);
            case "gamepadAxis":
                return Math.abs(this._getGamepadAxisValue(binding));
            case "touchButton":
                return this._getTouchButtonStrength(binding.touchId);
            case "virtualButton":
                return this.isVirtualButtonDown(binding.id) ? 1 : 0;
        }
    }

    private _getTouchButtonStrength(touchId?: number): number {
        if (touchId === undefined) {
            return this._activeTouchIds.length > 0 ? 1 : 0;
        }

        return this._isTouchActive(touchId) ? 1 : 0;
    }

    private _getGamepadButtonStrength(button: number, gamepadIndex?: number): number {
        let strength = 0;
        for (let index = 0; index < _GAMEPAD_TYPES.length; index++) {
            const gamepad = this._deviceSourceManager.getDeviceSource(_GAMEPAD_TYPES[index], gamepadIndex);
            if (!gamepad) {
                continue;
            }

            strength = Math.max(strength, Math.max(0, Math.min(1, gamepad.getInput(button))));
        }

        return strength;
    }

    private _getGamepadAxisValue(binding: Extract<InputBinding, { type: "gamepadAxis" }>): number {
        const deadZone = binding.deadZone ?? _DEFAULT_GAMEPAD_DEAD_ZONE;
        let axis = 0;

        for (let index = 0; index < _GAMEPAD_TYPES.length; index++) {
            const gamepad = this._deviceSourceManager.getDeviceSource(_GAMEPAD_TYPES[index], binding.gamepadIndex);
            if (!gamepad) {
                continue;
            }

            const rawValue = gamepad.getInput(binding.axis + _GAMEPAD_AXIS_OFFSET);
            const directedValue = rawValue * binding.direction;
            if (directedValue <= deadZone) {
                continue;
            }

            const normalizedMagnitude = (directedValue - deadZone) / (1 - deadZone);
            const signedValue = normalizedMagnitude * binding.direction;
            if (Math.abs(signedValue) > Math.abs(axis)) {
                axis = signedValue;
            }
        }

        return axis;
    }

    private _getVirtualDirectionSuffixLength(id: string): number {
        if (id.endsWith("_left") || id.endsWith("_right") || id.endsWith("_down")) {
            return 5;
        }
        if (id.endsWith("_up")) {
            return 3;
        }

        return 0;
    }

    private _validateActionName(actionName: string): void {
        if (typeof actionName !== "string" || actionName.length === 0) {
            throw new Error("InputMap2D action names must be non-empty strings.");
        }
    }

    private _validateBindings(bindings: readonly InputBinding[]): void {
        if (bindings.length === 0) {
            throw new Error("InputMap2D actions require at least one binding.");
        }

        for (const binding of bindings) {
            this._validateBinding(binding);
        }
    }

    private _validateBinding(binding: InputBinding): void {
        if (!binding || typeof binding !== "object") {
            throw new Error("InputMap2D bindings must be objects.");
        }

        switch (binding.type) {
            case "key":
                if (typeof binding.key !== "string" || binding.key.length === 0) {
                    throw new Error("InputMap2D key bindings must provide a non-empty key code.");
                }
                return;
            case "mouseButton":
                if (!Number.isInteger(binding.button) || binding.button < 0 || binding.button > 2) {
                    throw new Error("InputMap2D mouseButton bindings must use button 0, 1, or 2.");
                }
                return;
            case "gamepadButton":
                this._validateNonNegativeInteger(binding.button, "InputMap2D gamepadButton bindings must use a non-negative integer button index.");
                this._validateOptionalNonNegativeInteger(binding.gamepadIndex, "InputMap2D gamepadButton bindings must use a non-negative integer gamepadIndex.");
                return;
            case "gamepadAxis":
                this._validateNonNegativeInteger(binding.axis, "InputMap2D gamepadAxis bindings must use a non-negative integer axis index.");
                this._validateOptionalNonNegativeInteger(binding.gamepadIndex, "InputMap2D gamepadAxis bindings must use a non-negative integer gamepadIndex.");
                if (binding.deadZone !== undefined && (!Number.isFinite(binding.deadZone) || binding.deadZone < 0 || binding.deadZone >= 1)) {
                    throw new Error("InputMap2D gamepadAxis deadZone values must be finite numbers in the [0, 1) range.");
                }
                return;
            case "touchButton":
                this._validateOptionalNonNegativeInteger(binding.touchId, "InputMap2D touchButton bindings must use a non-negative integer touchId.");
                return;
            case "virtualButton":
                if (typeof binding.id !== "string" || binding.id.length === 0) {
                    throw new Error("InputMap2D virtualButton bindings must provide a non-empty control id.");
                }
                return;
            default:
                throw new Error("InputMap2D bindings must use a supported binding type.");
        }
    }

    private _validateVirtualControlConfig(config: IVirtualJoystickConfig): void {
        if (!config || typeof config.id !== "string" || config.id.length === 0) {
            throw new Error("InputMap2D virtual controls must provide a non-empty id.");
        }

        if (!(config.rect instanceof Rectangle2D)) {
            throw new Error("InputMap2D virtual controls must provide a Rectangle2D touch area.");
        }

        if (!Number.isFinite(config.rect.x) || !Number.isFinite(config.rect.y) || !Number.isFinite(config.rect.width) || !Number.isFinite(config.rect.height)) {
            throw new Error("InputMap2D virtual control rectangles must use finite coordinates and sizes.");
        }

        if (config.rect.width <= 0 || config.rect.height <= 0) {
            throw new Error("InputMap2D virtual control rectangles must have positive width and height.");
        }

        if (config.deadZoneRadius !== undefined && (!Number.isFinite(config.deadZoneRadius) || config.deadZoneRadius < 0)) {
            throw new Error("InputMap2D virtual control deadZoneRadius values must be finite numbers greater than or equal to zero.");
        }
    }

    private _validateNonNegativeInteger(value: number, message: string): void {
        if (!Number.isInteger(value) || value < 0) {
            throw new Error(message);
        }
    }

    private _validateOptionalNonNegativeInteger(value: number | undefined, message: string): void {
        if (value !== undefined) {
            this._validateNonNegativeInteger(value, message);
        }
    }
}
