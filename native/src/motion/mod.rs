//! CSS transitions and animations on a node's paint.
//!
//! A restyle hands each node's new paint writes to `Motion::restyle`, which
//! applies them at once, or, for a field the node transitions, starts a run
//! from the value last shown. `@keyframes` named by `animation` become
//! tracks of stops. `Motion::tick` samples every run and animation at the
//! host's time and returns the writes to apply. Start times are taken at the
//! first tick, so a restyle needs no clock.

mod blend;
mod field;
mod keyframes;
mod spec;
mod timing;

use blend::{blend, same, vector};
use blinc_abi::css::Atom;
use blinc_abi::css::cascade::Cascade;
use blinc_abi::css::paint::PaintWrite;
use blinc_abi::css::quantity::PaintUnits;
use field::Field;
pub(crate) use spec::Spec;
use spec::{Animation, Direction};
use std::collections::{BTreeMap, HashMap, HashSet};
use timing::Timing;

/// What a restyle reads keyframes, their variables and units from.
pub(crate) struct Context<'a> {
    pub(crate) cascade: &'a Cascade,
    pub(crate) units: PaintUnits<'a>,
    /// The node's computed values, which a keyframe's `var()`s read.
    pub(crate) values: &'a [(Atom, String)],
}

/// A transition of one field.
struct Run {
    field: Field,
    from: PaintWrite,
    to: PaintWrite,
    duration: f64,
    delay: f64,
    timing: Timing,
    start: Option<f64>,
    /// A spring's progress a second at its start.
    velocity: f64,
    /// Progress a second at the last frame.
    rate: f64,
}

/// The progress a second a run going from `from` to `to` starts at, keeping
/// `previous`'s velocity along the new direction; none when the field has no
/// straight line to measure along.
fn carried(previous: &Run, from: &PaintWrite, to: &PaintWrite) -> Option<f64> {
    let (a, b) = (vector(&previous.from)?, vector(&previous.to)?);
    let (f, t) = (vector(from)?, vector(to)?);
    if a.len() != b.len() || f.len() != t.len() || a.len() != f.len() {
        return None;
    }
    let mut along = 0.0f64;
    let mut length = 0.0f64;
    for i in 0..a.len() {
        let moving = f64::from(b[i] - a[i]) * previous.rate;
        let direction = f64::from(t[i] - f[i]);
        along += moving * direction;
        length += direction * direction;
    }
    (length > 0.0).then(|| along / length)
}

/// One field's values through a `@keyframes` block, by offset.
struct Track {
    field: Field,
    stops: Vec<(f64, PaintWrite, Option<Timing>)>,
}

#[derive(Clone, Copy, PartialEq)]
enum Phase {
    /// Before its delay is over.
    Waiting,
    Active,
    /// Over, holding its last values because it fills forwards.
    Done,
}

enum Stand {
    Before,
    /// Progress through a cycle once direction is applied.
    At(f64),
    After(f64),
}

struct Anim {
    spec: Animation,
    tracks: Vec<Track>,
    /// Whether its keyframes read variables, so are read again when those change.
    variables: bool,
    start: Option<f64>,
    paused_at: Option<f64>,
    phase: Phase,
}

fn directed(direction: Direction, index: f64, local: f64) -> f64 {
    let odd = index % 2.0 == 1.0;
    let reversed = match direction {
        Direction::Normal => false,
        Direction::Reverse => true,
        Direction::Alternate => odd,
        Direction::AlternateReverse => !odd,
    };
    if reversed { 1.0 - local } else { local }
}

impl Anim {
    /// Whether the animation decides `field` now.
    fn holds(&self, field: Field) -> bool {
        let live = match self.phase {
            Phase::Active | Phase::Done => true,
            Phase::Waiting => self.spec.fill.before(),
        };
        live && self.tracks.iter().any(|t| t.field == field)
    }

    fn stand(&mut self, now: f64) -> Stand {
        let mut start = *self.start.get_or_insert(now);
        // Time stands still while paused, and the start moves on by that much when it resumes.
        let clock = if self.spec.paused {
            *self.paused_at.get_or_insert(now)
        } else {
            if let Some(since) = self.paused_at.take() {
                start += now - since;
                self.start = Some(start);
            }
            now
        };
        let elapsed = clock - start - self.spec.delay;
        if elapsed < 0.0 {
            return Stand::Before;
        }
        let (duration, count) = (self.spec.duration, self.spec.iterations);
        if duration <= 0.0 || (count.is_finite() && elapsed >= duration * count) {
            let (index, local) = if count.fract() == 0.0 {
                ((count - 1.0).max(0.0), 1.0)
            } else {
                (count.floor(), count.fract())
            };
            return Stand::After(directed(self.spec.direction, index, local));
        }
        let t = elapsed / duration;
        let index = t.floor();
        Stand::At(directed(self.spec.direction, index, t - index))
    }
}

impl Track {
    fn sample(&self, p: f64, timing: &Timing) -> PaintWrite {
        let last = self.stops.len() - 1;
        let i = self.stops.iter().rposition(|s| s.0 <= p).unwrap_or(0);
        if i >= last {
            return self.stops[last].1.clone();
        }
        let (from, to) = (&self.stops[i], &self.stops[i + 1]);
        let span = to.0 - from.0;
        let x = if span > 0.0 { (p - from.0) / span } else { 1.0 };
        blend(&from.1, &to.1, from.2.as_ref().unwrap_or(timing).at(x))
    }
}

/// The tracks of a block's stops. A field a block leaves out at 0 or 1 starts or ends at
/// what the cascade gives it.
fn tracks(stops: &[keyframes::Stop], base: &HashMap<Field, PaintWrite>) -> Vec<Track> {
    let mut fields: Vec<Field> = Vec::new();
    for write in stops.iter().flat_map(|s| &s.writes) {
        let field = Field::of(write);
        if !fields.contains(&field) {
            fields.push(field);
        }
    }
    fields
        .into_iter()
        .map(|field| {
            let mut points: Vec<(f64, PaintWrite, Option<Timing>)> = Vec::new();
            for stop in stops {
                for write in stop.writes.iter().filter(|w| Field::of(w) == field) {
                    // A later declaration at one offset replaces the earlier.
                    match points.iter_mut().find(|p| p.0 == stop.offset) {
                        Some(p) => (p.1, p.2) = (write.clone(), stop.timing.clone()),
                        None => points.push((stop.offset, write.clone(), stop.timing.clone())),
                    }
                }
            }
            points.sort_by(|a, b| a.0.total_cmp(&b.0));
            let rest = || {
                base.get(&field)
                    .cloned()
                    .unwrap_or_else(|| field.default_write())
            };
            if points[0].0 > 0.0 {
                points.insert(0, (0.0, rest(), None));
            }
            if points[points.len() - 1].0 < 1.0 {
                points.push((1.0, rest(), None));
            }
            Track {
                field,
                stops: points,
            }
        })
        .collect()
}

struct NodeMotion {
    spec: Spec,
    /// What the cascade last asked of each field.
    base: HashMap<Field, PaintWrite>,
    /// What each field was last given, partway through a run included.
    shown: HashMap<Field, PaintWrite>,
    runs: Vec<Run>,
    anims: Vec<Anim>,
}

impl NodeMotion {
    /// Runs and animations not yet over.
    fn running(&self) -> usize {
        self.runs.len() + self.anims.iter().filter(|a| a.phase != Phase::Done).count()
    }

    /// Those that need frames: a paused animation does once, to note the time it stopped.
    fn ticking(&self) -> bool {
        !self.runs.is_empty()
            || self
                .anims
                .iter()
                .any(|a| a.phase != Phase::Done && (!a.spec.paused || a.paused_at.is_none()))
    }

    /// The cascade's writes: at once, or as runs for the fields this node transitions.
    fn route(&mut self, writes: Vec<PaintWrite>, fresh: bool) -> Vec<PaintWrite> {
        let mut now = Vec::new();
        for write in writes {
            let field = Field::of(&write);
            self.base.insert(field, write.clone());
            if self.anims.iter().any(|a| a.holds(field)) {
                continue;
            }
            let transition = self
                .spec
                .transition_for(field)
                .filter(|t| field.blends() && t.runs())
                .cloned();
            // A node's first style is not a change.
            let from = (!fresh).then(|| {
                self.shown
                    .get(&field)
                    .cloned()
                    .unwrap_or_else(|| field.default_write())
            });
            let previous = self
                .runs
                .iter()
                .position(|r| r.field == field)
                .map(|i| self.runs.remove(i));
            match (from, transition) {
                (Some(from), Some(t)) if !same(&from, &write) => {
                    // A spring turned mid-flight keeps its momentum, and takes as long as it needs.
                    let (velocity, duration) = match &t.timing {
                        Timing::Spring(spring) => {
                            let velocity = previous
                                .as_ref()
                                .and_then(|p| carried(p, &from, &write))
                                .unwrap_or(spring.velocity);
                            (velocity, spring.settles(velocity) * 1000.0)
                        }
                        _ => (0.0, t.duration),
                    };
                    self.runs.push(Run {
                        field,
                        from,
                        to: write,
                        duration,
                        delay: t.delay,
                        timing: t.timing,
                        start: None,
                        velocity,
                        rate: velocity,
                    });
                }
                _ => {
                    self.shown.insert(field, write.clone());
                    now.push(write);
                }
            }
        }
        now
    }

    /// A changed `transition` or `animation`: what it dropped ends, and the fields it
    /// held fall back to the cascade's value.
    fn respec(&mut self, spec: Spec) -> Vec<PaintWrite> {
        let mut now = Vec::new();
        let mut released = Vec::new();
        self.anims.retain(|a| {
            let kept = spec.animations.iter().any(|s| s.name == a.spec.name);
            if !kept {
                released.extend(a.tracks.iter().map(|t| t.field));
            }
            kept
        });
        for anim in &mut self.anims {
            if let Some(s) = spec.animations.iter().find(|s| s.name == anim.spec.name) {
                anim.spec = s.clone();
            }
        }
        let mut landed = Vec::new();
        self.runs.retain(|r| {
            let kept = spec.transition_for(r.field).is_some_and(|t| t.runs());
            if !kept {
                landed.push(r.to.clone());
            }
            kept
        });
        for write in landed {
            self.shown.insert(Field::of(&write), write.clone());
            now.push(write);
        }
        self.spec = spec;
        for field in released {
            if !self.anims.iter().any(|a| a.holds(field)) {
                let write = self
                    .base
                    .get(&field)
                    .cloned()
                    .unwrap_or_else(|| field.default_write());
                self.shown.insert(field, write.clone());
                now.push(write);
            }
        }
        now
    }

    fn start_animations(&mut self, context: &Context, problems: &mut Vec<String>) {
        for spec in self.spec.animations.clone() {
            if self.anims.iter().any(|a| a.spec.name == spec.name) {
                continue;
            }
            let Some((stops, variables)) = keyframes::read(context, &spec.name, problems) else {
                problems.push(format!("animation \"{}\" has no @keyframes", spec.name));
                continue;
            };
            self.anims.push(Anim {
                spec,
                tracks: tracks(&stops, &self.base),
                variables,
                start: None,
                paused_at: None,
                phase: Phase::Waiting,
            });
        }
    }

    /// Read again the keyframes of animations that use variables, which may
    /// have changed; where each has got to is kept.
    fn reread(&mut self, context: &Context, problems: &mut Vec<String>) {
        for anim in self.anims.iter_mut().filter(|a| a.variables) {
            if let Some((stops, _)) = keyframes::read(context, &anim.spec.name, problems) {
                anim.tracks = tracks(&stops, &self.base);
            }
        }
    }

    /// The writes for this frame.
    fn step(&mut self, now: f64) -> Vec<PaintWrite> {
        let mut out: BTreeMap<Field, PaintWrite> = BTreeMap::new();
        let mut runs = std::mem::take(&mut self.runs);
        runs.retain_mut(|run| {
            let start = *run.start.get_or_insert(now);
            let elapsed = now - start - run.delay;
            if elapsed < 0.0 {
                return true;
            }
            let x = if run.duration > 0.0 {
                elapsed / run.duration
            } else {
                1.0
            };
            if x >= 1.0 {
                out.insert(run.field, run.to.clone());
                self.shown.insert(run.field, run.to.clone());
                false
            } else {
                let progress = match &run.timing {
                    Timing::Spring(spring) => {
                        let seconds = elapsed / 1000.0;
                        run.rate = spring.rate(seconds, run.velocity);
                        spring.at(seconds, run.velocity)
                    }
                    timing => {
                        let h = 1e-3;
                        let before = (x - h).max(0.0);
                        run.rate = (timing.at(x + h) - timing.at(before)) / (x + h - before)
                            * 1000.0
                            / run.duration;
                        timing.at(x)
                    }
                };
                let value = blend(&run.from, &run.to, progress);
                out.insert(run.field, value.clone());
                self.shown.insert(run.field, value);
                true
            }
        });
        self.runs = runs;
        let mut anims = std::mem::take(&mut self.anims);
        anims.retain_mut(|anim| {
            if anim.phase == Phase::Done {
                return true;
            }
            let progress = match anim.stand(now) {
                Stand::Before => {
                    anim.phase = Phase::Waiting;
                    anim.spec
                        .fill
                        .before()
                        .then(|| directed(anim.spec.direction, 0.0, 0.0))
                }
                Stand::At(p) => {
                    anim.phase = Phase::Active;
                    Some(p)
                }
                Stand::After(p) => {
                    if anim.spec.fill.after() {
                        anim.phase = Phase::Done;
                        Some(p)
                    } else {
                        for track in &anim.tracks {
                            let write = self
                                .base
                                .get(&track.field)
                                .cloned()
                                .unwrap_or_else(|| track.field.default_write());
                            out.insert(track.field, write.clone());
                            self.shown.insert(track.field, write);
                        }
                        return false;
                    }
                }
            };
            if let Some(p) = progress {
                for track in &anim.tracks {
                    let value = track.sample(p, &anim.spec.timing);
                    out.insert(track.field, value.clone());
                    self.shown.insert(track.field, value);
                }
            }
            true
        });
        self.anims = anims;
        // A border colour write takes back every side's own, so the sides follow it.
        if out.contains_key(&Field::BorderColor) {
            for side in 0..4 {
                let field = Field::BorderSide(side);
                if let (false, Some(w)) = (out.contains_key(&field), self.shown.get(&field)) {
                    out.insert(field, w.clone());
                }
            }
        }
        out.into_values().collect()
    }
}

#[derive(Default)]
pub(crate) struct Motion {
    nodes: HashMap<u64, NodeMotion>,
    /// Nodes that need frames.
    active: HashSet<u64>,
    /// Nodes whose last run or animation ended since this was last taken.
    finished: Vec<u64>,
    /// Nodes that gained motion after their first style, which the cascade has yet to
    /// write in full: their animations wait for `rebase`.
    unbased: Vec<u64>,
    /// Whether the theme changed since the animations that read variables last read it.
    rethemed: bool,
    reported: HashSet<String>,
}

impl Motion {
    /// A node's writes from a restyle, with its `transition` and `animation`
    /// when they changed: the writes to apply now. `complete` is whether the
    /// writes are all of the node's paint, as they are for its first style.
    pub(crate) fn restyle(
        &mut self,
        raw: u64,
        spec: Option<Spec>,
        writes: Vec<PaintWrite>,
        complete: bool,
        context: &Context,
        problems: &mut Vec<String>,
    ) -> Vec<PaintWrite> {
        let mut deferred = false;
        let now = match spec {
            None => match self.nodes.get_mut(&raw) {
                Some(node) => node.route(writes, false),
                None => return writes,
            },
            Some(spec) if spec.is_empty() => {
                let Some(node) = self.nodes.remove(&raw) else {
                    return writes;
                };
                self.active.remove(&raw);
                if node.running() > 0 {
                    self.finished.push(raw);
                }
                return settle(node, writes);
            }
            Some(spec) => {
                let fresh = !self.nodes.contains_key(&raw);
                let node = self.nodes.entry(raw).or_insert_with(|| NodeMotion {
                    spec: Spec::default(),
                    base: HashMap::new(),
                    shown: HashMap::new(),
                    runs: Vec::new(),
                    anims: Vec::new(),
                });
                let mut now = if node.spec == spec {
                    Vec::new()
                } else {
                    node.respec(spec)
                };
                now.extend(node.route(writes, fresh));
                // Its values changed, which its animations' variables may read.
                node.reread(context, problems);
                if fresh && !complete {
                    deferred = true;
                } else {
                    node.start_animations(context, problems);
                }
                now
            }
        };
        if deferred {
            self.unbased.push(raw);
        }
        if let Some(node) = self.nodes.get(&raw) {
            if node.ticking() {
                self.active.insert(raw);
            }
        }
        now
    }

    /// The writes for the frame at `now` milliseconds, by node.
    pub(crate) fn tick(&mut self, now: f64) -> Vec<(u64, Vec<PaintWrite>)> {
        let mut out = Vec::new();
        let nodes: Vec<u64> = self.active.iter().copied().collect();
        for raw in nodes {
            let Some(node) = self.nodes.get_mut(&raw) else {
                self.active.remove(&raw);
                continue;
            };
            let before = node.running();
            let writes = node.step(now);
            if !writes.is_empty() {
                out.push((raw, writes));
            }
            if before > 0 && node.running() == 0 {
                self.finished.push(raw);
            }
            if !node.ticking() {
                self.active.remove(&raw);
            }
        }
        out
    }

    /// Whether a tick has anything to do: frames to draw, or nodes to report as finished.
    pub(crate) fn pending(&self) -> bool {
        !self.active.is_empty() || !self.finished.is_empty()
    }

    /// Whether anything needs another frame.
    pub(crate) fn active(&self) -> bool {
        !self.active.is_empty()
    }

    pub(crate) fn take_finished(&mut self) -> Vec<u64> {
        std::mem::take(&mut self.finished)
    }

    /// The theme changed: animations whose keyframes read variables read them again.
    pub(crate) fn theme_changed(&mut self) {
        self.rethemed = true;
    }

    /// After a theme change, the nodes whose animations read variables, for `reread`.
    pub(crate) fn take_rethemed(&mut self) -> Vec<u64> {
        if !std::mem::take(&mut self.rethemed) {
            return Vec::new();
        }
        self.nodes
            .iter()
            .filter(|(_, n)| n.anims.iter().any(|a| a.variables))
            .map(|(&raw, _)| raw)
            .collect()
    }

    /// Read `raw`'s animations' variables again.
    pub(crate) fn reread(&mut self, raw: u64, context: &Context, problems: &mut Vec<String>) {
        if let Some(node) = self.nodes.get_mut(&raw) {
            node.reread(context, problems);
        }
    }

    /// The nodes that need their whole paint, to be given to `rebase`.
    pub(crate) fn take_unbased(&mut self) -> Vec<u64> {
        std::mem::take(&mut self.unbased)
    }

    /// All of a node's paint, which it already shows: what the cascade gives each field,
    /// for the animations that start from or fall back to it.
    pub(crate) fn rebase(
        &mut self,
        raw: u64,
        writes: &[PaintWrite],
        context: &Context,
        problems: &mut Vec<String>,
    ) {
        let Some(node) = self.nodes.get_mut(&raw) else {
            return;
        };
        for write in writes {
            let field = Field::of(write);
            node.base.insert(field, write.clone());
            node.shown.insert(field, write.clone());
        }
        node.start_animations(context, problems);
        if node.ticking() {
            self.active.insert(raw);
        }
    }

    /// Whether `raw` has a transition or animation declared, or ones in flight.
    pub(crate) fn has(&self, raw: u64) -> bool {
        self.nodes.contains_key(&raw)
    }

    /// How many runs and animations of `raw` have not ended.
    pub(crate) fn running(&self, raw: u64) -> usize {
        self.nodes.get(&raw).map_or(0, NodeMotion::running)
    }

    pub(crate) fn forget(&mut self, raw: u64) {
        self.active.remove(&raw);
        if let Some(node) = self.nodes.remove(&raw) {
            if node.running() > 0 {
                self.finished.push(raw);
            }
        }
    }

    /// `problems` that have not been reported before: one message per cause.
    pub(crate) fn unreported(&mut self, problems: Vec<String>) -> Vec<String> {
        problems
            .into_iter()
            .filter(|p| self.reported.insert(p.clone()))
            .collect()
    }
}

/// A node that no longer has motion: what was in flight lands on the cascade's value.
fn settle(node: NodeMotion, mut writes: Vec<PaintWrite>) -> Vec<PaintWrite> {
    let given: HashSet<Field> = writes.iter().map(Field::of).collect();
    let mut driven: Vec<Field> = node.runs.iter().map(|r| r.field).collect();
    driven.extend(
        node.anims
            .iter()
            .flat_map(|a| a.tracks.iter().map(|t| t.field)),
    );
    driven.sort();
    driven.dedup();
    let mut now: Vec<PaintWrite> = driven
        .into_iter()
        .filter(|f| !given.contains(f))
        .map(|f| {
            node.base
                .get(&f)
                .cloned()
                .unwrap_or_else(|| f.default_write())
        })
        .collect();
    now.append(&mut writes);
    now
}

#[cfg(test)]
mod tests;
