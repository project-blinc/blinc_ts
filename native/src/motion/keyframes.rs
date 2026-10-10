//! A `@keyframes` block read into typed stops.

use super::Context;
use super::timing::Timing;
use blinc_abi::css::paint::{PaintWrite, is_paint_property, paint_writes};

/// What the block sets at one offset.
pub(crate) struct Stop {
    /// 0 to 1.
    pub(crate) offset: f64,
    pub(crate) writes: Vec<PaintWrite>,
    /// The curve from this stop to the next, when the block names one.
    pub(crate) timing: Option<Timing>,
}

/// The stops of the `@keyframes` named `name`, in order of offset, and
/// whether any of its values read a variable; none when there is no such
/// block. What cannot be read is left out and reported.
pub(crate) fn read(
    context: &Context,
    name: &str,
    problems: &mut Vec<String>,
) -> Option<(Vec<Stop>, bool)> {
    let (sheet, block) = context.cascade.keyframes(name)?;
    let mut stops = Vec::new();
    let mut variables = false;
    for frame in sheet.keyframe_list(block) {
        let mut writes = Vec::new();
        let mut timing = None;
        for declaration in sheet.keyframe_declarations(frame) {
            let property = sheet.str(declaration.name);
            let written = sheet.str(declaration.value);
            // Resolved as the node's own declarations are, so a keyframe can use theme tokens.
            let resolved;
            let value = if written.contains("var(") {
                variables = true;
                resolved = context.cascade.resolve_vars(written, context.values);
                resolved.as_str()
            } else {
                written
            };
            if property == "animation-timing-function" {
                match Timing::parse(value) {
                    Some(t) => timing = Some(t),
                    None => problems.push(format!(
                        "@keyframes {name}: \"{value}\" is not a timing function"
                    )),
                }
            } else if !is_paint_property(property) {
                problems.push(format!(
                    "@keyframes {name}: \"{property}\" is not animated: only paint properties are"
                ));
            } else {
                match paint_writes(property, Some(value), &context.units) {
                    Some(Ok(w)) => writes.extend(w),
                    Some(Err(e)) => problems.push(format!("@keyframes {name}: {property}: {e}")),
                    None => {}
                }
            }
        }
        for &offset in sheet.keyframe_offsets(frame) {
            stops.push(Stop {
                offset: offset.clamp(0.0, 1.0),
                writes: writes.clone(),
                timing,
            });
        }
    }
    stops.sort_by(|a, b| a.offset.total_cmp(&b.offset));
    Some((stops, variables))
}
