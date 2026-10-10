//! A node's `transition` and `animation` declarations, read from its
//! resolved style: the shorthands, then the longhands over them.

use super::field::{Field, fields_of};
use super::timing::Timing;

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Property {
    All,
    Named(String),
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Transition {
    pub(crate) property: Property,
    /// Milliseconds.
    pub(crate) duration: f64,
    pub(crate) delay: f64,
    pub(crate) timing: Timing,
}

impl Transition {
    pub(crate) fn covers(&self, field: Field) -> bool {
        match &self.property {
            Property::All => field.blends(),
            Property::Named(name) => fields_of(name).contains(&field),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Direction {
    Normal,
    Reverse,
    Alternate,
    AlternateReverse,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Fill {
    None,
    Forwards,
    Backwards,
    Both,
}

impl Fill {
    pub(crate) fn before(self) -> bool {
        matches!(self, Fill::Backwards | Fill::Both)
    }
    pub(crate) fn after(self) -> bool {
        matches!(self, Fill::Forwards | Fill::Both)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Animation {
    pub(crate) name: String,
    pub(crate) duration: f64,
    pub(crate) delay: f64,
    pub(crate) timing: Timing,
    /// Infinite as `f64::INFINITY`.
    pub(crate) iterations: f64,
    pub(crate) direction: Direction,
    pub(crate) fill: Fill,
    pub(crate) paused: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Spec {
    pub(crate) transitions: Vec<Transition>,
    pub(crate) animations: Vec<Animation>,
}

impl Spec {
    pub(crate) fn is_empty(&self) -> bool {
        self.transitions.is_empty() && self.animations.is_empty()
    }

    /// The transition that governs `field`: the last listed that names it.
    pub(crate) fn transition_for(&self, field: Field) -> Option<&Transition> {
        self.transitions.iter().rev().find(|t| t.covers(field))
    }

    /// What `resolved` declares, and what in it motion cannot do.
    pub(crate) fn read<'a>(
        resolved: impl IntoIterator<Item = (&'a str, &'a str)>,
    ) -> (Spec, Vec<String>) {
        let mut found = Found::default();
        let mut problems = Vec::new();
        for (name, value) in resolved {
            if name.starts_with("transition") || name.starts_with("animation") {
                found.take(name, value.trim());
            }
        }
        let spec = Spec {
            transitions: found.transitions(&mut problems),
            animations: found.animations(&mut problems),
        };
        for t in &spec.transitions {
            if let Property::Named(name) = &t.property {
                if fields_of(name).is_empty() {
                    problems.push(format!(
                        "transition of \"{name}\" has no effect: only paint properties animate"
                    ));
                }
            }
        }
        (spec, problems)
    }
}

/// The text of each property, as declared.
#[derive(Default)]
struct Found<'a> {
    transition: Option<&'a str>,
    transition_property: Option<&'a str>,
    transition_duration: Option<&'a str>,
    transition_timing: Option<&'a str>,
    transition_delay: Option<&'a str>,
    animation: Option<&'a str>,
    animation_name: Option<&'a str>,
    animation_duration: Option<&'a str>,
    animation_timing: Option<&'a str>,
    animation_delay: Option<&'a str>,
    animation_iterations: Option<&'a str>,
    animation_direction: Option<&'a str>,
    animation_fill: Option<&'a str>,
    animation_play_state: Option<&'a str>,
}

impl<'a> Found<'a> {
    fn take(&mut self, name: &str, value: &'a str) {
        let slot = match name {
            "transition" => &mut self.transition,
            "transition-property" => &mut self.transition_property,
            "transition-duration" => &mut self.transition_duration,
            "transition-timing-function" => &mut self.transition_timing,
            "transition-delay" => &mut self.transition_delay,
            "animation" => &mut self.animation,
            "animation-name" => &mut self.animation_name,
            "animation-duration" => &mut self.animation_duration,
            "animation-timing-function" => &mut self.animation_timing,
            "animation-delay" => &mut self.animation_delay,
            "animation-iteration-count" => &mut self.animation_iterations,
            "animation-direction" => &mut self.animation_direction,
            "animation-fill-mode" => &mut self.animation_fill,
            "animation-play-state" => &mut self.animation_play_state,
            _ => return,
        };
        *slot = Some(value);
    }

    fn transitions(&self, problems: &mut Vec<String>) -> Vec<Transition> {
        let mut list: Vec<Transition> = Vec::new();
        if let Some(text) = self.transition {
            for item in split(text, ',') {
                match transition_item(item) {
                    Ok(Some(t)) => list.push(t),
                    Ok(None) => {}
                    Err(e) => problems.push(format!("transition: {e}")),
                }
            }
        }
        let longhands = [
            self.transition_property,
            self.transition_duration,
            self.transition_timing,
            self.transition_delay,
        ];
        if longhands.iter().all(Option::is_none) {
            return list;
        }
        let properties: Option<Vec<Option<Property>>> = self.transition_property.map(|text| {
            split(text, ',')
                .into_iter()
                .map(|p| match p.to_ascii_lowercase().as_str() {
                    "none" => None,
                    "all" => Some(Property::All),
                    other => Some(Property::Named(other.to_string())),
                })
                .collect()
        });
        let count = properties.as_ref().map_or(list.len().max(1), Vec::len);
        let times = |text: Option<&str>, what: &str, problems: &mut Vec<String>| -> Vec<f64> {
            text.map(|t| {
                split(t, ',')
                    .into_iter()
                    .filter_map(|x| {
                        let v = time(x);
                        if v.is_none() {
                            problems.push(format!("transition-{what}: \"{x}\" is not a time"));
                        }
                        v
                    })
                    .collect()
            })
            .unwrap_or_default()
        };
        let durations = times(self.transition_duration, "duration", problems);
        let delays = times(self.transition_delay, "delay", problems);
        let timings: Vec<Timing> = self
            .transition_timing
            .map(|t| {
                split(t, ',')
                    .into_iter()
                    .filter_map(|x| {
                        let v = Timing::parse(x);
                        if v.is_none() {
                            problems.push(format!(
                                "transition-timing-function: \"{x}\" is not a timing function"
                            ));
                        }
                        v
                    })
                    .collect()
            })
            .unwrap_or_default();
        let cycle = |v: &[f64], i: usize, otherwise: f64| {
            if v.is_empty() {
                otherwise
            } else {
                v[i % v.len()]
            }
        };
        (0..count)
            .filter_map(|i| {
                let base = (!list.is_empty()).then(|| list[i % list.len()].clone());
                let property = match &properties {
                    Some(p) => p[i].clone()?,
                    None => base.as_ref().map_or(Property::All, |b| b.property.clone()),
                };
                Some(Transition {
                    property,
                    duration: if durations.is_empty() {
                        base.as_ref().map_or(0.0, |b| b.duration)
                    } else {
                        cycle(&durations, i, 0.0)
                    },
                    delay: if delays.is_empty() {
                        base.as_ref().map_or(0.0, |b| b.delay)
                    } else {
                        cycle(&delays, i, 0.0)
                    },
                    timing: if timings.is_empty() {
                        base.as_ref().map_or(Timing::EASE, |b| b.timing)
                    } else {
                        timings[i % timings.len()]
                    },
                })
            })
            .collect()
    }

    fn animations(&self, problems: &mut Vec<String>) -> Vec<Animation> {
        let mut list: Vec<Animation> = Vec::new();
        if let Some(text) = self.animation {
            for item in split(text, ',') {
                match animation_item(item) {
                    Ok(Some(a)) => list.push(a),
                    Ok(None) => {}
                    Err(e) => problems.push(format!("animation: {e}")),
                }
            }
        }
        let longhands = [
            self.animation_name,
            self.animation_duration,
            self.animation_timing,
            self.animation_delay,
            self.animation_iterations,
            self.animation_direction,
            self.animation_fill,
            self.animation_play_state,
        ];
        if longhands.iter().all(Option::is_none) {
            return list;
        }
        let names: Option<Vec<Option<String>>> = self.animation_name.map(|text| {
            split(text, ',')
                .into_iter()
                .map(|n| (!n.eq_ignore_ascii_case("none")).then(|| n.to_string()))
                .collect()
        });
        let count = names.as_ref().map_or(list.len(), Vec::len);
        let pick = |text: Option<&'a str>| -> Vec<&'a str> {
            text.map(|t| split(t, ',')).unwrap_or_default()
        };
        let (durations, delays, timings) = (
            pick(self.animation_duration),
            pick(self.animation_delay),
            pick(self.animation_timing),
        );
        let (iterations, directions, fills, states) = (
            pick(self.animation_iterations),
            pick(self.animation_direction),
            pick(self.animation_fill),
            pick(self.animation_play_state),
        );
        let at = |v: &[&'a str], i: usize| (!v.is_empty()).then(|| v[i % v.len()]);
        (0..count)
            .filter_map(|i| {
                let mut a = match &names {
                    Some(n) => Animation::new(n[i].clone()?),
                    None => list[i % list.len()].clone(),
                };
                if let Some(t) = at(&durations, i) {
                    match time(t) {
                        Some(v) => a.duration = v.max(0.0),
                        None => problems.push(format!("animation-duration: \"{t}\" is not a time")),
                    }
                }
                if let Some(t) = at(&delays, i) {
                    match time(t) {
                        Some(v) => a.delay = v,
                        None => problems.push(format!("animation-delay: \"{t}\" is not a time")),
                    }
                }
                if let Some(t) = at(&timings, i) {
                    match Timing::parse(t) {
                        Some(v) => a.timing = v,
                        None => problems.push(format!(
                            "animation-timing-function: \"{t}\" is not a timing function"
                        )),
                    }
                }
                if let Some(t) = at(&iterations, i) {
                    match iteration_count(t) {
                        Some(v) => a.iterations = v,
                        None => problems
                            .push(format!("animation-iteration-count: \"{t}\" is not a count")),
                    }
                }
                if let Some(t) = at(&directions, i) {
                    match direction(t) {
                        Some(v) => a.direction = v,
                        None => problems
                            .push(format!("animation-direction: \"{t}\" is not a direction")),
                    }
                }
                if let Some(t) = at(&fills, i) {
                    match fill(t) {
                        Some(v) => a.fill = v,
                        None => {
                            problems.push(format!("animation-fill-mode: \"{t}\" is not a mode"))
                        }
                    }
                }
                if let Some(t) = at(&states, i) {
                    match t.to_ascii_lowercase().as_str() {
                        "paused" => a.paused = true,
                        "running" => a.paused = false,
                        _ => problems.push(format!("animation-play-state: \"{t}\" is not a state")),
                    }
                }
                Some(a)
            })
            .collect()
    }
}

impl Animation {
    fn new(name: String) -> Animation {
        Animation {
            name,
            duration: 0.0,
            delay: 0.0,
            timing: Timing::EASE,
            iterations: 1.0,
            direction: Direction::Normal,
            fill: Fill::None,
            paused: false,
        }
    }
}

/// `text` cut at each `sep` outside parentheses, trimmed, empty parts dropped.
fn split(text: &str, sep: char) -> Vec<&str> {
    let (mut depth, mut from) = (0i32, 0);
    let mut out = Vec::new();
    for (i, c) in text.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            c if c == sep && depth == 0 => {
                out.push(text[from..i].trim());
                from = i + c.len_utf8();
            }
            _ => {}
        }
    }
    out.push(text[from..].trim());
    out.retain(|s| !s.is_empty());
    out
}

/// The words of one item, a function's arguments kept with its name.
fn words(item: &str) -> Vec<&str> {
    let (mut depth, mut from) = (0i32, None::<usize>);
    let mut out = Vec::new();
    for (i, c) in item.char_indices() {
        match c {
            '(' => {
                depth += 1;
                from.get_or_insert(i);
            }
            ')' => depth -= 1,
            c if c.is_whitespace() && depth == 0 => {
                if let Some(f) = from.take() {
                    out.push(&item[f..i]);
                }
            }
            _ => {
                from.get_or_insert(i);
            }
        }
    }
    if let Some(f) = from {
        out.push(&item[f..]);
    }
    out
}

/// `150ms` or `0.15s`, in milliseconds.
fn time(text: &str) -> Option<f64> {
    let text = text.trim().to_ascii_lowercase();
    let (number, scale) = match text.strip_suffix("ms") {
        Some(n) => (n, 1.0),
        None => (text.strip_suffix('s')?, 1000.0),
    };
    let v: f64 = number.parse().ok()?;
    v.is_finite().then_some(v * scale)
}

fn iteration_count(text: &str) -> Option<f64> {
    if text.eq_ignore_ascii_case("infinite") {
        return Some(f64::INFINITY);
    }
    let v: f64 = text.parse().ok()?;
    (v.is_finite() && v >= 0.0).then_some(v)
}

fn direction(text: &str) -> Option<Direction> {
    Some(match text.to_ascii_lowercase().as_str() {
        "normal" => Direction::Normal,
        "reverse" => Direction::Reverse,
        "alternate" => Direction::Alternate,
        "alternate-reverse" => Direction::AlternateReverse,
        _ => return None,
    })
}

fn fill(text: &str) -> Option<Fill> {
    Some(match text.to_ascii_lowercase().as_str() {
        "none" => Fill::None,
        "forwards" => Fill::Forwards,
        "backwards" => Fill::Backwards,
        "both" => Fill::Both,
        _ => return None,
    })
}

/// One comma-separated part of `transition`; none for `none`.
fn transition_item(item: &str) -> Result<Option<Transition>, String> {
    let mut t = Transition {
        property: Property::All,
        duration: 0.0,
        delay: 0.0,
        timing: Timing::EASE,
    };
    let (mut times, mut named) = (0, false);
    for word in words(item) {
        if let Some(ms) = time(word) {
            match times {
                0 => t.duration = ms.max(0.0),
                1 => t.delay = ms,
                _ => return Err(format!("\"{item}\" has three times")),
            }
            times += 1;
        } else if let Some(timing) = Timing::parse(word) {
            t.timing = timing;
        } else if !named && word.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            named = true;
            match word.to_ascii_lowercase().as_str() {
                "none" => return Ok(None),
                "all" => {}
                other => t.property = Property::Named(other.to_string()),
            }
        } else {
            return Err(format!("cannot read \"{word}\" in \"{item}\""));
        }
    }
    Ok(Some(t))
}

/// One comma-separated part of `animation`; none for `none`.
fn animation_item(item: &str) -> Result<Option<Animation>, String> {
    let mut a = Animation::new(String::new());
    let (mut times, mut named) = (0, false);
    for word in words(item) {
        if let Some(ms) = time(word) {
            match times {
                0 => a.duration = ms.max(0.0),
                1 => a.delay = ms,
                _ => return Err(format!("\"{item}\" has three times")),
            }
            times += 1;
        } else if let Some(timing) = Timing::parse(word) {
            a.timing = timing;
        } else if let Some(n) = iteration_count(word) {
            a.iterations = n;
        } else if let Some(d) = direction(word) {
            a.direction = d;
        } else if let Some(f) = fill(word).filter(|_| !word.eq_ignore_ascii_case("none")) {
            a.fill = f;
        } else if word.eq_ignore_ascii_case("paused") {
            a.paused = true;
        } else if word.eq_ignore_ascii_case("running") {
            a.paused = false;
        } else if !named
            && word
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            named = true;
            if word.eq_ignore_ascii_case("none") {
                return Ok(None);
            }
            a.name = word.to_string();
        } else {
            return Err(format!("cannot read \"{word}\" in \"{item}\""));
        }
    }
    if a.name.is_empty() {
        return Err(format!("\"{item}\" names no @keyframes"));
    }
    Ok(Some(a))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(declared: &[(&str, &str)]) -> (Spec, Vec<String>) {
        Spec::read(declared.iter().copied())
    }

    #[test]
    fn a_transition_shorthand_lists_its_properties() {
        let (spec, problems) = read(&[(
            "transition",
            "background 150ms cubic-bezier(0, 0, 0.2, 1), opacity 0.2s linear 50ms",
        )]);
        assert!(problems.is_empty(), "{problems:?}");
        assert_eq!(spec.transitions.len(), 2);
        let first = &spec.transitions[0];
        assert_eq!(first.property, Property::Named("background".into()));
        assert_eq!((first.duration, first.delay), (150.0, 0.0));
        assert_eq!(first.timing, Timing::Bezier([0.0, 0.0, 0.2, 1.0]));
        let second = &spec.transitions[1];
        assert_eq!((second.duration, second.delay), (200.0, 50.0));
        assert_eq!(second.timing, Timing::Linear);
    }

    #[test]
    fn the_last_transition_naming_a_field_governs_it() {
        let (spec, _) = read(&[("transition", "all 100ms, opacity 400ms")]);
        assert_eq!(spec.transition_for(Field::Opacity).unwrap().duration, 400.0);
        assert_eq!(
            spec.transition_for(Field::Background).unwrap().duration,
            100.0
        );
        assert!(spec.transition_for(Field::CornerShape).is_none());
    }

    #[test]
    fn longhands_cycle_over_the_property_list() {
        let (spec, problems) = read(&[
            ("transition-property", "opacity, transform, color"),
            ("transition-duration", "100ms, 300ms"),
            ("transition-timing-function", "linear"),
        ]);
        assert!(problems.is_empty(), "{problems:?}");
        let durations: Vec<f64> = spec.transitions.iter().map(|t| t.duration).collect();
        assert_eq!(durations, [100.0, 300.0, 100.0]);
        assert!(spec.transitions.iter().all(|t| t.timing == Timing::Linear));
    }

    #[test]
    fn none_ends_the_list_and_a_layout_property_is_reported() {
        let (spec, _) = read(&[("transition", "none")]);
        assert!(spec.is_empty());
        let (spec, problems) = read(&[("transition", "width 200ms, opacity 200ms")]);
        assert_eq!(spec.transitions.len(), 2);
        assert_eq!(problems.len(), 1);
        assert!(problems[0].contains("width"), "{problems:?}");
    }

    #[test]
    fn an_animation_shorthand_reads_its_parts_in_any_order() {
        let (spec, problems) = read(&[(
            "animation",
            "forwards pop-in 150ms cubic-bezier(0.2, 0, 0, 1) 20ms 2 alternate",
        )]);
        assert!(problems.is_empty(), "{problems:?}");
        let a = &spec.animations[0];
        assert_eq!(a.name, "pop-in");
        assert_eq!((a.duration, a.delay, a.iterations), (150.0, 20.0, 2.0));
        assert_eq!(
            (a.direction, a.fill),
            (Direction::Alternate, Fill::Forwards)
        );
    }

    #[test]
    fn infinite_and_play_state_are_read() {
        let (spec, _) = read(&[(
            "animation",
            "pulse 1s ease-in-out infinite alternate paused",
        )]);
        let a = &spec.animations[0];
        assert!(a.iterations.is_infinite() && a.paused);
    }

    #[test]
    fn animation_longhands_override_the_shorthand() {
        let (spec, problems) = read(&[
            ("animation", "spin 1s linear infinite"),
            ("animation-duration", "2s"),
            ("animation-fill-mode", "both"),
        ]);
        assert!(problems.is_empty(), "{problems:?}");
        let a = &spec.animations[0];
        assert_eq!(
            (a.name.as_str(), a.duration, a.fill),
            ("spin", 2000.0, Fill::Both)
        );
        assert!(a.iterations.is_infinite());
    }

    #[test]
    fn an_animation_without_a_name_is_reported() {
        let (spec, problems) = read(&[("animation", "1s ease")]);
        assert!(spec.animations.is_empty());
        assert_eq!(problems.len(), 1);
        let (spec, problems) = read(&[("animation", "none")]);
        assert!(spec.is_empty() && problems.is_empty());
    }

    #[test]
    fn a_value_that_is_not_a_time_is_reported() {
        let (_, problems) = read(&[
            ("transition-property", "opacity"),
            ("transition-duration", "soon"),
        ]);
        assert!(problems.iter().any(|p| p.contains("soon")), "{problems:?}");
    }
}
