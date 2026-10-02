// Engine-level tests: `claude plugin test .` loads the plugin as a session
// would, mounts the arcade pane and drives its Client with keys.
import { expect, test } from 'claude-code/testing'

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

async function mountArcade($: Parameters<Parameters<typeof test>[1]>[0], surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({ ...PANE, surface })
  await ui.resize({ columns: 110, rows: 34, in: 'arcade' })

  return ui
}

test('the menu lists every game on each surface that runs a Client', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountArcade($, surface)
    for (const title of ['Snake', 'Minesweeper']) {
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
  expect(await ui.find({ text: /paused/, in: 'arcade' })).toBeDefined()

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

test('/arcade answers usage questions without opening anything', async $ => {
  const unknown = await $.command.run({ command: 'arcade', args: 'pong' })
  expect(unknown.text).toContain('Unknown game')

  const help = await $.command.run({ command: 'arcade', args: 'help' })
  expect(help.text).toContain('/arcade load <path>')

  const missing = await $.command.run({ command: 'arcade', args: 'load /nonexistent/x.ch8' })
  expect(missing.text).toContain('Could not read')
})
