//! Layout animation by FLIP: when layout moves or resizes an element, layout
//! settles at once and the element is drawn where it was, then eases to
//! where it is now. Nothing is laid out again for it: it is drawn away from
//! its layout, by what is left of the move, and while its size changes at
//! the size between, its children clipped to it.
//!
//! A change is measured against the nearest animated element it is in, so a
//! child carried by its parent's move does not move twice; visual offsets
//! nest. A change while one is running starts from where it is drawn then.

use super::timing::Timing;

/// What a node's layout animation moves, and how.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct LayoutAnimation {
    pub(crate) position: bool,
    pub(crate) size: bool,
    /// Milliseconds; a spring takes its own.
    pub(crate) duration: f64,
    pub(crate) timing: Timing,
}

/// A move in flight: where it is drawn from, relative to its layout, and at what size.
struct Move {
    /// Offset x, y and size w, h when it started; a size of -1 is the layout's.
    from: [f32; 4],
    /// The layout's size it eases to.
    to: [f32; 2],
    duration: f64,
    start: Option<f64>,
}

pub(crate) struct Flip {
    animation: LayoutAnimation,
    /// Its box at the last layout, relative to the nearest animated element it is in.
    last: Option<[f32; 4]>,
    /// That element, when there is one.
    within: Option<u64>,
    /// Where it is drawn now, relative to its layout, and at what size; -1 for the layout's.
    shown: [f32; 4],
    running: Option<Move>,
}

const AT_LAYOUT: [f32; 4] = [0.0, 0.0, -1.0, -1.0];

impl Flip {
    pub(crate) fn new(animation: LayoutAnimation) -> Flip {
        Flip {
            animation,
            last: None,
            within: None,
            shown: AT_LAYOUT,
            running: None,
        }
    }

    pub(crate) fn set(&mut self, animation: LayoutAnimation) {
        self.animation = animation;
    }

    pub(crate) fn running(&self) -> bool {
        self.running.is_some()
    }

    /// Its box after a layout, relative to `within`, the nearest animated element
    /// it is in: a move starts when the box changed. Measured against another
    /// element than before, the box is not comparable, and is where it starts.
    pub(crate) fn laid_out(&mut self, now: [f32; 4], within: Option<u64>) {
        let before = std::mem::replace(&mut self.within, within);
        let Some(last) = self.last.replace(now) else {
            return;
        };
        if before != within {
            return;
        }
        if last == now {
            return;
        }
        let a = &self.animation;
        // Where it is drawn now, relative to its new layout.
        let drawn_size = if self.shown[2] >= 0.0 {
            [self.shown[2], self.shown[3]]
        } else {
            [last[2], last[3]]
        };
        let (dx, dy) = if a.position {
            (
                last[0] + self.shown[0] - now[0],
                last[1] + self.shown[1] - now[1],
            )
        } else {
            (0.0, 0.0)
        };
        let sized = a.size && drawn_size != [now[2], now[3]];
        if dx == 0.0 && dy == 0.0 && !sized {
            return;
        }
        let duration = match &a.timing {
            Timing::Spring(spring) => spring.seconds * 1000.0,
            _ => a.duration,
        };
        if duration <= 0.0 {
            return;
        }
        let (w, h) = if sized {
            (drawn_size[0], drawn_size[1])
        } else {
            (-1.0, -1.0)
        };
        self.running = Some(Move {
            from: [dx, dy, w, h],
            to: [now[2], now[3]],
            duration,
            start: None,
        });
    }

    /// The visual for the frame at `now`: an offset and size, or none once it is at its layout.
    pub(crate) fn step(&mut self, now: f64) -> Option<Option<[f32; 4]>> {
        let run = self.running.as_mut()?;
        let start = *run.start.get_or_insert(now);
        let x = ((now - start) / run.duration).max(0.0);
        if x >= 1.0 {
            self.running = None;
            self.shown = AT_LAYOUT;
            return Some(None);
        }
        let p = self.animation.timing.at(x) as f32;
        let rest = 1.0 - p;
        let visual = [
            run.from[0] * rest,
            run.from[1] * rest,
            if run.from[2] >= 0.0 {
                (run.from[2] + (run.to[0] - run.from[2]) * p).max(0.0)
            } else {
                -1.0
            },
            if run.from[2] >= 0.0 {
                (run.from[3] + (run.to[1] - run.from[3]) * p).max(0.0)
            } else {
                -1.0
            },
        ];
        self.shown = visual;
        Some(Some(visual))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    impl Flip {
        fn laid_out_test(&mut self, now: [f32; 4]) {
            self.laid_out(now, None);
        }
    }

    #[test]
    fn a_box_measured_against_a_new_ancestor_does_not_move() {
        let mut f = linear(true, false);
        f.laid_out([20.0, 280.0, 100.0, 20.0], None);
        // Its parent became animated: the same box, measured from the parent.
        f.laid_out([0.0, 60.0, 100.0, 20.0], Some(7));
        assert!(!f.running());
        f.laid_out([0.0, 80.0, 100.0, 20.0], Some(7));
        assert!(f.running(), "and moves are measured from there on");
    }

    fn linear(position: bool, size: bool) -> Flip {
        Flip::new(LayoutAnimation {
            position,
            size,
            duration: 100.0,
            timing: Timing::Linear,
        })
    }

    #[test]
    fn a_move_is_drawn_from_where_it_was() {
        let mut f = linear(true, true);
        f.laid_out_test([10.0, 10.0, 50.0, 20.0]);
        assert!(!f.running(), "the first layout is where it starts");
        f.laid_out_test([110.0, 10.0, 50.0, 20.0]);
        assert_eq!(f.step(0.0), Some(Some([-100.0, 0.0, -1.0, -1.0])));
        assert_eq!(f.step(50.0), Some(Some([-50.0, 0.0, -1.0, -1.0])));
        assert_eq!(f.step(100.0), Some(None), "at its layout, drawn plainly");
        assert_eq!(f.step(120.0), None);
    }

    #[test]
    fn a_resize_eases_its_drawn_size() {
        let mut f = linear(true, true);
        f.laid_out_test([0.0, 0.0, 100.0, 20.0]);
        f.laid_out_test([0.0, 0.0, 100.0, 80.0]);
        assert_eq!(f.step(0.0), Some(Some([0.0, 0.0, 100.0, 20.0])));
        assert_eq!(f.step(50.0), Some(Some([0.0, 0.0, 100.0, 50.0])));
        let mut only_place = linear(true, false);
        only_place.laid_out_test([0.0, 0.0, 100.0, 20.0]);
        only_place.laid_out_test([0.0, 0.0, 100.0, 80.0]);
        assert!(
            !only_place.running(),
            "a size it does not animate changes at once"
        );
    }

    #[test]
    fn a_change_mid_move_starts_from_where_it_is_drawn() {
        let mut f = linear(true, false);
        f.laid_out_test([0.0, 0.0, 10.0, 10.0]);
        f.laid_out_test([100.0, 0.0, 10.0, 10.0]);
        f.step(0.0);
        f.step(50.0); // drawn at x 50
        f.laid_out_test([0.0, 0.0, 10.0, 10.0]);
        assert_eq!(f.step(60.0), Some(Some([50.0, 0.0, -1.0, -1.0])));
    }
}
