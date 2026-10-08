#![allow(unused_variables)]
use crate::enum_value::napi_enum;
use runtime::NativeEnum;
use xidl_node as runtime;
include!(concat!(env!("OUT_DIR"), "/scene.rs"));
napi_enum!(ImageFit, BrushKind);
