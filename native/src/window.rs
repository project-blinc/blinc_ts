mod runtime { pub use xidl_node::*; }
#[allow(unused_imports)]
use runtime::{Buffer, BufferMut, Enum, ErrorKind, Future, NativeEnum, Rooted, Text, host};
pub(crate) mod backend { include!(concat!(env!("OUT_DIR"), "/xwindow_backend/native.rs")); }
include!(concat!(env!("OUT_DIR"), "/window.rs"));
