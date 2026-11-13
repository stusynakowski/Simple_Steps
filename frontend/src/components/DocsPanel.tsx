/**
 * DocsPanel — the sidebar's User Docs (spec 013, REQ-ENV-007).
 *
 * Every page of docs/usage_docs/, built into the bundle at build time, so the
 * installed app needs no docs on disk and the panel can never list a page
 * that no longer exists. The README comes first, as "Start here"; then the
 * User guide, which is what this panel is for, open and first; then the
 * Developer guide, folded away until asked for. Each page is titled by its
 * first heading. A link to another page opens it here.
 *
 * Tables are drawn here rather than by a Markdown plugin (react-markdown
 * alone doesn't do GitHub tables, and the docs use them for reference);
 * utils/docs.ts finds them.
 */

import React, { useMemo, useRef, useState } from 'react';
import Markdown, { type Components } from 'react-markdown';
import Icon from './Icon';
import { docImage, docPages, resolveDocLink, splitTables, type DocPage } from '../utils/docs';

export default function DocsPanel({ pages = docPages() }: { pages?: DocPage[] }) {
  const [active, setActive] = useState<DocPage | null>(null);
  const [developerOpen, setDeveloperOpen] = useState(false);
  const reader = useRef<HTMLDivElement>(null);
  const byFile = useMemo(() => new Map(pages.map((p) => [p.file, p])), [pages]);

  const open = (page: DocPage, anchor?: string) => {
    setActive(page);
    // After the page renders: jump to the anchor, or to the top.
    requestAnimationFrame(() => {
      const target = anchor ? reader.current?.querySelector(`#${CSS.escape(anchor)}`) : null;
      if (target) target.scrollIntoView();
      else reader.current?.scrollTo?.(0, 0);
    });
  };

  // Links between the docs open here; outside links open a tab; links into the
  // repository (../../src/…) aren't in the installed app, so they stay text.
  const components: Components = {
    a: ({ href = '', children }) => {
      if (/^https?:/.test(href)) return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
      const [file, anchor] = href.split('#');
      // Relative to the page it's on: `../developer/x.md` from `user/y.md`.
      const target = file && active ? resolveDocLink(active.file, file) : null;
      const page = target ? byFile.get(target) : undefined;
      if (page) {
        return (
          <a href={`#${anchor ?? ''}`} onClick={(e) => { e.preventDefault(); open(page, anchor); }}>{children}</a>
        );
      }
      if (!file && anchor) {
        return <a href={`#${anchor}`} onClick={(e) => { e.preventDefault(); open(active!, anchor); }}>{children}</a>;
      }
      return <span className="docs-repo-link" title={`${href} — in the Simple Steps repository`}>{children}</span>;
    },
    // Figures next to the docs (img/x.svg) are bundled; anything else shows its alt text.
    img: ({ src, alt }) => {
      const url = typeof src === 'string' && active ? docImage(active.file, src) : null;
      return url ? <img className="docs-figure" src={url} alt={alt ?? ''} /> : <em>{alt}</em>;
    },
    // Headings get ids so #anchors work: "## Verb, shape" → "verb-shape".
    h2: ({ children }) => <h2 id={slug(children)}>{children}</h2>,
    h3: ({ children }) => <h3 id={slug(children)}>{children}</h3>,
  };

  if (active) {
    return (
      <div className="project-explorer docs-panel">
        <div className="docs-reader-bar">
          <button type="button" className="docs-back" onClick={() => setActive(null)} title="Back to the docs list">
            <Icon name="arrow-left" size={14} /> All docs
          </button>
        </div>
        <div className="docs-reader" ref={reader} data-testid="docs-reader">
          {splitTables(active.content).map((block, i) => (block.kind === 'md'
            ? <Markdown key={i} components={components}>{block.text}</Markdown>
            : (
              <div key={i} className="docs-table-wrap">
                <table className="docs-table">
                  <thead><tr>{block.header.map((h, j) => <th key={j}><Markdown components={components}>{h}</Markdown></th>)}</tr></thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>{row.map((c, j) => <td key={j}><Markdown components={components}>{c}</Markdown></td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )))}
        </div>
      </div>
    );
  }

  const row = (page: DocPage) => (
    <button type="button" key={page.file} className="docs-link-row" onClick={() => open(page)} title={page.summary}>
      <Icon name="book" size={14} className="docs-link-icon" />
      <span className="docs-link-text">
        <span className="docs-link-title">{page.file === 'README.md' ? `Start here — ${page.title}` : page.title}</span>
        {page.summary && <span className="docs-link-summary">{page.summary}</span>}
      </span>
    </button>
  );
  const start = pages.filter((p) => p.section === 'start');
  const user = pages.filter((p) => p.section === 'user');
  const developer = pages.filter((p) => p.section === 'developer');

  return (
    <div className="project-explorer docs-panel">
      <div className="docs-list">
        {pages.length === 0 && <div className="docs-empty">No docs were bundled with this build.</div>}
        {start.map(row)}

        {user.length > 0 && (
          <section className="docs-section docs-section--user" aria-label="User guide">
            <h3 className="docs-section-title">User guide</h3>
            {user.map(row)}
          </section>
        )}

        {developer.length > 0 && (
          <section className="docs-section docs-section--developer" aria-label="Developer guide">
            <button
              type="button"
              className="docs-section-toggle"
              aria-expanded={developerOpen}
              onClick={() => setDeveloperOpen((o) => !o)}
            >
              <Icon name={developerOpen ? 'chevron-down' : 'chevron-right'} size={12} />
              Developer guide
              <span className="docs-section-count">{developer.length}</span>
            </button>
            {developerOpen && developer.map(row)}
          </section>
        )}
      </div>
    </div>
  );
}

/** A heading's text as an anchor id, the way GitHub writes them. */
function slug(children: React.ReactNode): string {
  const text = React.Children.toArray(children).map((c) => (typeof c === 'string' ? c : '')).join('');
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
}
