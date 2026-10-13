import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { compileCss, loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { probeShader } from '../dist/renderer/shaders.js';
import { ThemeState, neutralTheme } from '../dist/theme/index.js';
import { addUserAgent } from '../dist/theme/user-agent.js';
import { TopLayer } from '../dist/native/top-layer.js';

const native = loadNative();
const W = 640;
const H = 440;
const output = new URL('../.blinc/select-multiple/', import.meta.url);
await mkdir(output, { recursive: true });
const css = `
:root { background: #000; }
select { position: absolute; top: 20px; width: 210px; font-size: 16px; transition: none; }
.multi { left: 20px; }
.single { left: 270px; }
select > .options option { transition: none; }
select > .options option:checked { background: #ff0000; }
.multi > option:checked { list-style-type: square; }
`;
const modifiers = (values = {}) => ({
  shift: false,
  control: false,
  alt: false,
  meta: false,
  ...values,
});

for (const scale of [1, 2]) {
  const target = await OffscreenRenderer.create(native, W * scale, H * scale, probeShader);
  const captures = [];
  try {
    for (const compiled of [false, true]) {
      const host = Host.create(native);
      const graph = native.createReactive();
      const theme = new ThemeState(graph, neutralTheme, { scheme: 'light' });
      theme.attach(host.layout);
      addUserAgent(host.layout);
      const renderer = new SceneRenderer(target.device, host.layout);
      renderer.useImages(host.images.library);
      try {
        const errors = [];
        host.onStyleErrors((items) => errors.push(...items));
        host.layout.addStyleSheet(compiled ? compileCss(css).bytes : css);
        const el = (tag, attrs = {}, children = []) => {
          const element = host.createElement(tag);
          for (const [name, value] of Object.entries(attrs)) {
            element.setAttribute(name, value);
          }
          for (const child of children) {
            element.appendChild(typeof child === 'string' ? host.createTextNode(child) : child);
          }
          return element;
        };
        const option = (value, attrs = {}) =>
          el('option', { value, ...attrs }, [value.toUpperCase()]);
        const options = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((value) => option(value));
        options[2].setAttribute('disabled', '');
        options[1].setAttribute('selected', '');
        const group = el('optgroup', { label: 'Unavailable', disabled: '' }, [
          option('x', { selected: '' }),
        ]);
        const multi = el('select', { class: 'multi', multiple: '', name: 'fruit', required: '' }, [
          ...options,
          group,
        ]);
        const singleOptions = ['one', 'two', 'three', 'four'].map((value) => option(value));
        const single = el(
          'select',
          { class: 'single', size: '3', name: 'single', required: '' },
          singleOptions,
        );
        const form = el('form', {}, [multi, single]);
        const next = el('button', { style: 'position:absolute;left:270px;top:200px' }, ['Next']);
        host.root.appendChild(form);
        host.root.appendChild(next);
        let clock = 0;
        const settle = () => {
          host.compute(W, H);
          host.layout.tickMotion(++clock);
          host.layout.tickMotion((clock += 2000));
          host.compute(W, H);
        };
        const selects = host.behaviours.selects;
        const row = (select, option) => selects.row(select, option);
        const list = (select) => selects.part(select, 'options');
        const values = (select = multi) => select.selectedOptions.map((o) => o.value);
        const click = (select, option, mods = {}) => {
          const r = row(select, option);
          r.scrollIntoView({ block: 'nearest' });
          settle();
          const [x, y, w, h] = r.viewBounds();
          host.input.setModifiers(modifiers(mods));
          host.input.pointerMove(x + w / 2, y + h / 2);
          host.input.pointerDown();
          host.input.pointerUp();
          host.input.pointerMove(W - 1, H - 1);
          host.input.setModifiers(modifiers());
          settle();
        };
        const key = (key, mods = {}) => {
          const init = { key, modifiers: modifiers(mods) };
          host.input.keyDown(init);
          host.input.keyUp(init);
          settle();
        };
        const events = [];
        multi.addEventListener('input', () => events.push('input'));
        multi.addEventListener('change', () => events.push('change'));
        const capture = async (name) => {
          settle();
          const pixels = new Uint8Array(W * H * scale * scale * 4);
          await target.captureCommandsInto(
            pixels,
            (e, v) =>
              renderer.encode(e, host.root.layoutNode, v, {
                width: W * scale,
                height: H * scale,
                scale,
              }).drawCalls,
          );
          await writeFile(
            new URL(`${name}-${compiled ? 'compiled' : 'runtime'}-${scale}x.png`, output),
            PNG.sync.write({ width: W * scale, height: H * scale, data: Buffer.from(pixels) }),
          );
          return pixels;
        };
        settle();
        assert.equal(multi.size, 0);
        assert.equal(multi.multiple, true);
        assert.deepEqual(values(), ['b', 'x']);
        assert.deepEqual(values(single), [], 'size > 1 does not pick a default first option');
        assert.equal(single.validity.valueMissing, true);
        assert.equal(multi.validity.valid, true);
        assert.equal(multi.selectedIndex, 1);
        assert.equal(multi.value, 'b');
        assert.equal(options[1].selected, true);
        assert.equal(options[1].hasState('checked'), true);
        assert.equal(
          host.declaredOf(options[1]).get('list-style-type'),
          'square',
          ':checked styles authored options',
        );
        assert.equal(multi.childNodes.length, 9, 'owned rows stay outside framework children');
        assert.equal(form.elements.length, 2, 'proxy rows are not successful controls');
        assert.deepEqual(
          [...form.formData()],
          [['fruit', 'b']],
          'disabled group values are omitted',
        );
        assert.equal(TopLayer.of(host).entries.length, 0);
        assert(
          Math.abs(list(multi).bounds()[3] - 4 * 31.2) < 1,
          'multiple defaults to four visible rows',
        );
        assert(Math.abs(list(single).bounds()[3] - 3 * 31.2) < 1, 'size controls visible rows');
        captures.push(await capture('defaults'));

        click(multi, options[0]);
        assert.deepEqual(values(), ['a']);
        assert.deepEqual(events, ['input', 'change']);
        events.length = 0;
        click(multi, options[0]);
        assert.deepEqual(events, [], 'unchanged selection is silent');
        click(multi, options[3], { control: true });
        assert.deepEqual(values(), ['a', 'd']);
        click(multi, options[0], { meta: true });
        assert.deepEqual(values(), ['d'], 'Cmd toggles independently too');
        click(multi, options[6], { shift: true });
        assert.deepEqual(
          values(),
          ['a', 'b', 'd', 'e', 'f', 'g'],
          'range uses the preceding toggle anchor and skips disabled options',
        );
        click(multi, options[4], { shift: true });
        assert.deepEqual(values(), ['a', 'b', 'd', 'e'], 'shrinking a range removes its tail');
        click(multi, options[2]);
        assert.deepEqual(values(), ['a', 'b', 'd', 'e'], 'disabled click is ignored');
        click(multi, group.firstChild);
        assert.deepEqual(values(), ['a', 'b', 'd', 'e'], 'disabled group click is ignored');
        assert.equal(host.input.focused, multi, 'list has a single tab stop');

        click(multi, options[0]);
        click(multi, options[3], { control: true });
        click(multi, options[7], { control: true, shift: true });
        assert.deepEqual(
          values(),
          ['a', 'd', 'e', 'f', 'g', 'h'],
          'Ctrl-Shift preserves selections outside the range',
        );
        click(multi, options[5], { control: true, shift: true });
        assert.deepEqual(
          values(),
          ['a', 'd', 'e', 'f'],
          'additive ranges shrink without losing their base',
        );

        click(multi, options[1]);
        key('ArrowDown', { shift: true });
        assert.deepEqual(values(), ['b', 'd'], 'Shift arrow skips disabled row');
        key('ArrowDown', { shift: true });
        assert.deepEqual(values(), ['b', 'd', 'e']);
        key('ArrowUp', { shift: true });
        assert.deepEqual(values(), ['b', 'd']);
        events.length = 0;
        key('End', { control: true });
        assert.deepEqual(values(), ['b', 'd'], 'Ctrl arrow/end moves only the active row');
        assert.deepEqual(events, []);
        assert(list(multi).scrollTop > 0, 'keyboard scrolls the active option into view');
        key(' ');
        assert.deepEqual(values(), ['b', 'd', 'h'], 'Space toggles active row once');
        key('Home', { meta: true });
        key(' ', { control: true });
        assert.deepEqual(values(), ['a', 'b', 'd', 'h']);
        key('a', { control: true });
        assert.deepEqual(values(), ['a', 'b', 'd', 'e', 'f', 'g', 'h']);
        key('Home');
        key('PageDown');
        assert.deepEqual(values(), ['e']);
        key('PageUp');
        assert.deepEqual(values(), ['a']);
        host.input.text('f');
        settle();
        assert.deepEqual(values(), ['f'], 'typeahead selects without opening a popup');
        key('Tab');
        assert.equal(host.input.focused, single, 'Tab leaves the list');
        key('ArrowDown');
        assert.equal(single.value, 'one', 'first arrow starts at the first enabled row');
        key('End', { shift: true });
        assert.deepEqual(values(single), ['four'], 'size list remains single choice');
        key(' ', { control: true });
        assert.deepEqual(values(single), [], 'single list permits deselection');
        assert.equal(single.validity.valueMissing, true);
        key('Tab');
        assert.equal(host.input.focused, next);

        events.length = 0;
        options[0].selected = true;
        options[3].selected = true;
        options[5].selected = false;
        assert.deepEqual(values(), ['a', 'd']);
        assert.deepEqual(events, [], 'script setters are silent');
        assert.equal(
          options[0].hasAttribute('selected'),
          false,
          'property keeps reset default intact',
        );
        options[0].setAttribute('selected', '');
        options[0].removeAttribute('selected');
        assert.equal(
          options[0].selected,
          true,
          'dirty current selection ignores default attribute changes',
        );
        multi.value = 'g';
        assert.deepEqual(values(), ['g'], 'value setter replaces all selected options');
        multi.selectedIndex = -1;
        assert.deepEqual(values(), []);
        assert.equal(multi.value, '');
        assert.equal(multi.validity.valueMissing, true);
        assert.deepEqual([...form.formData()], [], 'no selection makes no form entry');
        multi.value = 'not-an-option';
        assert.deepEqual(values(), []);
        form.reset();
        settle();
        assert.deepEqual(values(), ['b', 'x'], 'reset restores every selected default');
        assert.equal(single.selectedIndex, -1);
        options[0].setAttribute('selected', '');
        assert.deepEqual(values(), ['a', 'b', 'x'], 'reset clears selection dirtiness');
        options[0].removeAttribute('selected');
        const added = option('new', { selected: '' });
        multi.insertBefore(added, options[0]);
        settle();
        assert.deepEqual(values(), ['new', 'b', 'x']);
        const stable = row(multi, options[1]);
        added.firstChild.data = 'Renamed';
        added.setAttribute('class', 'custom');
        settle();
        assert.equal(row(multi, added).textContent, 'Renamed');
        assert.equal(row(multi, added).className, 'custom');
        added.setAttribute('disabled', '');
        assert.deepEqual(
          [...form.formData()],
          [['fruit', 'b']],
          'new disabled option is excluded immediately',
        );
        multi.removeChild(added);
        settle();
        assert.equal(row(multi, added), undefined, 'removed option releases its row');
        assert.equal(row(multi, options[1]), stable, 'unchanged rows retain identity');
        assert.deepEqual(values(), ['b', 'x']);
        group.removeAttribute('disabled');
        settle();
        assert.deepEqual(
          [...form.formData()],
          [
            ['fruit', 'b'],
            ['fruit', 'x'],
          ],
        );
        group.setAttribute('disabled', '');
        multi.setAttribute('disabled', '');
        settle();
        assert.deepEqual([...form.formData()], []);
        click(multi, options[0]);
        assert.deepEqual(values(), ['b', 'x']);
        multi.removeAttribute('disabled');
        const fieldset = el('fieldset', { disabled: '' }, []);
        host.root.appendChild(fieldset);
        fieldset.appendChild(multi);
        settle();
        assert.deepEqual([...form.formData()], []);
        click(multi, options[0]);
        assert.deepEqual(values(), ['b', 'x'], 'disabled fieldset prevents changes');
        form.appendChild(multi);
        fieldset.destroy();
        settle();

        multi.size = 2;
        settle();
        assert(Math.abs(list(multi).bounds()[3] - 2 * 31.2) < 1);
        multi.size = 5;
        multi.multiple = false;
        settle();
        assert.deepEqual(values(), ['x'], 'removing multiple retains the last selected option');
        multi.value = 'b';
        multi.size = 1;
        settle();
        assert.equal(list(multi), undefined, 'switching to popup releases inline list');
        selects.open(multi);
        settle();
        assert.equal(TopLayer.of(host).entries.length, 1);
        multi.multiple = true;
        settle();
        assert.equal(TopLayer.of(host).entries.length, 0, 'switching back closes popup');
        assert(list(multi));
        assert.equal(multi.hasAttribute('open'), false);
        multi.size = 4;
        click(multi, options[0]);
        click(multi, options[3], { shift: true });
        list(multi).scrollTo(0, 0);
        host.input.blur();
        settle();
        const pixels = await capture('range');
        captures.push(pixels);
        for (const o of [options[0], options[1], options[3]]) {
          const [x, y] = row(multi, o).viewBounds();
          const i = (Math.floor((y + 3) * scale) * W * scale + Math.floor((x + 3) * scale)) * 4;
          assert.deepEqual(
            [...pixels.slice(i, i + 3)],
            [255, 0, 0],
            ':checked paints every selected proxy row',
          );
        }
        const owned = list(multi);
        const lastRow = row(multi, options[7]);
        multi.destroy();
        settle();
        assert(owned.destroyed && lastRow.destroyed, 'destroy releases owned list and rows');
        assert.equal(form.elements.length, 1);
        const empty = el('select', { multiple: '', name: 'empty', required: '' }, [
          option('', { selected: '' }),
        ]);
        form.appendChild(empty);
        assert.equal(
          empty.validity.valid,
          true,
          'an empty-valued list option is still a selection',
        );
        assert.deepEqual([...form.formData()], [['empty', '']]);
        const textOption = el('option', { selected: '' }, ['  text   value  ']);
        empty.appendChild(textOption);
        assert.equal(textOption.value, 'text value');
        assert.deepEqual(
          [...form.formData()],
          [
            ['empty', ''],
            ['empty', 'text value'],
          ],
        );
        textOption.value = 'explicit';
        assert.deepEqual(
          [...form.formData()],
          [
            ['empty', ''],
            ['empty', 'explicit'],
          ],
        );
        const placeholder = el('select', { required: '' }, [
          option('', { selected: '' }),
          option('real'),
        ]);
        form.appendChild(placeholder);
        assert.equal(
          placeholder.validity.valueMissing,
          true,
          'single-row empty placeholder remains missing',
        );
        placeholder.selectedIndex = 1;
        assert.equal(placeholder.validity.valid, true);
        settle();
        empty.focus();
        key('End', { control: true });
        empty.addEventListener('input', () => empty.destroy());
        key(' ');
        assert(empty.destroyed, 'an input handler may destroy the list during keyboard selection');
        added.destroy();
        assert.deepEqual(errors, []);
      } finally {
        renderer.dispose();
        host.dispose();
        theme.dispose();
        graph.dispose();
      }
    }
    assert.deepEqual(captures[0], captures[2], 'runtime/compiled default pixels match');
    assert.deepEqual(captures[1], captures[3], 'runtime/compiled range pixels match');
  } finally {
    target.dispose();
  }
}
console.log(
  'Native listbox selects: modifiers, keyboard ranges, state, forms, reset, dynamics, cleanup and 1x/2x pixels passed',
);
