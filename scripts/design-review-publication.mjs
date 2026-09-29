import { existsSync } from 'node:fs';
import { readFile, rename } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

export function safeRoundId(roundId) {
  if (typeof roundId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(roundId)) throw new Error('Unsafe design-review round ID.');
  return roundId;
}

export async function publishRound({ stage, latest, archive, exists = existsSync, read = readFile, move = rename }) {
  const stageName = basename(stage);
  safeRoundId(stageName);
  if (resolve(stage) === resolve(latest) || !exists(stage)) throw new Error('Validated staging directory is missing.');
  let archived;
  if (exists(latest)) {
    const previous = JSON.parse(await read(resolve(latest, 'manifest.json'), 'utf8'));
    const previousId = safeRoundId(previous.roundId);
    archived = resolve(archive, previousId);
    if (exists(archived)) throw new Error(`Archive collision for ${previousId}.`);
    await move(latest, archived);
  }
  try {
    await move(stage, latest);
  } catch (error) {
    if (archived) await move(archived, latest);
    throw error;
  }
}
