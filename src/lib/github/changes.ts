import { PROTECTED_PATHS, TEMPLATE, type FileMap } from "../files.ts";

export type Changes = { write: FileMap; remove: string[] };

/**
 * What differs between the files as they were imported and as they are now. Files that only exist
 * because Pivolar's starter template is always present (and were never touched) are not part of
 * the repository, so they are left out.
 */
export function diffImport(baseline: FileMap, current: FileMap): Changes {
  const write: FileMap = {};
  for (const [path, content] of Object.entries(current)) {
    if (PROTECTED_PATHS.has(path)) continue;
    if (path in baseline) {
      if (baseline[path] !== content) write[path] = content;
    } else if (TEMPLATE[path] !== content) {
      write[path] = content;
    }
  }
  const remove = Object.keys(baseline).filter((path) => !(path in current) && !PROTECTED_PATHS.has(path));
  return { write, remove };
}

export const countChanges = (changes: Changes) => Object.keys(changes.write).length + changes.remove.length;
