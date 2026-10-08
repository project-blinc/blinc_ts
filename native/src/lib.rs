#![recursion_limit = "512"]
#![allow(non_snake_case, dead_code, unused_mut, improper_ctypes_definitions, clippy::all, unsafe_op_in_unsafe_fn)]
mod gpu;
mod layout;
mod reactive;
mod window;

#[napi_derive::napi]
pub fn build_profile() -> String { env!("BLINC_BUILD_PROFILE").to_owned() }
