//! Text measurement and inline layout for TypeScript, without a layout tree:
//! the same shaping and line breaking the renderer draws with.
use crate::scene::{TextStyle, default_text, number, positive};
use blinc_abi::inline::{InlineAlign, InlineItem};
use blinc_abi::scene::TextMeasureContext;
use napi::bindgen_prelude::Float64Array;
use napi::{Error, Result, Status};
use napi_derive::napi;

fn error(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

fn context(style: TextStyle) -> Result<(TextMeasureContext, f32)> {
    let letter_spacing = match style.letter_spacing {
        Some(v) => number(v)?,
        None => 0.0,
    };
    let context = style.apply(String::new(), default_text())?;
    blinc_abi::text::initialize();
    blinc_abi::text::ensure_face(&context);
    Ok((context, letter_spacing))
}

#[napi(object)]
pub struct NativeTextMeasure {
    pub width: f64,
    pub line_height: f64,
    pub ascender: f64,
    pub descender: f64,
    /// Per line: its first UTF-16 index, its end, and its width.
    pub lines: Float64Array,
    /// Per caret stop: its UTF-16 index, its x, and its line.
    pub carets: Float64Array,
}

/// `text` in `style`, laid out as it is drawn. With `wrapWidth`, lines wrap
/// at that width; line breaks always end a line.
#[napi]
pub fn measure_text(
    text: String,
    style: TextStyle,
    wrap_width: Option<f64>,
) -> Result<NativeTextMeasure> {
    let wrap = wrap_width.map(positive).transpose()?;
    let (context, letter_spacing) = context(style)?;
    let measured = blinc_abi::text::measure(&context, &text, letter_spacing, wrap)
        .ok_or_else(|| error("No font face for this text style"))?;
    let lines: Vec<f64> = measured
        .lines
        .iter()
        .flat_map(|l| [f64::from(l.start), f64::from(l.end), f64::from(l.width)])
        .collect();
    let carets: Vec<f64> = measured
        .carets
        .iter()
        .flat_map(|c| [f64::from(c.index), f64::from(c.x), f64::from(c.line)])
        .collect();
    Ok(NativeTextMeasure {
        width: f64::from(measured.width),
        line_height: f64::from(measured.line_height),
        ascender: f64::from(measured.ascender),
        descender: f64::from(measured.descender),
        lines: Float64Array::new(lines),
        carets: Float64Array::new(carets),
    })
}

/// One item of an inline flow: text in a style (kind 0), a box kept whole
/// (kind 1) or a line break (kind 2).
#[napi(object)]
pub struct NativeInlineItem {
    pub kind: u32,
    pub text: Option<String>,
    pub style: Option<TextStyle>,
    pub padding_left: Option<f64>,
    pub padding_right: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub baseline: Option<f64>,
    pub block: Option<bool>,
}

#[napi(object)]
pub struct NativeInlineLayout {
    /// Per fragment: item, start, end, x, y, width, height, line.
    pub fragments: Float64Array,
    /// Per line: top, height, baseline.
    pub lines: Float64Array,
    pub texts: Vec<String>,
    pub max_content: f64,
    pub min_content: f64,
    pub height: f64,
}

/// Lay `items` out as one paragraph `width` wide; `align` is 0 left, 1
/// centre, 2 right, 3 justify.
#[napi]
pub fn layout_inline(
    items: Vec<NativeInlineItem>,
    width: f64,
    align: u32,
    break_words: bool,
) -> Result<NativeInlineLayout> {
    let width = positive(width)?;
    let align = match align {
        0 => InlineAlign::Left,
        1 => InlineAlign::Center,
        2 => InlineAlign::Right,
        3 => InlineAlign::Justify,
        _ => return Err(error("Invalid text alignment")),
    };
    if items.iter().any(|item| item.kind > 2) {
        return Err(error("Invalid inline item kind"));
    }
    // Owned first, so the flow's items can borrow their contexts.
    let mut owned = Vec::with_capacity(items.len());
    for item in items {
        if item.kind == 0 {
            let style = item.style.unwrap_or(TextStyle {
                font_size: None,
                line_height: None,
                letter_spacing: None,
                wrap: None,
                font_family: None,
                font_weight: None,
                italic: None,
            });
            let (context, spacing) = context(style)?;
            let padding = [
                positive(item.padding_left.unwrap_or(0.0))?,
                positive(item.padding_right.unwrap_or(0.0))?,
            ];
            owned.push((
                item.kind,
                item.text.unwrap_or_default(),
                Some((context, spacing, padding)),
                [0.0; 3],
                false,
            ));
        } else {
            let size = [
                positive(item.width.unwrap_or(0.0))?,
                positive(item.height.unwrap_or(0.0))?,
                positive(item.baseline.or(item.height).unwrap_or(0.0))?,
            ];
            owned.push((
                item.kind,
                String::new(),
                None,
                size,
                item.block.unwrap_or(false),
            ));
        }
    }
    let flow: Vec<InlineItem<'_>> = owned
        .iter()
        .map(|(kind, text, style, size, block)| match (kind, style) {
            (0, Some((context, letter_spacing, padding))) => InlineItem::Text {
                context,
                text,
                letter_spacing: *letter_spacing,
                padding: *padding,
            },
            (1, _) => InlineItem::Box {
                width: size[0],
                height: size[1],
                baseline: size[2],
                block: *block,
            },
            _ => InlineItem::Break,
        })
        .collect();
    let laid = blinc_abi::inline::layout(&flow, width, align, break_words);
    let fragments: Vec<f64> = laid
        .fragments
        .iter()
        .flat_map(|f| {
            [
                f64::from(f.item),
                f64::from(f.start),
                f64::from(f.end),
                f64::from(f.x),
                f64::from(f.y),
                f64::from(f.width),
                f64::from(f.height),
                f64::from(f.line),
            ]
        })
        .collect();
    let lines: Vec<f64> = laid
        .lines
        .iter()
        .flat_map(|l| [f64::from(l.top), f64::from(l.height), f64::from(l.baseline)])
        .collect();
    Ok(NativeInlineLayout {
        fragments: Float64Array::new(fragments),
        lines: Float64Array::new(lines),
        texts: laid.texts,
        max_content: f64::from(laid.max_content),
        min_content: f64::from(laid.min_content),
        height: f64::from(laid.height),
    })
}
