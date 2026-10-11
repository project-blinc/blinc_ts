//! A transform as the list of functions it was written as, so two lists of
//! the same shape blend argument by argument, as CSS blends them: from
//! `rotate(0deg)` to `rotate(360deg)` is a whole turn, where the matrices of
//! the two are the same.

use blinc_abi::css::quantity::{PaintUnits, amount, angle, length};
use blinc_abi::css::value::{call, split};
use blinc_abi::scene::blinc_core::layer::Affine2D;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Function {
    /// x and y, in pixels.
    Translate(f64, f64),
    Scale(f64, f64),
    /// Radians.
    Rotate(f64),
    /// Radians, along x and y.
    Skew(f64, f64),
}

impl Function {
    /// The function of this kind that does nothing.
    fn identity(&self) -> Function {
        match self {
            Function::Translate(..) => Function::Translate(0.0, 0.0),
            Function::Scale(..) => Function::Scale(1.0, 1.0),
            Function::Rotate(_) => Function::Rotate(0.0),
            Function::Skew(..) => Function::Skew(0.0, 0.0),
        }
    }

    fn matrix(&self) -> [f64; 6] {
        match *self {
            Function::Translate(x, y) => [1.0, 0.0, 0.0, 1.0, x, y],
            Function::Scale(x, y) => [x, 0.0, 0.0, y, 0.0, 0.0],
            Function::Rotate(r) => [r.cos(), r.sin(), -r.sin(), r.cos(), 0.0, 0.0],
            Function::Skew(x, y) => [1.0, y.tan(), x.tan(), 1.0, 0.0, 0.0],
        }
    }
}

/// The functions `text` lists; none for `none`, and none when one of them
/// is a `matrix()` or is not read, which then blends as a matrix.
pub(crate) fn parse(text: &str, units: &PaintUnits) -> Option<Vec<Function>> {
    if text.trim().eq_ignore_ascii_case("none") {
        return Some(Vec::new());
    }
    let px = |t: &str| {
        if t.trim().ends_with('%') {
            None
        } else {
            length(t, units).ok()
        }
    };
    split(text, ' ')
        .iter()
        .map(|part| {
            let (name, args) = call(part)?;
            let args = split(&args, ',');
            if args.is_empty() {
                return None;
            }
            let one = || (args.len() == 1).then(|| args[0].as_str());
            let second = |f: &dyn Fn(&str) -> Option<f64>, default: f64| match args.len() {
                1 => Some(default),
                2 => f(&args[1]),
                _ => None,
            };
            Some(match name.as_str() {
                "translate" => Function::Translate(px(&args[0])?, second(&px, 0.0)?),
                "translatex" => Function::Translate(px(one()?)?, 0.0),
                "translatey" => Function::Translate(0.0, px(one()?)?),
                "scale" => {
                    let x = amount(&args[0]).ok()?;
                    Function::Scale(x, second(&|t| amount(t).ok(), x)?)
                }
                "scalex" => Function::Scale(amount(one()?).ok()?, 1.0),
                "scaley" => Function::Scale(1.0, amount(one()?).ok()?),
                "rotate" | "rotatez" => Function::Rotate(angle(one()?).ok()?),
                "skew" => Function::Skew(angle(&args[0]).ok()?, second(&|t| angle(t).ok(), 0.0)?),
                "skewx" => Function::Skew(angle(one()?).ok()?, 0.0),
                "skewy" => Function::Skew(0.0, angle(one()?).ok()?),
                _ => return None,
            })
        })
        .collect()
}

/// `t` of the way from `a` to `b`, when each function of one is of the
/// kind of the other's in its place; an empty list, `none`, stands for the
/// other's functions doing nothing.
pub(crate) fn blend(a: &[Function], b: &[Function], t: f64) -> Option<Affine2D> {
    let identities = |l: &[Function]| l.iter().map(Function::identity).collect::<Vec<_>>();
    let (a, b) = match (a.is_empty(), b.is_empty()) {
        (true, false) => (identities(b), b.to_vec()),
        (false, true) => (a.to_vec(), identities(a)),
        _ => (a.to_vec(), b.to_vec()),
    };
    if a.len() != b.len() {
        return None;
    }
    let lerp = |x: f64, y: f64| x + (y - x) * t;
    let mixed = a
        .iter()
        .zip(&b)
        .map(|pair| {
            Some(match (*pair.0, *pair.1) {
                (Function::Translate(x0, y0), Function::Translate(x1, y1)) => {
                    Function::Translate(lerp(x0, x1), lerp(y0, y1))
                }
                (Function::Scale(x0, y0), Function::Scale(x1, y1)) => {
                    Function::Scale(lerp(x0, x1), lerp(y0, y1))
                }
                (Function::Rotate(r0), Function::Rotate(r1)) => Function::Rotate(lerp(r0, r1)),
                (Function::Skew(x0, y0), Function::Skew(x1, y1)) => {
                    Function::Skew(lerp(x0, x1), lerp(y0, y1))
                }
                _ => return None,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    Some(compose(&mixed))
}

/// The matrix of a list, the first function outermost.
pub(crate) fn compose(list: &[Function]) -> Affine2D {
    let mut m = [1.0f64, 0.0, 0.0, 1.0, 0.0, 0.0];
    for f in list {
        let n = f.matrix();
        m = [
            m[0] * n[0] + m[2] * n[1],
            m[1] * n[0] + m[3] * n[1],
            m[0] * n[2] + m[2] * n[3],
            m[1] * n[2] + m[3] * n[3],
            m[0] * n[4] + m[2] * n[5] + m[4],
            m[1] * n[4] + m[3] * n[5] + m[5],
        ];
    }
    Affine2D {
        elements: m.map(|v| v as f32),
    }
}
