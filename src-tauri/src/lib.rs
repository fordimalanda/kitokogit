//! KitokoGit — backend desktop.
//!
//! Toute la logique Git, le scan de dépôts et le stockage des secrets vivent
//! ici : la webview Next.js n'est qu'une couche de présentation.
//!
//! Modules :
//! - [`git_manager`] : exécution des commandes Git natives et gestion d'erreurs ;
//! - [`scanner`] : détection des dépôts, monorepos et sous-projets ;
//! - [`secrets`] : clés API des providers IA, stockées par l'OS.

mod git_manager;
mod scanner;
mod secrets;

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
            git_manager::run_git_workflow,
            // Scan de projets
            scanner::scan_project,
            scanner::discover_repositories,
            // Clés API
            secrets::set_api_key,
            secrets::delete_api_key,
            secrets::list_api_key_status,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de KitokoGit");
}
