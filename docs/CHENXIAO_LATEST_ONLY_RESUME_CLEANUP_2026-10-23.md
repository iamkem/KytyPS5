# KytyPS5 latest-only release checkpoint — 2026-10-23

Source integrated: chenxiao07/KytyPS5 upstream commit `39ed7c9a` (later than `v20261023d`). Includes dynamic read guards, recent GPU stability changes, DualSense vibration tuning and 1440p output with DLSS/FSR 3.

Built in `_Build/latest/native-build`: `kyty_emulator.exe` and `kyty_shader_precompile.exe`; both compile and link on Windows. Packaged Electron executable: `_Build/latest/launcher/DemonsSoulsLauncher-win32-x64/DemonsSoulsLauncher.exe`.

Removed failed Stage7 native code and selectable legacy experiment variants. Launcher sets `KYTY_TEXTURE_OFFLOAD=0` and `KYTY_TEXTURE_OFFLOAD_PROBE=0`. Shared upstream platform texture code remains, but is disabled by this launcher.

Update Missing Shaders now leaves a durable `.resume-required` marker through interrupted work. An intentional stop merges completed shards **without** marking translator features or fingerprint complete, and exits 130. New runs reuse saved shards and re-plan missing work. Older runner scripts can resume through the marker even if they do not recognize `-ForceResume`.

Latest build inventory: only `latest`, `run-logs`, `static-precompile`. Saved games, user mods, user edits and active shader cache are untouched. Root `launcher.cmd` in the primary checkout still points at removed older folders; open the latest packaged EXE directly. Native gameplay and large precompile restart remain untested for safety.
