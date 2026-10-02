import { describe, expect, test } from 'bun:test'
import { chess, type ChessState } from '../../hooks/games/chess/index'
import { parseFen, positionKey } from '../../hooks/games/chess/rules'
import type { HostResponse, Size } from '../../hooks/games/cartridge'

const ctx = { seed: 1, size: { columns: 100, rows: 30 } }
const s = () => chess.init(ctx) as ChessState

function playE2E4(state: ChessState) {
  chess.key(state, { key: ' ' }) // select e2
  expect(state.selected).toBe(12)
  chess.key(state, { key: 'up' })
  chess.key(state, { key: 'up' })
  expect(state.cursor).toBe(28) // e4
  chess.key(state, { key: ' ' }) // play e2e4
}

describe('chess cartridge', () => {
  test('1. init: white to move, you play white, cursor e2, no pending request', () => {
    const st = s()
    expect(st.pos.turn).toBe('w')
    expect(st.you).toBe('w')
    expect(st.mode).toBe('stockfish')
    expect(st.cursor).toBe(12)
    expect(st.selected).toBeNull()
    expect(st.san).toEqual([])
    expect(chess.pendingRequest?.(st)).toBeUndefined()
    expect(st.thinking).toBeNull()
  })

  test('2. playing e2e4 by keyboard asks stockfish', () => {
    const st = s()
    playE2E4(st)
    expect(st.san).toEqual(['e4'])
    expect(st.pos.turn).toBe('b')
    expect(st.thinking).not.toBeNull()
    const req = chess.pendingRequest?.(st)
    expect(req).toBeDefined()
    expect(req!.kind).toBe('stockfish')
    expect(req!.fen).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')
    expect(req!.elo).toBe(1600)
  })

  test('3. onResponse with matching id plays e7e5', () => {
    const st = s()
    playE2E4(st)
    const id = st.thinking!.id
    chess.onResponse?.(st, { id, kind: 'stockfish', bestmove: 'e7e5' })
    expect(st.san).toEqual(['e4', 'e5'])
    expect(st.pos.turn).toBe('w')
    expect(st.thinking).toBeNull()
    expect(chess.pendingRequest?.(st)).toBeUndefined()
  })

  test('4. onResponse with a different id is ignored', () => {
    const st = s()
    playE2E4(st)
    const id = st.thinking!.id
    chess.onResponse?.(st, { id: 'nope', kind: 'stockfish', bestmove: 'e7e5' })
    expect(st.san).toEqual(['e4'])
    expect(st.thinking!.id).toBe(id)
    expect(st.pos.turn).toBe('b')
  })

  test('5. failed stockfish response falls back to the builtin engine', () => {
    const st = s()
    playE2E4(st)
    const id = st.thinking!.id
    chess.onResponse?.(st, { id, kind: 'stockfish', bestmove: null, error: 'stockfish is not installed' })
    expect(st.mode).toBe('builtin')
    expect(st.note).toContain('Stockfish')
    expect(st.san.length).toBe(2) // builtin engine answered immediately
    expect(st.pos.turn).toBe('w')
    expect(st.thinking).toBeNull()
  })

  test('6. in builtin mode tick answers after 3 ticks', () => {
    const st2 = s()
    playE2E4(st2)
    chess.onResponse?.(st2, { id: st2.thinking!.id, kind: 'stockfish', bestmove: null, error: 'stockfish is not installed' })
    expect(st2.mode).toBe('builtin')
    expect(st2.san.length).toBe(2)
    // White plays d2d4
    st2.cursor = 11
    chess.key(st2, { key: ' ' })
    st2.cursor = 19
    chess.key(st2, { key: ' ' })
    expect(st2.san.length).toBe(3)
    expect(st2.thinking).not.toBeNull()
    expect(chess.tick!(st2)).toBe(false) // tick 1
    expect(chess.tick!(st2)).toBe(false) // tick 2
    expect(chess.tick!(st2)).toBe(true) // tick 3: engine replies
    expect(st2.san.length).toBe(4)
    expect(st2.thinking).toBeNull()
  })

  test('7. illegal destination clears selection; own piece reselects', () => {
    const st = s()
    chess.key(st, { key: ' ' }) // select e2
    expect(st.selected).toBe(12)
    chess.key(st, { key: 'up' })
    chess.key(st, { key: 'up' })
    chess.key(st, { key: 'up' }) // e5
    chess.key(st, { key: ' ' }) // e2e5 is illegal
    expect(st.selected).toBeNull()
    expect(st.san).toEqual([])
    expect(st.pos.board[20]).toBeNull()
    // select e2 again, then d2: selection switches
    chess.key(st, { key: 'down' })
    chess.key(st, { key: 'down' })
    chess.key(st, { key: 'down' })
    chess.key(st, { key: ' ' })
    expect(st.selected).toBe(12)
    chess.key(st, { key: 'left' })
    chess.key(st, { key: ' ' })
    expect(st.selected).toBe(11)
    expect(st.san).toEqual([])
  })

  test('8. l cycles level (wraps), t two-player, c new game as black', () => {
    const st = s()
    expect(st.level).toBe(1)
    chess.key(st, { key: 'l' })
    expect(st.level).toBe(2)
    chess.key(st, { key: 'l' })
    chess.key(st, { key: 'l' })
    chess.key(st, { key: 'l' })
    expect(st.level).toBe(0) // wrapped

    // t: two-player mode, no engine requests
    chess.key(st, { key: 't' })
    expect(st.mode).toBe('friend')
    expect(chess.pendingRequest?.(st)).toBeUndefined()
    expect(st.thinking).toBeNull()
    chess.key(st, { key: 't' })
    expect(st.mode).toBe('stockfish')

    // c: new game playing black; engine (white) is asked to move
    const st2 = s()
    chess.key(st2, { key: 'c' })
    expect(st2.you).toBe('b')
    expect(st2.pos.turn).toBe('w')
    expect(st2.thinking).not.toBeNull()
    const req = chess.pendingRequest?.(st2)
    expect(req).toBeDefined()
    expect(req!.fen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    expect(req!.elo).toBe(1600)
  })

  test('9. undo takes back both your move and the engine reply', () => {
    const st = s()
    playE2E4(st)
    chess.onResponse?.(st, { id: st.thinking!.id, kind: 'stockfish', bestmove: 'e7e5' })
    expect(st.san).toEqual(['e4', 'e5'])
    chess.key(st, { key: 'u' })
    expect(st.san).toEqual([])
    expect(st.keys.length).toBe(1)
    expect(st.pos.turn).toBe('w')
    expect(st.pos.board[12]).toBe('P')
    expect(st.pos.board[52]).toBe('p')
  })

  test('10. promotion: 4 choices, n promotes to knight', () => {
    const st = s()
    st.pos = parseFen('8/P6k/8/8/8/8/8/K7 w - - 0 1')
    st.keys = [positionKey(st.pos)]
    st.mode = 'friend'
    st.cursor = 48 // a7
    chess.key(st, { key: ' ' })
    expect(st.selected).toBe(48)
    chess.key(st, { key: 'up' })
    expect(st.cursor).toBe(56) // a8
    chess.key(st, { key: ' ' })
    expect(st.promoting).not.toBeNull()
    expect(st.promoting!.length).toBe(4)
    chess.key(st, { key: 'n' })
    expect(st.promoting).toBeNull()
    expect(st.pos.board[56]).toBe('N')
    expect(st.san).toEqual(['a8=N'])
  })

  test("11. fool's mate ends the game: Black wins", () => {
    const st = s()
    st.mode = 'friend'
    const moves: [number, number][] = [
      [13, 21], // f2f3
      [52, 36], // e7e5
      [14, 30], // g2g4
      [59, 31], // Qd8h4#
    ]
    for (const [from, to] of moves) {
      st.cursor = from
      chess.key(st, { key: ' ' })
      st.cursor = to
      chess.key(st, { key: ' ' })
    }
    expect(st.san).toEqual(['f3', 'e5', 'g4', 'Qh4#'])
    expect(st.result.over).toBe(true)
    const frame = chess.view(st, { columns: 100, rows: 30 })
    expect(frame.status).toContain('Black wins')
  })

  test('12. view lines share one lineWidth', () => {
    const st = s()
    const big: Size = { columns: 100, rows: 30 }
    const frame = chess.view(st, big)
    const widths = frame.lines.map(line => line.reduce((n, span) => n + [...span.text].length, 0))
    expect(new Set(widths).size).toBe(1)

    const small: Size = { columns: 40, rows: 12 }
    const frame2 = chess.view(st, small)
    const widths2 = frame2.lines.map(line => line.reduce((n, span) => n + [...span.text].length, 0))
    expect(new Set(widths2).size).toBe(1)
  })
})

describe('chess with the mouse', () => {
  const room: Size = { columns: 100, rows: 30 } // 6x3 squares; board columns start at x = 2
  const at = (file: number, rankFromTop: number) => ({ x: 2 + file * 6 + 3, y: rankFromTop * 3 + 1 })
  const click = (st: ReturnType<typeof chess.init>, p: { x: number; y: number }, type: 'down' | 'up' = 'down') =>
    chess.pointer!(st, { type, ...p, button: 'left' }, room)

  test('click a piece, then its target', () => {
    const st = chess.init({ seed: 1, size: room })
    click(st, at(4, 6)) // e2
    expect(st.selected).toBe(12)
    click(st, at(4, 4)) // e4
    expect(st.san).toEqual(['e4'])
  })

  test('drag a piece onto its target', () => {
    const st = chess.init({ seed: 1, size: room })
    click(st, at(6, 7)) // g1
    click(st, at(5, 5), 'up') // release on f3
    expect(st.san).toEqual(['Nf3'])
  })

  test('the buttons under the board act like their keys', () => {
    const st = chess.init({ seed: 1, size: room })
    const text = chess.view(st, room).lines[25]!.map(span => span.text).join('')
    const x = text.indexOf('2 players')
    expect(x).toBeGreaterThan(0)
    click(st, { x, y: 25 })
    expect(st.mode).toBe('friend')
  })
})
