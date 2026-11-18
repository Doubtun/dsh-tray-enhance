/**
 * The tray menu patch, expressed as two byte-range replacements inside the
 * desktop shell's `lib/main.js`.
 *
 * The packaged archive records a SHA-256 for every file and the shell refuses to
 * start when a recorded hash stops matching, so a patched file must keep the
 * archive's layout untouched. Every replacement here therefore preserves the
 * exact byte length: the patch is written slightly compact and the leftover
 * bytes are spent as trailing spaces inside a comment, or released by dropping
 * the bundler's own `//#region` banners when the patch would overrun.
 */

const LATIN1 = 'latin1'

export const PATCH_MARKER = '// tray-enhance v3'

/** Any earlier tray-enhance build: repairable from the saved original. */
const PATCH_MARKER_PREFIX = '// tray-enhance v'

const REGION_A_START = '/** Windows system tray:'
const REGION_A_END = '\n//#endregion\n//#region lib/types/background-notice.js'
const REGION_B_START = 'tray = new DesktopTray({'
const REGION_B_END = '\n\t} catch (error) {'

/**
 * Loader stub and a stock-menu fallback; the menu itself lives in
 * `resources/tray-enhance/tray.cjs`. Ends on a comment line that absorbs padding.
 */
const REGION_A_CODE = `${PATCH_MARKER}
/** Windows system tray: the enhanced menu lives beside the icons in resources/tray-enhance. */
/** Tray icon present for the whole run, not only while the window is hidden. */
const trayEnhanceRuntime = (() => {
	try {
		return createRequire(import.meta.url)(join(process.resourcesPath, "tray-enhance", "tray.cjs"));
	} catch (error) {
		console.warn("desktop tray: enhancement unavailable", error);
		return {};
	}
})();
/** Stock menu, used only when the enhancement files are missing. */
var DesktopTray = trayEnhanceRuntime.DesktopTray ?? class {
	constructor(options) {
		this.options = options;
		const tray = this.tray = new Tray(nativeImage.createFromPath(options.iconPath));
		tray.on("click", () => options.open());
		const messages = options.locale().messages;
		tray.setToolTip(messages.aboutProduct);
		tray.setContextMenu(Menu.buildFromTemplate([
			{ label: messages.openApplication, click: () => options.open() },
			{ type: "separator" },
			{ label: messages.quitApplication, click: () => options.quit() }
		]));
	}
	relabel() {}
	dispose() {
		const tray = this.tray;
		this.tray = void 0;
		tray?.destroy();
	}
};
const requestTheme = (preference) => trayEnhanceRuntime.requestTheme?.(preference);
//`

/** Callbacks the enhanced tray needs; each one already exists at the call site's scope. */
const REGION_B_CODE = `tray = new DesktopTray({
			iconPath: trayIconPath,
			locale: currentDesktopLocale,
			open: () => {
				focusPrimaryWindow();
			},
			restart: () => {
				if (quitting) return;
				app.relaunch();
				quitWithoutConfirmation();
			},
			checkUpdates: () => {
				openUpdatePrompt(true);
			},
			setTheme: (preference) => {
				if (preference !== "light" && preference !== "dark" && preference !== "system") return;
				nativeTheme.themeSource = preference;
				requestTheme(preference);
			},
			quit: () => {
				app.quit();
			}
		});`

/** Shape checks: a region that does not look like the known shell is left alone. */
const EXPECTED = [
  ['messages.openApplication', 'setContextMenu(Menu.buildFromTemplate'],
  ['iconPath: trayIconPath', 'app.quit()'],
]

function locate(text, start, end) {
  const from = text.indexOf(start)
  if (from < 0) return undefined
  if (text.indexOf(start, from + 1) >= 0) return undefined
  const to = text.indexOf(end, from)
  if (to < 0) return undefined
  return { from, to }
}

/**
 * Classify the installed shell.
 * @param source - `lib/main.js` bytes.
 * @returns `patched`, `stale`, `pristine`, or `unsupported`.
 */
export function classify(source) {
  const text = source.toString(LATIN1)
  if (text.includes(PATCH_MARKER)) return 'patched'
  // An older tray-enhance build: re-patchable once the saved original is restored.
  if (text.includes(PATCH_MARKER_PREFIX)) return 'stale'
  return regions(text) === undefined ? 'unsupported' : 'pristine'
}

function regions(text) {
  const a = locate(text, REGION_A_START, REGION_A_END)
  const b = locate(text, REGION_B_START, REGION_B_END)
  if (a === undefined || b === undefined) return undefined
  const bodies = [text.slice(a.from, a.to), text.slice(b.from, b.to)]
  for (const [index, needles] of EXPECTED.entries()) {
    if (!needles.every((needle) => bodies[index].includes(needle))) return undefined
  }
  return [
    { ...a, body: bodies[0], replacement: REGION_A_CODE },
    { ...b, body: bodies[1], replacement: REGION_B_CODE },
  ]
}

/** Collect `//#region` banner lines outside the replaced ranges, worth `needed` bytes. */
function banners(text, excluded, needed) {
  const spans = []
  let freed = 0
  const pattern = /^\/\/#(?:end)?region.*\n/gm
  for (let match = pattern.exec(text); match !== null && freed < needed; match = pattern.exec(text)) {
    const from = match.index
    const to = from + match[0].length
    if (excluded.some((range) => from < range.to && to > range.from)) continue
    spans.push({ from, to })
    freed += match[0].length
  }
  return { spans, freed }
}

/**
 * Rewrite the shell's tray code without changing the file's byte length.
 * @param source - Current `lib/main.js` bytes.
 * @returns The patched bytes, or `undefined` for an unrecognized shell.
 * @throws When the shell layout cannot be balanced to the original length.
 */
export function patchMain(source) {
  return build(source)?.bytes
}

/**
 * Explain what the patch would change.
 * @param source - `lib/main.js` bytes.
 * @returns Region sizes, released banner count, padding, or `undefined`.
 */
export function describePatch(source) {
  return build(source)?.details
}

function build(source) {
  const text = source.toString(LATIN1)
  const found = regions(text)
  if (found === undefined) return undefined
  const excluded = found.map(({ from, to }) => ({ from, to }))
  const replacements = found.map(({ replacement }) => replacement)

  const before = found.reduce((total, region) => total + region.body.length, 0)
  const after = replacements.reduce((total, replacement) => total + replacement.length, 0)
  let available = before - after

  // A patch that would grow the file releases bytes by dropping banner comments.
  let spans = []
  if (available < 0) {
    const trimmed = banners(text, excluded, -available)
    spans = trimmed.spans
    available += trimmed.freed
  }
  if (available < 0) throw new Error('shell layout cannot be patched without changing its size')

  const padding = available
  replacements[0] += ' '.repeat(padding)

  const edits = [
    ...found.map((region, index) => ({ from: region.from, to: region.to, insert: replacements[index] })),
    ...spans.map((span) => ({ from: span.from, to: span.to, insert: '' })),
  ].sort((left, right) => left.from - right.from)

  let cursor = 0
  let output = ''
  for (const edit of edits) {
    if (edit.from < cursor) throw new Error('overlapping shell edits')
    output += text.slice(cursor, edit.from) + edit.insert
    cursor = edit.to
  }
  output += text.slice(cursor)

  if (output.length !== text.length) {
    throw new Error(`patched shell is ${output.length} bytes, expected ${text.length}`)
  }
  return {
    bytes: Buffer.from(output, LATIN1),
    details: {
      originalSize: text.length,
      regionOriginal: found.map((region) => region.body.length),
      regionPatched: found.map((region, index) => region.replacement.length + (index === 0 ? padding : 0)),
      releasedBanners: spans.length,
      releasedBytes: spans.reduce((total, span) => total + (span.to - span.from), 0),
      padding,
    },
  }
}
