import { describe, expect, it } from "vitest";
import { mdToWa } from "@/lib/waMarkdown";

describe("mdToWa", () => {
  it("turns Markdown bold, headings and strike into WhatsApp markup", () => {
    expect(mdToWa("## Description\nA loan for a **HONDA NEW BRIO RS** with ~~old~~ price.")).toBe(
      "*Description*\nA loan for a *HONDA NEW BRIO RS* with ~old~ price.",
    );
  });
  it("leaves WhatsApp markup alone", () => {
    expect(mdToWa("*bold* _italic_ ~strike~\n- item")).toBe("*bold* _italic_ ~strike~\n- item");
  });
  it("flattens links and drops rules", () => {
    expect(mdToWa("see [site](https://x.id)\n---\nend")).toBe("see site (https://x.id)\n\nend");
  });
});
