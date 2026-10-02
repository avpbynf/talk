//! The vocabulary as a set that merges, instead of a list one machine replaces.
//!
//! Each term carries the time it was last added and, when somebody removed it,
//! the time of that removal. A term is in the set while its latest add is not
//! older than its latest removal, on whichever machine they happened, and two
//! machines that merge keep every term either of them added since the other
//! removed it.
//!
//! A removal is only ever written for a term somebody removed by name. A list
//! that turns up shorter than it was, empty or defaulted included, says nothing
//! about the terms it lacks, so no list can turn into deletions.
//!
//! Times are stamped so that a change always lands after everything this
//! machine has seen for the term, whatever its clock says: a machine whose
//! clock runs an hour behind still wins over a removal it has already merged.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

/// How long a removal is remembered. A machine that stays away longer than
/// this may bring a removed term back, which costs a word and not a list.
const TOMBSTONE_TTL_MS: i64 = 90 * 24 * 60 * 60 * 1000;

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct VocabLedger {
    pub added: BTreeMap<String, i64>,
    pub removed: BTreeMap<String, i64>,
}

impl VocabLedger {
    /// Equal times count as alive: losing a word is the worse mistake.
    fn is_live(&self, term: &str) -> bool {
        match self.added.get(term) {
            Some(added) => self.removed.get(term).map_or(true, |removed| added >= removed),
            None => false,
        }
    }

    /// A time after anything seen for this term, and not before the clock.
    fn stamp(&self, term: &str, now: i64) -> i64 {
        let seen = self.added.get(term).max(self.removed.get(term));
        seen.map_or(now, |seen| now.max(seen + 1))
    }

    /// A term somebody put in the list. Nothing happens to one already in it.
    pub fn add(&mut self, term: &str, now: i64) {
        if !self.is_live(term) {
            let at = self.stamp(term, now);
            self.added.insert(term.to_string(), at);
        }
    }

    /// A term somebody removed by name.
    pub fn remove(&mut self, term: &str, now: i64) {
        if self.is_live(term) || !self.removed.contains_key(term) {
            let at = self.stamp(term, now);
            self.removed.insert(term.to_string(), at);
        }
    }

    /// Terms in the list that this ledger has never heard of, as a settings
    /// file from before the ledger holds. They count as added now.
    pub fn learn(&mut self, list: &[String], now: i64) {
        for term in list {
            if !self.added.contains_key(term) {
                let at = self.stamp(term, now);
                self.added.insert(term.clone(), at);
            }
        }
    }

    /// Take in everything another copy of the ledger knows.
    pub fn absorb(&mut self, other: &VocabLedger) {
        for (term, at) in &other.added {
            let entry = self.added.entry(term.clone()).or_insert(*at);
            *entry = (*entry).max(*at);
        }
        for (term, at) in &other.removed {
            let entry = self.removed.entry(term.clone()).or_insert(*at);
            *entry = (*entry).max(*at);
        }
    }

    fn forget_old_removals(&mut self, now: i64) {
        let stale: Vec<String> = self
            .removed
            .iter()
            .filter(|(term, at)| now - **at > TOMBSTONE_TTL_MS && !self.is_live(term))
            .map(|(term, _)| term.clone())
            .collect();
        for term in stale {
            self.removed.remove(&term);
            self.added.remove(&term);
        }
    }
}

/// Merge this machine's list and ledger with the account's. The list comes
/// back in this machine's order, with the terms it did not have appended.
///
/// A list from an older build has no ledger: its terms count as added when
/// the file was written.
pub fn merge(
    local: &[String],
    local_ledger: &VocabLedger,
    remote: &[String],
    remote_ledger: &VocabLedger,
    remote_updated_at: i64,
    now: i64,
) -> (Vec<String>, VocabLedger) {
    let mut ledger = local_ledger.clone();
    ledger.learn(local, now);
    let mut remote_ledger = remote_ledger.clone();
    for term in remote {
        remote_ledger.added.entry(term.clone()).or_insert(remote_updated_at);
    }
    ledger.absorb(&remote_ledger);
    ledger.forget_old_removals(now);

    let mut merged: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    let others = remote.iter().chain(ledger.added.keys());
    for term in local.iter().chain(others) {
        if ledger.is_live(term) && seen.insert(term.clone()) {
            merged.push(term.clone());
        }
    }
    (merged, ledger)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR: i64 = 60 * 60 * 1000;

    fn terms(list: &[&str]) -> Vec<String> {
        list.iter().map(|t| t.to_string()).collect()
    }

    fn ledger_of(current: &[&str], at: i64) -> VocabLedger {
        let mut ledger = VocabLedger::default();
        ledger.learn(&terms(current), at);
        ledger
    }

    #[test]
    fn two_machines_with_terms_merge_to_the_union() {
        let (merged, _) =
            merge(&terms(&["a", "b"]), &ledger_of(&["a", "b"], 10), &terms(&["b", "c"]), &ledger_of(&["b", "c"], 20), 20, 30);
        assert_eq!(merged, terms(&["a", "b", "c"]));
    }

    #[test]
    fn a_removal_on_one_machine_reaches_the_other() {
        let mut remote = ledger_of(&["a", "b"], 10);
        remote.remove("a", 20);
        let (merged, ledger) = merge(&terms(&["a", "b"]), &ledger_of(&["a", "b"], 10), &terms(&["b"]), &remote, 20, 30);
        assert_eq!(merged, terms(&["b"]));
        assert!(!ledger.is_live("a"));
    }

    #[test]
    fn an_empty_or_defaulted_list_never_removes_a_term_elsewhere() {
        let full = ledger_of(&["a", "b"], 10);
        let (here, _) = merge(&terms(&["a", "b"]), &full, &[], &VocabLedger::default(), 0, 30);
        assert_eq!(here, terms(&["a", "b"]));
        let (there, _) = merge(&[], &VocabLedger::default(), &terms(&["a", "b"]), &full, 10, 30);
        assert_eq!(there, terms(&["a", "b"]));
    }

    #[test]
    fn a_term_added_again_survives_a_remover_whose_clock_is_an_hour_ahead() {
        let mut a = ledger_of(&["x"], 1_000);
        a.remove("x", 1_000 + HOUR);
        let (_, mut b) = merge(&[], &VocabLedger::default(), &[], &a, 0, 2_000);
        b.add("x", 2_000);
        let (merged, _) = merge(&terms(&["x"]), &b, &[], &a, 0, 3_000);
        assert_eq!(merged, terms(&["x"]));
        let (on_a, _) = merge(&[], &a, &terms(&["x"]), &b, 2_000, 1_000 + HOUR);
        assert_eq!(on_a, terms(&["x"]));
    }

    #[test]
    fn equal_times_keep_the_term() {
        let mut remote = VocabLedger::default();
        remote.removed.insert("a".to_string(), 10);
        let (merged, _) = merge(&terms(&["a"]), &ledger_of(&["a"], 10), &[], &remote, 10, 20);
        assert_eq!(merged, terms(&["a"]));
    }

    #[test]
    fn terms_from_a_file_without_a_ledger_survive_a_remote_that_removed_nothing() {
        let (merged, ledger) = merge(&terms(&["x", "y"]), &VocabLedger::default(), &terms(&["z"]), &VocabLedger::default(), 5, 100);
        assert_eq!(merged, terms(&["x", "y", "z"]));
        assert!(ledger.is_live("x"));
    }

    #[test]
    fn a_term_with_no_ledger_entry_beats_an_older_removal_it_never_saw() {
        let mut remote = VocabLedger::default();
        remote.removed.insert("x".to_string(), 10);
        let (merged, _) = merge(&terms(&["x"]), &VocabLedger::default(), &[], &remote, 10, 100);
        assert_eq!(merged, terms(&["x"]));
    }

    #[test]
    fn adding_a_known_term_changes_nothing() {
        let mut ledger = ledger_of(&["a"], 10);
        let before = ledger.clone();
        ledger.add("a", 50);
        assert_eq!(ledger, before);
    }

    #[test]
    fn old_removals_are_forgotten() {
        let mut ledger = ledger_of(&["a"], 10);
        ledger.remove("a", 20);
        let (_, merged) = merge(&[], &ledger, &[], &VocabLedger::default(), 0, 20 + TOMBSTONE_TTL_MS + 1);
        assert!(merged.removed.is_empty() && merged.added.is_empty());
    }

    #[test]
    fn a_ledger_from_an_older_build_parses() {
        let parsed: VocabLedger = serde_json::from_str("{}").expect("should parse");
        assert_eq!(parsed, VocabLedger::default());
    }
}
