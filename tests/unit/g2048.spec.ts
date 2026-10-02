import { describe, expect, test } from 'bun:test'
import { g2048, slideRow, type G2048State } from '../../hooks/games/g2048'
import { lineWidth } from '../../hooks/games/cartridge'

const SIZE = { columns: 80, rows: 30 }
const SMALL = { columns: 80, rows: 10 }

function makeState(seed = 42): G2048State {
  return g2048.init({ seed, size: SIZE })
}

function tileCount(s: G2048State): number {
  return s.cells.filter((v) => v !== 0).length
}

describe('slideRow', () => {
  test('merges pairs once per move', () => {
    expect(slideRow([2, 2, 2, 2])).toEqual({ row: [4, 4, 0, 0], gained: 8 })
    expect(slideRow([4, 4, 8, 0])).toEqual({ row: [8, 8, 0, 0], gained: 8 })
    expect(slideRow([2, 2, 4, 0])).toEqual({ row: [4, 4, 0, 0], gained: 4 })
  })

  test('slides tiles to the left edge', () => {
    expect(slideRow([0, 0, 0, 2])).toEqual({ row: [2, 0, 0, 0], gained: 0 })
    expect(slideRow([2, 0, 2, 0])).toEqual({ row: [4, 0, 0, 0], gained: 4 })
  })
})

describe('g2048', () => {
  test('init places exactly two tiles with values 2 or 4; same seed same board', () => {
    const a = makeState(7)
    const b = makeState(7)
    const c = makeState(8)
    expect(tileCount(a)).toBe(2)
    for (const v of a.cells) {
      if (v !== 0) {
        expect(v === 2 || v === 4).toBe(true)
      }
    }
    expect(a.cells).toEqual(b.cells)
    expect(a.cells).not.toEqual(c.cells)
  })

  test('a move that changes nothing does not add a tile', () => {
    const s = makeState(1)
    s.cells = [2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0]
    const before = [...s.cells]
    g2048.key(s, { key: 'left' })
    expect(s.cells).toEqual(before)
    expect(tileCount(s)).toBe(3)
    expect(s.score).toBe(0)
  })

  test('moving left merges, scores, and adds one tile', () => {
    const s = makeState(3)
    s.cells = [
      2, 2, 4, 4,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]
    g2048.key(s, { key: 'left' })
    expect(s.cells.slice(0, 4)).toEqual([4, 8, 0, 0])
    expect(s.score).toBe(12)
    expect(tileCount(s)).toBe(3)
    expect(s.canUndo).toBe(true)
    expect(s.prev).not.toBeNull()
  })

  test('directional keys all work', () => {
    for (const k of ['right', 'up', 'down', 'w', 'a', 's', 'd', 'h', 'j', 'k', 'l', 'A', 'K']) {
      const s = makeState(5)
      s.cells = [
        2, 2, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
      ]
      const before = [...s.cells]
      g2048.key(s, { key: k })
      const changes = ['left', 'a', 'A', 'h', 'H', 'right', 'd', 'D', 'l', 'L', 'down', 's', 'S', 'j', 'J'].includes(k)
      if (changes) {
        expect(s.cells).not.toEqual(before)
      } else {
        expect(s.cells).toEqual(before)
      }
    }
    const s = makeState(5)
    s.cells = [
      2, 2, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]
    g2048.key(s, { key: 'H' })
    expect(s.cells.slice(0, 4)).toEqual([4, 0, 0, 0])
  })

  test('lost detection on a full board with no merges', () => {
    const s = makeState(9)
    s.cells = [
      2, 4, 2, 4,
      4, 2, 4, 2,
      2, 4, 2, 4,
      4, 2, 4, 2,
    ]
    g2048.key(s, { key: 'left' })
    expect(s.over).toBe(true)
    const frame = g2048.view(s, SIZE)
    expect(frame.status).toContain('no moves')
  })

  test('won detection when a 2048 appears; c dismisses', () => {
    const s = makeState(11)
    s.cells = [
      1024, 1024, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]
    g2048.key(s, { key: 'left' })
    expect(s.won).toBe(true)
    expect(g2048.view(s, SIZE).status).toContain('2048! keep going')
    g2048.key(s, { key: 'c' })
    expect(s.wonDismissed).toBe(true)
    expect(g2048.view(s, SIZE).status).not.toContain('2048!')
  })

  test('undo restores the previous board and score', () => {
    const s = makeState(13)
    s.cells = [
      2, 2, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]
    const snapshot = [...s.cells]
    g2048.key(s, { key: 'left' })
    expect(s.cells).not.toEqual(snapshot)
    g2048.key(s, { key: 'u' })
    expect(s.cells).toEqual(snapshot)
    expect(s.score).toBe(0)
    expect(s.canUndo).toBe(false)
  })

  test('best is tracked across restarts', () => {
    const s = makeState(17)
    s.cells = [
      2, 2, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]
    g2048.key(s, { key: 'left' })
    expect(s.score).toBe(4)
    expect(s.best).toBe(4)
    g2048.key(s, { key: 'r' })
    expect(s.score).toBe(0)
    expect(s.best).toBe(4)
    expect(tileCount(s)).toBe(2)
  })

  test('view: normal layout is 15 lines, all lineWidth 31', () => {
    const s = makeState(19)
    const frame = g2048.view(s, SIZE)
    expect(frame.lines.length).toBe(15)
    for (const line of frame.lines) {
      expect(lineWidth(line)).toBe(31)
    }
    expect(frame.status.startsWith('Score 0  Best 0')).toBe(true)
    expect(frame.help).toContain('drag with the mouse')
  })

  test('view: compact layout fits in 4 lines', () => {
    const s = makeState(23)
    const frame = g2048.view(s, SMALL)
    expect(frame.lines.length).toBe(4)
    for (const line of frame.lines) {
      expect(lineWidth(line)).toBe(27)
    }
  })
})

describe('g2048 directions', () => {
  // Regression: `down` once wrote its column back top-first, so it moved tiles up.
  const start = [2, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 8]
  const expected: Record<string, number[]> = {
    left: [2, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 8, 0, 0, 0],
    right: [0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 8],
    up: [4, 0, 0, 8, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    down: [0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 8],
  }
  for (const [dir, cells] of Object.entries(expected)) {
    test(`${dir} slides toward its own edge`, () => {
      const s = g2048.init({ seed: 1, size: { columns: 80, rows: 30 } })
      s.cells = [...start]
      g2048.key(s, { key: dir })
      // One new tile lands somewhere empty; everything else must match.
      const placed = s.cells.filter((v, i) => v !== cells[i])
      expect(placed.length).toBe(1)
      expect(s.cells.every((v, i) => v === cells[i] || cells[i] === 0)).toBe(true)
    })
  }
})

describe('g2048 mouse swipes', () => {
  const swipe = (s: G2048State, dx: number, dy: number) => {
    g2048.pointer!(s, { type: 'down', x: 10, y: 5, button: 'left' }, { columns: 80, rows: 30 })
    g2048.pointer!(s, { type: 'up', x: 10 + dx, y: 5 + dy, button: 'left' }, { columns: 80, rows: 30 })
  }

  test('a drag slides the way it went; a click does nothing', () => {
    const s = g2048.init({ seed: 1, size: { columns: 80, rows: 30 } })
    s.cells = [0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    swipe(s, 0, 0)
    expect(s.cells.filter(Boolean)).toHaveLength(1)
    swipe(s, -12, 1)
    expect(s.cells[0]).toBe(2)
    swipe(s, 1, 4)
    expect(s.cells[12]).toBe(2)
  })
})
