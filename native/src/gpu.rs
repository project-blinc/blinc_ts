mod runtime { pub use xidl_node::*; }
mod handles { pub use xgpu_core::{Slab, kind_of}; }
mod types { pub use xgpu_core::Kind; }
#[allow(unused_imports)]
use runtime::{Buffer, BufferMut, Enum, ErrorKind, Future, NativeEnum, Rooted, Text, host};
mod backend { include!(concat!(env!("OUT_DIR"), "/xgpu_backend/backend.rs")); }
include!(concat!(env!("OUT_DIR"), "/gpu.rs"));
