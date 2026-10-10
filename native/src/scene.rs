use crate::brush::NativeBrush;
use crate::{
    buffers,
    layout::{LayoutStyle, NativeLayout, NativeLayoutNode},
    scene_values::ImageFit,
};
use blinc_abi::css::paint::{Background, PaintWrite};
use blinc_abi::css::transform::IDENTITY;
use blinc_abi::{
    bitmap::Bitmap,
    display_list::{RECORD_FLOATS, Shapes},
    scene::{self, PaintOptions, SceneEncoder, TextMeasureContext},
};
use napi::bindgen_prelude::{BigInt, ClassInstance};
use napi::{Env, Error, Result, Status, Unknown};
use napi_derive::napi;
use scene::blinc_core::{
    Color, CornerRadius, Transform,
    layer::{Affine2D, CornerShape, Shadow},
};
use std::cell::RefCell;
fn error(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}
pub(crate) fn number(value: f64) -> Result<f32> {
    let v = value as f32;
    if v.is_finite() {
        Ok(v)
    } else {
        Err(error("Expected a finite number"))
    }
}
fn integer(value: f64, min: f64, max: f64) -> Result<f64> {
    if value.fract() != 0.0 || !(min..=max).contains(&value) {
        return Err(error("Expected an integer in range"));
    }
    Ok(value)
}
pub(crate) fn positive(value: f64) -> Result<f32> {
    let v = number(value)?;
    if v >= 0.0 {
        Ok(v)
    } else {
        Err(error("Expected a non-negative value"))
    }
}
pub(crate) fn unit(value: f64) -> Result<f32> {
    let v = number(value)?;
    if (0.0..=1.0).contains(&v) {
        Ok(v)
    } else {
        Err(error("Expected a value between 0 and 1"))
    }
}
pub(crate) fn rgba(value: Vec<f64>) -> Result<[f32; 4]> {
    if value.len() != 4 {
        return Err(error("Expected four color channels"));
    }
    Ok([
        unit(value[0])?,
        unit(value[1])?,
        unit(value[2])?,
        unit(value[3])?,
    ])
}
pub(crate) fn color(value: Vec<f64>) -> Result<Color> {
    let [r, g, b, a] = rgba(value)?;
    Ok(Color { r, g, b, a })
}
#[napi(object)]
pub struct NativeSceneSchema {
    pub version: u32,
    pub record_floats: u32,
    pub record_rows: u32,
}
#[napi]
pub fn scene_schema() -> NativeSceneSchema {
    NativeSceneSchema {
        version: scene::DISPLAY_LIST_VERSION,
        record_floats: RECORD_FLOATS as u32,
        record_rows: (RECORD_FLOATS / 4) as u32,
    }
}
#[napi(object)]
pub struct NativePaintOptions {
    pub scale: Option<f64>,
    pub corner_shape: Option<f64>,
    pub smoothing_threshold: Option<f64>,
    pub full_radius: Option<f64>,
    pub text_color: Option<Vec<f64>>,
}
impl NativePaintOptions {
    fn into_options(self) -> Result<PaintOptions> {
        Ok(PaintOptions {
            scale: number(self.scale.unwrap_or(1.0))?,
            shapes: Shapes {
                n: positive(self.corner_shape.unwrap_or(0.0))?,
                threshold: positive(self.smoothing_threshold.unwrap_or(0.0))?,
                radius_full: positive(self.full_radius.unwrap_or(9999.0))?,
            },
            text_color: match self.text_color {
                Some(v) => rgba(v)?,
                None => [0.0, 0.0, 0.0, 1.0],
            },
        })
    }
}
#[napi(object)]
pub struct NativePaintInfo {
    pub count: u32,
    pub floats: u32,
}
#[napi(object)]
pub struct NativeAtlasInfo {
    pub width: u32,
    pub height: u32,
    pub revision: u32,
    pub x: u32,
    pub y: u32,
    pub update_width: u32,
    pub update_height: u32,
    pub bytes: u32,
}
impl From<scene::AtlasInfo> for NativeAtlasInfo {
    fn from(i: scene::AtlasInfo) -> Self {
        Self {
            width: i.width,
            height: i.height,
            revision: i.revision,
            x: i.x,
            y: i.y,
            update_width: i.update_width,
            update_height: i.update_height,
            bytes: i.bytes() as u32,
        }
    }
}
#[napi(object)]
pub struct NativeHit {
    pub node_id: BigInt,
    pub x: f64,
    pub y: f64,
}
#[napi(object)]
pub struct NativeHitRegion {
    pub hits: Vec<NativeHit>,
    pub bounds: Vec<f64>,
}
#[napi(object)]
pub struct TextStyle {
    pub font_size: Option<f64>,
    pub line_height: Option<f64>,
    pub letter_spacing: Option<f64>,
    pub wrap: Option<bool>,
    pub font_family: Option<String>,
    pub font_weight: Option<f64>,
    pub italic: Option<bool>,
}
impl TextStyle {
    pub(crate) fn apply(
        self,
        content: String,
        mut text: TextMeasureContext,
    ) -> Result<TextMeasureContext> {
        text.content = content;
        if let Some(v) = self.font_size {
            text.font_size = positive(v)?;
        }
        if let Some(v) = self.line_height {
            text.line_height = positive(v)?;
        }
        if let Some(v) = self.letter_spacing {
            text.letter_spacing = number(v)?;
        }
        if let Some(v) = self.wrap {
            text.wrap = v;
        }
        if let Some(v) = self.italic {
            text.italic = v;
        }
        if let Some(v) = self.font_weight {
            text.font_weight = integer(v, 1.0, 1000.0)? as u16;
        }
        if let Some(v) = self.font_family {
            (text.font_name, text.generic_font) = blinc_abi::text::resolve_family(&v);
        }
        Ok(text)
    }
}
pub(crate) fn default_text() -> TextMeasureContext {
    TextMeasureContext {
        content: String::new(),
        font_size: 16.0,
        line_height: 1.2,
        letter_spacing: 0.0,
        wrap: true,
        font_name: blinc_abi::text::system_ui(),
        generic_font: Default::default(),
        font_weight: 400,
        italic: false,
    }
}
#[napi(object)]
pub struct PaintShadow {
    pub x: f64,
    pub y: f64,
    pub blur: f64,
    pub spread: Option<f64>,
    pub color: Vec<f64>,
    pub inset: Option<bool>,
}
#[napi(object)]
pub struct PaintFilter {
    pub brightness: Option<f64>,
    pub contrast: Option<f64>,
    pub grayscale: Option<f64>,
    pub hue_rotate: Option<f64>,
    pub invert: Option<f64>,
    pub saturate: Option<f64>,
    pub sepia: Option<f64>,
    pub blur: Option<f64>,
    pub drop_shadow: Option<PaintShadow>,
}
impl PaintShadow {
    fn into_shadow(self) -> Result<Shadow> {
        Ok(Shadow {
            offset_x: number(self.x)?,
            offset_y: number(self.y)?,
            blur: positive(self.blur)?,
            spread: number(self.spread.unwrap_or(0.0))?,
            color: color(self.color)?,
        })
    }
}
#[napi(object)]
pub struct PaintStyle<'env> {
    pub background: Option<ClassInstance<'env, NativeBrush>>,
    pub text_color: Option<Vec<f64>>,
    pub radius: Option<Vec<f64>>,
    pub corner_shape: Option<Vec<f64>>,
    pub corner_shape_locked: Option<bool>,
    pub border_color: Option<Vec<f64>>,
    pub border_width: Option<f64>,
    pub opacity: Option<f64>,
    pub visible: Option<bool>,
    pub transform: Option<Vec<f64>>,
    pub shadows: Option<Vec<PaintShadow>>,
    pub z_index: Option<f64>,
    pub filter: Option<PaintFilter>,
    pub mask_image: Option<ClassInstance<'env, NativeBrush>>,
    pub clear_filter: Option<bool>,
    pub clear_mask: Option<bool>,
}
impl PaintStyle<'_> {
    pub(crate) fn apply(self, mut p: scene::RenderProps) -> Result<scene::RenderProps> {
        if let Some(v) = self.background {
            p.background = Some(match &v.style_value {
                blinc_abi::types::Value::Brush(brush) => brush.clone(),
                blinc_abi::types::Value::Glass(glass, _) => scene::blinc_core::Brush::Glass(*glass),
                _ => return Err(error("Expected a native brush value")),
            });
        }
        if let Some(v) = self.text_color {
            p.text_color = Some(rgba(v)?);
        }
        if let Some(v) = self.radius {
            if v.len() != 4 {
                return Err(error("Expected four corner radii"));
            }
            p.border_radius = CornerRadius::new(
                positive(v[0])?,
                positive(v[1])?,
                positive(v[2])?,
                positive(v[3])?,
            );
            p.border_radius_explicit = true;
        }
        if let Some(v) = self.corner_shape {
            if v.len() != 4 {
                return Err(error("Expected four corner shapes"));
            }
            p.corner_shape =
                CornerShape::new(number(v[0])?, number(v[1])?, number(v[2])?, number(v[3])?);
        }
        if let Some(v) = self.corner_shape_locked {
            p.corner_shape_locked = v;
        }
        if let Some(v) = self.border_color {
            p.border_color = Some(color(v)?);
        }
        if let Some(v) = self.border_width {
            p.border_width = positive(v)?;
        }
        if let Some(v) = self.opacity {
            p.opacity = unit(v)?;
        }
        if let Some(v) = self.visible {
            p.visible = v;
        }
        if let Some(v) = self.z_index {
            p.z_index = integer(v, i32::MIN as f64, i32::MAX as f64)? as i32;
        }
        if let Some(v) = self.transform {
            if v.len() != 6 {
                return Err(error("Expected six affine values"));
            }
            p.transform = Some(Transform::Affine2D(Affine2D {
                elements: [
                    number(v[0])?,
                    number(v[1])?,
                    number(v[2])?,
                    number(v[3])?,
                    number(v[4])?,
                    number(v[5])?,
                ],
            }));
        }
        // Outer and inset layers keep their CSS order within each list.
        if let Some(v) = self.shadows {
            let (mut outer, mut inner) = (Vec::new(), Vec::new());
            for layer in v {
                let inset = layer.inset == Some(true);
                let shadow = layer.into_shadow()?;
                if inset {
                    inner.push(shadow);
                } else {
                    outer.push(shadow);
                }
            }
            p.shadow = outer;
            p.inner_shadow = inner;
        }
        if self.clear_filter == Some(true) {
            p.filter = None;
        }
        if let Some(v) = self.filter {
            let filter = p.filter.get_or_insert_with(Default::default);
            filter.brightness = positive(v.brightness.unwrap_or(1.0))?;
            filter.contrast = positive(v.contrast.unwrap_or(1.0))?;
            filter.grayscale = unit(v.grayscale.unwrap_or(0.0))?;
            filter.hue_rotate = number(v.hue_rotate.unwrap_or(0.0))?;
            filter.invert = unit(v.invert.unwrap_or(0.0))?;
            filter.saturate = positive(v.saturate.unwrap_or(1.0))?;
            filter.sepia = unit(v.sepia.unwrap_or(0.0))?;
            filter.blur = positive(v.blur.unwrap_or(0.0))?;
            if v.drop_shadow
                .as_ref()
                .is_some_and(|d| d.inset == Some(true))
            {
                return Err(error("A drop shadow cannot be inset"));
            }
            filter.drop_shadow = v.drop_shadow.map(PaintShadow::into_shadow).transpose()?;
        }
        if self.clear_mask == Some(true) {
            p.mask_image = None;
        }
        if let Some(v) = self.mask_image {
            p.mask_image = Some(match &v.style_value {
                blinc_abi::types::Value::Brush(scene::blinc_core::Brush::Gradient(g)) => {
                    scene::blinc_core::MaskImage::Gradient(g.clone())
                }
                _ => return Err(error("Expected a linear or radial gradient mask")),
            });
        }
        Ok(p)
    }
}
/// A side colour that is not set: a NaN red, which painting reads as the shared border colour.
fn unset_side_color() -> Color {
    Color::rgba(f32::NAN, 0.0, 0.0, 0.0)
}

/// Apply the paint a restyle read from CSS to `node`: each write sets its
/// field of the node's properties, and a glass background its effects.
pub(crate) fn apply_paint(
    tree: &mut blinc_abi::context::LayoutContext,
    node: blinc_abi::context::Node,
    writes: &[PaintWrite],
) -> std::result::Result<(), &'static str> {
    let mut props = tree.properties(node)?;
    let mut glass = None;
    let mut even_odd = None;
    for write in writes {
        match write {
            PaintWrite::Background(background) => {
                props.background = Some(match background {
                    Background::None => {
                        scene::blinc_core::Brush::Solid(Color::rgba(0.0, 0.0, 0.0, 0.0))
                    }
                    Background::Solid(c) => scene::blinc_core::Brush::Solid(*c),
                    Background::Gradient(g) => scene::blinc_core::Brush::Gradient(g.clone()),
                    Background::Glass(style, _) => scene::blinc_core::Brush::Glass(*style),
                });
                glass = Some(match background {
                    Background::Glass(_, effects) => Some(*effects),
                    _ => None,
                });
            }
            PaintWrite::TextColor(c) => props.text_color = c.map(|c| [c.r, c.g, c.b, c.a]),
            PaintWrite::Opacity(o) => props.opacity = *o,
            PaintWrite::Visible(v) => props.visible = *v,
            PaintWrite::BorderRadius([a, b, c, d]) => {
                props.border_radius = CornerRadius::new(*a, *b, *c, *d);
                props.border_radius_explicit = true;
            }
            PaintWrite::CornerShape {
                shapes: [a, b, c, d],
                locked,
            } => {
                props.corner_shape = CornerShape::new(*a, *b, *c, *d);
                props.corner_shape_locked = *locked;
            }
            PaintWrite::BorderColor(c) => {
                props.border_color = *c;
                // Every side takes the shared colour again.
                let sides = &mut props.border_sides;
                for side in [
                    &mut sides.top,
                    &mut sides.right,
                    &mut sides.bottom,
                    &mut sides.left,
                ]
                .into_iter()
                .flatten()
                {
                    side.color = unset_side_color();
                }
            }
            PaintWrite::BorderSideColor { side, color } => {
                let sides = &mut props.border_sides;
                let slot = match side {
                    0 => &mut sides.top,
                    1 => &mut sides.right,
                    2 => &mut sides.bottom,
                    _ => &mut sides.left,
                };
                blinc_abi::layout_props::border_side(slot).color =
                    color.unwrap_or_else(unset_side_color);
            }
            PaintWrite::OutlineWidth(w) => props.outline_width = *w,
            PaintWrite::OutlineColor(c) => props.outline_color = *c,
            PaintWrite::OutlineOffset(o) => props.outline_offset = *o,
            PaintWrite::Shadows { outer, inner } => {
                props.shadow = outer.clone();
                props.inner_shadow = inner.clone();
            }
            PaintWrite::Transform(t) => {
                props.transform =
                    (t.elements != IDENTITY.elements).then_some(Transform::Affine2D(*t));
            }
            PaintWrite::Filter(f) => {
                if f.is_identity() {
                    props.filter = None;
                } else {
                    let filter = props.filter.get_or_insert_with(Default::default);
                    filter.brightness = f.brightness;
                    filter.contrast = f.contrast;
                    filter.grayscale = f.grayscale;
                    filter.hue_rotate = f.hue_rotate;
                    filter.invert = f.invert;
                    filter.saturate = f.saturate;
                    filter.sepia = f.sepia;
                    filter.blur = f.blur;
                    filter.drop_shadow = f.drop_shadow;
                }
            }
            PaintWrite::Mask(g) => {
                props.mask_image = g.clone().map(scene::blinc_core::MaskImage::Gradient);
            }
            PaintWrite::ClipPath(clip) => {
                props.clip_path = clip.as_ref().map(|c| c.path.clone());
                even_odd = Some(clip.as_ref().is_some_and(|c| c.even_odd));
            }
        }
    }
    tree.set_properties(node, props)?;
    if let Some(effects) = glass {
        tree.set_glass_effects(node, effects)?;
    }
    if let Some(rule) = even_odd {
        tree.set_clip_even_odd(node, rule)?;
    }
    Ok(())
}
#[napi]
impl NativeLayout {
    #[napi]
    pub fn set_image_source(&self, source: String, fit: ImageFit, slot: Option<f64>) -> Result<()> {
        self.owner.check()?;
        let slot = slot
            .map(|v| integer(v, 0.0, 16_777_215.0).map(|v| v as i32))
            .transpose()?;
        self.owner
            .tree
            .borrow_mut()
            .set_image_source(source, fit.native(), slot)
            .map_err(error)
    }
    #[napi]
    pub fn create_text(
        &self,
        content: String,
        text: TextStyle,
        style: LayoutStyle,
    ) -> Result<NativeLayoutNode> {
        self.owner.check()?;
        let text = text.apply(content, default_text())?;
        let node = self
            .owner
            .tree
            .borrow_mut()
            .create_text(style.apply(Default::default())?, text)
            .map_err(error)?;
        Ok(NativeLayoutNode {
            owner: self.owner.clone(),
            node,
        })
    }
    #[napi]
    pub fn prepare_display_list(
        &self,
        root: &NativeLayoutNode,
        options: NativePaintOptions,
    ) -> Result<NativePaintInfo> {
        self.owner.check()?;
        let options = options.into_options()?;
        let tree = self.owner.tree.borrow();
        let mut encoder = self.owner.encoder.borrow_mut();
        let info = encoder
            .get_or_insert_with(SceneEncoder::new)
            .prepare(&tree, root.node, options)
            .map_err(error)?;
        Ok(NativePaintInfo {
            count: info.count as u32,
            floats: info.floats as u32,
        })
    }
    #[napi]
    pub fn read_display_list(&self, env: Env, target: Unknown<'_>) -> Result<()> {
        self.owner.check()?;
        // No JS runs while caller storage is borrowed.
        unsafe {
            buffers::f32_output(env, target, |out| {
                self.owner
                    .encoder
                    .borrow()
                    .as_ref()
                    .ok_or_else(|| error("Prepare a display list first"))?
                    .read(&self.owner.tree.borrow(), out)
                    .map_err(error)
            })
        }
    }
    #[napi]
    pub fn atlas_info(&self, color: bool, seen: f64) -> Result<Option<NativeAtlasInfo>> {
        self.owner.check()?;
        let mut encoder = self.owner.encoder.borrow_mut();
        Ok(encoder
            .as_mut()
            .ok_or_else(|| error("Prepare a display list first"))?
            .atlas_info(color, integer(seen, 0.0, u32::MAX as f64)? as u32)
            .map_err(error)?
            .map(Into::into))
    }
    #[napi]
    pub fn read_atlas(
        &self,
        env: Env,
        color: bool,
        seen: f64,
        target: Unknown<'_>,
    ) -> Result<Option<NativeAtlasInfo>> {
        self.owner.check()?;
        unsafe {
            buffers::bytes_output(env, target, |out| {
                Ok(self
                    .owner
                    .encoder
                    .borrow_mut()
                    .as_mut()
                    .ok_or_else(|| error("Prepare a display list first"))?
                    .read_atlas(color, integer(seen, 0.0, u32::MAX as f64)? as u32, out)
                    .map_err(error)?
                    .map(Into::into))
            })
        }
    }
    #[napi]
    pub fn hit_test_region(
        &self,
        root: &NativeLayoutNode,
        x: f64,
        y: f64,
    ) -> Result<NativeHitRegion> {
        self.owner.check()?;
        let (hits, region) = self
            .owner
            .tree
            .borrow()
            .hit_test_region(root.node, number(x)?, number(y)?)
            .map_err(error)?;
        Ok(NativeHitRegion {
            hits: hits
                .into_iter()
                .map(|h| NativeHit {
                    node_id: h.node.raw().into(),
                    x: h.x as f64,
                    y: h.y as f64,
                })
                .collect(),
            bounds: region.bounds.map(f64::from).to_vec(),
        })
    }
    #[napi]
    pub fn hit_test(&self, root: &NativeLayoutNode, x: f64, y: f64) -> Result<Vec<NativeHit>> {
        self.owner.check()?;
        Ok(self
            .owner
            .tree
            .borrow()
            .hit_test(root.node, number(x)?, number(y)?)
            .map_err(error)?
            .into_iter()
            .map(|h| NativeHit {
                node_id: h.node.raw().into(),
                x: h.x as f64,
                y: h.y as f64,
            })
            .collect())
    }
}
#[napi]
impl NativeLayoutNode {
    #[napi(getter)]
    pub fn id(&self) -> BigInt {
        self.node.raw().into()
    }
    #[napi]
    pub fn set_paint(&self, patch: PaintStyle<'_>) -> Result<()> {
        self.owner.check()?;
        let mut tree = self.owner.tree.borrow_mut();
        let effects = patch
            .background
            .as_ref()
            .map(|brush| match &brush.style_value {
                blinc_abi::types::Value::Glass(_, effects) => Some(*effects),
                _ => None,
            });
        let props = patch.apply(tree.properties(self.node).map_err(error)?)?;
        tree.set_properties(self.node, props).map_err(error)?;
        if let Some(effects) = effects {
            tree.set_glass_effects(self.node, effects).map_err(error)?;
        }
        Ok(())
    }
    #[napi]
    pub fn clear_paint(&self) -> Result<()> {
        self.owner.check()?;
        let mut tree = self.owner.tree.borrow_mut();
        tree.set_properties(self.node, Default::default())
            .map_err(error)?;
        tree.set_glass_effects(self.node, None).map_err(error)
    }
    #[napi]
    pub fn set_text(&self, content: String, patch: TextStyle) -> Result<()> {
        self.owner.check()?;
        let mut tree = self.owner.tree.borrow_mut();
        let text = patch.apply(content, tree.text(self.node).map_err(error)?)?;
        tree.set_text(self.node, text).map_err(error)
    }
    #[napi]
    pub fn set_visual(&self, value: Option<Vec<f64>>) -> Result<()> {
        self.owner.check()?;
        self.owner.styles.borrow_mut().motion.view_changed();
        let visual = match value {
            Some(v) => {
                if v.len() != 4 {
                    return Err(error("Expected four visual values"));
                }
                Some([number(v[0])?, number(v[1])?, number(v[2])?, number(v[3])?])
            }
            None => None,
        };
        self.owner
            .tree
            .borrow_mut()
            .set_visual(self.node, visual)
            .map_err(error)
    }
    /// Draw the node as a notch: its four corner radii, then its top and bottom
    /// edges as kind, width, extent and radius. Null draws a plain box.
    #[napi]
    pub fn set_notch(&self, value: Option<Vec<f64>>) -> Result<()> {
        self.owner.check()?;
        let notch = match value {
            None => None,
            Some(v) => {
                if v.len() != 12 {
                    return Err(error("Expected twelve notch values"));
                }
                let mut values = [[0.0f32; 4]; 3];
                for (i, x) in v.iter().enumerate() {
                    values[i / 4][i % 4] = number(*x)?;
                }
                for edge in &values[1..] {
                    let [kind, width, extent, radius] = *edge;
                    if kind.fract() != 0.0 || !(0.0..=4.0).contains(&kind) {
                        return Err(error("Expected a notch edge kind from 0 to 4"));
                    }
                    if width < 0.0 || extent < 0.0 || radius < 0.0 {
                        return Err(error("A notch edge cannot be negative"));
                    }
                }
                Some(values)
            }
        };
        self.owner
            .tree
            .borrow_mut()
            .set_notch(self.node, notch)
            .map_err(error)
    }
    #[napi]
    pub fn set_pointer_events(&self, enabled: bool) -> Result<()> {
        self.owner.check()?;
        self.owner
            .tree
            .borrow_mut()
            .set_pointer_events(self.node, enabled)
            .map_err(error)
    }
    #[napi]
    pub fn set_resource(&self, slot: Option<f64>, canvas: bool) -> Result<()> {
        self.owner.check()?;
        self.owner
            .tree
            .borrow_mut()
            .set_resource(
                self.node,
                slot.map(|v| integer(v, 0.0, 16_777_215.0).map(|v| v as i32))
                    .transpose()?,
                canvas,
            )
            .map_err(error)
    }
    #[napi]
    pub fn set_scroll(&self, x: f64, y: f64, thumb: Option<Vec<f64>>) -> Result<()> {
        self.owner.check()?;
        let thumb = match thumb {
            Some(v) => {
                if v.len() != 4 {
                    return Err(error("Expected four thumb values"));
                }
                [
                    number(v[0])?.clamp(0.0, 1.0),
                    number(v[1])?.clamp(0.0, 1.0),
                    number(v[2])?.clamp(0.0, 1.0),
                    number(v[3])?.clamp(0.0, 1.0),
                ]
            }
            None => [0.0; 4],
        };
        self.owner.styles.borrow_mut().motion.view_changed();
        self.owner
            .tree
            .borrow_mut()
            .set_scroll(
                self.node,
                Some(blinc_abi::tree::Scroll {
                    x: number(x)?,
                    y: number(y)?,
                    thumb,
                }),
            )
            .map_err(error)
    }
}
fn dimensions(width: f64, height: f64) -> Result<(u32, u32)> {
    if width.fract() != 0.0
        || height.fract() != 0.0
        || !(1.0..=16384.0).contains(&width)
        || !(1.0..=16384.0).contains(&height)
        || width * height > 67_108_864.0
    {
        return Err(error(
            "Invalid raster dimensions (maximum 16384 per side and 64M pixels)",
        ));
    }
    Ok((width as u32, height as u32))
}
#[napi]
pub struct NativeImage {
    image: RefCell<Option<Bitmap>>,
    thread: std::thread::ThreadId,
}
impl NativeImage {
    fn new(image: Bitmap) -> Self {
        Self {
            image: RefCell::new(Some(image)),
            thread: std::thread::current().id(),
        }
    }
    fn with<T>(&self, run: impl FnOnce(&Bitmap) -> Result<T>) -> Result<T> {
        if self.thread != std::thread::current().id() {
            return Err(error("Image must be used on its owning thread"));
        }
        run(self
            .image
            .borrow()
            .as_ref()
            .ok_or_else(|| error("Image is disposed"))?)
    }
}
#[napi]
pub fn decode_image(env: Env, input: Unknown<'_>) -> Result<NativeImage> {
    unsafe {
        buffers::bytes_input(env, input, |data| {
            Ok(NativeImage::new(Bitmap::decode(data).map_err(error)?))
        })
    }
}
#[napi]
pub fn rasterize_svg(markup: String, width: f64, height: f64) -> Result<NativeImage> {
    let (width, height) = dimensions(width, height)?;
    let image = blinc_abi::svg::rasterize(&markup, width, height).map_err(error)?;
    Ok(NativeImage::new(Bitmap {
        pixels: image.pixels,
        width,
        height,
    }))
}
#[napi]
impl NativeImage {
    #[napi(getter)]
    pub fn width(&self) -> Result<u32> {
        self.with(|b| Ok(b.width))
    }
    #[napi(getter)]
    pub fn height(&self) -> Result<u32> {
        self.with(|b| Ok(b.height))
    }
    #[napi]
    pub fn read_pixels(&self, env: Env, target: Unknown<'_>) -> Result<()> {
        unsafe {
            buffers::bytes_output(env, target, |out| {
                self.with(|b| {
                    if out.len() < b.pixels.len() {
                        return Err(error("Image output is too small"));
                    }
                    out[..b.pixels.len()].copy_from_slice(&b.pixels);
                    Ok(())
                })
            })
        }
    }
    #[napi]
    pub fn resample(
        &self,
        env: Env,
        width: f64,
        height: f64,
        fit: ImageFit,
        target: Unknown<'_>,
    ) -> Result<()> {
        let (width, height) = dimensions(width, height)?;
        unsafe {
            buffers::bytes_output(env, target, |out| {
                self.with(|b| b.resample(width, height, fit.native(), out).map_err(error))
            })
        }
    }
    #[napi]
    pub fn dispose(&self) -> Result<()> {
        if self.thread != std::thread::current().id() {
            return Err(error("Image must be used on its owning thread"));
        }
        self.image.borrow_mut().take();
        Ok(())
    }
}
