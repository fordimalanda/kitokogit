// Serveur statique de diagnostic : imite la résolution de chemins du protocole
// d'assets de Tauri (fichier exact, ou index.html pour un dossier) et journalise
// chaque requête. Sert à reproduire les erreurs de navigation de l'export Next.js.
//
// Usage : node preview-static.mjs [racine=out] [port=4321]

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(process.argv[2] ?? "out");
const PORT = Number(process.argv[3] ?? 4321);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

/** Résout une URL vers un fichier, comme le fait Tauri côté Rust. */
async function resolveFile(relative) {
  const clean = normalize(decodeURIComponent(relative)).replace(/^[/\\]+/, "");
  const target = join(ROOT, clean);

  // Garde-fou : on ne sort jamais de la racine.
  if (!target.startsWith(ROOT)) return null;

  try {
    const info = await stat(target);
    if (info.isDirectory()) return resolveFile(join(clean, "index.html"));
    return target;
  } catch {
    return null;
  }
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const label = `${request.method} ${url.pathname}`;
  const file = await resolveFile(url.pathname);

  if (!file) {
    console.log(`404  ${label}`);
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  console.log(`200  ${label}  ->  ${file.slice(ROOT.length).replace(/\\/g, "/")}`);
  const body = await readFile(file);
  response.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  response.end(body);
}).listen(PORT, () => {
  console.log(`preview sur http://localhost:${PORT}  (racine = ${ROOT})`);
});
