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

/**
 * Convertit du Markdown en HTML.
 * @param {string} source - Texte Markdown
 * @returns {string} HTML échappé, prêt à être injecté
 */
export function renderMarkdown(source) {
  if (!source) return '';
  return md.render(String(source));
}
