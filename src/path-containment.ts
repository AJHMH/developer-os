import { isAbsolute, relative, sep } from "node:path";
/** Inclusive lexical containment of absolute paths; callers canonicalize filesystem identities. */
export function pathContains(parent: string, child: string): boolean {
  if (!isAbsolute(parent) || !isAbsolute(child)) return false;
  const difference = relative(parent, child);
  return (
    difference === "" ||
    (difference !== ".." &&
      !difference.startsWith(`..${sep}`) &&
      !isAbsolute(difference))
  );
}
