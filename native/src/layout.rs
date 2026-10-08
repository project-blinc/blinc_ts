use crate::layout_values::{LayoutAlign, LayoutDirection, LayoutJustify, LayoutOverflow};
use blinc_abi::context::{LayoutContext, Node};
use napi::bindgen_prelude::{ClassInstance, Either, Unknown};
use napi::{Env, Error, JsValue, Result, Status, sys};
use napi_derive::napi;
use std::{cell::RefCell, rc::Rc};
use taffy::{Point, prelude::*};

fn error(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}
fn finite(value: f64) -> Result<f32> {
    let value = value as f32;
    if !value.is_finite() || value < 0.0 {
        return Err(error("Layout values must be finite and non-negative"));
    }
    Ok(value)
}
fn dimension(value: Either<f64, String>) -> Result<LengthPercentageAuto> {
    match value {
        Either::A(value) => Ok(LengthPercentageAuto::length(finite(value)?)),
        Either::B(value) if value == "auto" => Ok(LengthPercentageAuto::auto()),
        Either::B(value) => {
            let percent = value
                .strip_suffix('%')
                .ok_or_else(|| error("Expected a number, percentage or auto"))?;
            let value: f64 = percent
                .parse()
                .map_err(|_| error("Invalid layout percentage"))?;
            Ok(LengthPercentageAuto::percent(finite(value / 100.0)?))
        }
    }
}

#[napi(object)]
pub struct LayoutStyle {
    pub width: Option<Either<f64, String>>,
    pub height: Option<Either<f64, String>>,
    pub min_width: Option<Either<f64, String>>,
    pub min_height: Option<Either<f64, String>>,
    pub max_width: Option<Either<f64, String>>,
    pub max_height: Option<Either<f64, String>>,
    pub direction: Option<LayoutDirection>,
    pub align: Option<LayoutAlign>,
    pub justify: Option<LayoutJustify>,
    pub grow: Option<f64>,
    pub shrink: Option<f64>,
    pub gap: Option<f64>,
    pub padding: Option<f64>,
    pub overflow: Option<LayoutOverflow>,
}
impl LayoutStyle {
    fn apply(self, mut style: Style) -> Result<Style> {
        if let Some(v) = self.width {
            style.size.width = dimension(v)?.into();
        }
        if let Some(v) = self.height {
            style.size.height = dimension(v)?.into();
        }
        if let Some(v) = self.min_width {
            style.min_size.width = dimension(v)?;
        }
        if let Some(v) = self.min_height {
            style.min_size.height = dimension(v)?;
        }
        if let Some(v) = self.max_width {
            style.max_size.width = dimension(v)?;
        }
        if let Some(v) = self.max_height {
            style.max_size.height = dimension(v)?;
        }
        if let Some(v) = self.direction {
            style.flex_direction = v.into();
        }
        if let Some(v) = self.align {
            style.align_items = Some(v.into());
        }
        if let Some(v) = self.justify {
            style.justify_content = Some(v.into());
        }
        if let Some(v) = self.grow {
            style.flex_grow = finite(v)?;
        }
        if let Some(v) = self.shrink {
            style.flex_shrink = finite(v)?;
        }
        if let Some(v) = self.gap {
            let v = LengthPercentage::length(finite(v)?);
            style.gap = Size {
                width: v,
                height: v,
            };
        }
        if let Some(v) = self.padding {
            let v = LengthPercentage::length(finite(v)?);
            style.padding = Rect {
                left: v,
                right: v,
                top: v,
                bottom: v,
            };
        }
        if let Some(value) = self.overflow {
            let value = value.into();
            style.overflow = Point { x: value, y: value };
        }
        Ok(style)
    }
}

struct OwnedLayout {
    tree: RefCell<LayoutContext>,
    thread: std::thread::ThreadId,
}
impl OwnedLayout {
    fn check(&self) -> Result<()> {
        if self.thread != std::thread::current().id() {
            return Err(error("Layout must be used on its owning thread"));
        }
        Ok(())
    }
}

#[napi]
pub struct NativeLayout {
    owner: Rc<OwnedLayout>,
}
#[napi]
pub struct NativeLayoutNode {
    owner: Rc<OwnedLayout>,
    node: Node,
}

#[napi]
impl NativeLayout {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            owner: Rc::new(OwnedLayout {
                tree: RefCell::new(LayoutContext::new()),
                thread: std::thread::current().id(),
            }),
        }
    }
    #[napi]
    pub fn create_node(&self, style: LayoutStyle) -> Result<NativeLayoutNode> {
        self.owner.check()?;
        let style = style.apply(Style::default())?;
        let node = self
            .owner
            .tree
            .borrow_mut()
            .create_node(style)
            .map_err(error)?;
        Ok(NativeLayoutNode {
            owner: self.owner.clone(),
            node,
        })
    }
    #[napi]
    pub fn compute(&self, root: &NativeLayoutNode, width: f64, height: f64) -> Result<()> {
        self.owner.check()?;
        self.owner
            .tree
            .borrow_mut()
            .compute(root.node, finite(width)?, finite(height)?)
            .map_err(error)
    }
    #[napi]
    pub fn read_bounds(
        &self,
        env: Env,
        nodes: Vec<ClassInstance<NativeLayoutNode>>,
        target: Unknown<'_>,
    ) -> Result<()> {
        self.owner.check()?;
        let nodes: Vec<_> = nodes.iter().map(|node| node.node).collect();
        // No JavaScript callbacks occur after validating this view. Its backing
        // store is borrowed only for this synchronous native call.
        unsafe {
            let mut kind = 0;
            let mut len = 0;
            let mut data = std::ptr::null_mut();
            let mut buffer = std::ptr::null_mut();
            let mut offset = 0;
            let status = sys::napi_get_typedarray_info(
                env.raw(),
                target.raw(),
                &mut kind,
                &mut len,
                &mut data,
                &mut buffer,
                &mut offset,
            );
            if status != sys::Status::napi_ok || kind != sys::TypedarrayType::float32_array {
                return Err(error("Layout output must be a Float32Array"));
            }
            let mut is_arraybuffer = false;
            let status = sys::napi_is_arraybuffer(env.raw(), buffer, &mut is_arraybuffer);
            if status != sys::Status::napi_ok || !is_arraybuffer {
                return Err(error("Shared layout output is not supported"));
            }
            let mut detached = false;
            let status = sys::napi_is_detached_arraybuffer(env.raw(), buffer, &mut detached);
            if status != sys::Status::napi_ok || detached {
                return Err(error("Detached layout output"));
            }
            if len > 0 && data.is_null() {
                return Err(error("Invalid layout output"));
            }
            let output = if len == 0 {
                &mut []
            } else {
                std::slice::from_raw_parts_mut(data.cast::<f32>(), len)
            };
            self.owner
                .tree
                .borrow()
                .read_bounds(&nodes, output)
                .map_err(error)
        }
    }
    #[napi(getter)]
    pub fn size(&self) -> Result<u32> {
        self.owner.check()?;
        Ok(self.owner.tree.borrow().len().map_err(error)? as u32)
    }
    #[napi(getter)]
    pub fn disposed(&self) -> Result<bool> {
        self.owner.check()?;
        Ok(self.owner.tree.borrow().is_disposed())
    }
    #[napi]
    pub fn dispose(&self) -> Result<()> {
        self.owner.check()?;
        self.owner.tree.borrow_mut().dispose();
        Ok(())
    }
}
#[napi]
impl NativeLayoutNode {
    #[napi]
    pub fn set_style(&self, patch: LayoutStyle) -> Result<()> {
        self.owner.check()?;
        let mut tree = self.owner.tree.borrow_mut();
        let style = patch.apply(tree.style(self.node).map_err(error)?)?;
        tree.set_style(self.node, style).map_err(error)
    }
    #[napi]
    pub fn set_children(&self, children: Vec<ClassInstance<NativeLayoutNode>>) -> Result<()> {
        self.owner.check()?;
        let children: Vec<_> = children.iter().map(|child| child.node).collect();
        self.owner
            .tree
            .borrow_mut()
            .set_children(self.node, &children)
            .map_err(error)
    }
    #[napi]
    pub fn remove(&self) -> Result<()> {
        self.owner.check()?;
        self.owner
            .tree
            .borrow_mut()
            .remove(self.node)
            .map_err(error)
    }
}
