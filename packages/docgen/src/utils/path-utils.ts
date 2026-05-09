export const normalizePath = (path: string): string => {
  return path.split("\\").join("/");
};
export const matchesGlob = (path: string, pattern: string): boolean => {
  return globToRegExp(normalizePath(pattern)).test(normalizePath(path));
};
const globCache = new Map<string, RegExp>();
const globToRegExp = (pattern: string): RegExp => {
  const normalized = normalizePath(pattern);
  const cached = globCache.get(normalized);
  if (cached) {
    return cached;
  }
  let source = "^";
  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*") {
      if (next === "*") {
        const after = normalized[index + 2];
        if (after === "/") {
          source += "(?:.*/)?";
          index += 2;
        } else {
          source += ".*";
          index++;
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }
  source += "$";
  const regex = new RegExp(source);
  globCache.set(normalized, regex);
  return regex;
};
const escapeRegExp = (char: string): string => {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
};
