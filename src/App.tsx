import { useEffect, useMemo, useState } from 'react';
import { connectAnna } from './annaRuntime';
import { loadNotes, saveNotes } from './storage';
import { summarizeNotes } from './tools';
import type { AnnaRuntime, Note } from './types';

function makeNote(content: string, order: number): Note {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    order,
    content,
    createdAt: new Date().toISOString()
  };
}

export function App() {
  const [anna, setAnna] = useState<AnnaRuntime | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState('');
  const [summary, setSummary] = useState('');
  const [status, setStatus] = useState('Connecting to Anna Runtime...');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    connectAnna()
      .then(async (runtime) => {
        if (cancelled) return;
        setAnna(runtime);
        const stored = await loadNotes(runtime);
        if (cancelled) return;
        setNotes(stored);
        setStatus('Ready. Notes are loaded through anna.storage.get.');
      })
      .catch((err) => {
        setStatus('Anna Runtime is unavailable. Open this app with anna-app dev.');
        setError(String(err instanceof Error ? err.message : err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const nextOrder = useMemo(() => notes.reduce((max, note) => Math.max(max, note.order), 0) + 1, [notes]);

  async function persist(next: Note[]) {
    if (!anna) throw new Error('Anna Runtime is not connected yet.');
    setNotes(next);
    await saveNotes(anna, next);
    setStatus('Saved through anna.storage.set.');
  }

  async function addNote() {
    const content = draft.trim();
    if (!content) {
      setError('Empty notes cannot be saved.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await persist([...notes, makeNote(content, nextOrder)]);
      setDraft('');
      setSummary('');
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteNote(id: string) {
    setBusy(true);
    setError('');
    try {
      await persist(notes.filter((note) => note.id !== id));
      setSummary('');
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function summarize() {
    if (!anna) return;
    setBusy(true);
    setError('');
    setSummary('');
    try {
      const latestNotes = await loadNotes(anna);
      setNotes(latestNotes);
      const text = await summarizeNotes(anna, latestNotes);
      setSummary(text);
      setStatus('Summary returned through anna.tools.invoke -> Executa -> sampling/createMessage.');
    } catch (err) {
      const message = String(err instanceof Error ? err.message : err);
      setError(message);
      setStatus('Summarize attempted anna.tools.invoke. In --no-llm harness this error is expected.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <header>
        <p className="eyebrow">Anna App</p>
        <h1>Mini Notes</h1>
        <p className="subtle">Create notes with Anna storage, then summarize them through an Executa sampling tool.</p>
      </header>

      <section className="card composer">
        <label htmlFor="note-input">New note</label>
        <textarea
          id="note-input"
          value={draft}
          disabled={busy || !anna}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Example: Tomorrow follow up with customer"
          rows={4}
        />
        <button onClick={addNote} disabled={busy || !anna}>Save Note</button>
      </section>

      <section className="card">
        <div className="section-heading">
          <h2>Notes</h2>
          <span>{notes.length} saved</span>
        </div>
        {notes.length === 0 ? (
          <p className="empty">No notes yet. Add one above.</p>
        ) : (
          <ol className="notes-list">
            {notes.map((note) => (
              <li key={note.id}>
                <div>
                  <strong>#{note.order}</strong>
                  <p>{note.content}</p>
                  <small>{new Date(note.createdAt).toLocaleString()}</small>
                </div>
                <button className="ghost" onClick={() => deleteNote(note.id)} disabled={busy}>Delete</button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="card">
        <div className="section-heading">
          <h2>LLM Summary</h2>
          <button onClick={summarize} disabled={busy || !anna || notes.length === 0}>Summarize</button>
        </div>
        {summary ? <pre className="summary">{summary}</pre> : <p className="empty">Summary will appear here.</p>}
      </section>

      <footer>
        <p>{status}</p>
        {error ? <pre className="error">{error}</pre> : null}
      </footer>
    </main>
  );
}
