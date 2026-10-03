// Correction post-build pour l'export statique Next.js 16.
//
// BUG CONSTATÉ (Next.js 16.3.8, Windows) : pour les routes imbriquées, Next écrit
// les payloads RSC dans un DOSSIER
//
//     out/settings/__next.settings/__PAGE__.txt
//
// alors que le routeur client les réclame comme un FICHIER avec des points
//
//     /settings/__next.settings.__PAGE__.txt
//
// Sur un serveur HTTP classique, le 404 est rattrapé par une navigation complète.
// Dans la webview Tauri, la requête échoue différemment et le routeur client
// plante : l'utilisateur voit « This page couldn't load » avec Reload / Back.
//
// Ce script remet les fichiers au chemin attendu. Si Next corrige le bug (ou sur
// une plateforme non affectée), les fichiers sont déjà plats et le script ne fait
// rien.

import { readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.argv[2] ?? "out";
/** Dossier des assets statiques : on ne l'explore pas, il ne contient pas de payloads. */
const SKIP = new Set(["_next", "node_modules"]);

let fixed = 0;

/** `.../<nom>/__PAGE__.txt` → `.../<nom>.__PAGE__.txt` */
async function flatten(directory, parent, name) {
  const source = join(directory, "__PAGE__.txt");

  try {
    await stat(source);
  } catch {
    return; // Structure déjà correcte ou inattendue : on ne touche à rien.
  }

  const target = join(parent, `${name}.__PAGE__.txt`);
  await rename(source, target);

  // `rm` sans `recursive` échoue si le dossier n'est pas vide : garde-fou.
  try {
    await rm(directory);
  } catch {
    // Le dossier contenait autre chose : on le laisse en place.
  }

  fixed += 1;
  console.log(`  ${name}/__PAGE__.txt  →  ${name}.__PAGE__.txt`);
}

async function walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP.has(entry.name)) continue;

    const path = join(directory, entry.name);
    if (entry.name.startsWith("__next.")) {
      await flatten(path, directory, entry.name);
      continue;
    }

    await walk(path);
  }
}

await walk(ROOT);
console.log(
  fixed === 0
    ? "fix-next-export : rien à corriger (structure déjà conforme)."
    : `fix-next-export : ${fixed} payload(s) RSC repositionné(s).`
);
