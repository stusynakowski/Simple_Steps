import { useRef, useState } from 'react';

/** Pixels the pointer must travel with the button down before a header pulls off. */
const DETACH_THRESHOLD = 18;

/**
 * Drag a header far enough and it pulls off into a floating window (a step's
 * header, the resources' header). Returns the header's mousedown handler and
 * whether a drag is under way (for the "drag to detach" hint). Clicks on a
 * header's buttons, inputs and links never start one.
 */
export function useDragToDetach(onDetach?: (position: { x: number; y: number }) => void) {
  const [hinting, setHinting] = useState(false);
  /** True right after a pull-off, so the click that ends the drag is ignored. */
  const justDetached = useRef(false);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || !onDetach) return;
    if ((e.target as HTMLElement).closest('button, select, input, a')) return;
    const start = { x: e.clientX, y: e.clientY };
    justDetached.current = false;

    const move = (me: MouseEvent) => {
      const dist = Math.hypot(me.clientX - start.x, me.clientY - start.y);
      if (dist > 4) setHinting(true);
      if (dist > DETACH_THRESHOLD) {
        cleanup();
        justDetached.current = true;
        onDetach({ x: me.clientX - 20, y: me.clientY - 18 });
      }
    };
    const cleanup = () => {
      setHinting(false);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', cleanup);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', cleanup);
  };

  /** Call first in the header's click handler: true means skip this click. */
  const consumeClick = () => {
    const skip = justDetached.current;
    justDetached.current = false;
    return skip;
  };

  return { onMouseDown, hinting, consumeClick };
}
