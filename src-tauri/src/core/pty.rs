//! Local PTY (pseudo-terminal) session creation and management.
//!
//! Spawns the user's shell (PowerShell on Windows, $SHELL elsewhere) and bridges I/O to Tauri.

use super::recording::RecordingManager;
use super::session::{
    SessionCommand, SessionHandle, SessionInfo, SessionManager, SessionType, SharedCwd,
};
use super::update_cwd_if_changed;
use crate::core::ssh::osc::OscStripper;
use crate::error::AppResult;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

struct OutputBuffer {
    attached: bool,
    buffer: Vec<String>,
}

/// Per-connection local terminal config.
pub struct LocalSessionConfig {
    pub shell_path: String,
    pub working_dir: Option<String>,
    pub name: String,
}

fn build_shell_command(shell_cmd: &str) -> (CommandBuilder, String) {
    let parts: Vec<&str> = shell_cmd.split_whitespace().collect();
    if parts.is_empty() {
        platform_default_shell()
    } else {
        let mut builder = CommandBuilder::new(parts[0]);
        if parts.len() > 1 {
            builder.args(&parts[1..]);
        }
        (builder, parts[0].to_string())
    }
}

fn platform_default_shell() -> (CommandBuilder, String) {
    #[cfg(target_os = "windows")]
    {
        (
            CommandBuilder::new("powershell.exe"),
            "powershell.exe".to_string(),
        )
    }
    #[cfg(not(target_os = "windows"))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        (CommandBuilder::new(&shell), shell)
    }
}

fn write_to_pty(writer: &mut dyn Write, data: &[u8]) -> std::io::Result<()> {
    writer.write_all(data)?;
    writer.flush()
}

fn queue_or_emit_output(
    app: &AppHandle,
    output_event: &str,
    output_buf: &Arc<Mutex<OutputBuffer>>,
    text: String,
    recording_mgr: Option<&Arc<RecordingManager>>,
    session_id: &str,
) {
    if text.is_empty() {
        return;
    }

    if let Some(rec) = recording_mgr {
        rec.write_output(session_id, &text);
    }

    let emit_now = {
        let mut ob = output_buf.lock().unwrap();
        if ob.attached {
            true
        } else {
            ob.buffer.push(text.clone());
            false
        }
    };

    if emit_now {
        let _ = app.emit(output_event, &text);
    }
}

/// Spawns a local shell in a PTY and registers the session with the manager.
/// If `config` is provided, uses the shell path and working dir from it.
pub async fn create_local_session(
    app: AppHandle,
    manager: Arc<SessionManager>,
    config: Option<LocalSessionConfig>,
) -> AppResult<String> {
    tracing::info!("Creating local PTY session");
    let session_id = uuid::Uuid::new_v4().to_string();
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<SessionCommand>();

    let session_name = config
        .as_ref()
        .map_or("Local Terminal".to_string(), |c| c.name.clone());

    let session_info = SessionInfo {
        id: session_id.clone(),
        name: session_name,
        session_type: SessionType::Local,
        connected: true,
        injection_active: false,
    };

    let cwd: SharedCwd = Arc::new(tokio::sync::Mutex::new(None));
    let session_handle = SessionHandle {
        info: session_info,
        cmd_tx,
        ssh_config: None,
        ssh_handle: None,
        cwd: cwd.clone(),
    };
    manager.add_session(session_handle).await;

    let sid = session_id.clone();
    let mgr = manager.clone();
    let rt_handle = tokio::runtime::Handle::current();

    std::thread::spawn(move || {
        pty_session_thread(app, sid, mgr, cmd_rx, rt_handle, cwd, config);
    });

    Ok(session_id)
}

fn pty_session_thread(
    app: AppHandle,
    session_id: String,
    manager: Arc<SessionManager>,
    mut cmd_rx: mpsc::UnboundedReceiver<SessionCommand>,
    rt_handle: tokio::runtime::Handle,
    cwd: SharedCwd,
    config: Option<LocalSessionConfig>,
) {
    let pty_system = native_pty_system();
    let pair = match pty_system.openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("Failed to open PTY: {}", e);
            let _ = app.emit(
                &format!("session-error-{}", session_id),
                format!("Failed to open PTY: {}", e),
            );
            return;
        }
    };

    let (mut cmd, _) = match &config {
        Some(cfg) if !cfg.shell_path.trim().is_empty() => build_shell_command(&cfg.shell_path),
        _ => platform_default_shell(),
    };

    if let Some(ref cfg) = config {
        if let Some(ref dir) = cfg.working_dir {
            if !dir.is_empty() {
                cmd.cwd(dir);
            }
        }
    }

    let mut _child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("Failed to spawn shell: {}", e);
            let _ = app.emit(
                &format!("session-error-{}", session_id),
                format!("Failed to spawn shell: {}", e),
            );
            return;
        }
    };
    drop(pair.slave);

    let mut writer = match pair.master.take_writer() {
        Ok(w) => w,
        Err(e) => {
            tracing::error!("Failed to take PTY writer: {}", e);
            return;
        }
    };

    let mut reader = match pair.master.try_clone_reader() {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("Failed to clone PTY reader: {}", e);
            return;
        }
    };
    let master = pair.master;

    let output_buf = Arc::new(Mutex::new(OutputBuffer {
        attached: false,
        buffer: Vec::new(),
    }));

    let app_read = app.clone();
    let sid_read = session_id.clone();
    let output_event = format!("terminal-output-{}", session_id);
    let buf_reader = output_buf.clone();

    let cwd_event = format!("cwd-changed-{}", session_id);
    let rt_for_reader = rt_handle.clone();
    let recording_mgr_reader: Option<Arc<RecordingManager>> = app
        .try_state::<Arc<RecordingManager>>()
        .map(|s| s.inner().clone());
    let sid_for_rec_reader = session_id.clone();
    std::thread::spawn(move || {
        let mut raw_buf = [0u8; 4096];
        let mut stripper = OscStripper::new("");
        loop {
            match reader.read(&mut raw_buf) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&raw_buf[..n]).to_string();
                    let result = stripper.push(&text);

                    for path in &result.cwd_paths {
                        let cwd_ev = cwd_event.clone();
                        let app_ref = app_read.clone();
                        let next_cwd = rt_for_reader
                            .block_on(async { update_cwd_if_changed(&cwd, path).await });
                        if let Some(next_cwd) = next_cwd {
                            let _ = app_ref.emit(&cwd_ev, &next_cwd);
                        }
                    }

                    queue_or_emit_output(
                        &app_read,
                        &output_event,
                        &buf_reader,
                        result.visible,
                        recording_mgr_reader.as_ref(),
                        &sid_for_rec_reader,
                    );
                }
                Err(error) => {
                    tracing::debug!(
                        session_id = %sid_read,
                        error = %error,
                        "Local PTY reader exited"
                    );
                    break;
                }
            }
        }
        let _ = app_read.emit(&format!("session-closed-{}", sid_read), ());
    });

    let recording_mgr: Option<Arc<RecordingManager>> = app
        .try_state::<Arc<RecordingManager>>()
        .map(|s| s.inner().clone());
    let output_event_cmd = format!("terminal-output-{}", session_id);
    while let Some(cmd) = cmd_rx.blocking_recv() {
        match cmd {
            SessionCommand::Attach => {
                let buffered = {
                    let mut ob = output_buf.lock().unwrap();
                    ob.attached = true;
                    ob.buffer.drain(..).collect::<Vec<_>>()
                };
                for text in buffered {
                    let _ = app.emit(&output_event_cmd, &text);
                }
            }
            SessionCommand::Write(data) => {
                if let Some(ref rec) = recording_mgr {
                    rec.write_input(&session_id, &data);
                }
                if let Err(error) = write_to_pty(&mut *writer, &data) {
                    tracing::warn!(
                        session_id = %session_id,
                        error = %error,
                        "Failed to write to local PTY"
                    );
                }
            }
            SessionCommand::Resize { cols, rows } => {
                let _ = master.resize(PtySize {
                    rows: rows as u16,
                    cols: cols as u16,
                    pixel_width: 0,
                    pixel_height: 0,
                });
            }
            SessionCommand::Close => {
                break;
            }
        }
    }

    if let Some(ref rec) = recording_mgr {
        rec.cleanup_session(&session_id);
    }

    rt_handle.block_on(async {
        manager.remove_session(&session_id).await;
    });
    let _ = app.emit(&format!("session-closed-{}", session_id), ());
}
