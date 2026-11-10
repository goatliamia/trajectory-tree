import { createHash } from 'node:crypto';

const base64Body = /[A-Za-z0-9+/_-]*(?:\\+\/[A-Za-z0-9+/_-]*)*={0,2}/.source;
const dataUrlHeader = /data:(image\\*\/[\w.+-]+)(?:;[\w.%+=-]+)*;base64,/.source;
const dataUrl = new RegExp(dataUrlHeader + '(' + base64Body + ')', 'gi');
const imageFields = '(?:result|data|b64_json|image_base64)';
const signature = /(?:iVBORw0KGgo|\\*\/9j\\*\/|R0lGOD[dl]h|UklGR[A-Za-z0-9+/]{6}XRUJQ)/.source;
const imageData = signature + base64Body;
const encodedField = new RegExp('("' + imageFields + '\\\\*"\\s*:\\s*\\\\*")(' + imageData + ')(?=\\\\*")', 'g');
const field = new RegExp('^' + imageFields + '$');
const bare = new RegExp('^' + imageData + '$');
const label = /\[inline image omitted (image\/[\w.+-]+) \d+B [a-f0-9]{64}\]/g;
const unescapeSlashes = value => value.replace(/\\+(?=\/)/g, '');

function imageLabel(mime, encoded) {
  const digest = createHash('sha256').update(encoded).digest('hex');
  return '[inline image omitted ' + mime + ' ' + encoded.length + 'B ' + digest + ']';
}

function imageType(encoded) {
  if (encoded.startsWith('iVBORw0KGgo')) return 'image/png';
  if (encoded.startsWith('/9j/')) return 'image/jpeg';
  if (encoded.startsWith('R0lGOD')) return 'image/gif';
  return 'image/webp';
}

// Also matches fields in stringified tool outputs. The surrounding JSON,
// image type and record identity survive without retaining the image bytes.
export function omitCodexImages(text) {
  return text.replace(dataUrl, (match, mime, body) => body
    ? imageLabel(unescapeSlashes(mime).toLowerCase(), unescapeSlashes(body)) : match)
    .replace(encodedField, (match, prefix, body) => {
      const encoded = unescapeSlashes(body);
      return encoded.length >= 32 ? prefix + imageLabel(imageType(encoded), encoded) : match;
    });
}

export function omitImageLabels(text) {
  return text.replace(label, '');
}

// Explicit in-memory snapshots go through the same elision as file and RPC
// inputs. Reuse unchanged objects, especially when the RPC reader ran first.
export function omitCodexImageValues(value, key = '') {
  if (typeof value === 'string') {
    if (field.test(key) && value.length >= 32 && bare.test(value)) {
      const encoded = unescapeSlashes(value);
      return imageLabel(imageType(encoded), encoded);
    }
    return omitCodexImages(value);
  }
  if (value === null || typeof value !== 'object') return value;
  let result = value;
  for (const name of Object.keys(value)) {
    const compact = omitCodexImageValues(value[name], name);
    if (compact === value[name]) continue;
    if (result === value) result = Array.isArray(value) ? value.slice() : { ...value };
    result[name] = compact;
  }
  return result;
}
