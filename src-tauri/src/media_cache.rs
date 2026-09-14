//! On-disk cache for downloaded media so it is not fetched twice. Keys are hashed message
//! ids; eviction is LRU-ish (by mtime) and runs lazily on a background thread.

use serde::Serialize;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    time::SystemTime,
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Manager,
};

// ── Media cache (downloaded media kept on disk so it is not fetched twice) ──

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("media");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Keys are message ids + extension. Message ids contain `@`, `:` and other characters
/// that are not filesystem-safe; a lossy substitution would let two distinct ids collide
/// (`…@c.us_x` vs `…_c_us_x`), so hash the id and keep only the extension readable.
fn safe_key(key: &str) -> String {
    // FNV-1a 64-bit: tiny, dependency-free, plenty for a local cache namespace.
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in key.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    let ext = key
        .rsplit_once('.')
        .map(|(_, e)| e)
        .filter(|e| !e.is_empty() && e.len() <= 8 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or("bin");
    format!("{h:016x}.{ext}")
}

#[derive(Serialize)]
pub struct CacheStats {
    bytes: u64,
    files: u64,
    path: String,
}

fn scan(dir: &PathBuf) -> Vec<(PathBuf, u64, SystemTime)> {
    fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| {
                    let md = e.metadata().ok()?;
                    if !md.is_file() {
                        return None;
                    }
                    Some((
                        e.path(),
                        md.len(),
                        md.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

// Media cache commands are `async` so their file IO runs on the async runtime's thread
// pool, not on the main thread inside the webview's IPC callback (a multi-MB video read
// there stalls the UI, and on Windows blocks WebView2 message pumping).

#[tauri::command]
pub async fn media_cache_has(app: AppHandle, key: String) -> Result<bool, String> {
    Ok(cache_dir(&app)?.join(safe_key(&key)).is_file())
}

/// Returns the cached bytes as a raw ArrayBuffer (no JSON overhead).
#[tauri::command]
pub async fn media_cache_get(app: AppHandle, key: String) -> Result<Response, String> {
    let path = cache_dir(&app)?.join(safe_key(&key));
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    // Touch mtime so eviction is LRU-ish.
    // (Needs a writable handle: on Windows `set_modified` fails on a read-only one.)
    let _ = fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .and_then(|f| f.set_modified(SystemTime::now()));
    Ok(Response::new(bytes))
}

/// Body is the raw file; `x-key` header names it, `x-limit` (bytes) caps the cache size.
#[tauri::command]
pub fn media_cache_put(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
    };
    let key = header("x-key").ok_or("missing x-key")?;
    let limit: u64 = header("x-limit").and_then(|s| s.parse().ok()).unwrap_or(0);
    let bytes = match request.body() {
        InvokeBody::Raw(b) => b.clone(),
        InvokeBody::Json(_) => return Err("expected raw body".into()),
    };
    let dir = cache_dir(&app)?;
    let written = bytes.len() as u64;
    // `Request<'_>` borrows, so this command must stay sync: keep the fast write here and
    // push the directory scan / eviction onto a background thread.
    fs::write(dir.join(safe_key(&key)), &bytes).map_err(|e| e.to_string())?;
    if limit > 0 {
        maybe_evict(dir, limit, written);
    }
    Ok(())
}

/// Bytes written since the last full scan; eviction runs when this exceeds a slice of the
/// limit (hysteresis), never on every put.
static CACHE_UNSCANNED: AtomicU64 = AtomicU64::new(u64::MAX / 2);
static CACHE_EVICTING: AtomicBool = AtomicBool::new(false);

fn maybe_evict(dir: PathBuf, limit: u64, written: u64) {
    let pending = CACHE_UNSCANNED.fetch_add(written, Ordering::Relaxed) + written;
    // Scan at most once per (limit / 16, but ≥ 8 MB) written.
    if pending < (limit / 16).max(8 * 1024 * 1024) {
        return;
    }
    if CACHE_EVICTING.swap(true, Ordering::AcqRel) {
        return; // one at a time
    }
    CACHE_UNSCANNED.store(0, Ordering::Relaxed);
    std::thread::spawn(move || {
        let mut files = scan(&dir);
        let mut total: u64 = files.iter().map(|f| f.1).sum();
        if total > limit {
            files.sort_by_key(|f| f.2); // oldest first
                                        // Evict down to 90% so the next few puts don't immediately trigger another scan.
            let target = limit / 10 * 9;
            for (path, size, _) in files {
                if total <= target {
                    break;
                }
                if fs::remove_file(&path).is_ok() {
                    total -= size;
                }
            }
        }
        CACHE_EVICTING.store(false, Ordering::Release);
    });
}

#[tauri::command]
pub async fn media_cache_stats(app: AppHandle) -> Result<CacheStats, String> {
    let dir = cache_dir(&app)?;
    let files = scan(&dir);
    Ok(CacheStats {
        bytes: files.iter().map(|f| f.1).sum(),
        files: files.len() as u64,
        path: dir.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn media_cache_clear(app: AppHandle) -> Result<(), String> {
    let dir = cache_dir(&app)?;
    fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())
}
