import { describe, expect, test } from 'bun:test'
import { lineWidth, type Frame, type InitContext, type Size } from '../../hooks/games/cartridge'
import { chip8, type Chip8State } from '../../hooks/games/chip8/index'
import { WIDTH } from '../../hooks/games/chip8/cpu'

const SMALL: Size = { columns: 80, rows: 24 }
const BIG: Size = { columns: 200, rows: 40 }

function init(over: Partial<InitContext> = {}): Chip8State {
  return chip8.init({ seed: 1, size: BIG, ...over })
}

function linesText(frame: Frame): string {
  return frame.lines.map((line) => line.map((span) => span.text).join('')).join('\n')
}

function runTicks(state: Chip8State, n: number): boolean[] {
  const results: boolean[] = []
  for (let i = 0; i < n; i++) results.push(chip8.tick!(state) === true)
  return results
}

describe('chip8 cartridge', () => {
  test('init without a ROM: no cpu, error message in view, tick returns false', () => {
    const state = init()
    expect(state.cpu).toBeNull()
    expect(state.error).toContain('No ROM loaded')
    const frame = chip8.view(state, BIG)
    expect(linesText(frame)).toContain('No ROM loaded')
    expect(chip8.tick!(state)).toBe(false)
    // also works in small (half-block) layout
    const small = chip8.view(state, SMALL)
    expect(linesText(small)).toContain('No ROM loaded')
  })

  test('tickrate clamps: 0 -> 1, 5000 -> 1000, missing -> 15', () => {
    const rom = new Uint8Array([0x12, 0x00])
    expect(init({ rom, romOptions: { tickrate: 0 } }).tickrate).toBe(1)
    expect(init({ rom, romOptions: { tickrate: 5000 } }).tickrate).toBe(1000)
    expect(init({ rom }).tickrate).toBe(15)
  })

  test('init with a tiny ROM creates a running cpu', () => {
    const state = init({ rom: new Uint8Array([0x12, 0x00]) })
    expect(state.cpu).not.toBeNull()
    expect(state.error).toBeNull()
  })

  test('key mapping: w/up -> 5, x -> 0, v -> F, space/return -> 6, W uppercase, unmapped ignored', () => {
    const mk = () => init({ rom: new Uint8Array([0x12, 0x00]) })

    let s = mk()
    chip8.key(s, { key: 'w' })
    expect(s.cpu!.keys[5]).toBe(true)

    s = mk()
    chip8.key(s, { key: 'up' })
    expect(s.cpu!.keys[5]).toBe(true)

    s = mk()
    chip8.key(s, { key: 'x' })
    expect(s.cpu!.keys[0]).toBe(true)

    s = mk()
    chip8.key(s, { key: 'v' })
    expect(s.cpu!.keys[0xf]).toBe(true)

    s = mk()
    chip8.key(s, { key: ' ' })
    expect(s.cpu!.keys[6]).toBe(true)

    s = mk()
    chip8.key(s, { key: 'return' })
    expect(s.cpu!.keys[6]).toBe(true)

    s = mk()
    chip8.key(s, { key: 'W' })
    expect(s.cpu!.keys[5]).toBe(true)

    s = mk()
    chip8.key(s, { key: 'm' })
    expect(s.cpu!.keys.every((k) => k === false)).toBe(true)
    expect(s.hold.every((h) => (h ?? 0) === 0)).toBe(true)
  })

  test('key hold: released after exactly 14 ticks; re-press while held keeps >= 6 more ticks', () => {
    const s = init({ rom: new Uint8Array([0x12, 0x00]) })
    chip8.key(s, { key: 'w' })
    expect(s.cpu!.keys[5]).toBe(true)
    // 13 ticks: still held
    runTicks(s, 13)
    expect(s.cpu!.keys[5]).toBe(true)
    // 14th tick releases it
    chip8.tick!(s)
    expect(s.cpu!.keys[5]).toBe(false)

    // second press while held extends the hold
    const s2 = init({ rom: new Uint8Array([0x12, 0x00]) })
    chip8.key(s2, { key: 'w' })
    runTicks(s2, 10)
    expect(s2.cpu!.keys[5]).toBe(true)
    chip8.key(s2, { key: 'w' }) // repeat while held
    for (let i = 0; i < 6; i++) {
      expect(s2.cpu!.keys[5]).toBe(true)
      chip8.tick!(s2)
    }
  })

  test('view sizes: the screen, then the on-screen pad when it fits', () => {
    const rom = new Uint8Array([0x12, 0x00])
    const state = init({ rom })
    // Big: 32 + 2 border lines, then a blank line and the 4x4 pad.
    const big = chip8.view(state, BIG)
    expect(big.lines.length).toBe(34 + 5)
    for (const line of big.lines.slice(0, 34)) expect(lineWidth(line)).toBe(130)

    // 80x24: the 18-line half-block screen and the pad just fit.
    const small = chip8.view(state, SMALL)
    expect(small.lines.length).toBe(18 + 5)
    for (const line of small.lines.slice(0, 18)) expect(lineWidth(line)).toBe(66)

    // 80x20: no room for the pad, so it is left out.
    expect(chip8.view(state, { columns: 80, rows: 20 }).lines.length).toBe(18)
  })

  test('half-block glyphs: top only -> ▀, both -> █, bottom only -> ▄', () => {
    const rom = new Uint8Array([0x12, 0x00])
    const s1 = init({ rom })
    s1.cpu!.display[0 * WIDTH + 0] = 1
    s1.cpu!.display[1 * WIDTH + 0] = 0
    const f1 = chip8.view(s1, SMALL)
    expect(f1.lines[1]![1]!.text[0]).toBe('▀')

    const s2 = init({ rom })
    s2.cpu!.display[0] = 1
    s2.cpu!.display[WIDTH] = 1
    const f2 = chip8.view(s2, SMALL)
    expect(f2.lines[1]![1]!.text[0]).toBe('█')

    const s3 = init({ rom })
    s3.cpu!.display[0] = 0
    s3.cpu!.display[WIDTH] = 1
    const f3 = chip8.view(s3, SMALL)
    expect(f3.lines[1]![1]!.text[0]).toBe('▄')
  })

  test('a drawing ROM: tick true on the drawing frame, false on idle frames', () => {
    const rom = new Uint8Array([0x60, 0x00, 0x61, 0x00, 0xa0, 0x50, 0xd0, 0x15, 0x12, 0x08])
    const s = init({ rom })
    expect(chip8.tick!(s)).toBe(true) // the frame the sprite is drawn
    expect(chip8.tick!(s)).toBe(false)
    expect(chip8.tick!(s)).toBe(false)
  })

  test('stack underflow halts the machine instead of throwing', () => {
    const rom = new Uint8Array([0x00, 0xee])
    const s = init({ rom })
    expect(() => chip8.tick!(s)).not.toThrow()
    expect(s.cpu!.halted).not.toBeNull()
    const frame = chip8.view(s, BIG)
    expect(frame.status).toContain('halted')
  })

  test('bundled ROMs run 300 ticks each without halting', async () => {
    const meta = (await Bun.file('roms/roms.json').json()) as Record<
      string,
      { tickrate?: number; quirks?: Record<string, boolean> }
    >
    const names = Object.keys(meta)
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      const file = Bun.file(`roms/${name}.ch8`)
      expect(await file.exists()).toBe(true)
      const rom = new Uint8Array(await file.arrayBuffer())
      const info = meta[name]!
      const state = init({ rom, romName: `${name}.ch8`, romOptions: { tickrate: info.tickrate, quirks: info.quirks } })
      expect(state.error).toBeNull()
      runTicks(state, 300)
      expect(state.cpu!.halted).toBeNull()
    }
  })
})

describe('chip8 cartridge in a short pane', () => {
  const SHORT: Size = { columns: 60, rows: 12 }
  const rom = new Uint8Array([0x12, 0x00])

  test('falls back to braille: 32x8 cells inside the border', () => {
    const state = chip8.init({ seed: 1, size: SHORT, rom })
    const frame = chip8.view(state, SHORT)
    expect(frame.lines).toHaveLength(10)
    for (const line of frame.lines) expect(lineWidth(line)).toBe(WIDTH / 2 + 2)
  })

  test('packs a 2x4 block of pixels into one braille cell', () => {
    const state = chip8.init({ seed: 1, size: SHORT, rom })
    const display = state.cpu!.display
    display[0] = 1 // (0,0) -> dot 1
    display[1] = 1 // (1,0) -> dot 4
    display[3 * WIDTH] = 1 // (0,3) -> dot 7
    const row = chip8.view(state, SHORT).lines[1]!
    const screen = row.map(span => span.text).join('')
    expect(screen[1]).toBe(String.fromCharCode(0x2800 + 0x01 + 0x08 + 0x40))
    expect(screen[2]).toBe(' ')
  })

  test('uses the ROM palette when its metadata has one', () => {
    const colors = { fill: '#ff84fe', background: '#ca2553' }
    const state = chip8.init({ seed: 1, size: SHORT, rom, romOptions: { colors, howto: 'Keys 7 and 9 slide.' } })
    const frame = chip8.view(state, SHORT)
    const screen = frame.lines[1]![1]!
    expect(screen.color).toBe(colors.fill)
    expect(screen.bg).toBe(colors.background)
    expect(frame.status).toContain('Keys 7 and 9 slide.')
  })
})

describe('chip8 on-screen buttons and number keys', () => {
  // Jump to self: the machine idles while we poke its keys.
  const rom = new Uint8Array([0x12, 0x00])
  const ROOM: Size = { columns: 100, rows: 30 }
  const howto = 'Keys 7 and 9 slide the paddle. Clear the bricks.'

  test('number keys press the pad key of the same digit', () => {
    const state = chip8.init({ seed: 1, size: ROOM, rom })
    chip8.key(state, { key: '7' })
    expect(state.cpu!.keys[7]).toBe(true)
    chip8.key(state, { key: '4' })
    expect(state.cpu!.keys[4]).toBe(true)
  })

  test('the buttons are the keys the how-to names, held while the mouse is down', () => {
    const state = chip8.init({ seed: 1, size: ROOM, rom, romOptions: { howto } })
    const frame = chip8.view(state, ROOM)
    const text = frame.lines.map(line => line.map(span => span.text).join(''))
    const row = text.findIndex(line => line.includes('◀ 7'))
    expect(row).toBeGreaterThan(17)
    expect(text[row]).toContain('▶ 9')
    expect(text[row]).not.toContain(' 5 ')

    const x = text[row]!.indexOf('◀ 7')
    chip8.pointer!(state, { type: 'down', x, y: row, button: 'left' }, ROOM)
    expect(state.cpu!.keys[7]).toBe(true)
    for (let i = 0; i < 60; i++) chip8.tick!(state)
    expect(state.cpu!.keys[7]).toBe(true)
    chip8.pointer!(state, { type: 'up', x: -5, y: -5, button: 'left' }, ROOM)
    expect(state.cpu!.keys[7]).toBe(false)
  })

  test('a click beside the buttons presses nothing', () => {
    const state = chip8.init({ seed: 1, size: ROOM, rom, romOptions: { howto } })
    chip8.pointer!(state, { type: 'down', x: 99, y: 19, button: 'left' }, ROOM)
    expect(state.cpu!.keys.some(Boolean)).toBe(false)
  })
})
