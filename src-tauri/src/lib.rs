//! KitokoGit — backend desktop.
//!
//! Toute la logique Git, le scan de dépôts et le stockage des secrets vivent
//! ici : la webview Next.js n'est qu'une couche de présentation.
//!
//! Modules :
//! - [`ai`] : connecteurs HTTP vers les providers IA (clés jamais exposées) ;
//! - [`git_manager`] : exécution des commandes Git natives et gestion d'erreurs ;
//! - [`history`] : journal local des commits générés ;
//! - [`scanner`] : détection des dépôts, monorepos et sous-projets ;
//! - [`secrets`] : clés API des providers, stockées par l'OS ;
//! - [`settings`] : réglages non secrets (provider et modèle par défaut).

mod ai;
mod git_manager;
mod history;
mod scanner;
mod secrets;
mod settings;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            // Diagnostic
            git_manager::git_version,
            // Lecture Git
            git_manager::git_status,
            git_manager::get_git_diff,
            git_manager::get_diff_bundle,
            // Écriture Git
            git_manager::git_init,
            git_manager::git_add_all,
            git_manager::git_commit,
            git_manager::git_push,
            git_manager::git_pull,
            git_manager::run_git_workflow,
            // Scan de projets
            scanner::scan_project,
            scanner::discover_repositories,
            scanner::refresh_projects,
            // Clés API
            secrets::set_api_key,
            secrets::delete_api_key,
            secrets::list_api_key_status,
            // Réglages non secrets
            settings::get_settings,
            settings::save_settings,
            // Intelligence artificielle
            ai::ai_providers,
            ai::generate_commit_message,
            ai::test_provider_connection,
            ai::list_ollama_models,
            // Journal des commits
            history::history_list,
            history::history_add,
            history::history_clear,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de KitokoGit");
}
