//! Connecteurs IA pour la génération des messages de commit.
//!
//! Règle de sécurité : **tout** passe par ici. Les clés sont lues depuis le
//! gestionnaire d'identifiants de l'OS ([`crate::secrets`]) et ne sont jamais
//! renvoyées à la webview ; c'est Rust qui parle aux providers HTTP.
//!
//! En cas d'échec (pas de réseau, clé absente, quota dépassé…), l'erreur est
//! renvoyée proprement au frontend, qui bascule alors sur l'heuristique locale.

use std::path::Path;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::git_manager::read_diff_bundle;
use crate::secrets;

const TIMEOUT_SECS: u64 = 90;
/// Au-delà, le diff est tronqué : un LLM n'a pas besoin de tout pour résumer.
const DIFF_MAX_BYTES: usize = 4096;
pub const OLLAMA_DEFAULT_BASE: &str = "http://localhost:11434";

/* ------------------------------------------------------------------ */
/* Erreurs                                                             */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiError {
    /// `no_api_key`, `network`, `unauthorized`, `rate_limited`, `model_not_found`…
    pub kind: String,
    pub message: String,
    pub details: Option<String>,
}

impl AiError {
    pub fn new(kind: &str, message: impl Into<String>, details: Option<String>) -> Self {
        Self {
            kind: kind.to_string(),
            message: message.into(),
            details: details.filter(|value| !value.trim().is_empty()),
        }
    }
}

pub type AiResult<T> = std::result::Result<T, AiError>;

/* ------------------------------------------------------------------ */
/* Catalogue des providers                                             */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderInfo {
    pub id: String,
    pub label: String,
    pub description: String,
    pub requires_key: bool,
    pub default_model: String,
    pub models: Vec<String>,
    pub docs: String,
}

struct ProviderDef {
    id: &'static str,
    label: &'static str,
    description: &'static str,
    requires_key: bool,
    default_model: &'static str,
    models: &'static [&'static str],
    docs: &'static str,
}

const PROVIDERS: &[ProviderDef] = &[
    ProviderDef {
        id: "openai",
        label: "OpenAI",
        description: "GPT-4o et GPT-4.1",
        requires_key: true,
        default_model: "gpt-4o-mini",
        models: &["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o4-mini"],
        docs: "https://platform.openai.com/api-keys",
    },
    ProviderDef {
        id: "claude",
        label: "Anthropic Claude",
        description: "Claude Sonnet / Haiku",
        requires_key: true,
        default_model: "claude-3-5-sonnet-20241022",
        models: &[
            "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022",
            "claude-3-7-sonnet-20250219",
            "claude-sonnet-4-20250514",
        ],
        docs: "https://console.anthropic.com/settings/keys",
    },
    ProviderDef {
        id: "gemini",
        label: "Google Gemini",
        description: "Gemini Flash / Pro",
        requires_key: true,
        default_model: "gemini-2.5-flash",
        models: &[
            "gemini-2.5-flash",
            "gemini-2.5-pro",
            "gemini-2.0-flash",
            "gemini-1.5-flash",
        ],
        docs: "https://aistudio.google.com/app/apikey",
    },
    ProviderDef {
        id: "deepseek",
        label: "DeepSeek",
        description: "deepseek-chat et deepseek-coder",
        requires_key: true,
        default_model: "deepseek-chat",
        models: &["deepseek-chat", "deepseek-coder", "deepseek-reasoner"],
        docs: "https://platform.deepseek.com/api_keys",
    },
    ProviderDef {
        id: "ollama",
        label: "Ollama (local)",
        description: "Modèles exécutés sur votre machine",
        requires_key: false,
        default_model: "llama3.1",
        models: &["llama3.1", "qwen2.5-coder", "deepseek-coder-v2", "codellama", "mistral"],
        docs: "https://ollama.com/download",
    },
];

fn find_provider(id: &str) -> Option<&'static ProviderDef> {
    PROVIDERS.iter().find(|provider| provider.id == id)
}

pub fn catalog() -> Vec<AiProviderInfo> {
    PROVIDERS
        .iter()
        .map(|provider| AiProviderInfo {
            id: provider.id.to_string(),
            label: provider.label.to_string(),
            description: provider.description.to_string(),
            requires_key: provider.requires_key,
            default_model: provider.default_model.to_string(),
            models: provider.models.iter().map(|model| (*model).to_string()).collect(),
            docs: provider.docs.to_string(),
        })
        .collect()
}

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT: &str = "\
Tu es un expert Git. À partir du diff fourni, rédige UN SEUL message de commit.

Règles strictes :
- Format Conventional Commits : type(scope): description
- Types autorisés : feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
- Première ligne : 72 caractères maximum, à l'impératif, en anglais, sans point final
- Le scope est optionnel : utilise-le seulement s'il est évident d'après les chemins
- Si les changements sont nombreux ou hétérogènes, ajoute un corps séparé par une ligne vide
- Ne renvoie AUCUNE balise Markdown, AUCUN guillemet englobant, AUCUNE phrase
  d'introduction ou de conclusion
- Réponds uniquement avec le message de commit, rien d'autre";

fn build_user_prompt(diff: &str, truncated: bool, extra: Option<&str>) -> String {
    let mut prompt = String::new();

    if let Some(extra) = extra {
        let extra = extra.trim();
        if !extra.is_empty() {
            prompt.push_str("Consignes supplémentaires du projet :\n");
            prompt.push_str(extra);
            prompt.push_str("\n\n");
        }
    }

    if truncated {
        prompt.push_str(
            "ATTENTION : le diff ci-dessous est tronqué. Base-toi uniquement sur ce qui est visible.\n\n",
        );
    }

    prompt.push_str("Diff à résumer :\n\n");
    prompt.push_str(diff);
    prompt
}

/* ------------------------------------------------------------------ */
/* Client HTTP                                                         */
/* ------------------------------------------------------------------ */

fn client() -> AiResult<&'static reqwest::Client> {
    static CLIENT: OnceLock<std::result::Result<reqwest::Client, String>> = OnceLock::new();

    match CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(TIMEOUT_SECS))
            .build()
            .map_err(|error| error.to_string())
    }) {
        Ok(value) => Ok(value),
        Err(message) => Err(AiError::new(
            "client_init",
            "Impossible d'initialiser le client HTTP.",
            Some(message.clone()),
        )),
    }
}

fn classify_transport(error: reqwest::Error, provider: &str) -> AiError {
    let details = Some(error.to_string());
    if error.is_timeout() {
        AiError::new(
            "network",
            format!("Le provider {provider} n'a pas répondu dans les {TIMEOUT_SECS} s."),
            details,
        )
    } else if error.is_connect() {
        AiError::new(
            "network",
            format!("Impossible de joindre {provider}. Vérifiez votre connexion Internet."),
            details,
        )
    } else {
        AiError::new(
            "network",
            format!("Erreur réseau pendant l'appel à {provider}."),
            details,
        )
    }
}

fn classify_status(status: u16, body: &str) -> AiError {
    let details = Some(body.to_string());
    match status {
        401 | 403 => AiError::new(
            "unauthorized",
            "Le provider a refusé la clé API (clé invalide, expirée ou révoquée).",
            details,
        ),
        402 => AiError::new(
            "quota_exceeded",
            "Crédit épuisé sur ce compte provider.",
            details,
        ),
        404 => AiError::new(
            "model_not_found",
            "Le modèle demandé n'existe pas ou n'est pas accessible avec cette clé.",
            details,
        ),
        429 => AiError::new(
            "rate_limited",
            "Quota de requêtes atteint. Réessayez dans quelques instants.",
            details,
        ),
        code if code >= 500 => AiError::new(
            "provider_error",
            format!("Le provider a renvoyé une erreur serveur ({code})."),
            details,
        ),
        code => AiError::new(
            "provider_error",
            format!("Le provider a refusé la requête (HTTP {code})."),
            details,
        ),
    }
}

/// Envoie la requête et renvoie le corps JSON, ou une erreur normalisée.
async fn send(
    request: reqwest::RequestBuilder,
    provider: &str,
) -> AiResult<Value> {
    let response = request
        .send()
        .await
        .map_err(|error| classify_transport(error, provider))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(classify_status(status.as_u16(), &body));
    }

    serde_json::from_str::<Value>(&body).map_err(|error| {
        AiError::new(
            "bad_response",
            format!("Réponse illisible de {provider}."),
            Some(format!("{error}\n{body}")),
        )
    })
}

/* ------------------------------------------------------------------ */
/* Appel par provider                                                  */
/* ------------------------------------------------------------------ */

/// Choisit la bonne API selon le provider et renvoie le texte généré.
async fn chat(
    provider: &str,
    model: &str,
    api_key: Option<&str>,
    system: &str,
    user: &str,
    ollama_base: &str,
) -> AiResult<String> {
    let http = client()?;

    match provider {
        // --- APIs compatibles OpenAI ---
        "openai" | "deepseek" => {
            let key = api_key.ok_or_else(|| missing_key(provider))?;
            let base = if provider == "openai" {
                "https://api.openai.com/v1"
            } else {
                "https://api.deepseek.com/v1"
            };

            let value = send(
                http.post(format!("{base}/chat/completions"))
                    .bearer_auth(key)
                    .json(&json!({
                        "model": model,
                        "messages": [
                            { "role": "system", "content": system },
                            { "role": "user", "content": user },
                        ],
                        "temperature": 0.2,
                        "stream": false,
                    })),
                provider,
            )
            .await?;

            extract(&value, &["choices", "0", "message", "content"])
        }

        // --- Anthropic ---
        "claude" => {
            let key = api_key.ok_or_else(|| missing_key(provider))?;

            let value = send(
                http.post("https://api.anthropic.com/v1/messages")
                    .header("x-api-key", key)
                    .header("anthropic-version", "2023-06-01")
                    .json(&json!({
                        "model": model,
                        "max_tokens": 700,
                        "temperature": 0.2,
                        "system": system,
                        "messages": [{ "role": "user", "content": user }],
                    })),
                provider,
            )
            .await?;

            extract(&value, &["content", "0", "text"])
        }

        // --- Google Gemini ---
        "gemini" => {
            let key = api_key.ok_or_else(|| missing_key(provider))?;

            let value = send(
                http.post(format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
                ))
                .header("x-goog-api-key", key)
                .json(&json!({
                    "systemInstruction": { "parts": [{ "text": system }] },
                    "contents": [{ "role": "user", "parts": [{ "text": user }] }],
                    "generationConfig": { "temperature": 0.2 },
                })),
                provider,
            )
            .await?;

            extract(&value, &["candidates", "0", "content", "parts", "0", "text"])
        }

        // --- Ollama (local, sans clé) ---
        "ollama" => {
            let base = ollama_base.trim_end_matches('/');

            let value = send(
                http.post(format!("{base}/api/chat")).json(&json!({
                    "model": model,
                    "messages": [
                        { "role": "system", "content": system },
                        { "role": "user", "content": user },
                    ],
                    "stream": false,
                    "options": { "temperature": 0.2 },
                })),
                "Ollama",
            )
            .await?;

            extract(&value, &["message", "content"])
        }

        other => Err(AiError::new(
            "unknown_provider",
            format!("Provider inconnu : {other}."),
            None,
        )),
    }
}

fn missing_key(provider: &str) -> AiError {
    AiError::new(
        "no_api_key",
        format!("Aucune clé API enregistrée pour « {provider} ». Ajoutez-la dans les Paramètres."),
        None,
    )
}

/// Lit une valeur imbriquée : `["choices", "0", "message", "content"]`.
fn extract(value: &Value, path: &[&str]) -> AiResult<String> {
    let mut current = value;

    for segment in path {
        current = match segment.parse::<usize>() {
            Ok(index) => current.get(index),
            Err(_) => current.get(*segment),
        }
        .ok_or_else(|| {
            AiError::new(
                "bad_response",
                "Réponse du provider inattendue.",
                Some(value.to_string()),
            )
        })?;
    }

    let text = current.as_str().ok_or_else(|| {
        AiError::new(
            "bad_response",
            "Le provider n'a renvoyé aucun texte exploitable.",
            Some(value.to_string()),
        )
    })?;

    if text.trim().is_empty() {
        return Err(AiError::new(
            "empty_response",
            "Le provider a renvoyé une réponse vide.",
            Some(value.to_string()),
        ));
    }

    Ok(text.to_string())
}

/* ------------------------------------------------------------------ */
/* Nettoyage de la réponse                                             */
/* ------------------------------------------------------------------ */

/// Retire les artefacts fréquents (blocs Markdown, guillemets, préambules).
fn normalize(raw: &str) -> String {
    let mut text = raw.trim().to_string();

    // Bloc de code Markdown ```…```
    if let Some(rest) = text.strip_prefix("```") {
        let body = rest.splitn(2, '\n').nth(1).unwrap_or(rest);
        text = body.trim_end().trim_end_matches("```").trim().to_string();
    }

    // Guillemets englobants
    for (open, close) in [('"', '"'), ('\'', '\''), ('«', '»'), ('“', '”')] {
        if text.starts_with(open) && text.ends_with(close) && text.chars().count() > 2 {
            text = text[open.len_utf8()..text.len() - close.len_utf8()].trim().to_string();
        }
    }

    // Préambules du type « Voici le message de commit : »
    let lowered = text.to_lowercase();
    for prefix in [
        "voici le message de commit",
        "voici un message de commit",
        "message de commit :",
        "commit message:",
        "here is the commit message",
    ] {
        if lowered.starts_with(prefix) {
            if let Some(index) = text.find('\n') {
                text = text[index + 1..].trim().to_string();
            }
            break;
        }
    }

    text.trim().trim_matches('`').trim().to_string()
}

/// Tronque le diff sur une frontière de ligne, en respectant l'UTF-8.
fn truncate(raw: &str) -> (String, bool, usize) {
    let bytes = raw.len();
    if bytes <= DIFF_MAX_BYTES {
        return (raw.to_string(), false, bytes);
    }

    let mut cut = DIFF_MAX_BYTES;
    while cut > 0 && !raw.is_char_boundary(cut) {
        cut -= 1;
    }

    let slice = &raw[..cut];
    let trimmed = match slice.rfind('\n') {
        Some(index) => &slice[..index],
        None => slice,
    };

    (
        format!("{trimmed}\n\n# … diff tronqué ({bytes} octets au total, {DIFF_MAX_BYTES} envoyés)"),
        true,
        bytes,
    )
}

/* ------------------------------------------------------------------ */
/* Structures de retour                                                */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedCommit {
    pub message: String,
    pub provider: String,
    pub model: String,
    pub diff_bytes: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTest {
    pub ok: bool,
    pub provider: String,
    pub model: String,
    pub latency_ms: u64,
    pub sample: String,
}

/* ------------------------------------------------------------------ */
/* Commandes Tauri                                                     */
/* ------------------------------------------------------------------ */

/// Catalogue des providers disponibles, tel que le connaît le backend.
#[tauri::command]
pub fn ai_providers() -> Vec<AiProviderInfo> {
    catalog()
}

/// Génère un message de commit à partir du diff réel du dépôt.
///
/// Le diff est relu côté Rust : le frontend n'envoie jamais le code source,
/// seulement le chemin du dépôt.
#[tauri::command]
pub async fn generate_commit_message(
    path: String,
    provider: String,
    model: Option<String>,
    custom_prompt: Option<String>,
    ollama_base_url: Option<String>,
) -> AiResult<GeneratedCommit> {
    let provider_id = provider.trim().to_lowercase();
    let definition = find_provider(&provider_id).ok_or_else(|| {
        AiError::new(
            "unknown_provider",
            format!("Provider inconnu : {provider_id}."),
            None,
        )
    })?;

    let model = model
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| definition.default_model.to_string());

    // --- Lecture du diff courant ---
    let bundle = read_diff_bundle(Path::new(&path))
        .map_err(|error| AiError::new(&error.kind, error.message, error.details))?;

    let raw_diff = [bundle.staged, bundle.unstaged]
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    if raw_diff.trim().is_empty() {
        return Err(AiError::new(
            "nothing_to_commit",
            "Aucune modification détectée dans ce dépôt.",
            None,
        ));
    }

    let (diff, truncated, diff_bytes) = truncate(&raw_diff);
    let user_prompt = build_user_prompt(&diff, truncated, custom_prompt.as_deref());

    // --- Clé API (jamais exposée au frontend) ---
    let api_key = if definition.requires_key {
        match secrets::load_api_key(&provider_id) {
            Ok(Some(key)) => Some(key),
            Ok(None) => return Err(missing_key(&provider_id)),
            Err(message) => return Err(AiError::new("keyring", message, None)),
        }
    } else {
        None
    };

    let ollama_base = ollama_base_url
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| OLLAMA_DEFAULT_BASE.to_string());

    let raw = chat(
        &provider_id,
        &model,
        api_key.as_deref(),
        SYSTEM_PROMPT,
        &user_prompt,
        &ollama_base,
    )
    .await?;

    let message = normalize(&raw);
    if message.is_empty() {
        return Err(AiError::new(
            "empty_response",
            "Le provider a renvoyé un message vide après nettoyage.",
            Some(raw),
        ));
    }

    Ok(GeneratedCommit {
        message,
        provider: provider_id,
        model,
        diff_bytes,
        truncated,
    })
}

/// Test de connexion : vérifie la clé et la validité du modèle.
#[tauri::command]
pub async fn test_provider_connection(
    provider: String,
    model: Option<String>,
    ollama_base_url: Option<String>,
) -> AiResult<ConnectionTest> {
    let provider_id = provider.trim().to_lowercase();
    let definition = find_provider(&provider_id).ok_or_else(|| {
        AiError::new(
            "unknown_provider",
            format!("Provider inconnu : {provider_id}."),
            None,
        )
    })?;

    let model = model
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| definition.default_model.to_string());

    let api_key = if definition.requires_key {
        match secrets::load_api_key(&provider_id) {
            Ok(Some(key)) => Some(key),
            Ok(None) => return Err(missing_key(&provider_id)),
            Err(message) => return Err(AiError::new("keyring", message, None)),
        }
    } else {
        None
    };

    let ollama_base = ollama_base_url
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| OLLAMA_DEFAULT_BASE.to_string());

    let started = Instant::now();
    let raw = chat(
        &provider_id,
        &model,
        api_key.as_deref(),
        "Tu réponds toujours exactement par le mot demandé.",
        "Réponds uniquement par : OK",
        &ollama_base,
    )
    .await?;
    let latency_ms = started.elapsed().as_millis() as u64;

    Ok(ConnectionTest {
        ok: true,
        provider: provider_id,
        model,
        latency_ms,
        sample: normalize(&raw).chars().take(120).collect(),
    })
}

/// Liste les modèles installés localement dans Ollama.
#[tauri::command]
pub async fn list_ollama_models(base_url: Option<String>) -> AiResult<Vec<String>> {
    let base = base_url
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| OLLAMA_DEFAULT_BASE.to_string());

    let http = client()?;
    let value = send(
        http.get(format!("{}/api/tags", base.trim_end_matches('/'))),
        "Ollama",
    )
    .await?;

    let models = value
        .get("models")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| entry.get("name").and_then(Value::as_str))
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(models)
}
