use super::*;
use blinc_abi::css::parse;

const NODE: u64 = 7;

fn cascade(css: &str) -> Cascade {
    let mut cascade = Cascade::new();
    cascade.push(parse(css, None, &mut |_, _| None));
    cascade
}

fn spec(declared: &[(&str, &str)]) -> Spec {
    Spec::read(declared.iter().copied()).0
}

fn opacity(write: &PaintWrite) -> f32 {
    match write {
        PaintWrite::Opacity(o) => *o,
        other => panic!("not an opacity: {other:?}"),
    }
}

/// The opacity `node` is given at `now`, none when nothing is written.
fn opacity_at(motion: &mut Motion, now: f64) -> Option<f32> {
    let frame = motion.tick(now);
    let writes = &frame.iter().find(|(raw, _)| *raw == NODE)?.1;
    writes.iter().find_map(|w| match w {
        PaintWrite::Opacity(o) => Some(*o),
        _ => None,
    })
}

fn restyle(
    motion: &mut Motion,
    cascade: &Cascade,
    spec: Option<Spec>,
    writes: Vec<PaintWrite>,
) -> Vec<PaintWrite> {
    let context = Context {
        cascade,
        units: PaintUnits::default(),
        values: &[],
    };
    let mut problems = Vec::new();
    let now = motion.restyle(NODE, spec, writes, true, &context, &mut problems);
    assert!(problems.is_empty(), "{problems:?}");
    now
}

fn near(a: Option<f32>, b: f32) {
    let a = a.unwrap_or_else(|| panic!("nothing written, wanted {b}"));
    assert!((a - b).abs() < 1e-4, "{a} is not {b}");
}

const LINEAR: &[(&str, &str)] = &[("transition", "opacity 100ms linear")];

#[test]
fn a_first_style_applies_and_a_change_runs() {
    let (mut motion, cascade) = (Motion::default(), cascade(""));
    let first = restyle(
        &mut motion,
        &cascade,
        Some(spec(LINEAR)),
        vec![PaintWrite::Opacity(1.0)],
    );
    assert_eq!(first.len(), 1, "the first style is not a change");
    assert!(!motion.active());

    let held = restyle(&mut motion, &cascade, None, vec![PaintWrite::Opacity(0.0)]);
    assert!(held.is_empty(), "a transitioned field waits for the clock");
    assert!(motion.active());
    near(opacity_at(&mut motion, 1000.0), 1.0);
    near(opacity_at(&mut motion, 1050.0), 0.5);
    near(opacity_at(&mut motion, 1100.0), 0.0);
    assert!(!motion.active());
    assert_eq!(motion.take_finished(), [NODE]);
    assert_eq!(
        opacity_at(&mut motion, 1200.0),
        None,
        "nothing more is written"
    );
}

#[test]
fn a_change_in_flight_continues_from_where_it_is() {
    let (mut motion, cascade) = (Motion::default(), cascade(""));
    restyle(
        &mut motion,
        &cascade,
        Some(spec(LINEAR)),
        vec![PaintWrite::Opacity(1.0)],
    );
    restyle(&mut motion, &cascade, None, vec![PaintWrite::Opacity(0.0)]);
    opacity_at(&mut motion, 0.0);
    near(opacity_at(&mut motion, 50.0), 0.5);

    // Back the other way: from 0.5, not from 0.
    restyle(&mut motion, &cascade, None, vec![PaintWrite::Opacity(1.0)]);
    near(opacity_at(&mut motion, 60.0), 0.5);
    near(opacity_at(&mut motion, 110.0), 0.75);
    near(opacity_at(&mut motion, 160.0), 1.0);
    assert_eq!(motion.take_finished(), [NODE]);
}

#[test]
fn a_field_with_no_transition_applies_at_once() {
    let (mut motion, cascade) = (Motion::default(), cascade(""));
    restyle(
        &mut motion,
        &cascade,
        Some(spec(LINEAR)),
        vec![PaintWrite::Opacity(1.0)],
    );
    let now = restyle(
        &mut motion,
        &cascade,
        None,
        vec![PaintWrite::OutlineWidth(3.0), PaintWrite::Opacity(0.2)],
    );
    assert_eq!(now.len(), 1);
    assert!(matches!(now[0], PaintWrite::OutlineWidth(w) if w == 3.0));
}

#[test]
fn a_field_never_set_transitions_from_its_default() {
    let (mut motion, cascade) = (Motion::default(), cascade(""));
    restyle(&mut motion, &cascade, Some(spec(LINEAR)), vec![]);
    let held = restyle(&mut motion, &cascade, None, vec![PaintWrite::Opacity(0.5)]);
    assert!(held.is_empty());
    near(opacity_at(&mut motion, 0.0), 1.0);
    near(opacity_at(&mut motion, 100.0), 0.5);
}

#[test]
fn a_delay_holds_the_old_value() {
    let (mut motion, cascade) = (Motion::default(), cascade(""));
    let slow = spec(&[("transition", "opacity 100ms linear 100ms")]);
    restyle(
        &mut motion,
        &cascade,
        Some(slow),
        vec![PaintWrite::Opacity(1.0)],
    );
    restyle(&mut motion, &cascade, None, vec![PaintWrite::Opacity(0.0)]);
    assert_eq!(opacity_at(&mut motion, 0.0), None);
    assert_eq!(opacity_at(&mut motion, 99.0), None);
    // The delay counts from the first frame, so the run is half done 50ms after it ends.
    near(opacity_at(&mut motion, 150.0), 0.5);
    assert!(motion.active());
    near(opacity_at(&mut motion, 200.0), 0.0);
    assert!(!motion.active());
}

#[test]
fn dropping_the_transition_lands_what_was_in_flight() {
    let (mut motion, cascade) = (Motion::default(), cascade(""));
    restyle(
        &mut motion,
        &cascade,
        Some(spec(LINEAR)),
        vec![PaintWrite::Opacity(1.0)],
    );
    restyle(&mut motion, &cascade, None, vec![PaintWrite::Opacity(0.0)]);
    opacity_at(&mut motion, 0.0);
    let now = restyle(
        &mut motion,
        &cascade,
        Some(spec(&[("transition", "none")])),
        vec![],
    );
    assert_eq!(now.len(), 1);
    near(Some(opacity(&now[0])), 0.0);
    assert!(!motion.active());
    assert_eq!(motion.take_finished(), [NODE]);
    // With no motion left, writes pass straight through.
    let plain = restyle(&mut motion, &cascade, None, vec![PaintWrite::Opacity(0.3)]);
    near(Some(opacity(&plain[0])), 0.3);
}

#[test]
fn an_overshooting_curve_is_clamped_where_a_value_has_bounds() {
    let (mut motion, cascade) = (Motion::default(), cascade(""));
    let spring = spec(&[(
        "transition",
        "opacity 100ms cubic-bezier(0.34, 1.56, 0.64, 1)",
    )]);
    restyle(
        &mut motion,
        &cascade,
        Some(spring),
        vec![PaintWrite::Opacity(0.0)],
    );
    restyle(&mut motion, &cascade, None, vec![PaintWrite::Opacity(1.0)]);
    opacity_at(&mut motion, 0.0);
    let peak = (1..100)
        .filter_map(|ms| opacity_at(&mut motion, f64::from(ms)))
        .fold(0.0f32, f32::max);
    assert!(peak <= 1.0, "opacity went to {peak}");
}

const FADE: &str = "@keyframes fade { from { opacity: 0 } to { opacity: 1 } }";

fn animate(declared: &[(&str, &str)], css: &str) -> (Motion, Cascade) {
    let (mut motion, cascade) = (Motion::default(), cascade(css));
    restyle(&mut motion, &cascade, Some(spec(declared)), vec![]);
    (motion, cascade)
}

#[test]
fn an_animation_samples_its_keyframes_and_then_gives_the_field_back() {
    let (mut motion, _) = animate(&[("animation", "fade 100ms linear")], FADE);
    assert!(motion.active());
    near(opacity_at(&mut motion, 0.0), 0.0);
    near(opacity_at(&mut motion, 25.0), 0.25);
    near(opacity_at(&mut motion, 75.0), 0.75);
    // Over, with no fill: the field is what the cascade says, here its default.
    near(opacity_at(&mut motion, 100.0), 1.0);
    assert!(!motion.active());
    assert_eq!(motion.take_finished(), [NODE]);
}

#[test]
fn forwards_holds_the_last_keyframe_against_the_cascade() {
    let (mut motion, cascade) = animate(&[("animation", "fade 100ms linear forwards")], FADE);
    opacity_at(&mut motion, 0.0);
    near(opacity_at(&mut motion, 100.0), 1.0);
    assert_eq!(motion.take_finished(), [NODE]);
    let held = restyle(&mut motion, &cascade, None, vec![PaintWrite::Opacity(0.4)]);
    assert!(held.is_empty(), "the animation still decides opacity");
    // Taking the animation away hands the field back.
    let back = restyle(
        &mut motion,
        &cascade,
        Some(spec(&[("color", "red")])),
        vec![],
    );
    near(Some(opacity(&back[0])), 0.4);
}

#[test]
fn backwards_shows_the_first_keyframe_through_the_delay() {
    let (mut motion, _) = animate(&[("animation", "fade 100ms linear 100ms backwards")], FADE);
    near(opacity_at(&mut motion, 0.0), 0.0);
    near(opacity_at(&mut motion, 50.0), 0.0);
    near(opacity_at(&mut motion, 150.0), 0.5);
    let (mut motion, _) = animate(&[("animation", "fade 100ms linear 100ms")], FADE);
    assert_eq!(
        opacity_at(&mut motion, 0.0),
        None,
        "no fill, no effect in the delay"
    );
}

#[test]
fn a_missing_endpoint_is_what_the_cascade_gives() {
    let (mut motion, cascade) = (
        Motion::default(),
        cascade("@keyframes down { to { opacity: 0 } }"),
    );
    restyle(
        &mut motion,
        &cascade,
        Some(spec(&[("animation", "down 100ms linear")])),
        vec![PaintWrite::Opacity(0.8)],
    );
    near(opacity_at(&mut motion, 0.0), 0.8);
    near(opacity_at(&mut motion, 50.0), 0.4);
}

#[test]
fn direction_and_iterations_shape_the_cycle() {
    let (mut motion, _) = animate(
        &[("animation", "fade 100ms linear 2 alternate forwards")],
        FADE,
    );
    opacity_at(&mut motion, 0.0);
    near(opacity_at(&mut motion, 50.0), 0.5);
    near(opacity_at(&mut motion, 100.0), 1.0);
    near(opacity_at(&mut motion, 150.0), 0.5);
    // Two iterations of an alternating cycle end where the second runs to: the start.
    near(opacity_at(&mut motion, 200.0), 0.0);
    assert_eq!(motion.take_finished(), [NODE]);

    let (mut motion, _) = animate(&[("animation", "fade 100ms linear reverse forwards")], FADE);
    opacity_at(&mut motion, 0.0);
    near(opacity_at(&mut motion, 25.0), 0.75);
}

#[test]
fn an_infinite_animation_never_finishes_and_a_paused_one_stops_asking_for_frames() {
    let (mut motion, cascade) = animate(&[("animation", "fade 100ms linear infinite")], FADE);
    opacity_at(&mut motion, 0.0);
    near(opacity_at(&mut motion, 1025.0), 0.25);
    assert!(motion.active());
    assert!(motion.take_finished().is_empty());

    let paused = spec(&[("animation", "fade 100ms linear infinite paused")]);
    restyle(&mut motion, &cascade, Some(paused), vec![]);
    near(opacity_at(&mut motion, 1050.0), 0.5);
    assert_eq!(
        opacity_at(&mut motion, 5000.0),
        None,
        "nothing moves while paused"
    );
    assert!(!motion.active(), "and no frames are asked for");

    // Resumed, it goes on from where it stopped, not from where the clock has got to.
    let running = spec(&[("animation", "fade 100ms linear infinite")]);
    restyle(&mut motion, &cascade, Some(running), vec![]);
    assert!(motion.active());
    near(opacity_at(&mut motion, 6000.0), 0.5);
    near(opacity_at(&mut motion, 6025.0), 0.75);
}

#[test]
fn a_keyframe_can_carry_its_own_timing() {
    let (mut motion, _) = animate(
        &[("animation", "step 100ms linear forwards")],
        "@keyframes step { from { opacity: 0; animation-timing-function: steps(2, jump-end) } to { opacity: 1 } }",
    );
    near(opacity_at(&mut motion, 0.0), 0.0);
    near(opacity_at(&mut motion, 40.0), 0.0);
    near(opacity_at(&mut motion, 60.0), 0.5);
}

#[test]
fn animation_problems_are_reported_once() {
    let mut motion = Motion::default();
    let cascade = cascade("@keyframes odd { to { width: 10px; opacity: 0 } }");
    let context = Context {
        cascade: &cascade,
        units: PaintUnits::default(),
        values: &[],
    };
    let mut problems = Vec::new();
    motion.restyle(
        NODE,
        Some(spec(&[("animation", "odd 100ms, nope 100ms")])),
        vec![],
        true,
        &context,
        &mut problems,
    );
    assert_eq!(problems.len(), 2, "{problems:?}");
    assert!(problems[0].contains("width"), "{problems:?}");
    assert!(problems[1].contains("nope"), "{problems:?}");
    assert_eq!(motion.unreported(problems.clone()).len(), 2);
    assert!(motion.unreported(problems).is_empty());
}

#[test]
fn forgetting_a_node_ends_its_motion() {
    let (mut motion, _) = animate(&[("animation", "fade 100ms linear infinite")], FADE);
    assert_eq!(motion.running(NODE), 1);
    motion.forget(NODE);
    assert_eq!(motion.running(NODE), 0);
    assert!(!motion.active());
    assert_eq!(motion.take_finished(), [NODE]);
}

#[test]
fn a_node_that_gains_motion_late_takes_its_base_from_the_rebase() {
    let (mut motion, cascade) = (Motion::default(), cascade(FADE));
    let context = Context {
        cascade: &cascade,
        units: PaintUnits::default(),
        values: &[],
    };
    let mut problems = Vec::new();
    // Styled long ago, it was never told its paint; the animation waits for it.
    motion.restyle(
        NODE,
        Some(spec(&[("animation", "fade 100ms linear")])),
        vec![],
        false,
        &context,
        &mut problems,
    );
    assert_eq!(motion.take_unbased(), [NODE]);
    assert!(!motion.active(), "nothing starts without its base");
    motion.rebase(NODE, &[PaintWrite::Opacity(0.8)], &context, &mut problems);
    assert!(problems.is_empty(), "{problems:?}");
    assert!(motion.active());
    near(opacity_at(&mut motion, 0.0), 0.0);
    // Over, it gives back what the cascade had, not the default.
    near(opacity_at(&mut motion, 100.0), 0.8);
}

#[test]
fn a_keyframe_reads_variables_and_reads_them_again_when_the_theme_changes() {
    let mut cascade =
        cascade("@keyframes dim { from { opacity: var(--start) } to { opacity: 1 } }");
    cascade.set_theme(&[("start", "0.2")]);
    let mut motion = Motion::default();
    let mut problems = Vec::new();
    fn context(cascade: &Cascade) -> Context<'_> {
        Context {
            cascade,
            units: PaintUnits::default(),
            values: &[],
        }
    }
    motion.restyle(
        NODE,
        Some(spec(&[("animation", "dim 100ms linear")])),
        vec![],
        true,
        &context(&cascade),
        &mut problems,
    );
    assert!(problems.is_empty(), "{problems:?}");
    near(opacity_at(&mut motion, 0.0), 0.2);
    near(opacity_at(&mut motion, 50.0), 0.6);
    // A theme change is read at the next restyle, and the animation keeps its place.
    cascade.set_theme(&[("start", "0.6")]);
    motion.theme_changed();
    assert_eq!(motion.take_rethemed(), [NODE]);
    motion.reread(NODE, &context(&cascade), &mut problems);
    near(opacity_at(&mut motion, 50.0), 0.8);
    assert!(motion.take_rethemed().is_empty(), "taken once");
}

/// The outline offset `node` is given at `now`, which, unlike opacity, has no bounds to clamp an overshoot.
fn offset_at(motion: &mut Motion, now: f64) -> Option<f32> {
    let frame = motion.tick(now);
    let writes = &frame.iter().find(|(raw, _)| *raw == NODE)?.1;
    writes.iter().find_map(|w| match w {
        PaintWrite::OutlineOffset(o) => Some(*o),
        _ => None,
    })
}

const BOUNCY: &[(&str, &str)] = &[("transition", "outline-offset spring(1 170 10)")];

#[test]
fn a_spring_needs_no_duration_overshoots_and_lands() {
    let (mut motion, cascade) = (Motion::default(), cascade(""));
    restyle(
        &mut motion,
        &cascade,
        Some(spec(BOUNCY)),
        vec![PaintWrite::OutlineOffset(0.0)],
    );
    let held = restyle(
        &mut motion,
        &cascade,
        None,
        vec![PaintWrite::OutlineOffset(10.0)],
    );
    assert!(held.is_empty(), "a spring runs with no duration given");
    let mut most = 0.0f32;
    let mut ms = 0.0;
    while motion.active() && ms < 5000.0 {
        if let Some(v) = offset_at(&mut motion, ms) {
            most = most.max(v);
        }
        ms += 16.0;
    }
    assert!(most > 12.0, "it overshoots: {most}");
    assert!(!motion.active(), "and settles, after {ms}ms");
    assert!(ms > 300.0 && ms < 3000.0, "in its own time: {ms}ms");
    assert_eq!(motion.take_finished(), [NODE]);
}

#[test]
fn a_spring_turned_back_keeps_its_momentum() {
    let (mut motion, cascade) = (Motion::default(), cascade(""));
    restyle(
        &mut motion,
        &cascade,
        Some(spec(BOUNCY)),
        vec![PaintWrite::OutlineOffset(0.0)],
    );
    restyle(
        &mut motion,
        &cascade,
        None,
        vec![PaintWrite::OutlineOffset(10.0)],
    );
    offset_at(&mut motion, 0.0);
    let turned = offset_at(&mut motion, 60.0).unwrap();
    assert!(turned > 1.0 && turned < 10.0, "partway out: {turned}");
    restyle(
        &mut motion,
        &cascade,
        None,
        vec![PaintWrite::OutlineOffset(0.0)],
    );
    let start = offset_at(&mut motion, 76.0).unwrap();
    let next = offset_at(&mut motion, 92.0).unwrap();
    assert!((start - turned).abs() < 1e-4, "it turns from where it is");
    assert!(
        next > start,
        "still moving out a frame later: {start} then {next}"
    );
    let mut ms = 92.0;
    let mut last = next;
    while motion.active() && ms < 5000.0 {
        ms += 16.0;
        last = offset_at(&mut motion, ms).unwrap_or(last);
    }
    assert!(last.abs() < 0.05, "and lands back at the start: {last}");
}

#[test]
fn an_eased_transition_turned_back_heads_back_at_once() {
    let eased = &[("transition", "outline-offset 200ms linear")];
    let (mut motion, cascade) = (Motion::default(), cascade(""));
    restyle(
        &mut motion,
        &cascade,
        Some(spec(eased)),
        vec![PaintWrite::OutlineOffset(0.0)],
    );
    restyle(
        &mut motion,
        &cascade,
        None,
        vec![PaintWrite::OutlineOffset(10.0)],
    );
    offset_at(&mut motion, 0.0);
    let turned = offset_at(&mut motion, 100.0).unwrap();
    restyle(
        &mut motion,
        &cascade,
        None,
        vec![PaintWrite::OutlineOffset(0.0)],
    );
    offset_at(&mut motion, 116.0);
    assert!(
        offset_at(&mut motion, 132.0).unwrap() < turned,
        "it heads back at once"
    );
}
