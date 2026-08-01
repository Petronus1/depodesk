import { describe, it, expect } from "vitest";
import { isUuid } from "./depodesk-supabase";

// session_events.exhibit_id is a uuid FK, but the attorney app's local
// exhibit ids are numbers (Date.now()). Writing a local id there fails the
// insert and the audit event is LOST — which matters, because that log is
// the deposition record. logSessionEvent nulls anything that isn't a uuid.
describe("isUuid — audit-log foreign-key guard", () => {
  it("accepts a real uuid", () => {
    expect(isUuid("edf4632d-071f-4aa3-a4b2-8ed139291357")).toBe(true);
  });

  it("accepts uppercase uuids", () => {
    expect(isUuid("EDF4632D-071F-4AA3-A4B2-8ED139291357")).toBe(true);
  });

  it("rejects the app's local numeric exhibit ids", () => {
    expect(isUuid(1785105355022)).toBe(false);   // Date.now()
    expect(isUuid("1785105355022")).toBe(false);
    expect(isUuid(1)).toBe(false);               // seed ids
  });

  it("rejects the OC-presented id format (oc-<timestamp>)", () => {
    expect(isUuid("oc-1784604894816")).toBe(false);
  });

  it("rejects derived storage-ish ids", () => {
    expect(isUuid("901-stamped")).toBe(false);
    expect(isUuid("901-witness-marked")).toBe(false);
  });

  it("rejects null, undefined and empty", () => {
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid("")).toBe(false);
  });

  it("rejects malformed uuids", () => {
    expect(isUuid("edf4632d-071f-4aa3-a4b2")).toBe(false);            // too short
    expect(isUuid("edf4632d071f4aa3a4b28ed139291357")).toBe(false);   // no dashes
    expect(isUuid("zzzzzzzz-071f-4aa3-a4b2-8ed139291357")).toBe(false); // non-hex
  });
});
