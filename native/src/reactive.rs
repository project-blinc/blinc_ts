use blinc_abi::graph::{ComputedKey, EffectKey, GraphContext, SignalKey};
use napi::bindgen_prelude::{FunctionRef, ToNapiValue};
use napi::{Env, Error, JsValue, Result, Status, Unknown, check_status, sys};
use napi_derive::napi;
use std::{
    cell::Cell,
    rc::Rc,
    sync::{Arc, Mutex},
    thread::ThreadId,
};
fn error(message: impl Into<String>) -> Error {
    Error::new(Status::GenericFailure, message.into())
}
struct Owner {
    env: sys::napi_env,
    graph: GraphContext,
    thread: ThreadId,
    errors: Arc<Mutex<Vec<Error>>>,
}
impl Owner {
    fn check(&self) -> Result<()> {
        if self.thread != std::thread::current().id() {
            return Err(error("Reactive context must run on its owning thread"));
        }
        if self.graph.is_disposed() {
            return Err(error("Reactive context is disposed"));
        }
        Ok(())
    }
    fn finish<T>(&self, value: std::result::Result<T, &'static str>) -> Result<T> {
        if self.graph.is_evaluating() {
            return value.map_err(error);
        }
        let errors = std::mem::take(&mut *self.errors.lock().unwrap());
        if let Some(error) = errors.into_iter().next() {
            // JsError coercion would wrap non-Error thrown values. Convert the
            // retained value directly and leave the original exception pending.
            // SAFETY: every entry is on this owner's JS thread and environment.
            unsafe {
                let value = Error::to_napi_value(self.env, error)?;
                check_status!(sys::napi_throw(self.env, value))?;
            }
            return Err(Error::from_status(Status::PendingException));
        }
        value.map_err(error)
    }
    fn callback(&self, env: Env, function: FunctionRef<(), ()>) -> impl Fn() + Send + 'static {
        let address = env.raw() as usize;
        let errors = self.errors.clone();
        let thread = self.thread;
        move || {
            assert_eq!(std::thread::current().id(), thread);
            // The owning native context is thread-confined. Graph disposal drops
            // these function references before the owner releases its resources.
            let env = Env::from_raw(address as napi::sys::napi_env);
            let result = (|| {
                let function = function.borrow_back(&env)?;
                let mut receiver = std::ptr::null_mut();
                let mut output = std::ptr::null_mut();
                // Capture exceptions without string coercion or Error-only
                // conversion: callbacks may throw objects, symbols or undefined.
                unsafe {
                    check_status!(sys::napi_get_undefined(env.raw(), &mut receiver))?;
                    let status = sys::napi_call_function(
                        env.raw(),
                        receiver,
                        function.raw(),
                        0,
                        std::ptr::null(),
                        &mut output,
                    );
                    if status == sys::Status::napi_pending_exception {
                        check_status!(sys::napi_get_and_clear_last_exception(
                            env.raw(),
                            &mut output
                        ))?;
                        return Err(Error::from_unknown_without_coercion(
                            Unknown::from_raw_unchecked(env.raw(), output),
                        ));
                    }
                    check_status!(status)
                }
            })();
            if let Err(error) = result {
                errors.lock().unwrap().push(error);
            }
        }
    }
}
#[napi(object)]
pub struct NativeGraphStats {
    pub signals: u32,
    pub computeds: u32,
    pub effects: u32,
}
#[napi]
pub struct NativeGraph {
    owner: Rc<Owner>,
}
#[napi]
pub struct NativeSignal {
    owner: Rc<Owner>,
    key: SignalKey,
    disposed: Cell<bool>,
}
#[napi]
pub struct NativeComputed {
    owner: Rc<Owner>,
    key: ComputedKey,
    disposed: Cell<bool>,
}
#[napi]
pub struct NativeEffect {
    owner: Rc<Owner>,
    key: EffectKey,
    disposed: Cell<bool>,
}
#[napi]
impl NativeGraph {
    #[napi(constructor)]
    pub fn new(env: Env) -> Self {
        Self {
            owner: Rc::new(Owner {
                env: env.raw(),
                graph: GraphContext::new(),
                thread: std::thread::current().id(),
                errors: Arc::new(Mutex::new(Vec::new())),
            }),
        }
    }
    #[napi]
    pub fn signal(&self) -> Result<NativeSignal> {
        self.owner.check()?;
        let key = self.owner.graph.signal().map_err(error)?;
        Ok(NativeSignal {
            owner: self.owner.clone(),
            key,
            disposed: Cell::new(false),
        })
    }
    #[napi]
    pub fn computed(&self, env: Env, callback: FunctionRef<(), ()>) -> Result<NativeComputed> {
        self.owner.check()?;
        let key = self
            .owner
            .graph
            .computed(self.owner.callback(env, callback))
            .map_err(error)?;
        Ok(NativeComputed {
            owner: self.owner.clone(),
            key,
            disposed: Cell::new(false),
        })
    }
    #[napi]
    pub fn effect(&self, env: Env, callback: FunctionRef<(), ()>) -> Result<NativeEffect> {
        self.owner.check()?;
        let key = self
            .owner
            .graph
            .effect(self.owner.callback(env, callback))
            .map_err(error)?;
        // Initial callback errors must not leak an effect whose handle was never returned.
        if let Err(error) = self.owner.finish(Ok(())) {
            let _ = self.owner.graph.remove_effect(&key);
            return Err(error);
        }
        Ok(NativeEffect {
            owner: self.owner.clone(),
            key,
            disposed: Cell::new(false),
        })
    }
    #[napi]
    pub fn begin_batch(&self) -> Result<()> {
        self.owner.check()?;
        self.owner.finish(self.owner.graph.begin_batch())
    }
    #[napi]
    pub fn end_batch(&self) -> Result<()> {
        self.owner.check()?;
        self.owner.finish(self.owner.graph.end_batch())
    }
    #[napi]
    pub fn stats(&self) -> Result<NativeGraphStats> {
        self.owner.check()?;
        let stats = self.owner.graph.stats().map_err(error)?;
        Ok(NativeGraphStats {
            signals: stats.signals as u32,
            computeds: stats.computeds as u32,
            effects: stats.effects as u32,
        })
    }
    #[napi(getter)]
    pub fn disposed(&self) -> bool {
        self.owner.graph.is_disposed()
    }
    #[napi]
    pub fn dispose(&self) -> Result<()> {
        if self.owner.thread != std::thread::current().id() {
            return Err(error("Reactive context must run on its owning thread"));
        }
        if !self.owner.graph.is_disposed() {
            self.owner.graph.assert_mutable().map_err(error)?;
        }
        self.owner.graph.dispose();
        self.owner.errors.lock().unwrap().clear();
        Ok(())
    }
}
#[napi]
impl NativeSignal {
    #[napi]
    pub fn track(&self) -> Result<()> {
        self.owner.check()?;
        if self.disposed.get() {
            return Err(error("Signal is disposed"));
        }
        self.owner.finish(self.owner.graph.track(self.key))
    }
    #[napi]
    pub fn peek(&self) -> Result<()> {
        self.owner.check()?;
        if self.disposed.get() {
            return Err(error("Signal is disposed"));
        }
        self.owner.finish(self.owner.graph.check_signal(self.key))
    }
    #[napi]
    pub fn notify(&self) -> Result<()> {
        self.owner.check()?;
        if self.disposed.get() {
            return Err(error("Signal is disposed"));
        }
        self.owner.finish(self.owner.graph.notify(self.key))
    }
    #[napi]
    pub fn dispose(&self) -> Result<()> {
        if self.disposed.get() || self.owner.graph.is_disposed() {
            return Ok(());
        }
        self.owner.check()?;
        self.owner.graph.assert_mutable().map_err(error)?;
        self.disposed.set(true);
        self.owner.finish(self.owner.graph.remove_signal(self.key))
    }
}
#[napi]
impl NativeComputed {
    #[napi]
    pub fn track(&self) -> Result<()> {
        self.owner.check()?;
        if self.disposed.get() {
            return Err(error("Computed is disposed"));
        }
        self.owner.finish(self.owner.graph.track_computed(self.key))
    }
    #[napi]
    pub fn dispose(&self) -> Result<()> {
        if self.disposed.get() || self.owner.graph.is_disposed() {
            return Ok(());
        }
        self.owner.check()?;
        self.owner.graph.assert_mutable().map_err(error)?;
        self.disposed.set(true);
        self.owner
            .finish(self.owner.graph.remove_computed(self.key))
    }
}
#[napi]
impl NativeEffect {
    #[napi]
    pub fn dispose(&self) -> Result<()> {
        if self.disposed.get() || self.owner.graph.is_disposed() {
            return Ok(());
        }
        self.owner.check()?;
        self.owner.graph.assert_mutable().map_err(error)?;
        self.disposed.set(true);
        self.owner.finish(self.owner.graph.remove_effect(&self.key))
    }
}
