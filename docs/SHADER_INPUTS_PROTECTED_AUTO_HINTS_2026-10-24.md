# Safe shader inputs + published hints sync — 2026-10-24

## Requirement

The user accidentally deleted important seeds/hints after Cache Manager showed generated seeds/hints as removable. Subsequent **Update Missing Shaders** must safely check for newer upstream hints and keep the base seeds, generated seeds, recorded-play hints and compiled binaries intact.

## Implementation

- `launcher-electron/shader-inputs.cjs` now catalogs compilation inputs under `_Build/static-precompile`, `tools/local/static-precompile` and release-layout root, all labeled **KEEP** and nondeletable. Included: original `seeds-<game>.seeds`, derived `hinted`/`released`/`recorded` seeds, `recorded-play` hints, published `hints-<game>.hints` and `.backup-*`, `files-<game>.files`, `pass-states.json`, user-exported `my-hints`, content fingerprint, legacy seed marker.
- Backend `shaderInputs.remove()` explicitly rejects every recognized compilation input. Browser/UI cannot select any of them; even direct IPC is revalidated and rejected.
- `cache.cjs` also protects entire archived cache groups if any underlying file is a `.hints`, `.seeds`, `.files` or `pass-states.json`, and checks filenames again at the delete boundary.
- `precompile-windows.ps1 -Incremental` dot-sources `tools/local/static-precompile/sync-release-hints.ps1` before cache status, then uses the prior content-fingerprint mismatch detection to re-plan missing pipeline recipes. The updater requests the **exact game-version-specific** hints from the GitHub Contents API for `chenxiao07/KytyPS5`, checks expected name/path/type/2 MiB maximum size, decodes base64, verifies Git blob SHA-1 of the bytes, compares local SHA-256 and atomically replaces the file using .NET `File.Replace` with a preserved backup. Network/API failure leaves local file untouched; no precompile is started by sync alone.
- Base seeds are generated when **missing**, and deliberately reused on unchanged game versions. Explicit `-RefreshSeeds` recomputes from the installed game; a build timestamp, game-folder move or updating release hints alone must not force seed extraction.
- The main Windows checkout's existing dirty modifications are preserved; only the precompile runner and new helper are applied there. Do **not** overwrite its texture/Vulkan source patches, old hints backups, shader cache, save or game data.

## Verification

PowerShell parser, unit tests (offline mocked GitHub API: good response, unchanged response, update/backup, incorrect SHA rejection, offline fallback), direct IPC deletion lock tests, cache-group indirect deletion lock test, Electron integration tests and packaged build. **Never run the real shader precompiler or gameplay automatically** due prior 0x1A MEMORY_MANAGEMENT BSOD.

## Operational behavior

User opens `_Build/latest/launcher/DemonsSoulsLauncher-win32-x64/DemonsSoulsLauncher.exe`, chooses **Update Missing Shaders**. It syncs versioned hints online (or logs offline fallback), creates base seeds only if absent, combines release/recorded hints, compares fingerprint/status and compiles only missing recipes without discarding active GPU cache. Cache Manager shows compilation inputs as KEEP, not selectable.

A complete engine/gamedata compatibility proof is NOT claimed: the seed file was not regenerated or compared against a fresh extraction and actual long shader precompile was not run.
