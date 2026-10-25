# Distance Tessellation (experimental) — Demon's Souls v1.07, 2026-10-25

## Goal and evidence

Read-only inspection of the installed **PPSA01341 v1.07** `eboot.bin` (SHA-256 `fba2d6341abf74f032cde774df9bfee2f3afcf32402b20938add42d352914295`) confirms the `r_tessellationFadeOutStart` option exists. The game's shipped `misc/renderconfig_ps5_perf.txt` uses:

- `r_tessellationDensity=8.0`
- `r_tessellationFadeOutStart=12.0`
- `r_tessellationFadeOutRange=3.0`
- `r_tessellationMaxRecursions=7`
- `r_tessellationSmallestEdgeLength=0.04`

Shipped **High** uses fade start 15, **Trinity** 13. The value's world-unit semantics and actual runtime GPU workload have **not been proven**. This is a limited research toggle, not validated distant-object culling, not an FPS claim and not a geometry visibility grant.

## Implementation

- Launcher `Graphics → Distance Tessellation (Experimental)`: **Original (OFF)** by default, **Early Fade (12 → 10)** opt-in. `distance_tessellation` is independent of Distance Detail, Graphics Detail, DLSS model, RAM Safety, RAM Diet, RAM16 backing and presets. Launcher explicitly sends `KYTY_DISTANCE_TESSELLATION=original|early` via the existing `-Set` runner mechanism to clear inherited options.
- `src/loader/distanceTessellation.h`: only `PPSA01341` / `01.007.000` is admitted; the rewrite requires exactly one exact `+r_tessellationFadeOutStart=12.0` source line. Duplicated/missing/modified lines fail closed, and surrounding bytes/newline style are unchanged. Only that line changes; density, fade range, shadow settings, all other file entries remain unchanged.
- `src/loader/gameArgs.cpp`: uses the existing **read-only virtual file-redirection** of the game's `renderconfig_ps5_perf.txt`. Under active DLSS/FSR3 game super-resolution it retains the original `r_Wants4K=WantsTrinity` rewrite, then conditionally changes fade start. Without game super-resolution, Early Fade can intercept the *Performance* profile if the game requests it, **without** modifying `r_Wants4K`. If the game uses another profile or no supported profile is loaded, no effect occurs. `KYTY_GAME_CONVARS=0` also disables this optional experiment. Logs identify whether the exact override was applied.
- No `eboot.bin`, game `misc/renderconfig_...`, mods, save data, shader cache, or launcher settings are edited as part of implementation/testing.

## Validation

- Compile-time C++ assertions in `tools/local/distance-tessellation-policy-test.cpp` cover title/version gate, Original, Early, injection bytes, CRLF preservation, modified/missing/duplicate rejection.
- Node regression suite in `launcher-electron/tests/distance-tessellation.test.cjs` covers JSON migration, preset separation, runner `-Set`, and native source contract.
- Native Windows build in the *isolated worktree* and full launcher test suite must pass before committing.

## Runtime admission (not executed automatically)

User-controlled A/B comparison only: fixed scene and camera, unchanged resolution/graphics, original vs Early Fade. Verify actual `Game args: ... tessellation fade start 10.0 (experimental)` log message, **plus** capture matched frametime/1% lows and screenshots around comparable world geometry. A launch log proves file substitution, not geometry workload reduction. Check for popping/missing geometry and shadow/reflection errors. Restore **Original** immediately if behavior worsens. Avoid automatic game launch, shader precompile or cache deletion due to prior Windows MEMORY_MANAGEMENT BSOD.
