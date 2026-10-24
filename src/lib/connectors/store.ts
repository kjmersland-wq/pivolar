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

export function removeConnector(projectId: string, id: string): void {
  try {
    const rest = loadConnectors(projectId);
    delete rest[id];
    window.localStorage.setItem(KEY(projectId), JSON.stringify(rest));
  } catch {
    /* storage blocked: nothing to remove */
  }
}

export function saveConnector(projectId: string, id: string, values: Record<string, string>): void {
  try {
    window.localStorage.setItem(KEY(projectId), JSON.stringify({ ...loadConnectors(projectId), [id]: values }));
  } catch {
    /* storage blocked: the values just are not remembered */
  }
}
