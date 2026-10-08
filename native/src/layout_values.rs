//! Numeric layout values generated from the same declaration as TypeScript.
// The enum-only generated schema dispatcher has no argument consumers.
#![allow(unused_variables)]
use napi::bindgen_prelude::{FromNapiValue, ToNapiValue, TypeName, ValidateNapiValue};
use runtime::NativeEnum;
use xidl_node as runtime;
include!(concat!(env!("OUT_DIR"), "/layout.rs"));

// napi_get_value_double (via FromNapiValue) already checks the JS type.
// Read once, then check an exact integer before x-idl validates the enum code.
// Using napi_get_value_int32 would silently truncate fractions and wrap values.
macro_rules! napi_enum {
    ($($ty:ty),* $(,)?) => {$(
        impl TypeName for $ty {
            fn type_name() -> &'static str { stringify!($ty) }
            fn value_type() -> napi::ValueType { napi::ValueType::Number }
        }
        impl ValidateNapiValue for $ty {}
        impl FromNapiValue for $ty {
            unsafe fn from_napi_value(env: napi::sys::napi_env, value: napi::sys::napi_value) -> napi::Result<Self> {
                let number = unsafe { f64::from_napi_value(env, value)? };
                let code = number as i32;
                if f64::from(code) != number {
                    return Err(runtime::node::invalid("enum value must be a finite 32-bit integer"));
                }
                Self::from_native(code).ok_or_else(|| runtime::node::invalid("unknown enum value"))
            }
        }
        impl ToNapiValue for $ty {
            unsafe fn to_napi_value(env: napi::sys::napi_env, value: Self) -> napi::Result<napi::sys::napi_value> {
                unsafe { runtime::node::write(env, runtime::Enum::from(value)) }
            }
        }
    )*};
}
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
