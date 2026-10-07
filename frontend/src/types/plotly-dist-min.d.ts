// plotly.js-dist-min ships no types. CellViewer.tsx loads it lazily and only
// calls newPlot / purge, typed where it uses them.
declare module 'plotly.js-dist-min';
