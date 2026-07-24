'use strict';

module.exports = function externalWasmModuleLoader() {
  return 'export { default } from "@shiftsync/prisma-wasm";';
};
