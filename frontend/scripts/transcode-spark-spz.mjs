import { readFile, writeFile } from 'node:fs/promises';
import { transcodeSpz } from '@sparkjsdev/spark';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error('Usage: npm run gs:compress -- <input.ply> <output.spz>');
}

const inputBytes = new Uint8Array(await readFile(inputPath));
const result = await transcodeSpz({
  inputs: [{ fileBytes: inputBytes, pathOrUrl: inputPath }],
  maxSh: 3,
  fractionalBits: 12,
});
await writeFile(outputPath, result.fileBytes);

console.log(JSON.stringify({
  input: inputPath,
  output: outputPath,
  inputBytes: inputBytes.byteLength,
  outputBytes: result.fileBytes.byteLength,
  clippedCount: result.clippedCount,
}, null, 2));
