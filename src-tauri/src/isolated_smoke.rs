//! Local, explicit test profile. No profile means no change to ordinary launch.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

pub const ROOT_ENV: &str = "PHOENIX_TAURI_ISOLATED_SMOKE_ROOT";
pub const RUN_ENV: &str = "PHOENIX_TAURI_ISOLATED_SMOKE_RUN_ID";
pub const MARKER_ENV: &str = "PHOENIX_TAURI_ISOLATED_SMOKE_MARKER";
pub const MARKER_NAME: &str = "isolated-host-smoke.v1.json";
pub const HANDOFF_NAME: &str = "host-recovery-smoke.v1.json";
pub const QUIT_NAME: &str = "host-recovery-smoke.quit.v1.json";
const MAX_JSON_BYTES: u64 = 4096;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Marker {
    kind: String,
    schema_version: u32,
    run_id: String,
    root: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Identity {
    #[cfg(unix)]
    dev: u64,
    #[cfg(unix)]
    ino: u64,
    directory: bool,
}
impl Identity {
    fn of(metadata: &Metadata) -> Self {
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        Self {
            #[cfg(unix)]
            dev: metadata.dev(),
            #[cfg(unix)]
            ino: metadata.ino(),
            directory: metadata.is_dir(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Profile {
    pub root: PathBuf,
    pub run_id: String,
    marker: PathBuf,
    marker_bytes: Vec<u8>,
    root_identity: Identity,
    marker_identity: Identity,
}

pub fn uuid_v4(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes[14] == b'4'
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
        && bytes.iter().enumerate().all(|(i, b)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                *b == b'-'
            } else {
                b.is_ascii_digit() || matches!(b, b'a'..=b'f')
            }
        })
}

fn strict_absolute(path: &Path) -> Result<(), String> {
    if !path.is_absolute()
        || path.to_str().is_none()
        || path
            .as_os_str()
            .to_string_lossy()
            .chars()
            .any(|c| c.is_control())
        || path
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
        || path.parent().is_none()
    {
        return Err("isolated smoke requires a specific normalized absolute path".into());
    }
    // Components normalize embedded `.`; reject lexical aliases too.
    let text = path.to_str().unwrap();
    if text
        .split(['/', '\\'])
        .any(|part| part == "." || part == "..")
    {
        return Err("isolated smoke path aliases are forbidden".into());
    }
    Ok(())
}

fn no_symlinks(path: &Path) -> Result<(), String> {
    let mut cursor = PathBuf::new();
    for component in path.components() {
        cursor.push(component);
        match fs::symlink_metadata(&cursor) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err("isolated smoke symlinks are forbidden".into())
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(_) => return Err("isolated smoke path cannot be inspected".into()),
        }
    }
    Ok(())
}

fn comparable(path: &Path) -> String {
    let text = path.to_string_lossy();
    #[cfg(windows)]
    {
        return text.strip_prefix("\\\\?\\").unwrap_or(&text).to_owned();
    }
    #[cfg(not(windows))]
    {
        text.into_owned()
    }
}

fn private_permissions(meta: &Metadata, directory: bool) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = meta.permissions().mode() & 0o777;
        if mode != if directory { 0o700 } else { 0o600 } {
            return Err("isolated smoke inputs require private permissions".into());
        }
    }
    #[cfg(not(unix))]
    let _ = (meta, directory);
    Ok(())
}

fn read_private_json(path: &Path) -> Result<(Vec<u8>, Identity), String> {
    no_symlinks(path)?;
    let before = fs::symlink_metadata(path).map_err(|_| "isolated smoke JSON is missing")?;
    if !before.is_file() || before.len() == 0 || before.len() > MAX_JSON_BYTES {
        return Err("isolated smoke JSON must be a bounded regular file".into());
    }
    private_permissions(&before, false)?;
    let mut file = File::open(path).map_err(|_| "isolated smoke JSON cannot be opened")?;
    let opened = file
        .metadata()
        .map_err(|_| "isolated smoke JSON cannot be inspected")?;
    if Identity::of(&opened) != Identity::of(&before) || !opened.is_file() {
        return Err("isolated smoke JSON identity changed".into());
    }
    let mut bytes = Vec::new();
    (&mut file)
        .take(MAX_JSON_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "isolated smoke JSON cannot be read")?;
    if bytes.len() as u64 != before.len() || bytes.len() as u64 > MAX_JSON_BYTES {
        return Err("isolated smoke JSON changed while reading".into());
    }
    no_symlinks(path)?;
    let after = fs::symlink_metadata(path).map_err(|_| "isolated smoke JSON disappeared")?;
    if Identity::of(&after) != Identity::of(&before)
        || after.len() != before.len()
        || after.modified().ok() != before.modified().ok()
    {
        return Err("isolated smoke JSON changed while reading".into());
    }
    Ok((bytes, Identity::of(&after)))
}

pub fn from_values(
    root: Option<OsString>,
    run: Option<OsString>,
    marker: Option<OsString>,
) -> Result<Option<Profile>, String> {
    if root.is_none() && run.is_none() && marker.is_none() {
        return Ok(None);
    }
    // The current contract has Unix file identity/private-mode evidence. Do not
    // substitute path spelling for Windows file-ID/ACL ownership checks.
    if !cfg!(unix) {
        return Err("isolated smoke profile is unsupported on this platform".into());
    }
    let (root, run, marker) = match (root, run, marker) {
        (Some(root), Some(run), Some(marker))
            if !root.is_empty() && !run.is_empty() && !marker.is_empty() =>
        {
            (root, run, marker)
        }
        _ => return Err("isolated smoke profile is incomplete".into()),
    };
    let root = PathBuf::from(root);
    strict_absolute(&root)?;
    no_symlinks(&root)?;
    let canonical =
        fs::canonicalize(&root).map_err(|_| "isolated smoke root must already exist")?;
    if comparable(&canonical) != comparable(&root) {
        return Err("isolated smoke root must be canonical".into());
    }
    let metadata =
        fs::symlink_metadata(&root).map_err(|_| "isolated smoke root cannot be inspected")?;
    if !metadata.is_dir() {
        return Err("isolated smoke root must be a directory".into());
    }
    private_permissions(&metadata, true)?;
    let run_id = run
        .into_string()
        .map_err(|_| "isolated smoke run ID is invalid")?;
    if !uuid_v4(&run_id) {
        return Err("isolated smoke run ID must be lowercase UUIDv4".into());
    }
    let marker = PathBuf::from(marker);
    if marker != root.join(MARKER_NAME) {
        return Err("isolated smoke marker must be inside its root".into());
    }
    let (marker_bytes, marker_identity) = read_private_json(&marker)?;
    let value: Marker =
        serde_json::from_slice(&marker_bytes).map_err(|_| "isolated smoke marker is malformed")?;
    if value.kind != "phoenix.desk.isolated-host-smoke"
        || value.schema_version != 1
        || value.run_id != run_id
        || value.root != root.to_str().unwrap()
    {
        return Err("isolated smoke marker identity does not match".into());
    }
    let profile = Profile {
        root,
        run_id,
        marker,
        marker_bytes,
        root_identity: Identity::of(&metadata),
        marker_identity,
    };
    profile.assert_current()?;
    for name in [HANDOFF_NAME, QUIT_NAME] {
        match fs::symlink_metadata(profile.root.join(name)) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            _ => return Err("isolated smoke control output already exists".into()),
        }
    }
    for name in ["user-data", "registration", "webview"] {
        profile.directory(name)?;
    }
    Ok(Some(profile))
}

impl Profile {
    pub fn from_env() -> Result<Option<Self>, String> {
        from_values(
            std::env::var_os(ROOT_ENV),
            std::env::var_os(RUN_ENV),
            std::env::var_os(MARKER_ENV),
        )
    }
    pub fn assert_current(&self) -> Result<(), String> {
        no_symlinks(&self.root)?;
        let current =
            fs::symlink_metadata(&self.root).map_err(|_| "isolated smoke root disappeared")?;
        if Identity::of(&current) != self.root_identity {
            return Err("isolated smoke root identity changed".into());
        }
        private_permissions(&current, true)?;
        let (bytes, identity) = read_private_json(&self.marker)?;
        if bytes != self.marker_bytes || identity != self.marker_identity {
            return Err("isolated smoke marker changed".into());
        }
        Ok(())
    }
    pub fn directory(&self, name: &str) -> Result<PathBuf, String> {
        self.assert_current()?;
        if !matches!(name, "user-data" | "registration" | "webview") {
            return Err("unknown isolated smoke directory".into());
        }
        let path = self.root.join(name);
        no_symlinks(&path)?;
        if let Ok(metadata) = fs::symlink_metadata(&path) {
            if !metadata.is_dir() {
                return Err("isolated smoke directory is not a directory".into());
            }
        }
        Ok(path)
    }
    pub fn create_directory(&self, name: &str) -> Result<PathBuf, String> {
        let path = self.directory(name)?;
        if !path.exists() {
            fs::create_dir(&path).map_err(|_| "cannot create isolated smoke directory")?;
        }
        self.directory(name)
    }
    pub fn publish_handoff(&self, handoff: &Handoff) -> Result<(), String> {
        self.assert_current()?;
        if handoff.run_id != self.run_id || handoff.host_pid != std::process::id() {
            return Err("isolated smoke handoff does not match this host".into());
        }
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let temporary = self
            .root
            .join(format!(".handoff-{}-{}.tmp", self.run_id, handoff.host_pid));
        let mut file = options.open(&temporary).map_err(|_| {
            "isolated smoke handoff temporary file already exists or cannot be created"
        })?;
        let owned_identity = Identity::of(
            &file
                .metadata()
                .map_err(|_| "cannot inspect isolated handoff")?,
        );
        file.write_all(
            &serde_json::to_vec(handoff).map_err(|_| "cannot serialize isolated smoke handoff")?,
        )
        .map_err(|_| "cannot write isolated smoke handoff")?;
        file.sync_all()
            .map_err(|_| "cannot flush isolated smoke handoff")?;
        self.assert_current()?;
        // Atomic publication without overwrite. A check followed by rename is
        // insufficient: another record could appear between those operations.
        fs::hard_link(&temporary, self.root.join(HANDOFF_NAME))
            .map_err(|_| "isolated smoke handoff already exists or cannot be published")?;
        self.assert_current()?;
        let temporary_metadata = fs::symlink_metadata(&temporary)
            .map_err(|_| "isolated smoke handoff temporary identity disappeared")?;
        if temporary_metadata.file_type().is_symlink()
            || Identity::of(&temporary_metadata) != owned_identity
        {
            return Err("isolated smoke handoff temporary identity changed".into());
        }
        fs::remove_file(&temporary).map_err(|_| "cannot remove owned handoff temporary file")?;
        Ok(())
    }
    pub fn read_registration(&self) -> Result<crate::DeskApiRegistration, String> {
        let directory = self.directory("registration")?;
        let (bytes, _) = read_private_json(&directory.join("service.v1.json"))?;
        serde_json::from_slice(&bytes)
            .map_err(|_| "isolated smoke registration is malformed".into())
    }
    pub fn quit_requested(&self, host_pid: u32) -> Result<bool, String> {
        self.assert_current()?;
        let path = self.root.join(QUIT_NAME);
        match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(_) => return Err("isolated smoke quit request cannot be inspected".into()),
            _ => {}
        }
        let (bytes, _) = read_private_json(&path)?;
        valid_quit_request(&bytes, &self.run_id, host_pid)
    }
}

/// Keep only OS launch inputs, never arbitrary credentials or feature overrides.
/// Genuine HOME/user-profile values are retained, not repurposed as test folders.
pub fn clean_environment(
    values: impl Iterator<Item = (OsString, OsString)>,
) -> HashMap<OsString, OsString> {
    values
        .filter(|(key, _)| {
            let key = key.to_string_lossy().to_ascii_uppercase();
            matches!(
                key.as_str(),
                "PATH"
                    | "HOME"
                    | "USERPROFILE"
                    | "CFFIXED_USER_HOME"
                    | "SYSTEMROOT"
                    | "WINDIR"
                    | "COMSPEC"
                    | "PATHEXT"
                    | "LANG"
                    | "TZ"
            ) || (key.starts_with("LC_")
                && key[3..]
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte == b'_'))
        })
        .collect()
}

/// Pure projection of a validated profile's owned roots. The caller validates
/// the profile and packaged resources; no inherited data/config/tmp override
/// participates, and no HOME value is replaced by a test directory.
pub fn runtime_environment(
    root: &Path,
    resources: &Path,
    port: u16,
) -> HashMap<OsString, OsString> {
    let user_data = root.join("user-data");
    let system_config = root.join("system-config");
    let mut values: HashMap<OsString, OsString> = [
        ("CAA_SERVER_PORT", port.to_string()),
        ("PHOENIX_DESK_HOST", "tauri".into()),
        ("PHOENIX_PACKAGED", "1".into()),
    ]
    .into_iter()
    .map(|(key, value)| (key.into(), value.into()))
    .collect();
    for (key, path) in [
        ("PHOENIX_REPO_ROOT", resources.to_path_buf()),
        ("PHOENIX_RESOURCES_DIR", resources.to_path_buf()),
        ("PHOENIX_NATIVE_BIN_DIR", resources.join("bin")),
        ("PHOENIX_USER_DATA_DIR", user_data.clone()),
        ("PHOENIX_LEGACY_USER_DATA_DIR", user_data.clone()),
        (
            "PHOENIX_RUNTIME_CATALOG_PATH",
            user_data.join("runtime-catalog.sqlite"),
        ),
        ("PHOENIX_DESK_TOOLS_REGISTRY_DIR", root.join("registration")),
        (
            "PHOENIX_APP_CONFIG_PATH",
            resources.join("phoenix/config/app_config.json"),
        ),
        (
            "PHOENIX_TEST_FIXTURE_CATALOG_PATH",
            resources.join("phoenix/config/test_fixture_catalog.json"),
        ),
        ("TMPDIR", root.to_path_buf()),
        ("TEMP", root.to_path_buf()),
        ("TMP", root.to_path_buf()),
        ("XDG_CONFIG_HOME", system_config.clone()),
        ("XDG_CACHE_HOME", root.join("cache")),
        ("APPDATA", system_config.join("Roaming")),
        ("LOCALAPPDATA", system_config.join("Local")),
    ] {
        values.insert(key.into(), path.into_os_string());
    }
    values
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Handoff {
    pub kind: &'static str,
    pub schema_version: u32,
    pub isolated_launch_version: u32,
    pub profile_version: u32,
    pub run_id: String,
    pub host_pid: u32,
    pub sidecar_pid: u32,
    pub instance_id: String,
    pub api_origin: String,
    pub api_source: &'static str,
    pub quit_request_file: &'static str,
    pub runtime_user_data_dir: String,
    pub registration_dir: String,
}
pub fn handoff(
    profile: &Profile,
    host_pid: u32,
    sidecar_pid: u32,
    instance_id: &str,
    address: std::net::SocketAddr,
) -> Result<Handoff, String> {
    let run_id = &profile.run_id;
    if !uuid_v4(run_id)
        || !uuid_v4(instance_id)
        || host_pid == 0
        || sidecar_pid == 0
        || host_pid == sidecar_pid
        || address.ip() != std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
        || address.port() == 0
    {
        return Err("isolated smoke handoff identity is invalid".into());
    }
    Ok(Handoff {
        kind: "phoenix.desk.isolated-host-handoff",
        schema_version: 1,
        isolated_launch_version: 1,
        profile_version: 1,
        run_id: run_id.into(),
        host_pid,
        sidecar_pid,
        instance_id: instance_id.into(),
        api_origin: format!("http://{address}"),
        api_source: "managed",
        quit_request_file: QUIT_NAME,
        runtime_user_data_dir: profile
            .directory("user-data")?
            .to_string_lossy()
            .into_owned(),
        registration_dir: profile
            .directory("registration")?
            .to_string_lossy()
            .into_owned(),
    })
}

pub fn owns_registration(
    registration: &crate::DeskApiRegistration,
    sidecar_pid: u32,
    expected_instance: Option<&str>,
    address: std::net::SocketAddr,
) -> bool {
    registration.schema_version == 1
        && address.ip() == std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
        && address.port() != 0
        && registration.service == "phoenix-desk-tools"
        && registration.protocol_version == crate::SERVER_PROTOCOL_VERSION
        && registration.host == "127.0.0.1"
        && registration.port == address.port()
        && registration.pid == Some(sidecar_pid)
        && sidecar_pid != 0
        && registration.instance_id.as_deref().is_some_and(uuid_v4)
        && expected_instance
            .is_none_or(|expected| registration.instance_id.as_deref() == Some(expected))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct QuitRequest {
    kind: String,
    schema_version: u32,
    run_id: String,
    host_pid: u32,
}
pub fn valid_quit_request(bytes: &[u8], run_id: &str, host_pid: u32) -> Result<bool, String> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_JSON_BYTES {
        return Err("isolated smoke quit request exceeds its budget".into());
    }
    let request: QuitRequest =
        serde_json::from_slice(bytes).map_err(|_| "isolated smoke quit request is malformed")?;
    Ok(request.kind == "phoenix.desk.isolated-host-quit"
        && request.schema_version == 1
        && request.run_id == run_id
        && uuid_v4(run_id)
        && request.host_pid == host_pid
        && host_pid != 0)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    const RUN: &str = "12345678-1234-4234-8234-123456789abc";
    const INSTANCE: &str = "abcdef12-1234-4234-a234-123456789abc";
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let name = format!(
                "desk-isolated-profile-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            );
            let path = std::env::temp_dir().join(name);
            fs::create_dir(&path).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
            }
            let path = fs::canonicalize(path).unwrap();
            Self(path)
        }
        fn write(&self, name: &str, bytes: &[u8]) {
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            options
                .open(self.0.join(name))
                .unwrap()
                .write_all(bytes)
                .unwrap();
        }
        fn marker(&self) {
            self.write(MARKER_NAME, &serde_json::to_vec(&serde_json::json!({
                "kind":"phoenix.desk.isolated-host-smoke", "schema_version":1, "run_id":RUN, "root":self.0,
            })).unwrap());
        }
        fn values(&self) -> (Option<OsString>, Option<OsString>, Option<OsString>) {
            (
                Some(self.0.clone().into_os_string()),
                Some(RUN.into()),
                Some(self.0.join(MARKER_NAME).into_os_string()),
            )
        }
        fn profile(&self) -> Profile {
            let (root, run, marker) = self.values();
            from_values(root, run, marker).unwrap().unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn absent_profile_preserves_normal_launch_and_creates_nothing() {
        let fixture = Fixture::new();
        assert!(from_values(None, None, None).unwrap().is_none());
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 0);
    }
    #[test]
    fn incomplete_empty_and_non_v4_profiles_fail_closed() {
        let fixture = Fixture::new();
        fixture.marker();
        assert!(from_values(Some(fixture.0.clone().into()), None, None).is_err());
        assert!(from_values(Some("".into()), Some(RUN.into()), Some("".into())).is_err());
        let (root, _, marker) = fixture.values();
        assert!(from_values(
            root,
            Some("12345678-1234-1234-8234-123456789abc".into()),
            marker
        )
        .is_err());
        assert!(!uuid_v4(&RUN.to_uppercase()));
    }
    #[test]
    fn rejects_noncanonical_relative_root_and_external_marker() {
        let fixture = Fixture::new();
        fixture.marker();
        let (_, run, marker) = fixture.values();
        assert!(from_values(Some("relative".into()), run.clone(), marker.clone()).is_err());
        assert!(from_values(Some(fixture.0.join(".").into()), run.clone(), marker).is_err());
        assert!(from_values(
            Some(fixture.0.clone().into()),
            run,
            Some(fixture.0.join("other.json").into())
        )
        .is_err());
    }
    #[test]
    fn rejects_missing_wrong_extra_duplicate_and_oversize_markers() {
        for kind in ["missing", "wrong", "extra", "duplicate", "oversize", "utf8"] {
            let fixture = Fixture::new();
            let value = serde_json::json!({ "kind":"phoenix.desk.isolated-host-smoke", "schema_version":1, "run_id":RUN, "root":fixture.0 });
            match kind {
                "missing" => {}
                "wrong" => {
                    let mut value = value;
                    value["run_id"] = INSTANCE.into();
                    fixture.write(MARKER_NAME, &serde_json::to_vec(&value).unwrap());
                }
                "extra" => {
                    let mut value = value;
                    value["proof"] = "not trusted".into();
                    fixture.write(MARKER_NAME, &serde_json::to_vec(&value).unwrap());
                }
                "duplicate" => {
                    let text = serde_json::to_string(&value).unwrap().replacen(
                        '{',
                        "{\"schema_version\":1,",
                        1,
                    );
                    fixture.write(MARKER_NAME, text.as_bytes());
                }
                "oversize" => fixture.write(MARKER_NAME, &vec![b' '; MAX_JSON_BYTES as usize + 1]),
                "utf8" => fixture.write(MARKER_NAME, &[255]),
                _ => unreachable!(),
            }
            let (root, run, marker) = fixture.values();
            assert!(from_values(root, run, marker).is_err(), "{kind}");
        }
    }
    #[test]
    fn accepts_private_owned_inputs_without_creating_directories() {
        let fixture = Fixture::new();
        fixture.marker();
        let profile = fixture.profile();
        assert_eq!(profile.root, fixture.0);
        assert_eq!(profile.run_id, RUN);
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
        assert_eq!(
            profile.directory("user-data").unwrap(),
            fixture.0.join("user-data")
        );
        assert!(profile.directory("../outside").is_err());
    }
    #[test]
    fn rejects_old_control_outputs_and_changed_marker_without_deleting_them() {
        for output in [HANDOFF_NAME, QUIT_NAME] {
            let fixture = Fixture::new();
            fixture.marker();
            fixture.write(output, b"existing independent record");
            let (root, run, marker) = fixture.values();
            assert!(from_values(root, run, marker).is_err());
            assert_eq!(
                fs::read(fixture.0.join(output)).unwrap(),
                b"existing independent record"
            );
        }
        let fixture = Fixture::new();
        fixture.marker();
        let profile = fixture.profile();
        fs::write(fixture.0.join(MARKER_NAME), b"changed").unwrap();
        assert!(profile.assert_current().is_err());
    }
    #[test]
    fn rejects_replaced_marker_even_when_original_bytes_are_restored() {
        let fixture = Fixture::new();
        fixture.marker();
        let profile = fixture.profile();
        let bytes = fs::read(fixture.0.join(MARKER_NAME)).unwrap();
        fs::rename(
            fixture.0.join(MARKER_NAME),
            fixture.0.join("previous-marker"),
        )
        .unwrap();
        fixture.write(MARKER_NAME, &bytes);
        assert!(profile.assert_current().is_err());
        assert_eq!(fs::read(fixture.0.join("previous-marker")).unwrap(), bytes);
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_roots_marker_derived_directory_and_quit_file() {
        use std::os::unix::fs::symlink;
        let source = Fixture::new();
        source.marker();
        let link = Fixture::new();
        symlink(&source.0, link.0.join("linked")).unwrap();
        let root = link.0.join("linked");
        assert!(from_values(
            Some(root.clone().into()),
            Some(RUN.into()),
            Some(root.join(MARKER_NAME).into())
        )
        .is_err());
        symlink(source.0.join(MARKER_NAME), link.0.join(MARKER_NAME)).unwrap();
        let (root, run, marker) = link.values();
        assert!(from_values(root, run, marker).is_err());
        let profile = source.profile();
        symlink(&link.0, source.0.join("registration")).unwrap();
        assert!(profile.directory("registration").is_err());
        symlink(link.0.join(MARKER_NAME), source.0.join(QUIT_NAME)).unwrap();
        assert!(profile.quit_requested(10).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn rejects_public_root_and_marker_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = Fixture::new();
        fixture.marker();
        fs::set_permissions(&fixture.0, fs::Permissions::from_mode(0o755)).unwrap();
        let (root, run, marker) = fixture.values();
        assert!(from_values(root, run, marker).is_err());
        fs::set_permissions(&fixture.0, fs::Permissions::from_mode(0o700)).unwrap();
        fs::set_permissions(
            fixture.0.join(MARKER_NAME),
            fs::Permissions::from_mode(0o644),
        )
        .unwrap();
        let (root, run, marker) = fixture.values();
        assert!(from_values(root, run, marker).is_err());
    }
    #[test]
    fn cleans_inherited_redirects_and_injection_without_replacing_home() {
        let input = [
            "HOME",
            "USERPROFILE",
            "PATH",
            ROOT_ENV,
            "PHOENIX_LEGACY_USER_DATA_DIR",
            "PHOENIX_APP_CONFIG_PATH",
            "PHOENIX_RUNTIME_CATALOG_PATH",
            "CAA_SERVER_PORT",
            "NODE_OPTIONS",
            "NODE_PATH",
            "DYLD_INSERT_LIBRARIES",
            "LD_PRELOAD",
            "WEBVIEW2_USER_DATA_FOLDER",
            "PRIVATE_TOKEN",
        ];
        let clean = clean_environment(
            input
                .iter()
                .map(|key| (OsString::from(key), OsString::from("independent value"))),
        );
        assert_eq!(clean.len(), 3);
        for key in ["HOME", "USERPROFILE", "PATH"] {
            assert_eq!(
                clean.get(&OsString::from(key)),
                Some(&OsString::from("independent value"))
            );
        }
    }
    #[test]
    fn projects_all_runtime_data_and_os_configuration_to_explicit_owned_roots() {
        let fixture = Fixture::new();
        let resources = fixture.0.join("packaged-input");
        let values = runtime_environment(&fixture.0, &resources, 12345);
        assert_eq!(values.len(), 19);
        for (key, expected) in [
            ("PHOENIX_USER_DATA_DIR", fixture.0.join("user-data")),
            ("PHOENIX_LEGACY_USER_DATA_DIR", fixture.0.join("user-data")),
            (
                "PHOENIX_RUNTIME_CATALOG_PATH",
                fixture.0.join("user-data/runtime-catalog.sqlite"),
            ),
            (
                "PHOENIX_DESK_TOOLS_REGISTRY_DIR",
                fixture.0.join("registration"),
            ),
            ("TMPDIR", fixture.0.clone()),
            ("TEMP", fixture.0.clone()),
            ("TMP", fixture.0.clone()),
            ("XDG_CONFIG_HOME", fixture.0.join("system-config")),
            ("XDG_CACHE_HOME", fixture.0.join("cache")),
            ("APPDATA", fixture.0.join("system-config/Roaming")),
            ("LOCALAPPDATA", fixture.0.join("system-config/Local")),
            ("PHOENIX_REPO_ROOT", resources.clone()),
            ("PHOENIX_RESOURCES_DIR", resources.clone()),
            ("PHOENIX_NATIVE_BIN_DIR", resources.join("bin")),
            (
                "PHOENIX_APP_CONFIG_PATH",
                resources.join("phoenix/config/app_config.json"),
            ),
            (
                "PHOENIX_TEST_FIXTURE_CATALOG_PATH",
                resources.join("phoenix/config/test_fixture_catalog.json"),
            ),
        ] {
            assert_eq!(
                values.get(&OsString::from(key)),
                Some(&expected.into_os_string()),
                "{key}"
            );
        }
        assert_eq!(
            values.get(&OsString::from("CAA_SERVER_PORT")),
            Some(&OsString::from("12345"))
        );
        assert_eq!(
            values.get(&OsString::from("PHOENIX_DESK_HOST")),
            Some(&OsString::from("tauri"))
        );
        assert_eq!(
            values.get(&OsString::from("PHOENIX_PACKAGED")),
            Some(&OsString::from("1"))
        );
        for key in [
            "HOME",
            "USERPROFILE",
            "CFFIXED_USER_HOME",
            "NODE_OPTIONS",
            "PRIVATE_TOKEN",
        ] {
            assert!(!values.contains_key(&OsString::from(key)));
        }
        assert_eq!(
            fs::read_dir(&fixture.0).unwrap().count(),
            0,
            "projection must be pure"
        );
    }
    #[test]
    fn binds_handoff_to_run_host_sidecar_and_isolated_paths() {
        let fixture = Fixture::new();
        fixture.marker();
        let profile = fixture.profile();
        let address = "127.0.0.1:12345".parse().unwrap();
        let proof = handoff(&profile, 10, 11, INSTANCE, address).unwrap();
        assert_eq!(proof.api_source, "managed");
        assert_eq!(proof.profile_version, 1);
        assert_eq!(proof.quit_request_file, QUIT_NAME);
        assert_eq!(proof.run_id, RUN);
        assert_eq!(
            proof.runtime_user_data_dir,
            fixture.0.join("user-data").to_string_lossy()
        );
        assert_eq!(
            proof.registration_dir,
            fixture.0.join("registration").to_string_lossy()
        );
        for (host, sidecar, instance, address) in [
            (0, 11, INSTANCE, address),
            (10, 10, INSTANCE, address),
            (10, 11, "invalid", address),
            (10, 11, INSTANCE, "127.0.0.2:12345".parse().unwrap()),
        ] {
            assert!(handoff(&profile, host, sidecar, instance, address).is_err());
        }
        let proof = handoff(
            &profile,
            std::process::id(),
            std::process::id() + 1,
            INSTANCE,
            address,
        )
        .unwrap();
        profile.publish_handoff(&proof).unwrap();
        let original = fs::read(fixture.0.join(HANDOFF_NAME)).unwrap();
        assert!(profile.publish_handoff(&proof).is_err());
        assert_eq!(fs::read(fixture.0.join(HANDOFF_NAME)).unwrap(), original);
    }
    #[test]
    fn shutdown_guard_rejects_foreign_process_instance_and_endpoint() {
        let mut registration = crate::DeskApiRegistration {
            schema_version: 1,
            service: "phoenix-desk-tools".into(),
            protocol_version: 1,
            host: "127.0.0.1".into(),
            port: 12345,
            pid: Some(11),
            instance_id: Some(INSTANCE.into()),
        };
        let address = "127.0.0.1:12345".parse().unwrap();
        assert!(owns_registration(
            &registration,
            11,
            Some(INSTANCE),
            address
        ));
        assert!(!owns_registration(
            &registration,
            12,
            Some(INSTANCE),
            address
        ));
        assert!(!owns_registration(&registration, 11, Some(RUN), address));
        assert!(!owns_registration(
            &registration,
            11,
            Some(INSTANCE),
            "127.0.0.2:12345".parse().unwrap(),
        ));
        registration.port = 12346;
        assert!(!owns_registration(
            &registration,
            11,
            Some(INSTANCE),
            address
        ));
        registration.port = 12345;
        registration.pid = None;
        assert!(!owns_registration(&registration, 11, None, address));
    }
    #[test]
    fn only_exact_quit_request_can_exit_current_host() {
        let request = serde_json::json!({ "kind":"phoenix.desk.isolated-host-quit", "schema_version":1, "run_id":RUN, "host_pid":10 });
        let bytes = serde_json::to_vec(&request).unwrap();
        assert!(valid_quit_request(&bytes, RUN, 10).unwrap());
        assert!(!valid_quit_request(&bytes, INSTANCE, 10).unwrap());
        assert!(!valid_quit_request(&bytes, RUN, 11).unwrap());
        let mut extra = request.clone();
        extra["proof"] = true.into();
        assert!(valid_quit_request(&serde_json::to_vec(&extra).unwrap(), RUN, 10).is_err());
        assert!(valid_quit_request(b"{", RUN, 10).is_err());
        assert!(valid_quit_request(&vec![b' '; 4097], RUN, 10).is_err());
        let fixture = Fixture::new();
        fixture.marker();
        let profile = fixture.profile();
        assert!(!profile.quit_requested(10).unwrap());
        fixture.write(QUIT_NAME, &bytes);
        assert!(profile.quit_requested(10).unwrap());
        assert!(!profile.quit_requested(11).unwrap());
    }
}

#[cfg(all(test, not(unix)))]
mod unsupported_tests {
    use super::*;
    #[test]
    fn no_profile_is_unchanged_but_isolated_profile_is_explicitly_unsupported() {
        assert!(from_values(None, None, None).unwrap().is_none());
        let error = from_values(Some("ignored".into()), None, None).unwrap_err();
        assert!(error.contains("unsupported"));
    }
}
