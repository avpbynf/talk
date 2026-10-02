use mdns_sd::{ResolvedService, ServiceDaemon, ServiceEvent};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::net::Ipv4Addr;
use tauri::{AppHandle, Emitter, Manager};

const SERVICE_TYPE: &str = "_talk._tcp.local.";

/// A Talk-Server that announced itself on the local network
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DiscoveredServer {
    /// The instance's full mDNS name, which stays the same across restarts
    pub id: String,
    pub name: String,
    pub url: String,
    pub version: Option<String>,
    pub model: Option<String>,
    /// Whether the server accepts pairing requests, from the `pairing` TXT key
    pub pairing: bool,
}

/// The servers currently on the network, shared with the commands
#[derive(Default)]
pub struct Discovery {
    servers: Mutex<HashMap<String, DiscoveredServer>>,
    /// The instance name this PC announces while it shares its engine. It
    /// answers its own browse like any other machine and must not be offered
    /// as a server to itself.
    own: Mutex<Option<String>>,
}

impl Discovery {
    /// Sorted by name so the page does not reshuffle when a server re-announces
    pub fn list(&self) -> Vec<DiscoveredServer> {
        let mut servers: Vec<_> = self.servers.lock().values().cloned().collect();
        servers.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
        servers
    }

    /// Name the announcement that is this machine's own, or none once it stops.
    /// Returns whether the list changed, since an entry already listed goes.
    pub fn set_own(&self, fullname: Option<String>) -> bool {
        let mut servers = self.servers.lock();
        let before = servers.len();
        if let Some(name) = &fullname {
            servers.retain(|id, _| !id.eq_ignore_ascii_case(name));
        }
        let removed = servers.len() != before;
        drop(servers);
        *self.own.lock() = fullname;
        removed
    }

    fn is_own(&self, id: &str) -> bool {
        // DNS names do not distinguish case, and a resolver may fold it
        self.own
            .lock()
            .as_deref()
            .is_some_and(|own| own.eq_ignore_ascii_case(id))
    }

    /// Returns whether the set changed
    fn upsert(&self, server: DiscoveredServer) -> bool {
        self.servers.lock().insert(server.id.clone(), server.clone()) != Some(server)
    }

    /// Returns whether the server was known
    fn remove(&self, id: &str) -> bool {
        self.servers.lock().remove(id).is_some()
    }
}

/// Build a server entry from what a resolved service carries.
///
/// A service with no IPv4 address is dropped: the URL is built from one, and
/// an IPv6 literal would need brackets and a scope that a user cannot read.
/// Among several addresses a routable one wins over a link-local one, which
/// is what a machine with an unplugged adapter also announces.
pub fn server_from_parts(
    fullname: &str,
    port: u16,
    addresses: &[Ipv4Addr],
    txt: impl Fn(&str) -> Option<String>,
) -> Option<DiscoveredServer> {
    let mut sorted = addresses.to_vec();
    sorted.sort();
    let address = sorted
        .iter()
        .find(|a| !a.is_link_local())
        .or_else(|| sorted.first())?;

    let name = fullname
        .strip_suffix(SERVICE_TYPE)
        .map(|n| n.trim_end_matches('.'))
        .filter(|n| !n.is_empty())
        .unwrap_or(fullname);

    let non_empty = |key: &str| txt(key).filter(|v| !v.is_empty());

    Some(DiscoveredServer {
        id: fullname.to_string(),
        name: name.to_string(),
        url: format!("http://{}:{}", address, port),
        version: non_empty("version"),
        model: non_empty("model"),
        pairing: non_empty("pairing").as_deref() == Some("1"),
    })
}

fn server_from_info(info: &ResolvedService) -> Option<DiscoveredServer> {
    let addresses: Vec<Ipv4Addr> = info.get_addresses_v4().into_iter().collect();
    server_from_parts(info.get_fullname(), info.get_port(), &addresses, |key| {
        info.get_property_val_str(key).map(str::to_string)
    })
}

/// The first server on the list that has not been offered yet
pub fn pick_offer<'a>(
    servers: &'a [DiscoveredServer],
    offered: &[String],
) -> Option<&'a DiscoveredServer> {
    servers.iter().find(|s| !offered.contains(&s.id))
}

/// Browse for servers on a thread of its own, for the life of the application.
///
/// A browse that cannot start (no network adapter, the port taken) is logged
/// and leaves the list empty: discovery is a convenience, never a reason to
/// fail the launch.
pub fn start(app: AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("discovery".to_string())
        .spawn(move || run(app));
    if let Err(e) = spawned {
        eprintln!("Failed to start server discovery: {}", e);
    }
}

fn run(app: AppHandle) {
    // The daemon has its own thread and stops with its handle, so the handle
    // lives as long as this function does, which is as long as the browse.
    let daemon = match ServiceDaemon::new() {
        Ok(daemon) => daemon,
        Err(e) => {
            eprintln!("Server discovery unavailable: {}", e);
            return;
        }
    };
    let receiver = match daemon.browse(SERVICE_TYPE) {
        Ok(receiver) => receiver,
        Err(e) => {
            eprintln!("Server discovery could not browse: {}", e);
            return;
        }
    };

    let discovery = app.state::<Discovery>();
    while let Ok(event) = receiver.recv() {
        let changed = match event {
            ServiceEvent::ServiceResolved(info) => match server_from_info(&info) {
                Some(server) if !discovery.is_own(&server.id) => discovery.upsert(server),
                _ => false,
            },
            ServiceEvent::ServiceRemoved(_, fullname) => discovery.remove(&fullname),
            _ => false,
        };
        if changed {
            let _ = app.emit("servers-changed", discovery.list());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FULLNAME: &str = "office-pc._talk._tcp.local.";

    fn props<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |key| {
            pairs
                .iter()
                .find(|(k, _)| *k == key)
                .map(|(_, v)| v.to_string())
        }
    }

    fn server(id: &str) -> DiscoveredServer {
        DiscoveredServer {
            id: id.to_string(),
            name: id.to_string(),
            url: "http://10.0.0.2:8000".to_string(),
            version: None,
            model: None,
            pairing: false,
        }
    }

    #[test]
    fn the_url_is_built_from_the_address_and_the_port() {
        let found = server_from_parts(
            FULLNAME,
            4060,
            &[Ipv4Addr::new(192, 168, 1, 20)],
            props(&[("version", "0.2.0"), ("model", "large-v3-turbo")]),
        )
        .unwrap();

        assert_eq!(found.id, FULLNAME);
        assert_eq!(found.name, "office-pc");
        assert_eq!(found.url, "http://192.168.1.20:4060");
        assert_eq!(found.version.as_deref(), Some("0.2.0"));
        assert_eq!(found.model.as_deref(), Some("large-v3-turbo"));
    }

    #[test]
    fn missing_or_empty_txt_keys_leave_the_field_empty() {
        let found = server_from_parts(
            FULLNAME,
            8000,
            &[Ipv4Addr::new(10, 0, 0, 5)],
            props(&[("model", "")]),
        )
        .unwrap();

        assert_eq!(found.version, None);
        assert_eq!(found.model, None);
        assert!(!found.pairing);
    }

    #[test]
    fn the_pairing_flag_follows_the_txt_key() {
        let address = [Ipv4Addr::new(10, 0, 0, 5)];
        let on = server_from_parts(FULLNAME, 8000, &address, props(&[("pairing", "1")]));
        let off = server_from_parts(FULLNAME, 8000, &address, props(&[("pairing", "0")]));

        assert!(on.unwrap().pairing);
        assert!(!off.unwrap().pairing);
    }

    #[test]
    fn a_routable_address_wins_over_a_link_local_one() {
        let found = server_from_parts(
            FULLNAME,
            8000,
            &[Ipv4Addr::new(169, 254, 3, 4), Ipv4Addr::new(192, 168, 1, 20)],
            props(&[]),
        )
        .unwrap();

        assert_eq!(found.url, "http://192.168.1.20:8000");
    }

    #[test]
    fn a_link_local_address_is_better_than_none() {
        let found =
            server_from_parts(FULLNAME, 8000, &[Ipv4Addr::new(169, 254, 3, 4)], props(&[])).unwrap();

        assert_eq!(found.url, "http://169.254.3.4:8000");
    }

    #[test]
    fn a_service_with_no_ipv4_address_is_dropped() {
        assert!(server_from_parts(FULLNAME, 8000, &[], props(&[])).is_none());
    }

    #[test]
    fn a_name_without_the_service_suffix_is_kept_whole() {
        let found = server_from_parts(
            "odd-name",
            8000,
            &[Ipv4Addr::new(10, 0, 0, 5)],
            props(&[]),
        )
        .unwrap();

        assert_eq!(found.name, "odd-name");
    }

    #[test]
    fn a_re_announcement_with_nothing_new_is_not_a_change() {
        let discovery = Discovery::default();

        assert!(discovery.upsert(server("a")));
        assert!(!discovery.upsert(server("a")));

        let mut moved = server("a");
        moved.url = "http://10.0.0.9:8000".to_string();
        assert!(discovery.upsert(moved));
    }

    #[test]
    fn only_a_server_not_offered_before_is_picked() {
        let servers = [server("a"), server("b")];

        assert_eq!(pick_offer(&servers, &[]).unwrap().id, "a");
        assert_eq!(pick_offer(&servers, &["a".to_string()]).unwrap().id, "b");
        assert!(pick_offer(&servers, &["a".to_string(), "b".to_string()]).is_none());
    }

    #[test]
    fn this_machines_own_announcement_is_not_a_server() {
        let discovery = Discovery::default();
        discovery.upsert(server("me"));
        discovery.upsert(server("other"));

        assert!(discovery.set_own(Some("me".to_string())));

        assert!(discovery.is_own("me"));
        assert!(!discovery.is_own("other"));
        assert_eq!(discovery.list().len(), 1);
        assert!(!discovery.set_own(None));
        assert!(!discovery.is_own("me"));
    }

    #[test]
    fn a_removed_server_leaves_the_list() {
        let discovery = Discovery::default();
        discovery.upsert(server("a"));

        assert!(discovery.remove("a"));
        assert!(!discovery.remove("a"));
        assert!(discovery.list().is_empty());
    }
}
