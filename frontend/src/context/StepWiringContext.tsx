/**
 * StepWiringContext
 *
 * Provides Excel-like reactive cell/column reference wiring between steps.
 *
 * When a formula bar (or parameter input) is focused for step N, any step
 * with index < N enters "wiring mode". Clicking a column header or a cell in
 * a wiring-mode step inserts a reference token (e.g. `step-2.url` or
 * `step-2[row=3, col=url]`) at the cursor position in the focused input.
 *
 *  ┌─ StepWiringProvider (wraps MainLayout)
 *  │   wiringState: { receivingStepId, inputRef, cursorPos }
 *  │
 *  ├── OperationColumn (step N)  → registers input focus via activateWiring()
 *  │    └── StepToolbar / param inputs call activateWiring / deactivateWiring
 *  │
 *  └── OperationColumn (step M, M < N)  → isWiringSource=true
 *       └── DataOutputGrid  → renders in "wiring mode", emits onWireSelect(ref)
 */

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

export interface WiringState {
  /** The step that is currently expecting an argument (has focused input). */
  receivingStepId: string | null;
  /** The index of that step in the pipeline, so prior steps can be highlighted. */
  receivingStepIndex: number | null;
  /** The input element ref so we can splice text at cursor. */
  inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement> | null;
}

export interface StepWiringContextValue {
  wiringState: WiringState;
  /**
   * Called by a focused formula bar or param input to register itself as the
   * current wiring target.
   */
  activateWiring: (
    stepId: string,
    stepIndex: number,
    inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement>
  ) => void;
  /**
   * Called on blur (with a small delay so grid clicks can fire first).
   */
  deactivateWiring: () => void;
  /**
   * Called by a wiring-source grid cell/column when clicked. Splices the
   * reference token into the active input at the current cursor position and
   * fires an onChange-equivalent so React state stays in sync.
   */
  injectReference: (token: string) => void;
}

// ── Context ────────────────────────────────────────────────────────────────

const StepWiringContext = createContext<StepWiringContextValue>({
  wiringState: { receivingStepId: null, receivingStepIndex: null, inputRef: null },
  activateWiring: () => {},
  deactivateWiring: () => {},
  injectReference: () => {},
});

// ── Provider ───────────────────────────────────────────────────────────────

export function StepWiringProvider({ children }: { children: React.ReactNode }) {
  const [wiringState, setWiringState] = useState<WiringState>({
    receivingStepId: null,
    receivingStepIndex: null,
    inputRef: null,
  });

  // Deactivation timeout so grid clicks (which briefly blur the input) still
  // get a chance to fire before we clear wiring state.
  const deactivateTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activateWiring = useCallback(
    (
      stepId: string,
      stepIndex: number,
      inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement>
    ) => {
      if (deactivateTimeout.current) {
        clearTimeout(deactivateTimeout.current);
        deactivateTimeout.current = null;
      }
      setWiringState({ receivingStepId: stepId, receivingStepIndex: stepIndex, inputRef });
    },
    []
  );

  const deactivateWiring = useCallback(() => {
    deactivateTimeout.current = setTimeout(() => {
      setWiringState({ receivingStepId: null, receivingStepIndex: null, inputRef: null });
    }, 200);
  }, []);

  const injectReference = useCallback(
    (token: string) => {
      // Cancel any pending deactivation — the user clicked a grid cell
      if (deactivateTimeout.current) {
        clearTimeout(deactivateTimeout.current);
        deactivateTimeout.current = null;
      }

      const inputEl = wiringState.inputRef?.current;
      if (!inputEl) return;

      const start = inputEl.selectionStart ?? inputEl.value.length;
      const end = inputEl.selectionEnd ?? start;
      const before = inputEl.value.slice(0, start);
      const after = inputEl.value.slice(end);

      // Context-aware injection: if the cursor is inside parens of an
      // operation like `=to_rows(|)`, insert as `data=token` so the
      // formula parser doesn't misinterpret bracket-style cell references.
      let insertText = token;
      const insideParens = before.includes('(') && (after.includes(')') || !after.trim());
      if (insideParens) {
        // Check if there's already a param name before the cursor (e.g. "data=")
        const afterLastCommaOrParen = before.slice(Math.max(before.lastIndexOf('('), before.lastIndexOf(',')) + 1).trim();
        if (!afterLastCommaOrParen.includes('=')) {
          // No param name yet — use "data=" as default first param
          insertText = `data=${token}`;
        }
      }

      const newValue = before + insertText + after;

      // Use native input setter so React's synthetic event fires properly
      const nativeInputSetter = Object.getOwnPropertyDescriptor(
        inputEl.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype,
        'value'
      )?.set;
      nativeInputSetter?.call(inputEl, newValue);
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));

      // Move cursor to after the inserted token
      const newCursor = start + insertText.length;
      setTimeout(() => {
        inputEl.focus();
        inputEl.setSelectionRange(newCursor, newCursor);
      }, 0);
    },
    [wiringState.inputRef]
  );

  return (
    <StepWiringContext.Provider value={{ wiringState, activateWiring, deactivateWiring, injectReference }}>
      {children}
    </StepWiringContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useStepWiring() {
  return useContext(StepWiringContext);
}
