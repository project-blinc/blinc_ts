/**
 * Where a floating box goes against an anchor, as a popover, tooltip, menu or
 * select list is placed: below or beside it, flipped to the other side where
 * there is no room, never past the viewport's edges. The geometry is pure,
 * in layout units; `TopLayer` reads the sizes and applies it.
 */

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface Size {
  readonly width: number;
  readonly height: number;
}
/** A box, or something that has one now: a host element, whose bounds are read when it is placed. */
export type Anchor = Box | { bounds(): readonly number[] };

export type Side = 'top' | 'bottom' | 'left' | 'right';
export type Alignment = 'start' | 'center' | 'end';

export type Placement =
  /** In the middle of the viewport, as layout centres it. */
  | { readonly kind: 'center' }
  /** Under the anchor, at least as wide, or above it where there is no room below. A select's list. */
  | { readonly kind: 'below'; readonly anchor: Anchor; readonly gap: number }
  /** On `side` of the anchor, `gap` from it, aligned along it; the opposite side where there is no room. */
  | {
      readonly kind: 'beside';
      readonly anchor: Anchor;
      readonly side: Side;
      readonly align: Alignment;
      readonly gap: number;
      /** Along the anchor, from the alignment. */
      readonly offset: number;
    }
  /** Pinned to an edge of the viewport and stretched along it. A sheet. */
  | { readonly kind: 'edge'; readonly side: Side }
  /** Its top-left at a point, flipped left and up where it would run past an edge. A context menu. */
  | { readonly kind: 'at'; readonly x: number; readonly y: number };

export const placement = {
  center: (): Placement => ({ kind: 'center' }),
  below: (anchor: Anchor, options: { gap?: number } = {}): Placement => ({
    kind: 'below',
    anchor,
    gap: options.gap ?? 0,
  }),
  beside: (
    anchor: Anchor,
    side: Side,
    options: { align?: Alignment; gap?: number; offset?: number } = {},
  ): Placement => ({
    kind: 'beside',
    anchor,
    side,
    align: options.align ?? 'center',
    gap: options.gap ?? 0,
    offset: options.offset ?? 0,
  }),
  edge: (side: Side): Placement => ({ kind: 'edge', side }),
  at: (x: number, y: number): Placement => ({ kind: 'at', x, y }),
};

/** Where a floating box ended up. */
export interface Placed {
  readonly left: number;
  readonly top: number;
  /** The side of the anchor it is on, when it has one. */
  readonly side: Side | null;
  /** Where the anchor's middle is along the box, from its top or left edge: where an arrow points. */
  readonly arrow: number | null;
}

export function boxOf(anchor: Anchor): Box {
  if ('bounds' in anchor) {
    // An element is read where it shows, not where it is laid out.
    const [x = 0, y = 0, width = 0, height = 0] =
      'viewBounds' in anchor
        ? (anchor as { viewBounds(): number[] }).viewBounds()
        : anchor.bounds();
    return { x, y, width, height };
  }
  return anchor;
}

const opposite: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/**
 * The room on `side` of `anchor` for a box of `content`: negative where it
 * does not fit.
 */
function room(side: Side, anchor: Box, content: Size, gap: number, viewport: Size): number {
  switch (side) {
    case 'top':
      return anchor.y - gap - content.height;
    case 'bottom':
      return viewport.height - (anchor.y + anchor.height + gap + content.height);
    case 'left':
      return anchor.x - gap - content.width;
    case 'right':
      return viewport.width - (anchor.x + anchor.width + gap + content.width);
  }
}

/** The preferred side where the box fits there; else the opposite, where it fits or has more room. */
export function chooseSide(
  preferred: Side,
  anchor: Box,
  content: Size,
  gap: number,
  viewport: Size,
): Side {
  const here = room(preferred, anchor, content, gap, viewport);
  if (here >= 0) {
    return preferred;
  }
  const there = room(opposite[preferred], anchor, content, gap, viewport);
  return there > here ? opposite[preferred] : preferred;
}

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(value, Math.max(low, high)));

/**
 * Where `content` goes for `p` in `viewport`; none for a placement layout
 * does itself, `center` and `edge`.
 */
export function place(p: Placement, content: Size, viewport: Size): Placed | null {
  switch (p.kind) {
    case 'center':
    case 'edge':
      return null;
    case 'at': {
      const left = p.x + content.width <= viewport.width ? p.x : Math.max(0, p.x - content.width);
      const top = p.y + content.height <= viewport.height ? p.y : Math.max(0, p.y - content.height);
      return { left, top, side: null, arrow: null };
    }
    case 'below': {
      const anchor = boxOf(p.anchor);
      const side = chooseSide('bottom', anchor, content, p.gap, viewport);
      const top =
        side === 'bottom' ? anchor.y + anchor.height + p.gap : anchor.y - p.gap - content.height;
      const left = clamp(anchor.x, 0, viewport.width - content.width);
      return {
        left,
        top: clamp(top, 0, viewport.height - content.height),
        side,
        arrow: anchor.x + anchor.width / 2 - left,
      };
    }
    case 'beside': {
      const anchor = boxOf(p.anchor);
      const side = chooseSide(p.side, anchor, content, p.gap, viewport);
      const vertical = side === 'top' || side === 'bottom';
      // Along the anchor: its start, middle or end against the box's.
      const along = (start: number, extent: number, size: number) =>
        p.align === 'start'
          ? start
          : p.align === 'end'
            ? start + extent - size
            : start + (extent - size) / 2;
      let left: number;
      let top: number;
      if (vertical) {
        left = along(anchor.x, anchor.width, content.width) + p.offset;
        top = side === 'top' ? anchor.y - p.gap - content.height : anchor.y + anchor.height + p.gap;
      } else {
        top = along(anchor.y, anchor.height, content.height) + p.offset;
        left = side === 'left' ? anchor.x - p.gap - content.width : anchor.x + anchor.width + p.gap;
      }
      left = clamp(left, 0, viewport.width - content.width);
      top = clamp(top, 0, viewport.height - content.height);
      return {
        left,
        top,
        side,
        arrow: vertical ? anchor.x + anchor.width / 2 - left : anchor.y + anchor.height / 2 - top,
      };
    }
  }
}
