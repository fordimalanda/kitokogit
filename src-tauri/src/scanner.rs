//! Détection des dépôts Git : projet unique, monorepo ou dossier non initialisé.
//!
//! Règle métier :
//! 1. Le dossier possède un `.git` → c'est un dépôt, chargé seul.
//! 2. Sinon → on inspecte les sous-dossiers de niveau 1 ; chacun contenant un
//!    `.git` devient une sous-carte du projet parent.
//! 3. Aucun `.git` → l'interface propose d'exécuter `git init`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::git_manager::{self, GitError, GitResult};

/// Dossiers jamais explorés : lourds, générés, ou sans rapport avec Git.
const SKIPPED_DIRS: [&str; 13] = [
    "node_modules",
    "target",
    "dist",
    "out",
    "build",
    ".next",
    "vendor",
    "__pycache__",
    ".venv",
    "venv",
    ".idea",
    ".vscode",
    ".cache",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectKind {
    Repository,
    Monorepo,
    NotInitialized,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubProject {
    pub name: String,
    pub path: String,
    pub has_git: bool,
    pub branch: Option<String>,
    pub remote: Option<String>,
    pub has_remote: bool,
    pub modified_files: u32,
    pub staged_files: u32,
    pub untracked_files: u32,
    pub ahead: u32,
    pub behind: u32,
    pub remote_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    pub kind: ProjectKind,
    pub sub_projects: Vec<SubProject>,
    /// Erreur non bloquante (dossier illisible, dépôt cassé…).
    pub error: Option<String>,
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/// Un dépôt peut avoir un `.git` dossier (cas normal) ou fichier (worktree,
/// sous-module) : `Path::exists` couvre les deux.
fn has_git(path: &Path) -> bool {
    path.join(".git").exists()
}

fn dir_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn is_skipped(name: &str) -> bool {
    name.starts_with('.') || SKIPPED_DIRS.contains(&name)
}

/// Construit la fiche d'un dépôt, en absorbant les erreurs Git dans
/// `remote_error` pour que le scan global n'échoue jamais.
fn describe_repo(path: &Path) -> SubProject {
    let name = dir_name(path);
    let path_string = path.to_string_lossy().into_owned();

    match git_manager::read_status(path) {
        Ok(status) => SubProject {
            name,
            path: path_string,
            has_git: true,
            branch: status.branch,
            remote: status.remote.clone(),
            has_remote: status.remote.is_some(),
            modified_files: status.unstaged.len() as u32,
            staged_files: status.staged.len() as u32,
            untracked_files: status.untracked.len() as u32,
            ahead: status.ahead,
            behind: status.behind,
            remote_error: status.remote_error,
        },
        Err(error) => SubProject {
            name,
            path: path_string,
            has_git: true,
            branch: None,
            remote: None,
            has_remote: false,
            modified_files: 0,
            staged_files: 0,
            untracked_files: 0,
            ahead: 0,
            behind: 0,
            remote_error: Some(error.message),
        },
    }
}

/// Sous-dossiers de niveau 1 contenant un dépôt, triés alphabétiquement.
fn sub_repositories(root: &Path) -> (Vec<SubProject>, Option<String>) {
    let mut found = Vec::new();

    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) => {
            return (
                found,
                Some(format!(
                    "Lecture du dossier impossible : {error}"
                )),
            )
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if is_skipped(name) {
            continue;
        }
        if has_git(&path) {
            found.push(describe_repo(&path));
        }
    }

    found.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    (found, None)
}

/* ------------------------------------------------------------------ */
/* Commandes Tauri                                                     */
/* ------------------------------------------------------------------ */

/// Scanne un dossier racine et renvoie sa structure Git.
#[tauri::command]
pub fn scan_project(path: String) -> GitResult<ProjectInfo> {
    let root = PathBuf::from(&path);

    if !root.is_dir() {
        return Err(GitError::new(
            "path_not_found",
            format!("Le dossier « {path} » est introuvable ou inaccessible."),
            None,
        ));
    }

    let name = dir_name(&root);
    let display_path = root.to_string_lossy().into_owned();

    // Cas 1 : le dossier racine est lui-même un dépôt.
    if has_git(&root) {
        return Ok(ProjectInfo {
            name,
            path: display_path,
            kind: ProjectKind::Repository,
            sub_projects: vec![describe_repo(&root)],
            error: None,
        });
    }

    // Cas 2 / 3 : on cherche des dépôts dans les sous-dossiers directs.
    let (subs, error) = sub_repositories(&root);
    let kind = if subs.is_empty() {
        ProjectKind::NotInitialized
    } else {
        ProjectKind::Monorepo
    };

    Ok(ProjectInfo {
        name,
        path: display_path,
        kind,
        sub_projects: subs,
        error,
    })
}

/// Recherche récursive (profondeur limitée) des dépôts à partir d'un dossier.
/// Utile pour retrouver plusieurs projets d'un coup dans un dossier de travail.
#[tauri::command]
pub fn discover_repositories(root: String, max_depth: usize) -> GitResult<Vec<String>> {
    let start = PathBuf::from(&root);
    if !start.is_dir() {
        return Err(GitError::new(
            "path_not_found",
            format!("Le dossier « {root} » est introuvable."),
            None,
        ));
    }

    // On borne la profondeur pour ne jamais bloquer l'interface sur un disque entier.
    let depth_limit = max_depth.clamp(1, 8);
    let mut found = Vec::new();
    walk(&start, 0, depth_limit, &mut found);
    found.sort();

    Ok(found
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
}

/// Parcours manuel : dès qu'un dépôt est trouvé, on ne descend pas plus bas.
fn walk(dir: &Path, depth: usize, max_depth: usize, out: &mut Vec<PathBuf>) {
    if has_git(dir) {
        out.push(dir.to_path_buf());
        return;
    }
    if depth >= max_depth {
        return;
    }

    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if is_skipped(name) {
            continue;
        }
        walk(&path, depth + 1, max_depth, out);
    }
}
