import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { compileCss, loadNative } from '../dist/native/index.js';
import { Host } from '../dist/native/host.js';
import { SceneRenderer } from '../dist/native/renderer.js';
import { OffscreenRenderer } from '../dist/native/offscreen.js';
import { probeShader } from '../dist/renderer/shaders.js';

const native = loadNative();
const W = 600,
  H = 720;
const output = new URL('../.blinc/text-align/', import.meta.url);
await mkdir(output, { recursive: true });
const short = 'Hello alignment';
const words = 'one two three four five six seven eight nine ten eleven twelve thirteen';
const sheet = [
  ':root {background:black;color:white;font-size:16px;}',
  '.box {position:absolute;left:20px;top:20px;width:240px;padding:12px;border:1px solid #444;line-height:1.5;overflow:hidden;font-size:16px;}',
  '.left {text-align:left;} .center {text-align:center;} .right {text-align:right;} .justify {text-align:justify;}',
  '.start {text-align:start;} .end {text-align:end;}',
  '.nowrap {white-space:nowrap;} .ellipsis {white-space:nowrap;text-overflow:ellipsis;} .clamp {line-clamp:2;}',
  '.parent {position:absolute;left:0;top:0;width:100%;height:100%;}',
  '.middle {width:100%;height:100%;}',
].join('\n');

function scene(compiled) {
  const host = Host.create(native);
  const errors = [];
  host.onStyleErrors((items) => errors.push(...items));
  const result = host.layout.addStyleSheet(compiled ? compileCss(sheet).bytes : sheet);
  assert.deepEqual(result.diagnostics, []);
  return { host, errors };
}
function box(host, tag, classes, data = short) {
  const element = host.createElement(tag);
  element.className = 'box ' + classes;
  const text = host.createTextNode(data);
  element.appendChild(text);
  host.root.appendChild(element);
  return { element, text };
}
function content(element) {
  const [x, y, width, height] = element.bounds();
  return [x + 13, y + 13, width - 26, Math.max(0, height - 26)];
}
function ink(frame, area) {
  const [x, y, width, height] = area;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -1,
    y1 = -1;
  const s = frame.scale;
  for (
    let py = Math.max(0, Math.floor(y * s));
    py < Math.min(frame.height, Math.ceil((y + height) * s));
    py++
  ) {
    for (
      let px = Math.max(0, Math.floor(x * s));
      px < Math.min(frame.width, Math.ceil((x + width) * s));
      px++
    ) {
      const at = (py * frame.width + px) * 4;
      if (frame.pixels[at] > 180 && frame.pixels[at + 1] > 180 && frame.pixels[at + 2] > 180) {
        x0 = Math.min(x0, px);
        y0 = Math.min(y0, py);
        x1 = Math.max(x1, px);
        y1 = Math.max(y1, py);
      }
    }
  }
  return x1 < 0 ? null : [x0 / s, y0 / s, (x1 + 1) / s, (y1 + 1) / s];
}
function lines(frame, element) {
  const [x, y, width, height] = content(element);
  return Array.from({ length: Math.ceil(height / 24) }, (_, i) =>
    ink(frame, [x, y + i * 24, width, Math.min(24, height - i * 24)]),
  ).filter(Boolean);
}
function aligned(frame, element, align) {
  const [x, , width] = content(element);
  const rows = lines(frame, element);
  assert.ok(rows.length > 0, 'text is visible');
  for (const row of rows) {
    const left = row[0] - x,
      right = x + width - row[2];
    if (align === 'center')
    // Alignment uses advances; the first/last glyph's ink has its own side bearings.
    {
      assert.ok(Math.abs(left - right) <= 4, 'center margins: ' + [left, right]);
    }
    if (align === 'right') {
      assert.ok(Math.abs(right) <= 4, 'right margin: ' + right);
    }
    if (align === 'left') {
      assert.ok(Math.abs(left) <= 2, 'left margin: ' + left);
    }
  }
  return rows;
}
function alignedAdvances(frame, reference, actual, baseline, host, mode) {
  const rows = lines(frame, actual.element);
  const left = lines(reference, baseline.element);
  const [, , width] = content(actual.element);
  const measured = native.measureText(actual.text.data, host.textStyleOf(actual.text), width);
  assert.equal(rows.length, measured.lineCount);
  assert.equal(left.length, rows.length);
  for (const [i, row] of rows.entries()) {
    const advance = measured.line(i).width;
    const shift = Math.max(0, width + 1 - advance) * (mode === 'center' ? 0.5 : 1);
    for (const edge of [0, 2]) {
      assert.ok(
        Math.abs(row[edge] - left[i][edge] - shift) <= 1.5,
        mode + ' line ' + i + ' follows its shaped advance: ' + [row[edge], left[i][edge], shift],
      );
    }
  }
  return rows;
}
async function capture(target, renderer, host, scale, name) {
  host.compute(W, H);
  const width = W * scale,
    height = H * scale;
  const pixels = new Uint8Array(width * height * 4);
  await target.captureCommandsInto(
    pixels,
    (e, v) => renderer.encode(e, host.root.layoutNode, v, { width, height, scale }).drawCalls,
  );
  if (name) {
    await writeFile(
      new URL(name + '.png', output),
      PNG.sync.write({ width, height, data: Buffer.from(pixels) }),
    );
  }
  return { pixels, width, height, scale };
}
function authored({ element, text }, data) {
  assert.deepEqual(element.childNodes, [text], 'one authored text, no inserted spans or pieces');
  assert.equal(text.data, data);
  assert.equal(element.textContent, data);
}

for (const scale of [1, 2]) {
  const target = await OffscreenRenderer.create(native, W * scale, H * scale, probeShader);
  let runtime;
  try {
    for (const compiled of [false, true]) {
      const prefix = (compiled ? 'compiled' : 'runtime') + '-' + scale + 'x';
      const { host, errors } = scene(compiled);
      const renderer = new SceneRenderer(target.device, host.layout);
      try {
        const fixtures = [
          ['h2', 'center', short],
          ['h3', 'right', short],
          ['p', 'center', words],
          ['p', 'right', words],
          ['p', 'justify', words],
          ['div', 'end', short],
          ['p', 'start', short],
          ['p', 'center nowrap', words],
          ['p', 'right nowrap', words],
          ['p', 'center ellipsis', words],
          ['p', 'center clamp', words],
          ['p', 'justify nowrap', words],
        ].map(([tag, classes, data], i) => {
          const f = box(host, tag, classes, data);
          f.element.setAttribute(
            'style',
            'left:' + (20 + (i % 2) * 290) + 'px;top:' + (20 + Math.floor(i / 2) * 110) + 'px',
          );
          return { ...f, classes, data };
        });
        const frame = await capture(target, renderer, host, scale, prefix + '-blocks');
        if (compiled) {
          assert.deepEqual(frame.pixels, runtime, 'compiled CSS matches runtime pixels');
        } else {
          runtime = frame.pixels;
        }
        for (const f of fixtures) {
          authored(f, f.data);
        }
        aligned(frame, fixtures[0].element, 'center');
        aligned(frame, fixtures[1].element, 'right');
        const reference = scene(compiled);
        const left = [2, 3].map((i) => {
          const f = box(reference.host, 'p', 'left', words);
          f.element.setAttribute('style', 'left:' + (20 + (i % 2) * 290) + 'px;top:130px');
          return f;
        });
        const rr = new SceneRenderer(target.device, reference.host.layout);
        try {
          const image = await capture(target, rr, reference.host, scale);
          assert.ok(
            alignedAdvances(frame, image, fixtures[2], left[0], host, 'center').length >= 3,
            'centered paragraph wraps',
          );
          assert.ok(
            alignedAdvances(frame, image, fixtures[3], left[1], host, 'right').length >= 3,
            'right paragraph wraps',
          );
          assert.deepEqual(reference.errors, []);
        } finally {
          rr.dispose();
          reference.host.dispose();
        }
        aligned(frame, fixtures[5].element, 'right');
        aligned(frame, fixtures[6].element, 'left');
        const justified = lines(frame, fixtures[4].element);
        const [jx, , jw] = content(fixtures[4].element);
        assert.ok(justified.length >= 3);
        for (const row of justified.slice(0, -1)) {
          assert.ok(
            Math.abs(row[0] - jx) <= 4 && Math.abs(row[2] - (jx + jw)) <= 4,
            'justified line fills content width: ' + row,
          );
        }
        assert.ok(justified.at(-1)[2] < jx + jw - 10, 'last justified line keeps natural spaces');
        assert.equal(host.inlineFlows.owns(fixtures[4].text), true);
        for (const i of [0, 1, 2, 3, 7, 8, 9, 10, 11]) {
          assert.equal(
            host.inlineFlows.owns(fixtures[i].text),
            false,
            'native alignment keeps native text layout',
          );
        }
        for (const i of [7, 8, 9, 11]) {
          assert.equal(lines(frame, fixtures[i].element).length, 1, 'nowrap remains one line');
        }
        assert.equal(
          lines(frame, fixtures[10].element).length,
          2,
          'centered line clamp remains two lines',
        );
        const [ex, ey, ew] = content(fixtures[9].element);
        const dots = ink(frame, [ex + ew - 6, ey, 6, 24]);
        assert.ok(dots && dots[3] - dots[1] <= 5, 'centered overflow ends with ellipsis dots');
        assert.deepEqual(errors, []);
      } finally {
        renderer.dispose();
        host.dispose();
      }

      const dynamic = scene(compiled);
      const d = box(dynamic.host, 'h2', 'left');
      const r = new SceneRenderer(target.device, dynamic.host.layout);
      const reference = scene(compiled);
      const left = box(reference.host, 'h2', 'left', words);
      const rr = new SceneRenderer(target.device, reference.host.layout);
      try {
        const leftFrame = await capture(target, rr, reference.host, scale);
        let frame = await capture(target, r, dynamic.host, scale);
        aligned(frame, d.element, 'left');
        assert.equal(dynamic.host.inlineFlows.owns(d.text), false);
        assert.ok(d.text.bounds()[2] < content(d.element)[2] - 40, 'left text keeps natural width');
        for (const mode of ['center', 'right', 'end', 'left', 'center']) {
          d.element.className = 'box ' + mode;
          frame = await capture(target, r, dynamic.host, scale);
          aligned(frame, d.element, mode === 'end' ? 'right' : mode);
          authored(d, short);
          assert.equal(dynamic.host.inlineFlows.owns(d.text), false);
        }
        d.text.data = words;
        d.element.className = 'box justify';
        frame = await capture(target, r, dynamic.host, scale, prefix + '-justify');
        assert.equal(
          dynamic.host.inlineFlows.owns(d.text),
          true,
          'alignment change activates justification',
        );
        authored(d, words);
        d.element.className = 'box justify nowrap';
        frame = await capture(target, r, dynamic.host, scale);
        assert.equal(
          dynamic.host.inlineFlows.owns(d.text),
          false,
          'nowrap dissolves a single-text justification flow',
        );
        assert.equal(lines(frame, d.element).length, 1);
        d.element.className = 'box justify';
        frame = await capture(target, r, dynamic.host, scale);
        assert.equal(
          dynamic.host.inlineFlows.owns(d.text),
          true,
          'restoring wrapping activates justification without changing alignment',
        );
        d.element.className = 'box center';
        frame = await capture(target, r, dynamic.host, scale);
        alignedAdvances(frame, leftFrame, d, left, dynamic.host, 'center');
        assert.equal(
          dynamic.host.inlineFlows.owns(d.text),
          false,
          'center dissolves a plain justification flow',
        );
        const span = dynamic.host.createElement('span');
        d.element.appendChild(span);
        frame = await capture(target, r, dynamic.host, scale);
        aligned(frame, d.element, 'center');
        assert.equal(
          dynamic.host.inlineFlows.owns(d.text),
          true,
          'mixed inline text uses the paragraph path',
        );
        d.element.removeChild(span);
        span.destroy();
        frame = await capture(target, r, dynamic.host, scale);
        alignedAdvances(frame, leftFrame, d, left, dynamic.host, 'center');
        assert.equal(
          dynamic.host.inlineFlows.owns(d.text),
          false,
          'returning to plain text restores native width/alignment',
        );
        d.text.data = '';
        frame = await capture(target, r, dynamic.host, scale);
        assert.equal(ink(frame, [20, 20, 240, 150]), null, 'empty text leaves no old fragments');
        d.element.className = 'box justify';
        d.text.data = words;
        frame = await capture(target, r, dynamic.host, scale);
        assert.equal(
          dynamic.host.inlineFlows.owns(d.text),
          true,
          'empty text can return as a justified paragraph',
        );
        d.element.className = 'box';
        d.text.data = short;
        const a = dynamic.host.createElement('div'),
          b = dynamic.host.createElement('div');
        a.className = 'parent center';
        b.className = 'parent right';
        dynamic.host.root.appendChild(a);
        dynamic.host.root.appendChild(b);
        const middle = dynamic.host.createElement('div');
        middle.className = 'middle';
        a.appendChild(middle);
        middle.appendChild(d.element);
        frame = await capture(target, r, dynamic.host, scale);
        aligned(frame, d.element, 'center');
        a.className = 'parent justify';
        d.text.data = words;
        frame = await capture(target, r, dynamic.host, scale);
        assert.equal(
          dynamic.host.inlineFlows.owns(d.text),
          true,
          'late inherited alignment activates the nested paragraph',
        );
        b.appendChild(middle);
        d.text.data = short;
        frame = await capture(target, r, dynamic.host, scale);
        aligned(frame, d.element, 'right');
        assert.equal(
          dynamic.host.inlineFlows.owns(d.text),
          false,
          'reparenting clears inherited justification',
        );
        d.element.setAttribute('style', 'text-align:initial');
        frame = await capture(target, r, dynamic.host, scale);
        aligned(frame, d.element, 'left');
        d.element.setAttribute('style', 'text-align:inherit');
        frame = await capture(target, r, dynamic.host, scale);
        aligned(frame, d.element, 'right');
        d.element.setAttribute('style', 'text-align:unset');
        frame = await capture(target, r, dynamic.host, scale, prefix + '-inherited');
        aligned(frame, d.element, 'right');
        authored(d, short);
        assert.deepEqual(dynamic.errors, []);
        assert.deepEqual(reference.errors, []);
      } finally {
        rr.dispose();
        reference.host.dispose();
        r.dispose();
        dynamic.host.dispose();
      }

      const intrinsic = scene(compiled);
      const auto = box(intrinsic.host, 'h2', 'center');
      auto.element.setAttribute('style', 'width:auto;overflow:visible');
      const ar = new SceneRenderer(target.device, intrinsic.host.layout);
      try {
        const frame = await capture(target, ar, intrinsic.host, scale);
        assert.ok(
          auto.element.bounds()[2] > 80,
          'an auto-width heading retains its intrinsic text size',
        );
        assert.ok(ink(frame, [0, 0, W, H]), 'auto-width text is drawn');
        authored(auto, short);
        assert.deepEqual(intrinsic.errors, []);
      } finally {
        ar.dispose();
        intrinsic.host.dispose();
      }
    }
  } finally {
    target.dispose();
  }
}
console.log(
  'Native plain text alignment: headings, paragraphs, justify, inheritance, changes, nowrap/ellipsis/clamp and intrinsic sizing passed through runtime/compiled CSS at 1x/2x.',
);
