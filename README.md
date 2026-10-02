# Claude Arcade

A [Claude Code mod](https://claude.dev) that opens a game pane while Claude works:

- **Snake**
- **Minesweeper** (Beginner, Intermediate and Expert boards)
- **2048**
- **Chess** against [Stockfish](https://stockfishchess.org) at five strengths, against a small built-in
  engine when Stockfish is not installed, or against a friend at the same keyboard
- **CHIP-8**: a CHIP-8 interpreter with 12 public-domain games bundled, plus any `.ch8` ROM you supply

The header shows whether Claude is still working or waiting for you, and a toast tells you when it finishes.

## Install

```text
/plugin marketplace add <this repo's GitHub URL or local path>
/plugin install arcade@claude-arcade
```

or, for a single session from a checkout: `claude --plugin-dir /path/to/claude-arcade`.

For chess against Stockfish, install it so it is on your `PATH` (`brew install stockfish`, `apt install stockfish`,
...). Without it, chess falls back to the built-in engine and tells you so.

## Play

| Command | What it does |
| --- | --- |
| `/arcade` | Opens the arcade menu |
| `/arcade snake` · `/arcade minesweeper` · `/arcade 2048` · `/arcade chess` | Starts that game |
| `/arcade chip8 <name>` | Runs a bundled or saved ROM by name (`/arcade chip8 br8kout`) |
| `/arcade load <path>` | Runs a CHIP-8 ROM file you supply |
| `/arcade help` | Lists all of the above |

`/arcade` works mid-turn, so you can start a game while Claude is busy.

**Play with the mouse: use the fullscreen renderer.** Run `/tui fullscreen` once (it restarts and resumes your
session; `CLAUDE_CODE_NO_FLICKER=1` does the same for one launch). The arcade then docks beside the transcript and
the mouse works everywhere: click a game in the menu, click cells in Minesweeper (right-click flags), click a piece
and then its square in chess (or drag it), drag to slide in 2048, and press and hold the on-screen buttons under a
CHIP-8 game. Clicking the game also gives it the keyboard, arrows included; `Esc` hands the keys back to Claude.
The header's `‹ menu` and `❚❚ pause` buttons work in every game.

**On the classic renderer** a terminal can't send the mouse or arrow keys to a mod, so the pane shows a focused
*play* field under the game and forwards what you type: letters (WASD/HJKL), digits, space and enter. The pane is
short there, so the menu scrolls, chess uses a compact board and CHIP-8 switches to braille (2×4 pixels per
character).

In every game `p` pauses and `backspace` returns to the menu.

| Game | Controls |
| --- | --- |
| Snake | arrows / WASD turn · `r` restart |
| Minesweeper | click to reveal, right-click to flag · arrows / HJKL move · `space` reveal (on a number: chord) · `f` flag · `1`/`2`/`3` board size · `r` restart |
| 2048 | drag with the mouse, or arrows / WASD / HJKL, to slide · `u` undo · `r` restart · `c` dismiss the 2048 message and keep going |
| Chess | click a piece then its square, or drag it · buttons under the board for new game, undo, swap sides, two players, level · keys: arrows / WASD + `space`, `u` `n` `c` `t` `l`, `g` letters instead of piece glyphs |
| CHIP-8 | press and hold the on-screen buttons (the keys the game's instructions name, or the whole pad) · number keys are the pad's digits, so "keys 7 and 9" means 7 and 9 · arrows = 5/7/8/9 · `space`/`enter` = 6 · the pad's A–F are on `z`/`c`/`r`/`f`/`v` and `4` is also `q` |

### Your own CHIP-8 ROMs

Run one with `/arcade load ~/Downloads/game.ch8`, or drop `.ch8` files into `~/.claude/arcade/roms/` to list them in
the menu. A `roms.json` beside them can set a ROM's title, speed and Octo quirk flags:

```json
{ "game": { "title": "My Game", "tickrate": 15, "quirks": { "shift": false, "loadStore": false, "clip": true } } }
```

## Where the games come from (and why that's legal)

Everything in this repository is either written here or explicitly public domain:

- Snake, Minesweeper, 2048, chess (rules and the built-in engine) and the CHIP-8 interpreter are original code, MIT
  licensed. (2048 is Gabriele Cirulli's design, itself MIT licensed; this is a fresh implementation.)
- Stockfish is **not** bundled. The mod runs the copy you installed as a separate program and talks to it over UCI,
  so the arcade's license stays MIT and Stockfish's GPL stays with Stockfish.
- The bundled ROMs come from the [Chip8 Community Archive](https://github.com/JohnEarnest/chip8Archive), which
  places all of its programs under CC0. Credits are in [`roms/CREDITS.md`](roms/CREDITS.md).
- `/arcade load` runs ROMs you supply. The project does not ship, link to or help find commercial ROMs. CHIP-8 also
  needs no BIOS: the font is the standard 80-byte hex font, reproduced from the specification.

## How it works

```
hooks/register.tsx   hooks module: /arcade, the pane, ROM files, Stockfish, Claude's busy state
hooks/client.tsx     Client surface module: runs on the drawing thread; menu, keys, frame clock, drawing
hooks/games/         cartridges: plain TypeScript, no engine imports
  cartridge.ts       the contract every game implements
  snake.ts, minesweeper.ts, g2048.ts, chess/, chip8/
roms/                CC0 CHIP-8 ROMs, their metadata (roms.json) and credits
tests/arcade.test.tsx   engine tests (claude plugin test .)
tests/unit/*.spec.ts    cartridge tests (bun test)
```

A cartridge is a plain object: `init`, `key`, an optional `tick` on a fixed period, and `view`, which returns lines
of styled spans. The Client drives it. A cartridge that needs the machine (chess asking Stockfish for a move) returns a
`pendingRequest`; the Client posts it to the hooks module, and the answer comes back through `onResponse`.

To add a game, write a `Cartridge` in `hooks/games/`, add it to `hooks/games/index.ts`, and give it a spec in
`tests/unit/`.

## Develop

```sh
bun install
claude --plugin-dir .        # once: loading the mod lays the engine's types in .claude-plugin/types/
bun test tests/unit          # cartridge tests
bun run typecheck            # strict TypeScript: cartridges, then the hooks and Client against the engine types
claude plugin validate .     # what the engine will load
claude plugin test .         # engine tests: mounts the pane and drives it
```

A session started with `--plugin-dir .` hot-reloads the mod when you save.

## License

MIT, except the bundled ROMs (CC0, see `roms/CREDITS.md`).
