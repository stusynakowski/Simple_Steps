import React from 'react';

/**
 * Icon — thin wrapper around VS Code's codicon font.
 *
 * Usage:
 *   <Icon name="folder" />              — default size 16
 *   <Icon name="play" size={20} />
 *   <Icon name="error" color="#f55" />
 *   <Icon name="sync" spin />           — built-in spin animation
 *   <Icon name="files" className="..." title="Explorer" />
 *
 * All available names: https://microsoft.github.io/vscode-codicons/dist/codicon.html
 *
 * We deliberately funnel all icon usage through this component so that:
 *   1. Every icon call site is grep-able (`<Icon name=`).
 *   2. Future migrations (e.g. swapping codicons for another set) touch one file.
 *   3. Size / colour / a11y props stay consistent across the app.
 */
export interface IconProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Codicon name without the `codicon-` prefix. */
  name: string;
  /** Pixel size. Default 16 (matches VS Code's chrome). */
  size?: number;
  /** Optional explicit colour. Defaults to `currentColor`. */
  color?: string;
  /** Apply the codicon-modifier spin animation. */
  spin?: boolean;
  /** Tooltip text — also sets aria-label for accessibility. */
  title?: string;
}

const Icon: React.FC<IconProps> = ({
  name,
  size = 16,
  color,
  spin = false,
  title,
  className = '',
  style,
  ...rest
}) => {
  const cls = [
    'codicon',
    `codicon-${name}`,
    spin ? 'codicon-modifier-spin' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <span
      className={cls}
      title={title}
      aria-label={title ?? name}
      role="img"
      style={{
        fontSize: size,
        // Codicons render via font; aligning to text baseline avoids weird vertical drift.
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1,
        width: size,
        height: size,
        color,
        ...style,
      }}
      {...rest}
    />
  );
};

export default Icon;
