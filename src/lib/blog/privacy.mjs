// Shared by the Obsidian exporter and server. Errors contain locations, never the secret itself.
export class PublishError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}

export function stripPrivateContent(source) {
  let text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 4);
    if (end < 0 || !/^\n---(?:\n|$)/.test(text.slice(end))) throw new PublishError('Close the note properties block before publishing.');
    text = text.slice(end + 4).replace(/^\n/, '');
  }
  // An unfinished private comment must never expose its tail during live editing.
  return text.replace(/%%[\s\S]*?(?:%%|$)/g, '').replace(/<!--[\s\S]*?(?:-->|$)/g, '');
}

function decoded(text) {
  let value = text.normalize('NFKC').replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '');
  for (let i = 0; i < 4; i++) {
    const next = value.replace(/&#(x[\da-f]+|\d+);?/gi, (_, n) => {
      const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
      return code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }).replace(/&(colon|sol|bsol|Tab|NewLine);/g, (_, n) => ({colon: ':', sol: '/', bsol: '\\', Tab: '\t', NewLine: '\n'})[n])
      .replace(/\\u([\da-f]{4})|\\x([\da-f]{2})/gi, (_, u, x) => String.fromCharCode(parseInt(u || x, 16)))
      .replace(/\\\//g, '/').replace(/%[\da-f]{2}/gi, s => String.fromCharCode(parseInt(s.slice(1), 16)));
    if (next === value) break;
    value = next;
  }
  return value;
}

const rules = [
  ['local file path', /(?:file\s*:|obsidian\s*:|(?:^|[^\w])(?:~[/\\]|[a-z]:[/\\]|\\\\[^\s\\]+\\)|\/(?:Users|home|Volumes|private|tmp|var|etc|Applications|Library|mnt|media|opt|root|usr|dev|proc|sys|run|workspace|workspaces)\/)/i],
  ['private network address', /(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[::1\]|https?:\/\/[^/\s]+\.(?:local|internal)(?=[:/\s]|$))/i],
  ['credential', /(?:-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[\w-]{15,}|vercel_blob_rw_[\w-]{15,})\b|\beyJ[\w-]{12,}\.[\w-]{12,}\.[\w-]{12,}|[?&](?:token|access_token|api_key|apikey|password|secret|signature|sig|key)=|\b(?:api[_-]?key|secret|password|authorization)\s*[:=]\s*["']?[^\s"']{8,})/i],
];

export function assertPublicText(text, label = 'Note') {
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const value = decoded(lines[i]);
    for (const [kind, pattern] of rules) {
      if (pattern.test(value)) throw new PublishError(`${label}, line ${i + 1}: remove the ${kind} before publishing.`);
    }
  }
}

export function publicUrl(value, { image = false } = {}) {
  assertPublicText(value, 'Link');
  const url = decoded(value).trim();
  if (/^#[\w%\-\u0080-\uFFFF]+$/.test(url)) return true;
  if (/^\/blog(?:\/[a-z0-9-]+)?(?:#[^\s]*)?$/.test(url)) return true;
  if (/^\/api\/blog\/assets\/[a-f0-9]{64}$/.test(url)) return true;
  if (!image && /^\/(?:embeds\/(?:bpe|unigram)\.html|resume(?:\.pdf)?|things-ive-done|goodhartmaxxing|alt-education|)$/.test(url)) return true;
  if (/^https?:\/\//i.test(url)) {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || !parsed.hostname.includes('.') || parsed.hostname.startsWith('[')) return false;
    // URL parsing canonicalizes numeric and hex IPv4 spellings before checking.
    assertPublicText(parsed.href, 'Link');
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  }
  return !image && /^mailto:[^\s?]+@[^\s?]+\.[^\s?]+$/.test(url);
}

export function validateMetadata(input) {
  const { id, slug, title, date, description = '', baseVersion = null, previousSlug } = input;
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new PublishError('Invalid post identifier.');
  if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100 || ['assets', 'feed', 'index'].includes(slug)) throw new PublishError('Use a URL containing lowercase letters, numbers, and hyphens.');
  if (previousSlug !== undefined && (typeof previousSlug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(previousSlug) || previousSlug.length > 100)) throw new PublishError('Invalid previous URL. Reopen Edit details.');
  if (typeof title !== 'string' || !title.trim() || title.length > 180) throw new PublishError('Use a title between 1 and 180 characters.');
  if (typeof description !== 'string' || description.length > 500) throw new PublishError('Keep the description under 500 characters.');
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new PublishError('Use a valid publication date (YYYY-MM-DD).');
  if (baseVersion !== null && (typeof baseVersion !== 'string' || !/^[a-f0-9-]{36}$/.test(baseVersion))) throw new PublishError('Invalid saved revision.');
  assertPublicText(`${title}\n${description}\n${slug}`, 'Post properties');
  return { id, slug, title: title.trim(), date, description: description.trim(), baseVersion, ...(previousSlug === undefined ? {} : {previousSlug}) };
}
