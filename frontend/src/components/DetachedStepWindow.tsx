import type { ComponentProps } from 'react';
import OperationColumn from './OperationColumn';
import FloatingWindow, { useFloatingWindow } from './FloatingWindow';

type ColumnProps = ComponentProps<typeof OperationColumn>;

/** The window decides these: the step inside is always open, never squeezed. */
type WindowManaged = 'isActive' | 'isSqueezed' | 'isMaximized' | 'isMinimized' | 'zIndex'
  | 'onActivate' | 'onMinimize' | 'onMaximize' | 'onMinimizeStep' | 'onDetach'
  | 'onResizeStart' | 'onResizeReset';

interface DetachedStepWindowProps extends Omit<ColumnProps, WindowManaged> {
  color: string;
  initialPosition: { x: number; y: number };
  onClose: () => void;
}

/**
 * A step pulled off the canvas into its own window: the whole step, with
 * every feature it has in place. Its header's minimize and maximize act on
 * the window.
 */
export default function DetachedStepWindow({ initialPosition, onClose, ...column }: DetachedStepWindowProps) {
  return (
    <FloatingWindow title={column.step.label} color={column.color} initialPosition={initialPosition} onClose={onClose}>
      <StepInWindow {...column} />
    </FloatingWindow>
  );
}

function StepInWindow(column: Omit<ColumnProps, WindowManaged>) {
  const win = useFloatingWindow();
  return (
    <OperationColumn
      {...column}
      isActive={true}
      isSqueezed={false}
      isMaximized={win?.maximized ?? false}
      zIndex={1}
      onActivate={() => {/* always open in a window */}}
      onMinimizeStep={win?.toggleMinimize}
      onMaximize={win?.toggleMaximize}
    />
  );
}
