/**
 * Tray enhancement bundle.
 *
 * The Windows tray menu belongs to the Electron shell's main process, which runs
 * outside the Host that loads plugins, so no Host Service can reach it. This bundle
 * therefore keeps the assets that the patched shell loads and maintains a small,
 * byte-preserving patch to the shell's tray code, applied once per installed DSH
 * version and re-applied automatically after an application update.
 *
 * The `Config` fields become the bundle's settings page. They are declared volatile
 * where the schema supports it, so a change reaches the tray without a reload: the
 * poller below mirrors the current values into `menu.json`, which the shell re-reads
 * on every right click.
 *
 * The menu's appearance submenu cannot write the `ui-theme` setting from the shell,
 * so the shell records a request beside the menu artwork and this half applies it
 * through the settings Service -- the path the in-app appearance control uses too.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'

import { apply as ensureTrayEnhancement } from './lib/apply.js'

const LABEL = 'tray-enhance'
const THEME_REQUEST = 'theme-request.json'
const MENU_SETTINGS = 'menu.json'
const POLL_MS = 900
const THEME_PREFERENCES = new Set(['light', 'dark', 'system'])
const LANGUAGES = new Set(['auto', 'zh', 'en'])

/**
 * The loader resolves `@deepseek-ai/schemastery` from the profile's node_modules
 * through its own ESM resolver, so a plain import is the only reliable path: a
 * `createRequire` walk resolves the CJS entry, whose `require('@deepseek-ai/cosmokit')`
 * then fails because cosmokit ships ESM only.
 */
const field = (inner) => {
  const valued = inner.default('auto')
  return typeof valued.volatile === 'function' ? valued.volatile() : valued
}

/** Settings page schema: menu language only; the icon palette always follows the system. */
export const Config = z.object({
  language: field(z.union(['auto', 'zh', 'en'])),
})

export function apply(ctx, config) {
  let report
  try {
    report = ensureTrayEnhancement()
  } catch (error) {
    console.warn(`${LABEL}: could not prepare the desktop shell`, error)
    return
  }
  describe(report)

  const support = report.paths?.support
  if (typeof support !== 'string') return
  writeMenuSettings(support, effective(config))
  if (report.action === 'patched' || report.action === 'already-patched') {
    watch(ctx, support, config)
  }
}

/** Report the outcome once, so a restart requirement is not silent. */
function describe(report) {
  const archive = report.paths?.asar ?? 'the desktop shell'
  switch (report.action) {
    case 'patched':
      console.info(`${LABEL}: patched ${archive}. Restart DeepSeek Harness to see the new tray menu.`)
      break
    case 'already-patched':
      console.info(`${LABEL}: the tray menu is up to date.`)
      break
    case 'unsupported-shell':
      console.warn(`${LABEL}: ${archive} is a shell version this bundle does not recognize; nothing changed.`)
      break
    case 'read-only-archive':
      console.warn(`${LABEL}: ${archive} is not writable by this account; the tray menu is unchanged.`)
      break
    case 'stale-without-backup':
      console.warn(`${LABEL}: ${archive} carries an older patch and no saved original; nothing changed.`)
      break
    case 'missing-archive':
      console.info(`${LABEL}: no desktop shell found; the tray menu only exists in the desktop app.`)
      break
    default:
      console.warn(`${LABEL}: the tray menu was not applied (${report.action}).`)
  }
}

/** Read a config field whether or not the schema marked it volatile. */
function readField(value, fallback) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') return value.get()
  return value === undefined || value === null ? fallback : value
}

/** The settings the shell consumes, with every invalid value falling back to `auto`. */
function effective(config) {
  const language = readField(config?.language, 'auto')
  return {
    language: LANGUAGES.has(language) ? language : 'auto',
  }
}

/** Mirror the current settings to the shell. @returns whether the file changed. */
function writeMenuSettings(support, settings) {
  const target = join(support, MENU_SETTINGS)
  const next = `${JSON.stringify(settings)}\n`
  try {
    if (readFileSync(target, 'utf8') === next) return false
  } catch {
    // Missing or unreadable: write it below.
  }
  try {
    mkdirSync(support, { recursive: true })
    writeFileSync(target, next)
    return true
  } catch (error) {
    console.warn(`${LABEL}: could not write the menu settings`, error)
    return false
  }
}

/** Leave a durable record of a failed appearance write. */
function reportDiagnostic(support, name, value) {
  try {
    writeFileSync(join(support, name), `${JSON.stringify(value, null, 2)}\n`)
  } catch {
    // Diagnostics are best effort.
  }
}

/**
 * Find the loader entry that owns the application theme.
 *
 * `settings.update` matches on the Loader entry id, which a bundle row gains an
 * `include:` prefix from, so the namespace is read from the descriptors instead of
 * being assumed.
 */
function themeEntry(settings) {
  try {
    const rows = settings.describe()
    return rows.find((row) => row.ns === 'ui-theme' || row.ns.endsWith(':ui-theme'))
  } catch (error) {
    console.warn(`${LABEL}: could not read settings descriptors`, error)
    return undefined
  }
}

/** Current application theme preference, for the submenu's check mark. */
function themePreference(descriptor) {
  const preference = descriptor?.value?.preference
  return THEME_PREFERENCES.has(preference) ? preference : undefined
}

/**
 * Keep the shell's settings mirrored and apply appearance requests the tray writes,
 * ignoring the one left by a previous run.
 */
function watch(ctx, support, config) {
  const requestPath = join(support, THEME_REQUEST)
  // A request written moments before this start is a click that raced the restart;
  // anything older belongs to a previous session and must not override today's choice.
  const pending = readThemeRequest(requestPath)
  const STALE_MS = 60_000
  let applied = pending !== undefined && Date.now() - pending.at < STALE_MS ? 0 : (pending?.at ?? 0)
  let theme
  let ticks = 0

  const refreshTheme = (settings) => {
    const entry = themeEntry(settings)
    if (entry === undefined) return
    theme = themePreference(entry)
  }

  const settings = ctx.get('settings')
  if (settings !== undefined) refreshTheme(settings)

  const timer = setInterval(() => {
    ticks += 1
    const service = ctx.get('settings')

    // The theme can also change in the application's own appearance control.
    if (service !== undefined && ticks % 30 === 0) refreshTheme(service)

    const request = readThemeRequest(requestPath)
    if (request !== undefined && request.at > applied) {
      applied = request.at
      if (THEME_PREFERENCES.has(request.preference)) {
        const entry = service === undefined ? undefined : themeEntry(service)
        if (entry === undefined || service === undefined) {
          reportDiagnostic(support, 'theme-error.json', { reason: 'settings-unavailable', at: request.at })
        } else {
          applyTheme(ctx, service, entry.ns, request.preference, (error) => {
            if (error !== undefined) {
              reportDiagnostic(support, 'theme-error.json', {
                ns: entry.ns,
                preference: request.preference,
                message: String(error?.message ?? error),
              })
              return
            }
            theme = request.preference
            writeMenuSettings(support, { ...effective(config), theme })
          })
          return
        }
      }
    }

    writeMenuSettings(support, { ...effective(config), theme })
  }, POLL_MS)
  timer.unref?.()
  // Without an effect scope the interval simply lives as long as the Host does.
  if (typeof ctx.effect === 'function') ctx.effect(() => () => clearInterval(timer))
}

/**
 * Write the theme preference through the settings Service.
 *
 * The poll timer can inherit a stale HMR execution context (its activation runs
 * inside `runExclusive`, and timers started there keep that AsyncLocalStorage
 * context), which makes `settings.update` fail with "HMR transactions cannot be
 * nested". The write therefore leaves that context first; `runExclusive` is used
 * only when no context is already set.
 */
function applyTheme(ctx, service, ns, preference, done) {
  const write = () => service.update(ns, { preference })
  const run = () => Promise.resolve().then(write).then(() => done(undefined), done)
  const hmr = ctx.get('hmr')
  if (hmr?.executing !== undefined && typeof hmr.executing.exit === 'function') {
    // Clears the inherited HMR context, so a plain settings write is accepted.
    try {
      hmr.executing.exit(() => {
        write().then(() => done(undefined), done)
      })
      return
    } catch {
      // Fall through: no context was set, or exit() rejected synchronously.
    }
  }
  if (hmr !== undefined && typeof hmr.runExclusive === 'function') {
    Promise.resolve(hmr.runExclusive(run)).catch(done)
    return
  }
  run()
}

function readThemeRequest(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return undefined
    if (typeof parsed.at !== 'number' || typeof parsed.preference !== 'string') return undefined
    return { at: parsed.at, preference: parsed.preference }
  } catch {
    return undefined
  }
}
