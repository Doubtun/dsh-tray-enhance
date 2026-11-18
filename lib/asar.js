/**
 * Minimal read/write access to the desktop shell's ASAR archive.
 *
 * Electron patches its own `fs` module so that any path containing `.asar` is
 * resolved *inside* the archive and opened read-only. Every filesystem call here
 * therefore runs with `process.noAsar` raised, synchronously, so no other plugin
 * can observe the flag.
 */

import { closeSync, openSync, readSync, writeSync } from 'node:fs'
import { createHash } from 'node:crypto'

/** Header layout: 8-byte pickle preamble, 4-byte header size, 4-byte JSON length. */
const HEADER_START = 16
const JSON_LENGTH_AT = 12
const HEADER_SIZE_AT = 4

function raw(operation) {
  const previous = process.noAsar
  process.noAsar = true
  try {
    return operation()
  } finally {
    process.noAsar = previous
  }
}

/** Read the header and the shell file the tray code lives in. */
function load(fd) {
  const preamble = Buffer.alloc(HEADER_START)
  readSync(fd, preamble, 0, HEADER_START, 0)
  const headerSize = preamble.readUInt32LE(HEADER_SIZE_AT)
  const headerLength = preamble.readUInt32LE(JSON_LENGTH_AT)
  const header = Buffer.alloc(headerLength)
  readSync(fd, header, 0, headerLength, HEADER_START)

  const manifest = JSON.parse(header.toString('utf8'))
  const entry = manifest?.files?.lib?.files?.['main.js']
  if (entry === undefined) throw new Error('the shell archive has no lib/main.js')
  const integrity = entry.integrity
  if (integrity === undefined || typeof integrity.hash !== 'string') {
    throw new Error('the shell archive records no digest for lib/main.js')
  }

  const dataStart = 8 + headerSize
  const mainAt = dataStart + Number(entry.offset)
  const mainBytes = Buffer.alloc(entry.size)
  readSync(fd, mainBytes, 0, entry.size, mainAt)

  // The digest appears twice for a single-block file: `hash` and `blocks[0]`.
  const marker = Buffer.from(`"offset":"${String(entry.offset)}"`, 'latin1')
  const markerAt = header.indexOf(marker)
  if (markerAt < 0) throw new Error('the shell archive digest could not be located')
  const digest = Buffer.from(integrity.hash, 'latin1')
  const windowEnd = Math.min(header.length, markerAt + 260)
  const hashOffsets = []
  for (let at = header.indexOf(digest, markerAt); at >= 0 && at < windowEnd; at = header.indexOf(digest, at + 1)) {
    hashOffsets.push(HEADER_START + at)
  }
  if (hashOffsets.length === 0) throw new Error('the shell archive digest offsets could not be resolved')

  return { mainAt, mainBytes, digest: integrity.hash, hashOffsets }
}

function withShell(asarPath, options, visit) {
  return raw(() => {
    const fd = openSync(asarPath, options.write === true ? 'r+' : 'r')
    try {
      return visit(fd, load(fd))
    } finally {
      closeSync(fd)
    }
  })
}

/** Read the installed shell's tray source and its recorded digest. */
export function readShell(asarPath) {
  return withShell(asarPath, {}, (fd, shell) => ({
    mainBytes: shell.mainBytes,
    digest: shell.digest,
  }))
}

/** Report whether this process may rewrite the archive. */
export function canWrite(asarPath) {
  try {
    return raw(() => {
      const fd = openSync(asarPath, 'r+')
      closeSync(fd)
      return true
    })
  } catch {
    return false
  }
}

function rewrite(asarPath, bytes) {
  return withShell(asarPath, { write: true }, (fd, shell) => {
    const previousDigest = shell.digest
    const nextDigest = createHash('sha256').update(bytes).digest('hex')
    writeSync(fd, bytes, 0, bytes.length, shell.mainAt)
    const encoded = Buffer.from(nextDigest, 'latin1')
    for (const at of shell.hashOffsets) writeSync(fd, encoded, 0, 64, at)
    return { previousDigest, digest: nextDigest }
  })
}

/** Replace the shell's `lib/main.js` and re-record its digest. */
export function writeShell(asarPath, bytes) {
  return rewrite(asarPath, bytes)
}

/**
 * Read the shell back and confirm the archive accepts it.
 * @returns Whether the stored bytes and the recorded digest match the expectation.
 */
export function verifyShell(asarPath, expectedDigest) {
  const shell = readShell(asarPath)
  const actual = createHash('sha256').update(shell.mainBytes).digest('hex')
  return { ok: actual === expectedDigest && shell.digest === expectedDigest, actual, recorded: shell.digest }
}
