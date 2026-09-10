import markdownit from '/vendor/markdown-it/markdown-it.esm.min.mjs';

// html: false => le HTML de la source est échappé, jamais interprété
// breaks: true => un simple retour à la ligne devient un <br>, comme attendu dans un textarea
const md = markdownit({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true
});

const defaultLinkOpen = md.renderer.rules.link_open
  || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options, env, self));

// Un lien externe s'ouvre dans un nouvel onglet ; un lien interne (/cours, #ancre)
// reste dans l'onglet courant
md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const href = tokens[index].attrGet('href') || '';

  if (/^(?:https?:\/\/|\/\/|mailto:)/i.test(href)) {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
  }

  return defaultLinkOpen(tokens, index, options, env, self);
};

const defaultImage = md.renderer.rules.image;

// Une image distante n'est pas chargée directement : son adresse est mise de côté
// dans data-proxy-src, et hydrateMarkdownImages la récupère via notre backend.
// Sans cela, le navigateur de l'élève contacterait l'hébergeur de l'image et lui
// livrerait son adresse IP.
md.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const source = token.attrGet('src') || '';

  if (needsProxy(source)) {
    token.attrSet('data-proxy-src', source);
    token.attrs.splice(token.attrIndex('src'), 1);
  }

  return defaultImage(tokens, index, options, env, self);
};

/**
 * Indique si une image doit passer par le proxy.
 * Une image déjà servie par ce domaine ne révèle rien de plus, et une image
 * en data: n'implique aucune requête réseau.
 * @param {string} source - Valeur de l'attribut src
 * @returns {boolean}
 */
function needsProxy(source) {
  let url;

  try {
    url = new URL(source, window.location.href);
  } catch {
    return false;
  }

  if (url.origin === window.location.origin) return false;
  return url.protocol === 'http:' || url.protocol === 'https:';
}

/**
 * Convertit du Markdown en HTML.
 * Les images distantes sont rendues sans src : appeler hydrateMarkdownImages
 * sur le conteneur une fois le HTML inséré pour les charger.
 * @param {string} source - Texte Markdown
 * @returns {string} HTML échappé, prêt à être injecté
 */
export function renderMarkdown(source) {
  if (!source) return '';
  return md.render(String(source));
}

/**
 * Charge les images distantes d'un contenu déjà inséré dans le document.
 * Le jeton d'authentification voyage dans un en-tête, ce qu'une balise <img>
 * ne sait pas faire : l'image est donc téléchargée en fetch puis affichée
 * depuis un blob.
 * @param {ParentNode} container - Élément contenant le HTML rendu
 * @returns {Promise<void>} Résolue quand toutes les images ont abouti ou échoué
 */
export async function hydrateMarkdownImages(container) {
  const images = container.querySelectorAll('img[data-proxy-src]');
  await Promise.all(Array.from(images, loadProxiedImage));
}

async function loadProxiedImage(image) {
  const source = image.dataset.proxySrc;
  // Retiré tout de suite : une seconde hydratation du même conteneur ne relance rien
  delete image.dataset.proxySrc;

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`/api/proxy/image?url=${encodeURIComponent(source)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const objectUrl = URL.createObjectURL(await response.blob());

    // Révoqué dès que l'image est décodée : elle reste affichée, et le blob
    // n'encombre pas la mémoire pour toute la durée de la session
    const release = () => URL.revokeObjectURL(objectUrl);
    image.addEventListener('load', release, { once: true });
    image.addEventListener('error', release, { once: true });

    image.src = objectUrl;
  } catch (error) {
    console.error('Image indisponible:', source, error);
    // Sans src, le navigateur affiche le texte alternatif
    image.classList.add('markdown-image-error');
    image.title = 'Image indisponible';
  }
}
