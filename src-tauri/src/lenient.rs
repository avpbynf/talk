//! Reading a settings document one field at a time.
//!
//! A struct deserialised whole fails whole: one string where a number belongs,
//! or a variant written by a newer build, and the server address, the token and
//! the vocabulary go with it. Here the document is read as an object, tried
//! whole first, and when that fails each field is tried on its own on top of
//! the defaults: one that does not fit keeps its default and is named. Keys the
//! struct does not know are left to serde, which ignores them, as before;
//! aliases and renames keep working because each field goes through the
//! struct's own deserialiser.
//!
//! A field refused here, like one the struct's own lenient helpers refused, is a
//! reason for the owner of the file to set the original aside and rewrite it.

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

/// The struct read from the document, and the names of the fields that were
/// replaced by their defaults. Only a document that is not an object fails.
pub fn read_fields<T>(what: &str, document: Value) -> Result<(T, Vec<String>), String>
where
    T: DeserializeOwned + Serialize + Default,
{
    let Value::Object(fields) = document else {
        return Err("not a JSON object".to_string());
    };
    if let Ok(whole) = serde_json::from_value::<T>(Value::Object(fields.clone())) {
        return Ok((whole, Vec::new()));
    }

    let mut accepted = match serde_json::to_value(T::default()) {
        Ok(Value::Object(defaults)) => defaults,
        _ => return Err("the defaults are not an object".to_string()),
    };
    let mut refused = Vec::new();
    for (key, value) in fields {
        let before = accepted.insert(key.clone(), value);
        if serde_json::from_value::<T>(Value::Object(accepted.clone())).is_err() {
            match before {
                Some(default) => accepted.insert(key.clone(), default),
                None => accepted.remove(&key),
            };
            refused.push(key);
        }
    }
    if !refused.is_empty() {
        eprintln!("The {} file has fields that could not be read, which take their defaults: {}", what, refused.join(", "));
    }
    let value = serde_json::from_value::<T>(Value::Object(accepted)).map_err(|e| e.to_string())?;
    Ok((value, refused))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Serialize, Deserialize, PartialEq)]
    struct Sample {
        #[serde(default = "twenty")]
        percent: u8,
        #[serde(default)]
        name: String,
    }

    fn twenty() -> u8 {
        20
    }

    impl Default for Sample {
        fn default() -> Self {
            Sample { percent: 20, name: String::new() }
        }
    }

    #[test]
    fn a_field_that_does_not_fit_takes_its_default_and_is_named() {
        let document = serde_json::json!({"percent": 300, "name": "nas", "from_the_future": true});

        let (value, refused) = read_fields::<Sample>("test", document).unwrap();

        assert_eq!(value, Sample { percent: 20, name: "nas".to_string() });
        assert_eq!(refused, vec!["percent".to_string()]);
    }

    #[test]
    fn a_document_where_everything_fits_names_nothing() {
        let (value, refused) = read_fields::<Sample>("test", serde_json::json!({"percent": 30, "x": 1})).unwrap();

        assert_eq!(value.percent, 30);
        assert!(refused.is_empty());
    }

    #[test]
    fn a_document_that_is_not_an_object_is_refused_whole() {
        assert!(read_fields::<Sample>("test", serde_json::json!([1, 2])).is_err());
    }
}
