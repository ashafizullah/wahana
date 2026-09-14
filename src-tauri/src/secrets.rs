//! WAHA / AI API keys in the OS keychain (macOS Keychain, Windows Credential Manager,
//! Secret Service on Linux).

use keyring::Entry;

const SERVICE: &str = "com.ashafizullah.wahana";

fn entry(profile: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, profile).map_err(|e| e.to_string())
}

/// Store the WAHA API key in the OS keychain (macOS Keychain / Windows Credential Manager).
#[tauri::command]
pub fn save_api_key(profile: String, api_key: String) -> Result<(), String> {
    entry(&profile)?
        .set_password(&api_key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_api_key(profile: String) -> Result<Option<String>, String> {
    match entry(&profile)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_api_key(profile: String) -> Result<(), String> {
    match entry(&profile)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
