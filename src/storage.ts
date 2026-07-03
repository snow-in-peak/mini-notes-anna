import { STORAGE_KEY } from './constants';
import type { AnnaRuntime, Note } from './types';

function unwrapStorageValue(response: unknown): unknown {
  if (response && typeof response === 'object' && 'value' in response) {
    return (response as { value?: unknown }).value;
  }
  return response;
}

function normalizeNotes(value: unknown): Note[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Note => {
      return Boolean(
        item &&
          typeof item === 'object' &&
          typeof (item as Note).id === 'string' &&
          typeof (item as Note).order === 'number' &&
          typeof (item as Note).content === 'string'
      );
    })
    .sort((a, b) => a.order - b.order);
}

export async function loadNotes(anna: AnnaRuntime): Promise<Note[]> {
  const response = await anna.storage.get({ key: STORAGE_KEY });
  return normalizeNotes(unwrapStorageValue(response));
}

export async function saveNotes(anna: AnnaRuntime, notes: Note[]): Promise<void> {
  await anna.storage.set({ key: STORAGE_KEY, value: notes });
}
