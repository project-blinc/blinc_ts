// napi_get_value_double (via FromNapiValue) already checks the JS type.
// Read once, then check an exact integer before x-idl validates the enum code.
// Using napi_get_value_int32 would silently truncate fractions and wrap values.
macro_rules! napi_enum {
    ($($ty:ty),* $(,)?) => {$(
        impl napi::bindgen_prelude::TypeName for $ty {
            fn type_name() -> &'static str { stringify!($ty) }
            fn value_type() -> napi::ValueType { napi::ValueType::Number }
        }
        impl napi::bindgen_prelude::ValidateNapiValue for $ty {}
        impl napi::bindgen_prelude::FromNapiValue for $ty {
            unsafe fn from_napi_value(env: napi::sys::napi_env, value: napi::sys::napi_value) -> napi::Result<Self> {
                let number = unsafe { <f64 as napi::bindgen_prelude::FromNapiValue>::from_napi_value(env, value)? };
                let code = number as i32;
                if f64::from(code) != number {
                    return Err(xidl_node::node::invalid("enum value must be a finite 32-bit integer"));
                }
                Self::from_native(code).ok_or_else(|| xidl_node::node::invalid("unknown enum value"))
            }
        }
        impl napi::bindgen_prelude::ToNapiValue for $ty {
            unsafe fn to_napi_value(env: napi::sys::napi_env, value: Self) -> napi::Result<napi::sys::napi_value> {
                unsafe { xidl_node::node::write(env, xidl_node::Enum::from(value)) }
            }
        }
    )*};
}
pub(crate) use napi_enum;
