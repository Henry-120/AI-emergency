import { describe, expect, it } from "vitest";
import { parseThemePreference } from "./themeService";

describe("parseThemePreference", () => {
  it("認得日間與夜間", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
  });

  it("沒存過或不認得的值都當作自動", () => {
    expect(parseThemePreference(null)).toBe("auto");
    expect(parseThemePreference("")).toBe("auto");
    expect(parseThemePreference("system")).toBe("auto");
  });
});
