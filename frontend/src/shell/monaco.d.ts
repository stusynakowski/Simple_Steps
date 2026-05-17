// Type shim: re-export `monaco-editor`'s public types under the deep
// `editor.api` import path.  We import the runtime from
// `monaco-editor/esm/vs/editor/editor.api` (which avoids pulling in all the
// bundled languages), but TypeScript only ships types at the package root.
declare module 'monaco-editor/esm/vs/editor/editor.api' {
  export * from 'monaco-editor';
}
