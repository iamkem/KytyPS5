# Steam integration — Demon's Souls Remake PC / KytyPS5

## Scope

Steam's **Add a Non-Steam Game** feature supports shortcut-based launch and ordinary Steam friends activity while the Steam-launched process runs. It is **not** Steamworks Rich Presence. KytyPS5 is not a Steam-distributed game and does not possess a project-specific Steam AppID for Steamworks.

Steamworks Rich Presence fields (scene, boss, area, etc.), Steam achievements, Steam store ownership and a guaranteed Steam Overlay **cannot** be provided through this shortcut. Do not create `steam_appid.txt` using somebody else's AppID, hook Steam internals, modify Steam's `shortcuts.vdf`, or request Steam credentials. Steam Input and Overlay behavior may vary because game rendering runs in a separate emulator process.

Discord RPC remains separately configured by `launcher-settings.json` and works exactly as before.

## One-time setup (explicit user action in Steam)

1. Build and open launcher v8 with root `launcher.cmd`.
2. Open **Options → Advanced → Set Up Steam…**.
3. Open Steam, then **Games → Add a Non-Steam Game to My Library → Browse**. Choose the *packaged* EXE listed in the setup dialog (not `launcher.cmd` and not `kyty_emulator.exe`).
4. In the Steam shortcut's **Properties**, set its display name to **Demon's Souls Remake PC (KytyPS5)** (or your preferred name).
5. Set **Launch Options** to `--steam-game`. The setup dialog offers a **Copy Launch Options** action. **Start In** should be the EXE's parent directory; Steam normally fills this when browsing.
6. Start the shortcut **from your Steam Library**. The launcher uses the **already-saved** `launcher-settings.json` without rewriting it, starts the normal `run-windows.ps1 -Follow` game session, and stays hidden while the game is running. When that session ends, the launcher exits and Steam can clear its Non-Steam Game activity.

The packaged v8 path is:

```text
<repository-root>\_Build\demons-souls-launcher-v8\DemonsSoulsLauncher-win32-x64\DemonsSoulsLauncher.exe
```

If the repository is moved or the launcher is upgraded to a new packaged version, review the target in the Steam shortcut properties. The Steam setup dialog automatically points to the newest existing packaged v8/v7/v6.

## Safety & behavior

- **Opt-in:** the Steam session mode starts only with `--steam-game`. Normal `launcher.cmd` and normal Electron launcher behavior are unchanged.
- **No automation of Steam data:** no writes to Steam userdata, shortcuts, registry, profiles, credentials or `steam_appid.txt`.
- **No settings overwrite from Steam mode:** it reads your existing settings and uses exactly the same game launch/preflight path as the launcher Play button. If the game or emulator executable is missing, it reports an error and exits.
- **No game file modification by integration:** launching the game has normal emulator/runtime effects, but Steam integration does not install patches, mods or change game/save/cache data.
- **No double launch:** a single launcher session cannot launch two games.
- **No false activity on error:** a failed Steam auto-launch exits; a completed `-Follow` session exits. If an external Steam process fails to track the child/emulator, activity/overlay is not guaranteed.
- **Discord remains independent:** its opt-in JSON configuration and game-PID agent are preserved.
- **No gameplay validation performed during implementation:** native tests and the packaged GUI/ZIP smoke tests do not prove Steam's friends activity or Overlay on your account. That requires your own Steam shortcut and an actual game launch.

## Checkpoints

Smoke test with `--steam-game --smoke-ui` is specifically designed to **avoid starting the real game** while verifying that Electron GUI and Steam setup remain operational.

Official Steam documentation: https://help.steampowered.com/en/faqs/view/4B8B-9697-2338-40EC
