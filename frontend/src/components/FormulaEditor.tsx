/**
 * FormulaEditor (S0.7).
 *
 * Drop-in replacement for the `<textarea>` that used to live inline in
 * `StepToolbar`'s formula bar.  Renders a Monaco editor for the typing
 * experience (syntax highlighting today; completions/hovers later), while
 * keeping a hidden `<textarea>` as the *source-of-truth DOM node* that the
 * existing `StepWiringContext` injects references into.
 *
 * Why the hidden textarea?
 * ────────────────────────
 * Wiring (`injectReference`) was written against the standard DOM:
 *
 *     inputEl.selectionStart / selectionEnd / value
 *     Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
 *
 * Monaco doesn't satisfy that contract — it renders to canvas and exposes its
 * own `editor.getModel()` / `getPosition()` API.  Rather than refactor every
 * wiring caller (~6 sites) in this sprint, we keep the textarea as the
 * "shadow" element and bridge it bidirectionally to Monaco.  Future sprints
 * can migrate wiring to a `FormulaEditorHandle` interface and drop the
 * shadow.
 *
 * Data flow:
 *
 *   User types in Monaco
 *     → onDidChangeModelContent
 *     → write Monaco value into hidden textarea (via native setter + bubble
 *       an `input` event so React listeners fire just like before)
 *
 *   Wiring injects into hidden textarea (existing code)
 *     → input event fires (already does)
 *     → we listen for it and copy textarea value back into Monaco's model
 *
 *   Parent updates `value` prop (e.g. workflow load)
 *     → useEffect syncs textarea + Monaco model
 *
 *   Cursor:
 *     Monaco → textarea on every selection change (so wiring inserts at
 *     the visible caret).
 */

import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { SIMPLE_STEPS_LANGUAGE_ID } from '../shell/monacoSetup';

export interface FormulaEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** Fired when the editor's textarea-equivalent receives an Enter (no shift). */
  onEnter?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  /** Forwarded to the hidden textarea so wiring works unchanged. */
  shadowRef?: (el: HTMLTextAreaElement | null) => void;
  testId?: string;
}

/**
 * Imperative handle for callers that previously held a `HTMLTextAreaElement`.
 * We expose the same shape via the shadow textarea — most callers just want
 * `.focus()`.
 */
export interface FormulaEditorRef {
  focus(): void;
  getValue(): string;
}

const FormulaEditor = forwardRef<FormulaEditorRef, FormulaEditorProps>(function FormulaEditor(
  { value, onChange, onEnter, onFocus, onBlur, placeholder, shadowRef, testId },
  ref,
) {
  const monacoRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const shadowTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Suppress feedback loop: when we push value Monaco → textarea (or vice
  // versa) we don't want the other side to bounce the change right back.
  const syncingRef = useRef(false);

  // Expose imperative API.
  useImperativeHandle(ref, () => ({
    focus: () => monacoRef.current?.focus(),
    getValue: () => monacoRef.current?.getValue() ?? value,
  }), [value]);

  // Mount-time wiring of Monaco editor.
  const handleMount: OnMount = (editor, monaco) => {
    monacoRef.current = editor;

    // Register our dark formula-bar theme once.  Matches the surrounding
    // VS-Code-style chrome (#1e1e1e bg, #d4d4d4 text) so the bar reads as
    // part of the dark toolbar instead of a white island.
    try {
      monaco.editor.defineTheme('simple-steps-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#1e1e1e',
          'editor.foreground': '#d4d4d4',
          'editorCursor.foreground': '#aeafad',
          'editor.lineHighlightBackground': '#1e1e1e',
          'editor.selectionBackground': '#264f78',
          'editorWidget.background': '#252526',
          'editorWidget.border': '#3c3c3c',
        },
      });
      monaco.editor.setTheme('simple-steps-dark');
    } catch {
      /* theme already registered — no-op */
    }

    // Push initial value into the hidden textarea (in case it was created
    // empty before Monaco mounted).
    if (shadowTextareaRef.current && shadowTextareaRef.current.value !== value) {
      shadowTextareaRef.current.value = value;
    }

    // Monaco → React (and shadow textarea).
    editor.onDidChangeModelContent(() => {
      if (syncingRef.current) return;
      const next = editor.getValue();

      // Mirror into shadow textarea so wiring sees the same value.
      const ta = shadowTextareaRef.current;
      if (ta && ta.value !== next) {
        syncingRef.current = true;
        ta.value = next;
        syncingRef.current = false;
      }

      onChange(next);
    });

    // Keep shadow textarea's selection synced with Monaco's caret so any
    // wiring `injectReference` call inserts at the visible position.
    editor.onDidChangeCursorSelection((e) => {
      const ta = shadowTextareaRef.current;
      if (!ta) return;
      const model = editor.getModel();
      if (!model) return;
      const startOffset = model.getOffsetAt(e.selection.getStartPosition());
      const endOffset = model.getOffsetAt(e.selection.getEndPosition());
      try {
        ta.setSelectionRange(startOffset, endOffset);
      } catch {
        /* selection range invalid (textarea not focused yet) — safe to ignore */
      }
    });

    // Enter (no shift) submits.
    editor.addCommand(
      // monaco.KeyCode.Enter = 3
      3,
      () => {
        onEnter?.();
      },
    );

    // Focus / blur bubble up for autocomplete + wiring activation.
    editor.onDidFocusEditorText(() => onFocus?.());
    editor.onDidBlurEditorText(() => onBlur?.());
  };

  // Parent prop changed → push into Monaco model (only if different).
  useEffect(() => {
    const ed = monacoRef.current;
    if (!ed) return;
    const current = ed.getValue();
    if (current !== value) {
      syncingRef.current = true;
      ed.setValue(value);
      syncingRef.current = false;
    }
    // Keep shadow textarea in sync too.
    const ta = shadowTextareaRef.current;
    if (ta && ta.value !== value) ta.value = value;
  }, [value]);

  // Listen for wiring-driven `input` events on the hidden textarea and copy
  // the new value into Monaco.  The wiring system dispatches this event after
  // splicing a reference token into the textarea.
  useEffect(() => {
    const ta = shadowTextareaRef.current;
    if (!ta) return;
    const onInput = () => {
      if (syncingRef.current) return;
      const ed = monacoRef.current;
      if (!ed) return;
      if (ed.getValue() !== ta.value) {
        syncingRef.current = true;
        ed.setValue(ta.value);
        syncingRef.current = false;
      }
      onChange(ta.value);
    };
    ta.addEventListener('input', onInput);
    return () => ta.removeEventListener('input', onInput);
  }, [onChange]);

  return (
    <div className="formula-editor" style={{ position: 'relative', width: '100%' }}>
      <Editor
        height="28px"
        defaultLanguage={SIMPLE_STEPS_LANGUAGE_ID}
        defaultValue={value}
        onMount={handleMount}
        theme="simple-steps-dark"
        options={{
          // Single-line UX
          lineNumbers: 'off',
          glyphMargin: false,
          folding: false,
          lineDecorationsWidth: 0,
          lineNumbersMinChars: 0,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          scrollBeyondLastColumn: 0,
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
          renderLineHighlight: 'none',
          scrollbar: {
            vertical: 'hidden',
            horizontal: 'hidden',
            handleMouseWheel: false,
          },
          wordWrap: 'off',
          fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
          fontSize: 13,
          padding: { top: 4, bottom: 4 },
          contextmenu: false,
          quickSuggestions: false,
          // Tab/Enter should not insert tab/newline — single-line formulas.
          tabSize: 2,
          formatOnPaste: false,
          formatOnType: false,
        }}
      />
      {/* Placeholder — Monaco doesn't have a native placeholder. */}
      {placeholder && !value && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 6,
            left: 12,
            color: '#bbb',
            pointerEvents: 'none',
            fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
            fontSize: 13,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            width: 'calc(100% - 16px)',
          }}
        >
          {placeholder}
        </div>
      )}
      {/* Hidden textarea — the wiring system's injection target. */}
      <textarea
        ref={(el) => {
          shadowTextareaRef.current = el;
          shadowRef?.(el);
        }}
        defaultValue={value}
        data-testid={testId}
        aria-hidden
        tabIndex={-1}
        style={{
          position: 'absolute',
          left: -9999,
          top: 0,
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
});

export default FormulaEditor;
