import { build } from 'esbuild';

const result = await build({
  entryPoints: ['scripts/gameplay-check.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  tsconfig: 'tsconfig.json',
});
await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
