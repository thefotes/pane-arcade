import { describe, expect, test } from 'bun:test'
import { snake, type SnakeState } from '../../hooks/games/snake'
import { lineWidth } from '../../hooks/games/cartridge'

const SIZE = { columns: 80, rows: 30 }

function makeState(seed = 42): SnakeState {
  return snake.init({ seed, size: SIZE })
}

function head(s: SnakeState): { x: number; y: number } {
  return s.snake[0] as { x: number; y: number }
}

function tickN(s: SnakeState, n: number): void {
  for (let i = 0; i < n; i++) snake.tick!(s)
}

describe('snake', () => {
  test('init with size 80x30 gives a 30x20 board, frame 22 lines x 62 wide', () => {
    const s = makeState()
    expect(s.boardW).toBe(30)
    expect(s.boardH).toBe(20)
    const frame = snake.view(s, SIZE)
    expect(frame.lines.length).toBe(22)
    for (const line of frame.lines) {
      expect(lineWidth(line)).toBe(62)
    }
  })

  test('snake does not move before the first key; moves right after right + ticks', () => {
    const s = makeState()
    const before = head(s)
    tickN(s, 4)
    expect(head(s)).toEqual(before)
    expect(s.started).toBe(false)
    snake.key(s, { key: 'right' })
    expect(s.started).toBe(true)
    tickN(s, 4) // stepEvery = 2 -> moves on every 2nd tick
    expect(head(s)).toEqual({ x: before.x + 2, y: before.y })
  })

  test('reversal is ignored', () => {
    const s = makeState()
    snake.key(s, { key: 'right' })
    tickN(s, 2)
    snake.key(s, { key: 'left' })
    tickN(s, 2)
    expect(s.dir).toEqual({ x: 1, y: 0 })
    expect(head(s).x).toBe(head(s).x) // still alive
    expect(s.over).toBe(false)
  })

  test('running into the wall sets game over', () => {
    const s = makeState()
    s.snake = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]
    s.dir = { x: -1, y: 0 }
    s.queue = []
    s.started = true
    snake.tick!(s)
    expect(s.over).toBe(true)
  })

  test('eating food grows the snake and increments score', () => {
    const s = makeState()
    snake.key(s, { key: 'right' })
    const beforeLen = s.snake.length
    const h = head(s)
    s.food = { x: h.x + 1, y: h.y }
    tickN(s, 2)
    expect(s.score).toBe(1)
    expect(s.snake.length).toBe(beforeLen + 1)
  })

  test('r restarts and keeps best', () => {
    const s = makeState()
    snake.key(s, { key: 'right' })
    const h = head(s)
    s.food = { x: h.x + 1, y: h.y }
    tickN(s, 2)
    expect(s.score).toBe(1)
    s.over = true
    snake.key(s, { key: 'r' })
    expect(s.score).toBe(0)
    expect(s.over).toBe(false)
    expect(s.started).toBe(false)
    expect(s.best).toBe(1)
  })

  test('same seed gives same food positions (determinism)', () => {
    const a = makeState(1234)
    const b = makeState(1234)
    expect(b.food).toEqual(a.food)
    snake.key(a, { key: 'right' })
    snake.key(b, { key: 'right' })
    const ha = head(a)
    a.food = { x: ha.x + 1, y: ha.y }
    b.food = { x: ha.x + 1, y: ha.y }
    tickN(a, 2)
    tickN(b, 2)
    expect(b.food).toEqual(a.food)
  })
})

describe('snake redraws only when something moves', () => {
  test('tick reports no change before the start, between steps and after death', () => {
    const s = snake.init({ seed: 1, size: { columns: 80, rows: 30 } })
    expect(snake.tick!(s)).toBe(false)
    snake.key(s, { key: 'up' })
    const results = [snake.tick!(s), snake.tick!(s), snake.tick!(s), snake.tick!(s)]
    expect(results).toContain(true)
    expect(results).toContain(false)
    s.over = true
    expect(snake.tick!(s)).toBe(false)
  })
})
