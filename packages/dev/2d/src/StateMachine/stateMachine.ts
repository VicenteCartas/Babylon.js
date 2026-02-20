import { Observable } from "core/Misc/observable";

/**
 * Defines callbacks for a single state in a StateMachine2D
 */
export interface IState2D<TContext = any> {
    /**
     * Unique name identifying this state
     */
    name: string;

    /**
     * Called when entering this state
     * @param context - The shared context object
     * @param previousState - Name of the state we came from (empty string if initial)
     */
    onEnter?(context: TContext, previousState: string): void;

    /**
     * Called every frame while this state is active
     * @param context - The shared context object
     * @param deltaTime - Time elapsed since last frame in seconds
     */
    onUpdate?(context: TContext, deltaTime: number): void;

    /**
     * Called when leaving this state
     * @param context - The shared context object
     * @param nextState - Name of the state we are transitioning to
     */
    onExit?(context: TContext, nextState: string): void;
}

/**
 * Defines a transition between two states
 */
export interface ITransition2D<TContext = any> {
    /**
     * Source state name
     */
    from: string;

    /**
     * Target state name
     */
    to: string;

    /**
     * Guard condition. Transition only fires when this returns true.
     * If not provided, the transition must be triggered manually via `trigger()`.
     * @param context - The shared context object
     * @returns Whether the transition should fire
     */
    condition?(context: TContext): boolean;

    /**
     * Priority for auto-evaluated transitions. Higher priority transitions are checked first.
     * Default: 0
     */
    priority?: number;

    /**
     * Optional name for this transition, used with `trigger(name)`
     */
    name?: string;
}

/**
 * Event data emitted on state changes
 */
export interface IStateChangeEvent {
    /**
     * The state we left
     */
    previousState: string;

    /**
     * The state we entered
     */
    currentState: string;
}

/**
 * A generic finite state machine for 2D game logic.
 *
 * Manages states with lifecycle hooks (onEnter/onUpdate/onExit),
 * automatic transitions with guard conditions, and named trigger transitions.
 * Useful for animation state machines, AI behavior, game flow, and UI states.
 *
 * @example
 * ```typescript
 * interface EnemyCtx { health: number; playerDistance: number; }
 *
 * const fsm = new StateMachine2D<EnemyCtx>({ health: 100, playerDistance: 999 });
 *
 * fsm.addState({
 *     name: "idle",
 *     onEnter: (ctx) => console.log("Enemy idling"),
 *     onUpdate: (ctx, dt) => { /* patrol logic *\/ },
 * });
 *
 * fsm.addState({
 *     name: "chase",
 *     onUpdate: (ctx, dt) => { /* move toward player *\/ },
 * });
 *
 * fsm.addTransition({ from: "idle", to: "chase", condition: (ctx) => ctx.playerDistance < 100 });
 * fsm.addTransition({ from: "chase", to: "idle", condition: (ctx) => ctx.playerDistance > 200 });
 *
 * fsm.start("idle");
 * // In game loop: fsm.update(dt);
 * ```
 */
export class StateMachine2D<TContext = any> {
    /**
     * Observable triggered when the state changes
     */
    public readonly onStateChange: Observable<IStateChangeEvent> = new Observable<IStateChangeEvent>();

    private _states: Map<string, IState2D<TContext>> = new Map();
    private _transitions: ITransition2D<TContext>[] = [];
    private _namedTransitions: Map<string, ITransition2D<TContext>> = new Map();
    private _currentState: IState2D<TContext> | null = null;
    private _currentStateName: string = "";
    private _context: TContext;
    private _isStarted: boolean = false;

    /**
     * Creates a new StateMachine2D
     * @param context - The shared context object accessible to all states and transitions
     */
    constructor(context: TContext) {
        this._context = context;
    }

    /**
     * The name of the current active state, or empty string if not started
     */
    public get currentState(): string {
        return this._currentStateName;
    }

    /**
     * Whether the state machine has been started
     */
    public get isStarted(): boolean {
        return this._isStarted;
    }

    /**
     * The shared context object
     */
    public get context(): TContext {
        return this._context;
    }

    /**
     * Registers a state with the state machine
     * @param state - The state definition to add
     * @returns This state machine for chaining
     */
    public addState(state: IState2D<TContext>): StateMachine2D<TContext> {
        if (this._states.has(state.name)) {
            throw new Error(`State "${state.name}" already exists`);
        }
        this._states.set(state.name, state);
        return this;
    }

    /**
     * Registers a transition between states
     * @param transition - The transition definition to add
     * @returns This state machine for chaining
     */
    public addTransition(transition: ITransition2D<TContext>): StateMachine2D<TContext> {
        if (!this._states.has(transition.from)) {
            throw new Error(`Source state "${transition.from}" not found`);
        }
        if (!this._states.has(transition.to)) {
            throw new Error(`Target state "${transition.to}" not found`);
        }
        this._transitions.push(transition);
        if (transition.name) {
            this._namedTransitions.set(transition.name, transition);
        }
        return this;
    }

    /**
     * Starts the state machine in the given initial state
     * @param initialState - The name of the state to start in
     */
    public start(initialState: string): void {
        const state = this._states.get(initialState);
        if (!state) {
            throw new Error(`State "${initialState}" not found`);
        }
        this._isStarted = true;
        this._currentState = state;
        this._currentStateName = initialState;
        state.onEnter?.(this._context, "");
    }

    /**
     * Updates the state machine. Evaluates automatic transitions and calls onUpdate
     * on the current state.
     * @param deltaTime - Time elapsed since last frame in seconds
     */
    public update(deltaTime: number): void {
        if (!this._isStarted || !this._currentState) {
            return;
        }

        // Evaluate auto-transitions (those with conditions)
        this._evaluateTransitions();

        // Update the current state
        this._currentState.onUpdate?.(this._context, deltaTime);
    }

    /**
     * Triggers a named transition. The transition fires only if its `from` state
     * matches the current state and its guard condition (if any) passes.
     * @param transitionName - The name of the transition to trigger
     * @returns True if the transition fired, false otherwise
     */
    public trigger(transitionName: string): boolean {
        if (!this._isStarted) {
            return false;
        }
        const transition = this._namedTransitions.get(transitionName);
        if (!transition) {
            return false;
        }
        if (transition.from !== this._currentStateName) {
            return false;
        }
        if (transition.condition && !transition.condition(this._context)) {
            return false;
        }
        this._transitionTo(transition.to);
        return true;
    }

    /**
     * Forces an immediate transition to the given state, bypassing guards.
     * Calls onExit on the current state and onEnter on the new state.
     * @param stateName - The state to transition to
     */
    public forceState(stateName: string): void {
        if (!this._states.has(stateName)) {
            throw new Error(`State "${stateName}" not found`);
        }
        if (!this._isStarted) {
            this.start(stateName);
            return;
        }
        this._transitionTo(stateName);
    }

    /**
     * Checks if a state with the given name has been registered
     * @param stateName - The state name to check
     * @returns True if the state exists
     */
    public hasState(stateName: string): boolean {
        return this._states.has(stateName);
    }

    /**
     * Removes all states, transitions, and resets the machine
     */
    public dispose(): void {
        this._states.clear();
        this._transitions.length = 0;
        this._namedTransitions.clear();
        this._currentState = null;
        this._currentStateName = "";
        this._isStarted = false;
        this.onStateChange.clear();
    }

    /**
     * Evaluates auto-transitions from the current state, sorted by priority
     */
    private _evaluateTransitions(): void {
        // Collect applicable transitions sorted by priority (descending)
        const applicable: ITransition2D<TContext>[] = [];
        for (const t of this._transitions) {
            if (t.from === this._currentStateName && t.condition) {
                applicable.push(t);
            }
        }
        applicable.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

        for (const t of applicable) {
            if (t.condition!(this._context)) {
                this._transitionTo(t.to);
                return; // Only one transition per update
            }
        }
    }

    /**
     * Performs the actual state transition
     */
    private _transitionTo(targetName: string): void {
        const target = this._states.get(targetName)!;
        const previousName = this._currentStateName;

        if (previousName === targetName) {
            return; // No-op for same state
        }

        this._currentState?.onExit?.(this._context, targetName);

        this._currentState = target;
        this._currentStateName = targetName;

        target.onEnter?.(this._context, previousName);

        this.onStateChange.notifyObservers({
            previousState: previousName,
            currentState: targetName,
        });
    }
}
