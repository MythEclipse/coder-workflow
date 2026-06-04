/**
 * Escape special regex characters in a string.
 * Use before passing user input to `new RegExp()`.
 */
export function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
