//! Backend services and shared domain logic.
//!
//! Groups runtime session management, SSH services, translations, importers,
//! and common error types under one backend-oriented namespace.

pub mod history;
pub mod importer;
mod pty;
mod recording;
pub mod serial;
mod session;
pub mod ssh;
pub mod stats;
pub mod telnet;
pub mod translate;
pub mod watcher;

pub use pty::{create_local_session, LocalSessionConfig};
pub use recording::RecordingManager;
pub use serial::{create_serial_session, list_serial_ports, SerialConfig};
pub(crate) use session::update_cwd_if_changed;
pub use session::{
    SessionCommand, SessionHandle, SessionInfo, SessionManager, SessionType, SharedCwd,
};
pub use telnet::create_telnet_session;
