//! The reactive graph for JavaScript. Items are named by generation-checked
//! numeric keys, and callbacks stay in a JavaScript table. A computed keeps
//! its callback's id, and native code calls one dispatcher function per
//! context with it while the graph evaluates. Effects are run by JavaScript:
//! calls that can make effects due return how many are due, `takeDue`
//! hands their tags over, and JavaScript runs each between `beginEffect` and
//! `endEffect`.
use blinc_abi::graph::{ComputedKey, GraphContext, HostEffectKey, SignalKey};
use napi::bindgen_prelude::{Function, FunctionRef, ToNapiValue};
use napi::{Env, Error, JsValue, Result, Status, Unknown, check_status, sys};
use napi_derive::napi;
use std::{cell::RefCell, rc::Rc, thread::ThreadId};

fn error(message: impl Into<String>) -> Error {
    Error::new(Status::GenericFailure, message.into())
}

/// Calls the context's JavaScript dispatcher with a callback id. Boxed by the
/// owner so graph callbacks can hold its address; the graph, and with it every
/// callback, is dropped before it.
struct Dispatch {
    env: sys::napi_env,
    function: FunctionRef<f64, ()>,
    thread: ThreadId,
    errors: RefCell<Vec<Error>>,
}
impl Dispatch {
    fn call(&self, id: u32) {
        assert_eq!(std::thread::current().id(), self.thread);
        let env = Env::from_raw(self.env);
        let result = (|| {
            let function = self.function.borrow_back(&env)?;
            let mut receiver = std::ptr::null_mut();
            let mut output = std::ptr::null_mut();
            // Capture exceptions without string coercion or Error-only
            // conversion: callbacks may throw objects, symbols or undefined.
            unsafe {
                check_status!(sys::napi_get_undefined(env.raw(), &mut receiver))?;
                let argument = f64::to_napi_value(env.raw(), f64::from(id))?;
                let status = sys::napi_call_function(
                    env.raw(),
                    receiver,
                    function.raw(),
                    1,
                    &argument,
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
            self.errors.borrow_mut().push(error);
        }
    }
}

enum Item {
    Free,
    Signal(SignalKey),
    Computed(ComputedKey),
    Effect(HostEffectKey),
}
struct Slot {
    generation: u32,
    item: Item,
}
/// A key is a slot index in its low 32 bits and the slot's generation above,
/// kept under 2^53 so it is exact as a JavaScript number.
const GENERATIONS: u32 = 1 << 21;
fn key(index: usize, generation: u32) -> f64 {
    (u64::from(generation) << 32 | index as u64) as f64
}

/// The registered scratch array: its storage and a reference that keeps it alive.
struct Scratch {
    data: *const f64,
    len: usize,
    reference: sys::napi_ref,
}
impl Default for Scratch {
    fn default() -> Self {
        Self {
            data: std::ptr::null(),
            len: 0,
            reference: std::ptr::null_mut(),
        }
    }
}

struct Owner {
    // Declared before `dispatch`, so the graph and its callbacks drop first.
    graph: GraphContext,
    slots: RefCell<Vec<Slot>>,
    free: RefCell<Vec<u32>>,
    /// Slot indexes of due effects, waiting for JavaScript to take them.
    due: RefCell<Vec<u32>>,
    /// Raw ids from the graph, reused between takes.
    due_raw: RefCell<Vec<u64>>,
    /// For each effect, by the graph's own index for it, our slot index.
    effect_slots: RefCell<Vec<u32>>,
    /// Signal keys an effect run read, written by JavaScript into a
    /// Float64Array this context registered once (see `setScratch`).
    scratch: RefCell<Scratch>,
    /// Raw signal ids resolved from the scratch keys, reused between runs.
    reads: RefCell<Vec<u64>>,
    /// Open batches: no effect becomes due inside one.
    batches: std::cell::Cell<u32>,
    /// Effect runs now open, innermost last, kept so a run whose effect was
    /// released while it ran can still be closed.
    runs: RefCell<Vec<(f64, HostEffectKey)>>,
    dispatch: Box<Dispatch>,
}
impl Owner {
    /// Whether a batch or an effect run is open, so nothing new can be due.
    fn holding(&self) -> bool {
        self.batches.get() > 0 || !self.runs.borrow().is_empty()
    }
    fn check(&self) -> Result<()> {
        if self.dispatch.thread != std::thread::current().id() {
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
        if self.dispatch.errors.borrow().is_empty() {
            return value.map_err(error);
        }
        let errors = std::mem::take(&mut *self.dispatch.errors.borrow_mut());
        if let Some(error) = errors.into_iter().next() {
            // JsError coercion would wrap non-Error thrown values. Convert the
            // retained value directly and leave the original exception pending.
            // SAFETY: every entry is on this owner's JS thread and environment.
            unsafe {
                let env = self.dispatch.env;
                let value = Error::to_napi_value(env, error)?;
                check_status!(sys::napi_throw(env, value))?;
            }
            return Err(Error::from_status(Status::PendingException));
        }
        value.map_err(error)
    }
    fn callback(&self, id: u32) -> impl Fn() + Send + 'static {
        let dispatch = &*self.dispatch as *const Dispatch as usize;
        // SAFETY: the dispatcher outlives the graph that owns this callback,
        // and the callback runs only on the owning thread (Dispatch::call checks).
        move || unsafe { &*(dispatch as *const Dispatch) }.call(id)
    }
    fn insert(&self, item: Item) -> f64 {
        let mut slots = self.slots.borrow_mut();
        if let Some(index) = self.free.borrow_mut().pop() {
            let slot = &mut slots[index as usize];
            slot.item = item;
            key(index as usize, slot.generation)
        } else {
            slots.push(Slot {
                generation: 0,
                item,
            });
            key(slots.len() - 1, 0)
        }
    }
    /// The live slot `key` names, or `None` for a stale or malformed key.
    fn slot<R>(&self, key: f64, read: impl FnOnce(&Item) -> R) -> Option<R> {
        if !(0.0..9_007_199_254_740_992.0).contains(&key) || key.fract() != 0.0 {
            return None;
        }
        let raw = key as u64;
        let (index, generation) = ((raw & 0xffff_ffff) as usize, (raw >> 32) as u32);
        let slots = self.slots.borrow();
        let slot = slots.get(index)?;
        (slot.generation == generation && !matches!(slot.item, Item::Free))
            .then(|| read(&slot.item))
    }
    /// Free the slot `key` names, returning its item; `None` if already freed.
    fn take(&self, key: f64) -> Option<Item> {
        self.slot(key, |_| ())?;
        let index = (key as u64 & 0xffff_ffff) as usize;
        let mut slots = self.slots.borrow_mut();
        let slot = &mut slots[index];
        slot.generation = (slot.generation + 1) % GENERATIONS;
        self.free.borrow_mut().push(index as u32);
        Some(std::mem::replace(&mut slot.item, Item::Free))
    }
    fn signal(&self, key: f64) -> Result<SignalKey> {
        match self.slot(key, |item| match item {
            Item::Signal(s) => Some(*s),
            _ => None,
        }) {
            Some(Some(signal)) => Ok(signal),
            _ => Err(error("Signal is disposed")),
        }
    }
    fn computed(&self, key: f64) -> Result<ComputedKey> {
        match self.slot(key, |item| match item {
            Item::Computed(c) => Some(*c),
            _ => None,
        }) {
            Some(Some(computed)) => Ok(computed),
            _ => Err(error("Computed is disposed")),
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
impl NativeGraph {
    /// `dispatch` is called with a callback id whenever a computed evaluates or an effect runs.
    #[napi(constructor)]
    pub fn new(env: Env, dispatch: Function<f64, ()>) -> Result<Self> {
        Ok(Self {
            owner: Rc::new(Owner {
                graph: GraphContext::new(),
                slots: RefCell::new(Vec::new()),
                free: RefCell::new(Vec::new()),
                due: RefCell::new(Vec::new()),
                due_raw: RefCell::new(Vec::new()),
                effect_slots: RefCell::new(Vec::new()),
                scratch: RefCell::new(Scratch::default()),
                reads: RefCell::new(Vec::new()),
                batches: std::cell::Cell::new(0),
                runs: RefCell::new(Vec::new()),
                dispatch: Box::new(Dispatch {
                    env: env.raw(),
                    function: dispatch.create_ref()?,
                    thread: std::thread::current().id(),
                    errors: RefCell::new(Vec::new()),
                }),
            }),
        })
    }
    #[napi]
    pub fn signal(&self) -> Result<f64> {
        self.owner.check()?;
        let key = self.owner.graph.signal().map_err(error)?;
        Ok(self.owner.insert(Item::Signal(key)))
    }
    #[napi]
    pub fn computed(&self, callback: u32) -> Result<f64> {
        self.owner.check()?;
        let key = self
            .owner
            .graph
            .computed(self.owner.callback(callback))
            .map_err(error)?;
        Ok(self.owner.insert(Item::Computed(key)))
    }
    /// Collect the effects now due, returning how many wait for `takeDue`.
    fn due(&self) -> Result<u32> {
        let mut raw = self.owner.due_raw.borrow_mut();
        raw.clear();
        self.owner
            .graph
            .take_due_host_effects(&mut raw)
            .map_err(error)?;
        let slots = self.owner.effect_slots.borrow();
        let mut due = self.owner.due.borrow_mut();
        // The graph's index for an effect is the low half of its raw id.
        due.extend(
            raw.iter()
                .filter_map(|&id| slots.get((id & 0xffff_ffff) as usize).copied()),
        );
        Ok(due.len() as u32)
    }
    /// Move up to `target.length` waiting due tags into `target`, oldest
    /// first, returning how many were written.
    #[napi]
    pub fn take_due(&self, env: Env, target: Unknown<'_>) -> Result<u32> {
        self.owner.check()?;
        // No JavaScript runs while the output storage is borrowed.
        unsafe {
            crate::buffers::u32_output(env, target, |target| {
                let mut due = self.owner.due.borrow_mut();
                let count = due.len().min(target.len());
                target[..count].copy_from_slice(&due[..count]);
                due.drain(..count);
                Ok(count as u32)
            })
        }
    }
    /// An effect. Its slot index (the key's low 32 bits) is what `takeDue`
    /// reports when it is due, which it is at once.
    #[napi]
    pub fn effect(&self) -> Result<f64> {
        self.owner.check()?;
        let effect = self.owner.graph.host_effect().map_err(error)?;
        let key = self.owner.insert(Item::Effect(effect));
        let index = (effect.raw() & 0xffff_ffff) as usize;
        let mut slots = self.owner.effect_slots.borrow_mut();
        if slots.len() <= index {
            slots.resize(index + 1, u32::MAX);
        }
        slots[index] = (key as u64 & 0xffff_ffff) as u32;
        drop(slots);
        self.due()?;
        Ok(key)
    }
    /// Register `scratch`, a Float64Array that effect runs write the keys of
    /// the signals they read into. Native code keeps its address and a
    /// reference; a larger array is registered the same way, replacing it.
    #[napi]
    pub fn set_scratch(&self, env: Env, scratch: Unknown<'_>) -> Result<()> {
        self.owner.check()?;
        let (mut kind, mut len, mut data, mut buffer, mut offset) =
            (0, 0, std::ptr::null_mut(), std::ptr::null_mut(), 0);
        let mut reference = std::ptr::null_mut();
        unsafe {
            check_status!(sys::napi_get_typedarray_info(
                env.raw(),
                scratch.raw(),
                &mut kind,
                &mut len,
                &mut data,
                &mut buffer,
                &mut offset,
            ))
            .map_err(|_| error("Expected a Float64Array"))?;
            if kind != sys::TypedarrayType::float64_array {
                return Err(error("Expected a Float64Array"));
            }
            let mut ordinary = false;
            check_status!(sys::napi_is_arraybuffer(env.raw(), buffer, &mut ordinary))?;
            if !ordinary {
                return Err(error("Shared scratch storage is not supported"));
            }
            check_status!(sys::napi_create_reference(
                env.raw(),
                scratch.raw(),
                1,
                &mut reference
            ))?;
        }
        let old = std::mem::replace(
            &mut *self.owner.scratch.borrow_mut(),
            Scratch {
                data: data.cast(),
                len,
                reference,
            },
        );
        if !old.reference.is_null() {
            unsafe { sys::napi_delete_reference(env.raw(), old.reference) };
        }
        Ok(())
    }
    /// Track the JavaScript run of effect `key`. False if it was released.
    #[napi]
    pub fn begin_effect(&self, key: f64) -> Result<bool> {
        self.owner.check()?;
        let Some(Some(effect)) = self.owner.slot(key, |item| match item {
            Item::Effect(e) => Some(*e),
            _ => None,
        }) else {
            return Ok(false);
        };
        let begun = self.owner.finish(self.owner.graph.begin_effect(effect))?;
        if begun {
            self.owner.runs.borrow_mut().push((key, effect));
        }
        Ok(begun)
    }
    /// Close effect `key`'s run, with the first `reads` keys of the scratch
    /// array as signals it read, beside those tracked natively (through
    /// computeds). Writes it made apply now, at the outermost run; returns
    /// how many due effects wait for `takeDue`.
    #[napi]
    pub fn end_effect(&self, key: f64, reads: u32) -> Result<u32> {
        if self.owner.graph.is_disposed() {
            return Ok(0);
        }
        self.owner.check()?;
        let open = self
            .owner
            .runs
            .borrow()
            .iter()
            .rposition(|&(k, _)| k == key);
        if let Some(at) = open {
            let effect = self.owner.runs.borrow()[at].1;
            // Runs opened inside this one and never closed close with it.
            self.owner.runs.borrow_mut().truncate(at);
            let mut raw = self.owner.reads.borrow_mut();
            raw.clear();
            {
                let scratch = self.owner.scratch.borrow();
                let count = (reads as usize).min(scratch.len);
                // SAFETY: the reference keeps the array alive, its storage is
                // not shared, and no JavaScript runs while it is read.
                let keys = if count == 0 {
                    &[][..]
                } else {
                    unsafe { std::slice::from_raw_parts(scratch.data, count) }
                };
                for &read in keys {
                    if let Ok(signal) = self.owner.signal(read) {
                        raw.push(signal.raw());
                    }
                }
            }
            self.owner
                .finish(self.owner.graph.end_effect_with_reads(effect, &raw))?;
        }
        if self.owner.holding() {
            return Ok(0);
        }
        self.due()
    }
    #[napi]
    pub fn track(&self, signal: f64) -> Result<()> {
        self.owner.check()?;
        let key = self.owner.signal(signal)?;
        self.owner.finish(self.owner.graph.track(key))
    }
    #[napi]
    pub fn peek(&self, signal: f64) -> Result<()> {
        self.owner.check()?;
        let key = self.owner.signal(signal)?;
        self.owner.finish(self.owner.graph.check_signal(key))
    }
    /// Write signal `key`; returns how many due tags wait for `takeDue`.
    #[napi]
    pub fn notify(&self, signal: f64) -> Result<u32> {
        self.owner.check()?;
        let key = self.owner.signal(signal)?;
        self.owner.finish(self.owner.graph.notify(key))?;
        if self.owner.holding() {
            return Ok(0);
        }
        self.due()
    }
    #[napi]
    pub fn track_computed(&self, computed: f64) -> Result<()> {
        self.owner.check()?;
        let key = self.owner.computed(computed)?;
        self.owner.finish(self.owner.graph.track_computed(key))
    }
    /// Dispose any item by key. Stale keys, and keys of a disposed context, are ignored.
    #[napi]
    pub fn release(&self, key: f64) -> Result<()> {
        if self.owner.graph.is_disposed() || self.owner.slot(key, |_| ()).is_none() {
            return Ok(());
        }
        self.owner.check()?;
        self.owner.graph.assert_mutable().map_err(error)?;
        let result = match self.owner.take(key) {
            Some(Item::Signal(s)) => self.owner.graph.remove_signal(s),
            Some(Item::Computed(c)) => self.owner.graph.remove_computed(c),
            Some(Item::Effect(e)) => self.owner.graph.remove_host_effect(e),
            Some(Item::Free) | None => Ok(()),
        };
        self.owner.finish(result)
    }
    #[napi]
    pub fn begin_batch(&self) -> Result<()> {
        self.owner.check()?;
        self.owner.finish(self.owner.graph.begin_batch())?;
        self.owner.batches.set(self.owner.batches.get() + 1);
        Ok(())
    }
    /// Returns how many due tags wait for `takeDue`.
    #[napi]
    pub fn end_batch(&self) -> Result<u32> {
        self.owner.check()?;
        self.owner
            .batches
            .set(self.owner.batches.get().saturating_sub(1));
        self.owner.finish(self.owner.graph.end_batch())?;
        if self.owner.holding() {
            return Ok(0);
        }
        self.due()
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
        if self.owner.dispatch.thread != std::thread::current().id() {
            return Err(error("Reactive context must run on its owning thread"));
        }
        if !self.owner.graph.is_disposed() {
            self.owner.graph.assert_mutable().map_err(error)?;
        }
        self.owner.graph.dispose();
        self.owner.slots.borrow_mut().clear();
        self.owner.free.borrow_mut().clear();
        self.owner.due.borrow_mut().clear();
        self.owner.effect_slots.borrow_mut().clear();
        let scratch = std::mem::take(&mut *self.owner.scratch.borrow_mut());
        if !scratch.reference.is_null() {
            unsafe { sys::napi_delete_reference(self.owner.dispatch.env, scratch.reference) };
        }
        self.owner.runs.borrow_mut().clear();
        self.owner.batches.set(0);
        self.owner.dispatch.errors.borrow_mut().clear();
        Ok(())
    }
}
