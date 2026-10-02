import type { Color, Move, Piece, Position } from './rules'
import { colorOf, inCheck, legalMoves, makeMove } from './rules'

const MATE = 100000
const MAX_QUIESCE = 4

const PIECE_VALUE: Record<string, number> = {
  P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000,
  p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000,
}

const val = (p: Piece): number => PIECE_VALUE[p] ?? 0

// Piece-square tables written from white's perspective with rank 8 first
// (index 0 = a8 ... 63 = h1). For a white piece on square sq (a1 = 0),
// the table index is sq ^ 56; for black it is sq directly.
const PST_PAWN: readonly number[] = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
]
const PST_KNIGHT: readonly number[] = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
]
const PST_BISHOP: readonly number[] = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20,
]
const PST_ROOK: readonly number[] = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10, 10, 10, 10, 10,  5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   0,  0,  0,  5,  5,  0,  0,  0,
]
const PST_QUEEN: readonly number[] = [
  -20,-10,-10, -5, -5,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5,  5,  5,  5,  0,-10,
   -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
  -10,  5,  5,  5,  5,  5,  0,-10,
  -10,  0,  5,  0,  0,  0,  0,-10,
  -20,-10,-10, -5, -5,-10,-10,-20,
]
const PST_KING: readonly number[] = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20,
]

const PST: Record<string, readonly number[]> = {
  P: PST_PAWN, N: PST_KNIGHT, B: PST_BISHOP, R: PST_ROOK, Q: PST_QUEEN, K: PST_KING,
  p: PST_PAWN, n: PST_KNIGHT, b: PST_BISHOP, r: PST_ROOK, q: PST_QUEEN, k: PST_KING,
}

const pst = (p: Piece, sq: number): number => {
  const table = PST[p]
  if (!table) return 0
  const idx = colorOf(p) === 'w' ? sq ^ 56 : sq
  return table[idx] ?? 0
}

export function evaluate(pos: Position): number {
  let score = 0
  const board = pos.board
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq]
    if (!p) continue
    if (colorOf(p) === 'w') score += val(p) + pst(p, sq)
    else score -= val(p) + pst(p, sq)
  }
  return pos.turn === 'w' ? score : -score
}

function moveOrderScore(m: Move): number {
  let s = 0
  if (m.captured !== undefined) {
    s += 1_000_000 + val(m.captured) * 16 - val(m.piece)
  }
  if (m.promotion !== undefined) {
    s += 500_000 + val(m.promotion.toUpperCase() as Piece)
  }
  return s
}

function orderMoves(moves: Move[], first?: Move): Move[] {
  const rest = moves.filter((m) => m !== first)
  rest.sort((a, b) => moveOrderScore(b) - moveOrderScore(a))
  return first ? [first, ...rest] : rest
}

class SearchAborted extends Error {}

type Ctx = {
  nodes: number
  limit: number
}

function countMove(ctx: Ctx): void {
  ctx.nodes++
  if (ctx.nodes > ctx.limit) throw new SearchAborted()
}

function quiesce(ctx: Ctx, pos: Position, alpha: number, beta: number, qdepth: number): number {
  const stand = evaluate(pos)
  if (stand >= beta) return stand
  if (stand > alpha) alpha = stand
  if (qdepth >= MAX_QUIESCE) return alpha

  const captures = legalMoves(pos).filter((m) => m.captured !== undefined)
  captures.sort((a, b) => moveOrderScore(b) - moveOrderScore(a))

  for (const m of captures) {
    countMove(ctx)
    const next = makeMove(pos, m)
    const score = -quiesce(ctx, next, -beta, -alpha, qdepth + 1)
    if (score >= beta) return score
    if (score > alpha) alpha = score
  }
  return alpha
}

function negamax(ctx: Ctx, pos: Position, depth: number, alpha: number, beta: number, ply: number): number {
  if (depth <= 0) {
    if (inCheck(pos, pos.turn) && legalMoves(pos).length === 0) {
      return -MATE + ply
    }
    return quiesce(ctx, pos, alpha, beta, 0)
  }

  const moves = legalMoves(pos)
  if (moves.length === 0) {
    return inCheck(pos, pos.turn) ? -MATE + ply : 0
  }

  const ordered = orderMoves(moves)
  for (const m of ordered) {
    countMove(ctx)
    const next = makeMove(pos, m)
    const score = -negamax(ctx, next, depth - 1, -beta, -alpha, ply + 1)
    if (score >= beta) return score
    if (score > alpha) alpha = score
  }
  return alpha
}

export function searchBestMove(pos: Position, opts: { depth: number; maxNodes?: number }): Move | null {
  const moves = legalMoves(pos)
  if (moves.length === 0) return null

  const maxNodes = opts.maxNodes ?? 50_000
  const ctx: Ctx = { nodes: 0, limit: Number.MAX_SAFE_INTEGER }
  let best: Move | null = null

  for (let depth = 1; depth <= opts.depth; depth++) {
    if (ctx.nodes >= maxNodes) break
    ctx.limit = maxNodes
    let iterBest: Move | null = null
    let iterScore = -Infinity
    let alpha = -Infinity
    try {
      const ordered = orderMoves(moves, best ?? undefined)
      for (const m of ordered) {
        countMove(ctx)
        const next = makeMove(pos, m)
        const score = -negamax(ctx, next, depth - 1, -Infinity, -alpha, 1)
        if (score > iterScore) {
          iterScore = score
          iterBest = m
        }
        if (score > alpha) alpha = score
      }
    } catch (e) {
      if (e instanceof SearchAborted) {
        // Depth iteration aborted: discard partial results, keep last completed depth.
        iterBest = null
      } else {
        throw e
      }
    }
    if (iterBest !== null) {
      best = iterBest
    } else if (best === null && depth === 1) {
      // Even a partial depth-1 search: fall back to the first legal move.
      best = moves[0] ?? null
      break
    }
  }

  return best ?? moves[0] ?? null
}
