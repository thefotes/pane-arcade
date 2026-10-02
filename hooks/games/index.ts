// Every cartridge the arcade offers, in menu order.
import type { Cartridge } from './cartridge'
import { chess } from './chess/index'
import { chip8 } from './chip8/index'
import { g2048 } from './g2048'
import { minesweeper } from './minesweeper'
import { snake } from './snake'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CARTRIDGES: Cartridge<any>[] = [snake, minesweeper, g2048, chess, chip8]
