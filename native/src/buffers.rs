//! Synchronous, non-shared typed-array views; pointers never escape a native call.
use napi::{Env, Error, JsValue, Result, Status, Unknown, sys};
unsafe fn view(
    env: Env,
    value: Unknown<'_>,
    expected: sys::napi_typedarray_type,
) -> Result<(*mut std::ffi::c_void, usize)> {
    let (mut kind, mut len, mut data, mut buffer, mut offset) =
        (0, 0, std::ptr::null_mut(), std::ptr::null_mut(), 0);
    let status = unsafe {
        sys::napi_get_typedarray_info(
            env.raw(),
            value.raw(),
            &mut kind,
            &mut len,
            &mut data,
            &mut buffer,
            &mut offset,
        )
    };
    let error = |message| Error::new(Status::InvalidArg, message);
    if status != sys::Status::napi_ok || kind != expected {
        return Err(error(if expected == sys::TypedarrayType::float32_array {
            "Expected a Float32Array"
        } else {
            "Expected a Uint8Array"
        }));
    }
    let mut ordinary = false;
    let status = unsafe { sys::napi_is_arraybuffer(env.raw(), buffer, &mut ordinary) };
    if status != sys::Status::napi_ok || !ordinary {
        return Err(error("Shared output or input is not supported"));
    }
    let mut detached = false;
    let status = unsafe { sys::napi_is_detached_arraybuffer(env.raw(), buffer, &mut detached) };
    if status != sys::Status::napi_ok || detached {
        return Err(error("Detached buffer"));
    }
    if len > 0 && data.is_null() {
        return Err(error("Invalid buffer"));
    }
    Ok((data, len))
}
/// The closure must not execute JS or retain references to the borrowed backing store.
pub unsafe fn f32_output<T>(
    env: Env,
    value: Unknown<'_>,
    run: impl FnOnce(&mut [f32]) -> Result<T>,
) -> Result<T> {
    let (data, len) = unsafe { view(env, value, sys::TypedarrayType::float32_array)? };
    let output = if len == 0 {
        &mut []
    } else {
        unsafe { std::slice::from_raw_parts_mut(data.cast(), len) }
    };
    run(output)
}
/// The closure must not execute JS or retain references to the borrowed backing store.
pub unsafe fn bytes_output<T>(
    env: Env,
    value: Unknown<'_>,
    run: impl FnOnce(&mut [u8]) -> Result<T>,
) -> Result<T> {
    let (data, len) = unsafe { view(env, value, sys::TypedarrayType::uint8_array)? };
    let output = if len == 0 {
        &mut []
    } else {
        unsafe { std::slice::from_raw_parts_mut(data.cast(), len) }
    };
    run(output)
}
/// The closure must not execute JS or retain references to the borrowed backing store.
pub unsafe fn bytes_input<T>(
    env: Env,
    value: Unknown<'_>,
    run: impl FnOnce(&[u8]) -> Result<T>,
) -> Result<T> {
    let (data, len) = unsafe { view(env, value, sys::TypedarrayType::uint8_array)? };
    let input = if len == 0 {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(data.cast(), len) }
    };
    run(input)
}
