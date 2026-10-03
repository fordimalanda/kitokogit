//! Journal local des commits générés.
//!
//! On conserve les derniers commits produits par KitokoGit (IA ou heuristique
//! de repli) afin de pouvoir retrouver un hash, un message ou le provider
//! utilisé. Le fichier vit à côté des réglages (`app_config_dir/history.json`)
//! et ne contient aucun secret.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::settings::config_dir;

const FILE_NAME: &str = "history.json";

/// Nombre maximum d'entrées conservées.
const MAX_ENTRIES: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HistoryEntry {
    pub id: String,
    /// Horodatage Unix en millisecondes.
    pub timestamp: u64,
    pub project_path: String,
    pub project_name: String,
    pub branch: Option<String>,
    /// Provider IA utilisé (`None` si heuristique locale).
    pub provider: Option<String>,
    pub model: Option<String>,
    pub message: String,
    pub commit_hash: Option<String>,
    /// `ai` ou `local`.
    pub origin: String,
    /// Faux si l'opération a échoué après la génération du message.
    pub success: bool,
}

impl Default for HistoryEntry {
    fn default() -> Self {
        Self {
            id: String::new(),
            timestamp: 0,
            project_path: String::new(),
            project_name: String::new(),
            branch: None,
            provider: None,
            model: None,
            message: String::new(),
            commit_hash: None,
            origin: "local".to_string(),
            success: false,
        }
    }
}

fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(FILE_NAME))
}

/// Lit le journal. Un fichier absent ou corrompu donne une liste vide plutôt
/// qu'une erreur : l'historique ne doit jamais bloquer l'application.
fn read(app: &AppHandle) -> Result<Vec<HistoryEntry>, String> {
    let path = history_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = std::fs::read_to_string(&path)
        .map_err(|error| format!("Lecture du journal impossible : {error}"))?;

    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

fn write(app: &AppHandle, entries: &[HistoryEntry]) -> Result<(), String> {
    let path = history_path(app)?;
    let raw = serde_json::to_string_pretty(entries)
        .map_err(|error| format!("Sérialisation du journal impossible : {error}"))?;

    std::fs::write(&path, raw).map_err(|error| format!("Écriture du journal impossible : {error}"))
}

#[tauri::command]
pub fn history_list(app: AppHandle) -> Result<Vec<HistoryEntry>, String> {
    read(&app)
}

/// Ajoute une entrée en tête et renvoie le journal à jour.
/// Les entrées au-delà de [`MAX_ENTRIES`] sont oubliées.
#[tauri::command]
pub fn history_add(app: AppHandle, entry: HistoryEntry) -> Result<Vec<HistoryEntry>, String> {
    if entry.id.trim().is_empty() {
        return Err("Entrée d'historique sans identifiant.".to_string());
    }

    let mut entries = read(&app)?;
    entries.retain(|item| item.id != entry.id);
    entries.insert(0, entry);
    entries.truncate(MAX_ENTRIES);

    write(&app, &entries)?;
    Ok(entries)
}

#[tauri::command]
pub fn history_clear(app: AppHandle) -> Result<(), String> {
    write(&app, &[])
}
