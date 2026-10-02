import { describe, expect, test } from 'bun:test'
import { legalMoves, moveFromUci, moveToUci, parseFen } from '../../hooks/games/chess/rules'
import { evaluate, searchBestMove } from '../../hooks/games/chess/search'

const START = parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')

describe('chess search', () => {
  test('start position returns a legal move within default budget', () => {
    const move = searchBestMove(START, { depth: 3 })
    expect(move).not.toBeNull()
    if (!move) return
    const legal = legalMoves(START)
    expect(legal.some((m) => m.from === move.from && m.to === move.to && m.promotion === move.promotion)).toBe(true)
  })

  test('finds mate in 1 (Rd1-d8)', () => {
    const pos = parseFen('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1')
    const move = searchBestMove(pos, { depth: 3 })
    expect(move).not.toBeNull()
    expect(moveToUci(move as NonNullable<typeof move>)).toBe('d1d8')
  })

  test('captures the hanging queen (Nf3xh4)', () => {
    const pos = parseFen('rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1')
    const move = searchBestMove(pos, { depth: 3 })
    expect(move).not.toBeNull()
    expect(moveToUci(move as NonNullable<typeof move>)).toBe('f3h4')
  })

  test('returns null when checkmated (fool’s mate)', () => {
    const pos = parseFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')
    const move = searchBestMove(pos, { depth: 3 })
    expect(move).toBeNull()
  })

  test('evaluate is symmetric at start and positive after black loses queen', () => {
    expect(evaluate(START)).toBe(0)

    const noQueen: typeof START.board = START.board.slice()
    noQueen[59] = null
    const pos = { ...START, board: noQueen }
    expect(evaluate(pos)).toBeGreaterThan(0)
  })

  test('kiwipete depth 3 with 60k nodes completes under 1000ms', () => {
    const pos = parseFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1')
    const start = performance.now()
    const move = searchBestMove(pos, { depth: 3, maxNodes: 60_000 })
    const elapsed = performance.now() - start
    expect(move).not.toBeNull()
    if (move) {
      expect(moveFromUci(pos, moveToUci(move))).not.toBeNull()
    }
    expect(elapsed).toBeLessThan(1000)
  })

  test('deterministic: same position and options give same move', () => {
    const a = searchBestMove(START, { depth: 2 })
    const b = searchBestMove(START, { depth: 2 })
    expect(a).toEqual(b)
  })
})
