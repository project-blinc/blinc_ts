#![recursion_limit = "512"]
#![allow(
    non_snake_case,
    dead_code,
    unused_mut,
    improper_ctypes_definitions,
    clippy::all,
    unsafe_op_in_unsafe_fn
)]
mod brush;
mod buffers;
mod commands;
mod css;
mod enum_value;
mod gpu;
mod layout;
mod layout_values;
mod reactive;
mod scene;
mod scene_values;
mod text;
mod window;

#[napi_derive::napi]
pub fn build_profile() -> String {
    env!("BLINC_BUILD_PROFILE").to_owned()
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod window_pump;
