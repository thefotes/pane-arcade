import { describe, expect, test } from 'bun:test'
import {
  START_FEN,
  makeMove,
  moveFromUci,
  moveToSan,
  moveToUci,
  outcome,
  parseFen,
  perft,
  positionKey as keyOf,
  toFen,
} from '../../hooks/games/chess/rules'

const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'

describe('chess rules', () => {
  test('FEN round trip: start position', () => {
    expect(toFen(parseFen(START_FEN))).toBe(START_FEN)
  })

  test('FEN round trip: Kiwipete', () => {
    expect(toFen(parseFen(KIWIPETE))).toBe(KIWIPETE)
  })

  test('perft start position', () => {
    const pos = parseFen(START_FEN)
    expect(perft(pos, 1)).toBe(20)
    expect(perft(pos, 2)).toBe(400)
    expect(perft(pos, 3)).toBe(8902)
  })

  test('perft Kiwipete', () => {
    const pos = parseFen(KIWIPETE)
    expect(perft(pos, 1)).toBe(48)
    expect(perft(pos, 2)).toBe(2039)
  })

  test('perft position 3', () => {
    const pos = parseFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1')
    expect(perft(pos, 1)).toBe(14)
    expect(perft(pos, 2)).toBe(191)
    expect(perft(pos, 3)).toBe(2812)
  })

  test('perft position 4', () => {
    const pos = parseFen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1')
    expect(perft(pos, 1)).toBe(6)
    expect(perft(pos, 2)).toBe(264)
  })

  test('perft position 5', () => {
    const pos = parseFen('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8')
    expect(perft(pos, 1)).toBe(44)
    expect(perft(pos, 2)).toBe(1486)
  })

  test("fool's mate is checkmate 0-1", () => {
    let pos = parseFen(START_FEN)
    for (const uci of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) {
      const m = moveFromUci(pos, uci)
      expect(m).not.toBeNull()
      pos = makeMove(pos, m!)
    }
    const o = outcome(pos)
    expect(o).toEqual({ over: true, result: '0-1', reason: 'checkmate' })
  })

  test('stalemate position', () => {
    const pos = parseFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')
    expect(outcome(pos)).toEqual({ over: true, result: '1/2-1/2', reason: 'stalemate' })
  })

  test('SAN basics from start', () => {
    const pos = parseFen(START_FEN)
    const nf3 = moveFromUci(pos, 'g1f3')
    expect(nf3).not.toBeNull()
    expect(moveToSan(pos, nf3!)).toBe('Nf3')
    const e4 = moveFromUci(pos, 'e2e4')
    expect(e4).not.toBeNull()
    expect(moveToSan(pos, e4!)).toBe('e4')
  })

  test('SAN castling', () => {
    const pos = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')
    const ooo = moveFromUci(pos, 'e1c1')
    expect(ooo).not.toBeNull()
    expect(moveToSan(pos, ooo!)).toBe('O-O-O')
    const after = makeMove(pos, ooo!)
    const oo = moveFromUci(after, 'e8g8')
    expect(oo).not.toBeNull()
    expect(moveToSan(after, oo!)).toBe('O-O')
  })

  test('SAN promotion with check', () => {
    const pos = parseFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1')
    const m = moveFromUci(pos, 'a7a8q')
    expect(m).not.toBeNull()
    expect(moveToSan(pos, m!)).toBe('a8=Q+')
    expect(moveToUci(m!)).toBe('a7a8q')
  })

  test('SAN disambiguation', () => {
    const pos = parseFen('7k/8/8/8/8/8/8/KN3N2 w - - 0 1')
    const m = moveFromUci(pos, 'b1d2')
    expect(m).not.toBeNull()
    expect(moveToSan(pos, m!)).toBe('Nbd2')
  })

  test('moveFromUci rejects illegal moves', () => {
    const pos = parseFen(START_FEN)
    expect(moveFromUci(pos, 'e2e5')).toBeNull()
    expect(moveFromUci(pos, 'e1g1')).toBeNull()
    expect(moveFromUci(pos, 'zzzz')).toBeNull()
    const e4 = moveFromUci(pos, 'e2e4')
    expect(e4).not.toBeNull()
    expect(moveToUci(e4!)).toBe('e2e4')
  })

  test('insufficient material K v K', () => {
    const pos = parseFen('k7/8/8/8/8/8/8/K7 w - - 0 1')
    expect(outcome(pos)).toEqual({ over: true, result: '1/2-1/2', reason: 'insufficient' })
  })

  test('threefold repetition', () => {
    let pos = parseFen(START_FEN)
    const history: string[] = [keyOf(pos)]
    for (const uci of ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']) {
      const m = moveFromUci(pos, uci)
      expect(m).not.toBeNull()
      pos = makeMove(pos, m!)
      history.push(keyOf(pos))
    }
    expect(outcome(pos, history)).toEqual({ over: true, result: '1/2-1/2', reason: 'repetition' })
  })
})
