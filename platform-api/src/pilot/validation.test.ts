import { describe, expect, it } from "vitest";
import { validateDraft, validateCommand, readListQuery } from "./validation.js";
import { command, validDraft } from "./testSupport.js";
describe("pilot command boundary", () => {
  it("rejectsOwnerStatusAndUrlsInsteadOfAcceptingServerFields", () => {
    for (const extra of [
      { ownerId: "other" },
      { status: "success" },
      { materialRefs: [{ kind: "image", url: "https://attacker.test" }] },
    ])
      expect(() => validateDraft({ ...validDraft(), ...extra })).toThrow();
  });
  it("allowsIncompleteDraftButRejectsUnboundedValues", () => {
    expect(
      validateDraft({
        ...validDraft(),
        fullScore: null,
        writingRequirement: "",
      }).fullScore,
    ).toBeNull();
    for (const extra of [
      { taskName: "x".repeat(2001) },
      { writingRequirement: "x".repeat(10001) },
      { fullScore: NaN },
      { dimensions: Array(11).fill(validDraft().dimensions[0]) },
    ])
      expect(() => validateDraft({ ...validDraft(), ...extra })).toThrow();
  });
  it("requiresStableCommandAndExpectedRevisionForEdits", () => {
    expect(() => validateCommand(command({}), true)).toThrow();
    for (const value of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1])
      expect(() => validateCommand(command({}, value), true)).toThrow();
    expect(validateCommand(command({}, 2), true).expectedRevision).toBe(2);
    expect(() =>
      validateCommand({ ...command({}), owner: "other" }, false),
    ).toThrow();
  });
  it("boundsListSizeAndRejectsMalformedCursor", () => {
    expect(readListQuery({})).toEqual({ limit: 50 });
    for (const query of [{ limit: 0 }, { limit: 51 }, { cursor: "not-an-id" }])
      expect(() => readListQuery(query)).toThrow();
  });
});
