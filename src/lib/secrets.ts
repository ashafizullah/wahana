import { invoke } from "@tauri-apps/api/core";
import { load, type Store } from "@tauri-apps/plugin-store";

/**
 * Secret storage: OS keychain first (macOS Keychain / Windows Credential
 * Manager / Linux Secret Service). If the keychain is unavailable, fall back to
 * a local store file so the app keeps working — `usingFallback()` tells the UI
 * to warn that the key is then stored unencrypted.
 */
let storePromise: Promise<Store> | null = null;
const store = () => (storePromise ??= load("secrets.json", { autoSave: true, defaults: {} }));
let fallback = false;
export const usingFallback = () => fallback;

export async function getSecret(id: string): Promise<string> {
  try {
    const v = await invoke<string | null>("get_api_key", { profile: id });
    if (v) return v;
  } catch (e) {
    console.warn("keychain read failed", e);
    fallback = true;
  }
  // Keychain empty or unavailable → check the fallback file (also covers keys saved while the keychain was down).
  return (await (await store()).get<string>(id)) ?? "";
}

export async function setSecret(id: string, value: string) {
  try {
    await invoke("save_api_key", { profile: id, apiKey: value });
    await (await store()).delete(id).catch(() => {});
    fallback = false;
  } catch (e) {
    console.warn("keychain write failed, using local store", e);
    fallback = true;
    await (await store()).set(id, value);
  }
}

export async function deleteSecret(id: string) {
  await invoke("delete_api_key", { profile: id }).catch(() => {});
  await (await store()).delete(id).catch(() => {});
}
