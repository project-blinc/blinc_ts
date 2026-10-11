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
mod motion;
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

/// Hand back to the system what the allocator holds freed, as a quiet app does once it has
/// let go of a page's worth of memory. Safe to call at any time; it frees nothing in use.
#[napi_derive::napi]
pub fn release_free_memory() {
    #[cfg(target_os = "macos")]
    unsafe {
        unsafe extern "C" {
            fn malloc_zone_pressure_relief(zone: *mut std::ffi::c_void, goal: usize) -> usize;
        }
        malloc_zone_pressure_relief(std::ptr::null_mut(), 0);
    }
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    unsafe {
        libc::malloc_trim(0);
    }
    #[cfg(windows)]
    unsafe {
        HeapCompact(GetProcessHeap(), 0);
    }
}

#[cfg(windows)]
#[repr(C)]
struct ProcessMemoryCounters {
    cb: u32,
    page_fault_count: u32,
    peak_working_set_size: usize,
    working_set_size: usize,
    quota_peak_paged_pool_usage: usize,
    quota_paged_pool_usage: usize,
    quota_peak_non_paged_pool_usage: usize,
    quota_non_paged_pool_usage: usize,
    pagefile_usage: usize,
    peak_pagefile_usage: usize,
    private_usage: usize,
}

#[cfg(windows)]
unsafe extern "system" {
    fn GetCurrentProcess() -> *mut std::ffi::c_void;
    fn GetProcessHeap() -> *mut std::ffi::c_void;
    fn HeapCompact(heap: *mut std::ffi::c_void, flags: u32) -> usize;
    fn K32GetProcessMemoryInfo(
        process: *mut std::ffi::c_void,
        counters: *mut ProcessMemoryCounters,
        size: u32,
    ) -> i32;
}

/// Bytes of memory the process holds, as the system counts it against the process: its physical
/// footprint on macOS, its resident set on Linux, its private bytes on Windows.
#[napi_derive::napi]
pub fn memory_footprint() -> f64 {
    #[cfg(target_os = "macos")]
    unsafe {
        let mut info: libc::rusage_info_v2 = std::mem::zeroed();
        let read = libc::proc_pid_rusage(
            libc::getpid(),
            libc::RUSAGE_INFO_V2,
            &mut info as *mut _ as *mut libc::rusage_info_t,
        );
        if read == 0 {
            info.ri_phys_footprint as f64
        } else {
            0.0
        }
    }
    #[cfg(target_os = "linux")]
    {
        let pages = std::fs::read_to_string("/proc/self/statm")
            .ok()
            .and_then(|s| s.split_whitespace().nth(1)?.parse::<f64>().ok())
            .unwrap_or(0.0);
        pages * unsafe { libc::sysconf(libc::_SC_PAGESIZE) } as f64
    }
    // Its private bytes on Windows, what Task Manager's commit size shows.
    #[cfg(windows)]
    unsafe {
        let mut counters: ProcessMemoryCounters = std::mem::zeroed();
        counters.cb = std::mem::size_of::<ProcessMemoryCounters>() as u32;
        if K32GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, counters.cb) != 0 {
            counters.private_usage as f64
        } else {
            0.0
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    0.0
}
