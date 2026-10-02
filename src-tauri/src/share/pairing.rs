use rand::rngs::OsRng;
use rand::{Rng, RngCore};
use serde::Serialize;
use std::collections::HashMap;
use std::time::Instant;
use subtle::ConstantTimeEq;

pub const REQUEST_TTL_SECONDS: u64 = 120;
pub const MAX_PENDING: usize = 5;
pub const MAX_ATTEMPTS: u32 = 5;
// Across every request, for the life of the process. Five attempts per request
// bound nothing on their own: dropping a request frees its slot, and opening a
// new one costs nothing, so a caller could cycle through requests until one of
// a million codes came up. Ten wrong codes in total leaves a chance in a
// hundred thousand, and then pairing stays off until the application restarts.
pub const MAX_FAILED_CODES: u32 = 10;

#[derive(Debug, PartialEq)]
pub enum PairingError {
    /// Too many requests are pending
    Full,
    /// Unknown, expired, or out of attempts
    Gone,
    /// The code does not match
    WrongCode,
    /// Too many wrong codes: pairing is off until the application restarts
    Locked,
}

struct PairingRequest {
    id: String,
    client_name: String,
    code: String,
    expires_at: f64,
    client_host: Option<String>,
    attempts: u32,
}

/// What the owner of this PC sees beside a request: who is asking, and the
/// code to read out to them
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPairing {
    pub request_id: String,
    pub client_name: String,
    pub code: String,
    pub seconds_left: u64,
}

/// A pending request that was opened, as the route answers it
#[derive(Debug, PartialEq)]
pub struct Opened {
    pub request_id: String,
}

/// Pending pairing requests, kept in memory only. A restart drops them, which
/// is fine for a code that lives two minutes.
pub struct PairingStore {
    clock: Box<dyn Fn() -> f64 + Send + Sync>,
    pending: HashMap<String, PairingRequest>,
    failed_codes: u32,
}

impl Default for PairingStore {
    fn default() -> Self {
        let origin = Instant::now();
        Self::new(move || origin.elapsed().as_secs_f64())
    }
}

fn random_code() -> String {
    format!("{:06}", OsRng.gen_range(0..1_000_000u32))
}

fn random_id() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

impl PairingStore {
    pub fn new(clock: impl Fn() -> f64 + Send + Sync + 'static) -> Self {
        Self {
            clock: Box::new(clock),
            pending: HashMap::new(),
            failed_codes: 0,
        }
    }

    pub fn locked(&self) -> bool {
        self.failed_codes >= MAX_FAILED_CODES
    }

    fn purge(&mut self) {
        let now = (self.clock)();
        self.pending.retain(|_, request| request.expires_at > now);
    }

    /// Drop everything pending, as when sharing is turned off
    pub fn clear(&mut self) {
        self.pending.clear();
    }

    /// Open a request with a fresh 6 digit code.
    ///
    /// A machine holds one request at a time: asking again replaces the
    /// previous one, so a single machine cannot fill every slot and keep
    /// everybody else out.
    pub fn create(&mut self, client_name: &str, client_host: Option<&str>) -> Result<Opened, PairingError> {
        if self.locked() {
            return Err(PairingError::Locked);
        }
        self.purge();
        if let Some(host) = client_host {
            self.pending
                .retain(|_, request| request.client_host.as_deref() != Some(host));
        }
        if self.pending.len() >= MAX_PENDING {
            return Err(PairingError::Full);
        }

        let request = PairingRequest {
            id: random_id(),
            client_name: client_name.to_string(),
            code: random_code(),
            expires_at: (self.clock)() + REQUEST_TTL_SECONDS as f64,
            client_host: client_host.map(str::to_string),
            attempts: 0,
        };
        let opened = Opened { request_id: request.id.clone() };
        self.pending.insert(request.id.clone(), request);
        Ok(opened)
    }

    /// Check a code and consume the request when it matches, handing back the
    /// name of the machine that asked.
    pub fn confirm(&mut self, request_id: &str, code: &str) -> Result<String, PairingError> {
        if self.locked() {
            return Err(PairingError::Locked);
        }
        self.purge();
        let Some(request) = self.pending.get_mut(request_id) else {
            return Err(PairingError::Gone);
        };

        if bool::from(code.as_bytes().ct_eq(request.code.as_bytes())) {
            let name = request.client_name.clone();
            self.pending.remove(request_id);
            return Ok(name);
        }

        request.attempts += 1;
        let exhausted = request.attempts >= MAX_ATTEMPTS;
        self.failed_codes += 1;
        if self.locked() {
            self.pending.clear();
            eprintln!(
                "Pairing turned off after {} wrong codes, restart the application to turn it back on",
                MAX_FAILED_CODES
            );
        } else if exhausted {
            self.pending.remove(request_id);
        }
        Err(PairingError::WrongCode)
    }

    /// Live requests with the whole seconds each has left, oldest first
    pub fn pending(&mut self) -> Vec<PendingPairing> {
        self.purge();
        let now = (self.clock)();
        let mut live: Vec<(f64, PendingPairing)> = self
            .pending
            .values()
            .map(|request| {
                (
                    request.expires_at,
                    PendingPairing {
                        request_id: request.id.clone(),
                        client_name: request.client_name.clone(),
                        code: request.code.clone(),
                        seconds_left: (request.expires_at - now).max(0.0) as u64,
                    },
                )
            })
            .collect();
        live.sort_by(|a, b| a.0.total_cmp(&b.0));
        live.into_iter().map(|(_, pending)| pending).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn store() -> (PairingStore, Arc<Mutex<f64>>) {
        let now = Arc::new(Mutex::new(1000.0));
        let clock = now.clone();
        (PairingStore::new(move || *clock.lock().unwrap()), now)
    }

    fn code_of(store: &mut PairingStore, name: &str) -> String {
        store
            .pending()
            .into_iter()
            .find(|p| p.client_name == name)
            .expect("request should be pending")
            .code
    }

    fn wrong_code(right: &str) -> &'static str {
        if right != "000000" {
            "000000"
        } else {
            "111111"
        }
    }

    #[test]
    fn the_right_code_trades_for_the_name_once() {
        let (mut store, _) = store();
        let opened = store.create("Laptop", Some("10.0.0.2")).unwrap();
        let code = code_of(&mut store, "Laptop");

        assert_eq!(store.confirm(&opened.request_id, &code), Ok("Laptop".to_string()));
        assert_eq!(store.confirm(&opened.request_id, "000000"), Err(PairingError::Gone));
    }

    #[test]
    fn a_code_is_six_digits() {
        for _ in 0..200 {
            let code = random_code();
            assert_eq!(code.len(), 6);
            assert!(code.chars().all(|c| c.is_ascii_digit()));
        }
    }

    #[test]
    fn five_wrong_codes_drop_the_request_even_for_the_right_one() {
        let (mut store, _) = store();
        let opened = store.create("Laptop", None).unwrap();
        let right = code_of(&mut store, "Laptop");

        for _ in 0..MAX_ATTEMPTS {
            assert_eq!(
                store.confirm(&opened.request_id, wrong_code(&right)),
                Err(PairingError::WrongCode)
            );
        }
        assert_eq!(store.confirm(&opened.request_id, &right), Err(PairingError::Gone));
    }

    #[test]
    fn fewer_wrong_codes_leave_the_request_alive() {
        let (mut store, _) = store();
        let opened = store.create("Laptop", None).unwrap();
        let right = code_of(&mut store, "Laptop");

        for _ in 0..MAX_ATTEMPTS - 1 {
            let _ = store.confirm(&opened.request_id, wrong_code(&right));
        }
        assert_eq!(store.confirm(&opened.request_id, &right), Ok("Laptop".to_string()));
    }

    #[test]
    fn an_unknown_request_is_gone() {
        let (mut store, _) = store();

        assert_eq!(store.confirm("nope", "123456"), Err(PairingError::Gone));
    }

    #[test]
    fn a_request_expires_after_two_minutes() {
        let (mut store, now) = store();
        let opened = store.create("Laptop", None).unwrap();
        let code = code_of(&mut store, "Laptop");

        *now.lock().unwrap() += 121.0;

        assert_eq!(store.confirm(&opened.request_id, &code), Err(PairingError::Gone));
    }

    #[test]
    fn the_pending_cap_purges_what_expired_first() {
        let (mut store, now) = store();
        for n in 0..MAX_PENDING {
            store.create(&format!("c{}", n), Some(&format!("10.0.0.{}", n))).unwrap();
        }
        assert_eq!(store.create("late", Some("10.0.0.9")), Err(PairingError::Full));

        *now.lock().unwrap() += 121.0;

        assert!(store.create("late", Some("10.0.0.9")).is_ok());
    }

    #[test]
    fn a_machine_holds_one_request_at_a_time() {
        let (mut store, _) = store();
        let first = store.create("Laptop", Some("10.0.0.2")).unwrap();
        store.create("Laptop", Some("10.0.0.2")).unwrap();

        assert_eq!(store.confirm(&first.request_id, "000000"), Err(PairingError::Gone));
        assert_eq!(store.pending().len(), 1);
    }

    #[test]
    fn a_machine_that_cannot_be_told_apart_does_not_replace_the_others() {
        let (mut store, _) = store();
        store.create("A", None).unwrap();
        store.create("B", None).unwrap();

        assert_eq!(store.pending().len(), 2);
    }

    #[test]
    fn wrong_codes_across_requests_turn_pairing_off() {
        let (mut store, _) = store();
        for n in 0..MAX_FAILED_CODES / MAX_ATTEMPTS {
            let opened = store.create("Laptop", Some(&format!("10.0.0.{}", n))).unwrap();
            let right = code_of(&mut store, "Laptop");
            for _ in 0..MAX_ATTEMPTS {
                let _ = store.confirm(&opened.request_id, wrong_code(&right));
            }
        }

        assert!(store.locked());
        assert_eq!(store.create("Laptop", None), Err(PairingError::Locked));
        assert_eq!(store.confirm("anything", "123456"), Err(PairingError::Locked));
    }

    #[test]
    fn the_lock_drops_what_was_pending() {
        let (mut store, _) = store();
        store.create("Desk", Some("10.0.0.9")).unwrap();
        let opened = store.create("Laptop", Some("10.0.0.2")).unwrap();
        let right = code_of(&mut store, "Laptop");
        store.failed_codes = MAX_FAILED_CODES - 1;

        let _ = store.confirm(&opened.request_id, wrong_code(&right));

        assert!(store.locked());
        assert!(store.pending().is_empty());
    }

    #[test]
    fn the_time_left_counts_down() {
        let (mut store, now) = store();
        store.create("Desk", None).unwrap();

        *now.lock().unwrap() += 30.0;

        let pending = store.pending();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].client_name, "Desk");
        assert_eq!(pending[0].seconds_left, 90);
    }

    #[test]
    fn clearing_drops_every_pending_request() {
        let (mut store, _) = store();
        store.create("Desk", None).unwrap();

        store.clear();

        assert!(store.pending().is_empty());
    }
}
