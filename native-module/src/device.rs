use sha2::{Digest, Sha256};

/// Returns a deterministic hardware fingerprint.
/// This is a device signal only; licensing authority lives on the server.
#[napi]
pub fn get_hardware_id() -> String {
    let raw_id = machine_uid::get().unwrap_or_else(|_| hostname_fallback());

    let mut hasher = Sha256::new();
    hasher.update(raw_id.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn hostname_fallback() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| {
            std::fs::read_to_string("/etc/hostname")
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|_| "unknown-device".to_string())
        })
}
