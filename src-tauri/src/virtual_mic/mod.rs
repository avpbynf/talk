#[cfg(target_os = "macos")]
pub mod blackhole;
#[cfg(target_os = "macos")]
pub mod system_default;
mod controller;
mod detector;
mod router;

pub use controller::VirtualMicController;
pub use detector::{detect_vbcable, VBCableStatus};
pub use router::RouteEnd;
