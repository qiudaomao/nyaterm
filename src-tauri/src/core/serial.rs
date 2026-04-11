//! Serial port session: opens a serial device and bridges I/O to the session manager.

use super::session::{
    SessionCommand, SessionHandle, SessionInfo, SessionManager, SessionType, SharedCwd,
};
use crate::error::{AppError, AppResult};
use serialport::{DataBits, FlowControl, Parity, StopBits};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

pub struct SerialConfig {
    pub port_name: String,
    pub baud_rate: u32,
    pub data_bits: u8,
    pub parity: String,
    pub stop_bits: String,
    pub name: String,
}

pub fn list_serial_ports() -> AppResult<Vec<String>> {
    let mut port_names = serialport::available_ports()
        .map_err(|e| AppError::Config(format!("Failed to list serial ports: {e}")))?
        .into_iter()
        .map(|port| port.port_name)
        .collect::<Vec<_>>();
    port_names.sort_unstable();
    Ok(port_names)
}

fn parse_data_bits(v: u8) -> DataBits {
    match v {
        5 => DataBits::Five,
        6 => DataBits::Six,
        7 => DataBits::Seven,
        _ => DataBits::Eight,
    }
}

fn parse_parity(v: &str) -> Parity {
    match v {
        "odd" => Parity::Odd,
        "even" => Parity::Even,
        _ => Parity::None,
    }
}

fn parse_stop_bits(v: &str) -> StopBits {
    match v {
        "2" => StopBits::Two,
        _ => StopBits::One,
    }
}

pub async fn create_serial_session(
    app: AppHandle,
    manager: Arc<SessionManager>,
    config: SerialConfig,
    _connection_id: Option<String>,
) -> AppResult<String> {
    tracing::info!(
        "Creating serial session on {} @ {} baud",
        config.port_name,
        config.baud_rate
    );

    let session_id = uuid::Uuid::new_v4().to_string();
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<SessionCommand>();

    let session_info = SessionInfo {
        id: session_id.clone(),
        name: config.name.clone(),
        session_type: SessionType::Serial,
        connected: true,
        injection_active: false,
    };

    let cwd: SharedCwd = Arc::new(tokio::sync::Mutex::new(None));
    let session_handle = SessionHandle {
        info: session_info,
        cmd_tx,
        ssh_config: None,
        ssh_handle: None,
        cwd,
    };
    manager.add_session(session_handle).await;

    let sid = session_id.clone();
    let mgr = manager.clone();
    let rt_handle = tokio::runtime::Handle::current();

    std::thread::spawn(move || {
        serial_session_thread(app, sid, mgr, cmd_rx, rt_handle, config);
    });

    Ok(session_id)
}

fn serial_session_thread(
    app: AppHandle,
    session_id: String,
    manager: Arc<SessionManager>,
    mut cmd_rx: mpsc::UnboundedReceiver<SessionCommand>,
    rt_handle: tokio::runtime::Handle,
    config: SerialConfig,
) {
    let port = match serialport::new(&config.port_name, config.baud_rate)
        .data_bits(parse_data_bits(config.data_bits))
        .parity(parse_parity(&config.parity))
        .stop_bits(parse_stop_bits(&config.stop_bits))
        .flow_control(FlowControl::None)
        .timeout(Duration::from_millis(100))
        .open()
    {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("Failed to open serial port: {}", e);
            let _ = app.emit(
                &format!("session-error-{}", session_id),
                format!("Failed to open serial port: {}", e),
            );
            let _ = app.emit(&format!("session-closed-{}", session_id), ());
            rt_handle.block_on(async { manager.remove_session(&session_id).await });
            return;
        }
    };

    let port = Arc::new(Mutex::new(port));
    let output_event = format!("terminal-output-{}", session_id);
    let closed_event = format!("session-closed-{}", session_id);

    // Reader thread
    let app_reader = app.clone();
    let sid_reader = session_id.clone();
    let output_event_reader = output_event.clone();
    let port_reader = port.clone();

    let reader_running = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let reader_flag = reader_running.clone();

    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while reader_flag.load(std::sync::atomic::Ordering::Relaxed) {
            let result = {
                let mut p = port_reader.lock().unwrap();
                p.read(&mut buf)
            };
            match result {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_reader.emit(&output_event_reader, &text);
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                    continue;
                }
                Err(e) => {
                    tracing::warn!("Serial read error: {}", e);
                    break;
                }
            }
        }
        let _ = app_reader.emit(&format!("session-closed-{}", sid_reader), ());
    });

    // Command loop
    while let Some(cmd) = cmd_rx.blocking_recv() {
        match cmd {
            SessionCommand::Attach => {}
            SessionCommand::Write(data) => {
                let mut p = port.lock().unwrap();
                let _ = p.write_all(&data);
                let _ = p.flush();
            }
            SessionCommand::Resize { .. } => {}
            SessionCommand::Close => {
                break;
            }
        }
    }

    reader_running.store(false, std::sync::atomic::Ordering::Relaxed);

    rt_handle.block_on(async {
        manager.remove_session(&session_id).await;
    });
    let _ = app.emit(&closed_event, ());
}
