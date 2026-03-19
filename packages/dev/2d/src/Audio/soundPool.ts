import { Sound } from "core/Audio/sound";
import type { ISoundOptions } from "core/Audio/Interfaces/ISoundOptions";
import { AbstractEngine } from "core/Engines/abstractEngine";
import { EngineStore } from "core/Engines/engineStore";
import { Vector3 } from "core/Maths/math.vector";
import type { Scene } from "core/scene";

/**
 * Spatial audio configuration shared across all pooled instances.
 */
export interface ISpatialAudioOptions {
    /**
     * Maximum audible distance in pixels.
     * Beyond this distance, the sound is silent.
     */
    maxDistance?: number;
    /**
     * Reference distance for attenuation calculation in pixels.
     */
    refDistance?: number;
    /**
     * Rolloff factor. Higher values drop volume faster.
     */
    rolloffFactor?: number;
    /**
     * Panning model used by the Web Audio panner node.
     */
    panningModel?: "HRTF" | "equalpower";
}

/**
 * Configuration for a pooled sound.
 */
export interface ISoundPoolConfig {
    /** URL of the audio asset. */
    url: string;
    /** Maximum concurrent instances. Default: 4. */
    maxInstances?: number;
    /** Overflow behavior when all instances are active. Default: "reject". */
    overflow?: "reject" | "stopOldest" | "stopQuietest";
    /** Spatial audio options applied to pooled instances. */
    spatial?: ISpatialAudioOptions;
}

interface ISoundPoolEntry {
    sound: Sound;
    hasPosition: boolean;
    lastX: number;
    lastY: number;
    playOrder: number;
}

const _sharedPosition = new Vector3(0, 0, 0);

function _clamp01(value: number): number {
    if (value <= 0) {
        return 0;
    }
    if (value >= 1) {
        return 1;
    }
    return value;
}

function _getAudioSceneOrThrow(engine: AbstractEngine): Scene {
    const scene = EngineStore.LastCreatedScene;
    if (!scene || scene.getEngine() !== engine) {
        throw new Error("SoundPool requires an active Babylon.js Scene associated with the provided engine.");
    }
    return scene;
}

function _createSoundAsync(name: string, url: string, engine: AbstractEngine, options: ISoundOptions): Promise<Sound> {
    const scene = _getAudioSceneOrThrow(engine);

    return new Promise<Sound>((resolve) => {
        let sound: Sound;
        sound = new Sound(name, url, scene, () => {
            resolve(sound);
        }, options);
    });
}

/**
 * A pool of Sound instances for a single audio asset.
 * Prevents audio spam by limiting concurrent plays.
 */
export class SoundPool {
    private _pool: ISoundPoolEntry[];
    private _maxInstances: number;
    private _overflow: "reject" | "stopOldest" | "stopQuietest";
    private _spatialOptions: ISpatialAudioOptions | null;
    private _playCounter: number = 0;
    private _isDisposed: boolean = false;

    private constructor(pool: ISoundPoolEntry[], maxInstances: number, overflow: "reject" | "stopOldest" | "stopQuietest", spatialOptions: ISpatialAudioOptions | null) {
        this._pool = pool;
        this._maxInstances = maxInstances;
        this._overflow = overflow;
        this._spatialOptions = spatialOptions;
    }

    /**
     * Number of currently playing instances.
     * @returns The number of active sounds.
     */
    public get activeCount(): number {
        let count = 0;
        for (let i = 0; i < this._pool.length; i++) {
            if (this._pool[i].sound.isPlaying) {
                count++;
            }
        }
        return count;
    }

    /**
     * Maximum concurrent instances.
     * @returns The pool capacity.
     */
    public get maxInstances(): number {
        return this._maxInstances;
    }

    /**
     * Creates a SoundPool and loads its pooled Sound instances.
     * @param engine - The Babylon.js engine.
     * @param config - Pool configuration.
     * @returns A loaded SoundPool.
     */
    public static async createAsync(engine: AbstractEngine, config: ISoundPoolConfig): Promise<SoundPool> {
        const maxInstances = Math.max(1, Math.floor(config.maxInstances ?? 4));
        const overflow = config.overflow ?? "reject";
        const pooledSounds = await Promise.all(
            Array.from({ length: maxInstances }, (_, index) => {
                const options: ISoundOptions = {
                    autoplay: false,
                    loop: false,
                    volume: 1,
                    spatialSound: false,
                };
                return _createSoundAsync(`soundPool:${index}`, config.url, engine, options);
            })
        );

        const pool: ISoundPoolEntry[] = pooledSounds.map((sound) => ({
            sound,
            hasPosition: false,
            lastX: 0,
            lastY: 0,
            playOrder: 0,
        }));

        return new SoundPool(pool, maxInstances, overflow, config.spatial ?? null);
    }

    /**
     * Plays one pooled instance.
     * If the pool is at capacity, applies the configured overflow strategy.
     * @param position - 2D world position for spatial playback, or null for non-spatial playback.
     * @param volumeOverride - Optional per-play volume override in the range [0..1].
     * @returns The Sound used for playback, or null if the request was rejected.
     */
    public play(position?: { x: number; y: number } | null, volumeOverride?: number): Sound | null {
        if (this._isDisposed) {
            return null;
        }

        let entry: ISoundPoolEntry | null = this._findAvailableEntry();
        if (!entry) {
            entry = this._resolveOverflowEntry();
            if (!entry) {
                return null;
            }
            entry.sound.stop();
        }

        if (position !== null && position !== undefined) {
            this._applySpatialOptions(entry.sound, true);
            entry.lastX = position.x;
            entry.lastY = position.y;
            entry.hasPosition = true;
            SoundPool._setSoundPosition(entry.sound, position.x, position.y);
        } else {
            this._applySpatialOptions(entry.sound, false);
            entry.hasPosition = false;
        }

        entry.sound.setVolume(_clamp01(volumeOverride ?? 1));
        entry.playOrder = ++this._playCounter;
        entry.sound.play();

        return entry.sound;
    }

    /**
     * Stops all currently playing instances.
     * @returns Nothing.
     */
    public stopAll(): void {
        for (let i = 0; i < this._pool.length; i++) {
            if (this._pool[i].sound.isPlaying || this._pool[i].sound.isPaused) {
                this._pool[i].sound.stop();
            }
        }
    }

    /**
     * Disposes all pooled sounds and releases their resources.
     * @returns Nothing.
     */
    public dispose(): void {
        if (this._isDisposed) {
            return;
        }

        for (let i = 0; i < this._pool.length; i++) {
            this._pool[i].sound.dispose();
        }
        this._pool.length = 0;
        this._isDisposed = true;
    }

    /**
     * Sets a sound position without allocating a new Vector3.
     * @param sound - The sound to update.
     * @param x - World X position.
     * @param y - World Y position.
     * @returns Nothing.
     */
    private static _setSoundPosition(sound: Sound, x: number, y: number): void {
        _sharedPosition.x = x;
        _sharedPosition.y = y;
        _sharedPosition.z = 0;
        sound.setPosition(_sharedPosition);
    }

    private _findAvailableEntry(): ISoundPoolEntry | null {
        for (let i = 0; i < this._pool.length; i++) {
            const entry = this._pool[i];
            if (!entry.sound.isPlaying) {
                return entry;
            }
        }
        return null;
    }

    private _resolveOverflowEntry(): ISoundPoolEntry | null {
        if (this._overflow === "reject") {
            return null;
        }

        if (this._overflow === "stopQuietest") {
            return this._findQuietestPlayingEntry();
        }

        return this._findOldestPlayingEntry();
    }

    private _findOldestPlayingEntry(): ISoundPoolEntry | null {
        let oldest: ISoundPoolEntry | null = null;
        for (let i = 0; i < this._pool.length; i++) {
            const entry = this._pool[i];
            if (!entry.sound.isPlaying) {
                continue;
            }
            if (!oldest || entry.playOrder < oldest.playOrder) {
                oldest = entry;
            }
        }
        return oldest;
    }

    private _findQuietestPlayingEntry(): ISoundPoolEntry | null {
        let quietest: ISoundPoolEntry | null = null;
        let quietestVolume = Number.POSITIVE_INFINITY;

        for (let i = 0; i < this._pool.length; i++) {
            const entry = this._pool[i];
            if (!entry.sound.isPlaying) {
                continue;
            }

            const effectiveVolume = this._getEffectiveVolume(entry);
            if (effectiveVolume < quietestVolume) {
                quietestVolume = effectiveVolume;
                quietest = entry;
            }
        }

        return quietest;
    }

    private _getEffectiveVolume(entry: ISoundPoolEntry): number {
        const baseVolume = entry.sound.getVolume();
        if (!entry.hasPosition) {
            return baseVolume;
        }

        const listener = this._getListenerPosition();
        if (!listener) {
            return baseVolume;
        }

        const dx = entry.lastX - listener.x;
        const dy = entry.lastY - listener.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const refDistance = this._spatialOptions?.refDistance ?? entry.sound.refDistance;
        const maxDistance = this._spatialOptions?.maxDistance ?? entry.sound.maxDistance;
        const rolloffFactor = this._spatialOptions?.rolloffFactor ?? entry.sound.rolloffFactor;

        if (distance <= refDistance || rolloffFactor <= 0) {
            return baseVolume;
        }
        if (distance >= maxDistance) {
            return 0;
        }

        const attenuation = refDistance / (refDistance + rolloffFactor * (distance - refDistance));
        return baseVolume * attenuation;
    }

    private _getListenerPosition(): { x: number; y: number } | null {
        const audioContext = AbstractEngine.audioEngine?.audioContext;
        const listener = audioContext?.listener;
        if (!listener || listener.positionX === undefined || listener.positionY === undefined) {
            return null;
        }

        return {
            x: listener.positionX.value,
            y: listener.positionY.value,
        };
    }

    private _applySpatialOptions(sound: Sound, spatialPlayback: boolean): void {
        const options: ISoundOptions = {
            spatialSound: spatialPlayback,
        };

        if (spatialPlayback) {
            options.maxDistance = this._spatialOptions?.maxDistance;
            options.refDistance = this._spatialOptions?.refDistance;
            options.rolloffFactor = this._spatialOptions?.rolloffFactor;
        }

        sound.updateOptions(options);

        if (!spatialPlayback) {
            return;
        }

        if (this._spatialOptions?.panningModel === "HRTF") {
            sound.switchPanningModelToHRTF();
        } else {
            sound.switchPanningModelToEqualPower();
        }
    }
}
