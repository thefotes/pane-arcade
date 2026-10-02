// CHIP-8 as a cartridge: the interpreter core plus keypad mapping and drawing.
import { type Cartridge, type Line, rng } from '../cartridge'
import { type Chip8, HEIGHT, WIDTH, createChip8, keyDown, keyUp, runFrame } from './cpu'

/**
 * The COSMAC VIP keypad on a QWERTY keyboard, as most emulators lay it out:
 *
 *   1 2 3 C      1 2 3 4
 *   4 5 6 D  ->  q w e r
 *   7 8 9 E      a s d f
 *   A 0 B F      z x c v
 *
 * Arrows map to the keys most games read as directions (5 up, 7 left, 8 down,
 * 9 right) and space/enter to 6, a common "action" key.
 */
const KEYMAP: Record<string, number> = {
  '1': 0x1, '2': 0x2, '3': 0x3, '4': 0xc,
  q: 0x4, w: 0x5, e: 0x6, r: 0xd,
  a: 0x7, s: 0x8, d: 0x9, f: 0xe,
  z: 0xa, x: 0x0, c: 0xb, v: 0xf,
  up: 0x5, left: 0x7, down: 0x8, right: 0x9,
  ' ': 0x6, return: 0x6,
}

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
  tickrate: number
  /** Frames each key stays held. */
  hold: number[]
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
      tickrate: Math.max(1, Math.min(1000, romOptions?.tickrate ?? DEFAULT_TICKRATE)),
      hold: new Array<number>(16).fill(0),
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

  tick(state) {
    const cpu = state.cpu
    if (!cpu || cpu.halted) return false
    state.frames += 1
    for (let k = 0; k < 16; k++) {
      const held = state.hold[k] ?? 0
      if (held > 0) {
        state.hold[k] = held - 1
        if (held === 1) keyUp(cpu, k)
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
    // Full blocks two columns wide when there is room, else half blocks (two pixels per cell).
    const big = size.columns >= WIDTH * 2 + 2 && size.rows >= HEIGHT + 2
    const across = big ? WIDTH * 2 : WIDTH
    const border = '#30363d'
    lines.push([{ text: `┌${'─'.repeat(across)}┐`, color: border }])
    if (cpu) {
      const on = (x: number, y: number) => cpu.display[y * WIDTH + x] === 1
      if (big) {
        for (let y = 0; y < HEIGHT; y++) {
          let row = ''
          for (let x = 0; x < WIDTH; x++) row += on(x, y) ? '██' : '  '
          lines.push(framed(row, border))
        }
      } else {
        for (let y = 0; y < HEIGHT; y += 2) {
          let row = ''
          for (let x = 0; x < WIDTH; x++) {
            const top = on(x, y)
            const bottom = on(x, y + 1)
            row += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' '
          }
          lines.push(framed(row, border))
        }
      }
    } else {
      const rows = big ? HEIGHT : HEIGHT / 2
      for (let y = 0; y < rows; y++) {
        const text = y === Math.floor(rows / 2) ? center(state.error ?? '', across) : ' '.repeat(across)
        lines.push(framed(text, border))
      }
    }
    lines.push([{ text: `└${'─'.repeat(across)}┘`, color: border }])

    const sound = cpu && cpu.sound > 0 ? '  ♪' : ''
    const halted = cpu?.halted ? `  · halted: ${cpu.halted}` : ''
    const waiting = cpu && cpu.waitingForKey !== -1 ? '  · waiting for a key' : ''

    return {
      lines,
      status: `${state.name}${sound}${waiting}${halted}${state.error && cpu ? `  · ${state.error}` : ''}`,
      help: 'keypad 1234/qwer/asdf/zxcv · arrows = 5/7/8/9 · space = 6 · p pause · backspace menu',
    }
  },
}

function framed(row: string, border: string): Line {
  return [
    { text: '│', color: border },
    { text: row, color: PHOSPHOR },
    { text: '│', color: border },
  ]
}

function center(text: string, width: number): string {
  const cut = text.slice(0, width)
  const left = Math.floor((width - cut.length) / 2)

  return ' '.repeat(left) + cut + ' '.repeat(width - cut.length - left)
}
