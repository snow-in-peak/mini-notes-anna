import type { AnnaRuntime } from './types';

declare global {
  interface Window {
    AnnaAppRuntime?: { connect: () => Promise<AnnaRuntime> };
  }
}

let annaPromise: Promise<AnnaRuntime> | null = null;

async function importRuntimeSdk(): Promise<{ AnnaAppRuntime: { connect: () => Promise<AnnaRuntime> } }> {
  try {
    const sdkUrl = '/static/anna-apps/_sdk/latest/index.js';
    return (await import(/* @vite-ignore */ sdkUrl)) as { AnnaAppRuntime: { connect: () => Promise<AnnaRuntime> } };
  } catch (error) {
    if (window.AnnaAppRuntime) {
      return { AnnaAppRuntime: window.AnnaAppRuntime };
    }
    throw new Error(
      `Anna Runtime SDK is only available inside anna-app dev / Anna UI Runtime. Original error: ${String(error)}`
    );
  }
}

export async function connectAnna(): Promise<AnnaRuntime> {
  if (!annaPromise) {
    annaPromise = importRuntimeSdk().then(async ({ AnnaAppRuntime }) => {
      const anna = await AnnaAppRuntime.connect();
      try {
        await anna.window?.set_title?.({ title: 'Mini Notes' });
      } catch {
        // Non-critical in older harnesses.
      }
      return anna;
    });
  }
  return annaPromise;
}
