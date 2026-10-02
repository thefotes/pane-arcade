// The contract every game ("cartridge") implements. Cartridges are plain
// TypeScript with no engine, DOM or Node imports: the Client surface module
// drives them on the drawing thread, and `bun test` drives them in tests.
//
// State is a mutable object the cartridge owns. `key` and `tick` change it in
// place; `view` reads it and never changes it.

/** One key press, as the terminal reports it. */
export type Key = {
  /**
   * A special key's name (`up`, `down`, `left`, `right`, `return`, `tab`,
   * `backspace`, `delete`, `escape`, `pageup`, `pagedown`, `home`, `end`) or the
   * character typed (`a`, `A`, `1`, ` ` for space).
   */
  key: string
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
}

/** A run of text drawn with one style. Colors are `#rrggbb` hex strings. */
export type Span = {
  text: string
  color?: string
  bg?: string
  bold?: boolean
  dim?: boolean
}

/** One terminal row: spans drawn left to right. */
export type Line = Span[]

/** What a cartridge draws: the play area, a one-line status and a key hint. */
export type Frame = {
  lines: Line[]
  /** Score, timer, whose turn, game over, ... (one short line). */
  status: string
  /** Controls for this game, e.g. `arrows move · f flag · r restart`. */
  help: string
}

/** Room available for `Frame.lines`, in terminal cells. */
export type Size = { columns: number; rows: number }

export type InitContext = {
  /** Seed for the cartridge's own PRNG (see `rng` below). */
  seed: number
  /** Room the play area may use. Keep `lines` within it. */
  size: Size
  /** A ROM image, for cartridges that run one. */
  rom?: Uint8Array
  /** A display name for the ROM (its file name). */
  romName?: string
}

/**
 * Work a cartridge asks the host to do outside the drawing thread (the drawing
 * thread has no processes or files). The harness posts it to the hooks module
 * and hands the answer back through `onResponse`.
 */
export type HostRequest = {
  /** Unique per request; echoed on the response. */
  id: string
  kind: 'stockfish'
  /** Position to search, as FEN. */
  fen: string
  /** How long the engine may think, in milliseconds. */
  movetimeMs: number
  /** UCI_Elo to cap strength at, or absent for full strength. */
  elo?: number
}

export type HostResponse = {
  id: string
  kind: 'stockfish'
  /** Best move in UCI notation (`e2e4`, `e7e8q`), or null if none/failed. */
  bestmove: string | null
  /** Why the request failed (e.g. stockfish is not installed). */
  error?: string
}

export interface Cartridge<S> {
  /** Stable id, lowercase: `snake`, `minesweeper`, `chess`, `chip8`. */
  id: string
  title: string
  /** One line for the menu. */
  blurb: string
  /** When set, the harness calls `tick` every `tickMs` milliseconds while unpaused. */
  tickMs?: number
  init(ctx: InitContext): S
  /** Handle one key. The harness keeps `p` (pause) and `backspace` (menu) for itself. */
  key(state: S, key: Key): void
  tick?(state: S): void
  view(state: S, size: Size): Frame
  /** A request the cartridge is waiting on the host for, if any. */
  pendingRequest?(state: S): HostRequest | undefined
  onResponse?(state: S, response: HostResponse): void
}

/** Small seeded PRNG (mulberry32): `const rand = rng(seed); rand()` in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Total printed width of a line (every glyph a cartridge uses is one cell wide). */
export function lineWidth(line: Line): number {
  return line.reduce((n, span) => n + [...span.text].length, 0)
}
