//! Bridge the main-thread platform pump to libuv without a polling timer.
//! The helper thread only watches the kernel I/O descriptor; all window and JS
//! work stays on the owning main thread. libuv is never run recursively.
use crate::window::backend;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{Env, Error, Result, Status, sys};
use napi_derive::napi;
use std::{
    alloc::{Layout, alloc_zeroed, dealloc},
    cell::{Cell, RefCell},
    ffi::c_void,
    io::{Read, Write},
    os::fd::AsRawFd,
    os::unix::net::UnixStream,
    ptr,
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::Duration,
};

type Callback = ThreadsafeFunction<(), (), (), Status, false, true>;
type Handle = *mut c_void;
type Loop = *mut napi::sys::uv_loop_s;
// Stable libuv handle-kind values; allocate via uv_handle_size, never mirror its structs.
const CHECK: i32 = 2;
const IDLE: i32 = 6;
const PREPARE: i32 = 9;
unsafe extern "C" {
    fn uv_handle_size(kind: i32) -> usize;
    fn uv_handle_get_type(handle: Handle) -> i32;
    fn uv_handle_set_data(handle: Handle, data: *mut c_void);
    fn uv_handle_get_data(handle: Handle) -> *mut c_void;
    fn uv_prepare_init(loop_: Loop, handle: Handle) -> i32;
    fn uv_prepare_start(handle: Handle, cb: unsafe extern "C" fn(Handle)) -> i32;
    fn uv_prepare_stop(handle: Handle) -> i32;
    fn uv_check_init(loop_: Loop, handle: Handle) -> i32;
    fn uv_check_start(handle: Handle, cb: unsafe extern "C" fn(Handle)) -> i32;
    fn uv_check_stop(handle: Handle) -> i32;
    fn uv_idle_init(loop_: Loop, handle: Handle) -> i32;
    fn uv_idle_start(handle: Handle, cb: unsafe extern "C" fn(Handle)) -> i32;
    fn uv_idle_stop(handle: Handle) -> i32;
    fn uv_close(handle: Handle, cb: unsafe extern "C" fn(Handle));
    fn uv_backend_fd(loop_: Loop) -> i32;
    fn uv_backend_timeout(loop_: Loop) -> i32;
    fn uv_update_time(loop_: Loop);
}
fn error(message: impl Into<String>) -> Error {
    Error::new(Status::GenericFailure, message.into())
}

struct Signal {
    armed: AtomicBool,
    stopped: AtomicBool,
}
struct Watcher {
    signal: Arc<Signal>,
    pipe: UnixStream,
    thread: Option<JoinHandle<()>>,
}
impl Watcher {
    fn new(fd: i32, wake: winit::event_loop::EventLoopProxy<()>) -> Result<Self> {
        let (pipe, mut reader) = UnixStream::pair().map_err(|e| error(e.to_string()))?;
        pipe.set_nonblocking(true)
            .map_err(|e| error(e.to_string()))?;
        reader
            .set_nonblocking(true)
            .map_err(|e| error(e.to_string()))?;
        let signal = Arc::new(Signal {
            armed: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
        });
        let shared = signal.clone();
        let thread = thread::Builder::new()
            .name("blinc-io-wake".into())
            .spawn(move || {
                let mut bytes = [0; 64];
                loop {
                    if shared.stopped.load(Ordering::Acquire) {
                        break;
                    }
                    let armed = shared.armed.load(Ordering::Acquire);
                    let mut fds = [
                        libc::pollfd {
                            fd: reader.as_raw_fd(),
                            events: libc::POLLIN,
                            revents: 0,
                        },
                        libc::pollfd {
                            fd: if armed { fd } else { -1 },
                            events: libc::POLLIN,
                            revents: 0,
                        },
                    ];
                    let n = unsafe { libc::poll(fds.as_mut_ptr(), 2, -1) };
                    if n < 0 {
                        if std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted
                        {
                            continue;
                        }
                        // Wake the owner rather than leaving it asleep on a broken watcher.
                        let _ = wake.send_event(());
                        break;
                    }
                    if fds[0].revents != 0 {
                        while reader.read(&mut bytes).is_ok_and(|n| n > 0) {}
                    }
                    if fds[1].revents != 0 && shared.armed.swap(false, Ordering::AcqRel) {
                        let _ = wake.send_event(());
                    }
                }
            })
            .map_err(|e| error(e.to_string()))?;
        Ok(Self {
            signal,
            pipe,
            thread: Some(thread),
        })
    }
    fn arm(&self, armed: bool) {
        self.signal.armed.store(armed, Ordering::Release);
        // A full pipe already has a wake queued, so WouldBlock needs no retry.
        let _ = (&self.pipe).write(&[1]);
    }
}
impl Drop for Watcher {
    fn drop(&mut self) {
        self.signal.stopped.store(true, Ordering::Release);
        self.arm(false);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
struct State {
    loop_: Loop,
    handles: RefCell<Vec<Handle>>,
    idle: Cell<Handle>,
    callback: RefCell<Option<Callback>>,
    pending: Arc<AtomicBool>,
    watcher: RefCell<Option<Watcher>>,
    closed: Cell<bool>,
    env_closed: Cell<bool>,
}
impl State {
    fn close(&self) {
        if self.closed.replace(true) {
            return;
        }
        self.watcher.borrow_mut().take();
        self.callback.borrow_mut().take();
        let _ = backend::external_pump(false);
        unsafe {
            for handle in self.handles.borrow_mut().drain(..) {
                match uv_handle_get_type(handle) {
                    PREPARE => {
                        uv_prepare_stop(handle);
                    }
                    CHECK => {
                        uv_check_stop(handle);
                    }
                    IDLE => {
                        uv_idle_stop(handle);
                    }
                    _ => {}
                }
                uv_close(handle, closed);
            }
        }
    }
    fn notify(&self) {
        if self.pending.swap(true, Ordering::AcqRel) {
            return;
        }
        let pending = self.pending.clone();
        if let Some(callback) = self.callback.borrow().as_ref() {
            let status = callback.call_with_return_value(
                (),
                ThreadsafeFunctionCallMode::NonBlocking,
                move |result, _| {
                    pending.store(false, Ordering::Release);
                    result
                },
            );
            if status != Status::Ok {
                self.pending.store(false, Ordering::Release);
            }
        }
    }
}
unsafe fn state(handle: Handle) -> Rc<State> {
    let data = uv_handle_get_data(handle).cast::<State>();
    // Each live handle owns a strong reference until its close callback.
    // Keep another for this callback, including paths which initiate teardown.
    Rc::increment_strong_count(data);
    Rc::from_raw(data)
}
unsafe extern "C" fn closed(handle: Handle) {
    let keep = Rc::from_raw(uv_handle_get_data(handle).cast::<State>());
    let layout = Layout::from_size_align_unchecked(uv_handle_size(uv_handle_get_type(handle)), 16);
    dealloc(handle.cast(), layout);
    drop(keep);
}
unsafe extern "C" fn idle(_: Handle) {}
unsafe extern "C" fn prepare(handle: Handle) {
    let state = state(handle);
    // Flush libuv's queued descriptor registrations in its normal I/O phase
    // without sleeping there; the platform loop waits in the check phase.
    uv_idle_start(state.idle.get(), idle);
}
unsafe extern "C" fn check(handle: Handle) {
    let state = state(handle);
    uv_idle_stop(state.idle.get());
    if state.closed.get() || state.pending.load(Ordering::Acquire) {
        return;
    }
    if backend::external_pending() {
        state.notify();
        return;
    }
    uv_update_time(state.loop_);
    let timeout = uv_backend_timeout(state.loop_);
    let wait = if timeout < 0 {
        None
    } else {
        Some(Duration::from_millis(timeout as u64))
    };
    {
        let watcher = state.watcher.borrow();
        if let Some(watcher) = watcher.as_ref() {
            watcher.arm(timeout != 0);
        }
    }
    let events = backend::pump_external(wait);
    if let Some(watcher) = state.watcher.borrow().as_ref() {
        watcher.arm(false);
    }
    uv_update_time(state.loop_);
    if events {
        state.notify();
    }
}
unsafe fn add_handle(state: &Rc<State>, kind: i32) -> Result<Handle> {
    let layout =
        Layout::from_size_align(uv_handle_size(kind), 16).map_err(|e| error(e.to_string()))?;
    let handle = alloc_zeroed(layout).cast::<c_void>();
    if handle.is_null() {
        return Err(error("Cannot allocate event pump handle"));
    }
    let result = match kind {
        PREPARE => uv_prepare_init(state.loop_, handle),
        CHECK => uv_check_init(state.loop_, handle),
        IDLE => uv_idle_init(state.loop_, handle),
        _ => unreachable!(),
    };
    if result != 0 {
        dealloc(handle.cast(), layout);
        return Err(error(format!("libuv init: {result}")));
    }
    uv_handle_set_data(handle, Rc::into_raw(state.clone()).cast_mut().cast());
    state.handles.borrow_mut().push(handle);
    Ok(handle)
}

unsafe extern "C" fn env_cleanup(data: *mut c_void) {
    let state = Rc::from_raw(data.cast::<State>());
    state.env_closed.set(true);
    state.close();
}

#[napi]
pub struct NativeEventPump {
    state: Rc<State>,
    env: Env,
    cleanup: Option<*const State>,
}
#[napi]
impl NativeEventPump {
    #[napi(constructor)]
    pub fn new(env: Env, callback: Callback) -> Result<Self> {
        let loop_ = env.get_uv_event_loop()?;
        let fd = unsafe { uv_backend_fd(loop_) };
        if fd < 0 {
            return Err(error("libuv has no pollable I/O descriptor"));
        }
        let wake = backend::external_waker().ok_or_else(|| error("Window loop is not pumpable"))?;
        backend::external_pump(true).map_err(error)?;
        let state = Rc::new(State {
            loop_,
            handles: RefCell::new(Vec::new()),
            idle: Cell::new(ptr::null_mut()),
            callback: RefCell::new(Some(callback)),
            pending: Arc::new(AtomicBool::new(false)),
            watcher: RefCell::new(None),
            closed: Cell::new(false),
            env_closed: Cell::new(false),
        });
        let install = (|| unsafe {
            *state.watcher.borrow_mut() = Some(Watcher::new(fd, wake)?);
            state.idle.set(add_handle(&state, IDLE)?);
            let before = add_handle(&state, PREPARE)?;
            let after = add_handle(&state, CHECK)?;
            for result in [
                uv_prepare_start(before, prepare),
                uv_check_start(after, check),
            ] {
                if result != 0 {
                    return Err(error(format!("libuv start: {result}")));
                }
            }
            let data = Rc::into_raw(state.clone());
            let status = sys::napi_add_env_cleanup_hook(
                env.raw(),
                Some(env_cleanup),
                data.cast_mut().cast(),
            );
            if status != sys::Status::napi_ok {
                drop(Rc::from_raw(data));
                return Err(error("Cannot register event pump cleanup"));
            }
            Ok(data)
        })();
        match install {
            Ok(cleanup) => Ok(Self {
                state,
                env,
                cleanup: Some(cleanup),
            }),
            Err(error) => {
                state.close();
                Err(error)
            }
        }
    }
    #[napi]
    pub fn dispose(&mut self) -> Result<()> {
        self.state.close();
        if let Some(cleanup) = self.cleanup.take() {
            if !self.state.env_closed.get() {
                let status = unsafe {
                    sys::napi_remove_env_cleanup_hook(
                        self.env.raw(),
                        Some(env_cleanup),
                        cleanup.cast_mut().cast(),
                    )
                };
                if status != sys::Status::napi_ok {
                    return Err(error("Cannot remove event pump cleanup"));
                }
                unsafe {
                    drop(Rc::from_raw(cleanup));
                }
            }
        }
        Ok(())
    }
}
impl Drop for NativeEventPump {
    fn drop(&mut self) {
        let _ = self.dispose();
    }
}
