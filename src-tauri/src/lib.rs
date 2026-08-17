use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
#[cfg(any(debug_assertions, test))]
use std::path::Path;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

const SERVER_PREFERRED_PORT: u16 = 48_375;
const SERVER_PORT_ATTEMPTS: u16 = 32;
const SERVER_PROTOCOL_VERSION: u64 = 1;
const SERVER_START_TIMEOUT: Duration = Duration::from_secs(20);

struct ManagedServer {
    child: Mutex<Option<Child>>,
    address: Mutex<SocketAddr>,
    runtime: Mutex<ApiRuntimeMetadata>,
}

struct ApiRuntimeMetadata {
    source: &'static str,
    app_version: String,
    protocol_version: u64,
}

impl Default for ManagedServer {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            address: Mutex::new(SocketAddr::from((
                Ipv4Addr::LOCALHOST,
                SERVER_PREFERRED_PORT,
            ))),
            runtime: Mutex::new(ApiRuntimeMetadata {
                source: "managed",
                app_version: "unknown".to_string(),
                protocol_version: SERVER_PROTOCOL_VERSION,
            }),
        }
    }
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

#[derive(Serialize)]
struct RuntimeInfoResponse {
    api_origin: String,
    api_source: &'static str,
    api_version: String,
    protocol_version: u64,
}

#[derive(Deserialize)]
struct DeskApiRegistration {
    schema_version: u64,
    service: String,
    protocol_version: u64,
    host: String,
    port: u16,
}

struct DeskApiHealth {
    app_version: String,
    protocol_version: u64,
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

fn http_request(address: SocketAddr, request: &[u8]) -> std::io::Result<String> {
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(300))?;
    stream.set_read_timeout(Some(Duration::from_millis(500)))?;
    stream.set_write_timeout(Some(Duration::from_millis(500)))?;
    stream.write_all(request)?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    Ok(response)
}

fn dispatch_caa_dialog_launch_args(
    address: SocketAddr,
    args: &[String],
    cwd: &str,
) -> Result<bool, String> {
    let Some(request) = parse_caa_dialog_launch_args(args, cwd) else {
        return Ok(false);
    };
    let body = serde_json::to_vec(&serde_json::json!({
        "workspaceRoot": request.workspace,
        "file": request.file,
    }))
    .map_err(|error| error.to_string())?;
    let header = format!(
        "POST /api/caa/dialog/open HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len(),
    );
    let mut wire = header.into_bytes();
    wire.extend_from_slice(&body);
    let response = http_request(address, &wire).map_err(|error| error.to_string())?;
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

fn phoenix_server_health(address: SocketAddr) -> Option<DeskApiHealth> {
    let request =
        format!("GET /api/health HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n");
    let response = match http_request(address, request.as_bytes()) {
        Ok(response) => response,
        Err(_) => return None,
    };
    if !response.starts_with("HTTP/1.1 200") && !response.starts_with("HTTP/1.0 200") {
        return None;
    }
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or("");
    let payload: serde_json::Value = match serde_json::from_str(body) {
        Ok(payload) => payload,
        Err(_) => return None,
    };
    if payload.get("service").and_then(|value| value.as_str()) != Some("phoenix-node") {
        return None;
    }
    Some(DeskApiHealth {
        app_version: payload
            .get("app_version")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown")
            .to_string(),
        protocol_version: payload
            .get("protocol_version")
            .and_then(|value| value.as_u64())
            .unwrap_or(0),
    })
}

fn desk_api_registration_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(override_path) = std::env::var_os("PHOENIX_DESK_TOOLS_REGISTRY_DIR") {
        if !override_path.is_empty() {
            return Ok(PathBuf::from(override_path).join("service.v1.json"));
        }
    }
    Ok(app
        .path()
        .config_dir()
        .map_err(|error| format!("cannot resolve user configuration directory: {error}"))?
        .join("phoenix-wing/phoenix/services/desk-tools/service.v1.json"))
}

fn discover_registered_server(
    app: &AppHandle,
) -> Result<Option<(SocketAddr, DeskApiHealth)>, String> {
    let service_path = desk_api_registration_path(app)?;
    let source = match std::fs::read_to_string(&service_path) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Ok(None),
    };
    let registration: DeskApiRegistration = match serde_json::from_str(&source) {
        Ok(registration) => registration,
        Err(_) => return Ok(None),
    };
    if registration.schema_version != 1
        || registration.service != "phoenix-desk-tools"
        || registration.host != "127.0.0.1"
    {
        return Ok(None);
    }
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, registration.port));
    let Some(health) = phoenix_server_health(address) else {
        return Ok(None);
    };
    if registration.protocol_version != SERVER_PROTOCOL_VERSION
        || health.protocol_version != SERVER_PROTOCOL_VERSION
    {
        return Err(format!(
            "The running Desk API at {address} uses protocol {}/{}; this app requires protocol {SERVER_PROTOCOL_VERSION}.",
            registration.protocol_version, health.protocol_version,
        ));
    }
    Ok(Some((address, health)))
}

fn select_available_server_address() -> Result<SocketAddr, String> {
    for offset in 0..SERVER_PORT_ATTEMPTS {
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, SERVER_PREFERRED_PORT + offset));
        if let Ok(listener) = TcpListener::bind(address) {
            drop(listener);
            return Ok(address);
        }
    }
    Err(format!(
        "No local API port is available in {}..{}",
        SERVER_PREFERRED_PORT,
        SERVER_PREFERRED_PORT + SERVER_PORT_ATTEMPTS - 1,
    ))
}

fn managed_server_address(app: &AppHandle) -> Result<SocketAddr, String> {
    app.state::<ManagedServer>()
        .address
        .lock()
        .map(|address| *address)
        .map_err(|_| "Phoenix server address lock is poisoned".to_string())
}

fn set_managed_server_address(app: &AppHandle, address: SocketAddr) -> Result<(), String> {
    *app.state::<ManagedServer>()
        .address
        .lock()
        .map_err(|_| "Phoenix server address lock is poisoned".to_string())? = address;
    Ok(())
}

fn set_api_runtime_metadata(
    app: &AppHandle,
    source: &'static str,
    health: DeskApiHealth,
) -> Result<(), String> {
    *app.state::<ManagedServer>()
        .runtime
        .lock()
        .map_err(|_| "Phoenix runtime metadata lock is poisoned".to_string())? =
        ApiRuntimeMetadata {
            source,
            app_version: health.app_version,
            protocol_version: health.protocol_version,
        };
    Ok(())
}

#[cfg(any(debug_assertions, test))]
fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a repository parent")
        .to_path_buf()
}

fn configured_app_data_override(
    value: Option<std::ffi::OsString>,
) -> Result<Option<PathBuf>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_empty() {
        return Ok(None);
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err("PHOENIX_TAURI_USER_DATA_DIR must be an absolute path".to_string());
    }
    Ok(Some(path))
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) =
        configured_app_data_override(std::env::var_os("PHOENIX_TAURI_USER_DATA_DIR"))?
    {
        return Ok(path);
    }
    app.path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve Tauri application data directory: {error}"))
}

#[cfg(debug_assertions)]
fn backend_command(_app: &AppHandle, port: u16) -> Result<Command, String> {
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
        .env("CAA_SERVER_PORT", port.to_string())
        .env("PHOENIX_DESK_HOST", "tauri")
        .env("PHOENIX_REPO_ROOT", &root);
    Ok(command)
}

#[cfg(not(debug_assertions))]
fn backend_command(app: &AppHandle, port: u16) -> Result<Command, String> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| format!("cannot resolve Tauri resource directory: {error}"))?
        .join("runtime");
    let user_data = app_data_dir(app)?;
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
        .env("CAA_SERVER_PORT", port.to_string())
        .env("PHOENIX_DESK_HOST", "tauri")
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
    if let Some((address, health)) = discover_registered_server(app)? {
        set_managed_server_address(app, address)?;
        let version = health.app_version.clone();
        set_api_runtime_metadata(app, "reused", health)?;
        eprintln!("[tauri] reusing registered Phoenix server v{version} at http://{address}");
        return Ok(());
    }

    let address = select_available_server_address()?;
    set_managed_server_address(app, address)?;
    let mut command = backend_command(app, address.port())?;
    command.stdin(Stdio::null());
    if cfg!(debug_assertions) {
        command.stdout(Stdio::inherit()).stderr(Stdio::inherit());
    } else {
        let log_dir = app_data_dir(app)?.join("logs");
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
        if let Some(health) = phoenix_server_health(address) {
            if health.protocol_version == SERVER_PROTOCOL_VERSION {
                let version = health.app_version.clone();
                set_api_runtime_metadata(app, "managed", health)?;
                eprintln!("[tauri] Phoenix server v{version} ready at http://{address}");
                return Ok(());
            }
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
        "Phoenix Node service did not become healthy at http://{address} within {} seconds",
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

    let address = managed_server_address(app)
        .unwrap_or_else(|_| SocketAddr::from((Ipv4Addr::LOCALHOST, SERVER_PREFERRED_PORT)));
    let request = format!(
        "POST /api/shutdown HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}"
    );
    let _ = http_request(address, request.as_bytes());
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
    let log_dir = app_data_dir(app).ok()?.join("logs");
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

#[tauri::command]
fn get_runtime_info(app: AppHandle) -> Result<RuntimeInfoResponse, String> {
    let address = managed_server_address(&app)?;
    let server = app.state::<ManagedServer>();
    let runtime = server
        .runtime
        .lock()
        .map_err(|_| "Phoenix runtime metadata lock is poisoned".to_string())?;
    Ok(RuntimeInfoResponse {
        api_origin: format!("http://{address}"),
        api_source: runtime.source,
        api_version: runtime.app_version.clone(),
        protocol_version: runtime.protocol_version,
    })
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            let address = managed_server_address(app)
                .unwrap_or_else(|_| SocketAddr::from((Ipv4Addr::LOCALHOST, SERVER_PREFERRED_PORT)));
            if let Err(error) = dispatch_caa_dialog_launch_args(address, &args, &cwd) {
                eprintln!("[tauri] cannot dispatch CATDlg open request: {error}");
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(ManagedServer::default())
        .invoke_handler(tauri::generate_handler![
            pick_workspace_directory,
            shutdown_desktop,
            get_runtime_info
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
            let address = managed_server_address(app.handle())?;
            if let Err(error) = dispatch_caa_dialog_launch_args(address, &args, &cwd) {
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
    fn validates_the_optional_tauri_user_data_override() {
        assert_eq!(configured_app_data_override(None).unwrap(), None);
        assert_eq!(configured_app_data_override(Some("".into())).unwrap(), None);
        assert!(configured_app_data_override(Some("relative".into())).is_err());
        let absolute = std::env::temp_dir().join("phoenix-user-data");
        assert_eq!(
            configured_app_data_override(Some(absolute.clone().into_os_string())).unwrap(),
            Some(absolute)
        );
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
