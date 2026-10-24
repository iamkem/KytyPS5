# Demon's Souls Distance Detail — safe engine-convar implementation (2026-10-24)

## Scope / user intent

Provide a separately selectable level of **far-scene detail** with minimal disruption to near-scene detail, without touching game files, save data, shader cache, precompile hints/seeds, asset mods, guest RAM, GPU allocations or Vulkan shader compiler. User selected implementation after inspecting existing `-Quality` and the emulator's missing real occlusion-query results.

This is a limited first-stage engine-console-variable control, **not** a true geometric distance-culling system, per-object LOD selection, occlusion culling or Variable Rate Shading. `r_forceViewportHeightForPixelSizeCalc` changes the engine's LOD heuristics; it may affect mid/near detail too. `sunShadowMaxDistance` is a sunlight-shadow cutoff, not a general 3D draw-distance cap. Do not claim proven FPS/1%-low improvement without a safe matched-scene runtime test.

## Modes (saved setting: `distance_detail`)

| Setting | Engine LOD viewport-height heuristic | Sunlight shadow max distance |
|---|---:|---:|
| `original` (default) | No override; respect Graphics Detail/engine | No override |
| `balanced` | `1080` | `200` |
| `performance` | `720` | `125` |
| `aggressive` | `480` | `60` |

Performance values match existing `-Quality low` engine convars; Aggressive match the LOD/shadow components of `-Quality lowest`. Balanced is an intermediate candidate not yet empirically validated. These numeric values are not measured GPU performance improvements.

### Precedence / interactions

- Graphics Presets (Ultra Performance / Performance / Balanced / Quality) continue to own actual 3D render resolution and base Graphics Detail. Distance Detail is separate and **retained when changing presets**.
- `quality=lowest` still disables `r_enableAmbientShadowing` and `r_enableSpotShadows` and sets `-TextureReduce 2`. Selecting Distance Detail does **not** turn those nearby shadow effects back on or implicitly raise texture quality; choose **Graphics Detail = Standard** plus **Distance Detail = Balanced/Performance** to keep original near-lighting settings.
- The Electron launcher passes `-Set KYTY_DISTANCE_DETAIL=<selected>`, including explicit `original` to clear a stale inherited/configured mode. The unchanged `run-windows.ps1` in the main checkout accepts the existing `-Set` syntax. There is no new PowerShell parameter or new runner version requirement.
- The native `Loader::GameArgs::ExtraLines()` appends `DistanceConvars` after all `KYTY_GAME_CONVARS` values, using existing name-based last-value-wins behavior. Other console variables (including frame timing, index-buffer culling, and the base Graphics Detail ambient/spot settings) are retained.
- Only `DemonsSouls::IsSupportedGame()` sees distance overrides. Invalid/unknown mode strings map to no extra convars; JS input also sanitizes unknown strings to `original`.
- **Existing special case**: `KYTY_GAME_CONVARS=0` returns before all injected game convars (including Distance Detail). This is an explicit global game-console-variable opt-out; no attempt is made to bypass it.
- Some original package command-line arguments can also contain these names. The native overlay is appended to the game's package file, so final engine adoption depends on its normal command-line processing. Gameplay validation remains needed.

## Files touched in integration worktree

- `launcher-electron/logic.cjs`: whitelist, default/round-trip, explicit mode export to native via `-Set`.
- `launcher-electron/options.html`, `options.js`, `style.css`: selector, profile summary, scrollable fixed-height Graphics tab, explanatory text.
- `src/loader/distanceDetail.h`: `constexpr` native mapping (testable without launching emulator).
- `src/loader/gameArgs.cpp`: add 2 known engine convars only in supported Demon’s Souls when native env mode selected.
- `tools/local/distance-detail-policy-test.cpp`: compile-time checks for all valid and invalid modes.
- `launcher-electron/tests/distance-detail.test.cjs`: fixtures for migration, settings, existing PowerShell runner dry run, native integration points and selector.
- `launcher-electron/README.md`: documented semantics, limitations and interactions.

`run-windows.ps1` in **both the main checkout and integration worktree remains unchanged**. All unrelated dirty main files remain untouched. Previous uncommitted RAM Safety/Stutter Guard fix and prior early-quota-stop pipeline optimization remain intact. No game or shader precompile is launched as part of this task.

## Verification outcomes — completed

- Full launcher/cache regression suite: **61 total, 55 PASS, 0 FAIL, 6 SKIP** (the 6 require real install/game in the integration worktree and were not forced).
- Distance Detail fixtures **4/4 PASS**, including `-Set` and `PowerShell -DryRun` with **a disposable copy of the actual main-checkout runner**. Real game/emulator were never opened.
- Compile-only Windows native policy test: `clang-cl /std:c++20 /Zs /Isrc tools/local/distance-detail-policy-test.cpp` **PASS**. No unit EXE or game launched.
- Native CMake/Ninja build into only `_Build/latest/native-build/kyty_emulator.exe`: **PASS** (final EXE dated 2026-10-24 08:36); CMake regenerated and compiled extra third-party dependencies, but all completed, no game/shader precompile. Preexisting non-fatal warnings occurred.
- Electron packaged into only `_Build/latest/launcher/DemonsSoulsLauncher-win32-x64/`: **PASS**, EXE dated 2026-10-24 08:36; packaged ASAR contains `KYTY_DISTANCE_DETAIL` and the new select control.
- `git diff --check`: **PASS**. `run-windows.ps1` tracked diff is empty; saved main `launcher-settings.json` remains `ram_safety=false`, `ram_diet=true`, `ram16_backing=true`. Main checkout dirty files preserved.
- Independent read-only Codex review found stale inherited-mode risk; fixed by passing explicit `original`. UI reachability covered by CSS scroll; on-screen visual smoke and real gameplay remain unverified.

## Acceptance / caution

- Build, package and static tests have completed. Do not claim runtime frame-time / image quality / BSOD safety based on them.
- DryRun must use disposable copies of runner/config/game/exe; the real runner historically writes `game-path.txt` even in DryRun, so never run it against the real main checkout for fixture tests.
- Existing saved `launcher-settings.json` remains unchanged; `distance_detail` will default to `original` until user selects and saves another mode.
- Native compile and PowerShell DryRun validate code/arguments only, **not** that distant objects were rendered correctly or that memory, FPS, shader/pipeline stalls improved. With earlier near-exhausted physical RAM sessions and MEMORY_MANAGEMENT BSOD, do not run game or heavy shader precompile automatically.
- Recommended first user-controlled test when machine stable: Graphics Detail **Standard**, Distance Detail **Balanced**, record representative scene frame times and shadow/LOD appearance. Revert by selecting **Original** immediately if problematic; do not discard caches.
