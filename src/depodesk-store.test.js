import { describe, it, expect } from "vitest";
import {
  matchesExhibitQuery,
  nextExhibitNumber,
  usedExhibitNumbers,
  sanitizeCases,
} from "./depodesk-store";

// ── The crash that motivated this suite ──────────────────────────────
// An UNMARKED exhibit has label === null. The exhibit-list filter used to
// call e.label.toLowerCase() unguarded, so typing a single character with
// any unmarked exhibit in the list white-screened the entire app. It
// survived every round of manual testing because the seed data always has
// labels — only user-created exhibits are null.
describe("matchesExhibitQuery — null/missing field guards", () => {
  // NOTE: the query must NOT match the name. `name` is tested first, so a
  // matching name short-circuits before `label` is ever touched — which is
  // why a naive test passes against the buggy code. The real-world crash was
  // typing a term that doesn't match this exhibit.
  it("does not throw on an unmarked exhibit (label: null) when the name misses", () => {
    const unmarked = { id: 1, name: "Business Filing Details", label: null, tags: [] };
    expect(() => matchesExhibitQuery(unmarked, "indemnification")).not.toThrow();
    expect(matchesExhibitQuery(unmarked, "indemnification")).toBe(false);
  });

  it("still matches an unmarked exhibit by name", () => {
    const unmarked = { id: 1, name: "Business Filing Details", label: null, tags: [] };
    expect(matchesExhibitQuery(unmarked, "business")).toBe(true);
  });

  it("does not throw when tags are missing entirely and name/label miss", () => {
    const noTags = { id: 2, name: "Lease", label: "Exhibit 1" };
    expect(() => matchesExhibitQuery(noTags, "zzz")).not.toThrow();
    expect(matchesExhibitQuery(noTags, "zzz")).toBe(false);
  });

  it("does not throw when name is missing, or on a null exhibit", () => {
    expect(() => matchesExhibitQuery({ label: "Exhibit 2" }, "x")).not.toThrow();
    expect(() => matchesExhibitQuery(null, "x")).not.toThrow();
    expect(matchesExhibitQuery(null, "x")).toBe(false);
  });

  it("tolerates a null entry inside tags", () => {
    const weird = { name: "A", label: null, tags: [null, "contract"] };
    expect(() => matchesExhibitQuery(weird, "contract")).not.toThrow();
    expect(matchesExhibitQuery(weird, "contract")).toBe(true);
  });
});

describe("matchesExhibitQuery — matching behaviour", () => {
  const ex = { name: "Employment Agreement", label: "Exhibit 4", tags: ["contract", "HR"] };

  it("is case-insensitive across name, label and tags", () => {
    expect(matchesExhibitQuery(ex, "EMPLOYMENT")).toBe(true);
    expect(matchesExhibitQuery(ex, "exhibit 4")).toBe(true);
    expect(matchesExhibitQuery(ex, "HR")).toBe(true);
    expect(matchesExhibitQuery(ex, "hr")).toBe(true);
  });

  it("matches substrings, not just whole words", () => {
    expect(matchesExhibitQuery(ex, "ployment")).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(matchesExhibitQuery(ex, "indemnification")).toBe(false);
  });

  it("treats an empty query as matching everything (unfiltered list)", () => {
    expect(matchesExhibitQuery(ex, "")).toBe(true);
    expect(matchesExhibitQuery(ex, undefined)).toBe(true);
  });
});

// ── Exhibit numbering ────────────────────────────────────────────────
// Numbers are case-wide (exhibits are reused across depositions in a
// case), so the next number must consider the library AND every depo.
describe("nextExhibitNumber", () => {
  it("starts at 1 when nothing is marked", () => {
    expect(nextExhibitNumber({ library: [], depositions: [] })).toBe(1);
    expect(nextExhibitNumber({})).toBe(1);
    expect(nextExhibitNumber(null)).toBe(1);
  });

  it("continues past the highest number anywhere in the case", () => {
    const c = {
      library: [{ exhibitNum: 2 }, { exhibitNum: null }],
      depositions: [
        { exhibits: [{ exhibitNum: 5 }] },
        { exhibits: [{ exhibitNum: 3 }, { exhibitNum: null }] },
      ],
    };
    expect(nextExhibitNumber(c)).toBe(6);
  });

  it("does not renumber into a gap (numbers are never reused)", () => {
    // Exhibit 2 was deleted; the next mark must still be 4, because
    // "Exhibit 2" may already be in a transcript.
    const c = { library: [{ exhibitNum: 1 }, { exhibitNum: 3 }], depositions: [] };
    expect(nextExhibitNumber(c)).toBe(4);
  });

  it("ignores depositions with no exhibits array", () => {
    const c = { library: [{ exhibitNum: 1 }], depositions: [{}, { exhibits: null }] };
    expect(() => nextExhibitNumber(c)).not.toThrow();
    expect(nextExhibitNumber(c)).toBe(2);
  });
});

describe("usedExhibitNumbers", () => {
  const c = {
    library: [{ id: 1, exhibitNum: 1 }],
    depositions: [{ exhibits: [{ id: 2, exhibitNum: 2 }, { id: 3, exhibitNum: null }] }],
  };

  it("collects every assigned number in the case", () => {
    expect(usedExhibitNumbers(c).sort()).toEqual([1, 2]);
  });

  it("excludes the exhibit being renumbered (so it can keep its own number)", () => {
    expect(usedExhibitNumbers(c, 2)).toEqual([1]);
  });
});

// ── Persistence ──────────────────────────────────────────────────────
describe("sanitizeCases", () => {
  it("strips transient fileUrl blobs but keeps the durable file_path", () => {
    const cases = [{
      id: "case-1",
      library: [{ id: 1, fileUrl: "blob:http://x/abc", file_path: "uuid/1.pdf" }],
      depositions: [{ id: "d1", exhibits: [{ id: 2, fileUrl: "blob:http://x/def", file_path: "uuid/2.pdf" }] }],
    }];
    const out = sanitizeCases(cases);
    expect(out[0].library[0].fileUrl).toBeNull();
    expect(out[0].library[0].file_path).toBe("uuid/1.pdf");
    expect(out[0].depositions[0].exhibits[0].fileUrl).toBeNull();
    expect(out[0].depositions[0].exhibits[0].file_path).toBe("uuid/2.pdf");
  });

  it("does not mutate the input", () => {
    const cases = [{ id: "c", library: [{ id: 1, fileUrl: "blob:x" }], depositions: [] }];
    sanitizeCases(cases);
    expect(cases[0].library[0].fileUrl).toBe("blob:x");
  });

  it("handles cases with no library or depositions", () => {
    expect(() => sanitizeCases([{ id: "c" }])).not.toThrow();
    expect(sanitizeCases([{ id: "c" }])[0].library).toEqual([]);
  });
});
