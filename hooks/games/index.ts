// Every cartridge the arcade offers, in menu order.
import type { Cartridge } from './cartridge'
import { minesweeper } from './minesweeper'
import { snake } from './snake'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CARTRIDGES: Cartridge<any>[] = [snake, minesweeper]
