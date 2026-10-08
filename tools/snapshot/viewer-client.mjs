/* global createMotionOverlay, drawMotionOverlay */
const capture = JSON.parse(document.getElementById('capture').textContent);
const overlay = createMotionOverlay(capture);
const slider = document.getElementById('frame');
const canvas = document.getElementById('canvas');
const context = canvas.getContext('2d');
const play = document.getElementById('play');
const details = document.getElementById('details');
const summary = document.getElementById('summary');
const parameters = new URLSearchParams(location.hash.slice(1));
const toggles = Object.fromEntries(
  ['bounds', 'trails', 'deltas', 'curves', 'diff'].map((name) => [
    name,
    document.getElementById(name),
  ]),
);
const initial = Number(parameters.get('frame') ?? 0);
slider.max = capture.frames.length - 1;
slider.value =
  Number.isSafeInteger(initial) && initial >= 0 && initial < capture.frames.length ? initial : 0;
for (const [name, input] of Object.entries(toggles)) {
  input.checked = parameters.has(name) ? parameters.get(name) === '1' : name !== 'diff';
  if (name === 'curves' && !capture.motion?.tracks.length) {
    input.checked = false;
    input.disabled = true;
  }
}
canvas.width = capture.width;
canvas.height = capture.height;
const links = document.getElementById('artifacts');
const addLink = (label, file) => {
  const link = document.createElement('a');
  link.textContent = label;
  link.href = file;
  links.append(link);
};
if (capture.artifacts) {
  addLink('Plain filmstrip', capture.artifacts.plainFilmstrip);
  addLink('Debug filmstrip', capture.artifacts.filmstrip);
  if (capture.artifacts.curves) {
    addLink('All curves', capture.artifacts.curves);
  }
  for (const element of capture.artifacts.elements) {
    addLink(element.targetId + ' curves', element.file);
  }
  addLink('Report', 'report.txt');
  addLink('Trace', 'trace.json');
}
let playing = false,
  version = 0,
  started = 0,
  firstFrame = 0,
  animation;

function show() {
  const index = Number(slider.value),
    frame = capture.frames[index],
    current = ++version;
  const options = Object.fromEntries(
    Object.entries(toggles).map(([name, input]) => [name, input.checked]),
  );
  const image = new Image();
  image.onload = () => {
    if (current !== version) {
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    drawMotionOverlay(context, overlay.commands(index, options));
  };
  const file = options.diff && frame.motionDiff ? frame.motionDiff.file : frame.file;
  image.onerror = () => {
    if (current === version) {
      details.textContent = 'Could not load ' + file;
    }
  };
  image.src = file;
  summary.textContent =
    capture.scene +
    ' / frame ' +
    index +
    ' of ' +
    (capture.frames.length - 1) +
    ' / ' +
    frame.timeMs.toFixed(1) +
    ' ms / ' +
    (capture.motion?.tracks.length ?? 0) +
    ' tracks / ' +
    (capture.motion?.issueCount ?? 0) +
    ' issues';
  details.textContent = JSON.stringify(
    {
      scene: capture.scene,
      frame: index,
      timeMs: frame.timeMs,
      ...frame.stats,
      ...frame.debug,
      geometryChanges: overlay.changes(index),
      motionDiff: frame.motionDiff,
      tracks: (capture.motion?.tracks ?? []).map((track) => ({
        id: track.id,
        sample: overlay.tracksByTarget
          .get(track.targetId)
          .find((item) => item.track.id === track.id)
          .samples.get(index),
        maxError: track.maxError,
        issues: track.issues,
        notes: track.notes,
      })),
      comparison: frame.comparison,
    },
    null,
    2,
  );
}

function tick(now) {
  if (!playing) {
    return;
  }
  const index =
    (firstFrame + Math.floor(((now - started) * capture.fps) / 1000)) % capture.frames.length;
  if (index !== Number(slider.value)) {
    slider.value = index;
    show();
  }
  animation = requestAnimationFrame(tick);
}
function pause() {
  playing = false;
  cancelAnimationFrame(animation);
  play.textContent = 'Play';
}
slider.oninput = () => {
  pause();
  show();
};
for (const input of Object.values(toggles)) {
  input.onchange = show;
}
play.onclick = () => {
  if (playing) {
    pause();
    return;
  }
  playing = true;
  play.textContent = 'Pause';
  firstFrame = Number(slider.value);
  started = performance.now();
  animation = requestAnimationFrame(tick);
};
show();
