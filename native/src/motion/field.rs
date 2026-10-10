//! The paint slots motion drives: each is what one kind of `PaintWrite`
//! sets, and the CSS properties that name it.

use blinc_abi::css::filter::Filter;
use blinc_abi::css::paint::{Background, PaintWrite};
use blinc_abi::css::transform::IDENTITY;

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
}

impl Field {
    pub(crate) fn of(write: &PaintWrite) -> Field {
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
        }
    }

    /// What the slot holds when no declaration sets it.
    pub(crate) fn default_write(self) -> PaintWrite {
        match self {
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
        }
    }

    /// Whether a transition can move the slot between values; a corner shape
    /// is a setting, not a quantity.
    pub(crate) fn blends(self) -> bool {
        self != Field::CornerShape
    }

    /// Every slot `all` names.
    pub(crate) const ALL: [Field; 17] = [
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
    ];
}

/// The slots a CSS property names; none for one motion does not drive.
pub(crate) fn fields_of(property: &str) -> &'static [Field] {
    match property {
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
        _ => &[],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_default_write_is_of_its_own_field() {
        for field in Field::ALL.into_iter().chain([Field::CornerShape]) {
            assert_eq!(Field::of(&field.default_write()), field);
        }
    }

    #[test]
    fn a_property_names_the_slots_its_writes_set() {
        assert_eq!(fields_of("background-color"), &[Field::Background]);
        assert_eq!(fields_of("border-color").len(), 5);
        assert!(fields_of("width").is_empty());
    }
}
