export type Saved = Record<string, Record<string, string>>;

const KEY = (projectId: string) => `atelier:connectors:${projectId}`;

/** What the owner has entered for each connector in this project. It lives only in this browser. */
export function loadConnectors(projectId: string): Saved {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY(projectId)) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Saved) : {};
  } catch {
    return {};
  }
}

export function saveConnector(projectId: string, id: string, values: Record<string, string>): void {
  try {
    window.localStorage.setItem(KEY(projectId), JSON.stringify({ ...loadConnectors(projectId), [id]: values }));
  } catch {
    /* storage blocked: the values just are not remembered */
  }
}
