// CHIP-8 as a cartridge: the interpreter core plus keypad mapping and drawing.
import { type Cartridge, type Line, type Size, rng } from '../cartridge'
import { type Chip8, HEIGHT, WIDTH, createChip8, keyDown, keyUp, runFrame } from './cpu'

/**
 * The keyboard on the CHIP-8 keypad. Number keys are the pad's own digits, so a
 * game's "keys 7 and 9" are 7 and 9. Arrows map to the keys most games read as
 * directions (5 up, 7 left, 8 down, 9 right) and space/enter to 6, a common
 * "action" key. The letters lay the 4x4 pad out on QWERTY as most emulators do
 * (q w e r / a s d f / z x c v), which also reaches A-F:
 *
 *   1 2 3 C      1 2 3 4
 *   4 5 6 D  ->  q w e r
 *   7 8 9 E      a s d f
 *   A 0 B F      z x c v
 */
const KEYMAP: Record<string, number> = {
  '0': 0x0, '1': 0x1, '2': 0x2, '3': 0x3, '4': 0x4,
  '5': 0x5, '6': 0x6, '7': 0x7, '8': 0x8, '9': 0x9,
  q: 0x4, w: 0x5, e: 0x6, r: 0xd,
  a: 0x7, s: 0x8, d: 0x9, f: 0xe,
  z: 0xa, x: 0x0, c: 0xb, v: 0xf,
  up: 0x5, left: 0x7, down: 0x8, right: 0x9,
  ' ': 0x6, return: 0x6,
}

/** The pad as it is laid out, for the on-screen keypad when a ROM names no keys. */
const PAD_ROWS = [
  [0x1, 0x2, 0x3, 0xc],
  [0x4, 0x5, 0x6, 0xd],
  [0x7, 0x8, 0x9, 0xe],
  [0xa, 0x0, 0xb, 0xf],
]
/** Arrows on the on-screen buttons for the keys games use as directions. */
const ARROWS: Record<number, string> = { 0x5: '▲', 0x7: '◀', 0x8: '▼', 0x9: '▶' }
const BUTTON_WIDTH = 9

/**
 * Terminals report presses but not releases, so a press holds its key for a
 * while. The first press holds long enough to bridge the keyboard's auto-repeat
 * delay; each repeat while held extends it a little.
 */
const FIRST_HOLD_FRAMES = 14
const REPEAT_HOLD_FRAMES = 6
const DEFAULT_TICKRATE = 15
const PHOSPHOR = '#7ee787'

export type Chip8State = {
  cpu: Chip8 | null
  name: string
  howto: string | null
  fill: string
  background: string | undefined
  tickrate: number
  /** Frames each key stays held. */
  hold: number[]
  /** The on-screen button the mouse is holding down, if any. */
  pressed: number | null
  /** The pad keys the ROM's instructions name; empty means the whole pad. */
  padKeys: number[]
  frames: number
  error: string | null
}

export const chip8: Cartridge<Chip8State> = {
  id: 'chip8',
  title: 'CHIP-8',
  blurb: 'Run CHIP-8 ROMs: bundled CC0 games or your own.',
  tickMs: 16,

  init({ rom, romName, romOptions, seed }) {
    const state: Chip8State = {
      cpu: null,
      name: romName ?? 'no ROM',
      howto: romOptions?.howto ?? null,
      fill: romOptions?.colors?.fill ?? PHOSPHOR,
      background: romOptions?.colors?.background,
      tickrate: Math.max(1, Math.min(1000, romOptions?.tickrate ?? DEFAULT_TICKRATE)),
      hold: new Array<number>(16).fill(0),
      pressed: null,
      padKeys: keysIn(romOptions?.howto),
      frames: 0,
      error: null,
    }
    if (!rom) {
      state.error = 'No ROM loaded. Use /arcade load <path>.'
      return state
    }
    try {
      state.cpu = createChip8(rom, romOptions?.quirks, rng(seed))
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error)
    }

    return state
  },

  key(state, { key }) {
    const cpu = state.cpu
    const pad = KEYMAP[key.length === 1 ? key.toLowerCase() : key]
    if (!cpu || pad === undefined) return
    const held = state.hold[pad] ?? 0
    state.hold[pad] = held > 0 ? Math.max(held, REPEAT_HOLD_FRAMES) : FIRST_HOLD_FRAMES
    keyDown(cpu, pad)
  },

  pointer(state, { type, x, y, button }, size) {
    const cpu = state.cpu
    if (!cpu) return
    if (type === 'down' && button !== 'right') {
      const hit = layout(state, size).buttons.find(b => b.line === y && x >= b.from && x < b.to)
      if (hit) {
        release(state)
        state.pressed = hit.key
        keyDown(cpu, hit.key)
      }
    } else if (type === 'up') {
      release(state)
    }
  },

  tick(state) {
    const cpu = state.cpu
    if (!cpu || cpu.halted) return false
    state.frames += 1
    for (let k = 0; k < 16; k++) {
      const held = state.hold[k] ?? 0
      if (held > 0) {
        state.hold[k] = held - 1
        if (held === 1 && state.pressed !== k) keyUp(cpu, k)
      }
    }
    const beeping = cpu.sound > 0
    try {
      runFrame(cpu, state.tickrate)
    } catch (error) {
      // Stack faults throw; stop the machine like an unknown opcode does.
      cpu.halted = error instanceof Error ? error.message : String(error)
    }
    const changed = cpu.drawn || beeping !== cpu.sound > 0 || cpu.halted !== null
    cpu.drawn = false

    return changed
  },

  view(state, size) {
    const cpu = state.cpu
    const lines: Line[] = []
    const { mode, buttons, padLines } = layout(state, size)
    const across = mode === 'big' ? WIDTH * 2 : mode === 'half' ? WIDTH : WIDTH / 2
    const down = mode === 'big' ? HEIGHT : mode === 'half' ? HEIGHT / 2 : HEIGHT / 4
    const border = '#30363d'
    lines.push([{ text: `┌${'─'.repeat(across)}┐`, color: border }])
    if (cpu) {
      const on = (x: number, y: number) => cpu.display[y * WIDTH + x] === 1
      for (let cy = 0; cy < down; cy++) {
        let row = ''
        for (let cx = 0; cx < across; cx++) {
          if (mode === 'big') {
            row += on(cx >> 1, cy) ? '█' : ' '
          } else if (mode === 'half') {
            const top = on(cx, cy * 2)
            const bottom = on(cx, cy * 2 + 1)
            row += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' '
          } else {
            row += braille(on, cx * 2, cy * 4)
          }
        }
        lines.push(framed(row, border, state))
      }
    } else {
      for (let y = 0; y < down; y++) {
        const text = y === Math.floor(down / 2) ? center(state.error ?? '', across) : ' '.repeat(across)
        lines.push(framed(text, border, state))
      }
    }
    lines.push([{ text: `└${'─'.repeat(across)}┘`, color: border }])
    for (let i = 0; i < padLines; i++) {
      const line: Line = []
      let column = 0
      for (const b of buttons.filter(b => b.line === lines.length)) {
        line.push({ text: ' '.repeat(b.from - column) })
        const held = state.pressed === b.key || (cpu?.keys[b.key] ?? false)
        line.push({ text: b.label, color: '#e6edf3', bg: held ? '#6e40c9' : '#30363d', bold: held })
        column = b.to
      }
      lines.push(line)
    }

    const sound = cpu && cpu.sound > 0 ? '  ♪' : ''
    const halted = cpu?.halted ? `  · halted: ${cpu.halted}` : ''
    const waiting = cpu && cpu.waitingForKey !== -1 ? '  · waiting for a key' : ''

    const status = `${state.name}${sound}${waiting}${halted}${state.error && cpu ? `  · ${state.error}` : ''}`

    return {
      lines,
      status: state.howto ? `${status}  · ${state.howto}` : status,
      help: 'click & hold the buttons · number keys = pad keys · arrows = 5 7 8 9 · space = 6 · p pause · backspace menu',
    }
  },
}

type Button = { key: number; label: string; line: number; from: number; to: number }

/**
 * Where everything goes for a size: the screen mode, then a row of on-screen
 * buttons under it (the keys the ROM's instructions name, or the whole pad) when
 * there is room. `view` draws from it and `pointer` hit-tests against it.
 */
function layout(state: Chip8State, size: Size) {
  const rows = state.padKeys.length > 0 ? [state.padKeys] : PAD_ROWS
  const padLines = rows.length + 1
  const fits = (mode: 'big' | 'half' | 'braille', withPad: boolean) => {
    const across = mode === 'big' ? WIDTH * 2 : mode === 'half' ? WIDTH : WIDTH / 2
    const down = mode === 'big' ? HEIGHT : mode === 'half' ? HEIGHT / 2 : HEIGHT / 4
    return size.columns >= across + 2 && size.rows >= down + 2 + (withPad ? padLines : 0)
  }
  // The largest screen that fits: full blocks, else half blocks (2 pixels per
  // cell), else braille (2x4 per cell). The buttons go under it if they fit.
  const modes = ['big', 'half', 'braille'] as const
  const mode = modes.find(mode => fits(mode, false)) ?? 'braille'
  const withPad = fits(mode, true)
  const screenLines = (mode === 'big' ? HEIGHT : mode === 'half' ? HEIGHT / 2 : HEIGHT / 4) + 2
  const buttons: Button[] = []
  if (withPad) {
    rows.forEach((keys, r) => {
      keys.forEach((key, c) => {
        const from = 1 + c * (BUTTON_WIDTH + 2)
        const name = key.toString(16).toUpperCase()
        const text = ARROWS[key] ? `${ARROWS[key]} ${name}` : name
        const left = Math.floor((BUTTON_WIDTH - text.length) / 2)
        const label = ' '.repeat(left) + text + ' '.repeat(BUTTON_WIDTH - text.length - left)
        buttons.push({ key, label, line: screenLines + 1 + r, from, to: from + BUTTON_WIDTH })
      })
    })
  }

  return { mode, buttons, padLines: withPad ? padLines : 0 }
}

/** The pad keys a ROM's how-to names ("Keys 5 7 8 9 move", "Key 6 fires"), in order, no repeats. */
function keysIn(howto: string | undefined): number[] {
  const keys: number[] = []
  for (const sentence of (howto ?? '').split(/[.;]/)) {
    if (!/\bkeys?\b/i.test(sentence)) continue
    for (const token of sentence.match(/\b[0-9A-F]\b/g) ?? []) {
      const key = parseInt(token, 16)
      if (!keys.includes(key)) keys.push(key)
    }
  }

  return keys
}

function release(state: Chip8State) {
  if (state.pressed !== null && state.cpu && (state.hold[state.pressed] ?? 0) === 0) {
    keyUp(state.cpu, state.pressed)
  }
  state.pressed = null
}

function framed(row: string, border: string, state: Chip8State): Line {
  const screen: Line[number] = { text: row, color: state.fill }
  if (state.background) screen.bg = state.background

  return [{ text: '│', color: border }, screen, { text: '│', color: border }]
}

/** Braille dot bits for the 2x4 pixels of one cell, by [x][y]. */
const BRAILLE_DOTS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
]

function braille(on: (x: number, y: number) => boolean, x: number, y: number): string {
  let bits = 0
  for (let dx = 0; dx < 2; dx++) {
    for (let dy = 0; dy < 4; dy++) {
      if (on(x + dx, y + dy)) bits |= BRAILLE_DOTS[dx]![dy]!
    }
  }
  // An empty cell is a space, not U+2800, so the background shows evenly.
  return bits === 0 ? ' ' : String.fromCharCode(0x2800 + bits)
}

function center(text: string, width: number): string {
  const cut = text.slice(0, width)
  const left = Math.floor((width - cut.length) / 2)

  return ' '.repeat(left) + cut + ' '.repeat(width - cut.length - left)
}
