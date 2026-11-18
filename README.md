# Tray menu enhancement

Richer Windows tray menu for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) (DSH) desktop: per-item icons, a restart entry, an update check, and a light/dark theme submenu.

## Install

The recommended way is from inside the DSH desktop client:

1. Open **Plugins** (插件) in the sidebar.
2. Click **Add plugin** (添加插件).
3. Enter the package name `dsh-tray-enhance` (or the repository URL `https://github.com/Doubtun/dsh-tray-enhance`).
4. Confirm the install, then restart DSH once so the tray code loads.

Alternatively, from a terminal:

```shell
dsh plugin add dsh-tray-enhance
```

## Menu

Right-clicking the DeepSeek Harness tray icon shows:

| Entry | What it does |
| --- | --- |
| Open | Shows and focuses the main window. |
| Restart | Relaunches the application, honoring the same quit checks as Exit. |
| Check for Updates | Opens the application's own update prompt. |
| Theme ▸ | Switches the application between light, dark, and follow system, mirroring the in-app appearance control. |
| Exit | Quits, keeping the existing confirmation for running and scheduled tasks. |

Every entry has its own icon. The icon palette follows the system light/dark state automatically.

## Settings

The bundle's settings page holds one choice and applies it without a restart:

| Setting | Values | Effect |
| --- | --- | --- |
| `language` | `auto`, `zh`, `en` | Menu labels. `auto` follows the application language; anything that is not Chinese falls back to English. |

The icon palette always follows the system light/dark state and is not user-configurable.

The page is a single-field form rendered on the bundle's own page in **Plugins**: open
**插件 (Plugins)**, find **托盘菜单增强 (Tray menu enhancement)**, and the configuration
block sits between the description and the row list. The value is mirrored to
`resources/tray-enhance/menu.json`, which the shell re-reads on every right click, so a
change shows up the next time the menu opens.

## Why a bundle has to touch the shell

The tray lives in the desktop shell's Electron main process, which the Host that loads
plugins runs separately from, so no Host Service or IPC message can reach it. This bundle
patches the shell's tray code instead, keeping the archive's byte layout intact because
`app.asar` records a SHA-256 for every file and the shell refuses to start on a mismatch.

The patched region is a short loader stub; the menu itself is written to
`resources/tray-enhance/tray.cjs` together with the icon PNGs. The first application saves
the original in `resources/tray-enhance/backup/main.js.orig`.

## How the appearance item reaches the application

The theme is a Host setting (`ui-theme`), and the shell process cannot write it. Clicking
Dark Mode switches `nativeTheme` for immediate effect on the window chrome and records the
request in `resources/tray-enhance/theme-request.json`; this bundle's Host half picks it up
and applies it through the settings Service, the same path the in-app appearance control
uses. The request left by a previous run is ignored, so a restart never re-applies an old
choice.

## Requirements and limits

- Windows desktop app only; the web build has no tray and is left untouched.
- Takes effect on the next DSH start, because the shell loads its tray code at launch.
- Re-applied automatically after an application update. A shell version this bundle does
  not recognize is reported and left unmodified rather than patched blindly.
- Removing the bundle restores the saved original shell code.

## Command line

The same logic is available while DSH is closed:

```shell
node tools/apply.mjs check
node tools/apply.mjs patch
node tools/apply.mjs restore
```

## License

[MIT](./LICENSE)
