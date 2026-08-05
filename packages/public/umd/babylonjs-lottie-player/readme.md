# Babylon.js Lottie Player

> For module-based applications, prefer the [`@babylonjs/lottie-player`](https://www.npmjs.com/package/@babylonjs/lottie-player) package.

This package provides the classic single-file UMD/global build of the Babylon.js Lottie `EnginePlayer`. It is intended for script hosts such as Babylon Native that do not provide an ES module loader.

## Browser or Babylon Native script usage

Load Babylon.js first, then this bundle:

```html
<script src="babylon.max.js"></script>
<script src="babylon.lottiePlayer.js"></script>
```

The API is exposed as `BABYLON.LottiePlayer.EnginePlayer`:

```js
var engine = new BABYLON.NativeEngine();
var player = new BABYLON.LottiePlayer.EnginePlayer(engine);

player.playAnimationAsync({
    animationSource: animationJson,
    variables: null,
    configuration: { loopAnimation: true },
});
```

The bundle externalizes Babylon.js core to the existing `BABYLON` global and inlines the optional Lottie text and image renderer chunks, so no runtime `import()` support is required.

## Babylon Native

Use the same version of `babylonjs` and `babylonjs-lottie-player`. Babylon Native's Chakra host requires both UMD files to be downleveled to ES5 before they are packaged with the application. From the Babylon Native `Apps` directory:

```powershell
npm install babylonjs@latest babylonjs-lottie-player@latest
npm run downlevel:native-scripts -- node_modules/babylonjs/babylon.max.js node_modules/babylonjs-lottie-player/babylon.lottiePlayer.js
```

Package both scripts as application assets, then load the Lottie bundle immediately after core:

```cpp
runtime.LoadScript("app:///Scripts/babylon.max.js");
runtime.LoadScript("app:///Scripts/babylon.lottiePlayer.js");
```

When `babylonjs-lottie-player` is installed under Babylon Native's `Apps/node_modules`, configuring and building the Playground copies the bundle and `lottie_player_smoke.js` into its `Scripts` directory. The smoke renders shape and text layers and validates the framebuffer. From the built Playground directory, run:

```powershell
Playground.exe --headless -- Scripts/babylon.lottiePlayer.js Scripts/lottie_player_smoke.js
```

A successful run prints `LOTTIE_NATIVE_SMOKE_PASSED` and exits with code 0.
