use super::super::{default_false, default_true};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecuritySettings {
    #[serde(default = "default_true")]
    pub use_os_keyring: bool,
    #[serde(default = "default_false")]
    pub enable_screen_lock: bool,
    #[serde(default)]
    pub idle_lock_minutes: u32,
    /// Master password used to derive the wrapping key for `master.key`.
    /// Also serves as the lock-screen password when set.
    #[serde(default)]
    pub master_password: Option<String>,
    #[serde(default = "default_host_key_policy")]
    pub host_key_policy: String,
}

fn default_host_key_policy() -> String {
    "prompt".to_string()
}

impl Default for SecuritySettings {
    fn default() -> Self {
        Self {
            use_os_keyring: true,
            enable_screen_lock: false,
            idle_lock_minutes: 0,
            master_password: None,
            host_key_policy: default_host_key_policy(),
        }
    }
}
