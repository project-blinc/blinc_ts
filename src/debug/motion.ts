export type MotionEasing = 'linear' | 'cubic-in' | 'cubic-out' | 'cubic-in-out';

export interface MotionDefinition {
  id: string;
  targetId: string;
  label: string;
  property: string;
  kind: 'transition' | 'layout';
  from: number;
  to: number;
  startMs: number;
  delayMs?: number;
  durationMs: number;
  easing: MotionEasing;
}
export interface MotionSample {
  frame: number;
  timeMs: number;
  value: number;
  progress: number;
  expected: number;
  error: number;
}
export interface MotionIssue {
  code: 'off-curve' | 'unexpected-jump' | 'wrong-end' | 'missing-samples';
  frame: number;
  message: string;
}
export interface MotionTrackReport extends MotionDefinition {
  samples: MotionSample[];
  curve: { timeMs: number; progress: number }[];
  maxError: number;
  errorFrame: number | null;
  overshoot: number;
  frameTimeMs: number | null;
  issues: MotionIssue[];
  notes: string[];
}
export interface MotionReport {
  schema: 1;
  tolerance: number;
  issueCount: number;
  tracks: MotionTrackReport[];
}

export function easingProgress(easing: MotionEasing, time: number): number {
  const t = Math.max(0, Math.min(1, time));
  switch (easing) {
    case 'linear':
      return t;
    case 'cubic-in':
      return t ** 3;
    case 'cubic-out':
      return 1 - (1 - t) ** 3;
    case 'cubic-in-out':
      return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
  }
}

/** Optional diagnostics; animation engines supply their actual values and simulation clock. */
export class MotionTrace {
  readonly #tracks = new Map<string, { definition: MotionDefinition; samples: MotionSample[] }>();
  readonly tolerance: number;

  constructor(definitions: readonly MotionDefinition[], tolerance = 0.02) {
    if (!Number.isFinite(tolerance) || tolerance < 0) {
      throw new RangeError('Invalid motion tolerance');
    }
    this.tolerance = tolerance;
    for (const definition of definitions) {
      if (!definition.id || !definition.targetId || this.#tracks.has(definition.id)) {
        throw new Error('Motion track ids must be nonempty and unique');
      }
      if (
        ![
          definition.from,
          definition.to,
          definition.startMs,
          definition.delayMs ?? 0,
          definition.durationMs,
        ].every(Number.isFinite) ||
        definition.durationMs <= 0 ||
        (definition.delayMs ?? 0) < 0 ||
        !['linear', 'cubic-in', 'cubic-out', 'cubic-in-out'].includes(definition.easing)
      ) {
        throw new RangeError('Invalid motion declaration: ' + definition.id);
      }
      this.#tracks.set(definition.id, { definition: { ...definition }, samples: [] });
    }
  }

  sample(id: string, frame: number, timeMs: number, value: number): void {
    const track = this.#tracks.get(id);
    if (!track) {
      throw new Error('Unknown motion track: ' + id);
    }
    const previous = track.samples.at(-1);
    if (
      !Number.isSafeInteger(frame) ||
      frame < 0 ||
      !Number.isFinite(timeMs) ||
      !Number.isFinite(value) ||
      (previous && (timeMs <= previous.timeMs || frame <= previous.frame))
    ) {
      throw new RangeError(
        'Motion samples must have finite values and increasing frames and times',
      );
    }
    const definition = track.definition;
    const distance = definition.to - definition.from;
    const progress = distance === 0 ? 0 : (value - definition.from) / distance;
    const expected =
      distance === 0
        ? 0
        : easingProgress(
            definition.easing,
            (timeMs - definition.startMs - (definition.delayMs ?? 0)) / definition.durationMs,
          );
    const error =
      distance === 0 ? Math.abs(value - definition.from) : Math.abs(progress - expected);
    track.samples.push({ frame, timeMs, value, progress, expected, error });
  }

  snapshot(): MotionReport {
    const tracks: MotionTrackReport[] = [];
    for (const { definition, samples } of this.#tracks.values()) {
      const issues: MotionIssue[] = [],
        notes: string[] = [];
      let maxError = 0,
        errorFrame: number | null = null,
        unexpectedJump = 0,
        jumpFrame = 0,
        overshoot = 0;
      const gaps: number[] = [];
      const moving = definition.from !== definition.to;
      for (const [index, sample] of samples.entries()) {
        if (sample.error > maxError) {
          maxError = sample.error;
          errorFrame = sample.frame;
        }
        overshoot = Math.max(overshoot, -sample.progress, sample.progress - 1);
        const previous = samples[index - 1];
        if (previous) {
          gaps.push(sample.timeMs - previous.timeMs);
          const jump = Math.abs(
            sample.progress - previous.progress - (sample.expected - previous.expected),
          );
          if (jump > unexpectedJump) {
            unexpectedJump = jump;
            jumpFrame = sample.frame;
          }
        }
      }
      if (maxError > this.tolerance) {
        issues.push({
          code: 'off-curve',
          frame: errorFrame ?? 0,
          message: moving
            ? 'Off declared curve by ' + (maxError * 100).toFixed(2) + '%'
            : 'A constant property changed by ' + maxError.toFixed(4),
        });
      }
      if (moving && unexpectedJump > 0.25) {
        issues.push({
          code: 'unexpected-jump',
          frame: jumpFrame,
          message: 'Unexpected jump of ' + (unexpectedJump * 100).toFixed(2) + '% of the move',
        });
      }
      const due = definition.startMs + (definition.delayMs ?? 0),
        end = due + definition.durationMs;
      const first = samples[0],
        last = samples.at(-1);
      if (!first || !last) {
        issues.push({
          code: 'missing-samples',
          frame: 0,
          message: 'No samples captured for the declared track',
        });
      } else {
        if (first.timeMs > due) {
          notes.push('Capture begins after the motion starts');
        }
        if (last.timeMs < end) {
          notes.push('Capture ends before the motion finishes');
        }
        if (moving && last.timeMs >= end && Math.abs(last.progress - 1) > this.tolerance) {
          issues.push({
            code: 'wrong-end',
            frame: last.frame,
            message: 'Ended at ' + (last.progress * 100).toFixed(2) + '% of the move',
          });
        }
        if (!samples.some((sample) => sample.timeMs > due && sample.timeMs < end)) {
          notes.push('No interior samples; capture more frames to inspect the curve');
        }
      }
      if (overshoot > 0.001) {
        notes.push('Overshoot: ' + (overshoot * 100).toFixed(2) + '%');
      }
      gaps.sort((a, b) => a - b);
      tracks.push({
        ...definition,
        samples: samples.map((sample) => ({ ...sample })),
        curve: Array.from({ length: 65 }, (_, index) => {
          const fraction = index / 64;
          return {
            timeMs: due + fraction * definition.durationMs,
            progress: moving ? easingProgress(definition.easing, fraction) : 0,
          };
        }),
        maxError,
        errorFrame,
        overshoot,
        frameTimeMs: gaps[Math.floor(gaps.length / 2)] ?? null,
        issues,
        notes,
      });
    }
    return {
      schema: 1,
      tolerance: this.tolerance,
      issueCount: tracks.reduce((count, track) => count + track.issues.length, 0),
      tracks,
    };
  }
}

export function motionReport(report: MotionReport): string {
  const lines = [
    'Motion trace: ' + report.tracks.length + ' tracks, ' + report.issueCount + ' issues',
    '',
  ];
  for (const track of report.tracks) {
    lines.push(
      track.id + ' — ' + track.label + ' / ' + track.property,
      '  Declared: ' +
        track.from +
        ' → ' +
        track.to +
        ', ' +
        track.durationMs +
        'ms ' +
        track.easing +
        ((track.delayMs ?? 0) > 0 ? ', delay ' + track.delayMs + 'ms' : ''),
      '  Sampled: ' +
        track.samples.length +
        ' frames, max error ' +
        (track.maxError * 100).toFixed(4) +
        '%',
      ...track.issues.map((issue) => '  WARN frame ' + issue.frame + ': ' + issue.message),
      ...track.notes.map((note) => '  Note: ' + note),
      track.issues.length ? '' : '  OK',
      '',
    );
  }
  return lines.join('\n');
}
