//! Exécution des commandes Git natives.
//!
//! Principe directeur : aucune commande ne doit pouvoir faire planter
//! l'application. Toutes les erreurs (pas de réseau, remote renommé, push
//! refusé, dossier déplacé…) sont converties en [`GitError`] structurée, que le
//! frontend affiche sous forme de badge/toast avec le journal complet.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

/* ------------------------------------------------------------------ */
/* Erreurs                                                             */
/* ------------------------------------------------------------------ */

/// Erreur Git normalisée et sérialisable.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitError {
    /// `not_a_repository`, `network`, `push_rejected`, `remote_missing`, …
    pub kind: String,
    /// Message court, affichable à l'utilisateur.
    pub message: String,
    /// Sortie `stderr` complète, à afficher dans le journal d'erreurs.
    pub details: Option<String>,
}

impl GitError {
    pub fn new(kind: &str, message: impl Into<String>, details: Option<String>) -> Self {
        Self {
            kind: kind.to_string(),
            message: message.into(),
            details: details.filter(|value| !value.trim().is_empty()),
        }
    }

    fn plain(kind: &str, message: impl Into<String>) -> Self {
        Self::new(kind, message, None)
    }
}

pub type GitResult<T> = std::result::Result<T, GitError>;

/// Traduit une sortie Git en erreur compréhensible par l'utilisateur.
fn classify(stderr: &str, stdout: &str) -> GitError {
    let raw = format!("{stderr}\n{stdout}");
    let haystack = raw.to_lowercase();
    let details = Some(raw.trim().to_string());

    if haystack.contains("not a git repository") {
        GitError::new(
            "not_a_repository",
            "Ce dossier n'est pas un dépôt Git.",
            details,
        )
    } else if haystack.contains("conflict")
        || haystack.contains("automatic merge failed")
        || haystack.contains("could not apply")
        || haystack.contains("needs merge")
    {
        GitError::new(
            "merge_conflict",
            "Conflit lors de la fusion. Résolvez les fichiers en conflit, puis committez.",
            details,
        )
    } else if haystack.contains("could not resolve host")
        || haystack.contains("unable to access")
        || haystack.contains("operation timed out")
        || haystack.contains("network is unreachable")
        || haystack.contains("connection refused")
        || haystack.contains("failed to connect")
    {
        GitError::new(
            "network",
            "Impossible de joindre le dépôt distant. Vérifiez votre connexion Internet.",
            details,
        )
    } else if haystack.contains("authentication failed")
        || haystack.contains("permission denied")
        || haystack.contains("could not read username")
        || haystack.contains("invalid username or password")
        || haystack.contains("support for password authentication was removed")
    {
        GitError::new(
            "auth_failed",
            "Le dépôt distant a refusé l'authentification. Vérifiez vos identifiants Git.",
            details,
        )
    } else if haystack.contains("repository not found")
        || haystack.contains("does not appear to be a git repository")
        || haystack.contains("no such remote")
    {
        GitError::new(
            "remote_not_found",
            "Le dépôt distant est introuvable : il a peut-être été renommé ou supprimé.",
            details,
        )
    } else if haystack.contains("non-fast-forward")
        || haystack.contains("rejected")
        || haystack.contains("fetch first")
        || haystack.contains("behind its remote")
        || haystack.contains("updates were rejected")
    {
        GitError::new(
            "push_rejected",
            "Le push a été refusé : le dépôt distant contient des commits que vous n'avez pas encore. Récupérez-les (pull) puis réessayez.",
            details,
        )
    } else if haystack.contains("nothing to commit") || haystack.contains("no changes added to commit")
    {
        GitError::new(
            "nothing_to_commit",
            "Aucune modification à committer.",
            details,
        )
    } else if haystack.contains("please tell me who you are")
        || haystack.contains("unable to auto-detect email address")
    {
        GitError::new(
            "identity_missing",
            "Git ne connaît pas votre identité. Renseignez « user.name » et « user.email ».",
            details,
        )
    } else {
        GitError::new("git_error", "La commande Git a échoué.", details)
    }
}

/* ------------------------------------------------------------------ */
/* Exécution                                                           */
/* ------------------------------------------------------------------ */

struct GitOutput {
    success: bool,
    stdout: String,
    stderr: String,
}

/// Prépare une commande `git` sans faire clignoter de console sous Windows.
fn git_command() -> Command {
    let mut command = Command::new("git");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn run_git(cwd: &Path, args: &[&str]) -> GitResult<GitOutput> {
    let output = git_command()
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => GitError::new(
                "git_not_installed",
                "Git est introuvable. Installez Git puis redémarrez KitokoGit.",
                Some(error.to_string()),
            ),
            _ => GitError::new(
                "io_error",
                "Impossible d'exécuter la commande Git.",
                Some(error.to_string()),
            ),
        })?;

    Ok(GitOutput {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

/// Exécute Git et transforme un échec en [`GitError`] via [`classify`].
/// `public_dir` est le dossier à citer dans le message d'erreur.
fn run_git_checked(cwd: &Path, args: &[&str], public_dir: &Path) -> GitResult<GitOutput> {
    ensure_dir(public_dir)?;
    let output = run_git(cwd, args)?;
    if output.success {
        Ok(output)
    } else {
        let mut error = classify(&output.stderr, &output.stdout);
        if error.kind == "git_error" {
            error.message = format!(
                "« git {} » a échoué dans {}.",
                args.first().copied().unwrap_or(""),
                public_dir.display()
            );
        }
        Err(error)
    }
}

fn ensure_dir(path: &Path) -> GitResult<()> {
    if path.is_dir() {
        Ok(())
    } else {
        Err(GitError::plain(
            "path_not_found",
            format!("Le dossier « {} » est introuvable.", path.display()),
        ))
    }
}

/// Répertoire de travail du processus : utilisé pour les commandes qui n'ont
/// pas besoin d'être rattachées à un dépôt (ex. `git --version`).
fn current_dir_or_dot() -> PathBuf {
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

/* ------------------------------------------------------------------ */
/* Structures partagées                                                */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// Statut sur deux caractères (`M.`, `.M`, `A.`, `R.`, …).
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub path: String,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub staged: Vec<FileChange>,
    pub unstaged: Vec<FileChange>,
    pub untracked: Vec<String>,
    pub has_commits: bool,
    pub remote: Option<String>,
    pub remote_error: Option<String>,
}

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

/// Version de Git installée — sert aussi de test de vie de la chaîne IPC.
pub fn version() -> GitResult<String> {
    let output = run_git(&current_dir_or_dot(), &["--version"])?;
    if !output.success {
        return Err(classify(&output.stderr, &output.stdout));
    }
    Ok(output.stdout.trim().to_string())
}

/// `git remote -v` : renvoie l'URL du remote `origin` en priorité, sinon le premier trouvé.
fn read_remote(path: &Path) -> (Option<String>, Option<String>) {
    let Ok(output) = run_git(path, &["remote", "-v"]) else {
        return (None, Some("Impossible de lire la liste des remotes.".into()));
    };
    if !output.success {
        return (None, Some("Impossible de lire la liste des remotes.".into()));
    }

    let mut origin: Option<String> = None;
    let mut first: Option<String> = None;

    for line in output.stdout.lines() {
        let mut parts = line.split_whitespace();
        let name = parts.next().unwrap_or_default();
        let url = parts.next().unwrap_or_default();
        if url.is_empty() {
            continue;
        }
        if name == "origin" && origin.is_none() {
            origin = Some(url.to_string());
        }
        if first.is_none() {
            first = Some(url.to_string());
        }
    }

    let resolved = origin.or(first);
    if resolved.is_none() {
        return (None, Some("Aucun dépôt distant configuré.".into()));
    }
    (resolved, None)
}

/// Lit l'état complet du dépôt sans jamais échouer sur un remote manquant.
pub fn read_status(path: &Path) -> GitResult<GitStatus> {
    ensure_dir(path)?;

    let output = run_git(
        path,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "--untracked-files=all",
        ],
    )?;

    if !output.success {
        return Err(classify(&output.stderr, &output.stdout));
    }

    let mut branch: Option<String> = None;
    let mut upstream: Option<String> = None;
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut has_commits = false;
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();

    for line in output.stdout.lines() {
        if let Some(rest) = line.strip_prefix("# branch.oid ") {
            has_commits = !rest.trim_start().starts_with("(initial)");
        } else if let Some(rest) = line.strip_prefix("# branch.head ") {
            let value = rest.trim();
            if value != "(detached)" {
                branch = Some(value.to_string());
            }
        } else if let Some(rest) = line.strip_prefix("# branch.upstream ") {
            upstream = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("# branch.ab ") {
            for token in rest.split_whitespace() {
                if let Some(value) = token.strip_prefix('+') {
                    ahead = value.parse().unwrap_or(0);
                } else if let Some(value) = token.strip_prefix('-') {
                    behind = value.parse().unwrap_or(0);
                }
            }
        } else if let Some(rest) = line.strip_prefix("1 ") {
            record_change(rest, 1, &mut staged, &mut unstaged);
        } else if let Some(rest) = line.strip_prefix("2 ") {
            record_change(rest, 2, &mut staged, &mut unstaged);
        } else if let Some(rest) = line.strip_prefix("u ") {
            // Conflit de fusion : on le présente comme une modification non indexée.
            if let Some(path) = rest.splitn(9, ' ').nth(8) {
                unstaged.push(FileChange {
                    path: path.to_string(),
                    status: "UU".to_string(),
                });
            }
        } else if let Some(rest) = line.strip_prefix("? ") {
            untracked.push(rest.to_string());
        }
    }

    let (remote, remote_error) = read_remote(path);

    Ok(GitStatus {
        path: path.to_string_lossy().into_owned(),
        branch,
        upstream,
        ahead,
        behind,
        staged,
        unstaged,
        untracked,
        has_commits,
        remote,
        remote_error,
    })
}

/// Analyse une ligne `1 …` ou `2 …` de `--porcelain=v2` et la range dans le bon bac.
fn record_change(
    rest: &str,
    kind: u8,
    staged: &mut Vec<FileChange>,
    unstaged: &mut Vec<FileChange>,
) {
    let field_count = if kind == 2 { 10 } else { 9 };
    let fields: Vec<&str> = rest.splitn(field_count, ' ').collect();
    let Some(xy) = fields.first() else { return };
    let Some(raw_path) = fields.last() else { return };
    if fields.len() != field_count {
        return;
    }

    let path = raw_path.split('\t').next().unwrap_or(raw_path).to_string();
    let mut chars = xy.chars();
    let index_status = chars.next().unwrap_or('.');
    let worktree_status = chars.next().unwrap_or('.');

    if index_status != '.' {
        staged.push(FileChange {
            path: path.clone(),
            status: format!("{index_status}."),
        });
    }
    if worktree_status != '.' {
        unstaged.push(FileChange {
            path,
            status: format!(".{worktree_status}"),
        });
    }
}

/// Diff unifié. `staged = true` cible l'index (`git diff --cached`).
///
/// Les fichiers non suivis n'apparaissent pas dans `git diff` : on les ajoute
/// sous forme de résumé, sans jamais modifier l'index de l'utilisateur.
pub fn read_diff(path: &Path, staged: bool) -> GitResult<String> {
    ensure_dir(path)?;

    let mut args: Vec<&str> = vec!["--no-pager", "diff", "--no-color"];
    if staged {
        args.push("--cached");
    }

    let output = run_git(path, &args)?;
    let mut diff = output.stdout;
    if !output.success && diff.trim().is_empty() {
        return Err(classify(&output.stderr, &diff));
    }

    if !staged {
        if let Ok(status) = read_status(path) {
            if !status.untracked.is_empty() {
                diff.push_str("\n# Nouveaux fichiers non suivis (contenu non inclus) :\n");
                for file in &status.untracked {
                    diff.push_str("#   + ");
                    diff.push_str(file);
                    diff.push('\n');
                }
            }
        }
    }

    Ok(diff)
}

/* ------------------------------------------------------------------ */
/* Commandes Tauri                                                     */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub fn git_version() -> GitResult<String> {
    version()
}

#[tauri::command]
pub fn git_status(path: String) -> GitResult<GitStatus> {
    read_status(Path::new(&path))
}

#[tauri::command]
pub fn get_git_diff(path: String, staged: bool) -> GitResult<String> {
    read_diff(Path::new(&path), staged)
}

#[tauri::command]
pub fn git_init(path: String) -> GitResult<Vec<String>> {
    let dir = Path::new(&path);
    let output = run_git_checked(dir, &["init"], dir)?;
    let mut steps = vec!["git init".to_string()];
    steps.push(output.stdout.trim().to_string());
    Ok(steps)
}

#[tauri::command]
pub fn git_add_all(path: String) -> GitResult<Vec<String>> {
    let dir = Path::new(&path);
    run_git_checked(dir, &["add", "-A"], dir)?;
    Ok(vec!["git add -A".to_string()])
}

#[tauri::command]
pub fn git_commit(path: String, message: String) -> GitResult<Vec<String>> {
    let dir = Path::new(&path);
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err(GitError::plain(
            "empty_message",
            "Le message de commit est vide.",
        ));
    }

    let output = run_git_checked(dir, &["commit", "-m", trimmed], dir)?;

    let mut steps = vec![format!("git commit -m \"{}\"", first_line(trimmed))];
    for line in output.stdout.lines() {
        let line = line.trim();
        if !line.is_empty() {
            steps.push(line.to_string());
        }
    }

    if let Ok(head) = run_git(dir, &["rev-parse", "--short", "HEAD"]) {
        if head.success {
            steps.push(format!("commit {}", head.stdout.trim()));
        }
    }

    Ok(steps)
}

#[tauri::command]
pub fn git_push(path: String) -> GitResult<Vec<String>> {
    let dir = Path::new(&path);
    ensure_dir(dir)?;

    let status = read_status(dir)?;
    if status.remote.is_none() {
        return Err(GitError::new(
            "remote_missing",
            "Aucun dépôt distant n'est configuré : ajoutez un remote « origin » avant de pousser.",
            status.remote_error,
        ));
    }

    let branch = status
        .branch
        .clone()
        .ok_or_else(|| GitError::plain("detached_head", "Vous êtes en HEAD détachée : aucun push possible."))?;

    // Sans branche amont, on la crée explicitement pour éviter un échec silencieux.
    let output = if status.upstream.is_some() {
        run_git_checked(dir, &["push"], dir)?
    } else {
        run_git_checked(dir, &["push", "-u", "origin", &branch], dir)?
    };

    let mut steps = vec![if status.upstream.is_some() {
        "git push".to_string()
    } else {
        format!("git push -u origin {branch}")
    }];
    for line in format!("{}\n{}", output.stderr, output.stdout).lines() {
        let line = line.trim();
        if !line.is_empty() {
            steps.push(line.to_string());
        }
    }

    Ok(steps)
}

/* ------------------------------------------------------------------ */
/* Synchronisation : git pull                                          */
/* ------------------------------------------------------------------ */

/// Récupère et intègre les commits distants (`git pull`).
///
/// `rebase = true` rejoue les commits locaux au lieu de créer un commit de
/// fusion ; la fusion est utilisée par défaut car elle est plus prévisible.
#[tauri::command]
pub fn git_pull(path: String, rebase: Option<bool>) -> GitResult<Vec<String>> {
    let dir = Path::new(&path);
    ensure_dir(dir)?;

    let before = read_status(dir)?;

    if before.remote.is_none() {
        return Err(GitError::new(
            "remote_missing",
            "Aucun dépôt distant n'est configuré : rien à récupérer.",
            before.remote_error,
        ));
    }

    if before.branch.is_none() {
        return Err(GitError::plain(
            "detached_head",
            "Vous êtes en HEAD détachée : le pull est impossible.",
        ));
    }

    // Un pull sur un répertoire sale peut produire des conflits difficiles à
    // démêler : on préfère demander à l'utilisateur de committer d'abord.
    if !before.staged.is_empty() || !before.unstaged.is_empty() {
        return Err(GitError::new(
            "dirty_worktree",
            "Des modifications locales ne sont pas committées. Committez-les avant de synchroniser.",
            None,
        ));
    }

    let use_rebase = rebase.unwrap_or(false);
    let args: Vec<&str> = if use_rebase {
        vec!["pull", "--rebase", "--no-edit"]
    } else {
        vec!["pull", "--no-edit"]
    };

    let output = run_git_checked(dir, &args, dir)?;

    let mut steps = vec![if use_rebase {
        "git pull --rebase".to_string()
    } else {
        "git pull".to_string()
    }];

    for line in format!("{}\n{}", output.stdout, output.stderr).lines() {
        let line = line.trim();
        if !line.is_empty() {
            steps.push(line.to_string());
        }
    }

    // Certains conflits ne produisent pas d'échec explicite : on relit l'état
    // réel du dépôt pour ne pas annoncer un succès trompeur.
    let after = read_status(dir)?;
    if after.unstaged.iter().any(|change| change.status == "UU") {
        return Err(GitError::new(
            "merge_conflict",
            "Conflit de fusion détecté. Résolvez les fichiers en conflit, indexez-les puis committez.",
            Some(steps.join("\n")),
        ));
    }

    Ok(steps)
}

/* ------------------------------------------------------------------ */
/* Diff complet du répertoire de travail                               */
/* ------------------------------------------------------------------ */

/// Tout ce qui peut partir dans un commit, en un seul aller-retour.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffBundle {
    /// Modifications déjà indexées (`git diff --cached`).
    pub staged: String,
    /// Modifications non indexées (`git diff`), résumé des non-suivis inclus.
    pub unstaged: String,
    /// Fichiers non suivis (leur contenu n'est pas inclus).
    pub untracked: Vec<String>,
}

pub fn read_diff_bundle(path: &Path) -> GitResult<DiffBundle> {
    ensure_dir(path)?;
    let status = read_status(path)?;

    Ok(DiffBundle {
        staged: read_diff(path, true)?,
        unstaged: read_diff(path, false)?,
        untracked: status.untracked,
    })
}

#[tauri::command]
pub fn get_diff_bundle(path: String) -> GitResult<DiffBundle> {
    read_diff_bundle(Path::new(&path))
}

/* ------------------------------------------------------------------ */
/* Workflow paramétrable : add → commit → push                         */
/* ------------------------------------------------------------------ */

/// Résultat d'une chaîne d'opérations, avec le journal des étapes exécutées.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOperationResult {
    pub success: bool,
    pub steps: Vec<String>,
    pub commit_hash: Option<String>,
    pub error: Option<GitError>,
}

impl GitOperationResult {
    fn failure(steps: Vec<String>, error: GitError) -> Self {
        Self {
            success: false,
            steps,
            commit_hash: None,
            error: Some(error),
        }
    }
}

/// Exécute `git add` → `git commit` → `git push` selon les options reçues.
///
/// Un échec d'étape **ne remonte pas en `Err`** : il est décrit dans
/// `result.error` et la chaîne s'arrête, ce qui permet à l'interface
/// d'afficher le journal des étapes déjà réussies.
#[tauri::command]
pub fn run_git_workflow(
    path: String,
    do_add: bool,
    message: Option<String>,
    do_push: bool,
) -> GitResult<GitOperationResult> {
    let dir = Path::new(&path);
    ensure_dir(dir)?;

    let mut steps: Vec<String> = Vec::new();

    // --- 1. git add -A ---
    if do_add {
        steps.push("git add -A".to_string());
        match run_git(dir, &["add", "-A"]) {
            Ok(output) if output.success => {}
            Ok(output) => {
                return Ok(GitOperationResult::failure(
                    steps,
                    classify(&output.stderr, &output.stdout),
                ))
            }
            Err(error) => return Ok(GitOperationResult::failure(steps, error)),
        }
    }

    // --- 2. git commit -m <message> ---
    if let Some(raw_message) = message.as_deref() {
        let commit_message = raw_message.trim();
        if !commit_message.is_empty() {
            let status = read_status(dir)?;
            if status.staged.is_empty() {
                return Ok(GitOperationResult::failure(
                    steps,
                    GitError::new(
                        "nothing_to_commit",
                        "Rien n'est indexé : activez « Auto-Add » ou indexez des fichiers avant de committer.",
                        None,
                    ),
                ));
            }

            steps.push(format!("git commit -m \"{}\"", first_line(commit_message)));
            match run_git(dir, &["commit", "-m", commit_message]) {
                Ok(output) if output.success => {}
                Ok(output) => {
                    return Ok(GitOperationResult::failure(
                        steps,
                        classify(&output.stderr, &output.stdout),
                    ))
                }
                Err(error) => return Ok(GitOperationResult::failure(steps, error)),
            }
        }
    }

    let mut commit_hash = None;
    if let Ok(head) = run_git(dir, &["rev-parse", "--short", "HEAD"]) {
        if head.success {
            let value = head.stdout.trim().to_string();
            if !value.is_empty() {
                commit_hash = Some(value);
            }
        }
    }

    // --- 3. git push ---
    if do_push {
        let status = read_status(dir)?;

        let Some(branch) = status.branch.clone() else {
            return Ok(GitOperationResult::failure(
                steps,
                GitError::plain(
                    "detached_head",
                    "Vous êtes en HEAD détachée : aucun push possible.",
                ),
            ));
        };

        if status.remote.is_none() {
            return Ok(GitOperationResult::failure(
                steps,
                GitError::new(
                    "remote_missing",
                    "Aucun dépôt distant n'est configuré : impossible de pousser.",
                    status.remote_error,
                ),
            ));
        }

        let has_upstream = status.upstream.is_some();
        let args: Vec<&str> = if has_upstream {
            vec!["push"]
        } else {
            vec!["push", "-u", "origin", branch.as_str()]
        };
        steps.push(if has_upstream {
            "git push".to_string()
        } else {
            format!("git push -u origin {branch}")
        });

        match run_git(dir, &args) {
            Ok(output) if output.success => {
                for line in format!("{}\n{}", output.stderr, output.stdout).lines() {
                    let line = line.trim();
                    if !line.is_empty() {
                        steps.push(line.to_string());
                    }
                }
            }
            Ok(output) => {
                return Ok(GitOperationResult::failure(
                    steps,
                    classify(&output.stderr, &output.stdout),
                ))
            }
            Err(error) => return Ok(GitOperationResult::failure(steps, error)),
        }
    }

    Ok(GitOperationResult {
        success: true,
        steps,
        commit_hash,
        error: None,
    })
}

fn first_line(value: &str) -> String {
    value.lines().next().unwrap_or_default().to_string()
}
