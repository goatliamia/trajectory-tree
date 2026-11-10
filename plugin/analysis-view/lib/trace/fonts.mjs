import { readFileSync } from 'node:fs';

export const geistFontFiles = ['Geist-Variable.woff2', 'GeistMono-Variable.woff2'];
export const geistFontPath = '/analysis-view/trace/fonts/';

export function geistFontUrl(file) {
  return 'data:font/woff2;base64,' + readFileSync(new URL('./fonts/' + file, import.meta.url)).toString('base64');
}

export function geistLicenseNotice() {
  const license = readFileSync(new URL('./fonts/LICENSE.txt', import.meta.url), 'utf8');
  return '<!-- Bundled Geist font license\n' + license.replaceAll('-->', '--&gt;') + '\n-->\n';
}

export function inlineTraceFonts(html) {
  for (const file of geistFontFiles) html = html.replaceAll(geistFontPath + file, geistFontUrl(file));
  return html.replace('</head>', () => geistLicenseNotice() + '</head>');
}
