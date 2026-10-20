export function makeTitleProposal(description: string | null | undefined): string | null {
  const line = description?.replace(/\r\n?/g, "\n").split("\n").find((part) => part.trim().length > 0);
  return line?.trim() || null;
}

export function validateTitle(title: string): string | null {
  const normalized = title.trim();
  if (!normalized) return "Title is empty";
  if ([...normalized].length > 100) return "Title exceeds YouTube's 100-character limit";
  return null;
}
