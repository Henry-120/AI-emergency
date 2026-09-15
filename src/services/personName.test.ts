import { describe, expect, it } from "vitest";
import { joinFullName, splitFullName } from "./personName";

describe("splitFullName", () => {
  it("中文名取第一個字當姓", () => {
    expect(splitFullName("陳墨")).toEqual({ lastName: "陳", firstName: "墨" });
    expect(splitFullName("王小明")).toEqual({ lastName: "王", firstName: "小明" });
  });

  it("認得複姓", () => {
    expect(splitFullName("歐陽娜娜")).toEqual({ lastName: "歐陽", firstName: "娜娜" });
    expect(splitFullName("張簡志明")).toEqual({ lastName: "張簡", firstName: "志明" });
  });

  it("兩個字的名字不當成複姓", () => {
    expect(splitFullName("歐陽")).toEqual({ lastName: "歐", firstName: "陽" });
  });

  it("非純中文不亂拆，整串放進名", () => {
    expect(splitFullName("John Smith")).toEqual({ lastName: "", firstName: "John Smith" });
    expect(splitFullName("")).toEqual({ lastName: "", firstName: "" });
  });
});

describe("joinFullName", () => {
  it("中文直接相連", () => {
    expect(joinFullName("陳", "墨")).toBe("陳墨");
  });

  it("英文名中間空一格", () => {
    expect(joinFullName("Smith", "John")).toBe("Smith John");
  });

  it("只填一邊也能組", () => {
    expect(joinFullName("", "John Smith")).toBe("John Smith");
    expect(joinFullName(" 王 ", "")).toBe("王");
  });

  it("拆了再組回去不變", () => {
    for (const name of ["陳墨", "歐陽娜娜", "John Smith", "阿道·巴辣夫"]) {
      const { lastName, firstName } = splitFullName(name);
      expect(joinFullName(lastName, firstName)).toBe(name);
    }
  });
});
