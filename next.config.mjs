/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tauri sert l'application depuis le dossier `out/` : export statique obligatoire,
  // il n'y a pas de serveur Node dans l'application desktop.
  output: "export",

  // Génère `settings/index.html` au lieu de `settings.html`, ce qui est plus fiable
  // pour la résolution de chemins par le protocole d'assets de Tauri.
  trailingSlash: true,

  // Pas d'optimiseur d'images côté serveur en export statique.
  images: { unoptimized: true },

  reactStrictMode: true,
};

export default nextConfig;
