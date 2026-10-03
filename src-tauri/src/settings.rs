//! Réglages non secrets de l'application.
//!
//! Stockés dans un simple JSON à côté des données de l'application
//! (`app_config_dir`). Les **clés API ne passent jamais par ce fichier** :
//! elles vivent dans le gestionnaire d'identifiants de l'OS (voir [`crate::secrets`]).

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const FILE_NAME: &str = "settings.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    /// Provider utilisé par défaut pour la génération IA.
    pub provider: String,
    /// Modèle retenu par provider (`provider` → identifiant de modèle).
    /// Absent ou vide ⇒ le modèle par défaut du provider est utilisé.
    pub models: HashMap<String, String>,
    /// Consignes ajoutées au prompt système (conventions du projet, langue…).
    pub custom_prompt: String,
    /// Adresse du serveur Ollama local.
    pub ollama_base_url: String,
    /// Basculer sur l'heuristique locale si l'appel IA échoue.
    pub fallback_to_local: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            provider: "openai".to_string(),
            models: HashMap::new(),
            custom_prompt: String::new(),
            ollama_base_url: "http://localhost:11434".to_string(),
            fallback_to_local: true,
        }
    }
}

/// Dossier de configuration de l'application, créé si nécessaire.
/// Partagé avec le module [`crate::history`].
pub fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Dossier de configuration introuvable : {error}"))?;

    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Création du dossier de configuration impossible : {error}"))?;

    Ok(directory)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(FILE_NAME))
}

/// Lit les réglages. Un fichier absent ou illisible renvoie les valeurs par
/// défaut plutôt qu'une erreur : l'application doit toujours démarrer.
#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let raw = std::fs::read_to_string(&path)
        .map_err(|error| format!("Lecture des réglages impossible : {error}"))?;

    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = settings_path(&app)?;
    let raw = serde_json::to_string_pretty(&settings)
        .map_err(|error| format!("Sérialisation des réglages impossible : {error}"))?;

    std::fs::write(&path, raw).map_err(|error| format!("Écriture des réglages impossible : {error}"))
}
