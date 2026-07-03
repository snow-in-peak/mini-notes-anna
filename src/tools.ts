import { TOOL_ID, TOOL_METHOD } from './constants';
import type { AnnaRuntime, Note } from './types';

function readSummary(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if (typeof obj.summary === 'string') return obj.summary;
    if (obj.result && typeof obj.result === 'object' && typeof (obj.result as Record<string, unknown>).summary === 'string') {
      return (obj.result as Record<string, string>).summary;
    }
    if (typeof obj.content === 'string') return obj.content;
  }
  return JSON.stringify(result, null, 2);
}

export async function summarizeNotes(anna: AnnaRuntime, notes: Note[]): Promise<string> {
  const result = await anna.tools.invoke({
    tool_id: TOOL_ID,
    method: TOOL_METHOD,
    args: {
      notes,
      requested_by: 'mini-notes-ui'
    }
  });
  return readSummary(result);
}
