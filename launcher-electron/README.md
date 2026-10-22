# Demon's Souls launcher — Electron (Windows)

Small two-window PC game launcher styled after classic Sony PC setup dialogs. The window opens with **Play / Options / Quit** and the installed game's own art. Options uses native-feeling controls with **Display, Graphics, Advanced, Shader Cache** tabs; Discord configuration is JSON-only. No backend service, no external CDN.

- **Play** invokes the project's existing `run-windows.ps1` with the selected emulator executable.
- **Options** edits the same `../launcher-settings.json` as the previous Windows launcher.
- **Performance / Balanced / Quality** change real render-height, quality, upscaler and frame-generation values. Existing RAM16 and RAM Diet settings stay unchanged.
- **Update Missing Shaders** starts a tracked incremental run. A separate Shader Update window shows real-time phase, elapsed time, processed/running/waiting shards, and a scrollable live log. Use **View Progress** to reopen it. **Stop after current shards** requests cooperative cancellation: running shards finish and their results merge; nothing kills the cache writer mid-merge. Each update has a log under `_Build/run-logs/launcher-shader-updates`. Closing the progress window does not stop the update.
- **Shader Compilation Inputs** are displayed separately in Shader Cache. Base seeds and content fingerprint are locked, old `.seeds.program` is safe to clean, derived `.seeds` and recorded-play `.hints` are marked regenerable/review. Cleanup requires confirmation and goes to Windows Recycle Bin; never touches active compiled binaries.
- **Content-based precompile skip**: after a compatible incremental run, a SHA-256 fingerprint records game seeds, release hints, render pass states and shader source plus cache file identity. Later timestamp-only changes can be ignored **only if** native GPU/driver identity and translator-feature stamp still match and there are no pending shards. Unknown fingerprints, packaged installs without sources, incompatible drivers or changed shader sources fall back to native incremental checking. The first clean incremental check establishes a fingerprint without compiling pipelines.
- **Shader Cache** distinguishes the active (undeletable) cache, completed saved versions (older/newer and switchable), old unfinished shards (not switchable), and auxiliary shader data. **Save Current Version** copies the complete active GPU binaries to `_PipelineCache/generations` (requires disk space). **Use this version** changes the real active binary files only while KytyPS5 is closed, verifies GPU/driver support and rolls back if invalid. It always retains the previously active cache as a selectable version. No versions are created or deleted automatically.
- **Cleanup safety labels** are enforced by the backend: **SAFE TO CLEAN** for interrupted archived shards (selectable), **BACKUP — REVIEW** for non-active saved generations / old driver backups (selectable with a specific warning), and **DO NOT DELETE / KEEP — PERFORMANCE** for the active cache and driver/warmup/file/precompile caches (not selectable, deletion rejected at IPC). Nothing is deleted automatically. Eligible files are moved to Windows Recycle Bin after confirmation.
- **Discord Rich Presence (JSON-only / opt-in):** Discord configuration is intentionally **not visible in any launcher tab**. Set `discord_presence`, `discord_app_id`, and optional `discord_large_image` in the root `launcher-settings.json` as shown below. Create a Discord application named `KytyPS5` at https://discord.com/developers/applications and copy its Application ID; the displayed app name comes from Discord, not this executable. As soon as the launcher opens, Discord shows **Running KytyPS5** / **In launcher • Ready to play**. When `kyty_emulator.exe` starts, it switches to **Running KytyPS5** / **Playing Demon's Souls Remake** with elapsed time. Its detached local IPC agent survives closing the launcher, stops after the emulator process exits, and retries when Discord is launched later. No login token, bot, external server, or UI configuration is required.

### Configure Discord only in `launcher-settings.json`

Edit these properties within the existing JSON object, keeping other graphics and game settings unchanged (do not paste a second JSON object):

```json
{
  "discord_presence": true,
  "discord_app_id": "123456789012345678",
  "discord_large_image": "demons_souls"
}
```

Replace the sample ID with **your** Discord Application ID (17–20 digits). `discord_large_image` is an optional asset key uploaded in your Discord application's Rich Presence Assets; use `""` to disable the image. To disable Presence, set `"discord_presence": false`. Save the JSON before opening the launcher (or reopen the launcher after editing). All other Settings operations preserve these values even though there is no Discord UI. Presence is sent when enabled with a valid Application ID and either the launcher or game is running. Run `npm run discord:diagnose` from `launcher-electron` to check local Discord IPC (handshake only); inspect `_Build/run-logs/discord-presence.log` to see whether Discord acknowledged your status.
- **Cancel** restores the settings snapshot from when the dialog was opened, including immediately saved preset choices.
- Monitor selection and separate anti-aliasing are disabled, since the current emulator does not provide those independent controls.

## Development
```cmd
cd launcher-electron
npm install
npm test
npm start
```

## Windows executable
```cmd
npm run build
```
The build converts the installed game's `sce_sys/icon0.png` into the Windows executable, window and taskbar icon (16–256 px). Game artwork is not committed or distributed. On machines without an installed game (e.g. CI), the build generates a generic sword-and-ring fallback icon instead of the old K. Override the source with `KYTY_GAME_ICON` if needed.

The built launcher is under `../_Build/demons-souls-launcher-v4/DemonsSoulsLauncher-win32-x64/DemonsSoulsLauncher.exe`. Do not move only the .exe: it needs the Electron companion files in that directory. The root `launcher.cmd` launches only this personalized Electron application (or the release's `Launcher/DemonsSoulsLauncher.exe`), not the removed Windows PowerShell/WPF UIs. Core emulator/precompile scripts stay in place.
