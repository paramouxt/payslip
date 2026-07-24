'use strict';

module.exports = function inlineWasmModuleLoader(source) {
  const base64 = source.toString('base64');

  return `
const encoded = ${JSON.stringify(base64)};
const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
export default new WebAssembly.Module(bytes);
`;
};

module.exports.raw = true;

