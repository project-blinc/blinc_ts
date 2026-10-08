use std::path::PathBuf;
fn main() {
    napi_build::setup();
    println!("cargo:rustc-env=BLINC_BUILD_PROFILE={}",std::env::var("PROFILE").unwrap());
    let out = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    xgpu_backend::install_scoped(&out, "crate::gpu").unwrap();
    xwindow_backend::install_scoped(&out, "crate::window").unwrap();
    let gpu = x_idl::node::generate_with_entrypoint("gpu", xgpu_bindgen::gpu_api(), xgpu_bindgen::WEBGPU_IDL, "gpu_call").unwrap();
    let window = x_idl::node::generate_with_entrypoint("window", xwindow_bindgen::window_api(), &xwindow_bindgen::browser_idl(), "window_call").unwrap();
    let layout = x_idl::node::generate_with_entrypoint("layout", include_str!("api/layout.rs"), "", "layout_call").unwrap();
    let scene = x_idl::node::generate_with_entrypoint("scene", include_str!("api/scene.rs"), "", "scene_call").unwrap();
    let generated = PathBuf::from("../src/native/generated");
    std::fs::create_dir_all(&generated).unwrap();
    for (name, binding) in [("gpu", gpu), ("window", window), ("layout", layout), ("scene", scene)] {
        std::fs::write(out.join(format!("{name}.rs")), binding.rust).unwrap();
        let path = generated.join(format!("{name}.ts"));
        if std::fs::read_to_string(&path).ok().as_deref() != Some(&binding.typescript) {
            std::fs::write(path, binding.typescript).unwrap();
        }
    }
    println!("cargo:rerun-if-changed=api/layout.rs");
    println!("cargo:rerun-if-changed=api/scene.rs");
    println!("cargo:rerun-if-changed=../../xgpu/api");
    println!("cargo:rerun-if-changed=../../xwindow/api");
}
