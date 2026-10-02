// Chess as a cartridge: you against Stockfish (when installed), a small
// built-in engine (when not), or a friend at the same keyboard.
import { type Cartridge, type HostRequest, type HostResponse, type Line, type Pointer, type Size, type Span, lineWidth } from '../cartridge'
import {
  type Move,
  type Outcome,
  type Position,
  START_FEN,
  colorOf,
  inCheck,
  legalMoves,
  makeMove,
  moveFromUci,
  moveToSan,
  outcome,
  parseFen,
  positionKey,
  toFen,
} from './rules'
import { searchBestMove } from './search'

/** Stockfish strengths offered; `null` is full strength. */
const LEVELS: { label: string; elo: number | null; movetimeMs: number }[] = [
  { label: 'Beginner (1320)', elo: 1320, movetimeMs: 300 },
  { label: 'Club (1600)', elo: 1600, movetimeMs: 400 },
  { label: 'Strong (2000)', elo: 2000, movetimeMs: 500 },
  { label: 'Master (2500)', elo: 2500, movetimeMs: 700 },
  { label: 'Full strength', elo: null, movetimeMs: 1000 },
]
const DEFAULT_LEVEL = 1
/** Ticks (100 ms) to wait for Stockfish before playing a built-in move instead. */
const ENGINE_TIMEOUT_TICKS = 150
/** Ticks before the built-in engine answers, so your move shows first. */
const BUILTIN_DELAY_TICKS = 3

const GLYPHS: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
const LETTERS: Record<string, string> = { k: 'K', q: 'Q', r: 'R', b: 'B', n: 'N', p: 'P' }

const COLORS = {
  light: '#d8c3a0',
  dark: '#a07a55',
  cursor: '#6c9a4c',
  selected: '#c9b84a',
  lastMove: '#b8a85a',
  target: '#3a5f2a',
  white: '#ffffff',
  black: '#101010',
  check: '#c0392b',
  dim: '#8b949e',
}

type Mode = 'stockfish' | 'builtin' | 'friend'

export type ChessState = {
  pos: Position
  /** Positions before each move, for undo. */
  past: Position[]
  /** Keys of every position so far, for repetition. */
  keys: string[]
  /** SAN of every move so far. */
  san: string[]
  lastMove: Move | null
  /** The side you play against the engine. */
  you: 'w' | 'b'
  mode: Mode
  level: number
  cursor: number
  selected: number | null
  /** A pawn move waiting for the promotion piece. */
  promoting: Move[] | null
  /** The square a mouse drag started on, while the button is down. */
  dragFrom: number | null
  /** The engine request in flight, if any. */
  thinking: { id: string; ticks: number } | null
  game: number
  ply: number
  letters: boolean
  note: string | null
  result: Outcome
}

export const chess: Cartridge<ChessState> = {
  id: 'chess',
  title: 'Chess',
  blurb: 'Play Stockfish (if installed) or a friend.',
  tickMs: 100,

  init({ seed }) {
    // Request ids carry the game number; starting from the seed keeps a late
    // answer for an earlier game from matching this one's.
    return newGame(seed, 'w', 'stockfish', DEFAULT_LEVEL, false)
  },

  key(state, { key }) {
    const k = key.length === 1 ? key.toLowerCase() : key
    if (state.promoting) {
      const piece = ({ q: 'q', r: 'r', b: 'b', n: 'n', return: 'q', ' ': 'q' } as const)[k as 'q']
      if (piece) {
        const move = state.promoting.find(m => m.promotion === piece)
        state.promoting = null
        if (move) play(state, move)
      } else if (k === 'escape' || k === 'x') {
        state.promoting = null
      }
      return
    }
    switch (k) {
      case 'n':
        Object.assign(state, newGame(state.game + 1, state.you, state.mode, state.level, state.letters))
        return
      case 'c':
        Object.assign(state, newGame(state.game + 1, state.you === 'w' ? 'b' : 'w', state.mode, state.level, state.letters))
        return
      case 'l':
        state.level = (state.level + 1) % LEVELS.length
        state.note = `Engine level: ${LEVELS[state.level]?.label}`
        return
      case 't':
        state.mode = state.mode === 'friend' ? 'stockfish' : 'friend'
        state.note = state.mode === 'friend' ? 'Two players: take turns at this keyboard.' : 'Playing the engine.'
        state.ply += 1 // a fresh request id; any late answer is ignored
        maybeThink(state)
        return
      case 'g':
        state.letters = !state.letters
        return
      case 'u':
        undo(state)
        return
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        moveCursor(state, k)
        return
      case 'w':
      case 'a':
      case 's':
      case 'd':
        moveCursor(state, ({ w: 'up', a: 'left', s: 'down', d: 'right' } as const)[k])
        return
      case ' ':
      case 'return':
        choose(state)
        return
      case 'x':
        state.selected = null
        return
    }
  },

  pointer(state, pointer, size) {
    onPointer(state, pointer, size)
  },

  tick(state) {
    const thinking = state.thinking
    if (!thinking) return false
    thinking.ticks += 1
    if (state.mode === 'builtin' && thinking.ticks >= BUILTIN_DELAY_TICKS) {
      builtinMove(state)
      return true
    }
    if (state.mode === 'stockfish' && thinking.ticks >= ENGINE_TIMEOUT_TICKS) {
      state.note = 'Stockfish did not answer; the built-in engine moved instead.'
      builtinMove(state)
      return true
    }
    // Redraw a few times a second for the thinking indicator.
    return thinking.ticks % 3 === 0
  },

  pendingRequest(state): HostRequest | undefined {
    if (state.mode !== 'stockfish' || !state.thinking) return undefined
    const level = LEVELS[state.level] ?? LEVELS[DEFAULT_LEVEL]!
    return {
      id: state.thinking.id,
      kind: 'stockfish',
      fen: toFen(state.pos),
      movetimeMs: level.movetimeMs,
      ...(level.elo === null ? {} : { elo: level.elo }),
    }
  },

  onResponse(state, response: HostResponse) {
    if (!state.thinking || response.id !== state.thinking.id) return
    const move = response.bestmove ? moveFromUci(state.pos, response.bestmove) : null
    if (move) {
      state.thinking = null
      play(state, move)
      return
    }
    // No Stockfish (or a bad answer): switch to the built-in engine for the rest of the game.
    state.mode = 'builtin'
    state.note =
      response.error === 'stockfish is not installed'
        ? 'Stockfish not found (brew install stockfish); using the built-in engine.'
        : `Stockfish failed (${response.error ?? 'no move'}); using the built-in engine.`
    builtinMove(state)
  },

  view(state, size) {
    return render(state, size)
  },
}

function newGame(game: number, you: 'w' | 'b', mode: Mode, level: number, letters: boolean): ChessState {
  const pos = parseFen(START_FEN)
  const state: ChessState = {
    pos,
    past: [],
    keys: [positionKey(pos)],
    san: [],
    lastMove: null,
    you,
    mode: mode === 'builtin' ? 'stockfish' : mode,
    level,
    cursor: you === 'w' ? 12 : 52, // e2 / e7
    selected: null,
    promoting: null,
    dragFrom: null,
    thinking: null,
    game,
    ply: 0,
    letters,
    note: null,
    result: { over: false },
  }
  if (mode === 'builtin') state.mode = 'builtin'
  maybeThink(state)

  return state
}

function isEngineTurn(state: ChessState): boolean {
  return state.mode !== 'friend' && !state.result.over && state.pos.turn !== state.you
}

function maybeThink(state: ChessState) {
  state.thinking = isEngineTurn(state) ? { id: `g${state.game}p${state.ply}`, ticks: 0 } : null
}

function play(state: ChessState, move: Move) {
  const san = moveToSan(state.pos, move)
  state.past.push(state.pos)
  state.pos = makeMove(state.pos, move)
  state.keys.push(positionKey(state.pos))
  state.san.push(san)
  state.lastMove = move
  state.selected = null
  state.ply += 1
  state.result = outcome(state.pos, state.keys)
  maybeThink(state)
}

function builtinMove(state: ChessState) {
  state.thinking = null
  const move = searchBestMove(state.pos, { depth: 3, maxNodes: 60_000 })
  if (move) play(state, move)
}

function undo(state: ChessState) {
  // Against the engine take back to your last move; with a friend, one move.
  const plies = state.mode === 'friend' ? 1 : state.pos.turn === state.you ? 2 : 1
  if (state.past.length < plies) return
  for (let i = 0; i < plies; i++) {
    state.pos = state.past.pop()!
    state.keys.pop()
    state.san.pop()
    state.ply += 1 // a fresh request id; any late answer is ignored
  }
  state.lastMove = null
  state.selected = null
  state.promoting = null
  state.result = outcome(state.pos, state.keys)
  maybeThink(state)
}

/** Which way the board is drawn: White at the bottom unless you play Black against the engine. */
function flipped(state: ChessState): boolean {
  return state.mode !== 'friend' && state.you === 'b'
}

function moveCursor(state: ChessState, dir: 'up' | 'down' | 'left' | 'right') {
  const sign = flipped(state) ? -1 : 1
  let file = state.cursor % 8
  let rank = Math.floor(state.cursor / 8)
  if (dir === 'up') rank += sign
  if (dir === 'down') rank -= sign
  if (dir === 'right') file += sign
  if (dir === 'left') file -= sign
  state.cursor = Math.max(0, Math.min(7, rank)) * 8 + Math.max(0, Math.min(7, file))
}

function choose(state: ChessState) {
  if (state.result.over || state.thinking) return
  const sq = state.cursor
  const piece = state.pos.board[sq]
  const mine = piece && colorOf(piece) === state.pos.turn
  if (state.selected === null || mine) {
    state.selected = mine ? sq : null
    return
  }
  const moves = legalMoves(state.pos).filter(m => m.from === state.selected && m.to === sq)
  if (moves.length === 0) {
    state.selected = null
    return
  }
  if (moves.length > 1) {
    state.promoting = moves
    return
  }
  play(state, moves[0]!)
}

/** Square size for the room: 6x3 cells looks square; shrink when the pane is small. */
function geometry(size: Size): { w: number; h: number } {
  const big = size.rows >= 26 && size.columns >= 6 * 8 + 3
  const medium = !big && size.rows >= 18 && size.columns >= 4 * 8 + 3

  return { w: big ? 6 : medium ? 4 : 3, h: big ? 3 : medium ? 2 : 1 }
}

/** The clickable row under the board: promotion choices while promoting, else the game's actions. */
function buttons(state: ChessState): { label: string; key: string; from: number; to: number }[] {
  const actions = state.promoting
    ? [
        { label: '♛ Queen', key: 'q' },
        { label: '♜ Rook', key: 'r' },
        { label: '♝ Bishop', key: 'b' },
        { label: '♞ Knight', key: 'n' },
        { label: 'Cancel', key: 'x' },
      ]
    : [
        { label: 'New game', key: 'n' },
        { label: 'Undo', key: 'u' },
        { label: 'Swap sides', key: 'c' },
        { label: state.mode === 'friend' ? 'vs engine' : '2 players', key: 't' },
        ...(state.mode === 'friend' ? [] : [{ label: 'Level', key: 'l' }]),
      ]
  let column = 2
  return actions.map(action => {
    const from = column
    column += action.label.length + 2 + 2
    return { ...action, from, to: from + action.label.length + 2 }
  })
}

/** The square under a frame position, or null off the board. */
function squareAt(state: ChessState, x: number, y: number, size: Size): number | null {
  const { w, h } = geometry(size)
  const col = Math.floor((x - 2) / w)
  const row = Math.floor(y / h)
  if (x < 2 || y < 0 || col > 7 || row > 7) return null
  const flip = flipped(state)

  return (flip ? row : 7 - row) * 8 + (flip ? 7 - col : col)
}

/** Click a piece then its target, or drag it there; click the buttons under the board. */
function onPointer(state: ChessState, { type, x, y, button }: Pointer, size: Size) {
  if (button === 'right') {
    if (type === 'down') state.selected = null
    return
  }
  const { h } = geometry(size)
  if (type === 'down' && y === 8 * h + 1) {
    const hit = buttons(state).find(b => x >= b.from && x < b.to)
    if (hit) chess.key(state, { key: hit.key })
    return
  }
  const sq = squareAt(state, x, y, size)
  if (type === 'down') {
    state.dragFrom = null
    if (sq === null || state.promoting) return
    state.cursor = sq
    choose(state)
    if (state.selected === sq) state.dragFrom = sq
  } else if (type === 'up') {
    const from = state.dragFrom
    state.dragFrom = null
    if (from !== null && sq !== null && sq !== from && state.selected === from) {
      state.cursor = sq
      choose(state)
    }
  }
}

function render(state: ChessState, size: Size) {
  const { w, h } = geometry(size)
  const flip = flipped(state)
  const targets = new Set(
    state.selected === null ? [] : legalMoves(state.pos).filter(m => m.from === state.selected).map(m => m.to),
  )
  const checked = inCheck(state.pos, state.pos.turn)
    ? state.pos.board.findIndex(p => p === (state.pos.turn === 'w' ? 'K' : 'k'))
    : -1

  const board: Line[] = []
  for (let row = 0; row < 8; row++) {
    const rank = flip ? row : 7 - row
    for (let sub = 0; sub < h; sub++) {
      const line: Line = [{ text: sub === Math.floor(h / 2) ? `${rank + 1} ` : '  ', color: COLORS.dim }]
      for (let col = 0; col < 8; col++) {
        const file = flip ? 7 - col : col
        const sq = rank * 8 + file
        line.push(squareSpan(state, sq, sub, w, h, targets, checked))
      }
      board.push(line)
    }
  }
  const files = 'abcdefgh'
  const fileRow = Array.from({ length: 8 }, (_, col) => {
    const f = files[flip ? 7 - col : col]!
    return f.padStart(Math.ceil(w / 2)).padEnd(w)
  }).join('')
  board.push([{ text: `  ${fileRow}`, color: COLORS.dim }])
  const row: Line = []
  let column = 0
  for (const b of buttons(state)) {
    row.push({ text: ' '.repeat(b.from - column) })
    row.push({ text: ` ${b.label} `, color: '#e6edf3', bg: state.promoting ? '#6e40c9' : '#30363d' })
    column = b.to
  }
  board.push(row)

  // Move list beside the board when there is room.
  const boardWidth = Math.max(...board.map(lineWidth))
  const side = sidePanel(state, board.length)
  const sideWidth = Math.max(...side.map(lineWidth))
  const lines: Line[] =
    size.columns >= boardWidth + 4 + 22
      ? board.map((line, i) => {
          const panel = side[i] ?? []
          const pad = ' '.repeat(Math.max(0, boardWidth - lineWidth(line)))
          return [...line, { text: `${pad}    ` }, ...panel, { text: ' '.repeat(sideWidth - lineWidth(panel)) }]
        })
      : board.map(line => [...line, { text: ' '.repeat(Math.max(0, boardWidth - lineWidth(line))) }])

  return { lines, status: status(state), help: help(state) }
}

function squareSpan(
  state: ChessState,
  sq: number,
  sub: number,
  w: number,
  h: number,
  targets: Set<number>,
  checked: number,
): Span {
  const light = (Math.floor(sq / 8) + (sq % 8)) % 2 === 1
  let bg = light ? COLORS.light : COLORS.dark
  const last = state.lastMove
  if (last && (last.from === sq || last.to === sq)) bg = COLORS.lastMove
  if (sq === checked) bg = COLORS.check
  if (sq === state.selected) bg = COLORS.selected
  if (sq === state.cursor && !state.result.over) bg = COLORS.cursor

  const middle = sub === Math.floor(h / 2)
  const piece = state.pos.board[sq]
  const pad = (s: string) => {
    const left = Math.floor((w - 1) / 2)
    return ' '.repeat(left) + s + ' '.repeat(w - 1 - left)
  }
  if (middle && piece) {
    const kind = piece.toLowerCase()
    const glyph = (state.letters ? LETTERS : GLYPHS)[kind] ?? '?'
    return { text: pad(glyph), bg, color: colorOf(piece) === 'w' ? COLORS.white : COLORS.black, bold: true }
  }
  if (middle && targets.has(sq)) {
    return { text: pad('•'), bg, color: COLORS.target }
  }

  return { text: ' '.repeat(w), bg }
}

function sidePanel(state: ChessState, rows: number): Line[] {
  const panel: Line[] = []
  const opponent =
    state.mode === 'friend'
      ? 'Two players'
      : state.mode === 'builtin'
        ? 'vs built-in engine'
        : `vs Stockfish · ${LEVELS[state.level]?.label}`
  panel.push([{ text: opponent, bold: true }])
  panel.push([{ text: state.mode === 'friend' ? '' : `You play ${state.you === 'w' ? 'White' : 'Black'}`, dim: true }])
  panel.push([])
  const pairs: string[] = []
  for (let i = 0; i < state.san.length; i += 2) {
    pairs.push(`${String(i / 2 + 1).padStart(3)}. ${(state.san[i] ?? '').padEnd(8)}${state.san[i + 1] ?? ''}`)
  }
  const room = Math.max(1, rows - panel.length)
  for (const pair of pairs.slice(-room)) {
    panel.push([{ text: pair, color: '#c9d1d9' }])
  }

  return panel
}

function status(state: ChessState): string {
  const r = state.result
  if (r.over) {
    const who = r.result === '1-0' ? 'White wins' : r.result === '0-1' ? 'Black wins' : 'Draw'
    return `${who} by ${r.reason} (${r.result}) — n for a new game`
  }
  if (state.promoting) return 'Promote to: q queen · r rook · b bishop · n knight'
  const side = state.pos.turn === 'w' ? 'White' : 'Black'
  const check = inCheck(state.pos, state.pos.turn) ? ' — check!' : ''
  const thinking = state.thinking ? ` · engine thinking${'.'.repeat((state.thinking.ticks % 9) / 3 + 1)}` : ''
  const note = state.note ? ` · ${state.note}` : ''

  return `${side} to move${check}${thinking}${note}`
}

function help(state: ChessState): string {
  if (state.promoting) return 'click a piece below, or q/r/b/n · x cancel'
  return 'click a piece, then where it goes (or drag it) · arrows/wasd + space work too · g letters'
}
