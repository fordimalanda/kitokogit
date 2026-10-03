//! Stockage des clés API.
//!
//! Les clés sont déposées dans le gestionnaire d'identifiants du système
//! (Windows Credential Manager, Keychain macOS, Secret Service Linux) : elles
//! sont chiffrées par l'OS et **ne sont jamais renvoyées à la webview**.
//! Les appels aux providers IA seront faits depuis Rust (étape 3) via
//! [`load_api_key`], qui n'est pas une commande Tauri.

use serde::{Deserialize, Serialize};

/// Nom du service sous lequel les clés sont enregistrées.
const SERVICE: &str = "KitokoGit";

/// Providers reconnus. Whitelist stricte : on n'écrit rien pour un provider inconnu.
const PROVIDERS: [&str; 5] = ["openai", "claude", "gemini", "deepseek", "ollama"];

fn is_supported(provider: &str) -> bool {
    PROVIDERS.contains(&provider)
}

fn entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, provider)
        .map_err(|error| format!("Coffre du système inaccessible : {error}"))
}

/// Lecture interne, réservée au module IA côté Rust (étape 3 : génération de
/// message de commit). Volontairement non exposée comme commande Tauri.
#[allow(dead_code)]
pub fn load_api_key(provider: &str) -> Result<Option<String>, String> {
    if !is_supported(provider) {
        return Err(format!("Provider inconnu : {provider}"));
    }
    match entry(provider)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Lecture de la clé impossible : {error}")),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeyStatus {
    pub provider: String,
    pub has_key: bool,
}

/// Enregistre (ou remplace) la clé d'un provider.
#[tauri::command]
pub fn set_api_key(provider: String, api_key: String) -> Result<(), String> {
    if !is_supported(&provider) {
        return Err(format!("Provider inconnu : {provider}"));
    }

    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err("La clé API ne peut pas être vide.".to_string());
    }

    entry(&provider)?
        .set_password(trimmed)
        .map_err(|error| format!("Enregistrement de la clé impossible : {error}"))
}

/// Supprime la clé d'un provider. Idempotent : supprimer une clé absente est un succès.
#[tauri::command]
pub fn delete_api_key(provider: String) -> Result<(), String> {
    if !is_supported(&provider) {
        return Err(format!("Provider inconnu : {provider}"));
    }

    match entry(&provider)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Suppression de la clé impossible : {error}")),
    }
}

/// Indique, pour chaque provider, si une clé est présente. Aucun secret n'est renvoyé.
#[tauri::command]
pub fn list_api_key_status() -> Result<Vec<ProviderKeyStatus>, String> {
    Ok(PROVIDERS
        .iter()
        .map(|provider| ProviderKeyStatus {
            provider: (*provider).to_string(),
            has_key: matches!(load_api_key(provider), Ok(Some(_))),
        })
        .collect())
}
