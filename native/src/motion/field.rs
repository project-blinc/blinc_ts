//! The slots motion drives, each set by one kind of write, and the CSS
//! properties that name them: a paint field, set by a `PaintWrite`, or a
//! layout property, set through the property router.

use blinc_abi::context::PropValue;
use blinc_abi::css::filter::{BACKDROP_IDENTITY, Filter};
use blinc_abi::css::layout::{Units, id, layout_writes};
use blinc_abi::css::paint::{Background, PaintWrite};
use blinc_abi::css::transform::IDENTITY;

/// A layout property's value as the router takes it, owned.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Value {
    /// `auto` is NaN.
    Number(f32),
    Enum(i32),
    Text(Option<String>),
    /// Back to a new node's value.
    Unset,
}

impl Value {
    pub(crate) fn of(value: &PropValue<'_>) -> Value {
        match *value {
            PropValue::Number(v) => Value::Number(v),
            PropValue::Enum(v) => Value::Enum(v),
            PropValue::Text(t) => Value::Text(t.map(str::to_string)),
            PropValue::Unset => Value::Unset,
        }
    }

    pub(crate) fn prop(&self) -> PropValue<'_> {
        match self {
            Value::Number(v) => PropValue::Number(*v),
            Value::Enum(v) => PropValue::Enum(*v),
            Value::Text(t) => PropValue::Text(t.as_deref()),
            Value::Unset => PropValue::Unset,
        }
    }
}

/// What motion writes to a node.
#[derive(Clone, Debug)]
pub(crate) enum Write {
    Paint(PaintWrite),
    /// A router id and its value.
    Layout(i32, Value),
    /// Drawn away from its layout, as a layout animation draws it: offset x, y and a
    /// size, -1 for the layout's; none to draw it at its layout.
    Visual(Option<[f32; 4]>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(crate) enum Field {
    Background,
    TextColor,
    Opacity,
    Visible,
    BorderRadius,
    CornerShape,
    BorderColor,
    BorderSide(u8),
    OutlineWidth,
    OutlineColor,
    OutlineOffset,
    Shadows,
    Transform,
    Filter,
    Mask,
    ClipPath,
    OverflowFade,
    BackdropFilter,
    /// A layout property, by its router id; a length's percentage id is its pixel id's slot.
    Layout(i32),
    /// Where a layout animation draws it.
    Visual,
}

/// Each length's pixel id and the percentage id that sets the same slot.
const LENGTHS: [(i32, i32); 21] = [
    (id::WIDTH, id::WIDTH_PERCENT),
    (id::HEIGHT, id::HEIGHT_PERCENT),
    (id::MIN_WIDTH, id::MIN_WIDTH_PERCENT),
    (id::MAX_WIDTH, id::MAX_WIDTH_PERCENT),
    (id::MIN_HEIGHT, id::MIN_HEIGHT_PERCENT),
    (id::MAX_HEIGHT, id::MAX_HEIGHT_PERCENT),
    (id::FLEX_BASIS, id::FLEX_BASIS_PERCENT),
    (id::PADDING_TOP, id::PADDING_TOP_PERCENT),
    (id::PADDING_RIGHT, id::PADDING_RIGHT_PERCENT),
    (id::PADDING_BOTTOM, id::PADDING_BOTTOM_PERCENT),
    (id::PADDING_LEFT, id::PADDING_LEFT_PERCENT),
    (id::MARGIN_TOP, id::MARGIN_TOP_PERCENT),
    (id::MARGIN_RIGHT, id::MARGIN_RIGHT_PERCENT),
    (id::MARGIN_BOTTOM, id::MARGIN_BOTTOM_PERCENT),
    (id::MARGIN_LEFT, id::MARGIN_LEFT_PERCENT),
    (id::TOP, id::TOP_PERCENT),
    (id::RIGHT, id::RIGHT_PERCENT),
    (id::BOTTOM, id::BOTTOM_PERCENT),
    (id::LEFT, id::LEFT_PERCENT),
    (id::GAP_X, id::GAP_X_PERCENT),
    (id::GAP_Y, id::GAP_Y_PERCENT),
];

/// The slot a router id sets.
pub(crate) fn slot(id: i32) -> i32 {
    LENGTHS
        .iter()
        .find(|&&(_, percent)| percent == id)
        .map_or(id, |&(px, _)| px)
}

/// Whether a slot's value cannot go below zero, so an overshoot stops there:
/// sizes, padding, gaps, flex factors and border widths, not margins or insets.
pub(crate) fn non_negative(slot: i32) -> bool {
    !matches!(
        slot,
        id::MARGIN_TOP
            | id::MARGIN_RIGHT
            | id::MARGIN_BOTTOM
            | id::MARGIN_LEFT
            | id::TOP
            | id::RIGHT
            | id::BOTTOM
            | id::LEFT
    )
}

impl Field {
    pub(crate) fn of(write: &Write) -> Field {
        match write {
            Write::Paint(paint) => Field::of_paint(paint),
            Write::Layout(id, _) => Field::Layout(slot(*id)),
            Write::Visual(_) => Field::Visual,
        }
    }

    pub(crate) fn of_paint(write: &PaintWrite) -> Field {
        match write {
            PaintWrite::Background(_) => Field::Background,
            PaintWrite::TextColor(_) => Field::TextColor,
            PaintWrite::Opacity(_) => Field::Opacity,
            PaintWrite::Visible(_) => Field::Visible,
            PaintWrite::BorderRadius(_) => Field::BorderRadius,
            PaintWrite::CornerShape { .. } => Field::CornerShape,
            PaintWrite::BorderColor(_) => Field::BorderColor,
            PaintWrite::BorderSideColor { side, .. } => Field::BorderSide(*side as u8),
            PaintWrite::OutlineWidth(_) => Field::OutlineWidth,
            PaintWrite::OutlineColor(_) => Field::OutlineColor,
            PaintWrite::OutlineOffset(_) => Field::OutlineOffset,
            PaintWrite::Shadows { .. } => Field::Shadows,
            PaintWrite::Transform(_) => Field::Transform,
            PaintWrite::Filter(_) => Field::Filter,
            PaintWrite::Mask(_) => Field::Mask,
            PaintWrite::ClipPath(_) => Field::ClipPath,
            PaintWrite::OverflowFade(_) => Field::OverflowFade,
            PaintWrite::BackdropFilter(_) => Field::BackdropFilter,
        }
    }

    /// What the slot holds when no declaration sets it.
    pub(crate) fn default_write(self) -> Write {
        Write::Paint(match self {
            Field::Background => PaintWrite::Background(Background::None),
            Field::TextColor => PaintWrite::TextColor(None),
            Field::Opacity => PaintWrite::Opacity(1.0),
            Field::Visible => PaintWrite::Visible(true),
            Field::BorderRadius => PaintWrite::BorderRadius([0.0; 4]),
            Field::CornerShape => PaintWrite::CornerShape {
                shapes: [1.0; 4],
                locked: false,
            },
            Field::BorderColor => PaintWrite::BorderColor(None),
            Field::BorderSide(side) => PaintWrite::BorderSideColor {
                side: side as usize,
                color: None,
            },
            Field::OutlineWidth => PaintWrite::OutlineWidth(0.0),
            Field::OutlineColor => PaintWrite::OutlineColor(None),
            Field::OutlineOffset => PaintWrite::OutlineOffset(0.0),
            Field::Shadows => PaintWrite::Shadows {
                outer: Vec::new(),
                inner: Vec::new(),
            },
            Field::Transform => PaintWrite::Transform(IDENTITY),
            Field::Filter => PaintWrite::Filter(Filter::default()),
            Field::Mask => PaintWrite::Mask(None),
            Field::ClipPath => PaintWrite::ClipPath(None),
            Field::OverflowFade => PaintWrite::OverflowFade([0.0; 4]),
            Field::BackdropFilter => PaintWrite::BackdropFilter(BACKDROP_IDENTITY),
            Field::Layout(slot) => return Write::Layout(slot, Value::Unset),
            Field::Visual => return Write::Visual(None),
        })
    }

    /// Whether a transition can move the slot between values; a corner shape
    /// is a setting, not a quantity.
    pub(crate) fn blends(self) -> bool {
        self != Field::CornerShape
    }

    /// The paint slots `all` names, besides every layout one.
    pub(crate) const ALL: [Field; 20] = [
        Field::Background,
        Field::TextColor,
        Field::Opacity,
        Field::Visible,
        Field::BorderRadius,
        Field::BorderColor,
        Field::BorderSide(0),
        Field::BorderSide(1),
        Field::BorderSide(2),
        Field::BorderSide(3),
        Field::OutlineWidth,
        Field::OutlineColor,
        Field::OutlineOffset,
        Field::Shadows,
        Field::Transform,
        Field::Filter,
        Field::Mask,
        Field::ClipPath,
        Field::OverflowFade,
        Field::BackdropFilter,
    ];
}

/// The slots a CSS property names; none for one motion does not drive.
pub(crate) fn fields_of(property: &str) -> Vec<Field> {
    let paint: &[Field] = match property {
        "background" | "background-color" | "background-image" => &[Field::Background],
        "color" => &[Field::TextColor],
        "opacity" => &[Field::Opacity],
        "visibility" => &[Field::Visible],
        "border-radius" => &[Field::BorderRadius],
        "border-color" => &[
            Field::BorderColor,
            Field::BorderSide(0),
            Field::BorderSide(1),
            Field::BorderSide(2),
            Field::BorderSide(3),
        ],
        "border-top-color" => &[Field::BorderSide(0)],
        "border-right-color" => &[Field::BorderSide(1)],
        "border-bottom-color" => &[Field::BorderSide(2)],
        "border-left-color" => &[Field::BorderSide(3)],
        "outline" => &[Field::OutlineWidth, Field::OutlineColor],
        "outline-width" => &[Field::OutlineWidth],
        "outline-color" => &[Field::OutlineColor],
        "outline-offset" => &[Field::OutlineOffset],
        "box-shadow" => &[Field::Shadows],
        "transform" => &[Field::Transform],
        "filter" => &[Field::Filter],
        "mask-image" | "-webkit-mask-image" => &[Field::Mask],
        "clip-path" => &[Field::ClipPath],
        "overflow-fade" => &[Field::OverflowFade],
        // Its blur is the fill of the background, which moves with it.
        "backdrop-filter" => &[Field::BackdropFilter, Field::Background],
        _ => &[],
    };
    if !paint.is_empty() {
        return paint.to_vec();
    }
    // A layout property's slots are the ids it writes: asked of the router with a zero.
    match layout_writes(property, Some("0"), &Units::default()) {
        Some(Ok(writes)) => {
            let mut slots: Vec<Field> = Vec::new();
            for (id, _) in writes {
                let field = Field::Layout(slot(id));
                if !slots.contains(&field) {
                    slots.push(field);
                }
            }
            slots
        }
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_default_write_is_of_its_own_field() {
        for field in Field::ALL
            .into_iter()
            .chain([Field::CornerShape, Field::Layout(id::WIDTH)])
        {
            assert_eq!(Field::of(&field.default_write()), field);
        }
    }

    #[test]
    fn a_property_names_the_slots_its_writes_set() {
        assert_eq!(fields_of("background-color"), [Field::Background]);
        assert_eq!(fields_of("border-color").len(), 5);
        assert_eq!(fields_of("width"), [Field::Layout(id::WIDTH)]);
        assert_eq!(fields_of("padding").len(), 4);
        assert_eq!(fields_of("flex-grow"), [Field::Layout(id::FLEX_GROW)]);
        assert!(
            fields_of("display").is_empty(),
            "a keyword is not a quantity"
        );
        assert!(fields_of("nonsense").is_empty());
    }

    #[test]
    fn a_percentage_sets_the_same_slot_as_pixels() {
        assert_eq!(slot(id::WIDTH_PERCENT), id::WIDTH);
        assert_eq!(slot(id::GAP_Y_PERCENT), id::GAP_Y);
        assert_eq!(slot(id::FLEX_GROW), id::FLEX_GROW);
    }
}
