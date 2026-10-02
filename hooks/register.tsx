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

      return { text: `Loaded ${loaded.name}. The pane has the keys; Esc hands them back.` }
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

      return { text: `Running ${rom.title ?? rom.name}.` }
    }

    if (word && !CARTRIDGES.some(c => c.id === word)) {
      return { text: `Unknown game "${verb}".\n${USAGE}` }
    }

    await scanRoms($)
    await start($, { game: word || 'menu' })

    return { text: word ? `Starting ${word}.` : 'Arcade open. Pick a game with the arrows and Enter.' }
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
    const { Client } = $.ui.resolve(e)
    const props = {
      launch: await read($, launch),
      busy: await read($, busy),
      response: await read($, response),
      roms: (await read($, roms)).map(r => ({ name: r.name, title: r.title ?? r.name })),
    }

    return <Client key="arcade" module="./client.tsx" props={props} width="100%" flexGrow={1} />
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
