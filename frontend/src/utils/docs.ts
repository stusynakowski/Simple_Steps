/**
 * The usage docs the User Docs panel shows (spec 013, REQ-ENV-007): every
 * page of docs/usage_docs/, inlined into the bundle at build time.
 *
 * The docs are in two parts, and the panel shows them that way: `user/` — the
 * User guide, for people using the app, shown first — and `developer/`, for
 * people building apps. The top-level README is "Start here".
 */

/** The docs, by path. Vite inlines them; build_frontend hashes them (REQ-ENV-008). */
const RAW = import.meta.glob('../../../docs/usage_docs/**/*.md', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

/** The docs' SVG figures, inlined the same way, so an installed app can show them. */
const IMAGES = import.meta.glob('../../../docs/usage_docs/**/*.svg', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

/** An image a page refers to (`img/x.svg` on `developer/y.md`) as a data URL, or null. */
export function docImage(from: string, src: string, images: Record<string, string> = IMAGES): string | null {
  const target = resolveDocLink(from, src);
  const key = target && Object.keys(images).find((k) => docPath(k) === target);
  return key ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(images[key])}` : null;
}

/** Which part of the docs a page is in: the top level, the User or the Developer guide. */
export type DocSection = 'start' | 'user' | 'developer';
const SECTION_ORDER: DocSection[] = ['start', 'user', 'developer'];

export interface DocPage {
  /** The page's path inside docs/usage_docs, e.g. `user/01-concepts.md`. */
  file: string;
  section: DocSection;
  title: string;
  summary: string;
  content: string;
}

/** A glob key (`…/docs/usage_docs/user/01-a.md`) as a path inside the docs. */
function docPath(key: string): string {
  const at = key.indexOf('usage_docs/');
  return at >= 0 ? key.slice(at + 'usage_docs/'.length) : key.replace(/^(\.\.?\/)+/, '');
}

/**
 * Where a link on page `from` points, as a path inside the docs — or null if
 * it leaves them (e.g. `../../../src/…`, a file in the repository).
 */
export function resolveDocLink(from: string, href: string): string | null {
  const parts = from.split('/').slice(0, -1);
  for (const seg of href.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join('/');
}

/**
 * The pages in reading order: the top-level README, then the User guide, then
 * the Developer guide — each part's README first, then by file name (01-, 02-, …).
 */
export function docPages(raw: Record<string, string> = RAW): DocPage[] {
  const pages = Object.entries(raw).map(([path, content]) => {
    const file = docPath(path);
    const top = file.includes('/') ? file.split('/')[0] : '';
    const section: DocSection = top === 'user' || top === 'developer' ? top : 'start';
    const lines = content.split('\n');
    const heading = lines.find((l) => /^#\s/.test(l));
    const title = heading ? heading.replace(/^#\s+/, '').trim() : file.split('/').pop()!.replace(/\.md$/, '');
    // The first paragraph after the heading, as the list's one-line summary.
    const start = heading ? lines.indexOf(heading) + 1 : 0;
    const para: string[] = [];
    for (const line of lines.slice(start)) {
      if (!line.trim()) { if (para.length) break; continue; }
      if (/^(#|\||```|-\s|\d+\.\s)/.test(line)) { if (para.length) break; continue; }
      para.push(line.trim());
    }
    const summary = para.join(' ').replace(/[*`[\]]/g, '').replace(/\(([^)]*\.md[^)]*)\)/g, '');
    return { file, section, title, summary, content };
  });
  const isReadme = (p: DocPage) => p.file.split('/').pop() === 'README.md';
  return pages.sort((a, b) =>
    SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section)
    || Number(isReadme(b)) - Number(isReadme(a))
    || a.file.localeCompare(b.file));
}

export type Block = { kind: 'md'; text: string } | { kind: 'table'; header: string[]; rows: string[][] };

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isSeparator = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/** Markdown split into plain blocks and GitHub tables. Code fences are left alone. */
export function splitTables(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let md: string[] = [];
  let fenced = false;
  const flush = () => { if (md.length) blocks.push({ kind: 'md', text: md.join('\n') }); md = []; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (!fenced && line.trim().startsWith('|') && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      flush();
      const header = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      i -= 1;
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    md.push(line);
  }
  flush();
  return blocks;
}
