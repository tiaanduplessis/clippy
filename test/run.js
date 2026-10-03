'use strict'

const assert = require('assert')
const EventEmitter = require('events')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = process.env.CLIPPY_SOURCE_ROOT || path.join(__dirname, '..')
let passed = 0
let failed = 0

function test (name, run) {
  try {
    run()
    passed += 1
    console.log('ok - ' + name)
  } catch (error) {
    failed += 1
    console.error('not ok - ' + name)
    console.error(error.stack)
  }
}

function load (file, dependencies, globals = {}) {
  const filename = path.join(root, file)
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), Object.assign({
    module,
    exports: module.exports,
    __dirname: path.dirname(filename),
    require: name => {
      if (Object.prototype.hasOwnProperty.call(dependencies, name)) {
        return dependencies[name]
      }
      throw new Error('Unexpected dependency: ' + name)
    }
  }, globals), { filename })
  return module.exports
}

function createHarness (interval) {
  const state = { text: '', writes: [], timers: [], templates: [], quits: 0 }
  const image = { setTemplateImage: value => { state.templateImage = value } }
  const electron = {
    clipboard: {
      readText: () => state.text,
      writeText: text => {
        state.text = text
        state.writes.push(text)
      }
    },
    nativeImage: {
      createFromPath: filename => {
        state.iconPath = filename
        return image
      }
    },
    Menu: {
      buildFromTemplate: template => {
        state.templates.push(template)
        return { items: template }
      }
    },
    Tray: class {
      constructor (icon) {
        state.icon = icon
      }

      setContextMenu (menu) {
        state.menu = menu
      }

      setToolTip (tooltip) {
        state.tooltip = tooltip
      }
    }
  }
  const Clipboard = load('src/clipboard.js', { electron, events: require('events') }, {
    setInterval: (callback, delay) => state.timers.push({ callback, delay })
  })
  const TrayHandler = load('src/tray-handler.js', { electron, path })
  state.clipboard = new Clipboard(interval)
  state.app = { quit: () => { state.quits += 1 } }
  state.handler = new TrayHandler({ clipboard: state.clipboard, app: state.app })
  state.poll = text => {
    state.text = text
    state.timers[0].callback()
  }
  state.labels = () => Array.from(state.menu.items, item => item.label)
  state.history = () => Array.from(state.clipboard.items)
  return state
}

test('keeps the tray image, template flag, tooltip and polling interval', () => {
  const state = createHarness()
  assert.strictEqual(state.iconPath, path.join(root, 'src/tray.png'))
  assert.strictEqual(state.templateImage, true)
  assert.strictEqual(state.tooltip, 'Clippy')
  assert.strictEqual(state.timers.length, 1)
  assert.strictEqual(state.timers[0].delay, 1000)
  assert.strictEqual(createHarness(25).timers[0].delay, 25)
})

test('shows A, B, C as C, B, A with actions last', () => {
  const state = createHarness()
  state.clipboard.emit('update', ['A', 'B', 'C'])
  assert.deepStrictEqual(state.labels(), ['C', 'B', 'A', 'Clear history', 'Quit'])
  assert.deepStrictEqual(Array.from(state.menu.items, item => item.position), [
    'endof=clipboarditems', 'endof=clipboarditems', 'endof=clipboarditems',
    'endof=actions', 'endof=actions'
  ])
})

test('does not mutate frozen backing history or toggle repeated updates', () => {
  const state = createHarness()
  const history = Object.freeze(['A', 'B', 'C'])
  state.clipboard.emit('update', history)
  state.clipboard.emit('update', history)
  assert.deepStrictEqual(history, ['A', 'B', 'C'])
  assert.deepStrictEqual(state.labels(), ['C', 'B', 'A', 'Clear history', 'Quit'])
})

test('handles empty and single-entry history', () => {
  const state = createHarness()
  state.clipboard.emit('update', [])
  assert.deepStrictEqual(state.labels(), ['Clear history', 'Quit'])
  state.clipboard.emit('update', ['only'])
  assert.deepStrictEqual(state.labels(), ['only', 'Clear history', 'Quit'])
})

test('preserves short labels and truncates only labels longer than 40 characters', () => {
  const state = createHarness()
  const forty = 'x'.repeat(40)
  const long = 'y'.repeat(41)
  state.clipboard.emit('update', [forty, long])
  assert.deepStrictEqual(state.labels(), ['y'.repeat(37) + '…', forty, 'Clear history', 'Quit'])
  state.menu.items[0].click()
  state.menu.items[1].click()
  assert.deepStrictEqual(state.writes, [long, forty])
})

test('each click restores the complete original text including Unicode and newlines', () => {
  const state = createHarness()
  const entries = ['alpha', 'line one\nline two & more', '🙂'.repeat(30)]
  state.clipboard.emit('update', entries)
  state.menu.items.slice(0, 3).forEach(item => item.click())
  assert.deepStrictEqual(state.writes, entries.slice().reverse())
})

test('old menu click closures retain their own item after a later update', () => {
  const state = createHarness()
  state.clipboard.emit('update', ['A', 'B'])
  const oldMenu = state.menu
  state.clipboard.emit('update', ['A', 'B', 'C'])
  oldMenu.items[0].click()
  assert.deepStrictEqual(state.writes, ['B'])
})

test('polling keeps chronological backing history and consecutive duplicate suppression', () => {
  const state = createHarness()
  ;['A', 'A', 'B', 'B', 'C', 'C'].forEach(state.poll)
  assert.deepStrictEqual(state.history(), ['A', 'B', 'C'])
  assert.strictEqual(state.templates.length, 3)
  assert.deepStrictEqual(state.labels(), ['C', 'B', 'A', 'Clear history', 'Quit'])
})

test('retains nonconsecutive duplicates in their existing history positions', () => {
  const state = createHarness()
  ;['A', 'B', 'A', 'A', 'C'].forEach(state.poll)
  assert.deepStrictEqual(state.history(), ['A', 'B', 'A', 'C'])
  assert.deepStrictEqual(state.labels(), ['C', 'A', 'B', 'A', 'Clear history', 'Quit'])
})

test('clicking the newest entry does not create another entry on the next poll', () => {
  const state = createHarness()
  ;['A', 'B', 'C'].forEach(state.poll)
  state.menu.items[0].click()
  state.timers[0].callback()
  assert.deepStrictEqual(state.history(), ['A', 'B', 'C'])
  assert.strictEqual(state.templates.length, 3)
})

test('clicking an older entry appends it once and moves its new occurrence to the top', () => {
  const state = createHarness()
  ;['A', 'B', 'C'].forEach(state.poll)
  state.menu.items[2].click()
  state.timers[0].callback()
  state.timers[0].callback()
  assert.deepStrictEqual(state.history(), ['A', 'B', 'C', 'A'])
  assert.deepStrictEqual(state.labels(), ['A', 'C', 'B', 'A', 'Clear history', 'Quit'])
})

test('clear empties history and leaves both action handlers usable', () => {
  const state = createHarness()
  ;['A', 'B', 'C'].forEach(state.poll)
  state.menu.items[3].click()
  assert.deepStrictEqual(state.history(), [])
  assert.deepStrictEqual(state.labels(), ['Clear history', 'Quit'])
  state.menu.items[0].click()
  assert.deepStrictEqual(state.labels(), ['Clear history', 'Quit'])
  state.menu.items[1].click()
  assert.strictEqual(state.quits, 1)
  assert.deepStrictEqual(state.writes, [])
})

test('preserves the existing repopulation from the system clipboard after clear', () => {
  const state = createHarness()
  state.poll('existing clipboard')
  state.menu.items[1].click()
  state.timers[0].callback()
  assert.deepStrictEqual(state.history(), ['existing clipboard'])
  assert.deepStrictEqual(state.labels(), ['existing clipboard', 'Clear history', 'Quit'])
})

test('keeps empty clipboard text deduplicated under repeated polling', () => {
  const state = createHarness()
  state.poll('')
  state.poll('')
  assert.deepStrictEqual(state.history(), [''])
  assert.strictEqual(state.templates.length, 1)
})

test('renders a bounded 1000-entry sample without dropping entries or changing source order', () => {
  const state = createHarness()
  const history = Array.from({ length: 1000 }, (_, index) => 'entry-' + index)
  const before = history.slice()
  state.clipboard.emit('update', history)
  assert.deepStrictEqual(history, before)
  assert.deepStrictEqual(state.labels(), before.reverse().concat(['Clear history', 'Quit']))
})

;['darwin', 'linux', 'win32'].forEach(platform => {
  test('preserves app startup and window-close behavior on ' + platform, () => {
    const app = new EventEmitter()
    let quits = 0
    let clipboards = 0
    let handlers = 0
    app.quit = () => { quits += 1 }
    class Clipboard {
      constructor () { clipboards += 1 }
    }
    class TrayHandler {
      constructor (options) {
        assert.strictEqual(options.app, app)
        assert(options.clipboard instanceof Clipboard)
        handlers += 1
      }
    }
    load('main.js', {
      electron: { app },
      './src/clipboard': Clipboard,
      './src/tray-handler': TrayHandler
    }, { process: { platform } })
    assert.strictEqual(clipboards, 0)
    app.emit('ready')
    assert.strictEqual(clipboards, 1)
    assert.strictEqual(handlers, 1)
    app.emit('window-all-closed')
    assert.strictEqual(quits, platform === 'darwin' ? 0 : 1)
  })
})

console.log(passed + ' passed, ' + failed + ' failed')
if (failed) process.exitCode = 1
