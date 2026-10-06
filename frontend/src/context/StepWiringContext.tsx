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
import { stepRef } from '../utils/selection';
import type { GridPick, Selection } from '../utils/selection';

// ── Types ──────────────────────────────────────────────────────────────────

export interface WiringState {
  /** The step that is currently expecting an argument (has focused input). */
  receivingStepId: string | null;
  /** The index of that step in the pipeline, so prior steps can be highlighted. */
  receivingStepIndex: number | null;
  /** The input element ref so we can splice text at cursor. */
  inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement> | null;
  /**
   * The receiving step's handler for a pick from an earlier step's grid (its
   * formula bar turns it into a select operation — utils/selection.ts).
   * Inputs without one get `wf["<step>"]` inserted at the cursor.
   */
  onPick: ((sourceStep: string, pick: GridPick) => void) | null;
  /** What the receiving step currently selects, so the source grid can show it. */
  activeSelection: Selection | null;
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
    inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement>,
    onPick?: (sourceStep: string, pick: GridPick) => void,
  ) => void;
  /** A click in an earlier step's grid: hand it to the receiving step. */
  pickFrom: (sourceStep: string, pick: GridPick) => void;
  /** The receiving step publishes its current selection here. */
  setActiveSelection: (selection: Selection | null) => void;
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

const EMPTY_WIRING: WiringState = {
  receivingStepId: null, receivingStepIndex: null, inputRef: null, onPick: null, activeSelection: null,
};

const StepWiringContext = createContext<StepWiringContextValue>({
  wiringState: EMPTY_WIRING,
  activateWiring: () => {},
  deactivateWiring: () => {},
  injectReference: () => {},
  pickFrom: () => {},
  setActiveSelection: () => {},
});

// ── Provider ───────────────────────────────────────────────────────────────

export function StepWiringProvider({ children }: { children: React.ReactNode }) {
  const [wiringState, setWiringState] = useState<WiringState>(EMPTY_WIRING);

  // Deactivation timeout so grid clicks (which briefly blur the input) still
  // get a chance to fire before we clear wiring state.
  const deactivateTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activateWiring = useCallback(
    (
      stepId: string,
      stepIndex: number,
      inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement>,
      onPick?: (sourceStep: string, pick: GridPick) => void,
    ) => {
      if (deactivateTimeout.current) {
        clearTimeout(deactivateTimeout.current);
        deactivateTimeout.current = null;
      }
      setWiringState((prev) => ({
        receivingStepId: stepId,
        receivingStepIndex: stepIndex,
        inputRef,
        onPick: onPick ?? null,
        activeSelection: prev.receivingStepId === stepId ? prev.activeSelection : null,
      }));
    },
    []
  );

  const deactivateWiring = useCallback(() => {
    deactivateTimeout.current = setTimeout(() => {
      setWiringState(EMPTY_WIRING);
    }, 200);
  }, []);

  const injectReference = useCallback(
    // eslint-disable-next-line react-hooks/preserve-manual-memoization
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

      // Insert only the reference, at the cursor — never a parameter name.
      const insertText = token;

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

  const pickFrom = useCallback(
    (sourceStep: string, pick: GridPick) => {
      // A grid click briefly blurs the formula bar — keep wiring alive.
      if (deactivateTimeout.current) {
        clearTimeout(deactivateTimeout.current);
        deactivateTimeout.current = null;
      }
      if (wiringState.onPick) {
        wiringState.onPick(sourceStep, pick);
      } else {
        injectReference(stepRef(sourceStep));
      }
    },
    [wiringState, injectReference]
  );

  const setActiveSelection = useCallback((selection: Selection | null) => {
    setWiringState((prev) => (prev.activeSelection === selection ? prev : { ...prev, activeSelection: selection }));
  }, []);

  return (
    <StepWiringContext.Provider value={{ wiringState, activateWiring, deactivateWiring, injectReference, pickFrom, setActiveSelection }}>
      {children}
    </StepWiringContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────
// eslint-disable-next-line react-refresh/only-export-components
export function useStepWiring() {
  return useContext(StepWiringContext);
}
