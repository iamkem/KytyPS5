# KytyPS5 — Shader Translation Mode in the Windows Launcher (2026-10-26)

## What has been delivered

The **existing** Electron launcher now exposes **Options → Graphics → Shader Translation Mode**:

- **Standard (0x0)** (default for existing installations): regular `_PipelineCache`, current gameplay path.
- **Experimental (0x3)**: separate `_Build/shader-feature-trial/_PipelineCache`, Cooperative Halves (0x1) and Table Slots At Use (0x2).

The selected mode persists to `launcher-settings.json` as `shader_mode` with only `standard` and `experimental` permitted. Invalid or missing values revert to Standard; graphics presets and memory/graphics parameters never alter the shader mode.

**The latest compiled trial cache is already present** for PPSA01341 01.007.000: `3 3 e83d291c179fb692`, marker `KytyShaderFeatureTrial1 3`, binaries 6,729,442,428 bytes (~6.27 GiB), and the native emulator reports support for the trial handshake. Precompile **not needed again**.

## Safety / rollback

Selecting Experimental does NOT move, rewrite, delete or promote any pipeline caches.

The Launcher performs inexpensive **read-only preflight** of:
- Game title/version exactly PPSA01341 / 01.007.000.
- A dedicated directory path with no symlink/junction in its trial-root components.
- `trial-ready` exact marker, first and attempted feature bits both `3`, and a plausible `.binaries` file.
- No pending `.resume-required` marker.
- Exact `--shader-feature-trial-capabilities` handshake from the executable that will be launched.

If Experimental is not ready at Play, a modal offers **Use Standard & Play** or **Cancel**, defaulting to **Cancel**. Choosing Standard updates settings and launches the standard command; choosing Cancel leaves settings and caches unchanged. Experimental Play passes the **PowerShell switch** `-ShaderFeatureTrial`; Standard Play never passes it and never forces the environment flag.

Native Kyty is the definitive second gate: checks Release build, GPU/driver-signature matching store, effective shader feature mask, and all stored pipeline binary payload checksums before game execution. **Launcher preflight is not a substitute for native integrity or shader correctness.**

In Options, **Restore Standard** changes local state; press **OK** to save. Cancel restores the opening settings. A nonzero Experimental process exit is shown on the main menu with directions to restore Standard; the Launcher does **not** automatically retry gameplay after an unexpected crash.

**Update Missing Shaders remains Standard-only**, and is disabled through UI + IPC if Experimental is selected. The Advanced tab labels this button Standard-only. It does not build or change Experimental cache. Cache Manager generation switch is not used for this mode.

Caveats: neither shader mode switches game save data nor isolates every driver-managed cache. Save data should be backed up before gameplay A/B. Shader `0x3` FPS or visual-equivalence improvement has NOT yet been measured against Standard.

## How to use it

1. Start the existing launcher using `C:\Users\hoang\Desktop\dev\KytyPS5\launcher.cmd`.
2. Open **Options → Graphics**; change **Shader Translation Mode** to **Experimental (0x3)**.
3. Check the status line showing `0x3 cache ready`; choose **OK**.
4. Use **Play**. Expect native validation of the ~6.27 GiB store before initial game launch.
5. For rollback, return to **Options → Graphics → Restore Standard → OK → Play**. The cache remains available for repeat A/B.

No separate desktop launcher is introduced. The packaged executable is
`_Build/latest/launcher/DemonsSoulsLauncher-win32-x64/DemonsSoulsLauncher.exe`.

## Tests / packaging

- CLI policy / settings / shader trial / launcher / distance-detail tests: `node --test launcher-electron/tests/shader-mode-launcher.test.cjs launcher-electron/tests/shader-feature-trial.test.cjs launcher-electron/tests/launcher.test.cjs launcher-electron/tests/distance-detail.test.cjs launcher-electron/tests/distance-tessellation.test.cjs` — **25/25 PASS**.
- JS parse: `node --check` for `main.cjs`, `logic.cjs`, `options.js`, `shader-trial.cjs`, `start.js` — PASS.
- Read-only real cache inspection: `ready: true`, game/version and binary size match.
- Packaged with `launcher-electron/scripts/package-latest.ps1`; packaging successful.
- Native packaged Electron GUI smoke `--smoke-ui` — **ELECTRON_UI_SMOKE_PASS, exit 0**, including `ELECTRON_SHADER_MODE_UI_PASS`, `ELECTRON_SHADER_MODE_ROLLBACK_UI_PASS`, cache input/UI, mod inspection, Options Cancel rollback. One optional main screenshot failed with `UnknownVizError`; smoke checks and final exit still passed. No gameplay, no shader precompile and no GPU A/B were executed.

## Implementation

`launcher-electron/shader-trial.cjs`, `launcher-electron/logic.cjs`, `launcher-electron/main.cjs`, `launcher-electron/preload.cjs`, `launcher-electron/options.html`, `launcher-electron/options.js`, `launcher-electron/start.js`, `launcher-electron/style.css`, `launcher-electron/tests/shader-mode-launcher.test.cjs`.

The earlier native implementation is in commit `4592302c`. The original cache and all unrelated untracked user files were not touched.
