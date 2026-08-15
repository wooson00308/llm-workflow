import { describe, expect, it } from "vitest";
import { declarationsOf } from "../../../test/cssRules";

describe("작업 상세 레이아웃", () => {
  it("제목 설명과 상태 배지 아래에서 두 요약 카드가 숨을 고른다", () => {
    expect(declarationsOf(".task-detail-view > .task-detail-overview").get("margin-top")).toBe("10px");
  });
});
