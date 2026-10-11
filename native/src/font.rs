//! Adapter ownership of the shared font decoder and private registry names.
use crate::buffers;
use blinc_abi::font::Font;
use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Error, Result, Status, Task, Unknown};
use napi_derive::napi;
use std::cell::RefCell;

fn error(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

#[napi]
pub fn font_families(stack: String) -> Vec<String> {
    blinc_abi::css::font_face::families(&stack)
}

#[napi]
pub struct NativeFont {
    font: RefCell<Option<Font>>,
}

#[napi]
impl NativeFont {
    #[napi]
    pub fn family(&self, weight: u32) -> Result<String> {
        let weight = u16::try_from(weight).map_err(|_| error("Invalid font weight"))?;
        self.font
            .borrow()
            .as_ref()
            .ok_or_else(|| error("Font disposed"))?
            .family(weight)
            .map_err(error)
    }
    #[napi]
    pub fn dispose(&self) {
        self.font.borrow_mut().take();
    }
}

pub struct LoadFont {
    bytes: Vec<u8>,
}
impl Task for LoadFont {
    type Output = Font;
    type JsValue = NativeFont;
    fn compute(&mut self) -> Result<Font> {
        Font::decode(std::mem::take(&mut self.bytes)).map_err(error)
    }
    fn resolve(&mut self, _env: Env, font: Font) -> Result<NativeFont> {
        Ok(NativeFont {
            font: RefCell::new(Some(font)),
        })
    }
}

#[napi]
pub fn load_font(env: Env, input: Unknown<'_>) -> Result<AsyncTask<LoadFont>> {
    let bytes = unsafe { buffers::bytes_input(env, input, |data| Ok(data.to_vec()))? };
    Ok(AsyncTask::new(LoadFont { bytes }))
}

#[napi]
pub fn load_local_font(name: String, weight: u32, italic: bool) -> Result<NativeFont> {
    if !(1..=1000).contains(&weight) {
        return Err(error("Invalid font weight"));
    }
    let weight = u16::try_from(weight).map_err(|_| error("Invalid font weight"))?;
    Ok(NativeFont {
        font: RefCell::new(Some(Font::local(&name, weight, italic).map_err(error)?)),
    })
}

#[napi]
pub fn match_font_face(
    weights: Vec<u32>,
    styles: Vec<bool>,
    weight: u32,
    italic: bool,
) -> Result<Option<u32>> {
    if weights.len() != styles.len() * 2 || !(1..=1000).contains(&weight) {
        return Err(error("Invalid font descriptors"));
    }
    let mut faces = Vec::with_capacity(styles.len());
    for (i, style) in styles.into_iter().enumerate() {
        let range = [weights[i * 2], weights[i * 2 + 1]];
        if range[0] < 1 || range[1] > 1000 || range[0] > range[1] {
            return Err(error("Invalid font weight range"));
        }
        faces.push(([range[0] as u16, range[1] as u16], style));
    }
    Ok(blinc_abi::css::font_face::match_face(&faces, weight as u16, italic).map(|i| i as u32))
}
