//! Immutable Blinc brush values, constructed once and reused by paint updates.
use crate::{
    layout::NativeLayout,
    scene::{color, number, positive, unit},
    scene_values::{BrushKind, ImageFit},
};
use blinc_abi::scene::blinc_core::layer::{
    BlurStyle, GlassStyle, Gradient, GradientSpace, GradientSpread, GradientStop, ImageBrush,
};
use blinc_abi::scene::blinc_core::{Brush, Point};
use blinc_abi::types::{GlassEffects, Value};
use napi::{Error, Result, Status};
use napi_derive::napi;

fn required<T>(value: Option<T>) -> Result<T> {
    value.ok_or_else(|| Error::new(Status::InvalidArg, "Missing brush field"))
}
#[napi(object)]
pub struct BrushStop {
    pub offset: f64,
    pub color: Vec<f64>,
}
#[napi(object)]
pub struct BrushDescriptor {
    pub kind: BrushKind,
    pub color: Option<Vec<f64>>,
    pub points: Option<Vec<f64>>,
    pub stops: Option<Vec<BrushStop>>,
    pub bounding_box: Option<bool>,
    pub radius: Option<f64>,
    pub tint: Option<Vec<f64>>,
    pub simple: Option<bool>,
    pub noise: Option<f64>,
    pub saturation: Option<f64>,
    pub brightness: Option<f64>,
    pub border_thickness: Option<f64>,
    pub border_color: Option<Vec<f64>>,
    pub aberration: Option<f64>,
    pub bevel: Option<f64>,
    pub inset: Option<bool>,
    pub source: Option<String>,
    pub fit: Option<ImageFit>,
}
#[napi]
pub struct NativeBrush {
    pub(crate) style_value: Value,
}
impl BrushDescriptor {
    fn into_brush(self) -> Result<NativeBrush> {
        let mut effects = None;
        let value = match self.kind {
            BrushKind::Solid => Brush::Solid(color(required(self.color)?)?),
            BrushKind::Linear | BrushKind::Radial => {
                let points = required(self.points)?;
                if points.len() != 4 {
                    return Err(Error::new(
                        Status::InvalidArg,
                        "Expected four gradient coordinates",
                    ));
                }
                let [x1, y1, x2, y2] = [
                    number(points[0])?,
                    number(points[1])?,
                    number(points[2])?,
                    number(points[3])?,
                ];
                let mut previous = 0.0;
                let stops = required(self.stops)?
                    .into_iter()
                    .map(|stop| {
                        let offset = unit(stop.offset)?;
                        if offset < previous {
                            return Err(Error::new(
                                Status::InvalidArg,
                                "Gradient stops must be ordered",
                            ));
                        }
                        previous = offset;
                        Ok(GradientStop {
                            offset,
                            color: color(stop.color)?,
                        })
                    })
                    .collect::<Result<Vec<_>>>()?;
                let space = if self.bounding_box.unwrap_or(false) {
                    GradientSpace::ObjectBoundingBox
                } else {
                    GradientSpace::UserSpace
                };
                Brush::Gradient(if matches!(self.kind, BrushKind::Linear) {
                    Gradient::Linear {
                        start: Point::new(x1, y1),
                        end: Point::new(x2, y2),
                        stops,
                        space,
                        spread: GradientSpread::Pad,
                    }
                } else {
                    Gradient::Radial {
                        center: Point::new(x1, y1),
                        radius: positive(x2 as f64)?,
                        focal: None,
                        stops,
                        space,
                        spread: GradientSpread::Pad,
                    }
                })
            }
            BrushKind::Blur => {
                let mut style = BlurStyle::with_radius(positive(required(self.radius)?)?);
                style.tint = self.tint.map(color).transpose()?;
                Brush::Blur(style)
            }
            BrushKind::Glass => {
                let mut style = GlassStyle::new();
                if let Some(v) = self.radius {
                    style.blur = positive(v)?;
                }
                if let Some(v) = self.tint {
                    style.tint = color(v)?;
                }
                if let Some(v) = self.simple {
                    style.simple = v;
                }
                if let Some(v) = self.noise {
                    style.noise = unit(v)?;
                }
                if let Some(v) = self.saturation {
                    style.saturation = positive(v)?;
                }
                if let Some(v) = self.brightness {
                    style.brightness = positive(v)?;
                }
                if let Some(v) = self.border_thickness {
                    style.border_thickness = positive(v)?;
                }
                if let Some(v) = self.border_color {
                    style.border_color = Some(color(v)?);
                }
                effects = Some(GlassEffects {
                    aberration: unit(self.aberration.unwrap_or(0.3))?,
                    bevel: unit(self.bevel.unwrap_or(1.0))?,
                    inset: self.inset.unwrap_or(false),
                });
                Brush::Glass(style)
            }
            BrushKind::Image => {
                let source = required(self.source)?;
                if source.is_empty() {
                    return Err(Error::new(Status::InvalidArg, "Image source is empty"));
                }
                let mut image = ImageBrush::new(source);
                image.fit = match self.fit.unwrap_or(ImageFit::Cover) {
                    ImageFit::Cover => blinc_abi::scene::blinc_core::layer::ImageFit::Cover,
                    ImageFit::Contain => blinc_abi::scene::blinc_core::layer::ImageFit::Contain,
                    ImageFit::Fill => blinc_abi::scene::blinc_core::layer::ImageFit::Fill,
                    ImageFit::Tile => blinc_abi::scene::blinc_core::layer::ImageFit::Tile,
                };
                Brush::Image(image)
            }
        };
        Ok(NativeBrush {
            style_value: match value {
                Brush::Glass(glass) => Value::Glass(glass, effects.unwrap_or_default()),
                brush => Value::Brush(brush),
            },
        })
    }
}
#[napi]
impl NativeLayout {
    #[napi]
    pub fn create_brush(&self, descriptor: BrushDescriptor) -> Result<NativeBrush> {
        self.owner.check()?;
        if self.owner.tree.borrow().is_disposed() {
            return Err(Error::new(Status::InvalidArg, "Layout context is disposed"));
        }
        descriptor.into_brush()
    }
}
