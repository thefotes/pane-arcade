// The arcade's surface module: runs on the drawing thread, owns the running
// cartridge, takes keys, keeps time with the frame clock and draws. It has no
// `$`; anything that needs the host (ROM files, Stockfish) is posted to the
// hooks module, whose answers come back as props.
import type { ClientKeyEvent, ClientSurface } from 'claude-code'

import type { Cartridge, Frame, HostRequest, HostResponse, Key, Line, RomOptions, Size } from './games/cartridge'
import { CARTRIDGES } from './games/index'

type Props = {
  launch: { game: string; rom?: string; romName?: string; romOptions?: RomOptions; nonce: number } | null
  busy: boolean
  response: HostResponse | null
  roms: { name: string; title: string }[]
  /** Keys typed into the pane's key field, for surfaces where the Client cannot take the keyboard. */
  keys: { seq: number; key: string }[]
}

type MenuItem = { label: string; blurb: string; game: string; rom?: string }

type World = {
  screen: 'menu' | 'game'
  menuIndex: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cart?: Cartridge<any>
  game?: unknown
  title: string
  paused: boolean
  launchNonce: number
  /** The last forwarded key handled. */
  keySeq: number
  responseId: string | null
  postedId: string | null
  frames: number
  error: string | null
  props: Props
  post: (data: { type: 'host'; request: HostRequest } | { type: 'rom'; name: string }) => void
}

type View = { world: World; v: number }

/** The frame clock's period; cartridge tick rates are rounded to whole frames. */
const FRAME_MS = 16
/** Rows the harness draws around a cartridge's lines: header, status, help. */
const CHROME_ROWS = 3

export default function Arcade(props: Props, surface: ClientSurface<View>) {
  let view = surface.state
  if (view === undefined) {
    const world: World = {
      screen: 'menu',
      menuIndex: 0,
      title: 'Arcade',
      paused: false,
      launchNonce: 0,
      // Keys typed before this instance mounted are not replayed.
      keySeq: props.keys[props.keys.length - 1]?.seq ?? 0,
      responseId: null,
      postedId: null,
      frames: 0,
      error: null,
      props,
      post: data => surface.post(data),
    }
    let version = 0
    const redraw = () => surface.setState({ world, v: ++version })
    surface.onKey(key => {
      if (onKey(world, normalize(key), size(surface))) {
        redraw()
      }
    })
    surface.every(FRAME_MS, () => {
      if (onFrame(world)) {
        redraw()
      }
    })
    view = { world, v: 0 }
    surface.setState(view)
  }

  const world = view.world
  world.props = props
  takeProps(world, props, size(surface))

  return draw(world, surface)
}

/** Room for a cartridge's lines, from the region the pane gave us. */
function size(surface: ClientSurface<View>): Size {
  const columns = surface.columns > 0 ? surface.columns : 80
  const rows = surface.rows > 0 ? surface.rows : 26

  return { columns, rows: Math.max(8, rows - CHROME_ROWS) }
}

function normalize(event: ClientKeyEvent): Key {
  const names: Record<string, string> = { space: ' ', enter: 'return', esc: 'escape' }
  const key: Key = { key: names[event.key] ?? event.key }
  if (event.ctrl) key.ctrl = true
  if (event.shift) key.shift = true
  if (event.meta) key.meta = true

  return key
}

function menuItems(world: World): MenuItem[] {
  const items: MenuItem[] = CARTRIDGES.filter(c => c.id !== 'chip8').map(c => ({
    label: c.title,
    blurb: c.blurb,
    game: c.id,
  }))
  for (const rom of world.props.roms) {
    items.push({ label: `CHIP-8 · ${rom.title}`, blurb: `${rom.name}.ch8`, game: 'chip8', rom: rom.name })
  }

  return items
}

/** Starts a launch or a host answer that arrived as new props. */
function takeProps(world: World, props: Props, room: Size) {
  const launch = props.launch
  if (launch && launch.nonce !== world.launchNonce) {
    world.launchNonce = launch.nonce
    if (launch.game === 'menu') {
      world.screen = 'menu'
    } else {
      const rom = launch.rom ? Uint8Array.fromBase64(launch.rom) : undefined
      startGame(world, launch.game, room, rom, launch.romName, launch.romOptions)
    }
  }

  for (const typed of props.keys) {
    if (typed.seq > world.keySeq) {
      world.keySeq = typed.seq
      onKey(world, { key: typed.key }, room)
    }
  }

  const response = props.response
  if (response && response.id !== world.responseId) {
    world.responseId = response.id
    if (world.screen === 'game' && world.cart?.onResponse) {
      guard(world, () => world.cart?.onResponse?.(world.game, response))
      postPending(world)
    }
  }
}

function startGame(
  world: World,
  id: string,
  room: Size,
  rom?: Uint8Array,
  romName?: string,
  romOptions?: RomOptions,
) {
  const cart = CARTRIDGES.find(c => c.id === id)
  if (!cart) {
    world.error = `No game called ${id}`
    return
  }
  world.error = null
  world.cart = cart
  world.title = romName ? `${cart.title} · ${romName}` : cart.title
  world.paused = false
  world.screen = 'game'
  world.postedId = null
  const seed = (Math.random() * 0xffffffff) >>> 0
  guard(world, () => {
    world.game = cart.init({ seed, size: room, rom, romName, romOptions })
  })
  postPending(world)
}

/** Handles one key; true when the screen should redraw. */
function onKey(world: World, key: Key, room: Size): boolean {
  if (world.screen === 'menu') {
    return menuKey(world, key, room)
  }
  if (key.key === 'backspace' || key.key === 'delete') {
    world.screen = 'menu'
    return true
  }
  if (key.key === 'p' && !key.ctrl) {
    world.paused = !world.paused
    return true
  }
  if (world.paused || !world.cart || world.error) {
    return false
  }
  guard(world, () => world.cart?.key(world.game, key))
  postPending(world)

  return true
}

function menuKey(world: World, key: Key, room: Size): boolean {
  const items = menuItems(world)
  const count = Math.max(1, items.length)
  switch (key.key) {
    case 'up':
    case 'k':
      world.menuIndex = (world.menuIndex - 1 + count) % count
      return true
    case 'down':
    case 'j':
      world.menuIndex = (world.menuIndex + 1) % count
      return true
    case 'return':
    case ' ': {
      const item = items[world.menuIndex]
      if (!item) return false
      if (item.rom) {
        // The hooks module reads the file and answers with a launch.
        world.post({ type: 'rom', name: item.rom })
        return false
      }
      startGame(world, item.game, room)
      return true
    }
    default: {
      const n = Number(key.key)
      if (Number.isInteger(n) && n >= 1 && n <= items.length) {
        world.menuIndex = n - 1
        return menuKey(world, { key: 'return' }, room)
      }
      return false
    }
  }
}

/** Advances the running cartridge on the frame clock; true when it changed. */
function onFrame(world: World): boolean {
  world.frames += 1
  const cart = world.cart
  if (world.screen !== 'game' || world.paused || world.error || !cart?.tick || !cart.tickMs) {
    return false
  }
  const every = Math.max(1, Math.round(cart.tickMs / FRAME_MS))
  if (world.frames % every !== 0) {
    return false
  }
  let changed = true
  guard(world, () => {
    changed = cart.tick?.(world.game) !== false
  })
  postPending(world)

  return changed || world.error !== null
}

function postPending(world: World) {
  if (world.screen !== 'game' || !world.cart?.pendingRequest) return
  let pending: HostRequest | undefined
  guard(world, () => {
    pending = world.cart?.pendingRequest?.(world.game)
  })
  if (pending && pending.id !== world.postedId) {
    world.postedId = pending.id
    world.post({ type: 'host', request: pending })
  }
}

/** Runs cartridge code; a throw stops the game with a message instead of unmounting the pane. */
function guard(world: World, fn: () => void) {
  try {
    fn()
  } catch (error) {
    world.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  }
}

function draw(world: World, surface: ClientSurface<View>) {
  const { Box, Text } = surface.elements
  const room = size(surface)
  const busy = world.props.busy
  const claude = busy
    ? { text: '● Claude is working', color: '#d29922' }
    : { text: '◆ Claude is waiting for you', color: '#3fb950' }

  let frame: Frame
  if (world.screen === 'menu') {
    frame = menuFrame(world)
  } else if (world.error) {
    frame = { lines: [[{ text: world.error, color: '#ff7b72' }]], status: 'The game crashed.', help: 'backspace menu' }
  } else {
    frame = { lines: [], status: '', help: '' }
    guard(world, () => {
      frame = world.cart?.view(world.game, room) ?? frame
    })
  }

  const title = world.screen === 'menu' ? 'ARCADE' : `ARCADE › ${world.title}`
  const paused = world.screen === 'game' && world.paused ? '  ❚❚ paused (p)' : ''

  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="row" justifyContent="space-between" paddingRight={2}>
        <Text bold color="#a371f7" wrap="truncate">
          {title}
          {paused}
        </Text>
        <Text color={claude.color} wrap="truncate">
          {claude.text}
        </Text>
      </Box>
      {frame.lines.slice(0, room.rows).map(line => drawLine(Text, line))}
      <Text wrap="truncate">{frame.status}</Text>
      <Text dimColor wrap="truncate">
        {frame.help}
      </Text>
    </Box>
  )
}

function drawLine(Text: ClientSurface['elements']['Text'], line: Line) {
  if (line.length === 0) {
    return <Text> </Text>
  }

  return (
    <Text wrap="truncate">
      {merge(line).map(span => {
        const style: Record<string, string | boolean> = {}
        if (span.color) style.color = span.color
        if (span.bg) style.backgroundColor = span.bg
        if (span.bold) style.bold = true
        if (span.dim) style.dimColor = true

        return <Text {...style}>{span.text}</Text>
      })}
    </Text>
  )
}

/** Joins neighbouring spans that share a style, to keep the tree small. */
function merge(line: Line): Line {
  const out: Line = []
  for (const span of line) {
    const last = out[out.length - 1]
    if (
      last &&
      last.color === span.color &&
      last.bg === span.bg &&
      Boolean(last.bold) === Boolean(span.bold) &&
      Boolean(last.dim) === Boolean(span.dim)
    ) {
      out[out.length - 1] = { ...last, text: last.text + span.text }
    } else {
      out.push(span)
    }
  }

  return out
}

function menuFrame(world: World): Frame {
  const items = menuItems(world)
  const lines: Line[] = [[], [{ text: '  Pick a game:', bold: true }], []]
  items.forEach((item, i) => {
    const selected = i === world.menuIndex
    lines.push([
      { text: selected ? '  ▸ ' : '    ', color: '#a371f7' },
      { text: `${String(i + 1).padStart(2)}. `, dim: !selected },
      { text: item.label.padEnd(28), bold: selected, color: selected ? '#e6edf3' : '#c9d1d9' },
      { text: item.blurb, dim: true },
    ])
  })
  if (!items.some(item => item.rom)) {
    lines.push([], [{ text: '    No CHIP-8 ROMs found. /arcade load <path> runs one.', dim: true }])
  } else {
    lines.push([], [{ text: '    Your own ROMs: /arcade load <path>, or drop .ch8 files in ~/.claude/arcade/roms', dim: true }])
  }

  return {
    lines,
    status: 'Games run in this pane while Claude keeps working.',
    help: 'arrows/jk choose · enter play · in a game: p pause · backspace menu · esc back to prompt',
  }
}
