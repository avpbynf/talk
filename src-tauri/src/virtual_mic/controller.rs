use thiserror::Error;

use super::detector::detect_vbcable;
use super::router::{AudioRouter, AudioRouterError, RouteEnd};

#[derive(Error, Debug)]
pub enum VirtualMicError {
    #[error("VB-Cable is not installed")]
    VBCableNotInstalled,
    #[error("Router error: {0}")]
    Router(#[from] AudioRouterError),
    #[error("The microphone or the virtual cable stopped answering")]
    Lost,
}

/// High-level control API for the virtual mic routing.
pub struct VirtualMicController {
    router: Option<AudioRouter>,
    /// Why the last attempt to route did not start.
    refusal: Option<String>,
}

impl VirtualMicController {
    pub fn new() -> Self {
        Self { router: None, refusal: None }
    }

    /// Enable meeting mode: start routing the named microphone, or the system
    /// default, to VB-Cable, in place of whatever was routed before, and silent from
    /// the start when `muted`, which is what a route opened during a dictation has
    /// to be. `on_end` is called if the route stops doing that later on.
    pub fn enable(
        &mut self,
        microphone: Option<&str>,
        muted: bool,
        on_end: impl Fn(RouteEnd) + Send + Sync + 'static,
    ) -> Result<(), VirtualMicError> {
        self.disable();
        match Self::open(microphone, muted, on_end) {
            Ok(router) => {
                self.router = Some(router);
                Ok(())
            }
            Err(e) => {
                self.refusal = Some(e.to_string());
                Err(e)
            }
        }
    }

    fn open(
        microphone: Option<&str>,
        muted: bool,
        on_end: impl Fn(RouteEnd) + Send + Sync + 'static,
    ) -> Result<AudioRouter, VirtualMicError> {
        if !detect_vbcable().installed {
            return Err(VirtualMicError::VBCableNotInstalled);
        }
        Ok(AudioRouter::start(microphone, muted, on_end)?)
    }

    /// Disable meeting mode: stop routing.
    pub fn disable(&mut self) {
        self.refusal = None;
        if let Some(router) = self.router.take() {
            router.stop();
        }
    }

    /// Mute the virtual mic (write silence to VB-Cable).
    pub fn mute(&self) {
        if let Some(ref router) = self.router {
            router.mute();
        }
    }

    /// Unmute the virtual mic (resume forwarding real audio).
    pub fn unmute(&self) {
        if let Some(ref router) = self.router {
            router.unmute();
        }
    }

    /// Check if meeting mode is active: a route was started and has not failed since.
    pub fn is_active(&self) -> bool {
        self.router.as_ref().is_some_and(|r| !r.is_lost())
    }

    /// The microphone being routed, by the name Windows gives it.
    pub fn microphone(&self) -> Option<String> {
        self.router.as_ref().map(|r| r.microphone().to_string())
    }

    /// Why nothing is routed although it was asked for: the start was refused, or
    /// the route failed afterwards.
    pub fn failure(&self) -> Option<String> {
        match &self.router {
            Some(router) if router.is_lost() => Some(VirtualMicError::Lost.to_string()),
            Some(_) => None,
            None => self.refusal.clone(),
        }
    }

    /// Check if currently muted.
    pub fn is_muted(&self) -> bool {
        self.router
            .as_ref()
            .map(|r| r.is_muted())
            .unwrap_or(false)
    }
}

impl Default for VirtualMicController {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_controller_is_inactive() {
        let ctrl = VirtualMicController::new();
        assert!(!ctrl.is_active());
        assert!(!ctrl.is_muted());
        assert!(ctrl.microphone().is_none());
        assert!(ctrl.failure().is_none());
    }

    #[test]
    fn disable_when_inactive_is_noop() {
        let mut ctrl = VirtualMicController::new();
        ctrl.disable();
        assert!(!ctrl.is_active());
    }

    #[test]
    fn mute_unmute_when_inactive_is_noop() {
        let ctrl = VirtualMicController::new();
        ctrl.mute();
        ctrl.unmute();
        assert!(!ctrl.is_muted());
    }
}
