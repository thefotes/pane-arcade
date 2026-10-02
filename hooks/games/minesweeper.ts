import { type Cartridge, type Frame, type InitContext, type Key, type Line, type Pointer, type Size, rng } from './cartridge'

type Cell = { mine: boolean; revealed: boolean; flagged: boolean; count: number }

export type MinesweeperState = {
  size: Size
  rng: () => number
  difficulty: number
  w: number
  h: number
  mines: number
  cells: Cell[]
  cursorX: number
  cursorY: number
  placed: boolean
  seconds: number
  lost: boolean
  won: boolean
  hitIndex: number
}

const DIFFICULTIES = [
  { id: 1, name: 'Beginner', w: 9, h: 9, mines: 10 },
  { id: 2, name: 'Intermediate', w: 16, h: 16, mines: 40 },
  { id: 3, name: 'Expert', w: 30, h: 16, mines: 99 },
]

function fits(d: { w: number; h: number }, size: Size): boolean {
  return d.w * 3 + 2 <= size.columns && d.h + 2 <= size.rows
}

function difficultyName(id: number): string {
  for (const d of DIFFICULTIES) if (d.id === id) return d.name
  return 'Beginner'
}

function newGame(state: MinesweeperState, difficulty: number, size: Size): void {
  const def = DIFFICULTIES.find((d) => d.id === difficulty) ?? DIFFICULTIES[0]!
  state.difficulty = def.id
  state.w = def.w
  state.h = def.h
  state.mines = def.mines
  state.size = size
  state.cells = []
  for (let i = 0; i < def.w * def.h; i++) {
    state.cells.push({ mine: false, revealed: false, flagged: false, count: 0 })
  }
  state.cursorX = Math.floor(def.w / 2)
  state.cursorY = Math.floor(def.h / 2)
  state.placed = false
  state.seconds = 0
  state.lost = false
  state.won = false
  state.hitIndex = -1
}

function idx(state: MinesweeperState, x: number, y: number): number {
  return y * state.w + x
}

function inBounds(state: MinesweeperState, x: number, y: number): boolean {
  return x >= 0 && x < state.w && y >= 0 && y < state.h
}

function neighbours(state: MinesweeperState, x: number, y: number): number[] {
  const out: number[] = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      const ny = y + dy
      if (inBounds(state, nx, ny)) out.push(idx(state, nx, ny))
    }
  }
  return out
}

function placeMines(state: MinesweeperState, safeIndex: number): void {
  const safe = new Set<number>([safeIndex, ...neighbours(state, safeIndex % state.w, Math.floor(safeIndex / state.w))])
  const candidates: number[] = []
  for (let i = 0; i < state.cells.length; i++) {
    if (!safe.has(i)) candidates.push(i)
  }
  let placed = 0
  while (placed < state.mines && candidates.length > 0) {
    const pick = Math.floor(state.rng() * candidates.length)
    const chosen = candidates[pick]!
    candidates[pick] = candidates[candidates.length - 1]!
    candidates.pop()
    if (!state.cells[chosen]!.mine) {
      state.cells[chosen]!.mine = true
      placed++
    }
  }
  for (let y = 0; y < state.h; y++) {
    for (let x = 0; x < state.w; x++) {
      const i = idx(state, x, y)
      if (state.cells[i]!.mine) continue
      let n = 0
      for (const j of neighbours(state, x, y)) if (state.cells[j]!.mine) n++
      state.cells[i]!.count = n
    }
  }
}

function floodReveal(state: MinesweeperState, startX: number, startY: number): void {
  const stack: number[] = [idx(state, startX, startY)]
  while (stack.length > 0) {
    const i = stack.pop()!
    const cell = state.cells[i]!
    if (cell.revealed || cell.flagged) continue
    cell.revealed = true
    if (cell.count === 0 && !cell.mine) {
      const x = i % state.w
      const y = Math.floor(i / state.w)
      for (const j of neighbours(state, x, y)) {
        const n = state.cells[j]!
        if (!n.revealed && !n.flagged && !n.mine) stack.push(j)
      }
    }
  }
}

function checkWin(state: MinesweeperState): void {
  for (const cell of state.cells) {
    if (!cell.mine && !cell.revealed) return
  }
  state.won = true
  for (const cell of state.cells) {
    if (cell.mine) cell.flagged = true
  }
}

function revealCell(state: MinesweeperState, x: number, y: number): void {
  const i = idx(state, x, y)
  const cell = state.cells[i]!
  if (cell.flagged) return
  if (!state.placed) {
    placeMines(state, i)
    state.placed = true
  }
  if (cell.revealed) {
    let flags = 0
    for (const j of neighbours(state, x, y)) if (state.cells[j]!.flagged) flags++
    if (flags !== cell.count) return
    for (const j of neighbours(state, x, y)) {
      const n = state.cells[j]!
      if (n.revealed || n.flagged) continue
      if (n.mine) {
        n.revealed = true
        state.lost = true
        state.hitIndex = j
        revealAllMines(state)
        return
      }
      floodReveal(state, j % state.w, Math.floor(j / state.w))
    }
    checkWin(state)
    return
  }
  if (cell.mine) {
    cell.revealed = true
    state.lost = true
    state.hitIndex = i
    revealAllMines(state)
    return
  }
  floodReveal(state, x, y)
  checkWin(state)
}

function revealAllMines(state: MinesweeperState): void {
  for (let i = 0; i < state.cells.length; i++) {
    const cell = state.cells[i]!
    if (cell.mine) cell.revealed = true
  }
}

function flagCount(state: MinesweeperState): number {
  let n = 0
  for (const cell of state.cells) if (cell.flagged) n++
  return n
}

const NUM_COLORS = [
  undefined,
  '#58a6ff',
  '#3fb950',
  '#ff7b72',
  '#a371f7',
  '#d29922',
  '#39c5cf',
  'text',
  'inactive',
]

export const minesweeper: Cartridge<MinesweeperState> = {
  id: 'minesweeper',
  title: 'Minesweeper',
  blurb: 'Clear the field without hitting a mine.',
  tickMs: 1000,

  init(ctx: InitContext): MinesweeperState {
    let difficulty = 1
    for (const d of DIFFICULTIES) if (fits(d, ctx.size)) difficulty = d.id
    const state: MinesweeperState = {
      size: ctx.size,
      rng: rng(ctx.seed),
      difficulty: 1,
      w: 9,
      h: 9,
      mines: 10,
      cells: [],
      cursorX: 0,
      cursorY: 0,
      placed: false,
      seconds: 0,
      lost: false,
      won: false,
      hitIndex: -1,
    }
    newGame(state, difficulty, ctx.size)
    return state
  },

  key(state: MinesweeperState, key: Key): void {
    if (key.key === 'r') {
      newGame(state, state.difficulty, state.size)
      return
    }
    if (key.key === '1' || key.key === '2' || key.key === '3') {
      const id = Number(key.key)
      const def = DIFFICULTIES.find((d) => d.id === id)
      if (def && fits(def, state.size)) newGame(state, id, state.size)
      return
    }
    if (state.lost || state.won) return
    const moves: Record<string, [number, number]> = {
      up: [0, -1],
      k: [0, -1],
      down: [0, 1],
      j: [0, 1],
      left: [-1, 0],
      h: [-1, 0],
      right: [1, 0],
      l: [1, 0],
    }
    const move = moves[key.key]
    if (move) {
      state.cursorX = Math.max(0, Math.min(state.w - 1, state.cursorX + move[0]!))
      state.cursorY = Math.max(0, Math.min(state.h - 1, state.cursorY + move[1]!))
      return
    }
    if (key.key === ' ' || key.key === 'return') {
      revealCell(state, state.cursorX, state.cursorY)
      return
    }
    if (key.key === 'f') {
      const cell = state.cells[idx(state, state.cursorX, state.cursorY)]!
      if (!cell.revealed) cell.flagged = !cell.flagged
    }
  },

  pointer(state: MinesweeperState, pointer: Pointer, _size: Size): void {
    if (pointer.type !== 'down') return
    const cellX = Math.floor((pointer.x - 1) / 3)
    const cellY = pointer.y - 1
    if (!inBounds(state, cellX, cellY)) return
    const button = pointer.button ?? 'left'
    if (state.lost || state.won) {
      if (button === 'left') newGame(state, state.difficulty, state.size)
      return
    }
    state.cursorX = cellX
    state.cursorY = cellY
    if (button === 'left') {
      revealCell(state, cellX, cellY)
    } else if (button === 'right') {
      const cell = state.cells[idx(state, cellX, cellY)]!
      if (!cell.revealed) cell.flagged = !cell.flagged
    } else if (button === 'middle') {
      const cell = state.cells[idx(state, cellX, cellY)]!
      if (cell.revealed) revealCell(state, cellX, cellY)
    }
  },

  tick(state: MinesweeperState): boolean {
    if (!state.placed || state.lost || state.won || state.seconds >= 999) return false
    state.seconds++
    return true
  },

  view(state: MinesweeperState, _size: Size): Frame {
    const border = 'subtle'
    const lines: Line[] = []
    const edge = '─'.repeat(state.w * 3)
    lines.push([{ text: '┌' + edge + '┐', color: border, dim: true }])
    for (let y = 0; y < state.h; y++) {
      const chars: string[] = []
      const colors: (string | undefined)[] = []
      const bgs: (string | undefined)[] = []
      for (let x = 0; x < state.w; x++) {
        const cell = state.cells[idx(state, x, y)]!
        const cursor = state.cursorX === x && state.cursorY === y
        let glyph: string
        let color: string | undefined
        if (cell.revealed) {
          if (cell.mine) {
            glyph = ' * '
            color = '#ff7b72'
          } else if (cell.count === 0) {
            glyph = '   '
            color = undefined
          } else {
            glyph = ` ${cell.count} `
            color = NUM_COLORS[cell.count]
          }
        } else if (cell.flagged) {
          glyph = ' ⚑ '
          color = state.lost && !cell.mine ? undefined : '#ff7b72'
          if (state.lost && !cell.mine) glyph = ' x '
        } else {
          glyph = ' ■ '
          color = 'inactive'
        }
        let bg: string | undefined
        if (state.lost && cell.mine && idx(state, x, y) === state.hitIndex) bg = '#6e2020'
        if (cursor) bg = 'selectionBg'
        for (const ch of glyph) {
          chars.push(ch)
          colors.push(color)
          bgs.push(bg)
        }
      }
      const line: Line = [{ text: '│', color: border, dim: true }]
      let start = 0
      while (start < chars.length) {
        let end = start + 1
        while (end < chars.length && colors[end] === colors[start] && bgs[end] === bgs[start]) end++
        line.push({ text: chars.slice(start, end).join(''), color: colors[start], bg: bgs[start] })
        start = end
      }
      line.push({ text: '│', color: border, dim: true })
      lines.push(line)
    }
    lines.push([{ text: '└' + edge + '┘', color: border, dim: true }])

    let status =
      `Mines ${state.mines}  Flags ${flagCount(state)}  Time ${String(state.seconds).padStart(3, '0')}  ${difficultyName(state.difficulty)}`
    if (state.lost) status += ' · BOOM — r to retry'
    if (state.won) status += ' · Cleared! — r for another'

    return {
      lines,
      status,
      help: 'click reveal · right-click flag · arrows/hjkl move · space reveal · f flag · 1/2/3 size · r restart',
    }
  },
}
