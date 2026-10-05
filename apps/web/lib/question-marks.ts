/** The DOM id of the place a question points at, for "show me" links. */
export function questionAnchorId(path: string): string {
  return `cv-${path.replaceAll('.', '-')}`;
}
