import { describe, expect, test } from 'bun:test'
import { minesweeper, type MinesweeperState } from '../../hooks/games/minesweeper'
import { lineWidth } from '../../hooks/games/cartridge'

function press(state: MinesweeperState, key: string): void {
  minesweeper.key(state, { key })
}

function revealAt(state: MinesweeperState, x: number, y: number): void {
  state.cursorX = x
  state.cursorY = y
  press(state, ' ')
}

function cellAt(state: MinesweeperState, x: number, y: number) {
  return state.cells[y * state.w + x]!
}

describe('minesweeper', () => {
  test('init picks the largest difficulty that fits', () => {
    const big = minesweeper.init({ seed: 1, size: { columns: 100, rows: 30 } })
    expect(big.difficulty).toBe(3)
    expect(big.w).toBe(30)
    expect(big.h).toBe(16)
    expect(big.mines).toBe(99)

    const small = minesweeper.init({ seed: 1, size: { columns: 40, rows: 15 } })
    expect(small.difficulty).toBe(1)
    expect(small.w).toBe(9)
    expect(small.h).toBe(9)
    expect(small.mines).toBe(10)

    const frame = minesweeper.view(big, { columns: 100, rows: 30 })
    expect(frame.lines.length).toBe(big.h + 2)
    for (const line of frame.lines) {
      expect(lineWidth(line)).toBe(big.w * 3 + 2)
    }
  })

  test('first reveal never hits a mine and opens clicked cell + neighbours', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const state = minesweeper.init({ seed, size: { columns: 100, rows: 30 } })
      const cx = Math.floor(state.w / 2)
      const cy = Math.floor(state.h / 2)
      revealAt(state, cx, cy)
      expect(state.lost).toBe(false)
      expect(cellAt(state, cx, cy).revealed).toBe(true)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          expect(cellAt(state, cx + dx, cy + dy).revealed).toBe(true)
        }
      }
    }
  })

  test('mine count after first reveal equals difficulty mine count', () => {
    for (const seed of [3, 7, 42]) {
      const state = minesweeper.init({ seed, size: { columns: 100, rows: 30 } })
      revealAt(state, 0, 0)
      let mines = 0
      for (const cell of state.cells) if (cell.mine) mines++
      expect(mines).toBe(99)
    }
  })

  test('flagging then revealing the same cell does nothing', () => {
    const state = minesweeper.init({ seed: 5, size: { columns: 40, rows: 15 } })
    const cx = 0
    const cy = 0
    revealAt(state, 4, 4)
    state.cursorX = cx
    state.cursorY = cy
    press(state, 'f')
    expect(cellAt(state, cx, cy).flagged).toBe(true)
    press(state, ' ')
    expect(cellAt(state, cx, cy).flagged).toBe(true)
    expect(cellAt(state, cx, cy).revealed).toBe(false)
    expect(state.lost).toBe(false)
  })

  test('revealing a mine loses', () => {
    const state = minesweeper.init({ seed: 9, size: { columns: 40, rows: 15 } })
    revealAt(state, 0, 0)
    expect(state.lost).toBe(false)
    const target = state.cells.findIndex((c) => !c.revealed && !c.flagged)
    state.cells[target]!.mine = true
    const x = target % state.w
    const y = Math.floor(target / state.w)
    revealAt(state, x, y)
    expect(state.lost).toBe(true)
    expect(state.hitIndex).toBe(target)
    let mines = 0
    for (const cell of state.cells) if (cell.mine) mines++
    for (const cell of state.cells) if (cell.mine) expect(cell.revealed).toBe(true)
    expect(mines).toBe(11)
  })

  test('revealing every non-mine cell wins and status contains Cleared', () => {
    const state = minesweeper.init({ seed: 11, size: { columns: 40, rows: 15 } })
    revealAt(state, 0, 0)
    for (let y = 0; y < state.h; y++) {
      for (let x = 0; x < state.w; x++) {
        const cell = cellAt(state, x, y)
        if (!cell.mine && !cell.revealed) {
          cell.revealed = true
        }
      }
    }
    revealAt(state, 0, 1)
    expect(state.won).toBe(true)
    for (const cell of state.cells) if (cell.mine) expect(cell.flagged).toBe(true)
    const frame = minesweeper.view(state, { columns: 40, rows: 15 })
    expect(frame.status).toContain('Cleared')
  })

  test('chord reveal works when flags match', () => {
    const state = minesweeper.init({ seed: 13, size: { columns: 40, rows: 15 } })
    // Hand-build a small deterministic position after first reveal.
    state.placed = true
    for (const cell of state.cells) {
      cell.mine = false
      cell.flagged = false
      cell.revealed = false
      cell.count = 0
    }
    const cx = 4
    const cy = 4
    const center = cellAt(state, cx, cy)
    center.count = 3
    center.revealed = true
    const hidden: Array<[number, number]> = []
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        hidden.push([cx + dx, cy + dy])
      }
    }
    for (const [x, y] of hidden.slice(0, 3)) cellAt(state, x, y).flagged = true
    revealAt(state, cx, cy)
    for (const [x, y] of hidden.slice(3)) {
      expect(cellAt(state, x, y).revealed).toBe(true)
    }
    expect(state.lost).toBe(false)
  })

  test('ticks before first reveal do not count; after they do', () => {
    const state = minesweeper.init({ seed: 17, size: { columns: 40, rows: 15 } })
    minesweeper.tick!(state)
    minesweeper.tick!(state)
    expect(state.seconds).toBe(0)
    revealAt(state, 0, 0)
    minesweeper.tick!(state)
    minesweeper.tick!(state)
    expect(state.seconds).toBe(2)
  })

  test('difficulty keys restart when they fit and are ignored otherwise', () => {
    const state = minesweeper.init({ seed: 19, size: { columns: 40, rows: 15 } })
    press(state, '2')
    expect(state.difficulty).toBe(1)
    press(state, '3')
    expect(state.difficulty).toBe(1)
    press(state, '1')
    expect(state.difficulty).toBe(1)
    expect(state.placed).toBe(false)

    const big = minesweeper.init({ seed: 19, size: { columns: 100, rows: 30 } })
    press(big, '2')
    expect(big.difficulty).toBe(2)
    expect(big.w).toBe(16)
    press(big, '3')
    expect(big.difficulty).toBe(3)
    expect(big.w).toBe(30)
  })

  test('r restarts and status format is right', () => {
    const state = minesweeper.init({ seed: 23, size: { columns: 40, rows: 15 } })
    revealAt(state, 0, 0)
    press(state, 'f')
    press(state, 'r')
    expect(state.placed).toBe(false)
    expect(state.seconds).toBe(0)
    expect(state.lost).toBe(false)
    const frame = minesweeper.view(state, { columns: 40, rows: 15 })
    expect(frame.status).toContain('Mines 10')
    expect(frame.status).toContain('Flags 0')
    expect(frame.status).toContain('Time 000')
    expect(frame.status).toContain('Beginner')
  })

  test('help line mentions mouse controls', () => {
    const state = minesweeper.init({ seed: 29, size: { columns: 40, rows: 15 } })
    const frame = minesweeper.view(state, { columns: 40, rows: 15 })
    expect(frame.help).toBe(
      'click reveal · right-click flag · arrows/hjkl move · space reveal · f flag · 1/2/3 size · r restart',
    )
  })

  describe('pointer', () => {
    function click(state: MinesweeperState, x: number, y: number, button?: 'left' | 'middle' | 'right'): void {
      minesweeper.pointer!(state, { type: 'down', x, y, button }, { columns: 40, rows: 15 })
    }

    test('left click on cell (2, 3) moves the cursor there and reveals it safely', () => {
      const state = minesweeper.init({ seed: 31, size: { columns: 40, rows: 15 } })
      // Frame coordinates: cell column 2 -> x = 1 + 2*3 = 7; cell row 3 -> y = 4.
      click(state, 7, 4)
      expect(state.cursorX).toBe(2)
      expect(state.cursorY).toBe(3)
      expect(state.lost).toBe(false)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          expect(cellAt(state, 2 + dx, 3 + dy).revealed).toBe(true)
        }
      }
    })

    test('right click toggles flag; left click on a flagged cell does nothing', () => {
      const state = minesweeper.init({ seed: 37, size: { columns: 40, rows: 15 } })
      click(state, 1, 1, 'right')
      expect(cellAt(state, 0, 0).flagged).toBe(true)
      expect(state.cursorX).toBe(0)
      expect(state.cursorY).toBe(0)
      click(state, 1, 1, 'right')
      expect(cellAt(state, 0, 0).flagged).toBe(false)
      click(state, 1, 1, 'right')
      click(state, 1, 1)
      expect(cellAt(state, 0, 0).flagged).toBe(true)
      expect(cellAt(state, 0, 0).revealed).toBe(false)
      expect(state.lost).toBe(false)
    })

    test('clicks on the border and outside the board do nothing', () => {
      const state = minesweeper.init({ seed: 41, size: { columns: 40, rows: 15 } })
      const before = { cursorX: state.cursorX, cursorY: state.cursorY }
      click(state, 0, 4)
      click(state, 20, 0)
      click(state, 20, 11)
      click(state, 40, 5)
      click(state, 7, -1)
      click(state, -3, 5)
      expect(state.cursorX).toBe(before.cursorX)
      expect(state.cursorY).toBe(before.cursorY)
      expect(state.cells.every((c) => !c.revealed && !c.flagged)).toBe(true)
    })

    test('after losing, a left click restarts', () => {
      const state = minesweeper.init({ seed: 43, size: { columns: 40, rows: 15 } })
      revealAt(state, 0, 0)
      const target = state.cells.findIndex((c) => !c.revealed && !c.flagged)
      state.cells[target]!.mine = true
      revealAt(state, target % state.w, Math.floor(target / state.w))
      expect(state.lost).toBe(true)
      click(state, 7, 4)
      expect(state.lost).toBe(false)
      expect(state.placed).toBe(false)
      expect(state.cells.every((c) => !c.revealed && !c.flagged)).toBe(true)
      expect(state.seconds).toBe(0)
    })

    test('move and up events change nothing', () => {
      const state = minesweeper.init({ seed: 47, size: { columns: 40, rows: 15 } })
      minesweeper.pointer!(state, { type: 'move', x: 7, y: 4 }, { columns: 40, rows: 15 })
      minesweeper.pointer!(state, { type: 'up', x: 7, y: 4 }, { columns: 40, rows: 15 })
      expect(state.cursorX).not.toBe(2)
      expect(state.cursorY).not.toBe(3)
      expect(state.cells.every((c) => !c.revealed && !c.flagged)).toBe(true)
    })
  })
})
