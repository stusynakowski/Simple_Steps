/**
 * Fold — opens and closes its content vertically, a quick slide that answers
 * the click without reading as loading (owner, 2026-11-15). Used by the formula panel (f(x)), the data
 * table (its header's toggle) and the step toolbar's settings row.
 *
 * The height animates through a grid row (0fr ↔ 1fr), so the content needs
 * no measured height. While it moves, the content is clipped; once open it
 * isn't, so pop-ups and sticky headers inside behave as usual.
 *
 * `keepMounted` keeps the content in the page while folded (hidden and out
 * of the tab order): for content whose state or measurements must survive.
 */
import { useEffect, useState, type ReactNode } from 'react';
import './Fold.css';

/** As `.fold`'s transition in Fold.css. */
const MS = 120;

export default function Fold({ open, keepMounted = false, className = '', children }: {
  open: boolean;
  keepMounted?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open || keepMounted);
  const [expanded, setExpanded] = useState(open);
  const [settled, setSettled] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // One frame folded first, so a newly mounted fold slides open too.
      let inner = 0;
      const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setExpanded(true)); });
      const done = setTimeout(() => setSettled(true), MS);
      return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); clearTimeout(done); };
    }
    setSettled(false);
    setExpanded(false);
    if (keepMounted) return;
    const gone = setTimeout(() => setMounted(false), MS);
    return () => clearTimeout(gone);
  }, [open, keepMounted]);

  if (!mounted) return null;
  return (
    <div className={`fold${expanded ? ' open' : ''}${settled ? ' settled' : ''}${className ? ` ${className}` : ''}`}>
      <div className="fold-inner">{children}</div>
    </div>
  );
}
