// A Node module hook for the page tests: pages import the UI kit by its browser URL (/ui/js/html.js), which the
// launcher serves from nooblyjs-core/public/ui. Here that URL resolves to the same files on disk.
let uiDir = null;

export async function initialize(data) {
  uiDir = data.uiDir;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('/ui/')) return nextResolve(new URL(specifier.slice('/ui/'.length), `file://${uiDir}/`).href, context);
  return nextResolve(specifier, context);
}
