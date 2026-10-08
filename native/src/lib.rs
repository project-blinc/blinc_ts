#![recursion_limit = "512"]
#![allow(non_snake_case, dead_code, unused_mut, improper_ctypes_definitions, clippy::all, unsafe_op_in_unsafe_fn)]
mod buffers;
mod brush;
mod enum_value;
mod scene_values;
mod gpu;
mod layout;
mod layout_values;
mod scene;
mod reactive;
mod window;

#[napi_derive::napi]
pub fn build_profile() -> String { env!("BLINC_BUILD_PROFILE").to_owned() }

#[cfg(target_os = "macos")]
mod window_pump;
