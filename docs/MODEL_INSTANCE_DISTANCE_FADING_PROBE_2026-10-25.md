# Model / Instance Distance Fading — retired NO-GO (2026-10-25)

## Final runtime verdict — do not use these probes

User-tested PPSA01341 v1.07: **Combined caused severe geometry corruption**. The isolated **Model** and **Instance** probes showed **no observed FPS improvement**. This is sufficient to retire this experiment; no reason to keep exposing unsafe scene-level model fading. Following the test, the launcher option and native game-convar injection were removed. Old `model_fading` persisted settings are ignored; `KYTY_MODEL_FADING` is never read by the emulator. `src/loader/modelFading.h` remains only as a fail-closed stub; all modes return no convars. The earlier values documented below are **historical failed tests, NOT recommendations**. The successful no-visible-error Distance Tessellation Early Fade experiment is separate and unchanged; its FPS benefit remains unproven.

## Original experiment (historical, disabled)

## Evidence and scope

- On the installed **Demon's Souls PPSA01341 / 01.007.000**, `eboot.bin` contains the exact variable names `r_ModelFadeOutOverrideEnable` (string offset `0x24d5b31`), `r_ModelFadeOutStartOverride` (`0x2492a72`) and `r_fadeOutInstanceOverDistance` (`0x246dae9`).
- `coredata/enginesupport/debugmenu/debugrendermenudebug.txt` lines 78–89 list these under `LODsAndFading`, and specify steps `0.01` and `1.0` for the instance value. **This does not establish defaults, units, safe ranges, render cost or applicability to enemy/gameplay models.**
- No engine geometry patch, GPU draw suppression, gameplay/save modification, or shader cache update is implemented. These are opt-in **game console variables** placed in the existing virtual-read `PackageCmdLineArgs.txt` when the exact audited title/version is loaded.

## Launcher choices (all research-only)

| UI | Environment | Engine variables appended at boot |
| --- | --- | --- |
| **Original (default)** | `KYTY_MODEL_FADING=original` | None; no override of game defaults |
| Model probe | `KYTY_MODEL_FADING=model` | `r_ModelFadeOutOverrideEnable=true; r_ModelFadeOutStartOverride=100.0` |
| Instance probe | `KYTY_MODEL_FADING=instance` | `r_fadeOutInstanceOverDistance=0.75` |
| Combined | `KYTY_MODEL_FADING=combined` | Both sets above; **higher risk**, do not start here |

The numbers **100.0** and **0.75** are deliberately fixed exploratory values, *not validated stock defaults or tuned performance settings*. Do not label Model 100 as 100 metres or Instance 0.75 as 25% GPU load reduction. No evidence yet establishes which direction makes more objects fade earlier; these probes could have no effect or even increase work. If safe values cannot be confirmed, leave **Original** selected. The exact engine version is required, and `KYTY_GAME_CONVARS=0` suppresses the injection.

This setting persists independently of `distance_tessellation`, `distance_detail`, Display, DLSS/FSR, RAM Safety, file backing and shader cache settings. No automatic game launch or full precompile was performed. The previous **Distance Tessellation Early Fade** can stay selected; for isolated A/B measurements it is better to hold it constant throughout.

## Suggested manual test procedure (not executed by automation)

1. Keep a fixed save, camera angle, map and graphics settings. Set **Original** first, note object detail and FPS/1% low/frametime (prefer several reproducible passes).
2. Try **Model** on its own, fully restart the game to load the boot convars. Confirm the `Model/Instance distance fading: EXPERIMENTAL model` log, then compare *the same scene*. A log proves the vars were added, not that visibility changed.
3. Return to Original, restart, then try **Instance** alone and repeat. Only consider Combined if both isolated modes preserve needed geometry; do **not** infer visual safety from a short smoke test.
4. Stop and revert to **Original** if enemies, bridges, doors, collision cues, distant landmarks or traversal objects pop or disappear. Verify movement, NPCs and combat at multiple camera angles, not just idle screenshots.
5. Compare draw packet counts / CPU or GPU frametime only when captured by the same instrumentation. If no supported effect or a regression is observed, retire the probes from release presets. **Do not turn on by default.**

## Verification

`launcher-electron/tests/model-fading.test.cjs` validates setting migration, strict enum, preset independence, PowerShell `-Set` wiring and source gating without running the emulator.
`tools/local/model-fading-policy-test.cpp` uses compile-time assertions for the exact mode values and rejected variants. Full launcher regression suite, native Windows build (with Streamline configured), separate Electron packaging and Git cleanliness must pass before delivery.
