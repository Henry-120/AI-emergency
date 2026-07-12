import { BACKEND } from "./backend";
import { RoomRiskAnalysis } from "../types";

export async function analyzeRoomRisk(
  image: File,
  sensorContext: string,
): Promise<RoomRiskAnalysis> {
  const form = new FormData();
  form.append("image", image);
  form.append("sensor_context", sensorContext);

  const response = await fetch(`${BACKEND}/api/room-risk/analyze`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "房間風險分析失敗");
  }

  return (await response.json()) as RoomRiskAnalysis;
}
