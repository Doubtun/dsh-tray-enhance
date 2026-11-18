#!/usr/bin/env node
/**
 * Command line for the tray enhancement, for use while DSH is closed or to
 * inspect what the plugin would do.
 *
 *   node tools/apply.mjs check     report the installed shell and writability
 *   node tools/apply.mjs dry       write the patched shell beside the icons only
 *   node tools/apply.mjs patch     patch the archive in place, keeping a backup
 *   node tools/apply.mjs restore   put the saved shell back
 *
 * `--report <file>` also writes the report to a file, which is the only reliable
 * way to read it when stdout is not attached to a console.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { apply, resolvePaths, restore, status, writeIcons } from '../lib/apply.js'
import { readShell } from '../lib/asar.js'
import { classify, patchMain } from '../lib/patch.js'

const argumentsList = process.argv.slice(2)
const command = argumentsList.find((item) => !item.startsWith('--')) ?? 'check'
const reportAt = argumentsList.includes('--report')
  ? argumentsList[argumentsList.indexOf('--report') + 1]
  : undefined

const paths = resolvePaths()
const lines = [`command   ${command}`, `asar      ${paths.asar}`, `support   ${paths.support}`]

switch (command) {
  case 'check': {
    const state = status()
    lines.push(`writable  ${state.writable}`, `shell     ${state.shell}`)
    break
  }
  case 'dry': {
    const shell = readShell(paths.asar)
    lines.push(`shell     ${classify(shell.mainBytes)}`)
    const patched = patchMain(shell.mainBytes)
    if (patched === undefined) {
      lines.push('patch     unsupported shell')
      break
    }
    lines.push(`original  ${shell.mainBytes.length} bytes`, `patched   ${patched.length} bytes`)
    mkdirSync(paths.support, { recursive: true })
    const target = join(paths.support, 'main.js.patched')
    writeFileSync(target, patched)
    lines.push(`icons     ${writeIcons(paths.support)} file(s) written`, `wrote     ${target}`)
    break
  }
  case 'patch': {
    const result = apply()
    lines.push(`action    ${result.action}`)
    if (result.digest !== undefined) lines.push(`digest    ${result.digest}`)
    if (result.restartRequired === true) lines.push('restart   required to load the new menu')
    break
  }
  case 'restore': {
    const result = restore()
    lines.push(`action    ${result.action}`)
    if (result.digest !== undefined) lines.push(`digest    ${result.digest}`)
    break
  }
  default: {
    lines.push(`unknown command: ${command}`)
    process.exitCode = 2
  }
}

const text = `${lines.join('\n')}\n`
process.stdout.write(text)
if (reportAt !== undefined) writeFileSync(reportAt, text)
