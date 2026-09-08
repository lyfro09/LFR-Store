const { pathToFileURL } = require('node:url');

if (process.env.ENTRYPOINT_SMOKE === '1') {
  console.log('Hosting entry point is available.');
} else {
  void import('tsx/esm/api')
    .then(({ tsImport }) => tsImport('../src/index.ts', pathToFileURL(__filename).href))
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}
