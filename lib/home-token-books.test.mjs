import assert from "node:assert/strict";
import test from "node:test";
import { tokenBook } from "./home-token-books.ts";
import books from "./home-token-books-data.json" with { type: "json" };
test("large totals do not always select 1984; a fixed pick stays stable across ranges", () => {
  const total = 29835 * 136278;
  assert.notEqual(tokenBook(total, 0.1).key, tokenBook(total, 0.95).key);
  assert.equal(tokenBook(total, 0.55).key, tokenBook(total / 10, 0.55).key);
  assert.equal(tokenBook(total, 0).count, Math.round(total / 7607));
});
test("unknown, invalid and small totals do not claim a whole book", () => {
  for (const value of [null, undefined, NaN, Infinity, -1, 7606]) assert.equal(tokenBook(value, .5), null);
  assert.equal(tokenBook(7607, .99).count, 1);
});
test("the catalog remains ordered, unique and every book can be selected", () => {
  assert.equal(new Set(books.map(book => book.key)).size, books.length);
  for (const [index, book] of books.entries()) {
    assert.ok(Number.isInteger(book.tokens) && book.tokens > 0);
    if (index > 0) assert.ok(book.tokens >= books[index - 1].tokens, `${book.key} is out of order`);
    assert.ok(book.title.zh && book.title.en);
    const result = tokenBook(book.tokens * 3, (index + .5) / books.length);
    assert.equal(result.key, book.key);
    assert.equal(result.count, 3);
  }
});
test("collections distinguish the Holmes canon from Adventures and keep whole-series lengths", () => {
  assert.ok(books.length >= 60);
  const holmes = books.find((book) => book.key.endsWith("sherlockComplete"));
  const adventures = books.find((book) => book.key.endsWith("homeBookSherlockHolmes"));
  assert.equal(holmes.collection, true);
  assert.equal(adventures.collection, false);
  assert.ok(holmes.tokens > adventures.tokens * 5);
  for (const key of ["homeBookHarryPotter", "homeBookLordOfTheRings", "threeBodyComplete", "fourClassics", "sherlockComplete"]) {
    const index = books.findIndex((book) => book.key.endsWith(key));
    const result = tokenBook(books[index].tokens * 2, (index + .5) / books.length);
    assert.equal(result.collection, true);
    assert.equal(result.count, 2);
  }
});
