import { describe, expect, it } from "vitest";
import { FOLLOW_UP_LABEL, labelSpecDecisions, specDecisionLabel } from "./specDecisionLabels";

describe("specDecisionLabel", () => {
  it("splits a revision request by whether an approval came before it", () => {
    expect(specDecisionLabel("revision_requested", false)).toBe("수정 요청");
    expect(specDecisionLabel("revision_requested", true)).toBe(FOLLOW_UP_LABEL);
  });

  it("names approval and rejection the same way wherever they stand", () => {
    expect(specDecisionLabel("approved", false)).toBe("승인");
    expect(specDecisionLabel("approved", true)).toBe("승인");
    expect(specDecisionLabel("rejected", false)).toBe("폐기");
    expect(specDecisionLabel("rejected", true)).toBe("폐기");
  });

  it("hands an off-contract outcome back instead of dropping it", () => {
    expect(specDecisionLabel("withdrawn", false)).toBe("withdrawn");
  });
});

describe("labelSpecDecisions", () => {
  it("calls the revision request after an approval a follow-up planning request", () => {
    expect(
      labelSpecDecisions([
        { kind: "approved", at: "2026-08-01T00:00:00Z" },
        { kind: "revision_requested", at: "2026-08-02T00:00:00Z" },
      ]),
    ).toEqual([
      { kind: "approved", at: "2026-08-01T00:00:00Z", label: "승인" },
      { kind: "revision_requested", at: "2026-08-02T00:00:00Z", label: FOLLOW_UP_LABEL },
    ]);
  });

  it("calls a revision request with nothing before it a revision request", () => {
    expect(labelSpecDecisions([{ kind: "revision_requested", at: "2026-08-01T00:00:00Z" }])).toEqual([
      { kind: "revision_requested", at: "2026-08-01T00:00:00Z", label: "수정 요청" },
    ]);
  });

  it("does not let an approval rename the decision standing before it", () => {
    // 근거는 "그 항목 앞에 승인이 있었는가"다. 뒤에 온 승인은 앞 항목의 이름을 바꾸지 않는다.
    expect(
      labelSpecDecisions([
        { kind: "revision_requested", at: "2026-08-01T00:00:00Z" },
        { kind: "approved", at: "2026-08-02T00:00:00Z" },
        { kind: "revision_requested", at: "2026-08-03T00:00:00Z" },
      ]).map((entry) => entry.label),
    ).toEqual(["수정 요청", "승인", FOLLOW_UP_LABEL]);
  });

  it("keeps the order it was given and answers an empty history with an empty list", () => {
    expect(labelSpecDecisions([])).toEqual([]);
  });
});
