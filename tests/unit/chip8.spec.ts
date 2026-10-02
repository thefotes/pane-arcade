import { describe, expect, test } from 'bun:test'
import {
  createChip8,
  keyDown,
  keyUp,
  runFrame,
  step,
  tickTimers,
  WIDTH,
} from '../../hooks/games/chip8/cpu'

function prog(bytes: number[]): Uint8Array {
  return new Uint8Array(bytes)
}

describe('chip8 cpu', () => {
  test('6XNN/7XNN and 8XY4 carry', () => {
    const c = createChip8(
      prog([0x60, 0xff, 0x61, 0x02, 0x80, 0x14]),
      undefined,
      () => 0,
    )
    step(c)
    step(c)
    expect(c.v[0]).toBe(0xff)
    step(c)
    expect(c.v[0]).toBe(0x01)
    expect(c.v[0xf]).toBe(1)
  })

  test('8XY5 borrow flag both ways', () => {
    const a = createChip8(prog([0x60, 0x05, 0x61, 0x03, 0x80, 0x15]), undefined, () => 0)
    step(a); step(a); step(a)
    expect(a.v[0]).toBe(0x02)
    expect(a.v[0xf]).toBe(1)

    const b = createChip8(prog([0x60, 0x03, 0x61, 0x05, 0x80, 0x15]), undefined, () => 0)
    step(b); step(b); step(b)
    expect(b.v[0]).toBe(0xfe)
    expect(b.v[0xf]).toBe(0)
  })

  test('8XY7', () => {
    const c = createChip8(prog([0x60, 0x03, 0x61, 0x05, 0x80, 0x17]), undefined, () => 0)
    step(c); step(c); step(c)
    expect(c.v[0]).toBe(0x02)
    expect(c.v[0xf]).toBe(1)
  })

  test('8XY6 with and without shift quirk', () => {
    const no = createChip8(prog([0x60, 0x0a, 0x61, 0x04, 0x80, 0x16]), undefined, () => 0)
    step(no); step(no); step(no)
    expect(no.v[0]).toBe(0x02)
    expect(no.v[0xf]).toBe(0)

    const yes = createChip8(prog([0x60, 0x0a, 0x61, 0x04, 0x80, 0x16]), { shift: true }, () => 0)
    step(yes); step(yes); step(yes)
    expect(yes.v[0]).toBe(0x05)
    expect(yes.v[0xf]).toBe(0)
  })

  test('flag order: 8FF4 leaves VF as the flag by default', () => {
    const c = createChip8(prog([0x6f, 0xff, 0x8f, 0xf4]), undefined, () => 0)
    step(c)
    step(c)
    expect(c.v[0xf]).toBe(1)

    const q = createChip8(prog([0x6f, 0xff, 0x8f, 0xf4]), { vfOrder: true }, () => 0)
    step(q)
    step(q)
    expect(q.v[0xf]).toBe(0xfe)
  })

  test('call and return', () => {
    const c = createChip8(prog([0x62, 0x00, 0x22, 0x08, 0x60, 0x99, 0x00, 0x00, 0x60, 0x42, 0x00, 0xee]))
    step(c) // 6200
    step(c) // 2208: push pc=0x204, jump 0x208
    expect(c.pc).toBe(0x208)
    expect(c.stack).toEqual([0x204])
    step(c) // 6042
    step(c) // 00EE: pop, pc=0x204
    expect(c.pc).toBe(0x204)
    expect(c.stack).toEqual([])
    step(c) // 6099 (instruction after the call)
    expect(c.v[0]).toBe(0x99)
  })

  test('DXYN draws font "0" at (0,0), erases on redraw', () => {
    const c = createChip8(prog([0x60, 0x00, 0x61, 0x00, 0xf0, 0x29, 0xd0, 0x05]), undefined, () => 0)
    step(c); step(c); step(c)
    step(c)
    expect(c.drawn).toBe(true)
    c.drawn = false
    // top row of glyph 0: F0 = pixels 0-3 on
    for (let px = 0; px < 4; px++) expect(c.display[px]).toBe(1)
    expect(c.display[4]).toBe(0)
    // second row: 90 -> pixel 0 and 3
    expect(c.display[WIDTH + 0]).toBe(1)
    expect(c.display[WIDTH + 3]).toBe(1)
    expect(c.display[WIDTH + 4]).toBe(0)
    expect(c.v[0xf]).toBe(0)
    // redraw erases
    c.pc = 0x200 + 6
    step(c)
    expect(c.display[0]).toBe(0)
    expect(c.v[0xf]).toBe(1)
  })

  test('sprite wrapping vs clipping at x=62', () => {
    const rom = prog([0x60, 62, 0x61, 0x00, 0xa0, 0x50, 0xd0, 0x11])
    const wrap = createChip8(rom, undefined, () => 0)
    step(wrap); step(wrap); step(wrap); step(wrap)
    expect(wrap.display[62]).toBe(1)
    expect(wrap.display[63]).toBe(1)
    expect(wrap.display[0]).toBe(1)
    expect(wrap.display[1]).toBe(1)
    expect(wrap.display[2]).toBe(0)

    const clip = createChip8(new Uint8Array(rom), { clip: true }, () => 0)
    step(clip); step(clip); step(clip); step(clip)
    expect(clip.display[62]).toBe(1)
    expect(clip.display[63]).toBe(1)
    expect(clip.display[0]).toBe(0)
    expect(clip.display[1]).toBe(0)
  })

  test('FX33 BCD of 254', () => {
    const c = createChip8(prog([0x60, 0xfe, 0xa2, 0x00, 0xf0, 0x33]), undefined, () => 0)
    step(c); step(c); step(c)
    expect(c.memory[0x200]).toBe(2)
    expect(c.memory[0x201]).toBe(5)
    expect(c.memory[0x202]).toBe(4)
  })

  test('FX55/FX65 with and without loadStore quirk', () => {
    const no = createChip8(
      prog([0x60, 0x11, 0x61, 0x22, 0xa2, 0x00, 0xf2, 0x55]),
      undefined,
      () => 0,
    )
    step(no); step(no); step(no)
    step(no) // FX55: I becomes 0x203
    expect(no.memory[0x200]).toBe(0x11)
    expect(no.memory[0x201]).toBe(0x22)
    expect(no.i).toBe(0x203)
    step(no) // a2 00
    step(no) // FX65 loads back, I becomes 0x203 again
    expect(no.v[0]).toBe(0x11)
    expect(no.v[1]).toBe(0x22)
    expect(no.i).toBe(0x203)

    const yes = createChip8(
      prog([0x60, 0x11, 0x61, 0x22, 0xa2, 0x00, 0xf2, 0x55, 0xf2, 0x65]),
      { loadStore: true },
      () => 0,
    )
    step(yes); step(yes); step(yes)
    step(yes) // FX55: I unchanged
    step(yes) // FX65: I unchanged
    expect(yes.i).toBe(0x200)
    expect(yes.v[0]).toBe(0x11)
    expect(yes.v[1]).toBe(0x22)
  })

  test('FX0A waits for key down then up', () => {
    const c = createChip8(prog([0xf0, 0x0a, 0x00, 0x00]), undefined, () => 0)
    step(c)
    expect(c.waitingForKey).toBe(0)
    expect(c.pc).toBe(0x202)
    step(c) // still nothing held
    expect(c.v[0]).toBe(0)
    keyDown(c, 5)
    step(c) // registers press
    expect(c.waitPressed).toBe(5)
    step(c) // key still held; not complete
    expect(c.pc).toBe(0x202)
    keyUp(c, 5)
    step(c) // release completes
    expect(c.v[0]).toBe(5)
    expect(c.waitingForKey).toBe(-1)
    expect(c.waitPressed).toBe(-1)
    step(c) // resumes: 0000 no-op
    expect(c.pc).toBe(0x204)
  })

  test('timers decrement once per frame', () => {
    const c = createChip8(prog([0x60, 0x05, 0xf0, 0x15]), undefined, () => 0)
    step(c); step(c)
    expect(c.delay).toBe(5)
    runFrame(c, 15)
    expect(c.delay).toBe(4)
  })

  test('unknown opcode halts', () => {
    const c = createChip8(prog([0xf0, 0xff, 0x60, 0x01]), undefined, () => 0)
    step(c)
    expect(c.halted).toMatch(/^unknown opcode F0FF at 200$/)
    step(c)
    expect(c.v[0]).toBe(0)
  })

  test('stack underflow/overflow', () => {
    const under = createChip8(prog([0x00, 0xee]))
    expect(() => step(under)).toThrow('stack underflow')
    const over = createChip8(
      prog(Array.from({ length: 20 }, () => [0x22, 0x10]).flat()),
    )
    expect(() => {
      for (let k = 0; k < 20; k++) step(over)
    }).toThrow('stack overflow')
  })
})

describe('bundled ROMs run 600 frames', () => {
  const romNames = [
    'br8kout',
    'caveexplorer',
    'chipwar',
    'dinorun',
    'flightrunner',
    'fuse',
    'mastermind',
    'mini-lights-out',
    'octojam1title',
    'outlaw',
    'slipperyslope',
    'superpong',
  ]

  for (const name of romNames) {
    test(name, async () => {
      const buf = await Bun.file(`roms/${name}.ch8`).arrayBuffer()
      const c = createChip8(new Uint8Array(buf), undefined)
      for (let f = 0; f < 600; f++) runFrame(c, 15)
      expect(c.halted).toBeNull()
    })
  }
})
