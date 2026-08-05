import { commonUMDRollupConfiguration } from "../../rollupUMDHelper.mjs";
import path from "path";

const mode = process.env.ROLLUP_MODE === "production" ? "production" : "development";
const devMode = process.env.ROLLUP_DEVMODE === "true";

export default commonUMDRollupConfiguration({
    mode,
    devMode,
    devPackageName: "lottie-player",
    namespace: "BABYLON.LottiePlayer",
    outputPath: path.resolve("."),
    entryPoints: {
        lottiePlayer: "./src/index.ts",
    },
    alias: {
        "lottie-player": path.resolve("../../../dev/lottiePlayer/src"),
    },
    overrideFilename: `babylon.lottiePlayer${mode === "production" ? ".min" : ""}.js`,
    minToMax: true,
});
