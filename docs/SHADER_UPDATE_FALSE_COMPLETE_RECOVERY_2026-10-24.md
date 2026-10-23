# Shader Update: interrupted precompile falsely reported complete — recovery (2026-10-24)

## Observed failure on the user's real system

Source: `_Build/run-logs/launcher-shader-updates/shader-update-2026-10-23T14-46-13-365Z-10571d.log`. This user-run incremental precompile compiled **438 finished shards** while **601 remained waiting**. After the user pressed Stop, it finished in-flight work, merged completed shards into the 3.81 GiB static binary cache, and logged `update: stopped safely; previously completed shards merged`. Critically, the prior precompiler had stamped translator features and saved a success-like fingerprint during partial merge. That metadata did NOT mean all missing shaders were complete.

Five later launcher runs on 2026-10-23 / 2026-10-24 produced only `cache: VALID for current GPU/driver and shaders; nothing to precompile.` in about one second each, and `last-state.json` became `status=up-to-date, percent=100`. This is a confirmed **false-complete**, not a completed precompile.

## Safe immediate repair

A durable marker was added in the main player's checkout:

`_PipelineCache/static/PPSA01341_01.007.000.resume-required`

Its contents refer to the interrupted Oct-23 log. The existing binary cache and completed shards were left unchanged (binary size observed **3,996,646,607 bytes**); shader and game assets were not reset. On the **next user-invoked** Update Missing Shaders, `precompile-windows.ps1` sees the marker and **skips** the shortcut `--status` check; it merges existing saved shards, plans the still-missing work, and should compile only missing pipelines. It deletes the marker **only after successful completion**; on Stop/error the marker remains, exit code 130 signals stop without stamping a full complete.

The main checkout's `precompile-windows.ps1` was patched to support `-ForceResume`, even though its checked-in branch is still the v14 baseline, and to recheck Stop immediately before the final stamp. Do not overwrite the user's unrelated dirty source.

## Durable launcher fix (isolated integration branch)

`launcher-electron/shader-progress.cjs` now checks pending `*.resume-required` markers AND, for legacy sessions, the most recent **substantive** shader-update log:
- A stopped or stop-requested compile is **incomplete**, even if a previous version logged a `done in` partial merge.
- Short later `cache: VALID` probes do **not** supersede that incomplete compile.
- A newer full, non-stopped `done in` run can supersede the historical stop if no pending marker remains.
- An old persisted `up-to-date, percent=100` from a false success becomes `interrupted, percent=null`, with a clear resume-required message.
- Existing persisted `stopped` and `failed` states remain preserved.
- During the next run, if the script supports it, the Launcher sends `-ForceResume`, or otherwise writes a safe compatible marker using validated game metadata.

## Verification (NO expensive precompile)

- Built and packaged `_Build/latest/launcher/DemonsSoulsLauncher-win32-x64/DemonsSoulsLauncher.exe`: **PASS**.
- Launcher tests: **51 total, 45 PASS, 0 FAIL, 6 SKIP** (six skipped require locally selected game paths).
- Regression test for historical 438/601 stop + newer bogus up-to-date logs: **PASS**.
- Regression for updated/older runner resume flags and exit 130: **PASS**.
- Windows PowerShell syntax for primary runner and isolated runner: **PASS**.
- Read-only query against actual saved real logs/cache using new ShaderProgress constructor: `status=interrupted, percent=null, phase=...resume required`: **PASS**.
- User's current `PPSA01341_01.007.000.resume-required` exists: **verified**.
- **NOT TESTED:** full precompile/resume itself: user must initiate it, not the assistant, to avoid stressing a machine that previously BSOD'd with MEMORY_MANAGEMENT. Actual remaining 601 shards are based on the interruption log; exact new missing-pipeline count may differ after accounting for existing merged/cache entries.

### User instructions

Close any **older** Launcher process, open the same single `_Build/latest/launcher/DemonsSoulsLauncher-win32-x64/DemonsSoulsLauncher.exe`, go to Shader Cache > Update Missing Shaders. It should display a resume-needed/in-progress state, rather than falsely 100% complete; progress may first spend some time planning/deduplicating existing shader binaries. Do **not** delete `_PipelineCache`, `.binaries`, shaders, saved shards, or the `.resume-required` marker. A stop should leave the new marker again. Inspect launcher shader update logs after the manual session.

The source fix is on the isolated branch `integration/chenxiao-v20261023b-20261023`, with no merge into the primary checkout's currently dirty source.
