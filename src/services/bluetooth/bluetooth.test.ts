/**
 * 藍牙模組純函式測試
 *
 * 這裡只測「不需要真實藍牙硬體」的邏輯：封包驗證、分片與重組、識別碼。
 *
 * 掃描、連線、廣播、notify 推送等牽涉 CoreBluetooth 的行為**無法在此驗證**，
 * 模擬器也跑不出來——那些必須用實機（且部分需要兩支手機）演練。
 */

import { describe, expect, it } from "vitest";
import {
  FrameReassembler,
  FRAME_HEADER_BYTES,
  generateFrameId,
  parseFrame,
  splitIntoFrames,
} from "./bluetoothChunking";
import { isValidMessage, parseIncomingMessage } from "./bluetoothValidation";
import { generateLocalId, isValidLocalId } from "./bluetoothIdentity";
import type { OutgoingMessage } from "./bluetoothTypes";

const NOW = Date.UTC(2026, 6, 13);

function validMessage(overrides: Partial<OutgoingMessage> = {}): OutgoingMessage {
  return {
    from: "AB2CD3",
    text: "我在三樓，腳被壓住",
    timestamp: NOW - 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 封包驗證：這是接收陌生人封包時唯一的把關點
// ---------------------------------------------------------------------------

describe("isValidMessage", () => {
  it("接受合法訊息", () => {
    expect(isValidMessage(validMessage(), NOW)).toBe(true);
  });

  it("接受帶合法座標的訊息", () => {
    const msg = validMessage({ location: { lat: 25.03, lng: 121.56 } });
    expect(isValidMessage(msg, NOW)).toBe(true);
  });

  it.each([
    ["null", null],
    ["非物件", "字串"],
    ["缺 from", { text: "hi", timestamp: NOW }],
    ["from 是空字串", validMessage({ from: "" })],
    ["缺 text", { from: "AB2CD3", timestamp: NOW }],
    ["text 不是字串", { from: "AB2CD3", text: 123, timestamp: NOW }],
    ["缺 timestamp", { from: "AB2CD3", text: "hi" }],
    ["timestamp 是 NaN", validMessage({ timestamp: NaN })],
    ["timestamp 太古老", validMessage({ timestamp: 0 })],
  ])("拒絕：%s", (_label, input) => {
    expect(isValidMessage(input, NOW)).toBe(false);
  });

  it("拒絕未來時間戳（防止時鐘竄改造成排序錯亂）", () => {
    const farFuture = validMessage({ timestamp: NOW + 48 * 60 * 60 * 1000 });
    expect(isValidMessage(farFuture, NOW)).toBe(false);
  });

  it("拒絕超出範圍的座標", () => {
    expect(isValidMessage(validMessage({ location: { lat: 999, lng: 0 } }), NOW)).toBe(false);
    expect(isValidMessage(validMessage({ location: { lat: 0, lng: 999 } }), NOW)).toBe(false);
  });

  it("拒絕座標欄位型別錯誤的訊息", () => {
    const bad = { ...validMessage(), location: { lat: "25.03", lng: 121.56 } };
    expect(isValidMessage(bad, NOW)).toBe(false);
  });

  it("拒絕過長的訊息文字", () => {
    expect(isValidMessage(validMessage({ text: "字".repeat(501) }), NOW)).toBe(false);
  });
});

describe("parseIncomingMessage", () => {
  it("解析合法 JSON", () => {
    const msg = validMessage();
    expect(parseIncomingMessage(JSON.stringify(msg), NOW)).toEqual(msg);
  });

  it("非 JSON 回傳 null，不拋錯（來源是不可信的裝置）", () => {
    expect(parseIncomingMessage("這不是 JSON", NOW)).toBeNull();
    expect(parseIncomingMessage("", NOW)).toBeNull();
  });

  it("JSON 合法但欄位不合法時回傳 null", () => {
    expect(parseIncomingMessage(JSON.stringify({ from: "X" }), NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 分片與重組
// ---------------------------------------------------------------------------

describe("splitIntoFrames / parseFrame", () => {
  const encoder = new TextEncoder();

  it("短訊息只切成一片", () => {
    const payload = encoder.encode("hi");
    const frames = splitIntoFrames(generateFrameId(), payload, 180);
    expect(frames).toHaveLength(1);

    const parsed = parseFrame(frames[0]);
    expect(parsed?.index).toBe(0);
    expect(parsed?.total).toBe(1);
  });

  it("空訊息仍會產生一片（否則接收端永遠等不到）", () => {
    const frames = splitIntoFrames(generateFrameId(), new Uint8Array(0), 180);
    expect(frames).toHaveLength(1);
  });

  it("長訊息切成多片，且每片都不超過上限", () => {
    const payload = encoder.encode("字".repeat(200)); // 600 bytes
    const frames = splitIntoFrames(generateFrameId(), payload, 180);

    expect(frames.length).toBeGreaterThan(1);
    for (const frame of frames) {
      expect(frame.byteLength).toBeLessThanOrEqual(180);
    }
  });

  it("所有分片共用同一個 frameId，索引依序遞增", () => {
    const id = generateFrameId();
    const frames = splitIntoFrames(id, encoder.encode("字".repeat(200)), 180);

    frames.forEach((frame, i) => {
      const parsed = parseFrame(frame);
      expect(parsed?.frameId).toBe(id);
      expect(parsed?.index).toBe(i);
      expect(parsed?.total).toBe(frames.length);
    });
  });

  it("訊息超過總長上限時拋錯", () => {
    const huge = new Uint8Array(3000);
    expect(() => splitIntoFrames(generateFrameId(), huge, 180)).toThrow();
  });

  it("parseFrame 對損毀資料回傳 null，不拋錯", () => {
    expect(parseFrame(new Uint8Array(3))).toBeNull(); // 比標頭還短
    expect(parseFrame(new Uint8Array(FRAME_HEADER_BYTES))).toBeNull(); // version=0
  });

  it("parseFrame 拒絕 index >= total 的封包", () => {
    const frames = splitIntoFrames(generateFrameId(), encoder.encode("hi"), 180);
    const bad = new Uint8Array(frames[0]);
    bad[9] = 5; // index
    bad[10] = 2; // total
    expect(parseFrame(bad)).toBeNull();
  });
});

describe("FrameReassembler", () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  /** 把訊息切片後依序（或依指定順序）餵給重組器 */
  function feed(
    reassembler: FrameReassembler,
    text: string,
    opts: { source?: string; shuffle?: boolean; now?: number } = {},
  ): Uint8Array | null {
    const { source = "peer-1", shuffle = false, now } = opts;
    const frames = splitIntoFrames(generateFrameId(), encoder.encode(text), 40);
    const order = shuffle ? [...frames].reverse() : frames;

    let result: Uint8Array | null = null;
    for (const frame of order) {
      const parsed = parseFrame(frame);
      if (!parsed) throw new Error("測試資料有誤");
      const out = reassembler.add(source, parsed, now);
      if (out) result = out;
    }
    return result;
  }

  it("重組多片訊息，內容與原文完全一致（含中文）", () => {
    const text = "我被困在三樓的樓梯間，腳被倒下來的櫃子壓住，需要幫忙。";
    const result = feed(new FrameReassembler(), text);

    expect(result).not.toBeNull();
    expect(decoder.decode(result!)).toBe(text);
  });

  it("分片亂序抵達也能正確重組", () => {
    const text = "我被困在三樓的樓梯間，腳被壓住了。";
    const result = feed(new FrameReassembler(), text, { shuffle: true });

    expect(decoder.decode(result!)).toBe(text);
  });

  it("中文在 byte 邊界被切開仍能還原（不可在中途做 UTF-8 解碼）", () => {
    // 「災」的 UTF-8 是 3 bytes，切點必然落在某些字的中間
    const text = "災".repeat(50);
    const result = feed(new FrameReassembler(), text);

    expect(decoder.decode(result!)).toBe(text);
  });

  it("尚未收齊時回傳 null", () => {
    const reassembler = new FrameReassembler();
    const frames = splitIntoFrames(generateFrameId(), encoder.encode("字".repeat(50)), 40);

    const first = parseFrame(frames[0])!;
    expect(reassembler.add("peer-1", first)).toBeNull();
    expect(reassembler.pendingCount).toBe(1);
  });

  it("不同來源的分片不會混在一起", () => {
    const reassembler = new FrameReassembler();
    const a = feed(reassembler, "來自 A 的訊息內容需要夠長才會被切成多片喔喔喔", { source: "A" });
    const b = feed(reassembler, "來自 B 的訊息內容也一樣要夠長才會被切片喔喔喔", { source: "B" });

    expect(decoder.decode(a!)).toContain("來自 A");
    expect(decoder.decode(b!)).toContain("來自 B");
  });

  it("逾時的殘片會被清掉（惡意端只送第一片就是資源耗盡攻擊）", () => {
    const reassembler = new FrameReassembler(10_000);
    const frames = splitIntoFrames(generateFrameId(), encoder.encode("字".repeat(50)), 40);

    reassembler.add("peer-1", parseFrame(frames[0])!, 1_000);
    expect(reassembler.pendingCount).toBe(1);

    // 超過逾時後的任何一次 add 都會觸發清理
    reassembler.add("peer-2", parseFrame(frames[0])!, 20_000);
    expect(reassembler.pendingCount).toBe(1); // 只剩 peer-2 的，peer-1 已被清掉
  });

  it("每片都重複送兩次，訊息仍只被組出一次且內容正確", () => {
    const reassembler = new FrameReassembler();
    const text = "重複分片測試，內容要夠長才會被切成多片。";
    const frames = splitIntoFrames(generateFrameId(), encoder.encode(text), 40);

    const completions: Uint8Array[] = [];
    for (const frame of frames) {
      const parsed = parseFrame(frame)!;
      // 每一片都故意送兩次
      for (const out of [reassembler.add("peer-1", parsed), reassembler.add("peer-1", parsed)]) {
        if (out) completions.push(out);
      }
    }

    // 關鍵：只能組出一次。若沒有去重，重送的最後一片會讓訊息被送出兩次。
    expect(completions).toHaveLength(1);
    expect(decoder.decode(completions[0])).toBe(text);
  });

  it("重複的單片訊息只會被送出一次", () => {
    const reassembler = new FrameReassembler();
    const frames = splitIntoFrames(generateFrameId(), encoder.encode("救命"), 180);
    const parsed = parseFrame(frames[0])!;

    expect(reassembler.add("peer-1", parsed)).not.toBeNull();
    expect(reassembler.add("peer-1", parsed)).toBeNull(); // 重複 → 忽略
  });
});

// ---------------------------------------------------------------------------
// 端到端（純邏輯）：送出 → 分片 → 重組 → 驗證
// ---------------------------------------------------------------------------

describe("訊息的完整往返", () => {
  it("長中文訊息經分片、重組、驗證後與原訊息一致", () => {
    const original = validMessage({
      text: "我被困在民生路 12 號的三樓，鐵門變形打不開，屋內有兩個人，其中一位流血。".repeat(2),
      location: { lat: 25.0339, lng: 121.5645 },
    });

    // 送出端
    const payload = new TextEncoder().encode(JSON.stringify(original));
    const frames = splitIntoFrames(generateFrameId(), payload, 60);
    expect(frames.length).toBeGreaterThan(1);

    // 接收端
    const reassembler = new FrameReassembler();
    let complete: Uint8Array | null = null;
    for (const frame of frames) {
      complete = reassembler.add("peer-1", parseFrame(frame)!, NOW) ?? complete;
    }

    const json = new TextDecoder().decode(complete!);
    expect(parseIncomingMessage(json, NOW)).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// 本機識別碼
// ---------------------------------------------------------------------------

describe("localId", () => {
  it("產生的識別碼符合格式", () => {
    for (let i = 0; i < 50; i++) {
      expect(isValidLocalId(generateLocalId())).toBe(true);
    }
  });

  it("不含容易混淆的字元（I / O / 0 / 1）", () => {
    const ids = Array.from({ length: 100 }, () => generateLocalId()).join("");
    expect(ids).not.toMatch(/[IO01]/);
  });

  it("拒絕格式不符的識別碼（含舊版的 4 字元）", () => {
    expect(isValidLocalId("ABCD")).toBe(false); // 舊版長度
    expect(isValidLocalId("")).toBe(false);
    expect(isValidLocalId("abcdef")).toBe(false); // 小寫
    expect(isValidLocalId(null)).toBe(false);
  });
});
