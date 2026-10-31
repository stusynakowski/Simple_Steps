import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import SymbolIcon from './SymbolIcon';
import type { SymbolName } from './SymbolIcon';

/** One action in a step menu, or a divider between groups of them. */
export type StepMenuItem = { divider: true } | {
  divider?: false;
  icon: SymbolName;
  label: string;
  /** A shortcut or a short note, shown at the right. */
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** A toggle: shown with a check when on; the menu stays open, so several can be switched. */
  checked?: boolean;
  testId?: string;
};

/**
 * A step toolbar expander (dev_plan/126 L1): a button that pops up a short
 * list of actions or toggles. The pop-up is drawn over the whole page (a
 * portal, fixed where the button is), so no step column clips or covers it.
 * Closes on a click elsewhere, on Esc, on scroll, or after an action.
 * With `children` instead of `items` it is a popover: the pop-up holds that
 * content (a step's settings, its notes) and stays open while it is used.
 */
export default function StepMenu({ icon, label, items = [], children, align = 'left', testId, text, badges, className = '', iconSize = 14 }: {
  icon: SymbolName;
  label: string;
  items?: StepMenuItem[];
  /** The popover's content, drawn in place of `items`. */
  children?: ReactNode;
  /** Which edge of the button the pop-up lines up with. */
  align?: 'left' | 'right';
  testId?: string;
  /** Words beside the icon, for a wider button. */
  text?: string;
  /** Small icons after the words: what is on now (the open panels, say). */
  badges?: SymbolName[];
  className?: string;
  iconSize?: number;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left?: number; right?: number } | null>(null);

  /** Open under the button (where it is now on screen), or close. */
  const toggle = () => {
    if (open || !button.current) { setOpen(false); return; }
    const r = button.current.getBoundingClientRect();
    setAt(align === 'left'
      ? { top: r.bottom + 4, left: r.left }
      : { top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // Scrolling the page moves the button away from the pop-up; scrolling
    // inside the pop-up (a long note, say) does not.
    const close = (e: Event) => { if (!pop.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <div className="step-menu" onClick={(e) => e.stopPropagation()}>
      <button
        ref={button}
        type="button"
        className={`btn-icon step-menu-toggle${open ? ' active' : ''}${className ? ` ${className}` : ''}`}
        aria-label={label}
        aria-haspopup={children ? 'dialog' : 'menu'}
        aria-expanded={open}
        title={label}
        data-testid={testId}
        onClick={toggle}
      >
        {/* Its name, then its icon: "Toggle ☰", "Manage Step ⇄" (owner, 2026-10-29). */}
        {text && <span className="step-menu-text">{text}</span>}
        <SymbolIcon name={icon} size={iconSize} />
        {!!badges?.length && (
          <span className="step-menu-badges" aria-hidden="true">
            {badges.map((b) => <SymbolIcon key={b} name={b} size={12} />)}
          </span>
        )}
      </button>
      {open && createPortal(
        <div
          ref={pop}
          className={`step-menu-pop${children ? ' step-menu-pop--panel' : ''}`}
          role={children ? 'dialog' : 'menu'}
          aria-label={label}
          style={{ top: at?.top ?? -9999, left: at?.left, right: at?.right }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* What this menu is (owner, 2026-10-30): its name, else its label. */}
          <div className="step-menu-header" aria-hidden="true">{text ?? label}</div>
          {children && <div className="step-menu-body">{children}</div>}
          {items.map((item, i) => (item.divider
            ? <div key={`d${i}`} className="step-menu-divider" role="separator" />
            : (
              <button
                key={item.label}
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={item.checked}
                className={`step-menu-item${item.danger ? ' danger' : ''}${item.checked ? ' checked' : ''}`}
                disabled={item.disabled}
                data-testid={item.testId}
                onClick={() => { if (item.checked === undefined) setOpen(false); item.onClick(); }}
              >
                <SymbolIcon name={item.icon} size={15} />
                <span className="step-menu-label">{item.label}</span>
                {item.hint && <span className="step-menu-hint">{item.hint}</span>}
                {item.checked !== undefined && (
                  <span className="step-menu-check">{item.checked && <SymbolIcon name="check" size={14} />}</span>
                )}
              </button>
            )))}
        </div>,
        document.body,
      )}
    </div>
  );
}
