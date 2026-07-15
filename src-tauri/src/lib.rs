use serde::Serialize;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
#[cfg(any(debug_assertions, test))]
use std::path::Path;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

const SERVER_ADDR: &str = "127.0.0.1:5180";
const SERVER_PROTOCOL_VERSION: u64 = 1;
const SERVER_START_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Default)]
struct ManagedServer {
    child: Mutex<Option<Child>>,
}

impl Drop for ManagedServer {
    fn drop(&mut self) {
        if let Ok(child) = self.child.get_mut() {
            if let Some(mut child) = child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[derive(Serialize)]
struct DirectoryPickResponse {
    cancelled: bool,
    path: String,
}

#[derive(Serialize)]
struct ShutdownResponse {
    status: &'static str,
}

#[derive(Debug, PartialEq, Eq)]
struct CaaDialogLaunchRequest {
    workspace: Option<String>,
    file: String,
}

fn resolve_cli_path(value: &str, cwd: &str) -> String {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path.to_string_lossy().into_owned()
    } else {
        PathBuf::from(cwd).join(path).to_string_lossy().into_owned()
    }
}

fn parse_caa_dialog_launch_args(args: &[String], cwd: &str) -> Option<CaaDialogLaunchRequest> {
    let mut workspace: Option<String> = None;
    let mut file: Option<String> = None;
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if arg == "--workspace" {
            if let Some(value) = args.get(index + 1) {
                workspace = Some(resolve_cli_path(value, cwd));
                index += 1;
            }
        } else if let Some(value) = arg.strip_prefix("--workspace=") {
            workspace = Some(resolve_cli_path(value, cwd));
        } else if arg == "--catdlg" || arg == "--file" {
            if let Some(value) = args.get(index + 1) {
                file = Some(value.clone());
                index += 1;
            }
        } else if let Some(value) = arg
            .strip_prefix("--catdlg=")
            .or_else(|| arg.strip_prefix("--file="))
        {
            file = Some(value.to_string());
        } else if arg.to_ascii_lowercase().ends_with(".catdlg") {
            file = Some(arg.clone());
        }
        index += 1;
    }
    file.map(|file| {
        let resolved_file = resolve_cli_path(&file, workspace.as_deref().unwrap_or(cwd));
        CaaDialogLaunchRequest {
            workspace,
            file: resolved_file,
        }
    })
}

fn http_request(request: &[u8]) -> std::io::Result<String> {
    let address: SocketAddr = SERVER_ADDR.parse().expect("valid Phoenix server address");
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(300))?;
    stream.set_read_timeout(Some(Duration::from_millis(500)))?;
    stream.set_write_timeout(Some(Duration::from_millis(500)))?;
    stream.write_all(request)?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    Ok(response)
}

fn dispatch_caa_dialog_launch_args(args: &[String], cwd: &str) -> Result<bool, String> {
    let Some(request) = parse_caa_dialog_launch_args(args, cwd) else {
        return Ok(false);
    };
    let body = serde_json::to_vec(&serde_json::json!({
        "workspaceRoot": request.workspace,
        "file": request.file,
    }))
    .map_err(|error| error.to_string())?;
    let header = format!(
        "POST /api/caa/dialog/open HTTP/1.1\r\nHost: 127.0.0.1:5180\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let mut wire = header.into_bytes();
    wire.extend_from_slice(&body);
    let response = http_request(&wire).map_err(|error| error.to_string())?;
    if response.starts_with("HTTP/1.1 202") || response.starts_with("HTTP/1.0 202") {
        Ok(true)
    } else {
        Err(response
            .lines()
            .next()
            .unwrap_or("invalid HTTP response")
            .to_string())
    }
}

fn phoenix_server_healthy() -> bool {
    let response = match http_request(
        b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:5180\r\nConnection: close\r\n\r\n",
    ) {
        Ok(response) => response,
        Err(_) => return false,
    };
    if !response.starts_with("HTTP/1.1 200") && !response.starts_with("HTTP/1.0 200") {
        return false;
    }
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or("");
    let payload: serde_json::Value = match serde_json::from_str(body) {
        Ok(payload) => payload,
        Err(_) => return false,
    };
    payload.get("service").and_then(|value| value.as_str()) == Some("phoenix-node")
        && payload
            .get("protocol_version")
            .and_then(|value| value.as_u64())
            == Some(SERVER_PROTOCOL_VERSION)
}

#[cfg(any(debug_assertions, test))]
fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a repository parent")
        .to_path_buf()
}

#[cfg(debug_assertions)]
fn backend_command(_app: &AppHandle) -> Result<Command, String> {
    let root = repo_root();
    let node = std::env::var_os("PHOENIX_NODE_BINARY").unwrap_or_else(|| "node".into());
    let tsx = root.join("server/node_modules/tsx/dist/cli.mjs");
    let entry = root.join("server/src/server.ts");
    if !tsx.is_file() {
        return Err(format!("missing {}; run pnpm install", tsx.display()));
    }
    let mut command = Command::new(node);
    command
        .arg(tsx)
        .arg(entry)
        .current_dir(&root)
        .env("CAA_SERVER_PORT", "5180")
        .env("PHOENIX_REPO_ROOT", &root);
    Ok(command)
}

#[cfg(not(debug_assertions))]
fn backend_command(app: &AppHandle) -> Result<Command, String> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| format!("cannot resolve Tauri resource directory: {error}"))?
        .join("runtime");
    let user_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve Tauri application data directory: {error}"))?;
    std::fs::create_dir_all(&user_data)
        .map_err(|error| format!("cannot create {}: {error}", user_data.display()))?;
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    let node = resources.join("node").join(node_name);
    let entry = resources.join("server/server.mjs");
    if !node.is_file() || !entry.is_file() {
        return Err(format!(
            "packaged runtime is incomplete: {} or {} is missing",
            node.display(),
            entry.display()
        ));
    }
    let mut command = Command::new(node);
    command
        .arg(entry)
        .current_dir(&resources)
        .env("CAA_SERVER_PORT", "5180")
        .env("PHOENIX_PACKAGED", "1")
        .env("PHOENIX_REPO_ROOT", &resources)
        .env("PHOENIX_RESOURCES_DIR", &resources)
        .env("PHOENIX_USER_DATA_DIR", &user_data)
        .env("PHOENIX_NATIVE_BIN_DIR", resources.join("bin"));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    Ok(command)
}

fn start_managed_server(app: &AppHandle) -> Result<(), String> {
    if phoenix_server_healthy() {
        #[cfg(debug_assertions)]
        {
            eprintln!("[tauri] using existing Phoenix server at http://{SERVER_ADDR}");
            return Ok(());
        }
        #[cfg(not(debug_assertions))]
        {
            return Err(format!(
                "Phoenix server port {SERVER_ADDR} is already in use. Stop pnpm dev or another Phoenix instance, then start the desktop app again."
            ));
        }
    }

    let mut command = backend_command(app)?;
    command.stdin(Stdio::null());
    if cfg!(debug_assertions) {
        command.stdout(Stdio::inherit()).stderr(Stdio::inherit());
    } else {
        let log_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("cannot resolve Tauri application data directory: {error}"))?
            .join("logs");
        std::fs::create_dir_all(&log_dir)
            .map_err(|error| format!("cannot create {}: {error}", log_dir.display()))?;
        let log_path = log_dir.join("phoenix-server.log");
        let stdout = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&log_path)
            .map_err(|error| format!("cannot open {}: {error}", log_path.display()))?;
        let stderr = stdout
            .try_clone()
            .map_err(|error| format!("cannot clone {}: {error}", log_path.display()))?;
        command
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr));
    }
    let child = command
        .spawn()
        .map_err(|error| format!("cannot start the Phoenix Node service: {error}"))?;
    *app.state::<ManagedServer>()
        .child
        .lock()
        .map_err(|_| "Phoenix server process lock is poisoned".to_string())? = Some(child);

    let deadline = Instant::now() + SERVER_START_TIMEOUT;
    while Instant::now() < deadline {
        if phoenix_server_healthy() {
            eprintln!("[tauri] Phoenix server ready at http://{SERVER_ADDR}");
            return Ok(());
        }
        {
            let server = app.state::<ManagedServer>();
            let mut guard = server
                .child
                .lock()
                .map_err(|_| "Phoenix server process lock is poisoned".to_string())?;
            if let Some(child) = guard.as_mut() {
                if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                    guard.take();
                    return Err(format!(
                        "Phoenix Node service exited during startup: {status}"
                    ));
                }
            }
        }
        thread::sleep(Duration::from_millis(100));
    }

    stop_managed_server(app);
    Err(format!(
        "Phoenix Node service did not become healthy at http://{SERVER_ADDR} within {} seconds",
        SERVER_START_TIMEOUT.as_secs()
    ))
}

fn stop_managed_server(app: &AppHandle) {
    let state = app.state::<ManagedServer>();
    let mut child = match state.child.lock() {
        Ok(mut guard) => guard.take(),
        Err(_) => None,
    };
    let Some(mut child) = child.take() else {
        return;
    };

    let _ = http_request(
        b"POST /api/shutdown HTTP/1.1\r\nHost: 127.0.0.1:5180\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
    );
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(_) => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn persist_startup_error(app: &AppHandle, error: &str) -> Option<PathBuf> {
    let log_dir = app.path().app_data_dir().ok()?.join("logs");
    std::fs::create_dir_all(&log_dir).ok()?;
    let log_path = log_dir.join("phoenix-startup-error.log");
    std::fs::write(&log_path, format!("{error}\n")).ok()?;
    Some(log_path)
}

#[tauri::command]
async fn pick_workspace_directory(
    app: AppHandle,
    path_hint: Option<String>,
) -> Result<DirectoryPickResponse, String> {
    let mut picker = app.dialog().file().set_title("选择工作空间目录");
    if let Some(hint) = path_hint.filter(|value| !value.trim().is_empty()) {
        picker = picker.set_directory(hint);
    }
    let picked = picker.blocking_pick_folder();
    match picked {
        Some(path) => Ok(DirectoryPickResponse {
            cancelled: false,
            path: path
                .simplified()
                .into_path()
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .into_owned(),
        }),
        None => Ok(DirectoryPickResponse {
            cancelled: true,
            path: String::new(),
        }),
    }
}

#[tauri::command]
fn shutdown_desktop(app: AppHandle) -> ShutdownResponse {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(100));
        app.exit(0);
    });
    ShutdownResponse { status: "stopping" }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            if let Err(error) = dispatch_caa_dialog_launch_args(&args, &cwd) {
                eprintln!("[tauri] cannot dispatch CATDlg open request: {error}");
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(ManagedServer::default())
        .invoke_handler(tauri::generate_handler![
            pick_workspace_directory,
            shutdown_desktop
        ])
        .setup(|app| {
            if let Err(error) = start_managed_server(app.handle()) {
                let log_path = persist_startup_error(app.handle(), &error);
                let detail = match log_path {
                    Some(path) => format!("{error}\n\nDiagnostic log: {}", path.display()),
                    None => error.clone(),
                };
                app.dialog()
                    .message(detail)
                    .kind(MessageDialogKind::Error)
                    .title("Phoenix startup failed")
                    .blocking_show();
                return Err(std::io::Error::other(error).into());
            }
            let args: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            if let Err(error) = dispatch_caa_dialog_launch_args(&args, &cwd) {
                eprintln!("[tauri] cannot dispatch startup CATDlg open request: {error}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Phoenix desktop");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            stop_managed_server(app_handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_repo_root_contains_the_workspace_manifest() {
        assert!(repo_root().join("pnpm-workspace.yaml").is_file());
    }

    #[test]
    fn parses_catdlg_cli_arguments_and_file_association_style_arguments() {
        assert_eq!(
            parse_caa_dialog_launch_args(
                &[
                    "phoenix".into(),
                    "--workspace".into(),
                    "/work".into(),
                    "--catdlg".into(),
                    "UI/Sample.CATDlg".into()
                ],
                "/cwd",
            ),
            Some(CaaDialogLaunchRequest {
                workspace: Some("/work".into()),
                file: "/work/UI/Sample.CATDlg".into(),
            })
        );
        assert_eq!(
            parse_caa_dialog_launch_args(&["phoenix".into(), "Dialog.CATDlg".into()], "/project"),
            Some(CaaDialogLaunchRequest {
                workspace: None,
                file: "/project/Dialog.CATDlg".into()
            })
        );
    }
}
