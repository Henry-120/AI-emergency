import React, { useEffect, useRef, useState } from "react";
import { RoomRiskAnalysis, RoomRiskObject, RoomRiskZone } from "../../types";

const palette = {
  danger: {
    fill: "rgba(255, 103, 112, 0.38)",
    stroke: "#ff6770",
    soft: "#ffe4e6",
    text: "#7f1d2d",
  },
  caution: {
    fill: "rgba(255, 190, 77, 0.36)",
    stroke: "#ffbe4d",
    soft: "#fff3cf",
    text: "#713f12",
  },
  safe: {
    fill: "rgba(75, 211, 166, 0.32)",
    stroke: "#4bd3a6",
    soft: "#d9fff1",
    text: "#065f46",
  },
} as const;

const riskLabel = (risk: RoomRiskObject["risk"]) => {
  if (risk === "high") return "優先固定";
  if (risk === "medium") return "留意";
  return "低風險";
};

const zoneCaption = (zone: RoomRiskZone) => {
  if (zone.impactType === "topple") return "傾倒範圍";
  if (zone.impactType === "falling") return "掉落範圍";
  if (zone.impactType === "glass") return "碎片範圍";
  if (zone.impactType === "blocked_path") return "動線受阻";
  return "安全地面";
};

const toCanvasPoint = (point: { x: number; y: number }) => ({
  x: point.x * 1000,
  y: point.y * 1000,
});

const smoothClosedPath = (zone: RoomRiskZone) => {
  const points = zone.polygon.map(toCanvasPoint);
  if (points.length < 3) return "";

  const first = points[0];
  const last = points[points.length - 1];
  const start = {
    x: (first.x + last.x) / 2,
    y: (first.y + last.y) / 2,
  };

  let path = `M ${start.x} ${start.y}`;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const midpoint = {
      x: (point.x + next.x) / 2,
      y: (point.y + next.y) / 2,
    };
    path += ` Q ${point.x} ${point.y} ${midpoint.x} ${midpoint.y}`;
  });
  return `${path} Z`;
};

const zoneCenter = (zone: RoomRiskZone) => {
  const total = zone.polygon.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  const count = Math.max(zone.polygon.length, 1);
  return {
    x: (total.x / count) * 1000,
    y: (total.y / count) * 1000,
  };
};

const getSourceObject = (
  zone: RoomRiskZone,
  objects: RoomRiskObject[],
): RoomRiskObject | undefined =>
  objects.find((object) => object.label === zone.sourceObjectLabel);

function ArOverlay({ analysis }: { analysis: RoomRiskAnalysis }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      aria-label="地震家具風險 AR 疊圖"
    >
      <defs>
        <filter id="zone-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="8" stdDeviation="9" floodOpacity="0.22" />
        </filter>
        <filter id="label-shadow" x="-20%" y="-30%" width="140%" height="160%">
          <feDropShadow dx="0" dy="5" stdDeviation="6" floodOpacity="0.28" />
        </filter>
        <pattern
          id="danger-dots"
          width="28"
          height="28"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="8" cy="8" r="3.5" fill="rgba(255,255,255,0.65)" />
        </pattern>
        <pattern
          id="safe-lines"
          width="36"
          height="36"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(35)"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="36"
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="8"
          />
        </pattern>
      </defs>

      {analysis.zones.map((zone) => {
        const colors = palette[zone.type];
        const center = zoneCenter(zone);
        const source = getSourceObject(zone, analysis.objects);
        const sourcePoint = source
          ? {
              x: (source.bbox.x + source.bbox.width / 2) * 1000,
              y: (source.bbox.y + source.bbox.height) * 1000,
            }
          : null;
        const labelWidth = Math.min(300, Math.max(170, zone.label.length * 30));
        const labelX = Math.max(16, Math.min(984 - labelWidth, center.x - labelWidth / 2));
        const labelY = Math.max(20, Math.min(910, center.y - 38));

        return (
          <g key={zone.id}>
            {sourcePoint && (
              <>
                <path
                  d={`M ${sourcePoint.x} ${sourcePoint.y} Q ${(sourcePoint.x + center.x) / 2} ${Math.min(sourcePoint.y, center.y) - 45} ${center.x} ${center.y}`}
                  fill="none"
                  stroke="rgba(255,255,255,0.9)"
                  strokeWidth="7"
                  strokeDasharray="14 14"
                  strokeLinecap="round"
                />
                <circle
                  cx={sourcePoint.x}
                  cy={sourcePoint.y}
                  r="13"
                  fill={colors.stroke}
                  stroke="white"
                  strokeWidth="6"
                />
              </>
            )}

            <path
              d={smoothClosedPath(zone)}
              fill={colors.fill}
              stroke="rgba(255,255,255,0.92)"
              strokeWidth="18"
              strokeLinejoin="round"
              filter="url(#zone-shadow)"
            />
            <path
              d={smoothClosedPath(zone)}
              fill={
                zone.type === "safe"
                  ? "url(#safe-lines)"
                  : zone.type === "danger"
                    ? "url(#danger-dots)"
                    : "transparent"
              }
              stroke={colors.stroke}
              strokeWidth="9"
              strokeLinejoin="round"
            />

            <g filter="url(#label-shadow)">
              <rect
                x={labelX}
                y={labelY}
                width={labelWidth}
                height="76"
                rx="30"
                fill={colors.soft}
                stroke="rgba(255,255,255,0.95)"
                strokeWidth="7"
              />
              <circle
                cx={labelX + 35}
                cy={labelY + 38}
                r="12"
                fill={colors.stroke}
              />
              <text
                x={labelX + 58}
                y={labelY + 34}
                fill={colors.text}
                fontSize="27"
                fontWeight="800"
              >
                {zone.label.slice(0, 8)}
              </text>
              <text
                x={labelX + 58}
                y={labelY + 59}
                fill={colors.text}
                fontSize="19"
                fontWeight="600"
                opacity="0.72"
              >
                {zoneCaption(zone)}
              </text>
            </g>
          </g>
        );
      })}

      {analysis.objects.map((object, index) => {
        const x = object.bbox.x * 1000;
        const y = object.bbox.y * 1000;
        const width = object.bbox.width * 1000;
        const height = object.bbox.height * 1000;
        const colors =
          object.risk === "high"
            ? palette.danger
            : object.risk === "medium"
              ? palette.caution
              : palette.safe;

        return (
          <g key={`${object.label}-${index}`}>
            <path
              d={`M ${x + 18} ${y} H ${x} V ${y + 18} M ${x + width - 18} ${y} H ${x + width} V ${y + 18}`}
              fill="none"
              stroke={colors.stroke}
              strokeWidth="10"
              strokeLinecap="round"
            />
            <rect
              x={Math.max(10, x)}
              y={Math.max(10, y - 58)}
              width={Math.min(260, Math.max(140, object.label.length * 29))}
              height="48"
              rx="22"
              fill="rgba(15,23,42,0.86)"
              stroke={colors.stroke}
              strokeWidth="5"
            />
            <text
              x={Math.max(10, x) + 18}
              y={Math.max(10, y - 58) + 32}
              fill="white"
              fontSize="24"
              fontWeight="700"
            >
              {object.label.slice(0, 8)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function RoomRiskScanner({
  analysis,
  error,
  imageUrl,
  isAnalyzing,
  onCapture,
  onClose,
  onRetake,
}: {
  analysis: RoomRiskAnalysis | null;
  error: string;
  imageUrl: string;
  isAnalyzing: boolean;
  onCapture: (file: File) => void;
  onClose: () => void;
  onRetake: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);

  useEffect(() => {
    if (imageUrl) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraReady(false);
      return;
    }

    let cancelled = false;
    const startCamera = async () => {
      setCameraError("");
      setCameraReady(false);

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("此環境無法直接開啟相機，請改從相簿或系統相機選擇照片。");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
      } catch {
        setCameraError(
          window.isSecureContext
            ? "無法取得相機權限，請允許相機存取或改從相簿選擇照片。"
            : "相機即時預覽需要 HTTPS 或 localhost，請改從相簿選擇照片。",
        );
      }
    };

    startCamera();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [imageUrl]);

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(
          new File([blob], `room-scan-${Date.now()}.jpg`, {
            type: "image/jpeg",
          }),
        );
      },
      "image/jpeg",
      0.88,
    );
  };

  return (
    <section className="fixed inset-0 z-40 flex min-h-0 flex-col bg-[#07111f] safe-area-top">
      <div className="shrink-0 flex items-center justify-between border-b border-white/10 bg-[#07111f]/95 px-3 py-2 sm:px-4 sm:py-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">
            AR Floor Guide
          </div>
          <h2 className="text-base font-bold text-white">室內地震安全掃描</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 active:scale-95"
          aria-label="關閉房間風險掃描"
        >
          <i className="fas fa-times"></i>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain safe-area-bottom">
        <div className="mx-auto max-w-3xl px-3 py-3 sm:px-4">
          <div className="mb-3 flex items-center justify-center gap-2 text-[11px] font-bold">
            <span className="rounded-full bg-[#ff6770]/15 px-3 py-1.5 text-[#ffb7bc]">
              紅色 危險
            </span>
            <span className="rounded-full bg-[#ffbe4d]/15 px-3 py-1.5 text-[#ffdc98]">
              黃色 注意
            </span>
            <span className="rounded-full bg-[#4bd3a6]/15 px-3 py-1.5 text-[#9cf0d3]">
              綠色 安全
            </span>
          </div>

          <div className="relative min-h-[42dvh] sm:min-h-[52vh] overflow-hidden rounded-lg border border-white/10 bg-black shadow-2xl shadow-black/30">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt="現場掃描影像"
                className="block max-h-[64dvh] min-h-[42dvh] sm:min-h-[52vh] w-full object-contain"
              />
            ) : (
              <video
                ref={videoRef}
                muted
                playsInline
                className="block min-h-[42dvh] sm:min-h-[52vh] w-full object-cover"
                aria-label="後鏡頭即時預覽"
              />
            )}
            {analysis && imageUrl && <ArOverlay analysis={analysis} />}

            {!imageUrl && (
              <>
                <div className="pointer-events-none absolute inset-5 rounded-[28px] border border-white/45">
                  <span className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-[10px] font-bold text-white backdrop-blur">
                    將家具與地面一起拍入畫面
                  </span>
                </div>
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-5 bg-gradient-to-t from-black/75 to-transparent px-5 pb-6 pt-16">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white backdrop-blur"
                    aria-label="從相簿選擇照片"
                    title="從相簿選擇照片"
                  >
                    <i className="fas fa-image"></i>
                  </button>
                  <button
                    type="button"
                    onClick={captureFrame}
                    disabled={!cameraReady}
                    className="flex h-20 w-20 items-center justify-center rounded-full border-[5px] border-white bg-emerald-300 shadow-xl shadow-black/30 transition-transform active:scale-90 disabled:opacity-40"
                    aria-label="拍攝並分析"
                  >
                    <span className="h-14 w-14 rounded-full border-2 border-emerald-700/20 bg-emerald-200" />
                  </button>
                  <div className="h-12 w-12" aria-hidden="true" />
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) onCapture(file);
                    event.currentTarget.value = "";
                  }}
                />
              </>
            )}

            {isAnalyzing && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#07111f]/72 backdrop-blur-sm">
                <div className="relative h-16 w-16">
                  <div className="absolute inset-0 rounded-full border-2 border-emerald-300/20" />
                  <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-emerald-300" />
                  <i className="fas fa-couch absolute inset-0 flex items-center justify-center text-lg text-emerald-200"></i>
                </div>
                <div className="text-xs font-bold tracking-widest text-emerald-100">
                  正在推算地面波及範圍
                </div>
              </div>
            )}

            {imageUrl && !isAnalyzing && (
              <button
                type="button"
                onClick={onRetake}
                className="absolute bottom-3 right-3 flex h-11 items-center gap-2 rounded-full border border-white/20 bg-black/60 px-4 text-xs font-bold text-white backdrop-blur"
              >
                <i className="fas fa-camera-rotate"></i>
                重新掃描
              </button>
            )}
          </div>

          {cameraError && !imageUrl && (
            <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-xs leading-relaxed text-amber-100">
              {cameraError}
            </div>
          )}

          <p className="mt-2 text-center text-[10px] leading-relaxed text-slate-500">
            色塊為 AI 影像推估，請同時確認家具固定狀況與現場逃生動線。
          </p>

          {error && (
            <div className="mt-4 rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          )}

          {analysis && (
            <div className="mt-4 space-y-4">
              <div className="border-l-4 border-emerald-300 bg-white/5 p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold text-white">掃描摘要</h3>
                  <span className="rounded-full bg-amber-400/15 px-3 py-1 text-[11px] font-bold text-amber-100">
                    風險 {analysis.overallRiskLevel}/5
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-slate-300">
                  {analysis.summary}
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {analysis.objects.map((object, index) => (
                  <div
                    key={`${object.label}-card-${index}`}
                    className="border border-white/10 bg-white/[0.04] p-4"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h4 className="text-sm font-bold text-white">
                        {object.label}
                      </h4>
                      <span className="text-[11px] font-bold text-emerald-200">
                        {riskLabel(object.risk)}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-slate-400">
                      {object.reason}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-amber-100/80">
                      {object.recommendation}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
