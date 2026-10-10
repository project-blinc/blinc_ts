//! Timing functions: how far along its values a transition or animation is
//! when a given share of its time has passed.

use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Jump {
    Start,
    End,
    None,
    Both,
}

/// A damped spring from rest at 0 to 1, as `spring(mass stiffness damping velocity)`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Spring {
    pub(crate) mass: f64,
    pub(crate) stiffness: f64,
    pub(crate) damping: f64,
    /// Progress a second at the start.
    pub(crate) velocity: f64,
    /// Seconds it takes to settle from that velocity.
    pub(crate) seconds: f64,
}

/// What a spring counts as settled: within this share of the move, and moving less than it a second.
const SETTLED: f64 = 1e-3;

impl Spring {
    /// Progress `t` seconds in, starting at `velocity` progress a second.
    pub(crate) fn at(&self, t: f64, velocity: f64) -> f64 {
        let w = (self.stiffness / self.mass).sqrt();
        let zeta = self.damping / (2.0 * (self.stiffness * self.mass).sqrt());
        // How far from the end it is: 1 at the start, falling with velocity `velocity`.
        let rest = if (zeta - 1.0).abs() < 1e-6 {
            (1.0 + (w - velocity) * t) * (-w * t).exp()
        } else if zeta < 1.0 {
            let wd = w * (1.0 - zeta * zeta).sqrt();
            let b = (zeta * w - velocity) / wd;
            (-zeta * w * t).exp() * ((wd * t).cos() + b * (wd * t).sin())
        } else {
            let root = (zeta * zeta - 1.0).sqrt();
            let (r1, r2) = (-w * (zeta - root), -w * (zeta + root));
            let c1 = (-velocity - r2) / (r1 - r2);
            c1 * (r1 * t).exp() + (1.0 - c1) * (r2 * t).exp()
        };
        1.0 - rest
    }

    /// Progress a second, `t` seconds in.
    pub(crate) fn rate(&self, t: f64, velocity: f64) -> f64 {
        let h = 1e-4;
        (self.at(t + h, velocity) - self.at((t - h).max(0.0), velocity))
            / (t + h - (t - h).max(0.0))
    }

    /// Seconds until it stays within `SETTLED` of the end, at most ten.
    pub(crate) fn settles(&self, velocity: f64) -> f64 {
        let w = (self.stiffness / self.mass).sqrt();
        let zeta = self.damping / (2.0 * (self.stiffness * self.mass).sqrt());
        // Past this, the slowest decaying part of the motion is below `SETTLED`, however it starts.
        let decay = if zeta < 1.0 {
            zeta * w
        } else {
            w * (zeta - (zeta * zeta - 1.0).max(0.0).sqrt())
        };
        let reach = 10.0 * (1.0 + velocity.abs()) * (1.0 + w);
        let bound = ((reach / SETTLED).ln() / decay).min(10.0);
        let step = 1e-3;
        let mut last = 0.0;
        let mut t = 0.0;
        while t <= bound {
            if (1.0 - self.at(t, velocity)).abs() > SETTLED
                || self.rate(t, velocity).abs() > SETTLED
            {
                last = t;
            }
            t += step;
        }
        last + step
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Timing {
    Linear,
    /// The control points x1, y1, x2, y2.
    Bezier([f64; 4]),
    Steps(u32, Jump),
    /// `linear()`'s points, input then output, inputs not decreasing.
    Points(Arc<[(f64, f64)]>),
    Spring(Spring),
}

impl Timing {
    /// CSS's initial value, `ease`.
    pub(crate) const EASE: Timing = Timing::Bezier([0.25, 0.1, 0.25, 1.0]);

    /// Progress at `t`, 0 to 1 of the time. A curve that overshoots passes 0 to 1.
    /// A spring is fitted to the time it is given, from its own velocity.
    pub(crate) fn at(&self, t: f64) -> f64 {
        let x = t.clamp(0.0, 1.0);
        match *self {
            Timing::Points(ref points) => linear_points(points, x),
            Timing::Spring(spring) => {
                if x >= 1.0 {
                    1.0
                } else {
                    spring.at(x * spring.seconds, spring.velocity)
                }
            }
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
                if name.trim() == "spring" {
                    return spring_arguments(args).map(Timing::Spring);
                }
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
                    "linear" => Timing::Points(linear_arguments(&args)?.into()),
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

/// `spring(mass stiffness damping [velocity])`, WebKit's form; each but the velocity positive.
fn spring_arguments(args: &str) -> Option<Spring> {
    let v: Vec<f64> = args
        .split_whitespace()
        .map(|a| a.parse::<f64>().ok().filter(|v| v.is_finite()))
        .collect::<Option<_>>()?;
    if !(3..=4).contains(&v.len()) || v[..3].iter().any(|&x| x <= 0.0) {
        return None;
    }
    let mut spring = Spring {
        mass: v[0],
        stiffness: v[1],
        damping: v[2],
        velocity: v.get(3).copied().unwrap_or(0.0),
        seconds: 0.0,
    };
    spring.seconds = spring.settles(spring.velocity);
    Some(spring)
}

/// `linear()`'s points: each an output and up to two input percentages; a
/// missing input is spread evenly between its neighbours, and none goes back.
fn linear_arguments(args: &[&str]) -> Option<Vec<(f64, f64)>> {
    let mut points: Vec<(Option<f64>, f64)> = Vec::new();
    for arg in args {
        let mut words = arg.split_whitespace();
        let output: f64 = words.next()?.parse().ok().filter(|v: &f64| v.is_finite())?;
        let inputs: Vec<f64> = words
            .map(|w| w.strip_suffix('%')?.parse::<f64>().ok().map(|p| p / 100.0))
            .collect::<Option<_>>()?;
        match inputs.as_slice() {
            [] => points.push((None, output)),
            [a] => points.push((Some(*a), output)),
            [a, b] => points.extend([(Some(*a), output), (Some(*b), output)]),
            _ => return None,
        }
    }
    if points.len() < 2 {
        return None;
    }
    let last = points.len() - 1;
    points[0].0.get_or_insert(0.0);
    points[last].0.get_or_insert(1.0);
    // No input goes back from the largest before it.
    let mut most = f64::NEG_INFINITY;
    for p in points.iter_mut() {
        if let Some(x) = p.0.as_mut() {
            *x = x.max(most);
            most = *x;
        }
    }
    let mut i = 0;
    while i < points.len() {
        if points[i].0.is_none() {
            let start = i - 1;
            let end = (i..points.len()).find(|&j| points[j].0.is_some())?;
            let (a, b) = (points[start].0?, points[end].0?);
            for (k, j) in (start + 1..end).enumerate() {
                points[j].0 = Some(a + (b - a) * (k + 1) as f64 / (end - start) as f64);
            }
            i = end;
        }
        i += 1;
    }
    points.into_iter().map(|(x, y)| Some((x?, y))).collect()
}

/// The output at `x` along `linear()`'s points; beyond the ends, the end's output.
fn linear_points(points: &[(f64, f64)], x: f64) -> f64 {
    let last = points.len() - 1;
    if x <= points[0].0 {
        return points[0].1;
    }
    // The last point at or before x, so a repeated input steps.
    let i = points.iter().rposition(|p| p.0 <= x).unwrap_or(0);
    if i >= last {
        return points[last].1;
    }
    let ((x0, y0), (x1, y1)) = (points[i], points[i + 1]);
    if x1 <= x0 {
        y1
    } else {
        y0 + (y1 - y0) * (x - x0) / (x1 - x0)
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
    fn linear_spreads_missing_inputs_and_steps_at_a_repeat() {
        let t = Timing::parse("linear(0, 0.25, 1)").unwrap();
        assert_eq!((t.at(0.25), t.at(0.5), t.at(0.75)), (0.125, 0.25, 0.625));
        let held = Timing::parse("linear(0, 0.5 25% 75%, 1)").unwrap();
        assert_eq!(
            (held.at(0.3), held.at(0.7), held.at(0.875)),
            (0.5, 0.5, 0.75)
        );
        let back = Timing::parse("linear(0, 1 60%, 0 40%, 1)").unwrap();
        assert_eq!(
            back.at(0.6),
            0.0,
            "an input that goes back is moved up to the last"
        );
    }

    #[test]
    fn a_spring_overshoots_settles_and_keeps_a_starting_velocity() {
        let bouncy = Spring {
            mass: 1.0,
            stiffness: 170.0,
            damping: 10.0,
            velocity: 0.0,
            seconds: 0.0,
        };
        assert_eq!(bouncy.at(0.0, 0.0), 0.0);
        let peak = (1..1000)
            .map(|ms| bouncy.at(f64::from(ms) / 1000.0, 0.0))
            .fold(0.0, f64::max);
        assert!(peak > 1.2, "under-damped, it overshoots: {peak}");
        let t = bouncy.settles(0.0);
        assert!(t > 0.3 && t < 3.0, "settles in {t}s");
        assert!((bouncy.at(t, 0.0) - 1.0).abs() <= SETTLED);
        // Started moving back, it goes back first.
        assert!(bouncy.at(0.01, -20.0) < 0.0);
        assert!(
            (bouncy.rate(0.0, -20.0) + 20.0).abs() < 0.05,
            "{}",
            bouncy.rate(0.0, -20.0)
        );
        for damping in [2.0 * 170f64.sqrt(), 60.0] {
            let calm = Spring { damping, ..bouncy };
            let most = (1..3000)
                .map(|ms| calm.at(f64::from(ms) / 1000.0, 0.0))
                .fold(0.0, f64::max);
            assert!(
                most <= 1.0 + 1e-9,
                "critically or over-damped, it does not overshoot: {most}"
            );
            assert!((calm.at(calm.settles(0.0), 0.0) - 1.0).abs() <= SETTLED);
        }
    }

    #[test]
    fn the_settling_scan_stops_where_a_full_one_would() {
        for (k, c, v) in [
            (170.0, 10.0, 0.0),
            (170.0, 26.0, -15.0),
            (300.0, 60.0, 4.0),
            (40.0, 3.0, 0.0),
        ] {
            let spring = Spring {
                mass: 1.0,
                stiffness: k,
                damping: c,
                velocity: v,
                seconds: 0.0,
            };
            let mut last = 0.0;
            for ms in 0..10_000 {
                let t = f64::from(ms) / 1000.0;
                if (1.0 - spring.at(t, v)).abs() > SETTLED || spring.rate(t, v).abs() > SETTLED {
                    last = t;
                }
            }
            let full = (last + 1e-3).min(10.0);
            assert!(
                (spring.settles(v) - full).abs() < 2e-3,
                "{k} {c} {v}: {} against {full}",
                spring.settles(v)
            );
        }
    }

    #[test]
    fn a_spring_is_read_and_fitted_to_the_time_it_has() {
        let t = Timing::parse("spring(1 170 26)").unwrap();
        assert!(matches!(t, Timing::Spring(s) if s.velocity == 0.0 && s.seconds > 0.1));
        assert_eq!((t.at(0.0), t.at(1.0)), (0.0, 1.0));
        assert!(t.at(0.5) > 0.9, "most of the way by half its settling time");
        assert_eq!(Timing::parse("spring(1 -1 10)"), None);
        assert_eq!(Timing::parse("spring(1 100)"), None);
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
            "linear(1)",
            "linear(0, 1 50% 60% 70%)",
            "",
        ] {
            assert_eq!(Timing::parse(text), None, "{text}");
        }
    }
}
