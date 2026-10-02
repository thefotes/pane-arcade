export type Color = 'w' | 'b'
export type Piece = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K' | 'p' | 'n' | 'b' | 'r' | 'q' | 'k'

export type Position = {
  board: (Piece | null)[]
  turn: Color
  castling: { K: boolean; Q: boolean; k: boolean; q: boolean }
  ep: number | null
  halfmove: number
  fullmove: number
}

export type Move = {
  from: number
  to: number
  piece: Piece
  captured?: Piece
  promotion?: 'q' | 'r' | 'b' | 'n'
  flag?: 'ep' | 'castle-k' | 'castle-q' | 'double'
}

export type Outcome =
  | { over: false }
  | { over: true; result: '1-0' | '0-1' | '1/2-1/2'; reason: 'checkmate' | 'stalemate' | 'fifty-move' | 'insufficient' | 'repetition' }

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const FILE_CHARS = 'abcdefgh'
const PIECE_CHARS = 'PNBRQKpnbrqk'

const fileOf = (sq: number): number => sq & 7
const rankOf = (sq: number): number => sq >> 3
const onBoard = (f: number, r: number): boolean => f >= 0 && f < 8 && r >= 0 && r < 8

const KNIGHT_D: ReadonlyArray<readonly [number, number]> = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
]
const KING_D: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
]
const ROOK_D: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const BISHOP_D: ReadonlyArray<readonly [number, number]> = [[1, 1], [1, -1], [-1, 1], [-1, -1]]

export function squareName(sq: number): string {
  return FILE_CHARS.charAt(fileOf(sq)) + String(rankOf(sq) + 1)
}

export function parseSquare(name: string): number | null {
  if (name.length !== 2) return null
  const f = FILE_CHARS.indexOf(name.charAt(0))
  const r = name.charCodeAt(1) - 49
  if (f < 0 || r < 0 || r > 7) return null
  return r * 8 + f
}

export function colorOf(p: Piece): Color {
  return p === p.toUpperCase() ? 'w' : 'b'
}

export function parseFen(fen: string): Position {
  const parts = fen.trim().split(/\s+/)
  if (parts.length !== 6) throw new Error(`malformed FEN: expected 6 fields, got ${parts.length}`)
  const placement = parts[0] as string
  const turn = parts[1] as string
  const castling = parts[2] as string
  const ep = parts[3] as string
  const halfmove = Number(parts[4])
  const fullmove = Number(parts[5])

  if (turn !== 'w' && turn !== 'b') throw new Error(`malformed FEN: bad turn '${turn}'`)
  if (!Number.isInteger(halfmove) || halfmove < 0) throw new Error('malformed FEN: bad halfmove clock')
  if (!Number.isInteger(fullmove) || fullmove < 1) throw new Error('malformed FEN: bad fullmove number')

  const rows = placement.split('/')
  if (rows.length !== 8) throw new Error(`malformed FEN: expected 8 ranks, got ${rows.length}`)

  const board: (Piece | null)[] = new Array(64).fill(null)
  for (let i = 0; i < 8; i++) {
    const row = rows[i] as string
    let f = 0
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        f += Number(ch)
      } else if (PIECE_CHARS.indexOf(ch) >= 0) {
        if (f > 7) throw new Error(`malformed FEN: rank ${8 - i} overfull`)
        board[(7 - i) * 8 + f] = ch as Piece
        f++
      } else {
        throw new Error(`malformed FEN: bad character '${ch}'`)
      }
    }
    if (f !== 8) throw new Error(`malformed FEN: rank ${8 - i} has ${f} squares`)
  }

  const rights = { K: false, Q: false, k: false, q: false }
  if (castling !== '-') {
    for (const ch of castling) {
      if (ch === 'K') rights.K = true
      else if (ch === 'Q') rights.Q = true
      else if (ch === 'k') rights.k = true
      else if (ch === 'q') rights.q = true
      else throw new Error(`malformed FEN: bad castling field '${castling}'`)
    }
  }

  let epSq: number | null = null
  if (ep !== '-') {
    const s = parseSquare(ep)
    if (s === null) throw new Error(`malformed FEN: bad en-passant square '${ep}'`)
    epSq = s
  }

  return { board, turn, castling: rights, ep: epSq, halfmove, fullmove }
}

export function toFen(pos: Position): string {
  let placement = ''
  for (let r = 7; r >= 0; r--) {
    let empty = 0
    for (let f = 0; f < 8; f++) {
      const p = pos.board[r * 8 + f] ?? null
      if (p) {
        if (empty > 0) {
          placement += String(empty)
          empty = 0
        }
        placement += p
      } else {
        empty++
      }
    }
    if (empty > 0) placement += String(empty)
    if (r > 0) placement += '/'
  }
  let castling = ''
  if (pos.castling.K) castling += 'K'
  if (pos.castling.Q) castling += 'Q'
  if (pos.castling.k) castling += 'k'
  if (pos.castling.q) castling += 'q'
  return `${placement} ${pos.turn} ${castling || '-'} ${pos.ep === null ? '-' : squareName(pos.ep)} ${pos.halfmove} ${pos.fullmove}`
}

export function positionKey(pos: Position): string {
  const fen = toFen(pos)
  const parts = fen.split(' ')
  return `${parts[0]} ${parts[1]} ${parts[2]} ${parts[3]}`
}

export function isAttacked(pos: Position, sq: number, by: Color): boolean {
  const f = fileOf(sq)
  const r = rankOf(sq)
  const b = pos.board

  const pawn = by === 'w' ? 'P' : 'p'
  const pr = by === 'w' ? r - 1 : r + 1
  if (pr >= 0 && pr < 8) {
    if (f > 0 && b[pr * 8 + (f - 1)] === pawn) return true
    if (f < 7 && b[pr * 8 + (f + 1)] === pawn) return true
  }

  const kn = by === 'w' ? 'N' : 'n'
  for (const [df, dr] of KNIGHT_D) {
    const nf = f + df
    const nr = r + dr
    if (onBoard(nf, nr) && b[nr * 8 + nf] === kn) return true
  }

  const kg = by === 'w' ? 'K' : 'k'
  for (const [df, dr] of KING_D) {
    const nf = f + df
    const nr = r + dr
    if (onBoard(nf, nr) && b[nr * 8 + nf] === kg) return true
  }

  const rk = by === 'w' ? 'R' : 'r'
  const bi = by === 'w' ? 'B' : 'b'
  const qn = by === 'w' ? 'Q' : 'q'

  for (const [df, dr] of ROOK_D) {
    let nf = f + df
    let nr = r + dr
    while (onBoard(nf, nr)) {
      const p = b[nr * 8 + nf]
      if (p) {
        if (p === rk || p === qn) return true
        break
      }
      nf += df
      nr += dr
    }
  }

  for (const [df, dr] of BISHOP_D) {
    let nf = f + df
    let nr = r + dr
    while (onBoard(nf, nr)) {
      const p = b[nr * 8 + nf]
      if (p) {
        if (p === bi || p === qn) return true
        break
      }
      nf += df
      nr += dr
    }
  }

  return false
}

export function inCheck(pos: Position, color: Color): boolean {
  const king = color === 'w' ? 'K' : 'k'
  for (let sq = 0; sq < 64; sq++) {
    if (pos.board[sq] === king) {
      return isAttacked(pos, sq, color === 'w' ? 'b' : 'w')
    }
  }
  return false
}

function push(moves: Move[], move: Move): void {
  moves.push(move)
}

function pseudoMoves(pos: Position): Move[] {
  const moves: Move[] = []
  const board = pos.board
  const us = pos.turn
  const white = us === 'w'

  for (let from = 0; from < 64; from++) {
    const piece = board[from] ?? null
    if (!piece || colorOf(piece) !== us) continue
    const f = fileOf(from)
    const r = rankOf(from)
    const t = piece.toLowerCase() as 'p' | 'n' | 'b' | 'r' | 'q' | 'k'

    if (t === 'p') {
      const dir = white ? 8 : -8
      const startRank = white ? 1 : 6
      const promoRank = white ? 7 : 0
      const one = from + dir
      if (one >= 0 && one < 64 && !board[one]) {
        if (rankOf(one) === promoRank) {
          for (const promo of ['q', 'r', 'b', 'n'] as const) {
            push(moves, { from, to: one, piece, promotion: promo })
          }
        } else {
          push(moves, { from, to: one, piece })
          if (r === startRank) {
            const two = from + 2 * dir
            if (!board[two]) {
              push(moves, { from, to: two, piece, flag: 'double' })
            }
          }
        }
      }
      for (const df of [-1, 1]) {
        const nf = f + df
        const nr = r + (white ? 1 : -1)
        if (!onBoard(nf, nr)) continue
        const to = nr * 8 + nf
        const target = board[to] ?? null
        if (target && colorOf(target) !== us) {
          if (nr === promoRank) {
            for (const promo of ['q', 'r', 'b', 'n'] as const) {
              push(moves, { from, to, piece, captured: target, promotion: promo })
            }
          } else {
            push(moves, { from, to, piece, captured: target })
          }
        } else if (!target && pos.ep !== null && to === pos.ep) {
          const capSq = white ? to - 8 : to + 8
          const cap = board[capSq] ?? null
          push(moves, { from, to, piece, captured: cap ?? (white ? 'p' : 'P'), flag: 'ep' })
        }
      }
    } else if (t === 'n' || t === 'k') {
      const dirs = t === 'n' ? KNIGHT_D : KING_D
      for (const [df, dr] of dirs) {
        const nf = f + df
        const nr = r + dr
        if (!onBoard(nf, nr)) continue
        const to = nr * 8 + nf
        const target = board[to] ?? null
        if (target && colorOf(target) === us) continue
        push(moves, { from, to, piece, captured: target ?? undefined })
      }
    } else {
      const dirs = t === 'r' ? ROOK_D : t === 'b' ? BISHOP_D : t === 'q' ? [...ROOK_D, ...BISHOP_D] : []
      for (const [df, dr] of dirs) {
        let nf = f + df
        let nr = r + dr
        while (onBoard(nf, nr)) {
          const to = nr * 8 + nf
          const target = board[to] ?? null
          if (target) {
            if (colorOf(target) !== us) {
              push(moves, { from, to, piece, captured: target })
            }
            break
          }
          push(moves, { from, to, piece })
          nf += df
          nr += dr
        }
      }
    }
  }

  // Castling
  const enemy: Color = white ? 'b' : 'w'
  if (white) {
    if (pos.castling.K && board[4] === 'K' && board[7] === 'R' && !board[5] && !board[6]) {
      if (!isAttacked(pos, 4, enemy) && !isAttacked(pos, 5, enemy) && !isAttacked(pos, 6, enemy)) {
        push(moves, { from: 4, to: 6, piece: 'K', flag: 'castle-k' })
      }
    }
    if (pos.castling.Q && board[4] === 'K' && board[0] === 'R' && !board[1] && !board[2] && !board[3]) {
      if (!isAttacked(pos, 4, enemy) && !isAttacked(pos, 3, enemy) && !isAttacked(pos, 2, enemy)) {
        push(moves, { from: 4, to: 2, piece: 'K', flag: 'castle-q' })
      }
    }
  } else {
    if (pos.castling.k && board[60] === 'k' && board[63] === 'r' && !board[61] && !board[62]) {
      if (!isAttacked(pos, 60, enemy) && !isAttacked(pos, 61, enemy) && !isAttacked(pos, 62, enemy)) {
        push(moves, { from: 60, to: 62, piece: 'k', flag: 'castle-k' })
      }
    }
    if (pos.castling.q && board[60] === 'k' && board[56] === 'r' && !board[57] && !board[58] && !board[59]) {
      if (!isAttacked(pos, 60, enemy) && !isAttacked(pos, 59, enemy) && !isAttacked(pos, 58, enemy)) {
        push(moves, { from: 60, to: 58, piece: 'k', flag: 'castle-q' })
      }
    }
  }

  return moves
}

export function makeMove(pos: Position, move: Move): Position {
  const board = pos.board.slice()
  const piece = move.piece
  const us = colorOf(piece)
  const white = us === 'w'
  const isPawn = piece === 'P' || piece === 'p'

  board[move.from] = null
  if (move.promotion) {
    board[move.to] = (white ? move.promotion.toUpperCase() : move.promotion) as Piece
  } else {
    board[move.to] = piece
  }

  if (move.flag === 'ep') {
    board[white ? move.to - 8 : move.to + 8] = null
  } else if (move.flag === 'castle-k') {
    if (white) {
      board[5] = 'R'
      board[7] = null
    } else {
      board[61] = 'r'
      board[63] = null
    }
  } else if (move.flag === 'castle-q') {
    if (white) {
      board[3] = 'R'
      board[0] = null
    } else {
      board[59] = 'r'
      board[56] = null
    }
  }

  const castling = { ...pos.castling }
  if (piece === 'K') {
    castling.K = false
    castling.Q = false
  } else if (piece === 'k') {
    castling.k = false
    castling.q = false
  }
  if (move.from === 0 || move.to === 0) castling.Q = false
  if (move.from === 7 || move.to === 7) castling.K = false
  if (move.from === 56 || move.to === 56) castling.q = false
  if (move.from === 63 || move.to === 63) castling.k = false

  const ep = move.flag === 'double' ? (move.from + move.to) / 2 : null
  const halfmove = isPawn || move.captured !== undefined ? 0 : pos.halfmove + 1
  const fullmove = white ? pos.fullmove : pos.fullmove + 1

  return {
    board,
    turn: white ? 'b' : 'w',
    castling,
    ep,
    halfmove,
    fullmove,
  }
}

export function legalMoves(pos: Position): Move[] {
  const us = pos.turn
  const out: Move[] = []
  for (const m of pseudoMoves(pos)) {
    const next = makeMove(pos, m)
    if (!inCheck(next, us)) out.push(m)
  }
  return out
}

export function moveToUci(move: Move): string {
  return squareName(move.from) + squareName(move.to) + (move.promotion ?? '')
}

export function moveFromUci(pos: Position, uci: string): Move | null {
  if (uci.length !== 4 && uci.length !== 5) return null
  const from = parseSquare(uci.slice(0, 2))
  const to = parseSquare(uci.slice(2, 4))
  if (from === null || to === null) return null
  let promotion: 'q' | 'r' | 'b' | 'n' | undefined
  if (uci.length === 5) {
    const ch = uci.charAt(4).toLowerCase()
    if (ch !== 'q' && ch !== 'r' && ch !== 'b' && ch !== 'n') return null
    promotion = ch
  }
  for (const m of legalMoves(pos)) {
    if (m.from === from && m.to === to && m.promotion === promotion) return m
  }
  return null
}

export function moveToSan(pos: Position, move: Move): string {
  let san: string
  if (move.flag === 'castle-k') {
    san = 'O-O'
  } else if (move.flag === 'castle-q') {
    san = 'O-O-O'
  } else {
    const isCapture = move.flag === 'ep' || move.captured !== undefined
    const t = move.piece.toLowerCase()
    if (t === 'p') {
      san = isCapture
        ? `${FILE_CHARS.charAt(fileOf(move.from))}x${squareName(move.to)}`
        : squareName(move.to)
      if (move.promotion) san += `=${move.promotion.toUpperCase()}`
    } else {
      const letter = move.piece.toUpperCase()
      const others = legalMoves(pos).filter(
        (m) => m.piece === move.piece && m.to === move.to && m.from !== move.from,
      )
      let disamb = ''
      if (others.length > 0) {
        const sameFile = others.some((m) => fileOf(m.from) === fileOf(move.from))
        const sameRank = others.some((m) => rankOf(m.from) === rankOf(move.from))
        if (!sameFile) {
          disamb = FILE_CHARS.charAt(fileOf(move.from))
        } else if (!sameRank) {
          disamb = String(rankOf(move.from) + 1)
        } else {
          disamb = squareName(move.from)
        }
      }
      san = `${letter}${disamb}${isCapture ? 'x' : ''}${squareName(move.to)}`
    }
  }

  const next = makeMove(pos, move)
  if (inCheck(next, next.turn)) {
    san += legalMoves(next).length === 0 ? '#' : '+'
  }
  return san
}

export function outcome(pos: Position, history?: string[]): Outcome {
  const moves = legalMoves(pos)
  if (moves.length === 0) {
    if (inCheck(pos, pos.turn)) {
      return { over: true, result: pos.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate' }
    }
    return { over: true, result: '1/2-1/2', reason: 'stalemate' }
  }
  if (pos.halfmove >= 100) {
    return { over: true, result: '1/2-1/2', reason: 'fifty-move' }
  }

  const others: { piece: Piece; sq: number }[] = []
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board[sq] ?? null
    if (p && p !== 'K' && p !== 'k') others.push({ piece: p, sq })
  }
  const isMinor = (p: Piece) => p === 'b' || p === 'B' || p === 'n' || p === 'N'
  const heavy = others.some((o) => !isMinor(o.piece))
  if (!heavy) {
    if (others.length === 0) {
      return { over: true, result: '1/2-1/2', reason: 'insufficient' }
    }
    if (others.length === 1) {
      return { over: true, result: '1/2-1/2', reason: 'insufficient' }
    }
    if (others.length === 2) {
      const a = others[0] as { piece: Piece; sq: number }
      const b = others[1] as { piece: Piece; sq: number }
      const par = (o: { sq: number }) => (rankOf(o.sq) + fileOf(o.sq)) & 1
      if (
        (a.piece === 'b' || a.piece === 'B') &&
        (b.piece === 'b' || b.piece === 'B') &&
        par(a) === par(b)
      ) {
        return { over: true, result: '1/2-1/2', reason: 'insufficient' }
      }
    }
  }

  if (history) {
    const key = positionKey(pos)
    let count = 0
    for (const h of history) {
      if (h === key) count++
    }
    if (count >= 3) {
      return { over: true, result: '1/2-1/2', reason: 'repetition' }
    }
  }

  return { over: false }
}

export function perft(pos: Position, depth: number): number {
  if (depth <= 0) return 1
  const moves = legalMoves(pos)
  if (depth === 1) return moves.length
  let total = 0
  for (const m of moves) {
    total += perft(makeMove(pos, m), depth - 1)
  }
  return total
}
