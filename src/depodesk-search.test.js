import { describe, it, expect } from "vitest";
import { highlightSnippet } from "./depodesk-search";

// Postgres ts_headline returns matches wrapped in « … » (configured as
// StartSel/StopSel in search_exhibit_text). highlightSnippet turns those
// into <mark> nodes. Legal documents are full of punctuation, quotes and
// stray angle brackets, so the parser has to be unfussy.
describe("highlightSnippet", () => {
  const textOf = nodes => (nodes || []).map(n => (typeof n === "string" ? n : n.props.children)).join("");
  const marks  = nodes => (nodes || []).filter(n => typeof n !== "string");

  it("returns null for empty input", () => {
    expect(highlightSnippet("")).toBeNull();
    expect(highlightSnippet(undefined)).toBeNull();
  });

  it("returns plain text unchanged when there are no delimiters", () => {
    const out = highlightSnippet("no highlights here");
    expect(textOf(out)).toBe("no highlights here");
    expect(marks(out)).toHaveLength(0);
  });

  it("wraps a single match and preserves the surrounding text", () => {
    const out = highlightSnippet("the «indemnify» clause");
    expect(textOf(out)).toBe("the indemnify clause");
    expect(marks(out)).toHaveLength(1);
    expect(marks(out)[0].props.children).toBe("indemnify");
  });

  it("handles several matches in one snippet", () => {
    const out = highlightSnippet("«lease» and «lease» again");
    expect(marks(out)).toHaveLength(2);
    expect(textOf(out)).toBe("lease and lease again");
  });

  it("handles a match at the very start and very end", () => {
    const out = highlightSnippet("«start» middle «end»");
    expect(marks(out)).toHaveLength(2);
    expect(textOf(out)).toBe("start middle end");
  });

  it("does not choke on an unmatched opening delimiter", () => {
    expect(() => highlightSnippet("dangling « delimiter")).not.toThrow();
    expect(textOf(highlightSnippet("dangling « delimiter"))).toContain("dangling");
  });

  it("preserves legal punctuation and quotes around a match", () => {
    const out = highlightSnippet('Section 4.2 (“«Indemnification»”), as amended;');
    expect(textOf(out)).toBe('Section 4.2 (“Indemnification”), as amended;');
    expect(marks(out)).toHaveLength(1);
  });

  it("gives every node a key so React does not warn on lists", () => {
    const out = highlightSnippet("«a» b «c»");
    marks(out).forEach(m => expect(m.key).not.toBeNull());
  });
});
