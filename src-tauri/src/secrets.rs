//! AI API keys in the OS keychain (macOS Keychain, Windows Credential Manager,
//! Secret Service on Linux).
//!
//! Every key lives in ONE keychain item (a JSON map of id → key), read once per launch
//! and cached, so macOS asks for access at most once instead of once per profile.
//! Debug builds skip the keychain entirely: their binary changes on every rebuild, so
//! macOS would prompt on every run; the frontend then falls back to its local store.

use std::collections::HashMap;
use std::sync::Mutex;

use keyring::Entry;

const SERVICE: &str = "com.ashafizullah.wahana";
/// The account name of the single item holding every key.
const VAULT: &str = "vault";

/// The vault's contents once read this launch.
static CACHE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

const DEV_DISABLED: &str = "keychain is disabled in debug builds";

fn entry(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| e.to_string())
}

fn read_vault() -> Result<HashMap<String, String>, String> {
    match entry(VAULT)?.get_password() {
        Ok(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        Err(keyring::Error::NoEntry) => Ok(HashMap::new()),
        Err(e) => Err(e.to_string()),
    }
}

fn write_vault(vault: &HashMap<String, String>) -> Result<(), String> {
    let json = serde_json::to_string(vault).map_err(|e| e.to_string())?;
    entry(VAULT)?.set_password(&json).map_err(|e| e.to_string())
}

/// Runs `f` on the cached vault, reading it from the keychain on first use.
fn with_vault<T>(
    f: impl FnOnce(&mut HashMap<String, String>) -> Result<T, String>,
) -> Result<T, String> {
    let mut cache = CACHE.lock().unwrap();
    if cache.is_none() {
        *cache = Some(read_vault()?);
    }
    f(cache.as_mut().unwrap())
}

/// Store an API key in the OS keychain (macOS Keychain / Windows Credential Manager).
#[tauri::command]
pub fn save_api_key(profile: String, api_key: String) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err(DEV_DISABLED.into());
    }
    with_vault(|vault| {
        let mut next = vault.clone();
        next.insert(profile, api_key);
        write_vault(&next)?;
        *vault = next;
        Ok(())
    })
}

#[tauri::command]
pub fn get_api_key(profile: String) -> Result<Option<String>, String> {
    if cfg!(debug_assertions) {
        return Ok(None);
    }
    with_vault(|vault| {
        if let Some(key) = vault.get(&profile) {
            return Ok(Some(key.clone()));
        }
        // Keys saved before the vault had one item each: move it in, once.
        match entry(&profile)?.get_password() {
            Ok(key) => {
                let mut next = vault.clone();
                next.insert(profile.clone(), key.clone());
                write_vault(&next)?;
                *vault = next;
                let _ = entry(&profile)?.delete_credential();
                Ok(Some(key))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    })
}

#[tauri::command]
pub fn delete_api_key(profile: String) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    with_vault(|vault| {
        if vault.contains_key(&profile) {
            let mut next = vault.clone();
            next.remove(&profile);
            write_vault(&next)?;
            *vault = next;
        }
        match entry(&profile)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    })
}
