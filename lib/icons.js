/**
 * Tray menu artwork: a dependency-free rasterizer plus a minimal PNG encoder.
 *
 * The tray menu belongs to the Electron main process, which cannot import from a
 * bundle, so the glyphs are rendered once here and written as plain PNG files
 * that the patched shell loads with `nativeImage.createFromPath`.
 */

import { deflateSync } from 'node:zlib'

const TAU = Math.PI * 2

/* ------------------------------------------------------------------ *
 * PNG encoding
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(bytes) {
  let c = -1
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

/** Encode straight RGBA bytes as a non-interlaced 8-bit PNG. */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0 // filter: none
    for (let x = 0; x < stride; x += 1) raw[y * (stride + 1) + 1 + x] = rgba[y * stride + x]
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------------------------------------------ *
 * Shape primitives, all in unit space with y pointing down
 * ------------------------------------------------------------------ */

const or = (...shapes) => (x, y) => shapes.some((shape) => shape(x, y))
const without = (shape, hole) => (x, y) => shape(x, y) && !hole(x, y)

function segment(ax, ay, bx, by, w) {
  const half = w / 2
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  return (x, y) => {
    let t = lengthSquared === 0 ? 0 : ((x - ax) * dx + (y - ay) * dy) / lengthSquared
    t = t < 0 ? 0 : t > 1 ? 1 : t
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= half
  }
}

function disc(cx, cy, r) {
  return (x, y) => Math.hypot(x - cx, y - cy) <= r
}

/** Circular stroke; `from`/`to` are radians in [0, TAU) and may exceed TAU. */
function ring(cx, cy, r, w, from, to) {
  const half = w / 2
  return (x, y) => {
    if (Math.abs(Math.hypot(x - cx, y - cy) - r) > half) return false
    if (from === undefined) return true
    let angle = Math.atan2(y - cy, x - cx)
    if (angle < 0) angle += TAU
    while (angle < from) angle += TAU
    return angle <= to
  }
}

function roundRect(x0, y0, x1, y1, radius, w) {
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const hx = (x1 - x0) / 2 - radius
  const hy = (y1 - y0) / 2 - radius
  const half = w / 2
  return (x, y) => {
    const qx = Math.abs(x - cx) - hx
    const qy = Math.abs(y - cy) - hy
    const ox = Math.max(qx, 0)
    const oy = Math.max(qy, 0)
    const distance = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius
    return Math.abs(distance) <= half
  }
}

/** Arrowhead whose tip points along the tangent at `angle` on the circle. */
function arrowHead(cx, cy, r, angle, length, spread, w) {
  const px = cx + r * Math.cos(angle)
  const py = cy + r * Math.sin(angle)
  const tx = -Math.sin(angle)
  const ty = Math.cos(angle)
  const nx = Math.cos(angle)
  const ny = Math.sin(angle)
  const tipX = px + tx * length
  const tipY = py + ty * length
  const baseX = px - tx * length * 0.15
  const baseY = py - ty * length * 0.15
  return or(
    segment(tipX, tipY, baseX + nx * spread, baseY + ny * spread, w),
    segment(tipX, tipY, baseX - nx * spread, baseY - ny * spread, w),
  )
}

/* ------------------------------------------------------------------ *
 * Glyphs
 * ------------------------------------------------------------------ */

const TOP = TAU * 0.75 // straight up, in y-down radians

const GLYPHS = {
  /** Application window: frame, title divider, and a window control dot. */
  open: or(
    roundRect(0.10, 0.13, 0.90, 0.87, 0.14, 0.078),
    segment(0.13, 0.38, 0.87, 0.38, 0.062),
    disc(0.235, 0.255, 0.045),
  ),
  /** Circular arrow: three-quarter swing plus an arrowhead. */
  restart: (() => {
    const from = TOP + 0.78
    const to = TOP + TAU - 0.62
    return or(
      ring(0.5, 0.5, 0.315, 0.086, from, to),
      arrowHead(0.5, 0.5, 0.315, from, 0.135, 0.072, 0.082),
    )
  })(),
  /** Download arrow onto a baseline: "there is something to fetch". */
  updates: or(
    segment(0.5, 0.10, 0.5, 0.60, 0.088),
    segment(0.5, 0.64, 0.30, 0.42, 0.088),
    segment(0.5, 0.64, 0.70, 0.42, 0.088),
    segment(0.15, 0.87, 0.85, 0.87, 0.088),
  ),
  /** Crescent: appearance. */
  theme: without(disc(0.50, 0.53, 0.345), disc(0.71, 0.32, 0.305)),
  /** Power: a gap-topped ring with the stem. */
  exit: or(
    ring(0.5, 0.56, 0.305, 0.088, TOP + 0.40, TOP + TAU - 0.40),
    segment(0.5, 0.095, 0.5, 0.52, 0.088),
  ),
}

const COLORS = {
  // On a light menu background.
  light: [0x45, 0x4a, 0x52],
  // On a dark menu background.
  dark: [0xd2, 0xd7, 0xdf],
}

const SUPERSAMPLE = 4

function rasterize(size, inside, rgb) {
  const rgba = new Uint8Array(size * size * 4)
  const step = 1 / SUPERSAMPLE
  const samples = SUPERSAMPLE * SUPERSAMPLE
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let hits = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          if (inside((px + (sx + 0.5) * step) / size, (py + (sy + 0.5) * step) / size)) hits += 1
        }
      }
      if (hits === 0) continue
      const offset = (py * size + px) * 4
      rgba[offset] = rgb[0]
      rgba[offset + 1] = rgb[1]
      rgba[offset + 2] = rgb[2]
      rgba[offset + 3] = Math.round((hits / samples) * 255)
    }
  }
  return rgba
}

/**
 * Render the glyph set as one strip for review and for the bundle's detail page.
 * @param variant - `light` or `dark` artwork.
 * @param cell - Side length of one square cell in pixels.
 * @returns PNG bytes of a single-row contact sheet.
 */
export function renderContactSheet(variant = 'dark', cell = 72) {
  const names = Object.keys(GLYPHS)
  const width = cell * names.length
  const rgba = new Uint8Array(width * cell * 4)
  const background = variant === 'dark' ? [0x2b, 0x2d, 0x31] : [0xff, 0xff, 0xff]
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      rgba[offset] = background[0]
      rgba[offset + 1] = background[1]
      rgba[offset + 2] = background[2]
      rgba[offset + 3] = 255
    }
  }
  const rgb = COLORS[variant]
  names.forEach((name, index) => {
    const inside = GLYPHS[name]
    const inset = cell * 0.18
    const span = cell - inset * 2
    for (let py = 0; py < cell; py += 1) {
      for (let px = 0; px < cell; px += 1) {
        let hits = 0
        for (let sy = 0; sy < 4; sy += 1) {
          for (let sx = 0; sx < 4; sx += 1) {
            if (inside((px + (sx + 0.5) / 4) / cell, (py + (sy + 0.5) / 4) / cell)) hits += 1
          }
        }
        if (hits === 0) continue
        const offset = (py * width + index * cell + px) * 4
        const alpha = hits / 16
        rgba[offset] = Math.round(background[0] * (1 - alpha) + rgb[0] * alpha)
        rgba[offset + 1] = Math.round(background[1] * (1 - alpha) + rgb[1] * alpha)
        rgba[offset + 2] = Math.round(background[2] * (1 - alpha) + rgb[2] * alpha)
        rgba[offset + 3] = 255
      }
    }
  })
  return encodePreviewPng(width, cell, rgba)
}

/** Encode an arbitrary-width RGBA bitmap, since tray icons are always square. */
function encodePreviewPng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    for (let x = 0; x < stride; x += 1) raw[y * (stride + 1) + 1 + x] = rgba[y * stride + x]
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Render every glyph at both scale factors.
 * @returns a Map of file name to PNG bytes.
 */
export function renderTrayIcons() {
  const files = new Map()
  for (const [variant, rgb] of Object.entries(COLORS)) {
    for (const [name, inside] of Object.entries(GLYPHS)) {
      for (const size of [16, 32]) {
        const suffix = size === 16 ? '.png' : '@2x.png'
        files.set(`${variant}-${name}${suffix}`, encodePng(size, rasterize(size, inside, rgb)))
      }
    }
  }
  return files
}
