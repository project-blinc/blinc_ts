import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { loadNative } from '../dist/native/index.js';
import { Host, HostElement } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';
import { ThemeState, neutralTheme } from '../dist/theme/index.js';
import { addUserAgent } from '../dist/theme/user-agent.js';

const native = loadNative();
const W = 360;
const H = 420;
const target = await OffscreenRenderer.create(native, W, H, probeShader);
const output = new URL('../.blinc/user-agent/', import.meta.url);
await mkdir(output, { recursive: true });

async function capture(host, name) {
  host.compute(W, H);
  const renderer = new SceneRenderer(target.device, host.layout);
  try {
    const pixels = new Uint8Array(W * H * 4);
    await target.captureCommandsInto(
      pixels,
      (encoder, view) =>
        renderer.encode(encoder, host.root.layoutNode, view, { width: W, height: H, scale: 1 })
          .drawCalls,
    );
    if (name) {
      await writeFile(
        new URL(`${name}.png`, output),
        PNG.sync.write({ width: W, height: H, data: Buffer.from(pixels) }),
      );
    }
    return Buffer.from(pixels);
  } finally {
    renderer.dispose();
  }
}
function geometry(node) {
  return {
    bounds: node.bounds().map((v) => Math.round(v * 100) / 100),
    children: node instanceof HostElement ? node.childNodes.map(geometry) : undefined,
  };
}
const pixel = (pixels, x, y) => {
  const at = (Math.round(y) * W + Math.round(x)) * 4;
  return [...pixels.subarray(at, at + 4)];
};
const near = (actual, expected, tolerance = 2) =>
  actual.every((c, i) => Math.abs(c - expected[i]) <= tolerance);
const rgb8 = (color) => [...color.slice(0, 3).map((c) => Math.round(c * 255)), 255];

function el(host, tag, children = [], style) {
  const element = host.createElement(tag);
  if (style) {
    element.setAttribute('style', style);
  }
  for (const child of children) {
    element.appendChild(typeof child === 'string' ? host.createTextNode(child) : child);
  }
  return element;
}

const context = native.createReactive();
try {
  const host = Host.create(native);
  try {
    const errors = [];
    host.onStyleErrors((e) => errors.push(...e));
    const state = new ThemeState(context, neutralTheme, { scheme: 'light' });
    state.attach(host.layout);
    const sheet = addUserAgent(host.layout);
    assert.deepEqual(sheet.diagnostics, [], 'the sheet parses without a diagnostic');
    // Restyle, then run what that started to its end.
    let clock = 0;
    const settle = () => {
      host.compute(W, H);
      host.layout.tickMotion((clock += 1));
      host.layout.tickMotion((clock += 1000));
    };

    const title = el(host, 'h1', ['Title']);
    const para = el(host, 'p', ['Paragraph text']);
    const rule = el(host, 'hr');
    const quote = el(host, 'blockquote', [el(host, 'p', ['Quoted'])]);
    const code = el(host, 'pre', [el(host, 'code', ['host.compute(w, h)'])]);
    const button = el(host, 'button', ['Press']);
    const link = el(host, 'a', ['A link']);
    const doc = el(host, 'div', [title, para, rule, quote, code, el(host, 'div', [button, link])]);
    host.root.appendChild(doc);

    const light = await capture(host, 'light');
    const layout = geometry(host.root);
    assert.deepEqual(errors, [], 'no declaration was refused');

    // Containers stack; a tag with no sheet is a row.
    const tops = [title, para, rule, quote, code].map((e) => e.bounds()[1]);
    assert.deepEqual(
      tops,
      [...tops].sort((a, b) => a - b),
      'blocks stack top to bottom',
    );
    assert.ok(new Set(tops).size === tops.length, 'and do not overlap');
    assert.ok(title.bounds()[3] > para.bounds()[3] * 1.5, 'a heading is set in larger type');

    // The window takes the theme's ground and ink, and a scheme switch restyles in place.
    const colors = (theme) => theme.colors;
    assert.ok(
      near(pixel(light, W - 4, H - 4), rgb8(colors(neutralTheme.light).background)),
      'light ground',
    );
    const [rx, ry, rw] = rule.bounds();
    assert.equal(rule.bounds()[3], 1, 'a rule is a pixel tall');
    assert.ok(
      near(pixel(light, rx + rw / 2, ry), rgb8(colors(neutralTheme.light).border)),
      'a rule is drawn in the border colour',
    );
    const [qx, qy, qw, qh] = quote.bounds();
    assert.ok(
      near(pixel(light, qx + 1, qy + qh / 2), rgb8(colors(neutralTheme.light).border)),
      'a quotation has a rule on its left',
    );
    assert.ok(
      near(pixel(light, qx + qw - 2, qy + qh / 2), rgb8(colors(neutralTheme.light).background)),
      'and only its left',
    );
    const [bx, by, bw] = button.bounds();
    const insideButton = [bx + bw / 2, by + 3];
    assert.ok(
      near(pixel(light, ...insideButton), rgb8(colors(neutralTheme.light).primary)),
      'a button is the primary colour',
    );

    host.input.pointerMove(bx + bw / 2, by + 3);
    settle();
    assert.ok(
      near(
        pixel(await capture(host), ...insideButton),
        rgb8(colors(neutralTheme.light).primaryHover),
      ),
      'a hovered button takes its hover colour',
    );
    host.input.pointerMove(W - 2, H - 2);

    settle();
    state.setScheme('dark');
    settle();
    const dark = await capture(host, 'dark');
    assert.deepEqual(geometry(host.root), layout, 'a scheme switch keeps the geometry');
    assert.ok(near(pixel(dark, W - 4, H - 4), rgb8(colors(neutralTheme.dark).background)));
    assert.ok(near(pixel(dark, ...insideButton), rgb8(colors(neutralTheme.dark).primary)));
    assert.ok(!dark.equals(light), 'a scheme switch changes the pixels');
    state.dispose();
  } finally {
    host.dispose();
  }

  // Every element the sheet styles, in its states and through its motion, with nothing refused.
  {
    const host = Host.create(native);
    try {
      const errors = [];
      host.onStyleErrors((e) => errors.push(...e));
      const state = new ThemeState(context, neutralTheme, { scheme: 'light' });
      state.attach(host.layout);
      addUserAgent(host.layout);
      const colors = neutralTheme.light.colors;
      let clock = 0;
      const start = () => {
        host.compute(W, H);
        host.layout.tickMotion((clock += 1));
      };
      const advance = (ms) => host.layout.tickMotion((clock += ms));
      const settle = () => {
        start();
        advance(1000);
      };
      const part = (tag, name, children = []) => {
        const element = el(host, tag, children);
        element.setAttribute('class', name);
        return element;
      };
      const input = (type, children = []) => {
        const element = el(host, 'input', children);
        element.setAttribute('type', type);
        return element;
      };
      const row = (tag, ...cells) =>
        el(
          host,
          'tr',
          cells.map((c) => el(host, tag, [c])),
        );
      const rows = [row('td', 'a', 'bb', 'a much longer cell'), row('td', 'ccc', 'd', 'e')];
      const table = el(host, 'table', [
        el(host, 'caption', ['Sizes']),
        el(host, 'thead', [row('th', 'Name', 'Short', 'Long')]),
        el(host, 'tbody', rows),
      ]);
      const hidden = el(host, 'p', ['Hidden until open']);
      const details = el(host, 'details', [
        el(host, 'summary', [part('span', 'marker', ['>']), 'More']),
        hidden,
      ]);
      const checkbox = input('checkbox', [part('span', 'check'), part('span', 'dash')]);
      checkbox.setAttribute('style', 'position: absolute; left: 10px; top: 10px');
      const button = el(host, 'button', ['Focus me']);
      button.setAttribute('style', 'position: absolute; left: 10px; top: 50px');
      const dialog = el(host, 'dialog', [el(host, 'p', ['A dialog'])]);
      dialog.setAttribute(
        'style',
        'position: absolute; left: 140px; top: 10px; width: 200px; height: 100px',
      );
      const progress = el(host, 'progress', [part('div', 'bar')]);
      const listbox = el(host, 'listbox', [
        el(host, 'optgroup', ['Group']),
        el(host, 'option', ['One']),
        el(host, 'option', ['Two']),
      ]);
      const flow = el(host, 'div', [
        table,
        details,
        el(host, 'fieldset', [
          el(host, 'legend', ['Controls']),
          el(host, 'label', [input('radio', [part('span', 'dot')]), 'Radio']),
          input('text'),
          el(host, 'textarea'),
          input('number', [part('div', 'steppers', [el(host, 'div'), el(host, 'div')])]),
          input('range', [part('div', 'fill'), part('div', 'thumb'), part('div', 'rest')]),
          progress,
          el(host, 'meter', [part('div', 'bar optimum')]),
          el(host, 'select', ['Pick', part('span', 'chevron', ['v'])]),
          listbox,
        ]),
        el(host, 'ul', [el(host, 'li', ['Item', el(host, 'ul', [el(host, 'li', ['Nested'])])])]),
      ]);
      flow.setAttribute('style', 'position: absolute; left: 0px; top: 140px; width: 360px');
      host.root.appendChild(flow);
      host.root.appendChild(checkbox);
      host.root.appendChild(button);
      host.root.appendChild(dialog);
      settle();

      // A table's columns line up from row to row, however long a cell is.
      const cells = rows.map((r) => r.childNodes.map((c) => c.bounds()));
      for (let i = 0; i < 3; i++) {
        assert.equal(cells[0][i][0], cells[1][i][0], `column ${i} starts in one place`);
        assert.equal(cells[0][i][2], cells[1][i][2], `column ${i} is one width`);
      }

      // A closed details shows only its summary.
      assert.equal(hidden.bounds()[3], 0, 'closed, the rest is not shown');
      details.setAttribute('open', '');
      settle();
      assert.ok(hidden.bounds()[3] > 0, 'open, it is');

      // A checkbox given :checked eases from the field colour to the primary one.
      const middle = async () => {
        const [x, y, w, h] = checkbox.bounds();
        return pixel(await capture(host), x + w / 2, y + h / 2);
      };
      assert.ok(near(await middle(), rgb8(colors.inputBg)), `unchecked ${await middle()}`);
      checkbox.setState('checked', true);
      assert.equal(checkbox.hasState('checked'), true);
      start();
      assert.ok(near(await middle(), rgb8(colors.inputBg)), 'it starts from where it was');
      advance(1000);
      assert.ok(near(await middle(), rgb8(colors.primary)), `checked ${await middle()}`);
      assert.throws(() => checkbox.setState('hover', true), /not a state an element is given/);
      assert.throws(() => checkbox.setState('glowing', true), /not a state an element is given/);

      // A focus ring grows out from nothing.
      const ring = async () => {
        const [x, y] = button.bounds();
        return pixel(await capture(host), x - 3, y + 8);
      };
      const ground = rgb8(colors.background);
      assert.ok(near(await ring(), ground), 'no ring at rest');
      host.input.focus(button, true);
      start();
      assert.ok(near(await ring(), ground), 'the ring starts at no width');
      advance(1000);
      assert.ok(!near(await ring(), ground, 6), `the ring has grown: ${await ring()}`);

      // A dialog is hidden until open, grows in, and shrinks away while closing.
      assert.equal(dialog.bounds()[2], 0, 'a closed dialog is not shown');
      const panel = async () => {
        const [x, y, w, h] = dialog.bounds();
        return pixel(await capture(host), x + w / 2, y + h / 2);
      };
      dialog.setAttribute('open', '');
      start();
      assert.ok(near(await panel(), ground), 'it starts from nothing');
      advance(1000);
      assert.ok(near(await panel(), rgb8(colors.surfaceElevated)), `open ${await panel()}`);
      dialog.setAttribute('closing', '');
      dialog.removeAttribute('open');
      const closed = dialog.animationsFinished();
      start();
      advance(1000);
      await closed;
      assert.ok(near(await panel(), ground), 'it has shrunk away');
      dialog.removeAttribute('closing');
      settle();
      assert.equal(dialog.bounds()[2], 0, 'and once it is gone, it is not shown');

      // An indeterminate progress bar pulses until it is told its value: in view, where motion draws.
      progress.setAttribute('style', 'position: absolute; left: 10px; top: 100px');
      host.root.appendChild(progress);
      progress.setState('indeterminate', true);
      start();
      assert.equal(advance(100), true, 'the pulse runs');
      progress.setState('indeterminate', false);
      settle();
      assert.equal(advance(100), false, 'and stops');

      // A scroll container's thumb takes the theme's quiet text colour: made red here, so nothing
      // else could be mistaken for it, in either scheme.
      state.override({ colors: { textTertiary: [1, 0, 0, 1] } });
      for (const scheme of ['light', 'dark']) {
        state.setScheme(scheme);
        const scroller = el(
          host,
          'div',
          [el(host, 'div', [], 'width: 20px; height: 400px; flex-shrink: 0')],
          'position: absolute; left: 250px; top: 10px; width: 60px; height: 100px; overflow: auto; flex-direction: column',
        );
        host.root.appendChild(scroller);
        settle();
        const frame = await capture(host);
        const [sx, sy, sw] = scroller.bounds();
        const ground = pixel(frame, sx + 10, sy + 50);
        const thumb = pixel(frame, sx + sw - 4, sy + 10);
        // 55% of red over the page, as the sheet mixes it.
        const expected = [
          Math.round(255 * 0.55 + ground[0] * 0.45),
          Math.round(ground[1] * 0.45),
          Math.round(ground[2] * 0.45),
          255,
        ];
        assert.ok(
          near(thumb, expected, 8),
          `${scheme}: the thumb follows the theme: ${thumb}, wanted ${expected}`,
        );
        host.root.removeChild(scroller);
      }
      state.setScheme('light');
      assert.deepEqual(errors, [], 'no declaration was refused');
      state.dispose();
    } finally {
      host.dispose();
    }
  }

  // Prose: a paragraph with inline elements wraps as one under the sheet, and a press on its link reaches it.
  {
    const host = Host.create(native);
    try {
      const errors = [];
      host.onStyleErrors((e) => errors.push(...e));
      const state = new ThemeState(context, neutralTheme, { scheme: 'light' });
      state.attach(host.layout);
      addUserAgent(host.layout);
      const link = el(host, 'a', ['documentation for the whole of the thing']);
      const code = el(host, 'code', ['use()']);
      const prose = el(
        host,
        'p',
        ['Read the ', link, ' and ', el(host, 'strong', ['then']), ' ', code, ' it every day.'],
        'width: 180px',
      );
      const plain = el(
        host,
        'p',
        ['Read the documentation for the whole of the thing and then use() it every day.'],
        'width: 180px',
      );
      host.root.appendChild(el(host, 'div', [prose, plain]));
      const frame = await capture(host, 'prose');
      assert.ok(prose.bounds()[2] <= 180.5, 'inside its width');
      assert.ok(prose.bounds()[3] >= 2 * 20, `over several lines: ${prose.bounds()[3]}`);
      assert.ok(
        Math.abs(prose.bounds()[3] - plain.bounds()[3]) <= 26,
        `about the lines plain text takes: ${prose.bounds()[3]} against ${plain.bounds()[3]}`,
      );
      // The link's colour is the theme's, and a press where it is drawn reaches it.
      const want = rgb8(neutralTheme.light.colors.textLink);
      const [px, py, pw, ph] = prose.bounds();
      let hit = null;
      for (let y = Math.floor(py + ph) - 1; y >= py && !hit; y--) {
        for (let x = Math.floor(px); x < px + pw; x++) {
          if (near(pixel(frame, x, y), want, 6)) {
            hit = [x, y];
            break;
          }
        }
      }
      assert.ok(hit, `the link is drawn in the theme's colour ${want}`);
      assert.equal(host.elementAt(hit[0], hit[1]), link, 'a press on it reaches the link');
      assert.deepEqual(errors, []);
      state.dispose();
    } finally {
      host.dispose();
    }
  }

  // The sheet is under every other: an app rule wins whichever was added first.
  for (const appFirst of [true, false]) {
    const host = Host.create(native);
    try {
      host.onStyleErrors(() => {}); // no theme here: the ground and ink go unresolved
      const add = () => host.layout.addStyleSheet('p { margin-top: 0; margin-bottom: 0; }');
      const first = el(host, 'p', ['One']);
      const second = el(host, 'p', ['Two']);
      host.root.appendChild(el(host, 'div', [first, second]));
      if (appFirst) {
        add();
        addUserAgent(host.layout);
      } else {
        addUserAgent(host.layout);
        add();
      }
      host.compute(W, H);
      const [, y, , h] = first.bounds();
      assert.equal(
        second.bounds()[1],
        y + h,
        `the app's margin wins, added ${appFirst ? 'before' : 'after'}`,
      );
    } finally {
      host.dispose();
    }
  }
  {
    // Without an app rule the sheet's margins hold the paragraphs apart.
    const host = Host.create(native);
    try {
      host.onStyleErrors(() => {});
      const first = el(host, 'p', ['One']);
      const second = el(host, 'p', ['Two']);
      host.root.appendChild(el(host, 'div', [first, second]));
      addUserAgent(host.layout);
      host.compute(W, H);
      const [, y, , h] = first.bounds();
      assert.ok(second.bounds()[1] > y + h, 'paragraphs are spaced');
    } finally {
      host.dispose();
    }
  }
} finally {
  context.dispose();
  target.dispose();
}
console.log(
  'Native user-agent sheet: stacking, type, theme ground, states, controls, motion, rules and precedence passed',
);
