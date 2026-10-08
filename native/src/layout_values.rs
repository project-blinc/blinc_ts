//! Numeric layout values generated from the same declaration as TypeScript.
// The enum-only generated schema dispatcher has no argument consumers.
#![allow(unused_variables)]
use crate::enum_value::napi_enum;
use runtime::NativeEnum;
use xidl_node as runtime;
include!(concat!(env!("OUT_DIR"), "/layout.rs"));

napi_enum!(LayoutDirection, LayoutAlign, LayoutJustify, LayoutOverflow);

impl From<LayoutDirection> for taffy::FlexDirection {
    fn from(value: LayoutDirection) -> Self {
        match value {
            LayoutDirection::Row => Self::Row,
            LayoutDirection::Column => Self::Column,
            LayoutDirection::RowReverse => Self::RowReverse,
            LayoutDirection::ColumnReverse => Self::ColumnReverse,
        }
    }
}
impl From<LayoutAlign> for taffy::AlignItems {
    fn from(value: LayoutAlign) -> Self {
        match value {
            LayoutAlign::Start => Self::START,
            LayoutAlign::End => Self::END,
            LayoutAlign::Center => Self::CENTER,
            LayoutAlign::Stretch => Self::STRETCH,
        }
    }
}
impl From<LayoutJustify> for taffy::JustifyContent {
    fn from(value: LayoutJustify) -> Self {
        match value {
            LayoutJustify::Start => Self::START,
            LayoutJustify::End => Self::END,
            LayoutJustify::Center => Self::CENTER,
            LayoutJustify::SpaceBetween => Self::SPACE_BETWEEN,
            LayoutJustify::SpaceAround => Self::SPACE_AROUND,
            LayoutJustify::SpaceEvenly => Self::SPACE_EVENLY,
        }
    }
}
impl From<LayoutOverflow> for taffy::Overflow {
    fn from(value: LayoutOverflow) -> Self {
        match value {
            LayoutOverflow::Visible => Self::Visible,
            LayoutOverflow::Hidden => Self::Hidden,
            LayoutOverflow::Scroll => Self::Scroll,
        }
    }
}
