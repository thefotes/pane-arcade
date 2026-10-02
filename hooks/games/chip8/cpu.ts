import type { Chip8Quirks } from '../cartridge'

export const WIDTH = 64
export const HEIGHT = 32

const FONT = [
  0xf0, 0x90, 0x90, 0x90, 0xf0, // 0
  0x20, 0x60, 0x20, 0x20, 0x70, // 1
  0xf0, 0x10, 0xf0, 0x80, 0xf0, // 2
  0xf0, 0x10, 0xf0, 0x10, 0xf0, // 3
  0x90, 0x90, 0xf0, 0x10, 0x10, // 4
  0xf0, 0x80, 0xf0, 0x10, 0xf0, // 5
  0xf0, 0x80, 0xf0, 0x90, 0xf0, // 6
  0xf0, 0x10, 0x20, 0x40, 0x40, // 7
  0xf0, 0x90, 0xf0, 0x90, 0xf0, // 8
  0xf0, 0x90, 0xf0, 0x10, 0xf0, // 9
  0xf0, 0x90, 0xf0, 0x90, 0x90, // A
  0xe0, 0x90, 0xe0, 0x90, 0xe0, // B
  0xf0, 0x80, 0x80, 0x80, 0xf0, // C
  0xe0, 0x90, 0x90, 0x90, 0xe0, // D
  0xf0, 0x80, 0xf0, 0x80, 0xf0, // E
  0xf0, 0x80, 0xf0, 0x80, 0x80, // F
]

const DEFAULT_QUIRKS: Chip8Quirks = {
  shift: false,
  loadStore: false,
  clip: false,
  jump: false,
  logic: false,
  vfOrder: false,
}

function lcg(): () => number {
  let s = 1 >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

export type Chip8 = {
  memory: Uint8Array
  v: Uint8Array
  i: number
  pc: number
  stack: number[]
  delay: number
  sound: number
  display: Uint8Array
  keys: boolean[]
  waitingForKey: number
  waitPressed: number
  drawn: boolean
  quirks: Chip8Quirks
  random: () => number
  halted: string | null
}

export function createChip8(
  rom: Uint8Array,
  quirks?: Partial<Chip8Quirks>,
  random?: () => number,
): Chip8 {
  if (rom.length > 4096 - 0x200) throw new Error('ROM too large')
  const memory = new Uint8Array(4096)
  memory.set(FONT, 0x050)
  memory.set(rom, 0x200)
  return {
    memory,
    v: new Uint8Array(16),
    i: 0,
    pc: 0x200,
    stack: [],
    delay: 0,
    sound: 0,
    display: new Uint8Array(WIDTH * HEIGHT),
    keys: new Array<boolean>(16).fill(false),
    waitingForKey: -1,
    waitPressed: -1,
    drawn: false,
    quirks: { ...DEFAULT_QUIRKS, ...quirks },
    random: random ?? lcg(),
    halted: null,
  }
}

export function tickTimers(c: Chip8): void {
  if (c.delay > 0) c.delay--
  if (c.sound > 0) c.sound--
}

export function keyDown(c: Chip8, key: number): void {
  c.keys[key & 0xf] = true
}

export function keyUp(c: Chip8, key: number): void {
  c.keys[key & 0xf] = false
}

export function runFrame(c: Chip8, tickrate: number): void {
  for (let k = 0; k < tickrate; k++) step(c)
  tickTimers(c)
}

export function step(c: Chip8): void {
  if (c.halted !== null) return

  if (c.waitingForKey !== -1) {
    if (c.waitPressed === -1) {
      for (let k = 0; k < 16; k++) {
        if (c.keys[k]) {
          c.waitPressed = k
          break
        }
      }
    } else if (!c.keys[c.waitPressed]) {
      c.v[c.waitingForKey] = c.waitPressed
      c.waitingForKey = -1
      c.waitPressed = -1
    }
    return
  }

  const opcode = (rd(c.memory, c.pc) << 8) | rd(c.memory, c.pc + 1)
  c.pc = (c.pc + 2) & 0xfff

  const x = (opcode >> 8) & 0xf
  const y = (opcode >> 4) & 0xf
  const n = opcode & 0xf
  const nn = opcode & 0xff
  const nnn = opcode & 0xfff

  switch (opcode >> 12) {
    case 0x0:
      if (opcode === 0x00e0) {
        c.display.fill(0)
        c.drawn = true
      } else if (opcode === 0x00ee) {
        const addr = c.stack.pop()
        if (addr === undefined) throw new Error('stack underflow')
        c.pc = addr
      }
      break

    case 0x1:
      c.pc = nnn
      break

    case 0x2:
      c.stack.push(c.pc)
      if (c.stack.length > 16) throw new Error('stack overflow')
      c.pc = nnn
      break

    case 0x3:
      if (rd(c.v, x) === nn) c.pc = (c.pc + 2) & 0xfff
      break

    case 0x4:
      if (rd(c.v, x) !== nn) c.pc = (c.pc + 2) & 0xfff
      break

    case 0x5:
      if (n === 0) {
        if (rd(c.v, x) === rd(c.v, y)) c.pc = (c.pc + 2) & 0xfff
      } else halt(c, opcode)
      break

    case 0x6:
      c.v[x] = nn
      break

    case 0x7:
      c.v[x] = (rd(c.v, x) + nn) & 0xff
      break

    case 0x8:
      arith(c, opcode, x, y, n)
      break

    case 0x9:
      if (n === 0) {
        if (rd(c.v, x) !== rd(c.v, y)) c.pc = (c.pc + 2) & 0xfff
      } else halt(c, opcode)
      break

    case 0xa:
      c.i = nnn
      break

    case 0xb:
      c.pc = (nnn + rd(c.v, c.quirks.jump ? x : 0)) & 0xffff
      break

    case 0xc:
      c.v[x] = Math.floor(c.random() * 256) & nn
      break

    case 0xd:
      draw(c, x, y, n)
      break

    case 0xe:
      if (nn === 0x9e) {
        if (c.keys[rd(c.v, x) & 0xf]) c.pc = (c.pc + 2) & 0xfff
      } else if (nn === 0xa1) {
        if (!c.keys[rd(c.v, x) & 0xf]) c.pc = (c.pc + 2) & 0xfff
      } else halt(c, opcode)
      break

    case 0xf:
      switch (nn) {
        case 0x07:
          c.v[x] = c.delay
          break
        case 0x15:
          c.delay = rd(c.v, x)
          break
        case 0x18:
          c.sound = rd(c.v, x)
          break
        case 0x1e:
          c.i = (c.i + rd(c.v, x)) & 0xffff
          break
        case 0x0a:
          c.waitingForKey = x
          break
        case 0x29:
          c.i = 0x050 + (rd(c.v, x) & 0xf) * 5
          break
        case 0x33: {
          const val = rd(c.v, x)
          wr(c.memory, c.i, Math.floor(val / 100))
          wr(c.memory, c.i + 1, Math.floor(val / 10) % 10)
          wr(c.memory, c.i + 2, val % 10)
          break
        }
        case 0x55:
          for (let k = 0; k <= x; k++) wr(c.memory, c.i + k, rd(c.v, k))
          if (!c.quirks.loadStore) c.i = (c.i + x + 1) & 0xffff
          break
        case 0x65:
          for (let k = 0; k <= x; k++) c.v[k] = rd(c.memory, c.i + k)
          if (!c.quirks.loadStore) c.i = (c.i + x + 1) & 0xffff
          break
        default:
          halt(c, opcode)
      }
      break

    default:
      halt(c, opcode)
  }
}

function rd(a: Uint8Array, i: number): number {
  return a[i & a.length - 1] ?? 0
}

function wr(a: Uint8Array, i: number, val: number): void {
  a[i & a.length - 1] = val
}

function halt(c: Chip8, opcode: number): void {
  c.halted = `unknown opcode ${opcode.toString(16).toUpperCase().padStart(4, '0')} at ${((c.pc - 2) & 0xfff).toString(16).toUpperCase().padStart(3, '0')}`
}

function arith(c: Chip8, opcode: number, x: number, y: number, n: number): void {
  const vx = rd(c.v, x)
  const vy = rd(c.v, y)
  let result = 0
  let flag = 0

  switch (n) {
    case 0x0:
      c.v[x] = vy
      return
    case 0x1:
      c.v[x] = vx | vy
      if (c.quirks.logic) c.v[0xf] = 0
      return
    case 0x2:
      c.v[x] = vx & vy
      if (c.quirks.logic) c.v[0xf] = 0
      return
    case 0x3:
      c.v[x] = vx ^ vy
      if (c.quirks.logic) c.v[0xf] = 0
      return
    case 0x4:
      result = (vx + vy) & 0xff
      flag = vx + vy > 0xff ? 1 : 0
      break
    case 0x5:
      result = (vx - vy) & 0xff
      flag = vx >= vy ? 1 : 0
      break
    case 0x7:
      result = (vy - vx) & 0xff
      flag = vy >= vx ? 1 : 0
      break
    case 0x6: {
      const src = c.quirks.shift ? vx : vy
      result = src >> 1
      flag = src & 1
      break
    }
    case 0xe: {
      const src = c.quirks.shift ? vx : vy
      result = (src << 1) & 0xff
      flag = src >> 7
      break
    }
    default:
      halt(c, opcode)
      return
  }

  if (c.quirks.vfOrder) {
    c.v[0xf] = flag
    c.v[x] = result
  } else {
    c.v[x] = result
    c.v[0xf] = flag
  }
}

function draw(c: Chip8, x: number, y: number, n: number): void {
  const startX = rd(c.v, x) % WIDTH
  const startY = rd(c.v, y) % HEIGHT
  let erased = false

  for (let row = 0; row < n; row++) {
    const sprite = rd(c.memory, c.i + row)
    let py = startY + row
    if (py >= HEIGHT) {
      if (c.quirks.clip) break
      py = py % HEIGHT
    }
    for (let col = 0; col < 8; col++) {
      if ((sprite & (0x80 >> col)) === 0) continue
      let px = startX + col
      if (px >= WIDTH) {
        if (c.quirks.clip) continue
        px = px % WIDTH
      }
      const idx = py * WIDTH + px
      if (c.display[idx] === 1) {
        c.display[idx] = 0
        erased = true
      } else {
        c.display[idx] = 1
      }
    }
  }

  c.v[0xf] = erased ? 1 : 0
  c.drawn = true
}
