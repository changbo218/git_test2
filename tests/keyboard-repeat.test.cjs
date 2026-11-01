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
    key(code, repeat = false) {
      listeners.get('keydown')({ code, repeat, target: null, preventDefault() {} });
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
