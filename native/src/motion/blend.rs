//! Values between two writes of one field. Colours blend premultiplied,
//! transforms by their translation, rotation, scale and skew, shadow lists by
//! position, layout lengths of one unit in a line; what has no between flips
//! at the midpoint.

use super::field::{Value, Write, non_negative, slot};

use blinc_abi::css::filter::Filter;
use blinc_abi::css::paint::{Background, PaintWrite};
use blinc_abi::scene::blinc_core::layer::{Affine2D, Gradient, GradientStop};
use blinc_abi::scene::blinc_core::{self, Color, Shadow};

fn lerp(a: f32, b: f32, t: f64) -> f32 {
    a + (b - a) * t as f32
}

const CLEAR: Color = Color::rgba(0.0, 0.0, 0.0, 0.0);

fn color(a: Color, b: Color, t: f64) -> Color {
    let t = t as f32;
    let alpha = a.a + (b.a - a.a) * t;
    if alpha <= 0.0 {
        return CLEAR;
    }
    // Premultiplied, so a fade from transparent keeps the other colour's hue.
    let channel = |x: f32, y: f32| ((x * a.a + (y * b.a - x * a.a) * t) / alpha).clamp(0.0, 1.0);
    Color::rgba(
        channel(a.r, b.r),
        channel(a.g, b.g),
        channel(a.b, b.b),
        alpha.clamp(0.0, 1.0),
    )
}

/// A colour that may be absent: absent blends as transparent.
fn optional(a: Option<Color>, b: Option<Color>, t: f64) -> Option<Color> {
    match (a, b) {
        (Some(a), Some(b)) => Some(color(a, b, t)),
        (Some(a), None) => Some(color(a, with_alpha(a, 0.0), t)),
        (None, Some(b)) => Some(color(with_alpha(b, 0.0), b, t)),
        (None, None) => None,
    }
}

fn with_alpha(c: Color, a: f32) -> Color {
    Color::rgba(c.r, c.g, c.b, a)
}

fn shadow(a: Shadow, b: Shadow, t: f64) -> Shadow {
    Shadow {
        offset_x: lerp(a.offset_x, b.offset_x, t),
        offset_y: lerp(a.offset_y, b.offset_y, t),
        blur: lerp(a.blur, b.blur, t).max(0.0),
        spread: lerp(a.spread, b.spread, t),
        color: color(a.color, b.color, t),
    }
}

/// Layers pair by position; the shorter list is padded with layers that draw nothing.
fn shadows(a: &[Shadow], b: &[Shadow], t: f64) -> Vec<Shadow> {
    let none = |s: Shadow| Shadow {
        color: with_alpha(s.color, 0.0),
        offset_x: 0.0,
        offset_y: 0.0,
        blur: 0.0,
        spread: 0.0,
    };
    (0..a.len().max(b.len()))
        .map(|i| match (a.get(i), b.get(i)) {
            (Some(&a), Some(&b)) => shadow(a, b, t),
            (Some(&a), None) => shadow(a, none(a), t),
            (None, Some(&b)) => shadow(none(b), b, t),
            (None, None) => unreachable!(),
        })
        .collect()
}

fn stops(a: &[GradientStop], b: &[GradientStop], t: f64) -> Vec<GradientStop> {
    a.iter()
        .zip(b)
        .map(|(a, b)| GradientStop {
            offset: lerp(a.offset, b.offset, t),
            color: color(a.color, b.color, t),
        })
        .collect()
}

fn point(a: blinc_core::Point, b: blinc_core::Point, t: f64) -> blinc_core::Point {
    blinc_core::Point {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
    }
}

/// Two gradients of one kind and stop count blend; any other pair does not.
fn gradient(a: &Gradient, b: &Gradient, t: f64) -> Option<Gradient> {
    Some(match (a, b) {
        (
            Gradient::Linear {
                start: s0,
                end: e0,
                stops: c0,
                space,
                spread,
            },
            Gradient::Linear {
                start: s1,
                end: e1,
                stops: c1,
                space: space1,
                spread: spread1,
            },
        ) if c0.len() == c1.len() && space == space1 && spread == spread1 => Gradient::Linear {
            start: point(*s0, *s1, t),
            end: point(*e0, *e1, t),
            stops: stops(c0, c1, t),
            space: *space,
            spread: *spread,
        },
        (
            Gradient::Radial {
                center: m0,
                radius: r0,
                focal: f0,
                stops: c0,
                space,
                spread,
            },
            Gradient::Radial {
                center: m1,
                radius: r1,
                focal: f1,
                stops: c1,
                space: space1,
                spread: spread1,
            },
        ) if c0.len() == c1.len() && space == space1 && spread == spread1 => Gradient::Radial {
            center: point(*m0, *m1, t),
            radius: lerp(*r0, *r1, t),
            focal: match (f0, f1) {
                (Some(a), Some(b)) => Some(point(*a, *b, t)),
                (None, None) => None,
                _ => return None,
            },
            stops: stops(c0, c1, t),
            space: *space,
            spread: *spread,
        },
        (
            Gradient::Conic {
                center: m0,
                start_angle: a0,
                stops: c0,
                space,
            },
            Gradient::Conic {
                center: m1,
                start_angle: a1,
                stops: c1,
                space: space1,
            },
        ) if c0.len() == c1.len() && space == space1 => Gradient::Conic {
            center: point(*m0, *m1, t),
            start_angle: lerp(*a0, *a1, t),
            stops: stops(c0, c1, t),
            space: *space,
        },
        _ => return None,
    })
}

fn background(a: &Background, b: &Background, t: f64) -> Background {
    match (a, b) {
        (Background::Solid(x), Background::Solid(y)) => Background::Solid(color(*x, *y, t)),
        (Background::None, Background::Solid(y)) => {
            Background::Solid(color(with_alpha(*y, 0.0), *y, t))
        }
        (Background::Solid(x), Background::None) => {
            Background::Solid(color(*x, with_alpha(*x, 0.0), t))
        }
        (Background::Gradient(x), Background::Gradient(y)) => gradient(x, y, t)
            .map(Background::Gradient)
            .unwrap_or_else(|| flip(a, b, t).clone()),
        _ => flip(a, b, t).clone(),
    }
}

fn flip<'a, T>(a: &'a T, b: &'a T, t: f64) -> &'a T {
    if t < 0.5 { a } else { b }
}

/// A matrix as translation, rotation (radians), scale and skew; none for one
/// that flattens the plane, which has no rotation to speak of.
struct Parts {
    tx: f32,
    ty: f32,
    angle: f32,
    sx: f32,
    sy: f32,
    skew: f32,
}

fn decompose(m: &[f32; 6]) -> Option<Parts> {
    let [a, b, c, d, tx, ty] = *m;
    if (a * d - b * c).abs() < 1e-6 {
        return None;
    }
    let mut sx = a.hypot(b);
    let mut col0 = (a / sx, b / sx);
    let skew_raw = col0.0 * c + col0.1 * d;
    let ortho = (c - col0.0 * skew_raw, d - col0.1 * skew_raw);
    let sy = ortho.0.hypot(ortho.1);
    let mut skew = skew_raw / sy;
    // A reflection is carried by the x scale.
    if col0.0 * ortho.1 - col0.1 * ortho.0 < 0.0 {
        sx = -sx;
        col0 = (-col0.0, -col0.1);
        skew = -skew;
    }
    Some(Parts {
        tx,
        ty,
        angle: col0.1.atan2(col0.0),
        sx,
        sy,
        skew,
    })
}

fn compose(p: &Parts) -> Affine2D {
    let (sin, cos) = p.angle.sin_cos();
    Affine2D {
        elements: [
            p.sx * cos,
            p.sx * sin,
            p.sy * (p.skew * cos - sin),
            p.sy * (cos + p.skew * sin),
            p.tx,
            p.ty,
        ],
    }
}

fn transform(a: &Affine2D, b: &Affine2D, t: f64) -> Affine2D {
    let linear = || Affine2D {
        elements: std::array::from_fn(|i| lerp(a.elements[i], b.elements[i], t)),
    };
    let (Some(p), Some(q)) = (decompose(&a.elements), decompose(&b.elements)) else {
        return linear();
    };
    // Turn the short way round.
    let mut turn = q.angle - p.angle;
    if turn > std::f32::consts::PI {
        turn -= std::f32::consts::TAU;
    } else if turn < -std::f32::consts::PI {
        turn += std::f32::consts::TAU;
    }
    compose(&Parts {
        tx: lerp(p.tx, q.tx, t),
        ty: lerp(p.ty, q.ty, t),
        angle: p.angle + turn * t as f32,
        sx: lerp(p.sx, q.sx, t),
        sy: lerp(p.sy, q.sy, t),
        skew: lerp(p.skew, q.skew, t),
    })
}

fn filter(a: &Filter, b: &Filter, t: f64) -> Filter {
    let zero = |s: Shadow| Shadow {
        color: with_alpha(s.color, 0.0),
        offset_x: 0.0,
        offset_y: 0.0,
        blur: 0.0,
        spread: 0.0,
    };
    Filter {
        brightness: lerp(a.brightness, b.brightness, t),
        contrast: lerp(a.contrast, b.contrast, t),
        grayscale: lerp(a.grayscale, b.grayscale, t),
        hue_rotate: lerp(a.hue_rotate, b.hue_rotate, t),
        invert: lerp(a.invert, b.invert, t),
        saturate: lerp(a.saturate, b.saturate, t),
        sepia: lerp(a.sepia, b.sepia, t),
        blur: lerp(a.blur, b.blur, t).max(0.0),
        drop_shadow: match (a.drop_shadow, b.drop_shadow) {
            (Some(x), Some(y)) => Some(shadow(x, y, t)),
            (Some(x), None) => Some(shadow(x, zero(x), t)),
            (None, Some(y)) => Some(shadow(zero(y), y, t)),
            (None, None) => None,
        },
    }
}

/// The write `t` of the way from `a` to `b`, two writes of one field; `b`
/// when they are not.
pub(crate) fn blend(a: &Write, b: &Write, t: f64) -> Write {
    match (a, b) {
        (Write::Paint(x), Write::Paint(y)) => Write::Paint(blend_paint(x, y, t)),
        (Write::Layout(i, Value::Number(x)), Write::Layout(j, Value::Number(y)))
            if i == j && x.is_finite() && y.is_finite() =>
        {
            let v = lerp(*x, *y, t);
            Write::Layout(
                *i,
                Value::Number(if non_negative(slot(*i)) {
                    v.max(0.0)
                } else {
                    v
                }),
            )
        }
        // `auto`, a keyword, or pixels against a percentage.
        _ => flip(a, b, t).clone(),
    }
}

fn blend_paint(a: &PaintWrite, b: &PaintWrite, t: f64) -> PaintWrite {
    use PaintWrite as W;
    match (a, b) {
        (W::Background(x), W::Background(y)) => W::Background(background(x, y, t)),
        (W::TextColor(x), W::TextColor(y)) => match (x, y) {
            // An inherited colour is not known here to blend from or to.
            (Some(_), Some(_)) => W::TextColor(optional(*x, *y, t)),
            _ => W::TextColor(*flip(x, y, t)),
        },
        (W::Opacity(x), W::Opacity(y)) => W::Opacity(lerp(*x, *y, t).clamp(0.0, 1.0)),
        (W::Visible(x), W::Visible(y)) => W::Visible(if t > 0.0 && t < 1.0 {
            *x || *y
        } else {
            *flip(x, y, t)
        }),
        (W::BorderRadius(x), W::BorderRadius(y)) => {
            W::BorderRadius(std::array::from_fn(|i| lerp(x[i], y[i], t).max(0.0)))
        }
        (W::BorderColor(x), W::BorderColor(y)) => W::BorderColor(optional(*x, *y, t)),
        (W::BorderSideColor { side, color: x }, W::BorderSideColor { color: y, .. }) => {
            W::BorderSideColor {
                side: *side,
                color: match (x, y) {
                    (Some(_), Some(_)) => optional(*x, *y, t),
                    _ => *flip(x, y, t),
                },
            }
        }
        (W::OutlineWidth(x), W::OutlineWidth(y)) => W::OutlineWidth(lerp(*x, *y, t).max(0.0)),
        (W::OutlineColor(x), W::OutlineColor(y)) => W::OutlineColor(optional(*x, *y, t)),
        (W::OutlineOffset(x), W::OutlineOffset(y)) => W::OutlineOffset(lerp(*x, *y, t)),
        (
            W::Shadows {
                outer: xo,
                inner: xi,
            },
            W::Shadows {
                outer: yo,
                inner: yi,
            },
        ) => W::Shadows {
            outer: shadows(xo, yo, t),
            inner: shadows(xi, yi, t),
        },
        (W::Transform(x), W::Transform(y)) => W::Transform(transform(x, y, t)),
        (W::Filter(x), W::Filter(y)) => W::Filter(filter(x, y, t)),
        (W::Mask(x), W::Mask(y)) => W::Mask(flip(x, y, t).clone()),
        _ => b.clone(),
    }
}

/// A write as numbers that blend in a straight line, to measure how fast a
/// field moves; none for one that does not, such as a gradient or a mask.
pub(crate) fn vector(write: &Write) -> Option<Vec<f32>> {
    match write {
        Write::Paint(paint) => vector_paint(paint),
        Write::Layout(_, Value::Number(v)) if v.is_finite() => Some(vec![*v]),
        Write::Layout(..) | Write::Visual(_) => None,
    }
}

fn vector_paint(write: &PaintWrite) -> Option<Vec<f32>> {
    use PaintWrite as W;
    let rgba = |c: Color| [c.r * c.a, c.g * c.a, c.b * c.a, c.a];
    let shadow = |s: &Shadow| {
        let [r, g, b, a] = rgba(s.color);
        [s.offset_x, s.offset_y, s.blur, s.spread, r, g, b, a]
    };
    Some(match write {
        W::Opacity(v) | W::OutlineWidth(v) | W::OutlineOffset(v) => vec![*v],
        W::BorderRadius(r) => r.to_vec(),
        W::Background(Background::None) => vec![0.0; 4],
        W::Background(Background::Solid(c)) => rgba(*c).to_vec(),
        W::TextColor(Some(c))
        | W::BorderColor(Some(c))
        | W::OutlineColor(Some(c))
        | W::BorderSideColor { color: Some(c), .. } => rgba(*c).to_vec(),
        W::Transform(t) => t.elements.to_vec(),
        W::Filter(f) => vec![
            f.brightness,
            f.contrast,
            f.grayscale,
            f.hue_rotate,
            f.invert,
            f.saturate,
            f.sepia,
            f.blur,
        ],
        W::Shadows { outer, inner } => outer.iter().chain(inner).flat_map(shadow).collect(),
        _ => return None,
    })
}

/// Whether two writes set a slot to the same value.
pub(crate) fn same(a: &Write, b: &Write) -> bool {
    match (a, b) {
        (Write::Paint(x), Write::Paint(y)) => same_paint(x, y),
        (Write::Layout(i, x), Write::Layout(j, y)) => {
            i == j
                && match (x, y) {
                    // auto against auto.
                    (Value::Number(x), Value::Number(y)) => x == y || (x.is_nan() && y.is_nan()),
                    _ => x == y,
                }
        }
        _ => false,
    }
}

fn same_paint(a: &PaintWrite, b: &PaintWrite) -> bool {
    use PaintWrite as W;
    match (a, b) {
        (W::Opacity(x), W::Opacity(y)) => x == y,
        (W::Visible(x), W::Visible(y)) => x == y,
        (W::BorderRadius(x), W::BorderRadius(y)) => x == y,
        (W::TextColor(x), W::TextColor(y))
        | (W::BorderColor(x), W::BorderColor(y))
        | (W::OutlineColor(x), W::OutlineColor(y)) => x == y,
        (W::BorderSideColor { side: s, color: x }, W::BorderSideColor { side: t, color: y }) => {
            s == t && x == y
        }
        (W::OutlineWidth(x), W::OutlineWidth(y)) | (W::OutlineOffset(x), W::OutlineOffset(y)) => {
            x == y
        }
        (W::Transform(x), W::Transform(y)) => x == y,
        (W::Background(Background::None), W::Background(Background::None)) => true,
        (W::Background(Background::Solid(x)), W::Background(Background::Solid(y))) => x == y,
        (
            W::Shadows {
                outer: xo,
                inner: xi,
            },
            W::Shadows {
                outer: yo,
                inner: yi,
            },
        ) => xo == yo && xi == yi,
        // Gradients, glass, masks and filters carry no equality of their own.
        _ => format!("{a:?}") == format!("{b:?}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgb(r: f32, g: f32, b: f32) -> Color {
        Color::rgba(r, g, b, 1.0)
    }

    #[test]
    fn colours_blend_in_srgb_and_clamp_overshoot() {
        let mid = color(rgb(0.0, 0.0, 0.0), rgb(1.0, 0.5, 0.0), 0.5);
        assert_eq!((mid.r, mid.g, mid.b, mid.a), (0.5, 0.25, 0.0, 1.0));
        let over = color(rgb(0.2, 0.2, 0.2), rgb(0.9, 0.9, 0.9), 1.4);
        assert_eq!(over.r, 1.0);
    }

    #[test]
    fn a_fade_from_transparent_keeps_the_hue() {
        let half = color(CLEAR, rgb(1.0, 0.0, 0.0), 0.5);
        assert_eq!((half.r, half.g, half.b), (1.0, 0.0, 0.0));
        assert_eq!(half.a, 0.5);
    }

    #[test]
    fn a_transform_turns_the_short_way_and_scales_through() {
        let rot = |deg: f32| {
            let (s, c) = deg.to_radians().sin_cos();
            Affine2D {
                elements: [c, s, -s, c, 0.0, 0.0],
            }
        };
        // 170 degrees to -170 is a 20 degree turn through 180, not 340 back.
        let mid = transform(&rot(170.0), &rot(-170.0), 0.5);
        let angle = mid.elements[1].atan2(mid.elements[0]).to_degrees().abs();
        assert!((angle - 180.0).abs() < 0.01, "{angle}");
        // From a collapsed matrix the elements blend, so a scale grows from nothing.
        let grow = transform(
            &Affine2D {
                elements: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            },
            &Affine2D {
                elements: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            },
            0.25,
        );
        assert_eq!(grow.elements, [0.25, 0.0, 0.0, 0.25, 0.0, 0.0]);
    }

    #[test]
    fn a_matrix_survives_taking_apart() {
        for m in [
            [2.0, 0.0, 0.0, 3.0, 5.0, -4.0],
            [0.6, 0.8, -0.8, 0.6, 1.0, 2.0],
            [1.0, 0.0, 0.5, 1.0, 0.0, 0.0],
            [-1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        ] {
            let back = compose(&decompose(&m).unwrap());
            for (x, y) in m.iter().zip(back.elements) {
                assert!((x - y).abs() < 1e-5, "{m:?} came back {:?}", back.elements);
            }
        }
    }

    #[test]
    fn shadow_lists_of_unequal_length_pad_with_nothing() {
        let one = Shadow::new(0.0, 2.0, 4.0, rgb(0.0, 0.0, 0.0));
        let mid = shadows(&[one], &[], 0.5);
        assert_eq!(mid.len(), 1);
        assert!((mid[0].color.a - 0.5).abs() < 1e-6);
        assert!((mid[0].offset_y - 1.0).abs() < 1e-6);
    }

    #[test]
    fn a_pair_that_cannot_blend_flips_at_the_midpoint() {
        let a = PaintWrite::Mask(None);
        let b = PaintWrite::Visible(false);
        assert!(matches!(
            blend_paint(&a, &b, 0.3),
            PaintWrite::Visible(false)
        ));
        let shown = blend_paint(&PaintWrite::Visible(true), &PaintWrite::Visible(false), 0.5);
        assert!(matches!(shown, PaintWrite::Visible(true)));
        let gone = blend_paint(&PaintWrite::Visible(true), &PaintWrite::Visible(false), 1.0);
        assert!(matches!(gone, PaintWrite::Visible(false)));
    }

    #[test]
    fn layout_lengths_of_one_unit_blend_and_others_flip() {
        use blinc_abi::css::layout::id;
        let px = |v: f32| Write::Layout(id::WIDTH, Value::Number(v));
        let Write::Layout(_, Value::Number(mid)) = blend(&px(100.0), &px(200.0), 0.25) else {
            panic!("a length");
        };
        assert_eq!(mid, 125.0);
        let Write::Layout(_, Value::Number(floor)) = blend(&px(10.0), &px(100.0), -0.5) else {
            panic!("a length");
        };
        assert_eq!(floor, 0.0, "a width overshooting below zero stops there");
        let margin = |v: f32| Write::Layout(id::MARGIN_TOP, Value::Number(v));
        let Write::Layout(_, Value::Number(m)) = blend(&margin(10.0), &margin(100.0), -0.5) else {
            panic!("a length");
        };
        assert_eq!(m, -35.0, "a margin can go negative");
        let percent = Write::Layout(id::WIDTH_PERCENT, Value::Number(0.5));
        assert!(matches!(
            blend(&px(100.0), &percent, 0.4),
            Write::Layout(id::WIDTH, _)
        ));
        assert!(matches!(
            blend(&px(100.0), &percent, 0.6),
            Write::Layout(id::WIDTH_PERCENT, _)
        ));
        let auto = Write::Layout(id::WIDTH, Value::Number(f32::NAN));
        assert!(same(&auto, &auto.clone()));
        assert!(!same(&auto, &px(1.0)));
    }

    #[test]
    fn gradients_of_one_shape_blend_and_others_flip() {
        let line = |a: Color, b: Color| {
            Background::Gradient(Gradient::linear(
                blinc_core::Point { x: 0.0, y: 0.0 },
                blinc_core::Point { x: 1.0, y: 0.0 },
                a,
                b,
            ))
        };
        let (white, black) = (rgb(1.0, 1.0, 1.0), rgb(0.0, 0.0, 0.0));
        let mid = background(&line(white, white), &line(black, black), 0.5);
        let Background::Gradient(Gradient::Linear { stops, .. }) = mid else {
            panic!("a gradient");
        };
        assert_eq!(stops[0].color.r, 0.5);
        let flipped = background(&line(white, white), &Background::Solid(black), 0.7);
        assert!(matches!(flipped, Background::Solid(_)));
    }
}
