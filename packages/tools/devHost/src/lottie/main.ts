import { type AnimationConfiguration, type LottieCompatibilityMode, type LottieCompatibilityOptions } from "lottie-player/animationConfiguration";
import { type RawLottieAnimation } from "lottie-player/parsing/rawTypes";
import { type LocalPlayer } from "lottie-player/local";
import { type Player } from "lottie-player/worker";
import { DecodeQspStringToObject } from "./utils";

type LottieEntryMode = "deep" | "local" | "root" | "worker";

function ParseEntryMode(value: string | null): LottieEntryMode {
    return value === "local" || value === "root" || value === "worker" ? value : "deep";
}

async function CreateWorkerPlayer(entryMode: LottieEntryMode): Promise<Player> {
    switch (entryMode) {
        case "root":
            return new (await import("lottie-player")).Player();
        case "worker":
            return new (await import("lottie-player/worker")).Player();
        case "local":
            throw new Error("The lottie local entry cannot create a worker player.");
        case "deep":
            return new (await import("lottie-player/player")).Player();
    }
}

async function CreateLocalPlayer(entryMode: LottieEntryMode): Promise<LocalPlayer> {
    switch (entryMode) {
        case "root":
            return new (await import("lottie-player")).LocalPlayer();
        case "local":
            return new (await import("lottie-player/local")).LocalPlayer();
        case "worker":
            throw new Error("The lottie worker entry cannot create a local player.");
        case "deep":
            return new (await import("lottie-player/localPlayer")).LocalPlayer();
    }
}

function ParseCompatibilityMode(value: string | null): LottieCompatibilityMode | undefined {
    return value === "spec" || value === "babylon8" ? value : undefined;
}

function GetCompatibilityOptions(searchParams: URLSearchParams): LottieCompatibilityOptions | undefined {
    const textLayerPlacement = ParseCompatibilityMode(searchParams.get("textlayerplacement"));
    const solidLayerRendering = ParseCompatibilityMode(searchParams.get("solidlayerrendering"));

    if (textLayerPlacement === undefined && solidLayerRendering === undefined) {
        return undefined;
    }

    return {
        ...(textLayerPlacement !== undefined ? { textLayerPlacement } : {}),
        ...(solidLayerRendering !== undefined ? { solidLayerRendering } : {}),
    };
}

/**
 * Main entry point for the default scene for lottie-player
 * @param searchParams URL QSPs where the Keys have been lowercased to avoid any casing problems. Values are unmodified.
 */
export async function Main(searchParams: URLSearchParams): Promise<void> {
    const div = document.getElementById("main-div") as HTMLDivElement; // The player will be inside this div
    div.style = "justify-content: center; align-items: center;"; // We want the animation centered

    // You can also pass a local file that you are serving from the devhost public folder to test: const fileUrl = './myLottieFile.json'
    // You can also pass a local file that you are serving from the devhost public folder to test: ?file=./lottie/myLottieFile.json
    const filename = searchParams.get("file") || "triangles_noParents_noCross.json";
    const fileUrl = filename.startsWith("./") || filename.startsWith("http") ? filename : `https://assets.babylonjs.com/lottie/${filename}`;

    // Whether to use a web worker for rendering or not, defaults to true
    const useWorkerParam = searchParams.get("useworker");
    const useWorker = useWorkerParam !== "false"; // Default to true if not specified

    const entryMode = ParseEntryMode(searchParams.get("entry"));

    // Whether to use the file URL for the data or to parse the data in the devhost, defaults to true (use the file URL)
    const useUrlParam = searchParams.get("useurl");
    const useUrl = useUrlParam !== "false"; // Default to true if not specified

    // Whether to use the file URL for the data or to parse the data in the devhost, defaults to true (use the file URL)
    const usePreWarmParam = searchParams.get("useprewarm");
    const usePrewarm = usePreWarmParam === "true"; // Default to false if not specified

    // Optional frame number to render a single frame without starting playback (useful for visual testing animations)
    const frameParam = searchParams.get("frame");
    const parsedFrame = frameParam !== null ? parseInt(frameParam, 10) : NaN;
    const stopAtFrame = Number.isFinite(parsedFrame) && parsedFrame >= 0 ? parsedFrame : undefined;

    // Whether variables are present in the URL to be used for the animation
    const urlVariables = searchParams.get("variables");
    const variables = new Map<string, string>();
    if (urlVariables) {
        const parsedVariables = DecodeQspStringToObject(urlVariables);
        for (const [key, value] of Object.entries(parsedVariables)) {
            variables.set(key, value);
        }
    }

    let animationData: RawLottieAnimation | undefined = undefined;
    if (!useUrl) {
        const data = await (await fetch(fileUrl)).text();
        animationData = JSON.parse(data) as RawLottieAnimation;
    }

    // Whether the parser should log unsupported lottie features to the console after parsing.
    // Defaults to true in devhost so issues with the loaded animation are visible without extra setup.
    const debugParam = searchParams.get("debug");
    const debug = debugParam !== "false";

    const compatibility = GetCompatibilityOptions(searchParams);

    // This is the configuration for the player, you can pass as much or as little as you want, the rest will be defaulted
    const configuration: Partial<AnimationConfiguration> = {
        backgroundColor: { r: 255 / 255, g: 255 / 255, b: 255 / 255, a: 1 }, // Background color for the animation canvas, visual tests use white
        stopAtFrame: stopAtFrame, // If set, the animation will stop at this frame (used by visual tests)
        debug: debug, // Log unsupported lottie features after parsing
        ...(compatibility !== undefined ? { compatibility } : {}),
    };

    // Signal that the first frame has been rendered (used by visual tests for deterministic screenshots)
    const onFirstRender = () => {
        if (!document.getElementById("lottie-ready")) {
            const readyIndicator = document.createElement("div");
            readyIndicator.id = "lottie-ready";
            readyIndicator.style.width = "1px";
            readyIndicator.style.height = "1px";
            document.body.appendChild(readyIndicator);
        }
    };

    // Create the player and play the animation
    const animationInput = { container: div, animationSource: useUrl ? fileUrl : (animationData as RawLottieAnimation), variables, configuration, onFirstRender };

    if (useWorker) {
        const player = await CreateWorkerPlayer(entryMode);

        if (usePrewarm) {
            await player.preWarmPlayerAsync();
        }

        await player.playAnimationAsync(animationInput);
    } else {
        const player = await CreateLocalPlayer(entryMode);
        await player.playAnimationAsync(animationInput);
    }
}
