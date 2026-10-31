import books from "./home-token-books-data.json" with { type: "json" };
/** Reference editions from dsh-claude-style's home-figures.ts. Tokenizers and editions
 * vary; collection estimates and their sources are recorded in the data file. */
export function tokenBook(tokens: number | null | undefined, pick: number) {
  if (tokens == null || !Number.isFinite(tokens) || tokens < books[0].tokens) return null;
  const seed = Number.isFinite(pick) ? Math.max(0, Math.min(1, pick)) : 0;
  let index = Math.min(books.length - 1, Math.floor(seed * books.length));
  while (index >= 0 && tokens < books[index].tokens) index--;
  if (index < 0) return null;
  const book = books[index];
  return { ...book, count: Math.round(tokens / book.tokens) };
}
