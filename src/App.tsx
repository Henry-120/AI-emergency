import React, { useState, useEffect, useRef } from "react";
import { analyzeDisaster } from "./services/geminiService";
import { AuthUser, ChatMessage, DisasterAnalysis, UserStatus } from "./types";
import {
  fetchLatestAlert,
  EarthquakeAlert,
  isSevereNearbyEarthquake,
} from "./services/cwaService";
import { sendAutomaticSurvivalSignal } from "./services/bleMessengerService";
import {
  notifyEarthquakeAlert,
  onEarthquakeNotificationTapped,
} from "./services/notificationService";
import {
  initPushNotifications,
  onPushEarthquakeNotificationTapped,
} from "./services/pushNotificationService";
import { AppFooter } from "./components/app/AppFooter";
import { AppHeader } from "./components/app/AppHeader";
import { ChatMessageList } from "./components/app/ChatMessageList";
import { OfflineMapPage } from "./components/offline/OfflineMapPage";
import { ShelterNavigatorPage } from "./components/offline/ShelterNavigatorPage";
import { BleMessengerPage } from "./components/ble/BleMessengerPage";
import { RoomRiskScanner } from "./components/room-risk/RoomRiskScanner";
import { playAudio } from "./services/VoiceTTS";
import { getOfflineAnalysis } from "./services/offlineService";
import { analyzeRoomRisk } from "./services/roomRiskService";
import {
  canUseNativeRoomRiskAR,
  startNativeRoomRiskAR,
} from "./services/roomRiskARService";
import {
  getDownloadedMaps,
  deleteOfflineMap,
  MapInfo,
} from "./services/offlineMapsService";
import {
  downloadOfflineSafetyPack,
  getOfflineSafetyPack,
  OfflineSafetyPack,
} from "./services/offlineSafetyService";
import {
  saveEmergencyReport,
  saveUserStatusSnapshot,
  syncPendingEmergencyReports,
  syncPendingUserStatusRecords,
} from "./services/offlineQueueService";
import { RoomRiskAnalysis } from "./types";
import { AuthPage } from "./components/auth/AuthPage";
import { MedicalCardPage } from "./components/medical/MedicalCardPage";
import { RescueMapPage } from "./components/rescue/RescueMapPage";
import { getCurrentUser, logout, validateSession } from "./services/authService";
import { getMedicalCard, summarizeMedicalCard } from "./services/medicalCardService";

const App: React.FC = () => {
  const [authUser, setAuthUser] = useState<AuthUser | null>(() =>
    getCurrentUser(),
  );
  const [isCheckingSession, setIsCheckingSession] = useState(navigator.onLine);
  const [showMedicalCard, setShowMedicalCard] = useState(false);
  const [showRescueMap, setShowRescueMap] = useState(false);

  const handleLogout = () => {
    logout();
    setShowMedicalCard(false);
    setAuthUser(null);
  };

  useEffect(() => {
    validateSession()
      .then((user) => {
        if (!user && navigator.onLine) logout();
        setAuthUser(user);
      })
      .finally(() => setIsCheckingSession(false));
  }, []);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] =
    useState<DisasterAnalysis | null>(null);
  const [earthquakeAlert, setEarthquakeAlert] =
    useState<EarthquakeAlert | null>(null);
  const [cwaError, setCwaError] = useState<string>("");

  // 全局管理相機相簿選取的 Base64 圖片狀態
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // 用戶狀態
  const [userStatus, setUserStatus] = useState<UserStatus>({
    isMoving: false,
    heartRate: 72,
    batteryLevel: 85,
    location: null,
    hasInjuries: false,
  });
  const userStatusRef = useRef(userStatus);
  const earthquakeAlertRef = useRef<EarthquakeAlert | null>(null);
  const notifiedEarthquakeRef = useRef<string | null>(null);
  const sosEarthquakeRef = useRef<string | null>(null);

  useEffect(() => {
    userStatusRef.current = userStatus;
  }, [userStatus]);
  useEffect(() => {
    earthquakeAlertRef.current = earthquakeAlert;
  }, [earthquakeAlert]);

  // 每 30 秒線上直接寫後端；只有離線時才存進本機 SQLite。
  useEffect(() => {
    const syncInterval = setInterval(() => {
      saveUserStatusSnapshot(userStatus).catch((error) =>
        console.error("狀態儲存失敗", error),
      );
    }, 30000);
    return () => clearInterval(syncInterval);
  }, [userStatus]);

  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [offlineMapStatus, setOfflineMapStatus] = useState<string>("");
  const [downloadedMaps, setDownloadedMaps] = useState<MapInfo[]>([]);
  const [isDownloadingMap, setIsDownloadingMap] = useState(false);
  const [locationError, setLocationError] = useState<string>("");
  const [selectedMap, setSelectedMap] = useState<MapInfo | null>(null);
  const [offlineSafetyPack, setOfflineSafetyPack] =
    useState<OfflineSafetyPack | null>(() => getOfflineSafetyPack());
  const [showShelterNavigator, setShowShelterNavigator] = useState(false);
  const [showBleMessenger, setShowBleMessenger] = useState(false);
  const [showRoomRiskScanner, setShowRoomRiskScanner] = useState(false);
  const [roomRiskImageUrl, setRoomRiskImageUrl] = useState<string>("");
  const [roomRiskAnalysis, setRoomRiskAnalysis] =
    useState<RoomRiskAnalysis | null>(null);
  const [roomRiskError, setRoomRiskError] = useState<string>("");
  const [isRoomRiskAnalyzing, setIsRoomRiskAnalyzing] = useState(false);

  const DISCLAIMER_STORAGE_KEY = "app_disclaimer_accepted";
  const [disclaimerAccepted, setDisclaimerAccepted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISCLAIMER_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [disclaimerStep, setDisclaimerStep] = useState<1 | 2>(1);
  const [disclaimerChecked, setDisclaimerChecked] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<string>("");

  const acceptDisclaimer = () => {
    try {
      localStorage.setItem(DISCLAIMER_STORAGE_KEY, "true");
    } catch (error) {
      console.warn("無法寫入本地儲存：", error);
    }
    setDisclaimerAccepted(true);
  };

  const handleProceedToPermissions = () => {
    setDisclaimerStep(2);
  };

  const requestDevicePermissions = async () => {
    setPermissionStatus("正在請求相機、麥克風與定位權限…");

    try {
      if (navigator.geolocation) {
        await new Promise<void>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            () => resolve(),
            (err) => reject(err),
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
          );
        });
      }
    } catch (error) {
      console.warn("定位權限請求失敗：", error);
    }

    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        stream.getTracks().forEach((track) => track.stop());
      }
    } catch (error) {
      console.warn("相機/麥克風權限請求失敗：", error);
    }

    acceptDisclaimer();
  };

  const disclaimerModal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-6 text-slate-100">
      <div className="w-full max-w-4xl rounded-3xl border border-white/10 bg-slate-950/95 shadow-2xl shadow-black/50 overflow-hidden">
        <div className="p-6 sm:p-8">
          <h1 className="mb-4 text-2xl font-bold text-amber-300">
            地震救災協助 App 免責聲明
          </h1>
          {disclaimerStep === 1 ? (
            <div className="space-y-4">
              <div className="max-h-[55vh] overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-sm leading-relaxed text-slate-200">
                <p>歡迎您使用本地震救災協助 App（以下簡稱「本 App」）。為保障您的權益，請於使用前詳細閱讀本免責聲明。當您使用本 App，即表示您已閱讀、理解並同意以下內容。</p>
                <p className="mt-3 font-semibold">一、服務目的</p>
                <p>本 App 旨在提供地震防災、災害應變及救災資訊服務，包括但不限於：</p>
                <ul className="ml-5 list-disc space-y-1 py-2">
                  <li>日常居家家具安全健檢（透過相機拍攝環境進行 AI 分析）</li>
                  <li>接收中央氣象署地震警報及相關通知</li>
                  <li>提供災害期間之 AI 自保建議</li>
                  <li>提供語音輸入災情與位置資訊</li>
                  <li>協助使用者快速獲取防災與避難資訊</li>
                </ul>
                <p>本 App 所提供之內容僅供參考與輔助決策使用，不得視為官方指揮、醫療、消防、警政或其他專業救援意見。</p>
                <p className="mt-3 font-semibold">二、AI 回覆免責聲明</p>
                <p>本 App 使用人工智慧（Gemini AI）分析使用者提供之文字、語音、影像及位置資訊，並生成可能的應變建議。</p>
                <p>惟 AI 回覆係依據當下可取得之資訊自動生成，可能因下列因素而產生誤差：</p>
                <ul className="ml-5 list-disc space-y-1 py-2">
                  <li>使用者提供資訊不完整或不正確</li>
                  <li>通訊中斷或網路異常</li>
                  <li>AI 判斷限制</li>
                  <li>災害現場環境快速變化</li>
                </ul>
                <p>因此，本 App 無法保證所有建議之完整性、正確性、即時性或適用性，使用者仍應依現場實際情況及政府單位公告採取行動。</p>
                <p className="mt-3 font-semibold">三、地震警報服務</p>
                <p>本 App 之地震通知主要引用中央氣象署（或其他合法公開 API）提供之資料。</p>
                <p>若因下列因素導致通知延遲、遺漏或錯誤，包括但不限於：</p>
                <ul className="ml-5 list-disc space-y-1 py-2">
                  <li>API 服務異常</li>
                  <li>網路連線問題</li>
                  <li>手機系統限制</li>
                  <li>通知權限未開啟</li>
                  <li>第三方服務中斷</li>
                </ul>
                <p>本 App 不承擔因此所造成之任何直接或間接損害。</p>
                <p className="mt-3 font-semibold">四、相機與 AI 居家健檢</p>
                <p>本 App 會於取得您的同意後使用裝置相機，以分析家具擺放及居家環境可能存在之地震風險。</p>
                <p>分析結果僅供風險評估與改善建議，不代表建築結構安全鑑定、耐震認證或任何專業工程檢測結果。</p>
                <p>使用者仍應依照專業建築師、結構技師或政府相關單位建議進行安全改善。</p>
                <p className="mt-3 font-semibold">五、位置資訊</p>
                <p>本 App 可能取得您的位置資訊，以：</p>
                <ul className="ml-5 list-disc space-y-1 py-2">
                  <li>協助定位災害位置</li>
                  <li>提供附近避難場所資訊</li>
                  <li>協助 AI 判斷災害情境</li>
                  <li>提升救災建議之準確性</li>
                </ul>
                <p>位置資訊可能因 GPS、基地台、網路環境等因素產生誤差，本 App 不保證定位資訊百分之百準確。</p>
                <p className="mt-3 font-semibold">六、緊急情況</p>
                <p>若您遇到下列情況：</p>
                <ul className="ml-5 list-disc space-y-1 py-2">
                  <li>人員受困</li>
                  <li>建築倒塌</li>
                  <li>火災</li>
                  <li>嚴重受傷</li>
                  <li>生命危急</li>
                </ul>
                <p>請立即撥打當地緊急救援電話（如臺灣 119、110），並依政府救災單位指示行動。</p>
                <p>本 App 並非緊急救援平台，亦不保證能即時聯繫救援單位。</p>
                <p className="mt-3 font-semibold">七、責任限制</p>
                <p>在法律允許範圍內，本 App 開發團隊對於因使用或無法使用本 App 所造成之任何直接、間接、附帶、特殊或衍生性損害，不負任何賠償責任，包括但不限於：</p>
                <ul className="ml-5 list-disc space-y-1 py-2">
                  <li>人身傷害</li>
                  <li>財產損失</li>
                  <li>資料遺失</li>
                  <li>通訊中斷</li>
                  <li>救援延誤</li>
                  <li>AI 建議誤判</li>
                </ul>
                <p className="mt-3 font-semibold">八、使用者責任</p>
                <ol className="ml-5 list-decimal space-y-1 py-2">
                  <li>提供真實且正確之資訊。</li>
                  <li>保持手機網路、定位及通知功能正常運作。</li>
                  <li>自行判斷 AI 建議是否適用於當前情況。</li>
                  <li>於緊急狀況優先遵循政府機關及救援單位指示。</li>
                </ol>
                <p className="mt-3 font-semibold">九、服務調整</p>
                <p>本 App 保留隨時修改、更新、暫停或終止部分或全部服務之權利，而無須另行通知。</p>
                <p className="mt-3 font-semibold">十、聲明同意</p>
                <p>使用本 App 即表示您已閱讀並同意本免責聲明，理解本 App 為防災與救災輔助工具，並非官方救援系統、專業醫療、消防、建築安全或法律服務。</p>
              </div>
              <label className="flex items-start gap-3 text-sm leading-relaxed">
                <input
                  type="checkbox"
                  checked={disclaimerChecked}
                  onChange={(e) => setDisclaimerChecked(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded-sm border-slate-600 bg-slate-900 text-amber-400 focus:ring-amber-300"
                />
                <span>我已閱讀並理解上述免責聲明</span>
              </label>
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={!disclaimerChecked}
                  onClick={handleProceedToPermissions}
                  className="inline-flex items-center justify-center rounded-2xl bg-amber-500 px-5 py-3 text-sm font-semibold text-black transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  下一步：開啟權限
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm leading-relaxed text-rose-100">
                <p className="font-semibold text-rose-200">本 App 不會於未經使用者同意之情況下啟用相機、麥克風或定位功能。</p>
                <p className="mt-3">所有權限皆依 iOS 系統規範，由使用者自行決定是否授權；若拒絕部分權限，可能導致部分功能無法正常使用。</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-sm leading-relaxed text-slate-200">
                <p>請按下方按鈕，同意後系統將請求相機、麥克風與定位權限。若您拒絕，仍可稍後於功能啟用時再次授權。</p>
                <p className="mt-3 text-xs text-slate-400">若您的裝置不支援部分權限，系統會以瀏覽器/系統對話方塊提示。</p>
              </div>
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={requestDevicePermissions}
                  className="w-full rounded-2xl bg-amber-500 px-5 py-3 text-sm font-semibold text-black transition hover:bg-amber-400"
                >
                  同意並請求相機、麥克風與定位權限
                </button>
                <button
                  type="button"
                  onClick={acceptDisclaimer}
                  className="w-full rounded-2xl border border-white/10 bg-slate-800 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-700"
                >
                  已閱讀，稍後再授權
                </button>
              </div>
              {permissionStatus && (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  {permissionStatus}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const loadDownloadedMaps = async () => {
    const result = await getDownloadedMaps();
    setDownloadedMaps(Object.values(result.maps));
  };

  const handleDeleteMap = async (mapId: string) => {
    setOfflineMapStatus("刪除中...");
    const res = await deleteOfflineMap(mapId);
    if (res.success) {
      setOfflineMapStatus(`已刪除地圖：${mapId}`);
      await loadDownloadedMaps();
    } else {
      setOfflineMapStatus(`刪除失敗：${res.error || res.message}`);
    }
    setTimeout(() => setOfflineMapStatus(""), 4000);
  };

  const handleViewMap = (map: MapInfo) => {
    setSelectedMap(map);
  };

  const handleDownloadOfflineSafetyPack = async () => {
    if (!userStatus.location) {
      setOfflineMapStatus(
        "尚未取得定位，無法下載避難包。請允許定位權限並重新整理頁面。",
      );
      return;
    }

    setIsDownloadingMap(true);
    setOfflineMapStatus("正在下載附近避難所資料...");

    const result = await downloadOfflineSafetyPack(
      userStatus.location.lat,
      userStatus.location.lng,
      10,
    );

    if (result.success && result.pack) {
      setOfflineSafetyPack(result.pack);
      setOfflineMapStatus(result.message);
    } else {
      setOfflineMapStatus(`下載避難包失敗：${result.message}`);
    }

    setIsDownloadingMap(false);
  };

  const handleRefreshCwa = async () => {
    setCwaError("");
    const alert = await fetchLatestAlert();
    if (alert) {
      setEarthquakeAlert(alert);
    } else {
      setCwaError("CWA 即時地震警報載入失敗。請稍後重新整理。");
    }
  };

  const handleSimulateSevereEarthquake = () => {
    const location = userStatus.location || { lat: 25.033, lng: 121.5654 };
    notifiedEarthquakeRef.current = null;
    sosEarthquakeRef.current = null;
    setEarthquakeAlert({
      magnitude: 6.5,
      location: "模擬強震（測試資料）",
      time: new Date().toISOString(),
      epicenterLat: location.lat,
      epicenterLng: location.lng,
    });
  };

  const getSensorContext = () => {
    const medicalSummary = summarizeMedicalCard(getMedicalCard());
    const medicalInfo = medicalSummary ? `, 醫療卡: ${medicalSummary}` : "";
    return `BPM: ${userStatus.heartRate}, 電量: ${userStatus.batteryLevel.toFixed(0)}%, 定位: ${userStatus.location ? `${userStatus.location.lat.toFixed(5)}, ${userStatus.location.lng.toFixed(5)}` : "無訊號"}${medicalInfo}`;
  };

  const buildRoomRiskChatSummary = (analysis: RoomRiskAnalysis) => {
    const riskyObjects = analysis.objects
      .filter((object) => object.risk !== "low")
      .slice(0, 3)
      .map((object) => object.label);
    const safeZones = analysis.zones
      .filter((zone) => zone.type === "safe")
      .slice(0, 2)
      .map((zone) => zone.label);

    const parts = [];
    if (riskyObjects.length) {
      parts.push(`${riskyObjects.join("、")}需要優先處理`);
    }
    if (safeZones.length) {
      parts.push(`${safeZones.join("、")}是相對安全區`);
    }

    return parts.length ? `${analysis.summary} ${parts.join("；")}。` : analysis.summary;
  };

  const handleCaptureRoomImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setRoomRiskError("請選擇或拍攝圖片檔。");
      return;
    }

    if (roomRiskImageUrl) {
      URL.revokeObjectURL(roomRiskImageUrl);
    }

    const imageUrl = URL.createObjectURL(file);
    setRoomRiskImageUrl(imageUrl);
    setRoomRiskAnalysis(null);
    setRoomRiskError("");
    setIsRoomRiskAnalyzing(true);

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: "已拍攝現場照片，請分析地震時家具擺放風險。",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const analysis = await analyzeRoomRisk(file, getSensorContext());
      setRoomRiskAnalysis(analysis);

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: buildRoomRiskChatSummary(analysis),
        roomRiskAnalysis: analysis,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      speak(analysis.summary);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "房間影像分析失敗，請稍後再試。";
      setRoomRiskError(message);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `房間影像分析失敗：${message}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsRoomRiskAnalyzing(false);
    }
  };

  const appendRoomRiskAnalysis = (analysis: RoomRiskAnalysis) => {
    const assistantMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "assistant",
      content: buildRoomRiskChatSummary(analysis),
      roomRiskAnalysis: analysis,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, assistantMsg]);
    speak(analysis.summary);
  };

  const handleOpenRoomRiskScanner = async () => {
    if (!canUseNativeRoomRiskAR()) {
      setShowRoomRiskScanner(true);
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: "user",
        content: "啟動 ARKit 掃描室內地板與家具波及範圍。",
        timestamp: new Date(),
      },
    ]);

    try {
      const result = await startNativeRoomRiskAR();
      if (result.analysis) {
        appendRoomRiskAnalysis(result.analysis);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "ARKit 掃描無法啟動。";
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `ARKit 掃描失敗：${message}`,
          timestamp: new Date(),
        },
      ]);
    }
  };

  const handleCloseRoomRiskScanner = () => {
    setShowRoomRiskScanner(false);
    setRoomRiskImageUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return "";
    });
    setRoomRiskAnalysis(null);
    setRoomRiskError("");
    setIsRoomRiskAnalyzing(false);
  };

  const handleRetakeRoomRiskImage = () => {
    setRoomRiskImageUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return "";
    });
    setRoomRiskAnalysis(null);
    setRoomRiskError("");
    setIsRoomRiskAnalyzing(false);
  };

  useEffect(() => {
    const loadCwaAlert = async () => {
      setCwaError("");
      const alert = await fetchLatestAlert();
      if (alert) {
        setEarthquakeAlert(alert);
      } else {
        setEarthquakeAlert(null);
        setCwaError("CWA 即時地震警報載入失敗。請稍後重新整理。");
      }
    };

    loadCwaAlert();
    const interval = setInterval(loadCwaAlert, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      validateSession().then((user) => {
        if (!user) logout();
        setAuthUser(user);
      });
      syncPendingUserStatusRecords();
      syncPendingEmergencyReports();
    };
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // App 重啟或重新登入後，自動重試之前未同步的救援摘要。
  useEffect(() => {
    if (authUser && navigator.onLine) {
      syncPendingEmergencyReports();
    }
  }, [authUser]);

  const speak = (text: string) => {
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    // 1. 取得目前裝置支援的所有聲音
    const voices = window.speechSynthesis.getVoices();

    // 2. 優先尋找台灣中文 (zh-TW)，其次是 zh-HK 或 zh-CN
    const chineseVoice =
      voices.find((v) => v.lang.includes("zh-TW")) ||
      voices.find((v) => v.lang.includes("zh-HK")) ||
      voices.find((v) => v.lang.includes("zh-CN"));

    if (chineseVoice) {
      document.body.click(); // 嘗試觸發使用者互動以符合瀏覽器政策
      utterance.voice = chineseVoice; // 強制指定中文聲音物件
    }

    utterance.lang = "zh-tw";
    utterance.rate = 1.0;
    utterance.pitch = 1.1;

    window.speechSynthesis.speak(utterance);
  };

  const announceEarthquakeSafety = () => {
    const alert = earthquakeAlertRef.current;
    const instruction = alert
      ? `偵測到規模 ${alert.magnitude} 強震，${alert.location}。請立即趴下，掩護頭頸部，抓穩固定物。遠離窗戶及可能掉落的家具。搖晃停止後再確認逃生路線，切勿搭乘電梯。`
      : "請立即趴下，掩護頭頸部，抓穩固定物。遠離窗戶及可能掉落的家具。搖晃停止後再確認逃生路線，切勿搭乘電梯。";
    setMessages((previous) => [...previous, {
      id: `earthquake-${Date.now()}`,
      role: "assistant",
      content: `🚨 ${instruction}`,
      timestamp: new Date(),
    }]);
    speak(instruction);
  };

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    onEarthquakeNotificationTapped(() => {
      void handleRefreshCwa();
      announceEarthquakeSafety();
    }).then((remove) => { cleanup = remove; });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    void initPushNotifications();
    return onPushEarthquakeNotificationTapped(() => {
      void handleRefreshCwa();
      announceEarthquakeSafety();
    });
  }, []);

  useEffect(() => {
    if (!earthquakeAlert) return;
    const location = userStatusRef.current.location;
    if (!isSevereNearbyEarthquake(earthquakeAlert, location)) return;
    const key = `${earthquakeAlert.time || earthquakeAlert.originTime}-${earthquakeAlert.magnitude}-${earthquakeAlert.location}`;

    if (notifiedEarthquakeRef.current !== key) {
      notifiedEarthquakeRef.current = key;
      void notifyEarthquakeAlert(earthquakeAlert);
    }
    if (sosEarthquakeRef.current !== key) {
      sosEarthquakeRef.current = key;
      setMessages((previous) => [...previous, {
        id: `sos-start-${Date.now()}`,
        role: "assistant",
        content: "⚠️ 強震影響範圍內，正在透過 BLE 尋找附近 Guardia 裝置並傳送匿名存活訊號。",
        timestamp: new Date(),
      }]);
      void sendAutomaticSurvivalSignal().then(({ sent }) => {
        setMessages((previous) => [...previous, {
          id: `sos-result-${Date.now()}`,
          role: "assistant",
          content: sent > 0
            ? `✅ 已向 ${sent} 個附近裝置傳送匿名存活訊號。`
            : "目前沒有找到可接收訊號的 Guardia BLE 裝置；請保持藍牙開啟並嘗試手動傳送。",
          timestamp: new Date(),
        }]);
      }).catch((error) => {
        console.error("BLE 自動存活訊號失敗", error);
        setMessages((previous) => [...previous, {
          id: `sos-error-${Date.now()}`,
          role: "assistant",
          content: "BLE 自動存活訊號傳送失敗，請開啟 BLE 頁面手動傳送。",
          timestamp: new Date(),
        }]);
      });
    }
  }, [earthquakeAlert]);

  const getGeolocationErrorMessage = (
    err: GeolocationPositionError,
  ): string => {
    const isSecureContext =
      window.isSecureContext ||
      ["localhost", "127.0.0.1"].includes(window.location.hostname);

    if (!isSecureContext) {
      return "請透過 localhost 或 HTTPS 開啟此頁面，瀏覽器才會允許地理定位。";
    }

    if (err.code === 1) {
      return "定位權限被拒絕，請允許定位後重新整理頁面。";
    }
    if (err.code === 2) {
      return "定位服務無法取得位置，請確認裝置位置服務是否已開啟。";
    }
    if (err.code === 3) {
      return "定位請求逾時，請確認網路或 GPS 設備狀態，然後再試一次。";
    }
    return err.message
      ? `定位失敗：${err.message}`
      : "定位失敗，請確認定位權限與安全上下文。";
  };

  // 用於自動滾動到底部
  const scrollRef = useRef<HTMLDivElement>(null);

  // 每當 messages 更新時，自動滾動到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    // 初始系統訊息
    setMessages([
      {
        id: "1",
        role: "assistant",
        content:
          "我是 GuardiaAI 生存助手。請描述您目前遇到的緊急狀況，或直接上傳現場照片。",
        timestamp: new Date(),
      },
    ]);

    // 持續追蹤使用者定位，離線避難導航會用最新位置重新排序。
    let watchId: number | null = null;
    if (navigator.geolocation) {
      const handleGeolocationError = (err: GeolocationPositionError) => {
        console.log("定位獲取失敗", err);
        setLocationError(getGeolocationErrorMessage(err));
      };

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setUserStatus((prev) => ({
            ...prev,
            location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          }));
          setLocationError("");
        },
        handleGeolocationError,
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    } else {
      setLocationError("此設備不支援地理定位。請使用支援的瀏覽器。");
    }

    // 模擬心率和電量變化
    const interval = setInterval(() => {
      setUserStatus((prev) => ({
        ...prev,
        heartRate: 70 + Math.floor(Math.random() * 10),
        batteryLevel: Math.max(0, prev.batteryLevel - 0.01),
      }));
    }, 10000);

    loadDownloadedMaps();

    return () => {
      clearInterval(interval);
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, []);

  // 處理使用者提交的訊息
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 同時檢查 authUser 以及確保有輸入文字或選擇了要傳送的圖片
    if (!authUser || (!input.trim() && !selectedImage) || isAnalyzing) return;

    // 紀錄這次發送要使用的圖片，並立刻清空全局圖片暫存
    const imageToSend = selectedImage;
    setSelectedImage(null);

    // 立即在 UI 顯示使用者訊息，補上 imageBase64 欄位讓歷史訊息記得圖片資訊
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input || "【傳送了現場照片】",
      timestamp: new Date(),
      imageBase64: imageToSend,
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    const currentInput = input;
    setInput("");

    setIsAnalyzing(true);

    // --- 狀況 A：明確處於斷網狀態，改用本機離線大模型 ---
    if (isOffline) {
      console.log("偵測到無網路，直接啟動本地離線大模型...");
      try {
        const offlineAnalysis = await getOfflineAnalysis(updatedMessages);

        const assistantMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "⚠️ 偵測到目前無網路連線，已啟動內建緊急應變模組（無法處理影像分析）：",
          analysis: offlineAnalysis,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMsg]);
        setCurrentAnalysis(offlineAnalysis);

        // 儲存進本地資料庫，等候背景復網時排程同步
        saveEmergencyReport(
          authUser.id,
          offlineAnalysis.emergencySummary,
          [...updatedMessages, assistantMsg],
          userStatus.location,
        ).catch((error) => console.error("離線救援摘要儲存失敗", error));

        if (offlineAnalysis.immediateActions && offlineAnalysis.immediateActions.length > 0) {
          speak(offlineAnalysis.immediateActions[0].description);
        }
      } catch (err) {
        console.error("本地離線模型執行失敗", err);
      } finally {
        setIsAnalyzing(false);
      }
      return; // 結束離線處理，不往下執行雲端 Gemini
    }

    // --- 狀況 B：有網路，嘗試呼叫雲端 Gemini ---
    try {
      console.log("嘗試使用雲端 Gemini 引擎...");
      const sensorContext = getSensorContext();

      // 呼叫雲端分析服務，AI 回應中包含缺少資訊的請求時，優先提示使用者提供這些資訊
      const analysis = await analyzeDisaster(updatedMessages, sensorContext, imageToSend);

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: analysis.missingInfoRequests?.length
          ? `收到回報。為了提供更精確的逃生指令，我還需要一些細節：`
          : `分析更新：根據最新資訊，請優先執行以下行動：`,
        analysis,
        timestamp: new Date(),
        isCloudResponse: true,
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setCurrentAnalysis(analysis);

      // 無論是否有網路都先寫裝置端；線上時再嘗試同步到後端。
      saveEmergencyReport(authUser.id, analysis.emergencySummary, [
        ...updatedMessages,
        assistantMsg,
      ], userStatus.location)
        .then(() => {
          if (navigator.onLine) return syncPendingEmergencyReports();
        })
        .catch((error) => console.error("救援摘要本機儲存失敗", error));

      if (analysis.immediateActions && analysis.immediateActions.length > 0) {
        const text = `緊急指令${analysis.immediateActions[0].title}`;
        playAudio(text).catch(() => {
          console.log("切換至原生語音降級模式");
          speak(text);
        });
      } else if (analysis.missingInfoRequests?.length) {
        speak(`請提供更多資訊：${analysis.missingInfoRequests[0]}`);
      }
    } catch (error) {
      // 終極保險：系統判定有網路，但可能遇上訊號死角或 DNS 解析失敗，自動降級切換至本地離線大模型
      console.warn("雲端 Gemini 連線失敗，自動降級切換至本地離線大模型！", error);

      try {
        const offlineAnalysis = await getOfflineAnalysis(updatedMessages);
        const fallbackMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "⚠️ 雲端伺服器無回應，自動降級至內建緊急應變模組：",
          analysis: offlineAnalysis,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, fallbackMsg]);
        setCurrentAnalysis(offlineAnalysis);

        // 降級時同樣寫入本地 SQLite 保存
        saveEmergencyReport(
          authUser.id,
          offlineAnalysis.emergencySummary,
          [...updatedMessages, fallbackMsg],
          userStatus.location,
        ).catch((err) => console.error("降級離線救援摘要儲存失敗", err));

        if (offlineAnalysis.immediateActions && offlineAnalysis.immediateActions.length > 0) {
          speak(offlineAnalysis.immediateActions[0].description);
        }
      } catch (fallbackError) {
        // 若連本地端離線解析也崩潰（極端狀況），則進行最後的錯誤回報並智慧解析 API 錯誤
        const detail = error instanceof Error ? error.message : "未知錯誤";
        const isModelUnavailable = /not found|no longer available|404/i.test(detail);
        const isQuotaLimited = /quota|resource_exhausted|429/i.test(detail);

        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: isModelUnavailable
              ? "分析模型目前不可用，請重新整理後再試；若持續發生，請檢查 Gemini model 設定。"
              : isQuotaLimited
                ? "Gemini API 額度暫時用完，請稍後再試或檢查 API 配額。"
                : "系統發生錯誤且離線模組無法啟動，請保持冷靜，並嘗試撥打 119 或 112 求救。",
            timestamp: new Date(),
          },
        ]);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };
  // --- 在這裡加入 handleOfflineOption ---
  const handleOfflineOption = (option: string) => {
    setInput(option);
    // 這裡可以選擇是否要點擊後自動送出，如果要自動送出可以加一行：
    setTimeout(() => document.querySelector("form")?.requestSubmit(), 100);
  };

  if (!disclaimerAccepted) {
    return disclaimerModal;
  }

  if (isCheckingSession) {
    return (
      <div className="h-[100dvh] flex items-center justify-center bg-[#020617] text-slate-400">
        正在確認線上帳號…
      </div>
    );
  }

  if (!authUser) {
    return <AuthPage onAuthed={setAuthUser} />;
  }

  if (showMedicalCard) {
    return <MedicalCardPage onBack={() => setShowMedicalCard(false)} />;
  }

  if (showRescueMap) {
    return <RescueMapPage location={userStatus.location} onBack={() => setShowRescueMap(false)} />;
  }

  if (selectedMap) {
    return (
      <OfflineMapPage
        map={selectedMap}
        onBack={() => {
          setSelectedMap(null);
          loadDownloadedMaps();
        }}
      />
    );
  }

  if (showShelterNavigator && offlineSafetyPack) {
    return (
      <ShelterNavigatorPage
        pack={offlineSafetyPack}
        location={userStatus.location}
        onBack={() => setShowShelterNavigator(false)}
      />
    );
  }

  if (showBleMessenger) {
    return <BleMessengerPage onBack={() => setShowBleMessenger(false)} />;
  }

  // 渲染 UI
  return (
    <div className="h-[100dvh] min-h-0 flex flex-col bg-[#020617] text-slate-100 overflow-hidden">
      <AppHeader
        currentAnalysis={currentAnalysis}
        cwaError={cwaError}
        earthquakeAlert={earthquakeAlert}
        isDownloadingMap={isDownloadingMap}
        isOffline={isOffline}
        locationError={locationError}
        offlineSafetyPackReady={Boolean(offlineSafetyPack)}
        userStatus={userStatus}
        authUser={authUser}
        onDownloadOfflineSafetyPack={handleDownloadOfflineSafetyPack}
        onShowBleMessenger={() => setShowBleMessenger(true)}
        onRefreshCwa={handleRefreshCwa}
        onShowShelterNavigator={() => setShowShelterNavigator(true)}
        onShowMedicalCard={() => setShowMedicalCard(true)}
        onShowRescueMap={() => setShowRescueMap(true)}
        onSimulateSevereEarthquake={handleSimulateSevereEarthquake}
        onLogout={handleLogout}
      />
      <ChatMessageList
        isAnalyzing={isAnalyzing}
        isOffline={isOffline}
        messages={messages}
        onOfflineOption={handleOfflineOption}
        scrollRef={scrollRef}
      />
      {showRoomRiskScanner && (
        <RoomRiskScanner
          analysis={roomRiskAnalysis}
          error={roomRiskError}
          imageUrl={roomRiskImageUrl}
          isAnalyzing={isRoomRiskAnalyzing}
          onCapture={handleCaptureRoomImage}
          onClose={handleCloseRoomRiskScanner}
          onRetake={handleRetakeRoomRiskImage}
        />
      )}
      <AppFooter
        downloadedMaps={downloadedMaps}
        input={input}
        isAnalyzing={isAnalyzing}
        offlineMapStatus={offlineMapStatus}
        onOpenRoomRiskScanner={handleOpenRoomRiskScanner}
        onDeleteMap={handleDeleteMap}
        onSubmit={handleSubmit}
        onViewMap={handleViewMap}
        setInput={setInput}
        selectedImage={selectedImage}
        setSelectedImage={setSelectedImage}
      />
    </div>
  );
};

export default App;
