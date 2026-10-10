//! Timing functions: how far along its values a transition or animation is
//! when a given share of its time has passed.

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Jump {
    Start,
    End,
    None,
    Both,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Timing {
    Linear,
    /// The control points x1, y1, x2, y2.
    Bezier([f64; 4]),
    Steps(u32, Jump),
}

impl Timing {
    /// CSS's initial value, `ease`.
    pub(crate) const EASE: Timing = Timing::Bezier([0.25, 0.1, 0.25, 1.0]);

    /// Progress at `t`, 0 to 1 of the time. A curve that overshoots passes 0 to 1.
    pub(crate) fn at(&self, t: f64) -> f64 {
        let x = t.clamp(0.0, 1.0);
        match *self {
            Timing::Linear => x,
            Timing::Bezier([x1, y1, x2, y2]) => bezier(x1, y1, x2, y2, x),
            Timing::Steps(count, jump) => {
                let n = f64::from(count);
                let mut step = (x * n).floor();
                if matches!(jump, Jump::Start | Jump::Both) {
                    step += 1.0;
                }
                let divisions = match jump {
                    Jump::None => n - 1.0,
                    Jump::Both => n + 1.0,
                    _ => n,
                };
                (step / divisions).clamp(0.0, 1.0)
            }
        }
    }

    /// A `<easing-function>`: a keyword, `cubic-bezier()` or `steps()`.
    pub(crate) fn parse(text: &str) -> Option<Timing> {
        let text = text.trim().to_ascii_lowercase();
        Some(match text.as_str() {
            "linear" => Timing::Linear,
            "ease" => Timing::EASE,
            "ease-in" => Timing::Bezier([0.42, 0.0, 1.0, 1.0]),
            "ease-out" => Timing::Bezier([0.0, 0.0, 0.58, 1.0]),
            "ease-in-out" => Timing::Bezier([0.42, 0.0, 0.58, 1.0]),
            "step-start" => Timing::Steps(1, Jump::Start),
            "step-end" => Timing::Steps(1, Jump::End),
            _ => {
                let (name, args) = text.strip_suffix(')')?.split_once('(')?;
                let args: Vec<&str> = args.split(',').map(str::trim).collect();
                match name.trim() {
                    "cubic-bezier" => {
                        let p: Vec<f64> = args.iter().filter_map(|a| a.parse().ok()).collect();
                        // x must stay in 0..1 for the curve to be a function of time.
                        if p.len() != 4 || args.len() != 4 || !(0.0..=1.0).contains(&p[0]) {
                            return None;
                        }
                        if !(0.0..=1.0).contains(&p[2]) || p.iter().any(|v| !v.is_finite()) {
                            return None;
                        }
                        Timing::Bezier([p[0], p[1], p[2], p[3]])
                    }
                    "steps" => {
                        let count: u32 = args.first()?.parse().ok()?;
                        let jump = match args.get(1).copied() {
                            None | Some("end") | Some("jump-end") => Jump::End,
                            Some("start") | Some("jump-start") => Jump::Start,
                            Some("jump-none") => Jump::None,
                            Some("jump-both") => Jump::Both,
                            Some(_) => return None,
                        };
                        let least = if jump == Jump::None { 2 } else { 1 };
                        if args.len() > 2 || count < least {
                            return None;
                        }
                        Timing::Steps(count, jump)
                    }
                    _ => return None,
                }
            }
        })
    }
}

/// y at x on the curve through (0,0), (x1,y1), (x2,y2), (1,1): Newton's
/// steps from x, then bisection where the slope is too flat to trust.
fn bezier(x1: f64, y1: f64, x2: f64, y2: f64, x: f64) -> f64 {
    let at = |a: f64, b: f64, s: f64| {
        let m = 1.0 - s;
        3.0 * m * m * s * a + 3.0 * m * s * s * b + s * s * s
    };
    let slope = |a: f64, b: f64, s: f64| {
        let m = 1.0 - s;
        3.0 * m * m * a + 6.0 * m * s * (b - a) + 3.0 * s * s * (1.0 - b)
    };
    let mut s = x;
    for _ in 0..8 {
        let error = at(x1, x2, s) - x;
        if error.abs() < 1e-7 {
            return at(y1, y2, s);
        }
        let d = slope(x1, x2, s);
        if d.abs() < 1e-6 {
            break;
        }
        s -= error / d;
    }
    let (mut lo, mut hi) = (0.0, 1.0);
    s = x;
    for _ in 0..40 {
        let v = at(x1, x2, s);
        if (v - x).abs() < 1e-7 {
            break;
        }
        if v < x {
            lo = s;
        } else {
            hi = s;
        }
        s = (lo + hi) / 2.0;
    }
    at(y1, y2, s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_curve_runs_from_zero_to_one() {
        for text in [
            "linear",
            "ease",
            "ease-in",
            "ease-out",
            "ease-in-out",
            "cubic-bezier(0.34, 1.56, 0.64, 1)",
            "steps(4)",
            "steps(3, jump-both)",
        ] {
            let timing = Timing::parse(text).unwrap_or_else(|| panic!("{text} parses"));
            assert!(timing.at(1.0) > 0.999, "{text} ends at {}", timing.at(1.0));
            assert!(timing.at(0.0) < 0.5, "{text} starts at {}", timing.at(0.0));
        }
    }

    #[test]
    fn step_start_has_already_jumped() {
        let start = Timing::parse("step-start").unwrap();
        assert_eq!((start.at(0.0), start.at(0.5)), (1.0, 1.0));
        let end = Timing::parse("step-end").unwrap();
        assert_eq!((end.at(0.5), end.at(1.0)), (0.0, 1.0));
    }

    #[test]
    fn a_bezier_matches_known_values() {
        // The CSS ease curve at the midpoint, from the specification's own reference.
        assert!((Timing::EASE.at(0.5) - 0.8024).abs() < 1e-3);
        assert!((Timing::parse("ease-in").unwrap().at(0.5) - 0.3153).abs() < 1e-3);
        assert!((Timing::Linear.at(0.25) - 0.25).abs() < 1e-12);
    }

    #[test]
    fn an_overshooting_curve_passes_one() {
        let spring = Timing::parse("cubic-bezier(0.34, 1.56, 0.64, 1)").unwrap();
        let peak = (1..100)
            .map(|i| spring.at(f64::from(i) / 100.0))
            .fold(0.0, f64::max);
        assert!(peak > 1.05, "peak {peak}");
        assert!((spring.at(1.0) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn steps_jump_where_the_term_says() {
        let end = Timing::parse("steps(4, jump-end)").unwrap();
        assert_eq!([end.at(0.0), end.at(0.3), end.at(0.99)], [0.0, 0.25, 0.75]);
        let start = Timing::parse("steps(4, jump-start)").unwrap();
        assert_eq!([start.at(0.0), start.at(0.3)], [0.25, 0.5]);
        let none = Timing::parse("steps(3, jump-none)").unwrap();
        assert_eq!([none.at(0.0), none.at(0.5), none.at(1.0)], [0.0, 0.5, 1.0]);
        let both = Timing::parse("steps(2, jump-both)").unwrap();
        assert!((both.at(0.0) - 1.0 / 3.0).abs() < 1e-12);
    }

    #[test]
    fn a_curve_it_cannot_read_is_refused() {
        for text in [
            "cubic-bezier(2, 0, 0, 1)",
            "cubic-bezier(0, 0, 1)",
            "steps(0)",
            "steps(1, jump-none)",
            "steps(2, sideways)",
            "bounce",
            "",
        ] {
            assert_eq!(Timing::parse(text), None, "{text}");
        }
    }
}
