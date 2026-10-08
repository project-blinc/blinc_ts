const palette = [
  '#ff4d6d',
  '#3ddc97',
  '#4cc9f0',
  '#ffb703',
  '#b388ff',
  '#ff8fab',
  '#80ed99',
  '#00bbf9',
];
const center = (bounds) => ({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });

/** Index by stable identity once; scrubbing never searches all frames for each layer. */
export function createMotionOverlay(capture) {
  const colors = new Map(),
    histories = new Map(),
    tracksByTarget = new Map();
  for (const track of capture.motion?.tracks ?? []) {
    if (!colors.has(track.targetId)) {
      colors.set(track.targetId, palette[colors.size % palette.length]);
    }
    if (!tracksByTarget.has(track.targetId)) {
      tracksByTarget.set(track.targetId, []);
    }
    tracksByTarget
      .get(track.targetId)
      .push({ track, samples: new Map(track.samples.map((sample) => [sample.frame, sample])) });
  }
  const frames = capture.frames.map((frame, index) => {
    const layers = new Map();
    for (const layer of frame.debug.layers ?? []) {
      const id = layer.id ?? layer.name;
      if (!id || layers.has(id)) {
        throw new Error('Debug layer ids must be nonempty and unique per frame');
      }
      const b = layer.bounds;
      if (![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width < 0 || b.height < 0) {
        throw new Error('Invalid debug bounds for ' + id);
      }
      const bounds = {
        x: b.x * capture.width,
        y: b.y * capture.height,
        width: b.width * capture.width,
        height: b.height * capture.height,
      };
      const sample = {
        id,
        name: layer.name,
        frame: index,
        timeMs: frame.timeMs,
        bounds,
        center: center(bounds),
      };
      layers.set(id, sample);
      if (!colors.has(id)) {
        colors.set(id, palette[colors.size % palette.length]);
      }
      if (!histories.has(id)) {
        histories.set(id, []);
      }
      histories.get(id).push(sample);
    }
    return layers;
  });
  return {
    colors,
    frames,
    histories,
    capture,
    tracksByTarget,
    changes(index) {
      if (index < 1) {
        return [];
      }
      const current = frames[index],
        previous = frames[index - 1],
        changes = [];
      for (const [id, sample] of current) {
        const before = previous.get(id);
        if (!before) {
          changes.push({ id, kind: 'added', current: sample.bounds });
          continue;
        }
        const dx = sample.bounds.x - before.bounds.x,
          dy = sample.bounds.y - before.bounds.y;
        const dw = sample.bounds.width - before.bounds.width,
          dh = sample.bounds.height - before.bounds.height;
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dw), Math.abs(dh)) < 0.001) {
          continue;
        }
        const dt = sample.timeMs - before.timeMs;
        changes.push({
          id,
          kind: 'changed',
          previous: before.bounds,
          current: sample.bounds,
          dx,
          dy,
          dw,
          dh,
          velocityX: dt > 0 ? ((sample.center.x - before.center.x) * 1000) / dt : null,
          velocityY: dt > 0 ? ((sample.center.y - before.center.y) * 1000) / dt : null,
        });
      }
      for (const [id, sample] of previous) {
        if (!current.has(id)) {
          changes.push({ id, kind: 'removed', previous: sample.bounds });
        }
      }
      return changes;
    },
    commands(index, options = {}) {
      return overlayCommands(this, index, options);
    },
  };
}

function overlayCommands(
  overlay,
  index,
  { bounds = true, trails = true, deltas = true, curves = true } = {},
) {
  const { capture, frames, colors, histories } = overlay;
  const commands = [];
  const box = (bounds, stroke, extra = {}) =>
    commands.push({ kind: 'rect', ...bounds, stroke, ...extra });
  const text = (x, y, value, color = '#e1e7ef', size = 11) =>
    commands.push({ kind: 'text', x, y, value, color, size });
  const path = (points, color, extra = {}) =>
    commands.push({ kind: 'path', points, color, ...extra });
  for (const [id, sample] of frames[index]) {
    const color = colors.get(id),
      b = sample.bounds;
    if (trails) {
      const history = histories.get(id);
      let count = 0;
      while (count < history.length && history[count].frame <= index) {
        count++;
      }
      const points = history.slice(0, count).map((sample) => sample.center);
      let distance = 0;
      for (let i = 1; i < points.length; i++) {
        distance += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      }
      if (distance >= 1) {
        path(points, color, { alpha: 0.65, lineWidth: 1.5 });
        commands.push({ kind: 'dots', points, color, radius: 2.5 });
      }
    }
    if (bounds) {
      box(b, color, { lineWidth: 1.5 });
    }
    const tracks = overlay.tracksByTarget.get(id) ?? [];
    if (bounds && tracks.length) {
      const { track, samples } = tracks[0],
        sampleValue = samples.get(index);
      if (sampleValue) {
        const label =
          track.property +
          ' ' +
          Math.round(sampleValue.progress * 100) +
          '%' +
          (track.issues.length ? ' !' : '');
        text(
          Math.max(4, Math.min(b.x, capture.width - label.length * 7)),
          Math.max(14, b.y - 8),
          label,
          color,
        );
        const width = Math.max(40, Math.min(120, b.width)),
          y = b.y + b.height + 5;
        box({ x: b.x, y, width, height: 3 }, 'none', { fill: '#10151d' });
        box(
          { x: b.x, y, width: width * Math.max(0, Math.min(1, sampleValue.progress)), height: 3 },
          'none',
          { fill: color },
        );
        path(
          [
            { x: b.x + width * Math.max(0, Math.min(1, sampleValue.expected)), y: y - 2 },
            { x: b.x + width * Math.max(0, Math.min(1, sampleValue.expected)), y: y + 5 },
          ],
          '#ffffff',
        );
      }
    }
  }
  if (deltas) {
    for (const change of overlay.changes(index)) {
      const color = colors.get(change.id);
      if (change.previous) {
        box(change.previous, '#ffce58', { dash: [4, 3], alpha: 0.85 });
      }
      if (change.current) {
        box(change.current, color, { lineWidth: 1.5 });
      }
      if (change.kind === 'changed') {
        const from = center(change.previous),
          to = center(change.current);
        path([from, to], '#ffce58', { lineWidth: 2 });
        const b = change.current;
        const label =
          'Δx ' +
          signed(change.dx) +
          '  Δy ' +
          signed(change.dy) +
          (Math.abs(change.dw) >= 0.05 || Math.abs(change.dh) >= 0.05
            ? '  Δw ' + signed(change.dw) + '  Δh ' + signed(change.dh)
            : '');
        text(
          Math.max(4, Math.min(b.x, capture.width - label.length * 6.5)),
          Math.min(capture.height - 6, b.y + b.height + 22),
          label,
          '#ffce58',
        );
      } else {
        const b = change.current ?? change.previous;
        text(Math.max(4, b.x), Math.max(14, b.y - 8), change.id + ' ' + change.kind, '#ffce58');
      }
    }
  }
  if (curves) {
    const tracks = (capture.motion?.tracks ?? []).slice(
      0,
      Math.max(1, Math.min(3, Math.floor(capture.width / 204))),
    );
    for (const [indexTrack, track] of tracks.entries()) {
      const width = Math.min(196, capture.width - 16),
        height = Math.min(128, capture.height - 16);
      const x = capture.width - (width + 8) * (indexTrack + 1),
        y = capture.height - height - 8;
      const color = colors.get(track.targetId) ?? palette[indexTrack % palette.length];
      commands.push(
        ...curveCommands(track, { x, y, width, height }, color, index, capture.motion.tolerance),
      );
    }
  }
  return commands;
}

/** Shared by the interactive overlay and complete, per-element curve sheets. */
export function curveCommands(track, bounds, color, frameLimit = Infinity, tolerance = 0.02) {
  const { x, y, width, height } = bounds;
  const commands = [];
  const text = (x, y, value, color = '#a9bfd5', size = 10) =>
    commands.push({ kind: 'text', x, y, value, color, size });
  const path = (points, color, extra = {}) =>
    commands.push({ kind: 'path', points, color, ...extra });
  commands.push({ kind: 'rect', ...bounds, stroke: color, fill: '#10151d', alpha: 0.96 });
  const title = track.label + ' / ' + track.property + (track.issues.length ? ' !' : '');
  const limit = Math.max(8, Math.floor((width - 16) / 6.6));
  text(x + 8, y + 16, title.length > limit ? title.slice(0, limit - 1) + '…' : title, color, 11);
  const due = track.startMs + (track.delayMs ?? 0),
    end = due + track.durationMs;
  const first = Math.min(due, track.samples[0]?.timeMs ?? due);
  const last = Math.max(end, track.samples.at(-1)?.timeMs ?? end);
  let minimum = -0.15,
    maximum = 1.15;
  for (const sample of track.samples) {
    minimum = Math.min(minimum, sample.progress - 0.1);
    maximum = Math.max(maximum, sample.progress + 0.1);
  }
  const plot = { x: x + 24, y: y + 28, width: width - 34, height: height - 78 };
  const point = (sample) => ({
    x: plot.x + ((sample.timeMs - first) / (last - first)) * plot.width,
    y: plot.y + ((maximum - sample.progress) / (maximum - minimum)) * plot.height,
  });
  for (const value of [0, 1]) {
    const py = point({ timeMs: due, progress: value }).y;
    path(
      [
        { x: plot.x, y: py },
        { x: plot.x + plot.width, y: py },
      ],
      '#465367',
    );
    text(x + 5, py + 3, String(value), '#a9bfd5', 9);
  }
  path(track.curve.map(point), '#aab0c0', { lineWidth: 1.5 });
  const samples = track.samples.filter((sample) => sample.frame <= frameLimit);
  path(samples.map(point), color, { lineWidth: 1, alpha: 0.65 });
  commands.push({ kind: 'dots', points: samples.map(point), color, radius: 2.5 });
  const failures = samples.filter((sample) => sample.error > tolerance);
  if (failures.length) {
    commands.push({ kind: 'dots', points: failures.map(point), color: '#ffce58', radius: 3 });
  }
  text(plot.x, y + height - 37, first.toFixed(0) + 'ms');
  text(x + width - 54, y + height - 37, last.toFixed(0) + 'ms');
  text(x + 8, y + height - 21, track.durationMs + 'ms ' + track.easing);
  text(
    x + 8,
    y + height - 7,
    'curve Δ ' + (track.maxError * 100).toFixed(3) + '%',
    track.issues.length ? '#ffce58' : color,
  );
  return commands;
}

function signed(value) {
  return (value >= 0 ? '+' : '') + value.toFixed(1) + 'px';
}

/** Batch dots into one fill and trails into one stroke per target. */
export function drawMotionOverlay(context, commands) {
  context.save();
  try {
    for (const command of commands) {
      context.globalAlpha = command.alpha ?? 1;
      context.lineWidth = command.lineWidth ?? 1;
      context.setLineDash(command.dash ?? []);
      if (command.kind === 'rect') {
        if (command.fill) {
          context.fillStyle = command.fill;
          context.fillRect(command.x, command.y, command.width, command.height);
        }
        if (command.stroke !== 'none') {
          context.strokeStyle = command.stroke;
          context.strokeRect(command.x, command.y, command.width, command.height);
        }
      } else if (command.kind === 'path') {
        if (!command.points.length) {
          continue;
        }
        context.beginPath();
        context.moveTo(command.points[0].x, command.points[0].y);
        for (const point of command.points.slice(1)) {
          context.lineTo(point.x, point.y);
        }
        context.strokeStyle = command.color;
        context.stroke();
      } else if (command.kind === 'dots') {
        context.beginPath();
        for (const point of command.points) {
          context.moveTo(point.x + command.radius, point.y);
          context.arc(point.x, point.y, command.radius, 0, Math.PI * 2);
        }
        context.fillStyle = command.color;
        context.fill();
      } else if (command.kind === 'text') {
        context.font = command.size + 'px ui-monospace, monospace';
        context.fillStyle = command.color;
        context.fillText(command.value, command.x, command.y);
      }
    }
  } finally {
    context.restore();
  }
}

const xml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
export function motionSvg(width, height, commands, pngBase64) {
  const elements = pngBase64
    ? [
        '<image width="' +
          width +
          '" height="' +
          height +
          '" href="data:image/png;base64,' +
          pngBase64 +
          '"/>',
      ]
    : [];
  for (const command of commands) {
    const alpha = ' opacity="' + (command.alpha ?? 1) + '"';
    if (command.kind === 'rect') {
      elements.push(
        '<rect x="' +
          command.x +
          '" y="' +
          command.y +
          '" width="' +
          command.width +
          '" height="' +
          command.height +
          '" fill="' +
          (command.fill ?? 'none') +
          '" stroke="' +
          command.stroke +
          '" stroke-width="' +
          (command.lineWidth ?? 1) +
          '"' +
          (command.dash ? ' stroke-dasharray="' + command.dash.join(' ') + '"' : '') +
          alpha +
          '/>',
      );
    } else if (command.kind === 'path') {
      elements.push(
        '<polyline points="' +
          command.points.map((point) => point.x + ',' + point.y).join(' ') +
          '" fill="none" stroke="' +
          command.color +
          '" stroke-width="' +
          (command.lineWidth ?? 1) +
          '"' +
          alpha +
          '/>',
      );
    } else if (command.kind === 'dots') {
      elements.push(
        '<g fill="' +
          command.color +
          '"' +
          alpha +
          '>' +
          command.points
            .map(
              (point) =>
                '<circle cx="' + point.x + '" cy="' + point.y + '" r="' + command.radius + '"/>',
            )
            .join('') +
          '</g>',
      );
    } else if (command.kind === 'text') {
      elements.push(
        '<text x="' +
          command.x +
          '" y="' +
          command.y +
          '" fill="' +
          command.color +
          '" font-family="monospace" font-size="' +
          command.size +
          '"' +
          alpha +
          '>' +
          xml(command.value) +
          '</text>',
      );
    }
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    width +
    '" height="' +
    height +
    '" viewBox="0 0 ' +
    width +
    ' ' +
    height +
    '">' +
    elements.join('') +
    '</svg>\n'
  );
}
