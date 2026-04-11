//! Telnet session: raw TCP with basic IAC negotiation, bridged to the session manager.

use super::session::{
    SessionCommand, SessionHandle, SessionInfo, SessionManager, SessionType, SharedCwd,
};
use crate::error::AppResult;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

const IAC: u8 = 255;
const WILL: u8 = 251;
const WONT: u8 = 252;
const DO: u8 = 253;
const DONT: u8 = 254;
const SB: u8 = 250;
const SE: u8 = 240;

const OPT_ECHO: u8 = 1;
const OPT_SUPPRESS_GO_AHEAD: u8 = 3;
const OPT_NAWS: u8 = 31;

/// Respond to a Telnet option negotiation request.
fn negotiate_response(command: u8, option: u8) -> Vec<u8> {
    match command {
        WILL => {
            if option == OPT_ECHO || option == OPT_SUPPRESS_GO_AHEAD {
                vec![IAC, DO, option]
            } else {
                vec![IAC, DONT, option]
            }
        }
        DO => {
            if option == OPT_NAWS {
                vec![IAC, WILL, option]
            } else {
                vec![IAC, WONT, option]
            }
        }
        WONT => vec![IAC, DONT, option],
        DONT => vec![IAC, WONT, option],
        _ => vec![],
    }
}

/// Build a NAWS (Negotiate About Window Size) subnegotiation sequence.
fn build_naws(cols: u16, rows: u16) -> Vec<u8> {
    vec![
        IAC,
        SB,
        OPT_NAWS,
        (cols >> 8) as u8,
        (cols & 0xff) as u8,
        (rows >> 8) as u8,
        (rows & 0xff) as u8,
        IAC,
        SE,
    ]
}

/// Strip IAC sequences from raw data, returning only user-visible bytes.
/// Calls `on_negotiate` for each IAC command/option pair encountered.
fn strip_telnet_commands(data: &[u8], on_negotiate: &mut impl FnMut(u8, u8)) -> Vec<u8> {
    let mut visible = Vec::with_capacity(data.len());
    let mut i = 0;
    while i < data.len() {
        if data[i] == IAC && i + 1 < data.len() {
            let cmd = data[i + 1];
            match cmd {
                IAC => {
                    visible.push(IAC);
                    i += 2;
                }
                WILL | WONT | DO | DONT => {
                    if i + 2 < data.len() {
                        on_negotiate(cmd, data[i + 2]);
                        i += 3;
                    } else {
                        i += 2;
                    }
                }
                SB => {
                    // Skip subnegotiation until IAC SE
                    i += 2;
                    while i < data.len() {
                        if data[i] == IAC && i + 1 < data.len() && data[i + 1] == SE {
                            i += 2;
                            break;
                        }
                        i += 1;
                    }
                }
                _ => {
                    i += 2;
                }
            }
        } else {
            visible.push(data[i]);
            i += 1;
        }
    }
    visible
}

pub async fn create_telnet_session(
    app: AppHandle,
    manager: Arc<SessionManager>,
    host: String,
    port: u16,
    connection_id: Option<String>,
    name: String,
) -> AppResult<String> {
    tracing::info!("Creating Telnet session to {}:{}", host, port);
    let session_id = uuid::Uuid::new_v4().to_string();
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<SessionCommand>();

    let session_info = SessionInfo {
        id: session_id.clone(),
        name,
        session_type: SessionType::Telnet,
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

    tokio::spawn(async move {
        telnet_session_task(app, sid, mgr, cmd_rx, host, port, connection_id).await;
    });

    Ok(session_id)
}

async fn telnet_session_task(
    app: AppHandle,
    session_id: String,
    manager: Arc<SessionManager>,
    mut cmd_rx: mpsc::UnboundedReceiver<SessionCommand>,
    host: String,
    port: u16,
    _connection_id: Option<String>,
) {
    let addr = format!("{}:{}", host, port);
    let stream = match TcpStream::connect(&addr).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("Telnet connection failed: {}", e);
            let _ = app.emit(
                &format!("session-error-{}", session_id),
                format!("Connection failed: {}", e),
            );
            let _ = app.emit(&format!("session-closed-{}", session_id), ());
            manager.remove_session(&session_id).await;
            return;
        }
    };

    let (mut reader, mut writer) = stream.into_split();
    let output_event = format!("terminal-output-{}", session_id);
    let closed_event = format!("session-closed-{}", session_id);

    let app_reader = app.clone();
    let sid_reader = session_id.clone();
    let output_event_reader = output_event.clone();

    // Shared channel for negotiation responses from the reader to the writer
    let (negotiate_tx, mut negotiate_rx) = mpsc::unbounded_channel::<Vec<u8>>();

    let reader_handle = tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let neg_tx = negotiate_tx.clone();
                    let visible = strip_telnet_commands(&buf[..n], &mut |cmd, opt| {
                        let resp = negotiate_response(cmd, opt);
                        if !resp.is_empty() {
                            let _ = neg_tx.send(resp);
                        }
                    });
                    if !visible.is_empty() {
                        let text = String::from_utf8_lossy(&visible).to_string();
                        let _ = app_reader.emit(&output_event_reader, &text);
                    }
                }
                Err(e) => {
                    tracing::warn!("Telnet read error: {}", e);
                    break;
                }
            }
        }
        let _ = app_reader.emit(&format!("session-closed-{}", sid_reader), ());
    });

    let mut attached = false;
    let mut pending_output: Vec<String> = Vec::new();

    loop {
        tokio::select! {
            Some(neg_data) = negotiate_rx.recv() => {
                if let Err(e) = writer.write_all(&neg_data).await {
                    tracing::warn!("Telnet negotiate write error: {}", e);
                    break;
                }
            }
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(SessionCommand::Attach) => {
                        attached = true;
                        for text in pending_output.drain(..) {
                            let _ = app.emit(&output_event, &text);
                        }
                    }
                    Some(SessionCommand::Write(data)) => {
                        if let Err(e) = writer.write_all(&data).await {
                            tracing::warn!("Telnet write error: {}", e);
                            break;
                        }
                    }
                    Some(SessionCommand::Resize { cols, rows }) => {
                        let naws = build_naws(cols as u16, rows as u16);
                        let _ = writer.write_all(&naws).await;
                    }
                    Some(SessionCommand::Close) | None => {
                        break;
                    }
                }
            }
        }
    }

    let _ = attached; // suppress warning
    let _ = pending_output;

    reader_handle.abort();
    manager.remove_session(&session_id).await;
    let _ = app.emit(&closed_event, ());
}
