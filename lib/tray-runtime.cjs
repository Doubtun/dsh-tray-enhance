'use strict'

/**
 * The enhanced Windows tray menu.
 *
 * This file is written to `resources/tray-enhance/tray.cjs` and loaded by a small
 * stub that the bundle patches into the desktop shell's `lib/main.js`. Keeping the
 * implementation here means the menu can change without touching the archive, and
 * the patched shell stays almost identical to the shipped one.
 *
 * Menu labels follow `menu.json`, which the bundle's Host half writes from its
 * settings page; the icon palette follows the same file. Both are re-read on every
 * right click, so a settings change needs no restart.
 */

const { Menu, Tray, nativeImage, nativeTheme } = require('electron')
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const directory = join(process.resourcesPath, 'tray-enhance')
const settingsPath = join(directory, 'menu.json')
const requestPath = join(directory, 'theme-request.json')

const LABELS = {
  en: {
    open: 'Open',
    restart: 'Restart',
    updates: 'Check for Updates',
    theme: 'Theme',
    light: 'Light',
    dark: 'Dark',
    follow: 'Follow system',
    exit: 'Exit',
  },
  zh: {
    open: '打开',
    restart: '重启',
    updates: '检查更新',
    theme: '主题',
    light: '浅色',
    dark: '深色',
    follow: '跟随系统',
    exit: '退出',
  },
}

/** Settings written by the bundle's Host half; every field falls back to `auto`. */
function menuSettings() {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    if (parsed !== null && typeof parsed === 'object') {
      return { language: parsed.language, appearance: parsed.appearance, theme: parsed.theme }
    }
  } catch {
    // No settings written yet: both fields follow the running system.
  }
  return {}
}

/**
 * Ask the Host to change the application's appearance.
 *
 * The preference is owned by the Host setting `ui-theme`, so the tray cannot write
 * it directly: it records the request here and the bundle's Host half applies it
 * through the settings Service, which is what the in-app appearance control does.
 * The shell updates `nativeTheme` itself so the change also reaches window chrome
 * immediately.
 */
function requestTheme(preference) {
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(requestPath, JSON.stringify({ preference, at: Date.now() }))
  } catch (error) {
    console.warn('desktop tray: could not request an appearance change', error)
  }
}

/** One menu glyph, preferring the high-density artwork when it is installed. */
function menuIcon(name) {
  try {
    const standard = join(directory, `${name}.png`)
    if (!existsSync(standard)) return undefined
    const dense = join(directory, `${name}@2x.png`)
    if (!existsSync(dense)) return nativeImage.createFromPath(standard)
    const image = nativeImage.createEmpty()
    image.addRepresentation({ scaleFactor: 1, buffer: readFileSync(standard) })
    image.addRepresentation({ scaleFactor: 2, buffer: readFileSync(dense) })
    return image.isEmpty() ? undefined : image
  } catch {
    return undefined
  }
}

class DesktopTray {
  /**
   * @param options - Tray icon, locale reader, and the open, restart, update,
   * appearance, and quit actions supplied by the shell.
   */
  constructor(options) {
    this.options = options
    const tray = new Tray(nativeImage.createFromPath(options.iconPath))
    this.tray = tray
    tray.on('click', () => {
      options.open()
    })
    // No persistent context menu: the menu is rebuilt on every right click so the
    // language, the appearance radio state, and the artwork are always current.
    tray.on('right-click', () => {
      const menu = this.menu()
      if (menu !== undefined) tray.popUpContextMenu(menu)
    })
    this.relabel()
  }

  /** Labels for the configured language, following the application when asked to. */
  labels(settings) {
    const preferred = settings.language === 'zh' || settings.language === 'en' ? settings.language : undefined
    const locale = this.options.locale().id
    const language = preferred ?? (typeof locale === 'string' && locale.toLowerCase().startsWith('zh') ? 'zh' : 'en')
    return LABELS[language] ?? LABELS.en
  }

  menu() {
    if (this.tray === undefined) return undefined
    const settings = menuSettings()
    const labels = this.labels(settings)
    const dark = settings.appearance === 'auto' || settings.appearance === undefined
      ? nativeTheme.shouldUseDarkColors
      : settings.appearance === 'dark'
    const icon = (name) => menuIcon(`${dark ? 'dark' : 'light'}-${name}`)
    const entry = (name, label, click) => {
      const image = icon(name)
      return image === undefined ? { label, click } : { label, icon: image, click }
    }

    // Mirrors the application's own appearance switch, including Follow system. The
    // Host reports the stored preference; the shell's own mirror is the fallback.
    const mirrored = nativeTheme.themeSource
    const stored = settings.theme
    const current = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : mirrored
    const choice = (preference, label) => ({
      label,
      type: 'radio',
      checked: current === preference,
      click: () => this.options.setTheme(preference),
    })
    const themeIcon = icon('theme')
    const theme = {
      label: labels.theme,
      ...(themeIcon === undefined ? {} : { icon: themeIcon }),
      submenu: [
        choice('light', labels.light),
        choice('dark', labels.dark),
        choice('system', labels.follow),
      ],
    }

    return Menu.buildFromTemplate([
      entry('open', labels.open, () => this.options.open()),
      entry('restart', labels.restart, () => this.options.restart()),
      { type: 'separator' },
      entry('updates', labels.updates, () => this.options.checkUpdates()),
      theme,
      { type: 'separator' },
      entry('exit', labels.exit, () => this.options.quit()),
    ])
  }

  /** Refresh the tooltip; the context menu is rebuilt whenever it opens. */
  relabel() {
    const tray = this.tray
    if (tray === undefined) return
    tray.setToolTip(this.options.locale().messages.aboutProduct)
  }

  /** Remove the icon; called once the quit is confirmed so no dead icon outlives the process. */
  dispose() {
    const tray = this.tray
    this.tray = undefined
    tray?.destroy()
  }
}

module.exports = { DesktopTray, requestTheme }
