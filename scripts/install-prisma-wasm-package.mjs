import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = process.cwd();
const source = resolve(projectRoot, 'src/generated/prisma/internal/query_engine_bg.wasm');
const packageDirectory = resolve(projectRoot, 'node_modules/@shiftsync/prisma-wasm');

await mkdir(packageDirectory, { recursive: true });
await copyFile(source, resolve(packageDirectory, 'query_engine_bg.wasm'));
await writeFile(
  resolve(packageDirectory, 'package.json'),
  `${JSON.stringify(
    {
      name: '@shiftsync/prisma-wasm',
      version: '0.0.0',
      private: true,
      type: 'module',
      exports: './index.js',
    },
    null,
    2
  )}\n`
);
await writeFile(
  resolve(packageDirectory, 'index.js'),
  'import wasm from "./query_engine_bg.wasm";\nexport default wasm;\n'
);
