use mdns_sd::{ServiceDaemon, ServiceInfo};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;

const SERVICE_TYPE: &str = "_talk._tcp.local.";

/// Names of bridges and virtual switches that only this machine, its
/// containers or its VMs can reach. Announcing one hands a client an address
/// it may pick and never get through.
const VIRTUAL_MARKERS: [&str; 10] = [
    "docker",
    "veth",
    "virbr",
    "lxc",
    "cni",
    "flannel",
    "vmware",
    "virtualbox",
    "hyper-v",
    "wsl",
];

#[derive(Debug, Clone, PartialEq)]
pub struct Adapter {
    pub name: String,
    pub ip: Ipv4Addr,
    pub up: bool,
    pub point_to_point: bool,
}

fn is_virtual(name: &str) -> bool {
    let name = name.to_lowercase();
    name.starts_with("br-") || VIRTUAL_MARKERS.iter().any(|marker| name.contains(marker))
}

/// The IPv4 addresses another machine on the network could reach, in the
/// order the system lists them. Loopback and link-local addresses are not
/// routable from elsewhere, an adapter that is down has no network, and
/// tunnels and virtual switches lead nowhere a laptop could follow.
pub fn physical_ipv4(adapters: &[Adapter]) -> Vec<Ipv4Addr> {
    let mut found: Vec<Ipv4Addr> = Vec::new();
    for adapter in adapters {
        if !adapter.up
            || adapter.point_to_point
            || adapter.ip.is_loopback()
            || adapter.ip.is_link_local()
            || adapter.ip.is_unspecified()
            || is_virtual(&adapter.name)
        {
            continue;
        }
        if !found.contains(&adapter.ip) {
            found.push(adapter.ip);
        }
    }
    found
}

pub fn local_addresses() -> Vec<Ipv4Addr> {
    let adapters: Vec<Adapter> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|interface| match interface.ip() {
            IpAddr::V4(ip) => Some(Adapter {
                up: interface.is_oper_up(),
                point_to_point: interface.is_p2p(),
                name: interface.name,
                ip,
            }),
            IpAddr::V6(_) => None,
        })
        .collect();
    physical_ipv4(&adapters)
}

/// What this PC calls itself on the network
pub fn instance_name() -> String {
    std::env::var("COMPUTERNAME")
        .ok()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Talk".to_string())
}

fn host_label(instance: &str) -> String {
    let label: String = instance
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let label = label.trim_matches('-');
    if label.is_empty() {
        "talk".to_string()
    } else {
        label.to_string()
    }
}

/// The TXT records, the same keys Talk-Server announces
pub fn txt_records(model: Option<&str>, pairing: bool) -> HashMap<String, String> {
    HashMap::from([
        ("engine".to_string(), "whisper.cpp".to_string()),
        ("model".to_string(), model.unwrap_or_default().to_string()),
        ("auth".to_string(), "token".to_string()),
        ("pairing".to_string(), if pairing { "1" } else { "0" }.to_string()),
    ])
}

fn build_info(
    instance: &str,
    port: u16,
    model: Option<&str>,
    pairing: bool,
    addresses: &[Ipv4Addr],
) -> Result<ServiceInfo, String> {
    let addresses: Vec<IpAddr> = addresses.iter().copied().map(IpAddr::V4).collect();
    ServiceInfo::new(
        SERVICE_TYPE,
        instance,
        &format!("{}.local.", host_label(instance)),
        addresses.as_slice(),
        port,
        txt_records(model, pairing),
    )
    .map_err(|e| e.to_string())
}

/// The service on the network, for as long as it is held. Dropping it says
/// goodbye so that other machines forget it at once instead of waiting out
/// the record's life.
pub struct Announcement {
    daemon: Option<ServiceDaemon>,
    instance: String,
    fullname: String,
}

impl Announcement {
    pub fn start(
        port: u16,
        model: Option<&str>,
        pairing: bool,
        addresses: &[Ipv4Addr],
    ) -> Result<Self, String> {
        if addresses.is_empty() {
            return Err("no network address to announce".to_string());
        }
        let instance = instance_name();
        let info = build_info(&instance, port, model, pairing, addresses)?;
        let fullname = info.get_fullname().to_string();

        let daemon = ServiceDaemon::new().map_err(|e| e.to_string())?;
        daemon.register(info).map_err(|e| e.to_string())?;
        Ok(Self {
            daemon: Some(daemon),
            instance,
            fullname,
        })
    }

    /// The instance name other machines see, which is how this PC recognises
    /// its own announcement when it browses
    pub fn fullname(&self) -> &str {
        &self.fullname
    }

    /// Announce again with the model and the pairing flag as they are now
    pub fn update(
        &self,
        port: u16,
        model: Option<&str>,
        pairing: bool,
        addresses: &[Ipv4Addr],
    ) -> Result<(), String> {
        let Some(daemon) = &self.daemon else {
            return Ok(());
        };
        let info = build_info(&self.instance, port, model, pairing, addresses)?;
        daemon.register(info).map_err(|e| e.to_string())
    }
}

impl Drop for Announcement {
    fn drop(&mut self) {
        let Some(daemon) = self.daemon.take() else {
            return;
        };
        let fullname = self.fullname.clone();
        // The goodbye goes out on the daemon's own thread, so it gets a moment
        // before the daemon is stopped, and nobody waits for it here.
        let _ = std::thread::Builder::new()
            .name("share-announce-stop".to_string())
            .spawn(move || {
                if let Ok(done) = daemon.unregister(&fullname) {
                    let _ = done.recv_timeout(Duration::from_secs(2));
                }
                let _ = daemon.shutdown();
            });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn adapter(name: &str, ip: [u8; 4]) -> Adapter {
        Adapter {
            name: name.to_string(),
            ip: Ipv4Addr::from(ip),
            up: true,
            point_to_point: false,
        }
    }

    #[test]
    fn a_wired_and_a_wireless_adapter_are_both_kept_in_order() {
        let found = physical_ipv4(&[
            adapter("Ethernet", [192, 168, 1, 20]),
            adapter("Wi-Fi", [192, 168, 1, 21]),
        ]);

        assert_eq!(found, vec![Ipv4Addr::new(192, 168, 1, 20), Ipv4Addr::new(192, 168, 1, 21)]);
    }

    #[test]
    fn loopback_and_link_local_are_skipped() {
        let found = physical_ipv4(&[
            adapter("Loopback Pseudo-Interface 1", [127, 0, 0, 1]),
            adapter("Ethernet 2", [169, 254, 3, 4]),
            adapter("Ethernet", [10, 0, 0, 5]),
        ]);

        assert_eq!(found, vec![Ipv4Addr::new(10, 0, 0, 5)]);
    }

    #[test]
    fn container_bridges_and_virtual_switches_are_skipped() {
        let found = physical_ipv4(&[
            adapter("docker0", [172, 17, 0, 1]),
            adapter("br-1a2b3c", [172, 18, 0, 1]),
            adapter("vEthernet (WSL)", [172, 24, 0, 1]),
            adapter("vEthernet (Default Switch)", [172, 25, 0, 1]),
            adapter("VMware Network Adapter VMnet8", [192, 168, 40, 1]),
            adapter("VirtualBox Host-Only Network", [192, 168, 56, 1]),
            adapter("Wi-Fi", [192, 168, 1, 21]),
        ]);

        assert_eq!(found, vec![Ipv4Addr::new(192, 168, 1, 21)]);
    }

    #[test]
    fn an_adapter_that_is_down_or_a_tunnel_is_skipped() {
        let mut down = adapter("Ethernet", [10, 0, 0, 5]);
        down.up = false;
        let mut tunnel = adapter("Tunnel", [10, 8, 0, 2]);
        tunnel.point_to_point = true;

        assert!(physical_ipv4(&[down, tunnel]).is_empty());
    }

    #[test]
    fn an_address_on_two_adapters_is_listed_once() {
        let found = physical_ipv4(&[adapter("Ethernet", [10, 0, 0, 5]), adapter("Ethernet 3", [10, 0, 0, 5])]);

        assert_eq!(found.len(), 1);
    }

    #[test]
    fn the_txt_records_name_the_engine_the_model_and_the_pairing() {
        let on = txt_records(Some("ggml-small-q5_1"), true);
        assert_eq!(on["engine"], "whisper.cpp");
        assert_eq!(on["model"], "ggml-small-q5_1");
        assert_eq!(on["auth"], "token");
        assert_eq!(on["pairing"], "1");

        let off = txt_records(None, false);
        assert_eq!(off["model"], "");
        assert_eq!(off["pairing"], "0");
    }

    #[test]
    fn the_service_is_named_after_the_machine() {
        let info = build_info("OFFICE-PC", 8000, Some("m"), true, &[Ipv4Addr::new(10, 0, 0, 5)]).unwrap();

        assert_eq!(info.get_fullname(), "OFFICE-PC._talk._tcp.local.");
        assert_eq!(info.get_port(), 8000);
        assert_eq!(info.get_hostname(), "OFFICE-PC.local.");
    }

    #[test]
    fn a_host_name_keeps_to_letters_digits_and_dashes() {
        assert_eq!(host_label("Nico's PC"), "Nico-s-PC");
        assert_eq!(host_label("!!!"), "talk");
    }

    #[test]
    fn nothing_is_announced_without_an_address() {
        assert!(Announcement::start(8000, None, true, &[]).is_err());
    }
}
