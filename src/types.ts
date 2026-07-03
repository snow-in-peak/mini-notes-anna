export interface Note {
  id: string;
  order: number;
  content: string;
  createdAt: string;
}

export interface AnnaStorageApi {
  get(input: { key: string }): Promise<{ value?: unknown } | unknown>;
  set(input: { key: string; value: unknown }): Promise<unknown>;
}

export interface AnnaToolsApi {
  invoke(input: { tool_id: string; method: string; args: Record<string, unknown> }): Promise<unknown>;
}

export interface AnnaRuntime {
  storage: AnnaStorageApi;
  tools: AnnaToolsApi;
  window?: {
    set_title?(input: { title: string }): Promise<unknown>;
  };
}
