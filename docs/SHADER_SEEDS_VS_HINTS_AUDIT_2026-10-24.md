# Seeds vs incremental shader updates — audit, 2026-10-24

## What the user observed

The primary checkout stores `_Build/static-precompile/seeds-PPSA01341_01.007.000.seeds` (135,509,295 bytes, last written **2026-10-20 14:25:10**). The user moved the installed Demon's Souls 1.07 folder from `I:` to `C:`, but the game still identifies as `PPSA01341_01.007.000`. Moving a folder does not change the game's shader content. The current launcher uses the verified C: path.

`precompile-windows.ps1` intentionally re-extracts base seeds **only when absent or when `-RefreshSeeds` is requested**. For an explicit refresh, it compares new/old content hashes and **preserves the original timestamp if identical**. `Update Missing Shaders` passes `-Incremental` without `-RefreshSeeds`. Therefore a 20-Oct seeds timestamp is expected after incremental updates.

## Current actual cache status

The manual resumed shader update logged in `_Build/run-logs/launcher-shader-updates/shader-update-2026-10-23T17-40-08-391Z-b3a190.log` **successfully processed 1,043 shards** (1,042 done / 1 running at the final progress line, followed by successful merge), elapsed **00:40:35**, with resulting `_PipelineCache/static/PPSA01341_01.007.000.binaries` **5,947,048,166 bytes**, last updated **2026-10-24 01:20:45** local time. The `.shaders` input updated at 00:43, and the cache fingerprint JSON updated at 01:31. Later quick `--status` runs report up-to-date, `resume-required` marker is absent.

**Caveat:** This proves completion for inputs currently present in the primary checkout, not for any upstream hints missing from that checkout.

## Upstream hints are not actually deployed to the primary checkout

The isolated integration worktree `integration/chenxiao-v20261023b-20261023` includes chenxiao07 commit `9960ce2e` (2026-10-23): **20,730 programs / 25,003 pipeline recipes**. The primary checkout still carries older hints, logged as **20,461 programs / 24,715 pipeline recipes**.

Verified SHA-256 and byte sizes:
- Primary `tools/local/static-precompile/hints-PPSA01341_01.007.000.hints`: **390,588 bytes**, SHA-256 `7bb78670420711331f3b63f1bb19dcec9c2e5553b432087b47bb7ef3117ef720`.
- Integration worktree same path: **395,516 bytes**, SHA-256 `539348495c67cc71e8f3aaebfb75ff7ca248d9cf8a6990edb178200f1496bf21`.
- `pass-states.json` and `files-PPSA01341_01.007.000.files` hashes match between branches; their newer timestamps alone do not prove the base seeds stale.

**No binary hints file was copied into the primary checkout in this audit.** Deploying those binary bytes through the project file editor is not supported. User needs the updated hints synced from the verified integration worktree as a separate explicit deployment. Do not claim the latest upstream hints are installed or the new pipeline additions have been compiled.

## Fix for incorrect incremental fast-path

Previously, if the native `--status` said `static cache current` and `inputs current`, the PowerShell runner returned `cache: VALID` and saved a new fingerprint, **even if the previously saved content fingerprint mismatched** because seeds, recorded-play hints or translator source changed. The native status only sees the base seed status; it cannot guarantee new hinted combinations were compiled.

Fix in `precompile-windows.ps1`:
1. Calculate whether an available saved content fingerprint matches.
2. On changed fingerprint, do not take the native cache-current early return; print a new-contents diagnostic and re-plan incremental missing pipelines, preserving old binaries.
3. Do not stamp a newly changed fingerprint as completed before incremental compilation.
4. Leave seed regeneration opt-in: no unnecessary 135 MB seed extraction due a binary rebuild or mere game-folder move.

This code fix was also applied to the user's primary `precompile-windows.ps1`, preserving unrelated dirty sources and caches.

## Validation

- PowerShell syntax parser: 0 errors in both copies.
- Electron/Launcher node tests: **52 total; 46 PASS, 0 FAIL, 6 SKIP**; skip cases rely on selected game in isolated worktree.
- No native shader precompile was started to avoid the user's prior Windows MEMORY_MANAGEMENT BSOD.

## Later (not executed here)

A safe deployment should back up the primary hints, copy the newer 395,516-byte hints from the verified integration worktree, verify SHA-256, and only then trigger user-controlled `Update Missing Shaders`. It should add missing combos to existing `.binaries`, not remove/cache-reset. Optionally rebuild base seeds with explicit `-RefreshSeeds` only when game files, extraction logic or pass states materially change and full validation is available.
