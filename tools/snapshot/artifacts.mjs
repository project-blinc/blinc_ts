import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { createMotionOverlay, curveCommands, motionSvg } from './motion-overlay.mjs';

const font = fileURLToPath(new URL('assets/fonts/JetBrainsMono-Regular.ttf', import.meta.url));
const renderOptions = {
  font: {
    loadSystemFonts: false,
    fontFiles: [font],
    defaultFontFamily: 'JetBrains Mono',
    monospaceFamily: 'JetBrains Mono',
  },
};
const xml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const svg = (width, height, body) =>
  '<svg xmlns="http://www.w3.org/2000/svg" width="' +
  width +
  '" height="' +
  height +
  '">' +
  body +
  '</svg>';
const text = (x, y, value, color = '#a9bfd5', size = 11) =>
  '<text x="' +
  x +
  '" y="' +
  y +
  '" fill="' +
  color +
  '" font-family="JetBrains Mono" font-size="' +
  size +
  '">' +
  xml(value) +
  '</text>';
const background = (width, height) =>
  '<rect width="' + width + '" height="' + height + '" fill="#10151d"/>';
const render = (value) => new Resvg(value, renderOptions).render().asPng();

/** Even spacing, including both endpoints; a short capture never repeats frames. */
export function filmstripFrames(count, maximum = 12) {
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(maximum) || maximum < 2) {
    throw new RangeError('Invalid filmstrip frame count');
  }
  const length = Math.min(maximum, count);
  return Array.from({ length }, (_, i) =>
    length === 1 ? 0 : Math.round((i * (count - 1)) / (length - 1)),
  );
}

async function filmstrip(capture, output, picks, highlighted) {
  const columns = Math.min(3, picks.length),
    gap = 12,
    caption = 26,
    heading = 46;
  const tileWidth = Math.max(160, Math.min(420, capture.width));
  const tileHeight = Math.max(
    100,
    Math.min(320, Math.round((tileWidth * capture.height) / capture.width)),
  );
  const width = columns * (tileWidth + gap) + gap;
  const height = Math.ceil(picks.length / columns) * (tileHeight + caption + gap) + heading + gap;
  const parts = [
    background(width, height),
    text(
      gap,
      24,
      capture.scene + (highlighted ? ' / motion diagnostics' : ' / clean frames'),
      '#e1e7ef',
      15,
    ),
  ];
  const scale = Math.min(tileWidth / capture.width, tileHeight / capture.height);
  const imageWidth = capture.width * scale,
    imageHeight = capture.height * scale;
  for (const [position, index] of picks.entries()) {
    const frame = capture.frames[index],
      x = gap + (position % columns) * (tileWidth + gap),
      y = heading + Math.floor(position / columns) * (tileHeight + caption + gap);
    const file = highlighted ? frame.debugFile : frame.file;
    const png = await readFile(join(output, file));
    parts.push(
      '<rect x="' +
        x +
        '" y="' +
        y +
        '" width="' +
        tileWidth +
        '" height="' +
        tileHeight +
        '" fill="#080e15"/>',
    );
    parts.push(
      '<image x="' +
        (x + (tileWidth - imageWidth) / 2) +
        '" y="' +
        (y + (tileHeight - imageHeight) / 2) +
        '" width="' +
        imageWidth +
        '" height="' +
        imageHeight +
        '" href="data:image/png;base64,' +
        png.toString('base64') +
        '"/>',
    );
    parts.push(
      text(
        x,
        y + tileHeight + 18,
        'Frame ' + String(index).padStart(4, '0') + ' / ' + frame.timeMs.toFixed(1) + ' ms',
      ),
    );
  }
  return render(svg(width, height, parts.join('')));
}

async function curveSheet(tracks, overlay, output, file, title) {
  const columns = Math.min(3, tracks.length),
    gap = 12,
    panelWidth = 320,
    panelHeight = 194,
    heading = 50;
  const width = columns * (panelWidth + gap) + gap,
    height = Math.ceil(tracks.length / columns) * (panelHeight + gap) + heading + gap;
  const commands = [
    { kind: 'rect', x: 0, y: 0, width, height, fill: '#10151d', stroke: 'none' },
    { kind: 'text', x: gap, y: 24, value: title, color: '#e1e7ef', size: 15 },
    {
      kind: 'text',
      x: gap,
      y: 42,
      value: 'Gray: declared curve  /  colored dots: sampled values',
      color: '#a9bfd5',
      size: 10,
    },
  ];
  for (const [index, track] of tracks.entries()) {
    commands.push(
      ...curveCommands(
        track,
        {
          x: gap + (index % columns) * (panelWidth + gap),
          y: heading + Math.floor(index / columns) * (panelHeight + gap),
          width: panelWidth,
          height: panelHeight,
        },
        overlay.colors.get(track.targetId) ?? '#4cc9f0',
        Infinity,
        overlay.capture.motion.tolerance,
      ),
    );
  }
  await writeFile(join(output, file), render(motionSvg(width, height, commands)));
  return file;
}

/** Derived diagnostics are rasterized independently of the native scene and its pixel baseline. */
export async function writeArtifacts(capture, output) {
  const overlay = createMotionOverlay(capture);
  for (const [index, frame] of capture.frames.entries()) {
    const png = await readFile(join(output, frame.file));
    frame.debugFile = 'debug-' + frame.file;
    await writeFile(
      join(output, frame.debugFile),
      render(
        motionSvg(
          capture.width,
          capture.height,
          overlay.commands(index, { curves: false }),
          png.toString('base64'),
        ),
      ),
    );
  }
  const picks = filmstripFrames(capture.frames.length);
  const artifacts = {
    filmstrip: 'filmstrip.png',
    plainFilmstrip: 'filmstrip-plain.png',
    filmstripFrames: picks,
    elements: [],
  };
  await writeFile(join(output, artifacts.filmstrip), await filmstrip(capture, output, picks, true));
  await writeFile(
    join(output, artifacts.plainFilmstrip),
    await filmstrip(capture, output, picks, false),
  );
  const tracks = capture.motion?.tracks ?? [];
  if (tracks.length) {
    artifacts.curves = await curveSheet(
      tracks,
      overlay,
      output,
      'curves.png',
      capture.scene + ' / all motion tracks',
    );
    const elements = new Map();
    for (const track of tracks) {
      if (!elements.has(track.targetId)) {
        elements.set(track.targetId, []);
      }
      elements.get(track.targetId).push(track);
    }
    await mkdir(join(output, 'curves'), { recursive: true });
    for (const [targetId, elementTracks] of elements) {
      const file = 'curves/' + createHash('sha256').update(targetId).digest('hex') + '.png';
      await curveSheet(elementTracks, overlay, output, file, targetId + ' / motion tracks');
      artifacts.elements.push({ targetId, tracks: elementTracks.map((track) => track.id), file });
    }
  }
  return artifacts;
}
