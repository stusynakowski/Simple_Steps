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
 *       us syntax highlighting for formulas in core's syntax,
 *       `=tool[mod.map()](wf["step"], arg=value)`.  This is a stub today; later sprints will layer
 *       completions, hovers and diagnostics on top of the same language id.
 *
 * Import this module exactly once, from `main.tsx`, before any component
 * that mounts an editor.
 */

import * as monaco from 'monaco-editor/editor/editor.api';
import { loader } from '@monaco-editor/react';

// Web workers via Vite. The `?worker` suffix makes Vite emit a dedicated
// chunk and return a constructor.
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

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
// Grammar: core's syntax (dev_plan/126 F3), valid Python:
//
//   =tool[mod.map(), mod.name("score")](wf["readings"], n=wf["r"][0:2][cols["n"]], llm=res["llm"])
//
// Tokens we colour:
//   - leading `=`                                → operator
//   - `wf["step"]`, a step reference             → variable.predefined
//   - `res["name"]`, a resource                  → type
//   - `mod.verb`, a modifier                     → keyword
//   - `cols[…]`, `rows[…]` in a selection        → keyword
//   - a tool (a name before `[` or `(`)          → type.identifier
//   - a parameter name before `=`                → variable.parameter
//   - strings, numbers, True / False / None      → string / number / keyword

const LITERALS = ['True', 'False', 'None'];

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

    literals: LITERALS,

    tokenizer: {
      root: [
        // Leading `=` marks a formula
        [/^=/, 'operator'],

        // A step reference, wf["readings"], and a resource, res["llm"]
        [/\bwf\[\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\]/, 'variable.predefined'],
        [/\bres\[\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\]/, 'type'],

        // Modifiers, mod.map, and selection helpers, cols[…] / rows[…]
        [/\bmod\.[a-zA-Z_]\w*/, 'keyword'],
        [/\b(?:cols|rows)(?=\s*\[)/, 'keyword'],

        // A parameter name before `=` (not `==`)
        [/[a-zA-Z_]\w*(?=\s*=(?!=))/, 'variable.parameter'],

        // A tool: a name followed by its modifiers or its call
        [/[a-zA-Z_]\w*(?=\s*[[(])/, 'type.identifier'],

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
