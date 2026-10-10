//! A `@keyframes` block read into typed stops.

use super::timing::Timing;
use blinc_abi::css::cascade::Cascade;
use blinc_abi::css::paint::{PaintWrite, is_paint_property, paint_writes};
use blinc_abi::css::quantity::PaintUnits;

/// What the block sets at one offset.
pub(crate) struct Stop {
    /// 0 to 1.
    pub(crate) offset: f64,
    pub(crate) writes: Vec<PaintWrite>,
    /// The curve from this stop to the next, when the block names one.
    pub(crate) timing: Option<Timing>,
}

/// The stops of the `@keyframes` named `name`, in order of offset; none when
/// there is no such block. What cannot be read is left out and reported.
pub(crate) fn read(
    cascade: &Cascade,
    name: &str,
    units: &PaintUnits,
    problems: &mut Vec<String>,
) -> Option<Vec<Stop>> {
    let (sheet, block) = cascade.keyframes(name)?;
    let mut stops = Vec::new();
    for frame in sheet.keyframe_list(block) {
        let mut writes = Vec::new();
        let mut timing = None;
        for declaration in sheet.keyframe_declarations(frame) {
            let property = sheet.str(declaration.name);
            let value = sheet.str(declaration.value);
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
            } else if value.contains("var(") {
                problems.push(format!(
                    "@keyframes {name}: var() in \"{property}\" is not supported"
                ));
            } else {
                match paint_writes(property, Some(value), units) {
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
    Some(stops)
}
