/** What `/arcade` asked the pane to start; `nonce` changes on every launch. */
export type ArcadeLaunch = {
  game: string
  /** ROM bytes, base64, for cartridges that run one. */
  rom?: string
  romName?: string
  /** Tick rate and quirk flags from the ROM's metadata, when it has some. */
  romOptions?: ArcadeRomOptions
  nonce: number
}

/** How to run a ROM: speed, Octo quirk flags, instructions and palette. */
export type ArcadeRomOptions = {
  tickrate?: number
  quirks?: Record<string, boolean>
  howto?: string
  colors?: { fill: string; background: string }
}

/** A ROM the menu can offer: bundled with the plugin or in the user's ROM folder. */
export type ArcadeRom = {
  name: string
  path: string
  source: 'bundled' | 'user'
  title?: string
  romOptions?: ArcadeRomOptions
}

/** The host's answer to a cartridge's request (mirrors HostResponse in hooks/games/cartridge.ts). */
export type ArcadeResponse = {
  id: string
  kind: 'stockfish'
  bestmove: string | null
  error?: string
}

/** One key forwarded from the pane's key field to the game. */
export type ArcadeKey = { seq: number; key: string }

declare module 'claude-code' {
  interface PluginState {
    arcade: {
      launch: ArcadeLaunch | null
      busy: boolean
      response: ArcadeResponse | null
      roms: ArcadeRom[]
      /** Keys typed into the pane's key field (main-screen layout), newest last. */
      keys: ArcadeKey[]
    }
  }
}
