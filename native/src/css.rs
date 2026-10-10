//! CSS on a layout context, run by blinc_abi's engine: stylesheets from
//! compiled bytes or text, the theme's variables and the media environment,
//! each node's element (its names as atoms of the context's table) and
//! states, and a restyle that applies layout declarations through the
//! property router and hands paint and text declarations back to JavaScript.
use crate::layout::{NativeLayout, OwnedLayout};
use crate::motion::{Context as MotionContext, LayoutAnimation, Motion, Spec, Value, Write};
use blinc_abi::context::{LayoutContext, Node, PropValue};
use blinc_abi::css::cascade::{Element, SheetId, States};
use blinc_abi::css::layout::{Units, is_layout_property, layout_writes};
use blinc_abi::css::paint::is_paint_property;
use blinc_abi::css::quantity::PaintUnits;
use blinc_abi::css::styled::{Host, Styles};
use blinc_abi::css::{Atom, MediaEnvironment, Severity, compiled, parse};
use napi::bindgen_prelude::{Either, Uint8Array, Uint32Array};
use napi::{Error, Result, Status};
use napi_derive::napi;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

fn error(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

/// The cascade of one context, and what the host last received from it.
pub(crate) struct StyleState {
    pub(crate) styles: Styles,
    /// Sheets by the index JavaScript names them by; `None` once removed.
    sheets: Vec<Option<SheetId>>,
    /// Nodes described as elements.
    elements: HashSet<u64>,
    /// Each element's resolved declarations as last seen, to hand back only what changed.
    resolved: HashMap<u64, Vec<(Atom, String)>>,
    /// The declarations the host reads, as last handed to it.
    sent: HashMap<u64, Vec<(Atom, String)>>,
    /// Transitions and animations in flight.
    pub(crate) motion: Motion,
    /// Motion declarations read, by a hash of their text, which most elements share.
    specs: HashMap<u64, (Vec<(Atom, String)>, Arc<Spec>, Vec<String>)>,
    environment: MediaEnvironment,
    root_font_size: f64,
}
impl Default for StyleState {
    fn default() -> Self {
        let mut styles = Styles::new();
        styles.set_paint_output(true);
        Self {
            styles,
            sheets: Vec::new(),
            elements: HashSet::new(),
            resolved: HashMap::new(),
            sent: HashMap::new(),
            motion: Motion::default(),
            specs: HashMap::new(),
            environment: MediaEnvironment {
                width: 0.0,
                height: 0.0,
                dark: false,
            },
            root_font_size: 16.0,
        }
    }
}
impl StyleState {
    /// What relative lengths written directly (not through a sheet) are relative to.
    pub(crate) fn units(&self) -> Units {
        Units {
            font_size: self.root_font_size,
            root_font_size: self.root_font_size,
            viewport_width: self.environment.width,
            viewport_height: self.environment.height,
        }
    }
    pub(crate) fn set_element(&mut self, node: Node, element: Element) {
        self.elements.insert(node.raw());
        self.styles.set_element(node, element);
    }
    pub(crate) fn set_states(&mut self, node: Node, states: u32) {
        self.styles.set_states(node, States(states));
    }
}

/// The tree as a restyle writes layout to it, with the layout writes of
/// nodes whose motion moves layout held back for it.
struct Restyling<'a> {
    tree: &'a mut LayoutContext,
    motion: &'a Motion,
    held: &'a mut HashMap<u64, Vec<Write>>,
}

impl Host for Restyling<'_> {
    fn live(&self, node: u64) -> bool {
        Host::live(&*self.tree, node)
    }
    fn parent(&self, node: u64) -> Option<u64> {
        Host::parent(&*self.tree, node)
    }
    fn children(&self, node: u64) -> Vec<u64> {
        Host::children(&*self.tree, node)
    }
    fn apply_layout(
        &mut self,
        node: u64,
        writes: &[(i32, PropValue<'_>)],
    ) -> std::result::Result<(), &'static str> {
        if !self.motion.moves_layout(node) {
            return Host::apply_layout(&mut *self.tree, node, writes);
        }
        self.held.entry(node).or_default().extend(
            writes
                .iter()
                .map(|(id, value)| Write::Layout(*id, Value::of(value))),
        );
        Ok(())
    }
    fn context(&self) -> Option<u64> {
        Host::context(&*self.tree)
    }
}

/// What applying motion's writes to a node touched.
#[derive(Default)]
struct Applied {
    paint: bool,
    layout: bool,
}

/// Motion's writes for `node`: paint to its properties, layout through the property router.
fn apply_writes(
    tree: &mut LayoutContext,
    node: Node,
    writes: Vec<Write>,
) -> std::result::Result<Applied, String> {
    let mut paint = Vec::with_capacity(writes.len());
    let mut layout = Vec::new();
    for write in writes {
        match write {
            Write::Paint(p) => paint.push(p),
            Write::Layout(id, value) => layout.push((id, value)),
            Write::Visual(visual) => tree
                .set_visual(node, visual)
                .map_err(|e| format!("visual: {e}"))?,
        }
    }
    if !paint.is_empty() {
        crate::scene::apply_paint(tree, node, &paint).map_err(|e| format!("paint: {e}"))?;
    }
    if !layout.is_empty() {
        let staged: Vec<_> = layout.iter().map(|(id, v)| (node, *id, v.prop())).collect();
        tree.apply(&staged).map_err(|e| format!("layout: {e}"))?;
    }
    Ok(Applied {
        paint: !paint.is_empty(),
        layout: !layout.is_empty(),
    })
}

/// What motion reads for `node`: keyframes, the node's computed values and its units.
fn motion_context<'a>(
    styles: &'a Styles,
    node: Node,
    root_font_size: f64,
    environment: &MediaEnvironment,
) -> MotionContext<'a> {
    let computed = styles.computed(node);
    MotionContext {
        cascade: styles.cascade(),
        units: PaintUnits {
            font_size: computed.map_or(root_font_size, |c| c.font_size),
            root_font_size,
            viewport_width: environment.width,
            viewport_height: environment.height,
            color: None,
            declared: &[],
        },
        values: computed.map_or(&[], |c| c.values.as_slice()),
    }
}

/// Tree edits that also tell the cascade what moved: a child under a new
/// parent is `moved`, and a parent that gained, lost or reordered children
/// has its children changed, so the cascade matches again only what that
/// can reach.
pub(crate) fn insert(
    tree: &mut LayoutContext,
    styles: &mut StyleState,
    parent: Node,
    child: Node,
    before: Option<Node>,
) -> std::result::Result<(), &'static str> {
    let old = tree.parent(child)?;
    tree.insert_before(parent, child, before)?;
    if old != Some(parent) {
        styles.styles.moved(child);
        if let Some(old) = old {
            styles.styles.children_changed(old);
        }
    }
    styles.styles.children_changed(parent);
    Ok(())
}
pub(crate) fn detach(
    tree: &mut LayoutContext,
    styles: &mut StyleState,
    node: Node,
) -> std::result::Result<(), &'static str> {
    let parent = tree.parent(node)?;
    tree.detach(node)?;
    // Placed again later, it is moved then.
    if let Some(parent) = parent {
        styles.styles.children_changed(parent);
    }
    Ok(())
}
pub(crate) fn remove(
    tree: &mut LayoutContext,
    styles: &mut StyleState,
    node: Node,
) -> std::result::Result<(), &'static str> {
    let parent = tree.parent(node)?;
    let mut subtree = vec![node];
    let mut i = 0;
    while i < subtree.len() {
        subtree.extend(tree.children(subtree[i])?);
        i += 1;
    }
    tree.remove(node)?;
    for n in subtree {
        styles.styles.forget(n);
        styles.elements.remove(&n.raw());
        styles.resolved.remove(&n.raw());
        styles.sent.remove(&n.raw());
        styles.motion.forget(n.raw());
    }
    if let Some(parent) = parent {
        styles.styles.children_changed(parent);
    }
    Ok(())
}
pub(crate) fn set_children(
    tree: &mut LayoutContext,
    styles: &mut StyleState,
    parent: Node,
    children: &[Node],
) -> std::result::Result<(), &'static str> {
    let mut arrived = Vec::new();
    for &child in children {
        let p = tree.parent(child)?;
        if p != Some(parent) {
            arrived.push((child, p));
        }
    }
    tree.set_children(parent, children)?;
    for (child, old) in arrived {
        styles.styles.moved(child);
        if let Some(old) = old {
            styles.styles.children_changed(old);
        }
    }
    styles.styles.children_changed(parent);
    Ok(())
}

/// A CSS layout declaration written straight to a node, through the same
/// parser a sheet's declarations go through. `None` unsets it.
pub(crate) fn write_layout(
    tree: &mut LayoutContext,
    styles: &StyleState,
    node: Node,
    name: &str,
    value: Option<&str>,
) -> std::result::Result<(), String> {
    match layout_writes(name, value, &styles.units()) {
        Some(Ok(writes)) => {
            let staged: Vec<_> = writes.into_iter().map(|(id, v)| (node, id, v)).collect();
            tree.apply(&staged).map_err(String::from)
        }
        Some(Err(e)) => Err(e),
        None => Err(format!("{name} is not a layout property")),
    }
}

#[napi(object)]
pub struct NativeDiagnostic {
    /// "error" or "warning".
    pub severity: String,
    pub message: String,
    pub line: u32,
    pub column: u32,
    pub file: Option<String>,
}

#[napi(object)]
pub struct NativeSheet {
    pub id: u32,
    pub diagnostics: Vec<NativeDiagnostic>,
}

#[napi(object)]
pub struct NativeRestyle {
    /// Declarations that could not be applied, as `property: value: reason`.
    pub errors: Vec<String>,
    /// How many nodes the restyle matched again.
    pub restyled: u32,
    /// Nodes whose paint was written natively: raw ids, low then high word.
    pub painted: Uint32Array,
    /// Nodes whose text and other host-read declarations changed: raw ids, low then high word.
    pub nodes: Uint32Array,
    /// How many declarations each of `nodes` has now, in `names` and `values`.
    pub counts: Uint32Array,
    pub names: Vec<String>,
    pub values: Vec<String>,
    /// Whether a transition or animation needs a tick now.
    pub motion: bool,
}

/// How a node's layout changes animate: its place, its size, over what time and curve.
#[napi(object)]
pub struct NativeLayoutAnimation {
    pub position: bool,
    pub size: bool,
    /// Milliseconds; a spring takes its own.
    pub duration: f64,
    /// A CSS `<easing-function>`.
    pub easing: String,
}

#[napi(object)]
pub struct NativeMotionTick {
    /// Whether a transition or animation is still running, in view or not.
    pub active: bool,
    /// Whether one in view needs another frame.
    pub drawing: bool,
    /// Milliseconds until the first one out of view ends, when nothing in view runs.
    pub wake: Option<f64>,
    /// Whether it moved layout, which must be computed again before drawing.
    pub layout: bool,
    /// Nodes whose last transition or animation ended: raw ids, low then high word.
    pub finished: Uint32Array,
    pub errors: Vec<String>,
}

fn diagnostics(sheet: &blinc_abi::css::Stylesheet) -> Vec<NativeDiagnostic> {
    sheet
        .diagnostics
        .iter()
        .map(|d| NativeDiagnostic {
            severity: match d.severity {
                Severity::Error => "error",
                Severity::Warning => "warning",
            }
            .into(),
            message: d.message.clone(),
            line: d.line,
            column: d.column,
            file: d.file.clone(),
        })
        .collect()
}

/// Parse `source` (text) as the build step does, without loading imports:
/// the compiled bytes, the diagnostics and the names the sheet defines.
#[napi(object)]
pub struct NativeCompiled {
    pub bytes: Uint8Array,
    pub diagnostics: Vec<NativeDiagnostic>,
    pub classes: Vec<String>,
    pub variables: Vec<String>,
    pub keyframes: Vec<String>,
}

/// Compile a stylesheet. `load` resolves an `@import` (its path and the
/// importing file) to its text and file name, or nothing.
#[napi]
pub fn compile_css(
    source: String,
    file: Option<String>,
    load: Option<napi::bindgen_prelude::Function<(String, Option<String>), Option<Vec<String>>>>,
) -> Result<NativeCompiled> {
    let mut loader = |path: &str, from: Option<&str>| -> Option<(String, String)> {
        let load = load.as_ref()?;
        let found = load
            .call((path.to_string(), from.map(str::to_string)))
            .ok()??;
        match found.as_slice() {
            [text, name] => Some((text.clone(), name.clone())),
            _ => None,
        }
    };
    let sheet = parse(&source, file.as_deref(), &mut loader);
    let variables = sheet
        .variables
        .iter()
        .map(|(name, _)| sheet.str(*name).to_string())
        .collect();
    let keyframes = sheet
        .keyframes
        .iter()
        .map(|k| sheet.str(k.name).to_string())
        .collect();
    Ok(NativeCompiled {
        bytes: Uint8Array::new(compiled::encode(&sheet)),
        diagnostics: diagnostics(&sheet),
        classes: sheet.class_names(),
        variables,
        keyframes,
    })
}

/// The state pseudo-classes, in the order of their bits in an element's states.
#[napi]
pub fn css_states() -> Vec<String> {
    blinc_abi::css::STATES
        .iter()
        .map(|s| s.to_string())
        .collect()
}

/// Layout declarations the host also reads: which elements scroll.
const HOST_READS: &[&str] = &["overflow", "overflow-x", "overflow-y"];

/// Whether `name` is a property the layout router writes.
#[napi]
pub fn css_is_layout_property(name: String) -> bool {
    is_layout_property(&name)
}

/// Whether `name` is a property the paint router writes.
#[napi]
pub fn css_is_paint_property(name: String) -> bool {
    is_paint_property(&name)
}

/// A CSS colour as red, green, blue and alpha, 0 to 1, read as a sheet reads it; none when it is not one.
#[napi]
pub fn css_parse_color(text: String) -> Option<Vec<f64>> {
    let c = blinc_abi::css::color::parse(&text, None).ok()?;
    Some(vec![c.r as f64, c.g as f64, c.b as f64, c.a as f64])
}

#[napi]
impl NativeLayout {
    /// Add a sheet from compiled bytes or CSS text, last or at position `at`.
    #[napi]
    pub fn css_add_sheet(
        &self,
        source: Either<Uint8Array, String>,
        file: Option<String>,
        at: Option<u32>,
    ) -> Result<NativeSheet> {
        self.owner.check()?;
        let sheet = match source {
            Either::A(bytes) => compiled::decode(&bytes).map_err(error)?,
            Either::B(text) => parse(&text, file.as_deref(), &mut |_, _| None),
        };
        let report = diagnostics(&sheet);
        let mut state = self.owner.styles.borrow_mut();
        let cascade = state.styles.cascade_mut();
        let sheet_id = match at {
            Some(at) => cascade.insert(at as usize, sheet),
            None => cascade.push(sheet),
        };
        state.sheets.push(Some(sheet_id));
        Ok(NativeSheet {
            id: (state.sheets.len() - 1) as u32,
            diagnostics: report,
        })
    }
    /// Remove a sheet added before; false if it was removed already.
    #[napi]
    pub fn css_remove_sheet(&self, id: u32) -> Result<bool> {
        self.owner.check()?;
        let mut state = self.owner.styles.borrow_mut();
        let Some(sheet) = state.sheets.get_mut(id as usize).and_then(Option::take) else {
            return Ok(false);
        };
        Ok(state.styles.cascade_mut().remove(sheet))
    }
    /// The theme's variables, by name without the leading `--`, which `var()` reads after the sheets'.
    #[napi]
    pub fn css_set_theme(&self, names: Vec<String>, values: Vec<String>) -> Result<()> {
        self.owner.check()?;
        if names.len() != values.len() {
            return Err(error("Theme names and values differ in length"));
        }
        let vars: Vec<(&str, &str)> = names
            .iter()
            .map(String::as_str)
            .zip(values.iter().map(String::as_str))
            .collect();
        self.owner
            .styles
            .borrow_mut()
            .styles
            .cascade_mut()
            .set_theme(&vars);
        self.owner.styles.borrow_mut().motion.theme_changed();
        Ok(())
    }
    /// The viewport media queries and viewport units read, and the color scheme.
    #[napi]
    pub fn css_set_environment(&self, width: f64, height: f64, dark: bool) -> Result<()> {
        self.owner.check()?;
        let mut state = self.owner.styles.borrow_mut();
        let env = MediaEnvironment {
            width: crate::scene::positive(width)? as f64,
            height: crate::scene::positive(height)? as f64,
            dark,
        };
        if (env.width, env.height, env.dark)
            != (
                state.environment.width,
                state.environment.height,
                state.environment.dark,
            )
        {
            state.environment = env;
            state.styles.set_environment(env);
        }
        Ok(())
    }
    #[napi]
    pub fn css_set_root_font_size(&self, px: f64) -> Result<()> {
        self.owner.check()?;
        let px = crate::scene::positive(px)? as f64;
        let mut state = self.owner.styles.borrow_mut();
        state.root_font_size = px;
        state.styles.cascade_mut().set_root_font_size(px);
        Ok(())
    }
    /// Have `node`'s paint written again by the next restyle.
    #[napi]
    pub fn css_repaint(&self, node: &crate::layout::NativeLayoutNode) -> Result<()> {
        self.owner.check()?;
        self.owner.styles.borrow_mut().styles.repaint(node.node);
        Ok(())
    }
    /// Atoms of the context's table for `names`, in order.
    #[napi]
    pub fn css_intern(&self, names: Vec<String>) -> Result<Uint32Array> {
        self.owner.check()?;
        let mut state = self.owner.styles.borrow_mut();
        Ok(Uint32Array::new(
            names.iter().map(|n| state.styles.intern(n).0).collect(),
        ))
    }
    /// Match what changed under `root` and apply its layout declarations;
    /// return the paint and text declarations of every node whose changed,
    /// with its overflow, which the host reads to know what scrolls.
    #[napi]
    pub fn css_restyle(&self, root: &crate::layout::NativeLayoutNode) -> Result<NativeRestyle> {
        self.owner.check()?;
        let mut tree = self.owner.tree.borrow_mut();
        let mut state = self.owner.styles.borrow_mut();
        let state = &mut *state;
        let mut held = HashMap::new();
        state.motion.view_changed();
        let mut errors = state.styles.restyle_host(
            &mut Restyling {
                tree: &mut tree,
                motion: &state.motion,
                held: &mut held,
            },
            root.node,
        );
        let (mut nodes, mut counts, mut names, mut values) =
            (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        let mut specs: HashMap<u64, (Arc<Spec>, bool)> = HashMap::new();
        let mut problems = Vec::new();
        for &raw in &state.elements {
            let Ok(node) = tree.node(raw) else { continue };
            let Some(computed) = state.styles.computed(node) else {
                continue;
            };
            // Compared as atoms and text, without building strings, since most did not change.
            if state.resolved.get(&raw).map(Vec::as_slice) == Some(computed.resolved.as_slice()) {
                continue;
            }
            // A node restyled for the first time has all its paint written, not only a change.
            let first = state
                .resolved
                .insert(raw, computed.resolved.clone())
                .is_none();
            let cascade = state.styles.cascade();
            let motion = |k: &Atom| {
                let name = cascade.str(*k);
                name.starts_with("transition") || name.starts_with("animation")
            };
            if state.motion.has(raw) || computed.resolved.iter().any(|(k, _)| motion(k)) {
                let declared = || computed.resolved.iter().filter(|(k, _)| motion(k));
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                for (k, v) in declared() {
                    std::hash::Hash::hash(&k.0, &mut hasher);
                    std::hash::Hash::hash(v, &mut hasher);
                }
                let key = std::hash::Hasher::finish(&hasher);
                let hit = state
                    .specs
                    .get(&key)
                    .filter(|(text, ..)| text.iter().eq(declared()));
                let spec = match hit {
                    Some((_, spec, found)) => {
                        problems.extend(found.iter().cloned());
                        spec.clone()
                    }
                    None => {
                        let (spec, found) =
                            Spec::read(declared().map(|(k, v)| (cascade.str(*k), v.as_str())));
                        let spec = Arc::new(spec);
                        problems.extend(found.iter().cloned());
                        if state.specs.len() >= 4096 {
                            state.specs.clear();
                        }
                        state
                            .specs
                            .insert(key, (declared().cloned().collect(), spec.clone(), found));
                        spec
                    }
                };
                specs.insert(raw, (spec, first));
            }
            // What the host still reads: text and the like, not what was applied here.
            let host: Vec<(Atom, String)> = computed
                .resolved
                .iter()
                .filter(|(k, _)| {
                    let name = cascade.str(*k);
                    (!is_layout_property(name) && !is_paint_property(name))
                        || HOST_READS.contains(&name)
                })
                .cloned()
                .collect();
            if state.sent.get(&raw).map(Vec::as_slice).unwrap_or(&[]) == host.as_slice() {
                continue;
            }
            let mut count = 0;
            for (k, v) in &host {
                names.push(cascade.str(*k).to_string());
                values.push(v.clone());
                count += 1;
            }
            state.sent.insert(raw, host);
            nodes.extend([(raw & 0xffff_ffff) as u32, (raw >> 32) as u32]);
            counts.push(count);
        }
        errors.extend(state.motion.unreported(problems));
        // A node's paint, and the layout held back, go through motion, which applies them now
        // or later; so does a changed transition or animation on a node whose paint did not change.
        let mut jobs: Vec<(Node, Option<(Arc<Spec>, bool)>, Vec<Write>)> = state
            .styles
            .take_paint()
            .into_iter()
            .map(|(node, writes)| {
                let spec = specs.remove(&node.raw());
                let mut writes: Vec<Write> = writes.into_iter().map(Write::Paint).collect();
                writes.extend(held.remove(&node.raw()).unwrap_or_default());
                (node, spec, writes)
            })
            .collect();
        for (raw, writes) in held {
            if let Ok(node) = tree.node(raw) {
                jobs.push((node, specs.remove(&raw), writes));
            }
        }
        for (raw, spec) in specs {
            if let Ok(node) = tree.node(raw) {
                jobs.push((node, Some(spec), Vec::new()));
            }
        }
        let mut painted = Vec::new();
        for (node, spec, writes) in jobs {
            let context = motion_context(
                &state.styles,
                node,
                state.root_font_size,
                &state.environment,
            );
            let mut problems = Vec::new();
            let (spec, complete) = match spec {
                Some((spec, complete)) => (Some(spec), complete),
                None => (None, true),
            };
            let writes =
                state
                    .motion
                    .restyle(node.raw(), spec, writes, complete, &context, &mut problems);
            errors.extend(state.motion.unreported(problems));
            if writes.is_empty() {
                continue;
            }
            match apply_writes(&mut tree, node, writes) {
                Ok(applied) if applied.paint => {
                    painted.extend([(node.raw() & 0xffff_ffff) as u32, (node.raw() >> 32) as u32])
                }
                Ok(_) => {}
                Err(e) => errors.push(e),
            }
        }
        for raw in state.motion.take_rethemed() {
            let Ok(node) = tree.node(raw) else { continue };
            let context = motion_context(
                &state.styles,
                node,
                state.root_font_size,
                &state.environment,
            );
            let mut problems = Vec::new();
            state.motion.reread(raw, &context, &mut problems);
            errors.extend(state.motion.unreported(problems));
        }
        // A node new to motion whose values motion has not all seen: have the cascade write
        // its paint and layout again, which only motion reads.
        let unbased = state.motion.take_unbased();
        if !unbased.is_empty() {
            for &raw in &unbased {
                if let Ok(node) = tree.node(raw) {
                    state.styles.repaint(node);
                }
            }
            let mut held = HashMap::new();
            let again = state.styles.restyle_host(
                &mut Restyling {
                    tree: &mut tree,
                    motion: &state.motion,
                    held: &mut held,
                },
                root.node,
            );
            for error in again {
                if !errors.contains(&error) {
                    errors.push(error);
                }
            }
            let mut repainted: HashMap<u64, Vec<Write>> = held;
            for (node, writes) in state.styles.take_paint() {
                repainted
                    .entry(node.raw())
                    .or_default()
                    .extend(writes.into_iter().map(Write::Paint));
            }
            // A node that declares no paint has none written, and is rebased all the same.
            for raw in unbased {
                let Ok(node) = tree.node(raw) else { continue };
                let writes = repainted.remove(&raw).unwrap_or_default();
                let context = motion_context(
                    &state.styles,
                    node,
                    state.root_font_size,
                    &state.environment,
                );
                let mut problems = Vec::new();
                state
                    .motion
                    .rebase(node.raw(), &writes, &context, &mut problems);
                errors.extend(state.motion.unreported(problems));
            }
        }
        Ok(NativeRestyle {
            errors,
            restyled: state.styles.last_restyled() as u32,
            painted: Uint32Array::new(painted),
            nodes: Uint32Array::new(nodes),
            counts: Uint32Array::new(counts),
            names,
            values,
            motion: state.motion.pending(),
        })
    }

    /// Sample every transition and animation at `now` milliseconds and write
    /// the values. Call it once a frame while it says it is active.
    #[napi]
    pub fn css_tick_motion(&self, now: f64) -> Result<NativeMotionTick> {
        self.owner.check()?;
        let mut tree = self.owner.tree.borrow_mut();
        let mut state = self.owner.styles.borrow_mut();
        let mut errors = Vec::new();
        let mut layout = false;
        let frame = {
            // One view for the frame, so nodes under the same ancestors share the walk to them.
            let tree = &*tree;
            let mut view = tree.view().map_err(error)?;
            state.motion.tick(now, |raw| {
                tree.node(raw).and_then(|n| view.in_view(n)).unwrap_or(true)
            })
        };
        for (raw, writes) in frame.writes {
            match tree.node(raw) {
                Ok(node) => match apply_writes(&mut tree, node, writes) {
                    Ok(applied) => layout |= applied.layout,
                    Err(e) => errors.push(format!("motion: {e}")),
                },
                Err(_) => state.motion.forget(raw),
            }
        }
        let finished = state
            .motion
            .take_finished()
            .into_iter()
            .flat_map(|raw| [(raw & 0xffff_ffff) as u32, (raw >> 32) as u32])
            .collect();
        Ok(NativeMotionTick {
            active: state.motion.active(),
            drawing: frame.drawing,
            wake: frame.wake,
            layout,
            finished: Uint32Array::new(finished),
            errors,
        })
    }

    /// Animate `node`'s layout changes, or stop with null; a move in flight
    /// stops where it is drawn and the node is drawn at its layout.
    #[napi]
    pub fn css_animate_layout(
        &self,
        node: &crate::layout::NativeLayoutNode,
        animation: Option<NativeLayoutAnimation>,
    ) -> Result<()> {
        self.owner.check()?;
        let animation = match animation {
            Some(a) => {
                let timing = crate::motion::parse_timing(&a.easing)
                    .ok_or_else(|| error(format!("\"{}\" is not a timing function", a.easing)))?;
                if !a.duration.is_finite() || a.duration < 0.0 {
                    return Err(error("A layout animation's duration is a time"));
                }
                Some(LayoutAnimation {
                    position: a.position,
                    size: a.size,
                    duration: a.duration,
                    timing,
                })
            }
            None => None,
        };
        let mut tree = self.owner.tree.borrow_mut();
        let mut state = self.owner.styles.borrow_mut();
        if state.motion.animate_layout(node.node.raw(), animation) {
            tree.set_visual(node.node, None).map_err(error)?;
        }
        Ok(())
    }

    /// How many transitions and animations of `node` have not ended.
    #[napi]
    pub fn css_motion_running(&self, node: &crate::layout::NativeLayoutNode) -> Result<u32> {
        self.owner.check()?;
        Ok(self.owner.styles.borrow().motion.running(node.node.raw()) as u32)
    }
}

/// An element read from the command buffer: names as atoms, as `cssIntern`
/// gave them; inline values as indexes into the batch's strings.
pub(crate) fn element(
    words: &mut impl FnMut() -> Result<u32>,
    strings: &[String],
) -> Result<Element> {
    let mut list = |words: &mut dyn FnMut() -> Result<u32>| -> Result<Vec<Atom>> {
        let n = words()?;
        (0..n).map(|_| words().map(Atom)).collect()
    };
    let types = list(words)?;
    let id = match words()? {
        u32::MAX => None,
        w => Some(Atom(w)),
    };
    let classes = list(words)?;
    let n = words()?;
    let attributes = (0..n)
        .map(|_| Ok((Atom(words()?), Atom(words()?))))
        .collect::<Result<Vec<_>>>()?;
    let n = words()?;
    let inline = (0..n)
        .map(|_| {
            let name = Atom(words()?);
            let value = strings
                .get(words()? as usize)
                .ok_or_else(|| error("Element names no string"))?;
            Ok((name, value.clone()))
        })
        .collect::<Result<Vec<_>>>()?;
    let anonymous = words()? != 0;
    Ok(Element {
        types,
        id,
        classes,
        attributes,
        inline,
        states: States::default(),
        anonymous,
    })
}

impl OwnedLayout {
    /// Atoms must name strings of this context's table.
    pub(crate) fn check_atoms(&self, element: &Element) -> Result<()> {
        let state = self.styles.borrow();
        let n = state.styles.cascade().atoms().len() as u32;
        let ok = element.types.iter().all(|a| a.0 < n)
            && element.id.is_none_or(|a| a.0 < n)
            && element.classes.iter().all(|a| a.0 < n)
            && element.attributes.iter().all(|(a, b)| a.0 < n && b.0 < n)
            && element.inline.iter().all(|(a, _)| a.0 < n);
        if ok {
            Ok(())
        } else {
            Err(error("Element names an atom this context does not have"))
        }
    }
}
