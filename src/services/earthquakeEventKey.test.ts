import { describe, expect, it } from "vitest";
import { getEarthquakeEventKey, SIMULATED_EARTHQUAKE_KEY } from "./earthquakeEventKey";

describe("getEarthquakeEventKey", () => {
  it("uses one isolated key for simulated earthquakes, regardless of generated time", () => {
    const first = getEarthquakeEventKey({ simulated: true, time: "2026-10-28T10:00:00Z" });
    const second = getEarthquakeEventKey({ simulated: true, time: "2026-10-29T12:00:00Z" });

    expect(first).toBe(SIMULATED_EARTHQUAKE_KEY);
    expect(second).toBe(first);
  });

  it("combines the CWA report number with origin time", () => {
    expect(getEarthquakeEventKey({ id: "115000", time: "2026-10-28T10:00:00+08:00" }))
      .toBe("cwa:115000:2026-10-28T10:00:00+08:00");
  });

  it("keeps reused CWA report numbers at different origin times separate", () => {
    const first = getEarthquakeEventKey({ id: "115000", time: "2026-10-28T10:00:00+08:00" });
    const second = getEarthquakeEventKey({ id: "115000", time: "2026-10-28T11:00:00+08:00" });

    expect(first).not.toBe(second);
  });

  it("leaves incomplete official identifiers to the fallback strategy", () => {
    expect(getEarthquakeEventKey({ id: "115000" })).toBeUndefined();
    expect(getEarthquakeEventKey({ time: "2026-10-28T10:00:00+08:00" })).toBeUndefined();
  });
});
