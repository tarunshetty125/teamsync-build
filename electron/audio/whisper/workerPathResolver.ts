// electron/audio/whisper/workerPathResolver.ts
// Resolves the filesystem path to the compiled whisperWorker.js file.

import * as path from 'path';
import * as fs from 'fs';

function findFirstExistingPath(
  candidates: string[],
  exists: (p: string) => boolean = fs.existsSync,
): string {
  return candidates.find(p => exists(p)) ?? candidates[0];
}

/** Resolve the path to the whisper worker script. */
export function resolveWhisperWorkerPath(): string {
  return findFirstExistingPath([
    path.join(__dirname, 'whisperWorker.js'),
    path.join(__dirname, 'audio', 'whisper', 'whisperWorker.js'),
  ]);
}
