use crate::database::Database;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};

/// A new token and its hash. Only the hash is ever stored.
fn generate() -> (String, String) {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let plain = format!("sk_{}", URL_SAFE_NO_PAD.encode(bytes));
    let hashed = hash(&plain);
    (plain, hashed)
}

pub fn hash(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Mint a token for a paired machine and hand back its plain value, which is
/// the only time it exists outside the machine that asked.
pub fn mint(db: &Database, name: &str) -> Result<String, String> {
    let (plain, hashed) = generate();
    let id = uuid::Uuid::new_v4().to_string();
    db.add_share_token(&id, name, &hashed, &now())
        .map_err(|e| e.to_string())?;
    Ok(plain)
}

/// Whether the token belongs to a paired machine that was not revoked.
///
/// The lookup is by hash, so no comparison of secrets happens here: the
/// database finds the row or it does not. `count_usage` stamps the device as
/// having been used, which the polling of /v1/models must not do.
pub fn verify(db: &Database, token: &str, count_usage: bool) -> Result<bool, String> {
    let Some(id) = db.find_share_token(&hash(token)).map_err(|e| e.to_string())? else {
        return Ok(false);
    };
    if count_usage {
        db.touch_share_token(&id, &now()).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn db() -> Database {
        Database::open(Path::new(":memory:")).expect("should open")
    }

    #[test]
    fn the_hash_is_the_sha256_in_hex() {
        assert_eq!(
            hash("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn a_minted_token_is_checked_and_a_stranger_is_not() {
        let db = db();
        let plain = mint(&db, "Laptop (paired)").unwrap();

        assert!(plain.starts_with("sk_"));
        assert!(verify(&db, &plain, false).unwrap());
        assert!(!verify(&db, "sk_not-the-one", false).unwrap());
        assert!(!verify(&db, "", false).unwrap());
    }

    #[test]
    fn two_tokens_never_collide() {
        let db = db();

        assert_ne!(mint(&db, "a").unwrap(), mint(&db, "b").unwrap());
        assert_eq!(db.list_share_tokens().unwrap().len(), 2);
    }

    #[test]
    fn the_plain_token_is_not_what_gets_stored() {
        let db = db();
        let plain = mint(&db, "Laptop").unwrap();

        assert!(db.find_share_token(&plain).unwrap().is_none());
        assert!(db.find_share_token(&hash(&plain)).unwrap().is_some());
    }

    #[test]
    fn only_a_counted_check_stamps_the_last_use() {
        let db = db();
        let plain = mint(&db, "Laptop").unwrap();

        verify(&db, &plain, false).unwrap();
        assert_eq!(db.list_share_tokens().unwrap()[0].last_used_at, None);

        verify(&db, &plain, true).unwrap();
        assert!(db.list_share_tokens().unwrap()[0].last_used_at.is_some());
    }

    #[test]
    fn a_revoked_token_stops_working() {
        let db = db();
        let plain = mint(&db, "Laptop").unwrap();
        let id = db.list_share_tokens().unwrap()[0].id.clone();

        assert!(db.revoke_share_token(&id).unwrap());

        assert!(!verify(&db, &plain, false).unwrap());
        assert!(!db.revoke_share_token(&id).unwrap());
    }
}
