//! A shared file of the account as this computer finds it. What it holds decides
//! whether anything may be uploaded over it, so the cases are told apart by type:
//! only a file that is missing, or that Drive itself lists as empty, lets a sync
//! start from "the account has nothing yet". A file that is there and cannot be
//! read may be written by a newer version, or cut short in the download, and is
//! never written over.

use super::drive::{Drive, DriveFile};
use super::failure::{Failure, SyncError};

/// What came off Drive, before anyone tried to read it.
#[derive(Clone)]
pub enum Fetched {
    Absent,
    /// The listing gives the file a size of zero: what a create that never got
    /// its content leaves behind. Nothing was downloaded.
    Empty,
    Body(String),
}

impl Fetched {
    pub async fn from_drive(drive: &Drive, file: Option<&DriveFile>) -> Result<Self, SyncError> {
        match file {
            None => Ok(Fetched::Absent),
            Some(file) if file.is_empty_on_drive() => Ok(Fetched::Empty),
            Some(file) => Ok(Fetched::Body(drive.download(&file.id).await?)),
        }
    }

    /// `unreadable` is the failure a file that is there and does not read ends the round with.
    pub fn read<T>(
        self,
        name: &str,
        unreadable: Failure,
        parse: impl FnOnce(&str) -> Result<T, String>,
    ) -> Remote<T> {
        match self {
            Fetched::Absent => Remote::Absent,
            Fetched::Empty => Remote::Empty,
            Fetched::Body(body) => match read_remote(name, &body, parse) {
                Ok(value) => Remote::Parsed(value),
                Err(why) => Remote::Unreadable(unreadable, why),
            },
        }
    }
}

pub enum Remote<T> {
    Absent,
    Empty,
    Unreadable(Failure, String),
    Parsed(T),
}

/// Proof that the remote file was read, or is known to hold nothing. Only
/// `Remote::usable` makes one, so no step that follows a successful read can run
/// ahead of it: marking a round as synced asks for this.
#[derive(Debug, Clone, Copy)]
pub struct ReadProof(());

pub struct Usable<'a, T> {
    /// `None` for an account that holds nothing, the value when it holds one.
    pub value: Option<&'a T>,
    pub proof: ReadProof,
}

impl<T> Remote<T> {
    /// What a plan may start from: `None` for an account that holds nothing, the
    /// value when it holds one, and an error, never `None`, for a file that is
    /// there and cannot be read.
    pub fn usable(&self) -> Result<Usable<'_, T>, SyncError> {
        let proof = ReadProof(());
        match self {
            Remote::Absent | Remote::Empty => Ok(Usable { value: None, proof }),
            Remote::Parsed(value) => Ok(Usable { value: Some(value), proof }),
            Remote::Unreadable(failure, why) => Err(SyncError::new(*failure, why.clone())),
        }
    }

    pub fn into_usable(self) -> Result<Option<T>, SyncError> {
        match self {
            Remote::Unreadable(failure, why) => Err(SyncError::new(failure, why)),
            Remote::Parsed(value) => Ok(Some(value)),
            Remote::Absent | Remote::Empty => Ok(None),
        }
    }
}

/// Read a file from the account. An empty body, a cut one and one that is not
/// the shape this build writes all come back as an error naming the file.
pub fn read_remote<T>(
    name: &str,
    body: &str,
    parse: impl FnOnce(&str) -> Result<T, String>,
) -> Result<T, String> {
    if body.trim().is_empty() {
        return Err(format!("{}: the file came back empty", name));
    }
    parse(body).map_err(|e| format!("{}: {}", name, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    const UNREADABLE: [&str; 6] = ["", "  \n", r#"{"updated_at": 5, "settings": {"#, "[1, 2, 3]", r#""text""#, "<html>Sign in</html>"];

    fn parse_map(body: &str) -> Result<std::collections::BTreeMap<String, i64>, String> {
        serde_json::from_str(body).map_err(|e| e.to_string())
    }

    #[test]
    fn a_missing_file_or_one_listed_as_empty_is_an_account_with_nothing() {
        for fetched in [Fetched::Absent, Fetched::Empty] {
            let remote = fetched.read("devices.json", Failure::RemoteDevicesUnreadable, parse_map);
            assert!(matches!(remote.usable(), Ok(u) if u.value.is_none()));
            assert!(matches!(remote.into_usable(), Ok(None)));
        }
    }

    #[test]
    fn a_file_that_is_there_and_does_not_read_is_never_an_account_with_nothing() {
        for body in UNREADABLE {
            let remote = Fetched::Body(body.to_string()).read("devices.json", Failure::RemoteDevicesUnreadable, parse_map);
            let error = remote.usable().err().expect(body);
            assert_eq!(error.failure, Failure::RemoteDevicesUnreadable);
            assert!(error.detail.starts_with("devices.json: "), "{}", error.detail);
            assert_eq!(remote.into_usable().unwrap_err().failure, Failure::RemoteDevicesUnreadable);
        }
    }

    #[test]
    fn a_body_of_the_wrong_shape_does_not_read() {
        let remote = Fetched::Body(r#"{"a": "not a number"}"#.to_string())
            .read("devices.json", Failure::RemoteUnreadable, parse_map);
        assert_eq!(remote.usable().err().unwrap().failure, Failure::RemoteUnreadable);
    }

    #[test]
    fn a_file_that_reads_is_handed_over() {
        let remote = Fetched::Body(r#"{"a": 1}"#.to_string()).read("devices.json", Failure::RemoteUnreadable, parse_map);
        assert_eq!(remote.usable().unwrap().value.map(|m| m["a"]), Some(1));
    }
}
