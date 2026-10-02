import { type Cartridge, type Frame, type InitContext, type Key, type Line, type Size, rng } from './cartridge'

type Cell = { x: number; y: number }
type Dir = { x: number; y: number }

export type SnakeState = {
  rng: () => number
  boardW: number
  boardH: number
  snake: Cell[]
  dir: Dir
  queue: Dir[]
  food: Cell
  score: number
  best: number
  over: boolean
  won: boolean
  started: boolean
  stepEvery: number
  tickCount: number
  ateThisTick: boolean
}

const DIRS: Record<string, Dir> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const KEY_TO_DIR: Record<string, string> = {
  up: 'up', w: 'up', W: 'up',
  down: 'down', s: 'down', S: 'down',
  left: 'left', a: 'left', A: 'left',
  right: 'right', d: 'right', D: 'right',
}

function boardWidth(size: Size): number {
  return Math.max(10, Math.min(30, Math.floor((size.columns - 2) / 2)))
}

function boardHeight(size: Size): number {
  return Math.max(8, Math.min(20, size.rows - 2))
}

function randCell(state: SnakeState, exclude: Set<string>): Cell {
  const empty: Cell[] = []
  for (let y = 0; y < state.boardH; y++) {
    for (let x = 0; x < state.boardW; x++) {
      if (!exclude.has(`${x},${y}`)) empty.push({ x, y })
    }
  }
  const idx = Math.floor(state.rng() * empty.length)
  return empty[idx] as Cell
}

function occupied(state: SnakeState): Set<string> {
  const set = new Set<string>()
  for (const c of state.snake) set.add(`${c.x},${c.y}`)
  return set
}

function placeFood(state: SnakeState): Cell {
  return randCell(state, occupied(state))
}

function startGame(state: SnakeState) {
  const midY = Math.floor(state.boardH / 2)
  const midX = Math.floor(state.boardW / 2)
  state.snake = [
    { x: midX, y: midY },
    { x: midX - 1, y: midY },
    { x: midX - 2, y: midY },
  ]
  state.dir = { x: 1, y: 0 }
  state.queue = []
  state.score = 0
  state.over = false
  state.won = false
  state.started = false
  state.stepEvery = 2
  state.tickCount = 1
  state.ateThisTick = false
  state.food = placeFood(state)
}

export const snake: Cartridge<SnakeState> = {
  id: 'snake',
  title: 'Snake',
  blurb: 'Eat, grow, don\u2019t bite yourself.',
  tickMs: 110,

  init(ctx: InitContext): SnakeState {
    const state: SnakeState = {
      rng: rng(ctx.seed),
      boardW: boardWidth(ctx.size),
      boardH: boardHeight(ctx.size),
      snake: [],
      dir: { x: 1, y: 0 },
      queue: [],
      food: { x: 0, y: 0 },
      score: 0,
      best: 0,
      over: false,
      won: false,
      started: false,
      stepEvery: 2,
      tickCount: 0,
      ateThisTick: false,
    }
    startGame(state)
    return state
  },

  key(state: SnakeState, key: Key): void {
    if (key.key === 'r') {
      startGame(state)
      return
    }
    if (state.over || state.won) return
    const dirName = KEY_TO_DIR[key.key]
    if (dirName === undefined) return
    const newDir = DIRS[dirName] as Dir
    if (!state.started) {
      if (newDir.x === -state.dir.x && newDir.y === -state.dir.y) return
      state.started = true
      if (newDir.x !== state.dir.x || newDir.y !== state.dir.y) state.queue.push(newDir)
      return
    }
    const ref = (state.queue.length > 0 ? state.queue[state.queue.length - 1] : state.dir) as Dir
    if (newDir.x === ref.x && newDir.y === ref.y) return
    if (newDir.x === -ref.x && newDir.y === -ref.y) return
    if (state.queue.length < 2) state.queue.push(newDir)
  },

  tick(state: SnakeState): void {
    if (!state.started || state.over || state.won) return
    state.tickCount++
    if (state.tickCount < state.stepEvery) return
    state.tickCount = 0
    if (state.queue.length > 0) {
      state.dir = state.queue.shift() ?? state.dir
    }
    const head = state.snake[0] as Cell
    const next: Cell = { x: head.x + state.dir.x, y: head.y + state.dir.y }
    state.ateThisTick = false
    if (next.x < 0 || next.x >= state.boardW || next.y < 0 || next.y >= state.boardH) {
      state.over = true
      if (state.score > state.best) state.best = state.score
      return
    }
    const tail = state.snake[state.snake.length - 1]
    const eats = next.x === state.food.x && next.y === state.food.y
    const leaving = !eats && tail !== undefined && next.x === tail.x && next.y === tail.y
    if (!leaving) {
      for (let i = 0; i < state.snake.length - (eats ? 0 : 1); i++) {
        const seg = state.snake[i]
        if (seg && seg.x === next.x && seg.y === next.y) {
          state.over = true
          if (state.score > state.best) state.best = state.score
          return
        }
      }
    }
    state.snake.unshift(next)
    if (eats) {
      state.score++
      state.ateThisTick = true
      if (state.score > state.best) state.best = state.score
      if (state.score >= 10) state.stepEvery = 1
      const free = state.boardW * state.boardH - state.snake.length
      if (free <= 0) {
        state.won = true
      } else {
        state.food = placeFood(state)
      }
    } else {
      state.snake.pop()
    }
  },

  view(state: SnakeState, _size: Size): Frame {
    const borderDim = '#555555'
    const top: Line = [{ text: '┌' + '─'.repeat(state.boardW * 2) + '┐', color: borderDim, dim: true }]
    const bottom: Line = [{ text: '└' + '─'.repeat(state.boardW * 2) + '┘', color: borderDim, dim: true }]

    const overlay: string | undefined = state.won
      ? 'YOU WIN!'
      : state.over
        ? 'GAME OVER — r to restart'
        : !state.started
          ? 'arrows / wasd to start'
          : undefined
    const overlayRow = Math.floor(state.boardH / 2)
    const overlayChars = overlay !== undefined ? [...overlay] : undefined
    const overlayCol = overlayChars !== undefined
      ? Math.max(0, Math.floor((state.boardW * 2 - overlayChars.length) / 2))
      : 0

    const lines: Line[] = [top]
    for (let y = 0; y < state.boardH; y++) {
      const rowChars: string[] = []
      const rowColors: (string | undefined)[] = []
      for (let x = 0; x < state.boardW; x++) {
        const head = state.snake[0] as Cell
        const isHead = head !== undefined && head.x === x && head.y === y
        const isBody = !isHead && state.snake.some((c) => c.x === x && c.y === y)
        const isFood = state.food.x === x && state.food.y === y
        let glyph: string
        let color: string | undefined
        if (isHead) {
          glyph = '██'
          color = '#7ee787'
        } else if (isBody) {
          glyph = '██'
          color = '#2ea043'
        } else if (isFood) {
          glyph = '◆◆'
          color = '#ff7b72'
        } else {
          glyph = '  '
          color = undefined
        }
        rowChars.push(...[...glyph])
        rowColors.push(color, color)
      }
      if (overlayChars !== undefined && y === overlayRow) {
        for (let i = 0; i < overlayChars.length; i++) {
          const col = overlayCol + i
          if (col < rowChars.length) {
            rowChars[col] = overlayChars[i] as string
            rowColors[col] = '#e6edf3'
          }
        }
      }
      const line: Line = [{ text: '│', color: borderDim, dim: true }]
      let start = 0
      while (start < rowChars.length) {
        let end = start + 1
        const color = rowColors[start] as string | undefined
        while (end < rowChars.length && rowColors[end] === color) end++
        line.push({ text: rowChars.slice(start, end).join(''), color, bold: color === '#7ee787' })
        start = end
      }
      line.push({ text: '│', color: borderDim, dim: true })
      lines.push(line)
    }
    lines.push(bottom)

    const status =
      `Score ${state.score}  Best ${state.best}  Length ${state.snake.length}` +
      (state.over ? '  · dead' : '')

    return {
      lines,
      status,
      help: 'arrows/wasd turn · r restart · p pause · backspace menu',
    }
  },
}
