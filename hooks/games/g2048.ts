import { type Cartridge, type Frame, type InitContext, type Key, type Line, type Size, rng } from './cartridge'

export type G2048State = {
  rng: () => number
  cells: number[]
  score: number
  best: number
  over: boolean
  won: boolean
  wonDismissed: boolean
  canUndo: boolean
  prev: { cells: number[]; score: number; won: boolean; wonDismissed: boolean } | null
}

const SIZE = 4

export function slideRow(row: number[]): { row: number[]; gained: number } {
  const vals = row.filter((v) => v !== 0)
  const out: number[] = []
  let gained = 0
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i] as number
    const next = vals[i + 1]
    if (next !== undefined && next === v) {
      const merged = v * 2
      out.push(merged)
      gained += merged
      i++
    } else {
      out.push(v)
    }
  }
  while (out.length < row.length) out.push(0)
  return { row: out, gained }
}

function emptyIndices(cells: number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < cells.length; i++) if (cells[i] === 0) out.push(i)
  return out
}

function addTile(state: G2048State): void {
  const empties = emptyIndices(state.cells)
  if (empties.length === 0) return
  const value = state.rng() < 0.9 ? 2 : 4
  const idx = Math.floor(state.rng() * empties.length)
  state.cells[empties[idx] as number] = value
}

function hasMoves(cells: number[]): boolean {
  if (emptyIndices(cells).length > 0) return true
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = cells[y * SIZE + x] as number
      if (x + 1 < SIZE && cells[y * SIZE + x + 1] === v) return true
      if (y + 1 < SIZE && cells[(y + 1) * SIZE + x] === v) return true
    }
  }
  return false
}

function gridLines(state: G2048State, dir: 'left' | 'right' | 'up' | 'down'): number[][] {
  const lines: number[][] = []
  if (dir === 'left' || dir === 'right') {
    for (let y = 0; y < SIZE; y++) {
      const row: number[] = []
      for (let x = 0; x < SIZE; x++) row.push(state.cells[y * SIZE + x] as number)
      if (dir === 'right') row.reverse()
      lines.push(row)
    }
  } else {
    for (let x = 0; x < SIZE; x++) {
      const col: number[] = []
      for (let y = 0; y < SIZE; y++) col.push(state.cells[y * SIZE + x] as number)
      if (dir === 'down') col.reverse()
      lines.push(col)
    }
  }
  return lines
}

function writeLines(state: G2048State, dir: 'left' | 'right' | 'up' | 'down', lines: number[][]): void {
  for (let i = 0; i < SIZE; i++) {
    const src = lines[i] as number[]
    for (let j = 0; j < SIZE; j++) {
      let v: number
      if (dir === 'left' || dir === 'up') v = src[j] as number
      else v = src[SIZE - 1 - j] as number
      if (dir === 'left' || dir === 'right') state.cells[i * SIZE + j] = v
      else state.cells[j * SIZE + i] = v
    }
  }
}

const KEY_TO_DIR: Record<string, 'left' | 'right' | 'up' | 'down'> = {
  left: 'left', a: 'left', A: 'left', h: 'left', H: 'left',
  right: 'right', d: 'right', D: 'right', l: 'right', L: 'right',
  up: 'up', w: 'up', W: 'up', k: 'up', K: 'up',
  down: 'down', s: 'down', S: 'down', j: 'down', J: 'down',
}

function restart(state: G2048State): void {
  state.cells = new Array(SIZE * SIZE).fill(0)
  state.score = 0
  state.over = false
  state.won = false
  state.wonDismissed = false
  state.canUndo = false
  state.prev = null
  addTile(state)
  addTile(state)
}

function move(state: G2048State, dir: 'left' | 'right' | 'up' | 'down'): void {
  const lines = gridLines(state, dir)
  let gained = 0
  let changed = false
  const slid = lines.map((line) => {
    const r = slideRow(line)
    gained += r.gained
    if (r.row.some((v, i) => v !== line[i])) changed = true
    return r.row
  })
  if (!changed) {
    if (!hasMoves(state.cells)) state.over = true
    return
  }
  state.prev = {
    cells: [...state.cells],
    score: state.score,
    won: state.won,
    wonDismissed: state.wonDismissed,
  }
  state.canUndo = true
  writeLines(state, dir, slid)
  state.score += gained
  if (state.score > state.best) state.best = state.score
  if (!state.won && state.cells.some((v) => v >= 2048)) state.won = true
  addTile(state)
  if (!hasMoves(state.cells)) state.over = true
}

const TILE_BG: Record<number, string> = {
  2: '#eee4da',
  4: '#ede0c8',
  8: '#f2b179',
  16: '#f59563',
  32: '#f67c5f',
  64: '#f65e3b',
  128: '#edcf72',
  256: '#edcc61',
  512: '#edc850',
  1024: '#edc53f',
  2048: '#edc22e',
}
const EMPTY_BG = '#3a3a3c'
const TEXT_DARK = '#776e65'
const TEXT_LIGHT = '#f9f6f2'

function bgFor(v: number): string {
  if (v === 0) return EMPTY_BG
  return TILE_BG[v] ?? '#edc22e'
}

function textFor(v: number): string {
  return v === 2 || v === 4 ? TEXT_DARK : TEXT_LIGHT
}

type Glyph = { ch: string; color?: string; bg?: string; bold?: boolean; dim?: boolean }

function renderLines(glyphs: Glyph[]): Line {
  const line: Line = []
  let start = 0
  while (start < glyphs.length) {
    const g = glyphs[start] as Glyph
    let end = start + 1
    while (
      end < glyphs.length &&
      (glyphs[end] as Glyph).color === g.color &&
      (glyphs[end] as Glyph).bg === g.bg &&
      (glyphs[end] as Glyph).bold === g.bold &&
      (glyphs[end] as Glyph).dim === g.dim
    ) {
      end++
    }
    let text = ''
    for (let i = start; i < end; i++) text += (glyphs[i] as Glyph).ch
    line.push({ text, color: g.color, bg: g.bg, bold: g.bold, dim: g.dim })
    start = end
  }
  return line
}

function tileGlyphsCompact(v: number, width: number): Glyph[] {
  const bg = bgFor(v)
  const glyphs: Glyph[] = []
  let label: string
  let dim = false
  let color: string
  if (v === 0) {
    label = '\u00b7'
    dim = true
    color = '#777777'
  } else {
    label = String(v)
    color = textFor(v)
  }
  const left = Math.floor((width - label.length) / 2)
  for (let i = 0; i < width; i++) {
    if (i >= left && i < left + label.length) {
      glyphs.push({ ch: label[i - left] as string, color, bg, bold: v !== 0, dim })
    } else {
      glyphs.push({ ch: ' ', bg })
    }
  }
  return glyphs
}

function tileGlyphsTall(v: number, width: number, row: 0 | 1 | 2): Glyph[] {
  const bg = bgFor(v)
  const glyphs: Glyph[] = []
  if (row !== 1) {
    for (let i = 0; i < width; i++) glyphs.push({ ch: ' ', bg })
    return glyphs
  }
  return tileGlyphsCompact(v, width)
}

export const g2048: Cartridge<G2048State> = {
  id: '2048',
  title: '2048',
  blurb: 'Slide tiles, merge pairs, reach 2048.',

  init(ctx: InitContext): G2048State {
    const state: G2048State = {
      rng: rng(ctx.seed),
      cells: new Array(SIZE * SIZE).fill(0),
      score: 0,
      best: 0,
      over: false,
      won: false,
      wonDismissed: false,
      canUndo: false,
      prev: null,
    }
    restart(state)
    return state
  },

  key(state: G2048State, key: Key): void {
    if (key.key === 'r' || key.key === 'R') {
      restart(state)
      return
    }
    if (key.key === 'u' || key.key === 'U') {
      if (state.canUndo && state.prev) {
        state.cells = [...state.prev.cells]
        state.score = state.prev.score
        state.won = state.prev.won
        state.wonDismissed = state.prev.wonDismissed
        state.over = false
        state.canUndo = false
        state.prev = null
      }
      return
    }
    if (key.key === 'c' || key.key === 'C') {
      state.wonDismissed = true
      return
    }
    if (state.over) return
    const dir = KEY_TO_DIR[key.key]
    if (dir === undefined) return
    move(state, dir)
  },

  view(state: G2048State, size: Size): Frame {
    const compact = size.rows < 15
    const tileW = compact ? 6 : 7
    const gap = 1
    const totalW = SIZE * tileW + (SIZE - 1) * gap
    const lines: Line[] = []

    if (compact) {
      for (let y = 0; y < SIZE; y++) {
        const glyphs: Glyph[] = []
        for (let x = 0; x < SIZE; x++) {
          if (x > 0) for (let i = 0; i < gap; i++) glyphs.push({ ch: ' ' })
          glyphs.push(...tileGlyphsCompact(state.cells[y * SIZE + x] as number, tileW))
        }
        lines.push(renderLines(glyphs))
      }
    } else {
      for (let y = 0; y < SIZE; y++) {
        for (let row = 0 as 0 | 1 | 2; row < 3; row++) {
          const glyphs: Glyph[] = []
          for (let x = 0; x < SIZE; x++) {
            if (x > 0) for (let i = 0; i < gap; i++) glyphs.push({ ch: ' ' })
            glyphs.push(...tileGlyphsTall(state.cells[y * SIZE + x] as number, tileW, row as 0 | 1 | 2))
          }
          lines.push(renderLines(glyphs))
        }
        if (y < SIZE - 1) {
          const glyphs: Glyph[] = []
          for (let i = 0; i < totalW; i++) glyphs.push({ ch: ' ' })
          lines.push(renderLines(glyphs))
        }
      }
    }

    let suffix = ''
    if (state.won && !state.wonDismissed) suffix = ' \u00b7 2048! keep going (c)'
    else if (state.over) suffix = ' \u00b7 no moves \u2014 r to restart'

    return {
      lines,
      status: `Score ${state.score}  Best ${state.best}${suffix}`,
      help: 'arrows/wasd/hjkl slide \u00b7 u undo \u00b7 r restart',
    }
  },
}
