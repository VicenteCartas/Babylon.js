import { Sound } from "core/Audio/sound";
import type { ISoundOptions } from "core/Audio/Interfaces/ISoundOptions";
import type { AbstractEngine } from "core/Engines/abstractEngine";
import { EngineStore } from "core/Engines/engineStore";
import type { Scene } from "core/scene";

import { Easing } from "../Tween/easing";
import { Tween } from "../Tween/tween";

/**
 * Configuration used when loading a music track.
 */
export interface IMusicTrackOptions {
    /** URL of the music file. */
    url: string;
    /** Playback volume in the range [0..1]. Default: 1. */
    volume?: number;
    /** Whether the track should loop. Default: true. */
    loop?: boolean;
}

interface ILoadedMusicTrack {
    name: string;
    sound: Sound;
    volume: number;
    fadeFactor: number;
}

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
        throw new Error("MusicManager2D requires an active Babylon.js Scene associated with the provided engine.");
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
 * Manages background music playback with optional crossfading between tracks.
 */
export class MusicManager2D {
    private _engine: AbstractEngine;
    private _tracks: Map<string, ILoadedMusicTrack> = new Map();
    private _currentTrackName: string | null = null;
    private _masterVolume: number = 1;
    private _fadeInTween: Tween | null = null;
    private _fadeOutTween: Tween | null = null;
    private _crossfadeFrom: ILoadedMusicTrack | null = null;
    private _crossfadeTo: ILoadedMusicTrack | null = null;
    private _crossfadeCompleteCallback: (() => void) | null = null;
    private _isCrossfading: boolean = false;

    /**
     * Creates a new music manager.
     * @param engine - The Babylon.js engine.
     */
    constructor(engine: AbstractEngine) {
        this._engine = engine;
    }

    /**
     * Currently playing track name.
     * @returns The current track name, or null when nothing is playing.
     */
    public get currentTrack(): string | null {
        return this._currentTrackName;
    }

    /**
     * Whether a crossfade is currently in progress.
     * @returns True when crossfading.
     */
    public get isCrossfading(): boolean {
        return this._isCrossfading;
    }

    /**
     * Master volume multiplier in the range [0..1].
     * @returns The master volume.
     */
    public get masterVolume(): number {
        return this._masterVolume;
    }

    /**
     * Sets the master volume multiplier.
     * @param value - The new master volume.
     */
    public set masterVolume(value: number) {
        this._masterVolume = _clamp01(value);
        this._applyVolumes();
    }

    /**
     * Loads a music track into memory without playing it.
     * @param name - Unique track identifier.
     * @param options - Track loading options.
     * @returns A promise that resolves when the track is ready.
     */
    public async loadTrackAsync(name: string, options: IMusicTrackOptions): Promise<void> {
        if (this._tracks.has(name)) {
            throw new Error(`MusicManager2D track '${name}' is already loaded.`);
        }

        const soundOptions: ISoundOptions = {
            autoplay: false,
            loop: options.loop ?? true,
            volume: 0,
        };
        const sound = await _createSoundAsync(`music:${name}`, options.url, this._engine, soundOptions);

        this._tracks.set(name, {
            name,
            sound,
            volume: _clamp01(options.volume ?? 1),
            fadeFactor: 0,
        });
    }

    /**
     * Plays a loaded track immediately with no fade.
     * Stops any currently playing track.
     * @param trackName - Name of the track to play.
     * @returns Nothing.
     */
    public play(trackName: string): void {
        const track = this._getTrackOrThrow(trackName);
        this._cancelCrossfadeState(true);

        for (const loadedTrack of this._tracks.values()) {
            loadedTrack.fadeFactor = 0;
            if (loadedTrack.sound.isPlaying || loadedTrack.sound.isPaused) {
                loadedTrack.sound.stop();
            }
            this._applyTrackVolume(loadedTrack);
        }

        track.fadeFactor = 1;
        this._applyTrackVolume(track);
        track.sound.play();
        this._currentTrackName = track.name;
    }

    /**
     * Crossfades from the current track to a loaded target track.
     * @param trackName - Track to fade to.
     * @param duration - Crossfade duration in seconds.
     * @param onComplete - Callback invoked when the crossfade completes.
     * @returns Nothing.
     */
    public crossfadeTo(trackName: string, duration: number = 1, onComplete?: () => void): void {
        const targetTrack = this._getTrackOrThrow(trackName);
        if (duration <= 0) {
            this.play(trackName);
            onComplete?.();
            return;
        }

        this._cancelCrossfadeState(true);

        const fromTrack = this._currentTrackName ? this._tracks.get(this._currentTrackName) ?? null : null;
        if (fromTrack === targetTrack) {
            if (!targetTrack.sound.isPlaying) {
                targetTrack.sound.play();
            }
            targetTrack.fadeFactor = 1;
            this._applyTrackVolume(targetTrack);
            onComplete?.();
            return;
        }

        for (const track of this._tracks.values()) {
            if (track !== fromTrack && track !== targetTrack) {
                track.fadeFactor = 0;
                if (track.sound.isPlaying || track.sound.isPaused) {
                    track.sound.stop();
                }
                this._applyTrackVolume(track);
            }
        }

        this._isCrossfading = true;
        this._crossfadeFrom = fromTrack;
        this._crossfadeTo = targetTrack;
        this._crossfadeCompleteCallback = onComplete ?? null;
        this._currentTrackName = targetTrack.name;

        if (targetTrack.sound.isPlaying || targetTrack.sound.isPaused) {
            targetTrack.sound.stop();
        }
        targetTrack.fadeFactor = 0;
        this._applyTrackVolume(targetTrack);
        targetTrack.sound.play();

        this._fadeInTween = new Tween({ from: 0, to: 1 }, duration, Easing.Linear)
            .onUpdate((value) => {
                targetTrack.fadeFactor = value;
                this._applyTrackVolume(targetTrack);
            })
            .onComplete(() => {
                targetTrack.fadeFactor = 1;
                this._applyTrackVolume(targetTrack);
                this._fadeInTween = null;
                this._tryCompleteCrossfade();
            })
            .start();

        if (fromTrack) {
            const startFade = fromTrack.fadeFactor;
            this._fadeOutTween = new Tween({ from: startFade, to: 0 }, duration, Easing.Linear)
                .onUpdate((value) => {
                    fromTrack.fadeFactor = value;
                    this._applyTrackVolume(fromTrack);
                })
                .onComplete(() => {
                    fromTrack.fadeFactor = 0;
                    this._applyTrackVolume(fromTrack);
                    fromTrack.sound.stop();
                    this._fadeOutTween = null;
                    this._tryCompleteCrossfade();
                })
                .start();
        }
    }

    /**
     * Fades out and stops the current track.
     * @param duration - Fade duration in seconds.
     * @returns Nothing.
     */
    public stop(duration: number = 0.5): void {
        if (!this._currentTrackName) {
            return;
        }

        const currentTrack = this._tracks.get(this._currentTrackName);
        if (!currentTrack) {
            this._currentTrackName = null;
            return;
        }

        this._cancelCrossfadeState(true);
        this._stopAllTracksExcept(currentTrack);

        if (duration <= 0) {
            currentTrack.fadeFactor = 0;
            currentTrack.sound.stop();
            this._applyTrackVolume(currentTrack);
            this._currentTrackName = null;
            return;
        }

        this._fadeOutTween = new Tween({ from: currentTrack.fadeFactor, to: 0 }, duration, Easing.Linear)
            .onUpdate((value) => {
                currentTrack.fadeFactor = value;
                this._applyTrackVolume(currentTrack);
            })
            .onComplete(() => {
                currentTrack.fadeFactor = 0;
                currentTrack.sound.stop();
                this._applyTrackVolume(currentTrack);
                this._fadeOutTween = null;
                if (this._currentTrackName === currentTrack.name) {
                    this._currentTrackName = null;
                }
            })
            .start();
    }

    /**
     * Pauses the current track.
     * @returns Nothing.
     */
    public pause(): void {
        if (!this._currentTrackName) {
            return;
        }

        const currentTrack = this._tracks.get(this._currentTrackName);
        currentTrack?.sound.pause();
    }

    /**
     * Resumes a paused track.
     * @returns Nothing.
     */
    public resume(): void {
        if (!this._currentTrackName) {
            return;
        }

        const currentTrack = this._tracks.get(this._currentTrackName);
        if (!currentTrack) {
            return;
        }

        currentTrack.sound.play();
    }

    /**
     * Unloads a track and disposes its sound.
     * @param name - Track name to unload.
     * @returns Nothing.
     */
    public unloadTrack(name: string): void {
        const track = this._tracks.get(name);
        if (!track) {
            return;
        }

        if (this._currentTrackName === name || this._crossfadeFrom === track || this._crossfadeTo === track) {
            this._cancelCrossfadeState(true);
            this._stopAllTracksExcept(track);
            if (this._currentTrackName === name) {
                this._currentTrackName = null;
            }
        }

        if (track.sound.isPlaying || track.sound.isPaused) {
            track.sound.stop();
        }
        track.sound.dispose();
        this._tracks.delete(name);
    }

    /**
     * Advances any active fade tweens.
     * @param deltaTime - Time elapsed since the previous update, in seconds.
     * @returns Nothing.
     */
    public update(deltaTime: number): void {
        this._fadeInTween?.update(deltaTime);
        this._fadeOutTween?.update(deltaTime);
    }

    /**
     * Disposes all loaded tracks and clears internal state.
     * @returns Nothing.
     */
    public dispose(): void {
        this._cancelCrossfadeState(true);
        this._cancelFadeTweens();

        for (const track of this._tracks.values()) {
            track.sound.dispose();
        }

        this._tracks.clear();
        this._currentTrackName = null;
    }

    private _getTrackOrThrow(trackName: string): ILoadedMusicTrack {
        const track = this._tracks.get(trackName);
        if (!track) {
            throw new Error(`MusicManager2D track '${trackName}' is not loaded.`);
        }
        return track;
    }

    private _applyVolumes(): void {
        for (const track of this._tracks.values()) {
            this._applyTrackVolume(track);
        }
    }

    private _applyTrackVolume(track: ILoadedMusicTrack): void {
        track.sound.setVolume(_clamp01(track.volume * track.fadeFactor * this._masterVolume));
    }

    private _stopAllTracksExcept(trackToKeep: ILoadedMusicTrack | null): void {
        for (const track of this._tracks.values()) {
            if (track === trackToKeep) {
                continue;
            }

            track.fadeFactor = 0;
            if (track.sound.isPlaying || track.sound.isPaused) {
                track.sound.stop();
            }
            this._applyTrackVolume(track);
        }
    }

    private _cancelFadeTweens(): void {
        if (this._fadeInTween) {
            this._fadeInTween.stop();
            this._fadeInTween = null;
        }
        if (this._fadeOutTween) {
            this._fadeOutTween.stop();
            this._fadeOutTween = null;
        }
    }

    private _cancelCrossfadeState(stopSecondaryTracks: boolean = false): void {
        this._cancelFadeTweens();
        if (stopSecondaryTracks) {
            const currentTrack = this._currentTrackName ? this._tracks.get(this._currentTrackName) ?? null : null;
            this._stopAllTracksExcept(currentTrack);
        }
        this._isCrossfading = false;
        this._crossfadeFrom = null;
        this._crossfadeTo = null;
        this._crossfadeCompleteCallback = null;
    }

    private _tryCompleteCrossfade(): void {
        if (this._fadeInTween || this._fadeOutTween) {
            return;
        }

        this._isCrossfading = false;
        this._crossfadeFrom = null;
        this._crossfadeTo = null;

        const callback = this._crossfadeCompleteCallback;
        this._crossfadeCompleteCallback = null;
        callback?.();
    }
}
