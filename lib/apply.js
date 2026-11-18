/**
 * Orchestration for the tray enhancement: locate the installed shell, keep the
 * menu artwork on disk, and apply or restore the shell patch.
 *
 * Everything in this module is safe to call repeatedly; the patch is applied once
 * per DSH version and re-applied automatically after an application update.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { canWrite, readShell, verifyShell, writeShell } from './asar.js'
import { classify, patchMain } from './patch.js'
import { renderTrayIcons } from './icons.js'

/** The tray implementation the patched shell loads at runtime. */
const RUNTIME_SOURCE = join(dirname(fileURLToPath(import.meta.url)), 'tray-runtime.cjs')

/** Where the running installation keeps its shell archive. */
export function resolvePaths() {
  const resources =
    typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0
      ? process.resourcesPath
      : join(dirname(process.execPath), 'resources')
  return {
    resources,
    asar: join(resources, 'app.asar'),
    support: join(resources, 'tray-enhance'),
    backup: join(resources, 'tray-enhance', 'backup'),
  }
}

/**
 * Write the menu artwork and the tray implementation, leaving identical files untouched.
 * @returns the number of files written.
 */
export function writeIcons(support = resolvePaths().support) {
  mkdirSync(support, { recursive: true })
  let written = 0
  const place = (target, bytes) => {
    try {
      if (readFileSync(target).equals(bytes)) return
    } catch {
      // Missing or unreadable: rewrite it below.
    }
    writeFileSync(target, bytes)
    written += 1
  }
  for (const [name, bytes] of renderTrayIcons()) place(join(support, name), bytes)
  place(join(support, 'tray.cjs'), readFileSync(RUNTIME_SOURCE))
  return written
}

function recordBackup(paths, shell) {
  mkdirSync(paths.backup, { recursive: true })
  writeFileSync(join(paths.backup, 'main.js.orig'), shell.mainBytes)
  writeFileSync(
    join(paths.backup, 'meta.json'),
    `${JSON.stringify({ digest: shell.digest, size: shell.mainBytes.length, createdAt: new Date().toISOString() }, null, 2)}\n`,
  )
}

/** Read the enhancement state without changing anything. */
export function status() {
  const paths = resolvePaths()
  const state = { ...paths, writable: false, shell: 'missing-archive' }
  if (!existsSync(paths.asar)) return state
  const shell = readShell(paths.asar)
  return {
    ...state,
    writable: canWrite(paths.asar),
    shell: classify(shell.mainBytes),
    digest: shell.digest,
  }
}

/**
 * Apply the enhancement when the installed shell is a version this bundle knows.
 * @returns a report describing what happened and whether a restart is required.
 */
export function apply() {
  const paths = resolvePaths()
  const icons = writeIcons(paths.support)
  if (!existsSync(paths.asar)) return { action: 'missing-archive', paths, icons }

  let shell = readShell(paths.asar)
  let state = classify(shell.mainBytes)
  let repaired = false

  // A shell patched by an older build is put back to its original first.
  if (state === 'stale') {
    const saved = join(paths.backup, 'main.js.orig')
    if (!existsSync(saved)) return { action: 'stale-without-backup', paths, icons }
    if (!canWrite(paths.asar)) return { action: 'read-only-archive', paths, icons }
    writeShell(paths.asar, readFileSync(saved))
    shell = readShell(paths.asar)
    state = classify(shell.mainBytes)
    repaired = true
  }

  if (state === 'patched') return { action: 'already-patched', paths, icons }
  if (state === 'unsupported') return { action: 'unsupported-shell', paths, icons }
  if (!canWrite(paths.asar)) return { action: 'read-only-archive', paths, icons }

  const patched = patchMain(shell.mainBytes)
  if (patched === undefined) return { action: 'unsupported-shell', paths, icons }
  if (patched.length !== shell.mainBytes.length) {
    return { action: 'unsupported-shell', paths, icons, reason: 'size-mismatch' }
  }

  recordBackup(paths, shell)
  const written = writeShell(paths.asar, patched)
  const check = verifyShell(paths.asar, written.digest)
  if (!check.ok) {
    // Put the untouched shell back so a partially written archive cannot survive.
    writeShell(paths.asar, shell.mainBytes)
    return { action: 'apply-failed', paths, icons, detail: check }
  }
  return {
    action: 'patched',
    paths,
    icons,
    digest: written.digest,
    restartRequired: true,
    repaired,
  }
}

/** Undo the enhancement using the copy saved on first application. */
export function restore() {
  const paths = resolvePaths()
  const saved = join(paths.backup, 'main.js.orig')
  if (!existsSync(saved)) return { action: 'no-backup', paths }
  if (!existsSync(paths.asar)) return { action: 'missing-archive', paths }
  const bytes = readFileSync(saved)
  const written = writeShell(paths.asar, bytes)
  const check = verifyShell(paths.asar, written.digest)
  return { action: check.ok ? 'restored' : 'restore-failed', paths, digest: written.digest }
}
