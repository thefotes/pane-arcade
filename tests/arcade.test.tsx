// Engine-level tests: `claude plugin test .` loads the plugin as a session
// would, mounts the arcade pane and drives its Client with keys.
import { type Engine, expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'arcade',
  component: 'Pane',
  requestId: 'arcade',
  props: {
    title: 'Arcade',
    isFocused: true,
    bodyColumns: 110,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 34 },
    view: {},
  },
  viewport: { columns: 110, rows: 34 },
} as const

async function mountArcade($: Engine, surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({ ...PANE, surface })
  await ui.resize({ columns: 110, rows: 34, in: 'arcade' })

  return ui
}

test('the menu lists every game on each surface that runs a Client', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountArcade($, surface)
    for (const title of ['Snake', 'Minesweeper', '2048', 'Chess']) {
      expect(await ui.find({ text: title, in: 'arcade' })).toBeDefined()
    }
    await ui.unmount()
  }
})

test('enter on the menu starts a game, backspace returns to the menu', async $ => {
  const ui = await mountArcade($, 'terminal')
  await ui.key({ key: 'down', in: 'arcade' })
  await ui.key({ key: 'return', in: 'arcade' })
  expect(await ui.find({ text: /Mines \d+\s+Flags 0/, in: 'arcade' })).toBeDefined()

  await ui.key({ key: 'p', in: 'arcade' })
  expect(await ui.find({ text: /resume/, in: 'arcade' })).toBeDefined()

  await ui.key({ key: 'backspace', in: 'arcade' })
  expect(await ui.find({ text: /Pick a game/, in: 'arcade' })).toBeDefined()
  await ui.unmount()
})

test('snake moves on the frame clock once started', async $ => {
  const ui = await mountArcade($, 'terminal')
  await ui.key({ key: 'return', in: 'arcade' })
  expect(await ui.find({ text: /Score 0/, in: 'arcade' })).toBeDefined()
  expect(await ui.find({ text: /arrows \/ wasd to start/, in: 'arcade' })).toBeDefined()
  await ui.key({ key: 'right', in: 'arcade' })
  await ui.advance(2000)
  expect(await ui.find({ text: /arrows \/ wasd to start/, in: 'arcade' })).toBeUndefined()
  await ui.unmount()
})

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } } as const

test('/arcade answers usage questions without opening anything', async $ => {
  const unknown = await $.command.run({ ...RUN, command: 'arcade', args: 'pong' })
  expect(unknown.text).toContain('Unknown game')

  const help = await $.command.run({ ...RUN, command: 'arcade', args: 'help' })
  expect(help.text).toContain('/arcade load <path>')

  const missing = await $.command.run({ ...RUN, command: 'arcade', args: 'load /nonexistent/x.ch8' })
  expect(missing.text).toContain('Could not read')
})

test('on the main screen, keys typed into the play field reach the game', async $ => {
  const ui = await $.ui.mount({
    ...PANE,
    surface: 'terminal',
    props: { ...PANE.props, placement: 'inline' },
    viewport: { columns: 110, rows: 34, isFullscreen: false },
  })
  await ui.resize({ columns: 110, rows: 34, in: 'arcade' })
  expect(await ui.find({ type: 'Input', key: 'keys-0' })).toBeDefined()

  await ui.input({ key: 'keys-0', text: 'j', kind: 'change' })
  expect(await ui.find({ text: /▸\s+2\. Minesweeper/, in: 'arcade' })).toBeDefined()

  await ui.input({ key: 'keys-0', text: 'j', kind: 'submit' })
  expect(await ui.find({ text: /Mines \d+\s+Flags 0/, in: 'arcade' })).toBeDefined()

  await ui.input({ key: 'keys-0', text: 'jf', kind: 'change' })
  expect(await ui.find({ text: /Flags 1/, in: 'arcade' })).toBeDefined()
  await ui.unmount()
})

test('the fullscreen layout draws no play field', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 110, rows: 34, isFullscreen: true } })
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  await ui.unmount()
})

test('in fullscreen the mouse picks games and works the header buttons', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 110, rows: 34, isFullscreen: true } })
  await ui.resize({ columns: 110, rows: 34, in: 'arcade' })
  // Row 0 is the header, rows 1-3 the menu's heading, row 4 the first game.
  await ui.pointer({ type: 'down', x: 10, y: 5, button: 'left', in: 'arcade' })
  await ui.pointer({ type: 'up', x: 10, y: 5, button: 'left', in: 'arcade' })
  expect(await ui.find({ text: /Mines \d+\s+Flags 0/, in: 'arcade' })).toBeDefined()

  // "ARCADE › Minesweeper" then two spaces, then the "‹ menu" button.
  const menuButton = 'ARCADE › Minesweeper'.length + 3
  await ui.pointer({ type: 'down', x: menuButton, y: 0, button: 'left', in: 'arcade' })
  expect(await ui.find({ text: /Pick a game/, in: 'arcade' })).toBeDefined()
  await ui.unmount()
})

test('/arcade load only takes ROM files', async $ => {
  for (const path of ['/home/me/.ssh/id_rsa', '/etc/hosts', '/tmp/.hidden.ch8', 'notes.txt']) {
    const ran = await $.command.run({ ...RUN, command: 'arcade', args: `load ${path}` })
    expect(ran.text).toContain("doesn't look like a CHIP-8 ROM")
  }
})

test('a malformed post from the pane is ignored, not thrown', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.post({ type: 'host' }, { in: 'arcade' })
  await ui.post({ type: 'host', request: null }, { in: 'arcade' })
  await ui.post('junk', { in: 'arcade' })
  expect(await ui.find({ text: /Pick a game/, in: 'arcade' })).toBeDefined()
  await ui.unmount()
})
