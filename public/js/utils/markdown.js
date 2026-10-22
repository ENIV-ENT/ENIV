import markdownit from '/vendor/markdown-it/markdown-it.esm.min.mjs';

/**
 * Markdown rendering for assignment descriptions and comments.
 *
 * `html: false` escapes any HTML in the source instead of interpreting it, and
 * `breaks: true` turns a single line break into a `<br>`, as expected from a
 * textarea.
 */
const md = markdownit({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true
});

const defaultLinkOpen = md.renderer.rules.link_open
  || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options, env, self));

md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const href = tokens[index].attrGet('href') || '';

  if (/^(?:https?:\/\/|\/\/|mailto:)/i.test(href)) {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
  }

  return defaultLinkOpen(tokens, index, options, env, self);
};

const defaultImage = md.renderer.rules.image;

/**
 * A remote image is not loaded directly: its address is set aside in
 * `data-proxy-src` and hydrateMarkdownImages fetches it through our backend.
 * Otherwise the student's browser would contact the image host and give it
 * their IP address.
 */
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
 * Tells whether an image must go through the proxy.
 * An image already served by this domain reveals nothing more, and a `data:`
 * image needs no network request.
 * @param {string} source - Value of the src attribute
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
 * Converts Markdown to HTML.
 * Remote images are rendered without src: call hydrateMarkdownImages on the
 * container once the HTML is inserted to load them.
 * @param {string} source - Markdown text
 * @returns {string} Escaped HTML, ready to be injected
 */
export function renderMarkdown(source) {
  if (!source) return '';
  return md.render(String(source));
}

/**
 * Loads the remote images of content already inserted in the document.
 * The authentication token travels in a header, which an `<img>` tag cannot
 * send: the image is downloaded with fetch, then displayed from a blob.
 * @param {ParentNode} container - Element holding the rendered HTML
 * @returns {Promise<void>} Resolved when every image has loaded or failed
 */
export async function hydrateMarkdownImages(container) {
  const images = container.querySelectorAll('img[data-proxy-src]');
  await Promise.all(Array.from(images, loadProxiedImage));
}

/**
 * Loads one proxied image. The source is removed from the dataset right away,
 * so a second hydration of the same container starts nothing. The blob URL is
 * revoked once the image is decoded: the image stays visible and the blob does
 * not use memory for the whole session. Without src, the browser shows the alt
 * text.
 */
async function loadProxiedImage(image) {
  const source = image.dataset.proxySrc;
  delete image.dataset.proxySrc;

  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`/api/proxy/image?url=${encodeURIComponent(source)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const objectUrl = URL.createObjectURL(await response.blob());

    const release = () => URL.revokeObjectURL(objectUrl);
    image.addEventListener('load', release, { once: true });
    image.addEventListener('error', release, { once: true });

    image.src = objectUrl;
  } catch (error) {
    console.error('Image unavailable:', source, error);
    image.classList.add('markdown-image-error');
    image.title = 'Image indisponible';
  }
}
