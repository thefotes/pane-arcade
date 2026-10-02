import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ArcadeLaunch, ArcadeResponse, ArcadeRom } from '../types'
import type { HostRequest } from './games/cartridge'
import { CARTRIDGES } from './games/index'

const PANE = 'arcade'
/** CHIP-8 programs load at 0x200 and must fit below 0x1000. */
const MAX_ROM_BYTES = 0x1000 - 0x200

const launch = atom({ plugin: 'arcade', key: 'launch' } as const, null)
const busy = atom({ plugin: 'arcade', key: 'busy' } as const, false)
const response = atom({ plugin: 'arcade', key: 'response' } as const, null)
const roms = atom({ plugin: 'arcade', key: 'roms' } as const, [])
const keys = atom({ plugin: 'arcade', key: 'keys' } as const, [])

const USAGE = [
  'Usage: /arcade [game]',
  `  games: ${CARTRIDGES.filter(c => c.id !== 'chip8').map(c => c.id).join(', ')}`,
  '  /arcade chip8 <name>   run a bundled or saved CHIP-8 ROM by name',
  '  /arcade load <path>    run a CHIP-8 ROM file you supply',
  '  ROM folder: ~/.claude/arcade/roms (files ending .ch8 show up in the menu)',
].join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'arcade',
      description: 'Play games in a pane while Claude works',
      argumentHint: '[snake|minesweeper|chess|chip8 <rom>|load <path>]',
      immediate: true,
    })
    await scanRoms($)

    return next(e)
  })

  on('command.run', { command: 'arcade' }, async ($, e) => {
    const hint = e.presentation?.isFullscreen
      ? 'Click the game to give it the keyboard; Esc hands it back.'
      : 'Type into the play field under the game (ctrl+x tab focuses the pane); Esc hands the keys back.'
    const [verb = '', ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    const arg = rest.join(' ')
    const word = verb.toLowerCase()

    if (word === 'help') {
      return { text: USAGE }
    }

    if (word === 'load') {
      if (!arg) {
        return { text: 'Usage: /arcade load <path to a .ch8 file>' }
      }
      const loaded = await loadRom($, await expandHome($, arg))
      if ('error' in loaded) {
        return { text: loaded.error }
      }
      await start($, { game: 'chip8', rom: loaded.base64, romName: loaded.name })

      return { text: `Loaded ${loaded.name}. ${hint}` }
    }

    if (word === 'chip8' && arg) {
      const list = await scanRoms($)
      const rom = list.find(r => r.name.toLowerCase() === arg.toLowerCase())
      if (!rom) {
        return { text: `No ROM named "${arg}". Known: ${list.map(r => r.name).join(', ') || 'none'}` }
      }
      const loaded = await loadRom($, rom.path)
      if ('error' in loaded) {
        return { text: loaded.error }
      }
      await start($, { game: 'chip8', rom: loaded.base64, romName: rom.title ?? rom.name, romOptions: rom.romOptions })

      return { text: `Running ${rom.title ?? rom.name}. ${hint}` }
    }

    if (word && !CARTRIDGES.some(c => c.id === word)) {
      return { text: `Unknown game "${verb}".\n${USAGE}` }
    }

    await scanRoms($)
    await start($, { game: word || 'menu' })

    return { text: `${word ? `Starting ${word}.` : 'Arcade open: pick a game.'} ${hint}` }
  })

  on('turn.start', async ($, e, next) => {
    await update($, busy, () => true)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, busy, () => false)
      const panes = await $.ui.panes()
      if (panes.some(p => p.id === PANE && p.isShown)) {
        $.ui.toast('Claude is done and waiting for you.')
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text>The arcade needs the terminal or the desktop app.</Text>
    }
    const { Box, Client, Input } = $.ui.resolve(e)
    const props = {
      launch: await read($, launch),
      busy: await read($, busy),
      response: await read($, response),
      roms: (await read($, roms)).map(r => ({ name: r.name, title: r.title ?? r.name })),
      keys: await read($, keys),
    }
    // In the fullscreen layout a click gives the game the keyboard (arrows too).
    // On the main screen nothing can click it, so a field forwards typed keys.
    const fullscreen = e.viewport?.isFullscreen === true
    // A Client is as tall as what it last drew unless told otherwise; size it to
    // the pane's body so a game can use all of it.
    const rows = Math.max(12, e.props.scroll.bodyRows - (fullscreen ? 0 : 1))
    const client = (
      <Client key="arcade" module="./client.tsx" props={props} width={e.props.bodyColumns} height={rows} />
    )
    if (fullscreen) {
      return client
    }

    return (
      <Box flexDirection="column" width="100%">
        {client}
        <Input
          key="keys"
          autoFocus
          label="play › "
          placeholder="type here to play (letters, space, enter; no arrows on this screen)"
          submitLabel="enter"
          onInput={value => forwardTyping($, value)}
          onSubmit={() => pushKeys($, ['return'])}
        />
      </Box>
    )
  })

  on('ui.message', { requestId: PANE }, async ($, e) => {
    const data = e.data as { type?: unknown } | null
    if (data?.type === 'host') {
      const request = (data as { request: HostRequest }).request
      const answer = await stockfish($, request)
      await update($, response, () => answer)
    } else if (data?.type === 'rom') {
      const name = String((data as { name: unknown }).name)
      const rom = (await read($, roms)).find(r => r.name === name)
      const loaded = rom ? await loadRom($, rom.path) : { error: `No ROM named ${name}` }
      if ('error' in loaded) {
        $.ui.toast(loaded.error)
      } else {
        await start($, { game: 'chip8', rom: loaded.base64, romName: rom?.title ?? name, romOptions: rom?.romOptions })
      }
    }

    return {}
  })
}

/** The key field's text as last seen, to tell what the newest edit typed. */
let typed = ''

/** Turns one edit of the key field into the keys it stands for. */
async function forwardTyping($: EngineInterface, value: string) {
  let pressed: string[]
  if (value.startsWith(typed)) {
    pressed = [...value.slice(typed.length)]
  } else if (typed.startsWith(value)) {
    pressed = new Array<string>(typed.length - value.length).fill('backspace')
  } else {
    pressed = [...value].slice(-1)
  }
  typed = value
  await pushKeys($, pressed)
}

async function pushKeys($: EngineInterface, pressed: string[]) {
  if (pressed.length === 0) return
  await update($, keys, list => {
    let seq = list[list.length - 1]?.seq ?? 0
    return [...list, ...pressed.map(key => ({ seq: ++seq, key }))].slice(-32)
  })
}

async function start($: EngineInterface, next: Omit<ArcadeLaunch, 'nonce'>) {
  await update($, launch, prev => ({ ...next, nonce: (prev?.nonce ?? 0) + 1 }))
  const opened = await $.ui.open({ id: PANE, title: 'Arcade', focus: true, rows: 30, columns: 96 })
  if (!opened.isPlaced) {
    $.ui.toast('Arcade: widen the terminal to see the pane.')
  }
}

async function expandHome($: EngineInterface, path: string): Promise<string> {
  const unquoted = path.replace(/^(['"])(.*)\1$/, '$2')
  if (unquoted === '~' || unquoted.startsWith('~/')) {
    return `${(await $.env.get('HOME')) ?? ''}${unquoted.slice(1)}`
  }

  return unquoted
}

async function loadRom(
  $: EngineInterface,
  path: string,
): Promise<{ base64: string; name: string } | { error: string }> {
  const name = path.split('/').pop() ?? path
  try {
    const stat = await $.fs.stat(path)
    if (stat.kind !== 'file') {
      return { error: `${path} is not a file.` }
    }
    if (stat.size === 0 || stat.size > MAX_ROM_BYTES) {
      return { error: `${name} is ${stat.size} bytes; a CHIP-8 ROM is 1 to ${MAX_ROM_BYTES} bytes.` }
    }
    const { base64 } = await $.fs.read(path, { as: 'bytes' })

    return { base64, name: name.replace(/\.(ch8|c8|rom|bin)$/i, '') }
  } catch (error) {
    return { error: `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** Lists bundled ROMs (`<plugin>/roms`) and the user's (`~/.claude/arcade/roms`). */
async function scanRoms($: EngineInterface): Promise<ArcadeRom[]> {
  const home = (await $.env.get('HOME')) ?? ''
  const folders = [
    { dir: `${$.plugin.root}/roms`, source: 'bundled' as const },
    { dir: `${home}/.claude/arcade/roms`, source: 'user' as const },
  ]
  const found: ArcadeRom[] = []
  for (const { dir, source } of folders) {
    const meta = await readRomMeta($, `${dir}/roms.json`)
    try {
      for (const entry of await $.fs.list(dir)) {
        if (entry.kind === 'file' && /\.(ch8|c8)$/i.test(entry.name)) {
          const name = entry.name.replace(/\.(ch8|c8)$/i, '')
          const info = meta[name]
          found.push({
            name,
            path: `${dir}/${entry.name}`,
            source,
            ...(info?.title ? { title: info.title } : {}),
            ...(info ? { romOptions: { tickrate: info.tickrate, quirks: info.quirks } } : {}),
          })
        }
      }
    } catch {
      // A missing folder just has no ROMs.
    }
  }
  found.sort((a, b) => a.name.localeCompare(b.name))
  await update($, roms, () => found)

  return found
}

type RomMeta = { title?: string; tickrate?: number; quirks?: Record<string, boolean> }

/** A ROM folder's optional `roms.json`: `{ "<file name without .ch8>": { title, tickrate, quirks } }`. */
async function readRomMeta($: EngineInterface, path: string): Promise<Record<string, RomMeta>> {
  try {
    const parsed: unknown = JSON.parse(await $.fs.read(path))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, RomMeta>) : {}
  } catch {
    return {}
  }
}

/**
 * Asks a locally installed Stockfish for a move. Stockfish quits as soon as its
 * stdin closes, so the commands are piped through a shell that keeps stdin open
 * for the search time. The FEN and options travel as arguments, never as
 * shell text.
 */
async function stockfish($: EngineInterface, request: HostRequest): Promise<ArcadeResponse> {
  const base = { id: String(request.id), kind: 'stockfish' as const }
  const fen = String(request.fen)
  if (!/^[pnbrqkPNBRQK1-8/]+ [wb] [KQkq-]+ [a-h1-8-]+ \d+ \d+$/.test(fen)) {
    return { ...base, bestmove: null, error: 'bad FEN' }
  }
  const movetime = Math.max(50, Math.min(5000, Math.round(Number(request.movetimeMs) || 500)))
  const elo = request.elo === undefined ? undefined : Math.max(1320, Math.min(3190, Math.round(request.elo)))
  const commands = [
    'uci',
    ...(elo === undefined ? [] : ['setoption name UCI_LimitStrength value true', `setoption name UCI_Elo value ${elo}`]),
    'isready',
    `position fen ${fen}`,
    `go movetime ${movetime}`,
  ].join('\n')
  const script =
    'PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/usr/games"; ' +
    'command -v stockfish >/dev/null 2>&1 || exit 127; ' +
    '{ printf "%s\\n" "$1"; sleep "$2"; } | stockfish'
  try {
    const ran = await $.process.run(['sh', '-c', script, 'arcade-stockfish', commands, String(movetime / 1000 + 0.5)], {
      timeoutMs: movetime + 10_000,
    })
    if (ran.exitCode === 127) {
      return { ...base, bestmove: null, error: 'stockfish is not installed' }
    }
    const best = /^bestmove (\S+)/m.exec(ran.stdout)?.[1]

    return best && best !== '(none)'
      ? { ...base, bestmove: best }
      : { ...base, bestmove: null, error: 'stockfish gave no move' }
  } catch (error) {
    return { ...base, bestmove: null, error: error instanceof Error ? error.message : String(error) }
  }
}
