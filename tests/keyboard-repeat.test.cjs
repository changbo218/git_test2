const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual game's event handlers without a browser dependency.
function loadGame() {
  class Element {}
  const elements = new Map();
  const listeners = new Map();
  const values = new Map();
  const context = { setTransform() {} };
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, Object.assign(new Element(), {
        textContent: '',
        classList: { add() {}, remove() {} },
        addEventListener() {},
        setAttribute() {},
        getContext: () => context,
        focus() {},
        blur() {},
        closest: () => null,
      }));
    }
    return elements.get(id);
  }
  const document = { getElementById: element, addEventListener() {}, activeElement: null };
  const window = {
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    requestAnimationFrame() {},
    setTimeout() {},
    addEventListener: (name, listener) => listeners.set(name, listener),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../WebContent/js/game.js'), 'utf8'), {
    window, document, Element, console,
  });
  return {
    game: window.BrickBreaker,
    element,
    soundLabel: () => element('soundBtn').textContent,
    key(code, repeat = false, target = null) {
      let prevented = false;
      listeners.get('keydown')({
        code,
        repeat,
        target,
        preventDefault() {
          prevented = true;
        },
      });
      return prevented;
    },
    buttonTarget() {
      const target = new Element();
      target.closest = () => target;
      return target;
    },
  };
}

for (const code of ['KeyP', 'Escape']) {
  test(`${code}: holding pause must not repeatedly resume the game`, () => {
    const { game, key } = loadGame();
    game.start();
    game.launch();
    assert.equal(game.getState().phase, 'playing');
    key(code);
    assert.equal(game.getState().phase, 'paused');
    key(code, true);
    assert.equal(game.getState().phase, 'paused');
    key(code, true);
    assert.equal(game.getState().phase, 'paused');
    key(code);
    assert.equal(game.getState().phase, 'playing');
  });
}

test('KeyM: holding mute must toggle it only once', () => {
  const { key, soundLabel } = loadGame();
  assert.equal(soundLabel(), 'SOUND');
  key('KeyM');
  assert.equal(soundLabel(), 'MUTED');
  key('KeyM', true);
  key('KeyM', true);
  key('KeyM', true);
  assert.equal(soundLabel(), 'MUTED');
  key('KeyM');
  assert.equal(soundLabel(), 'SOUND');
});

test('Enter on a focused button: repeats must not re-activate it', () => {
  const { key, buttonTarget } = loadGame();
  const button = buttonTarget();
  // The first press stays available to the button's native activation.
  assert.equal(key('Enter', false, button), false);
  // Auto-repeat keydowns must not reach it again.
  assert.equal(key('Enter', true, button), true);
  assert.equal(key('Enter', true, button), true);
});
