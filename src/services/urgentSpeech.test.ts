import { describe, expect, it } from "vitest";
import { toUrgentSpeech } from "./urgentSpeech";

describe("toUrgentSpeech", () => {
  it("移除句中逗號", () => {
    expect(toUrgentSpeech("請說出你的狀況，以及周遭危險")).toBe(
      "請說出你的狀況以及周遭危險",
    );
  });

  it("句末標點換成停頓較短的頓號", () => {
    expect(toUrgentSpeech("強震。你還好嗎？快回報")).toBe(
      "強震、你還好嗎、快回報",
    );
  });

  it("移除結尾標點，不多等一拍", () => {
    expect(toUrgentSpeech("立即趴下。")).toBe("立即趴下");
    expect(toUrgentSpeech("你還好嗎？")).toBe("你還好嗎");
  });

  it("合併連續停頓", () => {
    expect(toUrgentSpeech("強震！！你還好嗎")).toBe("強震、你還好嗎");
  });

  it("不切開小數點（規模 6.5 不能變成「六、五」）", () => {
    expect(toUrgentSpeech("偵測到規模 6.5 強震。你還好嗎？")).toBe(
      "偵測到規模 6.5 強震、你還好嗎",
    );
  });

  it("句尾的英文句點仍然移除", () => {
    expect(toUrgentSpeech("Magnitude 6.5.")).toBe("Magnitude 6.5");
  });

  it("空字串安全", () => {
    expect(toUrgentSpeech("")).toBe("");
  });
});
