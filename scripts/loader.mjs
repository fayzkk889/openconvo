import { pathToFileURL, fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import ts from '../node_modules/typescript/lib/typescript.js';

const root = process.cwd();
const SRC = join(root, 'src');

function resolveFile(base) {
  const candidates = [base, base + '.ts', base + '.tsx', base + '.js', join(base, 'index.ts'), join(base, 'index.tsx')];
  for (const candidate of candidates) {
    if (existsSync(candidate) && !candidate.endsWith('/')) return pathToFileURL(candidate).href;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/server') {
    return { url: pathToFileURL(join(root, 'node_modules/next/server.js')).href, shortCircuit: true };
  }
  if (specifier.startsWith('@/')) {
    const resolved = resolveFile(join(SRC, specifier.slice(2)));
    if (resolved) return { url: resolved, shortCircuit: true };
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !extname(specifier) && context.parentURL) {
    const parentDir = fileURLToPath(new URL('.', context.parentURL));
    const resolved = resolveFile(join(parentDir, specifier));
    if (resolved) return { url: resolved, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const filename = fileURLToPath(url);
    const source = readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    });
    return { format: 'module', source: output.outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
