import { Logger } from "core/Misc/logger";
import { Observable } from "core/Misc/observable";

/**
 * Defines the callbacks for a single FSM state.
 * All callbacks are optional — implement only what you need.
 * @template TContext - The shared context object type.
 */
export interface IState2D<TContext = unknown> {
    /** Unique identifier for this state. */
    name: string;

    /**
     * Called once when entering this state.
     * @param context - Shared game context.
     * @param previousState - Name of the state being left ("" if initial state).
     * @returns Nothing.
     */
    onEnter?(context: TContext, previousState: string): void;

    /**
     * Called every frame while this state is active.
     * @param context - Shared game context.
     * @param deltaTime - Time since last frame in seconds.
     * @returns Nothing.
     */
    onUpdate?(context: TContext, deltaTime: number): void;

    /**
     * Called once when leaving this state.
     * @param context - Shared game context.
     * @param nextState - Name of the state being entered.
     * @returns Nothing.
     */
    onExit?(context: TContext, nextState: string): void;
}

/**
 * Defines a one-way transition between two states.
 * Either auto-evaluated via condition or triggered manually via trigger(name).
 * @template TContext - The shared context object type.
 */
export interface ITransition2D<TContext = unknown> {
    /** Source state name. Use "*" to match any current state. */
    from: string;

    /** Target state name. */
    to: string;

    /**
     * Guard function for auto-evaluated transitions.
     * When present, this transition is checked during update().
     * @param context - Shared game context.
     * @returns True when the transition should fire.
     */
    condition?(context: TContext): boolean;

    /** Optional name for manual triggering via trigger(name). */
    name?: string;

    /**
     * Priority among transitions from the same source state.
     * Higher priority transitions are checked first.
     */
    priority?: number;
}

/**
 * Event data emitted for each successful state transition.
 */
export interface IStateChangeEvent {
    /** Name of the previous state. */
    previousState: string;

    /** Name of the new current state. */
    currentState: string;
}

/**
 * Generic finite state machine. Manages state entry/update/exit,
 * auto-condition evaluation, and manual triggers.
 *
 * @template TContext - Type of the shared context object passed to state callbacks.
 */
export class StateMachine2D<TContext = unknown> {
    /** Fires on every state transition. */
    public readonly onStateChange: Observable<IStateChangeEvent> = new Observable<IStateChangeEvent>();

    /**
     * Whether to allow multiple consecutive state transitions in a single update call.
     * Default: false.
     */
    public enableTransitionChaining: boolean = false;

    /**
     * Maximum number of transitions allowed in a single update when chaining is enabled.
     * Default: 10.
     */
    public maxTransitionChainLength: number = 10;

    private readonly _states: Map<string, IState2D<TContext>> = new Map();
    private readonly _transitionsByState: Map<string, ITransition2D<TContext>[]> = new Map();
    private readonly _wildcardTransitions: ITransition2D<TContext>[] = [];
    private readonly _changeEventScratch: IStateChangeEvent = { previousState: "", currentState: "" };
    private readonly _context: TContext;

    private _initialState: string;
    private _currentState: IState2D<TContext> | null = null;
    private _currentStateName: string = "";
    private _previousStateName: string = "";
    private _isRunning: boolean = false;

    /**
     * Creates a new StateMachine2D.
     * @param context - The shared context object passed to all state callbacks.
     * @param initialState - Name of the starting state. For backward compatibility,
     * this may also be provided to start(initialState).
     */
    constructor(context: TContext, initialState: string = "") {
        this._context = context;
        this._initialState = initialState;
    }

    /**
     * Name of the current active state.
     * @returns The current state name, or an empty string when stopped.
     */
    public get currentState(): string {
        return this._currentStateName;
    }

    /**
     * Name of the previously active state.
     * @returns The previous state name.
     */
    public get previousState(): string {
        return this._previousStateName;
    }

    /**
     * Whether the FSM is currently running.
     * @returns True when running.
     */
    public get isRunning(): boolean {
        return this._isRunning;
    }

    /**
     * Backward-compatible alias for isRunning.
     * @returns True when running.
     */
    public get isStarted(): boolean {
        return this._isRunning;
    }

    /**
     * The shared context object.
     * @returns The shared context object.
     */
    public get context(): TContext {
        return this._context;
    }

    /**
     * Registers a state. If a state with the same name already exists, it is replaced.
     * @param state - The state definition to register.
     * @returns This state machine for chaining.
     */
    public addState(state: IState2D<TContext>): StateMachine2D<TContext> {
        this._states.set(state.name, state);
        if (this._currentStateName === state.name) {
            this._currentState = state;
        }
        return this;
    }

    /**
     * Removes a state by name. No-op if not found.
     * Throws if the state is currently active.
     * @param name - Name of the state to remove.
     * @returns Nothing.
     */
    public removeState(name: string): void {
        if (!this._states.has(name)) {
            return;
        }
        if (this._currentStateName === name) {
            throw new Error(`Cannot remove active state "${name}".`);
        }

        this._states.delete(name);
        if (this._initialState === name) {
            this._initialState = "";
        }

        this._transitionsByState.delete(name);
        for (const transitions of this._transitionsByState.values()) {
            this._removeTransitionsFromBucket(transitions, (transition) => transition.to === name);
        }
        this._removeTransitionsFromBucket(this._wildcardTransitions, (transition) => transition.to === name);
    }

    /**
     * Adds a transition. Multiple transitions from the same source state are legal.
     * Buckets are kept sorted by descending priority.
     * @param transition - The transition to add.
     * @returns This state machine for chaining.
     */
    public addTransition(transition: ITransition2D<TContext>): StateMachine2D<TContext> {
        if (transition.from !== "*" && !this._states.has(transition.from)) {
            throw new Error(`Source state "${transition.from}" not found`);
        }
        if (!this._states.has(transition.to)) {
            throw new Error(`Target state "${transition.to}" not found`);
        }

        if (transition.from === "*") {
            this._wildcardTransitions.push(transition);
            this._sortTransitions(this._wildcardTransitions);
        } else {
            let transitions = this._transitionsByState.get(transition.from);
            if (!transitions) {
                transitions = [];
                this._transitionsByState.set(transition.from, transitions);
            }
            transitions.push(transition);
            this._sortTransitions(transitions);
        }

        return this;
    }

    /**
     * Removes all transitions from a given source state to a given target state.
     * @param from - Source state name, or "*" for wildcard transitions.
     * @param to - Target state name.
     * @returns Nothing.
     */
    public removeTransition(from: string, to: string): void {
        if (from === "*") {
            this._removeTransitionsFromBucket(this._wildcardTransitions, (transition) => transition.to === to);
            return;
        }

        const transitions = this._transitionsByState.get(from);
        if (!transitions) {
            return;
        }

        this._removeTransitionsFromBucket(transitions, (transition) => transition.to === to);
        if (transitions.length === 0) {
            this._transitionsByState.delete(from);
        }
    }

    /**
     * Starts the FSM. Calls onEnter on the initial state.
     * No-op if already running.
     * @param initialState - Optional backward-compatible initial state override.
     * @returns Nothing.
     */
    public start(initialState?: string): void {
        if (this._isRunning) {
            return;
        }

        if (initialState !== undefined) {
            this._initialState = initialState;
        }

        if (!this._initialState) {
            throw new Error("StateMachine2D cannot start without an initial state.");
        }

        const state = this._states.get(this._initialState);
        if (!state) {
            throw new Error(`State "${this._initialState}" not found`);
        }

        this._previousStateName = "";
        this._currentState = state;
        this._currentStateName = this._initialState;
        this._isRunning = true;
        state.onEnter?.(this._context, "");
    }

    /**
     * Stops the FSM. Calls onExit on the current state.
     * After stop, update is a no-op until start is called again.
     * @returns Nothing.
     */
    public stop(): void {
        if (!this._isRunning || !this._currentState) {
            return;
        }

        const currentStateName = this._currentStateName;
        this._currentState.onExit?.(this._context, "");
        this._previousStateName = currentStateName;
        this._currentState = null;
        this._currentStateName = "";
        this._isRunning = false;
    }

    /**
     * Advances the FSM by deltaTime.
     * Auto-transitions are evaluated before onUpdate.
     * If any transition fires, onUpdate is skipped for that frame.
     * @param deltaTime - Time since last frame in seconds.
     * @returns Nothing.
     */
    public update(deltaTime: number): void {
        if (!this._isRunning || !this._currentState) {
            return;
        }

        const transitionCount = this.enableTransitionChaining ? this._evaluateTransitionChain() : (this._evaluateSingleTransition() ? 1 : 0);
        if (transitionCount > 0) {
            return;
        }

        this._currentState.onUpdate?.(this._context, deltaTime);
    }

    /**
     * Manually fires a named transition for the current state or a wildcard transition.
     * State-specific transitions are checked before wildcard transitions.
     * @param transitionName - Name of the transition to fire.
     * @returns True if a transition fired, otherwise false.
     */
    public trigger(transitionName: string): boolean {
        if (!this._isRunning) {
            return false;
        }

        const stateTransitions = this._transitionsByState.get(this._currentStateName);
        if (stateTransitions && this._tryTriggerNamedTransition(stateTransitions, transitionName)) {
            return true;
        }

        return this._tryTriggerNamedTransition(this._wildcardTransitions, transitionName);
    }

    /**
     * Forces an immediate state change to the given state.
     * Calls onExit on the current state and onEnter on the new state, bypassing transitions.
     * @param stateName - The target state name.
     * @returns Nothing.
     */
    public forceState(stateName: string): void {
        const state = this._states.get(stateName);
        if (!state) {
            throw new Error(`State "${stateName}" not found`);
        }

        if (!this._isRunning) {
            this._currentState = state;
            this._currentStateName = stateName;
            this._previousStateName = "";
            this._isRunning = true;
            state.onEnter?.(this._context, "");
            return;
        }

        this._doTransition(stateName);
    }

    /**
     * Checks whether a state has been registered.
     * @param stateName - State name to look up.
     * @returns True when the state exists.
     */
    public hasState(stateName: string): boolean {
        return this._states.has(stateName);
    }

    /**
     * Disposes all internal state and clears the observable.
     * @returns Nothing.
     */
    public dispose(): void {
        this._states.clear();
        this._transitionsByState.clear();
        this._wildcardTransitions.length = 0;
        this._currentState = null;
        this._currentStateName = "";
        this._previousStateName = "";
        this._isRunning = false;
        this._initialState = "";
        this.onStateChange.clear();
    }

    private _sortTransitions(transitions: ITransition2D<TContext>[]): void {
        transitions.sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));
    }

    private _removeTransitionsFromBucket(transitions: ITransition2D<TContext>[], predicate: (transition: ITransition2D<TContext>) => boolean): void {
        for (let index = transitions.length - 1; index >= 0; index--) {
            if (predicate(transitions[index])) {
                transitions.splice(index, 1);
            }
        }
    }

    private _evaluateSingleTransition(): boolean {
        return this._evaluateTransitionsForCurrentState();
    }

    private _evaluateTransitionChain(): number {
        let chainLength = 0;

        while (chainLength < this.maxTransitionChainLength) {
            if (!this._evaluateTransitionsForCurrentState()) {
                return chainLength;
            }

            chainLength++;
        }

        if (this._hasPendingTransitionForCurrentState()) {
            Logger.Warn(`StateMachine2D transition chain reached maxTransitionChainLength (${this.maxTransitionChainLength}).`);
        }

        return chainLength;
    }

    private _evaluateTransitionsForCurrentState(): boolean {
        const stateTransitions = this._transitionsByState.get(this._currentStateName);
        if (stateTransitions && this._tryAutoTransition(stateTransitions)) {
            return true;
        }

        return this._tryAutoTransition(this._wildcardTransitions);
    }

    private _hasPendingTransitionForCurrentState(): boolean {
        const stateTransitions = this._transitionsByState.get(this._currentStateName);
        if (stateTransitions && this._hasPassingAutoTransition(stateTransitions)) {
            return true;
        }

        return this._hasPassingAutoTransition(this._wildcardTransitions);
    }

    private _hasPassingAutoTransition(transitions: ITransition2D<TContext>[]): boolean {
        for (const transition of transitions) {
            if (transition.condition && transition.condition(this._context)) {
                return true;
            }
        }

        return false;
    }

    private _tryAutoTransition(transitions: ITransition2D<TContext>[]): boolean {
        for (const transition of transitions) {
            if (!transition.condition) {
                continue;
            }

            if (transition.condition(this._context)) {
                return this._doTransition(transition.to);
            }
        }

        return false;
    }

    private _tryTriggerNamedTransition(transitions: ITransition2D<TContext>[], transitionName: string): boolean {
        for (const transition of transitions) {
            if (transition.name !== transitionName) {
                continue;
            }

            if (transition.condition && !transition.condition(this._context)) {
                continue;
            }

            return this._doTransition(transition.to);
        }

        return false;
    }

    private _doTransition(targetName: string): boolean {
        const targetState = this._states.get(targetName);
        if (!targetState) {
            throw new Error(`State "${targetName}" not found`);
        }

        const previousStateName = this._currentStateName;

        this._currentState?.onExit?.(this._context, targetName);
        this._currentState = targetState;
        this._currentStateName = targetName;
        this._previousStateName = previousStateName;
        targetState.onEnter?.(this._context, previousStateName);

        this._changeEventScratch.previousState = previousStateName;
        this._changeEventScratch.currentState = targetName;
        this.onStateChange.notifyObservers(this._changeEventScratch);
        return true;
    }
}

