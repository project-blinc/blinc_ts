//! One native call per flush: tree edits, property writes, text and paint
//! encoded by `Layout` into a Uint32Array of commands and a Float64Array of
//! their numbers. Nodes are named by their raw ids, split into two u32 words.
//! Commands apply in order; the first that fails stops the batch with its
//! error, leaving earlier commands applied. Consecutive property writes apply
//! as one atomic edit.
use crate::brush::NativeBrush;
use crate::layout::NativeLayout;
use crate::scene::{PaintStyle, TextStyle, rgba};
use blinc_abi::context::{LayoutContext, Node, PropValue};
use blinc_abi::scene::blinc_core::{Brush, Color};
use blinc_abi::types::Value;
use napi::bindgen_prelude::{ClassInstance, Float64Array, Uint32Array};
use napi::{Error, Result, Status};
use napi_derive::napi;

fn error(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

const PROPERTY: u32 = 1;
const INSERT: u32 = 2;
const DETACH: u32 = 3;
const REMOVE: u32 = 4;
const TEXT: u32 = 5;
const PAINT: u32 = 6;
const SCROLL: u32 = 7;

// Text fields present in a TEXT command's mask, each a number unless noted.
const TEXT_SIZE: u32 = 1;
const TEXT_LINE_HEIGHT: u32 = 2;
const TEXT_LETTER_SPACING: u32 = 4;
const TEXT_WEIGHT: u32 = 8;
const TEXT_WRAP: u32 = 16;
const TEXT_WRAP_ON: u32 = 32;
const TEXT_ITALIC: u32 = 64;
const TEXT_ITALIC_ON: u32 = 128;
/// The family is a string index in the command.
const TEXT_FAMILY: u32 = 256;

// Paint fields present in a PAINT command's mask.
/// A brush, by index into the batch's brushes.
const PAINT_BRUSH: u32 = 1;
/// A solid background: four channels.
const PAINT_SOLID: u32 = 2;
const PAINT_TEXT_COLOR: u32 = 4;
const PAINT_RADIUS: u32 = 8;
const PAINT_BORDER_COLOR: u32 = 16;
const PAINT_BORDER_WIDTH: u32 = 32;
const PAINT_OPACITY: u32 = 64;
const PAINT_VISIBLE: u32 = 128;
const PAINT_VISIBLE_ON: u32 = 256;
const PAINT_TRANSFORM: u32 = 512;
const PAINT_Z_INDEX: u32 = 1024;
/// Reset every paint field before the others apply.
const PAINT_CLEAR: u32 = 2048;

struct Reader<'a> {
    words: &'a [u32],
    numbers: &'a [f64],
    word: usize,
    number: usize,
}
impl Reader<'_> {
    fn word(&mut self) -> Result<u32> {
        let w = *self
            .words
            .get(self.word)
            .ok_or_else(|| error("Truncated layout command"))?;
        self.word += 1;
        Ok(w)
    }
    fn number(&mut self) -> Result<f64> {
        let n = *self
            .numbers
            .get(self.number)
            .ok_or_else(|| error("Truncated layout command numbers"))?;
        self.number += 1;
        Ok(n)
    }
    fn numbers(&mut self, count: usize) -> Result<Vec<f64>> {
        (0..count).map(|_| self.number()).collect()
    }
    fn node(&mut self, tree: &LayoutContext) -> Result<Node> {
        let raw = u64::from(self.word()?) | u64::from(self.word()?) << 32;
        tree.node(raw).map_err(error)
    }
}

fn string(strings: &[String], index: u32) -> Result<&str> {
    strings
        .get(index as usize)
        .map(String::as_str)
        .ok_or_else(|| error("Layout command names no string"))
}

#[napi]
impl NativeLayout {
    /// Apply a batch of encoded commands (see the module notes) in one call.
    #[napi]
    pub fn apply_commands(
        &self,
        words: Uint32Array,
        numbers: Float64Array,
        strings: Vec<String>,
        brushes: Vec<ClassInstance<NativeBrush>>,
    ) -> Result<()> {
        self.owner.check()?;
        let mut tree = self.owner.tree.borrow_mut();
        let mut r = Reader {
            words: &words,
            numbers: &numbers,
            word: 0,
            number: 0,
        };
        let mut writes: Vec<(Node, i32, PropValue<'_>)> = Vec::new();
        while r.word < r.words.len() {
            let op = r.word()?;
            if op != PROPERTY && !writes.is_empty() {
                tree.apply(&writes).map_err(error)?;
                writes.clear();
            }
            match op {
                PROPERTY => {
                    let node = r.node(&tree)?;
                    let id = r.word()? as i32;
                    let kind = r.word()?;
                    let n = r.number()?;
                    let value = match kind {
                        0 if !n.is_infinite() => PropValue::Number(n as f32),
                        1 if n.fract() == 0.0 && n.abs() <= f64::from(i32::MAX) => {
                            PropValue::Enum(n as i32)
                        }
                        2 => PropValue::Text(Some(string(&strings, n as u32)?)),
                        3 => PropValue::Text(None),
                        4 => PropValue::Unset,
                        _ => return Err(error("Invalid property value")),
                    };
                    writes.push((node, id, value));
                }
                INSERT => {
                    let parent = r.node(&tree)?;
                    let child = r.node(&tree)?;
                    let has_before = r.word()? != 0;
                    let before = if has_before {
                        Some(r.node(&tree)?)
                    } else {
                        r.word()?;
                        r.word()?;
                        None
                    };
                    tree.insert_before(parent, child, before).map_err(error)?;
                }
                DETACH => {
                    let node = r.node(&tree)?;
                    tree.detach(node).map_err(error)?;
                }
                REMOVE => {
                    let node = r.node(&tree)?;
                    tree.remove(node).map_err(error)?;
                }
                TEXT => {
                    let node = r.node(&tree)?;
                    let content = string(&strings, r.word()?)?.to_owned();
                    let mask = r.word()?;
                    let family = r.word()?;
                    let mut read = |bit: u32| -> Result<Option<f64>> {
                        if mask & bit != 0 {
                            Ok(Some(r.number()?))
                        } else {
                            Ok(None)
                        }
                    };
                    let style = TextStyle {
                        font_size: read(TEXT_SIZE)?,
                        line_height: read(TEXT_LINE_HEIGHT)?,
                        letter_spacing: read(TEXT_LETTER_SPACING)?,
                        font_weight: read(TEXT_WEIGHT)?,
                        wrap: (mask & TEXT_WRAP != 0).then_some(mask & TEXT_WRAP_ON != 0),
                        italic: (mask & TEXT_ITALIC != 0).then_some(mask & TEXT_ITALIC_ON != 0),
                        font_family: if mask & TEXT_FAMILY != 0 {
                            Some(string(&strings, family)?.to_owned())
                        } else {
                            None
                        },
                    };
                    let text = style.apply(content, tree.text(node).map_err(error)?)?;
                    tree.set_text(node, text).map_err(error)?;
                }
                PAINT => {
                    let node = r.node(&tree)?;
                    let mask = r.word()?;
                    let brush = r.word()?;
                    let mut p = if mask & PAINT_CLEAR != 0 {
                        Default::default()
                    } else {
                        tree.properties(node).map_err(error)?
                    };
                    let mut glass = (mask & PAINT_CLEAR != 0).then_some(None);
                    if mask & PAINT_BRUSH != 0 {
                        let brush = brushes
                            .get(brush as usize)
                            .ok_or_else(|| error("Layout command names no brush"))?;
                        p.background = Some(match &brush.style_value {
                            Value::Brush(b) => b.clone(),
                            Value::Glass(g, effects) => {
                                glass = Some(Some(*effects));
                                Brush::Glass(*g)
                            }
                            _ => return Err(error("Expected a native brush value")),
                        });
                        glass.get_or_insert(None);
                    }
                    if mask & PAINT_SOLID != 0 {
                        let [r_, g, b, a] = rgba(r.numbers(4)?)?;
                        p.background = Some(Brush::Solid(Color { r: r_, g, b, a }));
                        glass = Some(None);
                    }
                    let mut take = |bit: u32, count: usize| -> Result<Option<Vec<f64>>> {
                        if mask & bit != 0 {
                            Ok(Some(r.numbers(count)?))
                        } else {
                            Ok(None)
                        }
                    };
                    let style = PaintStyle {
                        background: None,
                        mask_image: None,
                        text_color: take(PAINT_TEXT_COLOR, 4)?,
                        radius: take(PAINT_RADIUS, 4)?,
                        border_color: take(PAINT_BORDER_COLOR, 4)?,
                        border_width: take(PAINT_BORDER_WIDTH, 1)?.map(|v| v[0]),
                        opacity: take(PAINT_OPACITY, 1)?.map(|v| v[0]),
                        visible: (mask & PAINT_VISIBLE != 0).then_some(mask & PAINT_VISIBLE_ON != 0),
                        transform: take(PAINT_TRANSFORM, 6)?,
                        z_index: take(PAINT_Z_INDEX, 1)?.map(|v| v[0]),
                        shadows: None,
                        filter: None,
                        clear_filter: None,
                        clear_mask: None,
                    };
                    let props = style.apply(p)?;
                    tree.set_properties(node, props).map_err(error)?;
                    if let Some(effects) = glass {
                        tree.set_glass_effects(node, effects).map_err(error)?;
                    }
                }
                SCROLL => {
                    let node = r.node(&tree)?;
                    let [x, y] = [r.number()?, r.number()?];
                    if !x.is_finite() || !y.is_finite() {
                        return Err(error("Expected a finite number"));
                    }
                    tree.set_scroll(
                        node,
                        Some(blinc_abi::tree::Scroll {
                            x: x as f32,
                            y: y as f32,
                            thumb: [0.0; 4],
                        }),
                    )
                    .map_err(error)?;
                }
                _ => return Err(error("Unknown layout command")),
            }
        }
        if !writes.is_empty() {
            tree.apply(&writes).map_err(error)?;
        }
        if r.number != r.numbers.len() {
            return Err(error("Layout command numbers were left over"));
        }
        Ok(())
    }
}
