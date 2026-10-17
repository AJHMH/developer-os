import { isAbsolute, relative, sep, win32 } from "node:path";
/** Inclusive lexical containment of absolute paths; callers canonicalize filesystem identities. */
export function pathContains(
  parent: string,
  child: string,
  platform: "native" | "win32" = "native",
): boolean {
  const paths = platform === "win32" ? win32 : { isAbsolute, relative, sep };
  if (!paths.isAbsolute(parent) || !paths.isAbsolute(child)) return false;
  const difference = paths.relative(parent, child);
  return (
    difference === "" ||
    (difference !== ".." &&
      !difference.startsWith(`..${paths.sep}`) &&
      !paths.isAbsolute(difference))
  );
}
