/**
 * One-time Monaco setup for the app shell (S0.7).
 *
 * Responsibilities:
 *   1.  Tell `@monaco-editor/react` to use the locally-bundled `monaco-editor`
 *       package instead of fetching from a CDN at runtime — required for M0
 *       (offline/local) and a hard requirement for any future hosted M1
 *       deployment behind a corporate proxy.
 *   2.  Wire Monaco's web workers through Vite's `?worker` import syntax so
 *       they're code-split and served from our own origin.
 *   3.  Register the `simpleSteps` language — a Monarch tokenizer that gives
 *       us syntax highlighting for `=operation.mode(arg=value, ref=step.col)`
 *       formulas.  This is a stub today; later sprints will layer
 *       completions, hovers and diagnostics on top of the same language id.
 *
 * Import this module exactly once, from `main.tsx`, before any component
 * that mounts an editor.
 */

import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { loader } from '@monaco-editor/react';

// Web workers via Vite. The `?worker` suffix makes Vite emit a dedicated
// chunk and return a constructor.
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

// Tell Monaco how to spin up workers it asks for.  We only need the base
// `editorWorkerService` for now — no TS/JSON/CSS language workers, because
// our language is custom and very simple.
self.MonacoEnvironment = {
  getWorker(_workerId: string, _label: string) {
    return new EditorWorker();
  },
};

// Hand `@monaco-editor/react` our bundled monaco instance.
loader.config({ monaco });

// ── `simpleSteps` language ─────────────────────────────────────────────────
//
// Grammar overview:
//
//   =OPERATION[.MODE](arg=value, ref=stepN.col, ...)
//
// Tokens we colour:
//   - leading `=`                            → operator
//   - operation identifier (before `.` / `(`) → type.identifier
//   - `.mode` modifier (source/map/filter/…) → keyword
//   - parameter name before `=`              → variable.parameter
//   - step references like `step1.col`       → variable.reference
//   - strings, numbers, booleans             → string / number / keyword

const ORCHESTRATION_MODES = [
  'source', 'map', 'filter', 'dataframe',
  'expand', 'raw_output', 'orchestrator', 'each',
];

const LITERALS = ['True', 'False', 'None', 'null', 'true', 'false'];

export const SIMPLE_STEPS_LANGUAGE_ID = 'simpleSteps';

function registerSimpleStepsLanguage() {
  // Don't double-register if HMR re-runs this module.
  if (monaco.languages.getLanguages().some((l: { id: string }) => l.id === SIMPLE_STEPS_LANGUAGE_ID)) {
    return;
  }

  monaco.languages.register({ id: SIMPLE_STEPS_LANGUAGE_ID });

  monaco.languages.setMonarchTokensProvider(SIMPLE_STEPS_LANGUAGE_ID, {
    defaultToken: '',
    tokenPostfix: '.ss',

    modes: ORCHESTRATION_MODES,
    literals: LITERALS,

    tokenizer: {
      root: [
        // Leading `=` marks a formula
        [/^=/, 'operator'],

        // Operation name right after `=`
        [/(?<==)\s*[a-zA-Z_][\w]*/, 'type.identifier'],

        // `.mode` after operation name
        [
          /\.([a-zA-Z_]\w*)/,
          {
            cases: {
              '$1@modes': 'keyword',
              '@default': 'identifier',
            },
          },
        ],

        // Step references: `step1.col_name` or `stepN.col_name`
        [/\b(step\d+)\b/, 'variable.reference'],

        // Param name before `=`
        [/[a-zA-Z_]\w*(?=\s*=)/, 'variable.parameter'],

        // Numbers
        [/\b\d+\.\d+\b/, 'number.float'],
        [/\b\d+\b/, 'number'],

        // Strings
        [/"([^"\\]|\\.)*"/, 'string'],
        [/'([^'\\]|\\.)*'/, 'string'],

        // Booleans / None
        [
          /\b[A-Za-z_]\w*\b/,
          {
            cases: {
              '@literals': 'keyword',
              '@default': 'identifier',
            },
          },
        ],

        // Punctuation
        [/[()[\],]/, 'delimiter'],
        [/[=]/, 'operator'],

        // Whitespace
        [/\s+/, 'white'],
      ],
    },
  } as monaco.languages.IMonarchLanguage);

  monaco.languages.setLanguageConfiguration(SIMPLE_STEPS_LANGUAGE_ID, {
    brackets: [['(', ')'], ['[', ']']],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });
}

registerSimpleStepsLanguage();

export default monaco;
