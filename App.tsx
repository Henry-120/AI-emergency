import React, { useState, useEffect, useRef } from "react";
import { analyzeDisaster } from "./services/geminiService";
import { AuthUser, ChatMessage, DisasterAnalysis, UserStatus } from "./types";
import {
  fetchLatestAlert,
  isSevereNearbyEarthquake,
  EarthquakeAlert,
} from "./services/cwaService";
import {
  broadcastSosBeacon,
  startGuardianScan,
  stopGuardianScan,
} from "./services/bleMessengerService";
import {
  notifyEarthquakeAlert,
  onEarthquakeNotificationTapped,
} from "./services/notificationService";
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
  distanceKm,
  OfflineSafetyPack,
} from "./services/offlineSafetyService";
import {
  saveEmergencyReportLocally,
  saveUserStatusSnapshot,
  syncPendingEmergencyReports,
  syncPendingUserStatusRecords,
} from "./services/offlineQueueService";
import { RoomRiskAnalysis } from "./types";
import { AuthPage } from "./components/auth/AuthPage";
import { MedicalCardPage } from "./components/medical/MedicalCardPage";
import { getCurrentUser, logout } from "./services/authService";
import { getMedicalCard, summarizeMedicalCard } from "./services/medicalCardService";

const App: React.FC = () => {
  const [authUser, setAuthUser] = useState<AuthUser | null>(() =>
    getCurrentUser(),
  );
  const [showMedicalCard, setShowMedicalCard] = useState(false);

  const handleLogout = () => {
    logout();
    setShowMedicalCard(false);
    setAuthUser(null);
  };
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] =
    useState<DisasterAnalysis | null>(null);
  const [earthquakeAlert, setEarthquakeAlert] =
    useState<EarthquakeAlert | null>(null);
  const [cwaError, setCwaError] = useState<string>("");

  // 新增：用戶狀態
  const [userStatus, setUserStatus] = useState<UserStatus>({
    isMoving: false,
    heartRate: 72,
    batteryLevel: 85,
    location: null,
    hasInjuries: false,
  });
  // 定位每次 GPS fix 都會更新，若拿來當 effect 依賴會讓強震偵測反覆重跑；
  // 改用 ref 讓偵測 effect 只在地震警報變動時讀取「當下」位置。
  const userStatusRef = useRef(userStatus);
  useEffect(() => {
    userStatusRef.current = userStatus;
  }, [userStatus]);
  const sosAlertedKeyRef = useRef<string | null>(null);
  const earthquakeNotifiedKeyRef = useRef<string | null>(null);
  // 通知點擊的 callback 只在 mount 時註冊一次，用 ref 讓它讀到「當下」最新的地震資料。
  const earthquakeAlertRef = useRef<EarthquakeAlert | null>(null);
  useEffect(() => {
    earthquakeAlertRef.current = earthquakeAlert;
  }, [earthquakeAlert]);

  // 每 30 秒先存進本機 SQLite，若有網路再批次同步到後端。
  useEffect(() => {
    const syncInterval = setInterval(() => {
      saveUserStatusSnapshot(userStatus).then(() => {
        if (navigator.onLine) {
          syncPendingUserStatusRecords();
        }
      });
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

  // DEMO ONLY：展示用，模擬「CWA 收到強震報告且使用者在危險範圍內」，
  // 會觸發系統通知與自動 BLE 求生訊號。展示完請刪除本函式與 AppHeader 的按鈕。
  const handleSimulateSevereEarthquake = () => {
    const location = userStatus.location || { lat: 25.033, lng: 121.5654 };
    const fakeAlert: EarthquakeAlert = {
      magnitude: 6.5,
      location: "模擬強震（展示用，非真實資料）",
      time: new Date().toISOString(),
      epicenterLat: location.lat,
      epicenterLng: location.lng,
    };
    earthquakeNotifiedKeyRef.current = null; // 讓模擬事件也能跳出通知
    setEarthquakeAlert(fakeAlert);
    notifyEarthquakeAlert(fakeAlert).catch(() => {});
  };

  const getSensorContext = () => {
    const medicalSummary = summarizeMedicalCard(getMedicalCard());
    const medicalInfo = medicalSummary ? `, 醫療卡: ${medicalSummary}` : "";
    const earthquakeInfo = earthquakeAlert
      ? `, 最近地震: 規模 ${earthquakeAlert.magnitude}，震央 ${earthquakeAlert.location}${earthquakeAlert.time ? `，發生時間 ${earthquakeAlert.time}` : ""}`
      : ", 最近地震: 無法取得即時地震資料";
    return `BPM: ${userStatus.heartRate}, 電量: ${userStatus.batteryLevel.toFixed(0)}%, 定位: ${userStatus.location ? `${userStatus.location.lat.toFixed(5)}, ${userStatus.location.lng.toFixed(5)}` : "無訊號"}${medicalInfo}${earthquakeInfo}`;
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

        // 只在收到「跟上次不同」的新報告時才跳通知，避免每 60 秒重複騷擾。
        const alertKey = `${alert.time}-${alert.magnitude}-${alert.location}`;
        if (earthquakeNotifiedKeyRef.current !== alertKey) {
          earthquakeNotifiedKeyRef.current = alertKey;
          notifyEarthquakeAlert(alert).catch(() => {});
        }
      } else {
        setEarthquakeAlert(null);
        setCwaError("CWA 即時地震警報載入失敗。請稍後重新整理。");
      }
    };

    loadCwaAlert();
    const interval = setInterval(loadCwaAlert, 60000);
    return () => clearInterval(interval);
  }, []);

  // 從通知點進 App 時，立即用語音主動播報保命須知，不等待 AI 回應，
  // 確保使用者在強震當下第一時間就能聽到指示（離線也能用固定內容播報）。
  const announceEarthquakeSafetyBriefing = () => {
    const alert = earthquakeAlertRef.current;
    const briefing = alert
      ? `偵測到規模 ${alert.magnitude} 強震，${alert.location}。請立即就地趴下、掩護頭頸部、抓穩固定物，遠離窗戶與可能掉落的家具。搖晃停止後再確認逃生路線撤離，切勿搭乘電梯。`
      : "請立即就地趴下、掩護頭頸部、抓穩固定物，遠離窗戶與可能掉落的家具。搖晃停止後再確認逃生路線撤離，切勿搭乘電梯。";

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: "assistant",
        content: `🔊 保命須知：${briefing}`,
        timestamp: new Date(),
      },
    ]);

    playAudio(briefing).catch(() => {
      speak(briefing);
    });
  };

  // 點擊系統通知時，把最新地震資料重新拉一次，並主動語音播報保命須知，
  // 確保進入 App 當下第一時間就看到（也聽到）最新的求生指示。
  useEffect(() => {
    onEarthquakeNotificationTapped(() => {
      handleRefreshCwa();
      announceEarthquakeSafetyBriefing();
    });
  }, []);

  // 強震 + 使用者位於危險範圍內時，自動透過藍牙廣播求生訊號（不含個資，
  // 僅代表「這裡有人活著、需要救援」），讓救難隊即使無行動網路也能收到。
  const triggerAutoSosBeacon = async (alert: EarthquakeAlert, distanceKmValue: number) => {
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: "assistant",
        content: `⚠️ 偵測到規模 ${alert.magnitude} 強震，且您位於受影響範圍內（距震央約 ${distanceKmValue.toFixed(0)} 公里）。正在透過藍牙自動廣播求生訊號給附近裝置...`,
        timestamp: new Date(),
      },
    ]);

    try {
      await startGuardianScan();
      // 給附近裝置一點時間被掃描到，再嘗試逐一連線廣播。
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const result = await broadcastSosBeacon();
      await stopGuardianScan().catch(() => {});

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content:
            result.sent > 0
              ? `✅ 已透過藍牙發送求生訊號至 ${result.sent} 個附近裝置（僅含「存活」信號，不含姓名、位置等個人資料）。`
              : "⚠️ 目前掃描不到附近的 Guardian 裝置，求生訊號尚未送出。請保持藍牙開啟並留在原地等待救援。",
          timestamp: new Date(),
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `藍牙求生訊號自動發送失敗：${error instanceof Error ? error.message : "未知錯誤"}。請改用「BLE」頁面手動發送。`,
          timestamp: new Date(),
        },
      ]);
    }
  };

  useEffect(() => {
    if (!earthquakeAlert) return;

    const location = userStatusRef.current.location;
    if (!location) return;
    if (
      earthquakeAlert.epicenterLat == null ||
      earthquakeAlert.epicenterLng == null
    ) {
      return;
    }

    const alertKey = `${earthquakeAlert.time}-${earthquakeAlert.magnitude}`;
    if (sosAlertedKeyRef.current === alertKey) return; // 同一筆警報只觸發一次

    if (!isSevereNearbyEarthquake(earthquakeAlert, location)) return;

    sosAlertedKeyRef.current = alertKey;
    const distance = distanceKm(
      location.lat,
      location.lng,
      earthquakeAlert.epicenterLat,
      earthquakeAlert.epicenterLng,
    );
    triggerAutoSosBeacon(earthquakeAlert, distance);
  }, [earthquakeAlert]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
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
      utterance.voice = chineseVoice; // 強制指定中文聲音物件
    }

    utterance.lang = "zh-tw";
    utterance.rate = 1.0;
    utterance.pitch = 1.1;

    window.speechSynthesis.speak(utterance);
  };

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
    if (!authUser || !input.trim() || isAnalyzing) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    // 立即在 UI 顯示使用者訊息
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    const currentInput = input;
    setInput("");
    // --- 離線邏輯開始 ---
    if (isOffline) {
      const offlineAnalysis = getOfflineAnalysis(
        currentInput,
        updatedMessages
          .filter((message) => message.role === "user")
          .map((message) => message.content)
          .join("\n"),
      );

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "⚠️ 偵測到目前無網路連線，已啟動內建緊急應變模組：",
        analysis: offlineAnalysis,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setCurrentAnalysis(offlineAnalysis);
      saveEmergencyReportLocally(
        authUser.id,
        offlineAnalysis.emergencySummary,
        [...updatedMessages, assistantMsg],
      ).catch((error) => console.error("離線救援摘要儲存失敗", error));
      speak(offlineAnalysis.immediateActions[0].description);
      return; // 離線模式處理完畢，直接結束
    }
    // --- 離線邏輯結束 ---
    setIsAnalyzing(true);

    try {
      const sensorContext = getSensorContext();

      // 將整個對話歷史傳送給 AI
      const analysis = await analyzeDisaster(updatedMessages, sensorContext);

      // AI 回應中包含缺少資訊的請求時，優先提示使用者提供這些資訊`
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content:
          analysis.situationSummary ||
          (analysis.missingInfoRequests?.length
            ? `收到回報。為了提供更精確的逃生指令，我還需要一些細節：`
            : `分析更新：根據最新資訊，請優先執行以下行動：`),
        analysis,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setCurrentAnalysis(analysis);

      // 無論是否有網路都先寫裝置端；線上時再嘗試同步到後端。
      saveEmergencyReportLocally(authUser.id, analysis.emergencySummary, [
        ...updatedMessages,
        assistantMsg,
      ])
        .then(() => {
          if (navigator.onLine) return syncPendingEmergencyReports();
        })
        .catch((error) => console.error("救援摘要本機儲存失敗", error));

      if (analysis.immediateActions && analysis.immediateActions.length > 0) {
        const text = `緊急指令${analysis.immediateActions[0].title}`;
        // 優先嘗試 OpenAI，失敗則用原生降級
        playAudio(text).catch(() => {
          console.log("切換至原生語音降級模式");
          speak(text);
        });
      } else if (analysis.missingInfoRequests?.length) {
        // 如果是請求資訊
        speak(`請提供更多資訊：${analysis.missingInfoRequests[0]}`);
      }
    } catch (error) {
      console.error("Disaster analysis failed:", error);
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
              : "分析服務暫時無法回應，請確認網路後再試。",
          timestamp: new Date(),
        },
      ]);
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

  if (!authUser) {
    return <AuthPage onAuthed={setAuthUser} />;
  }

  if (showMedicalCard) {
    return <MedicalCardPage onBack={() => setShowMedicalCard(false)} />;
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
        onLogout={handleLogout}
        onSimulateSevereEarthquake={handleSimulateSevereEarthquake}
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
      />
    </div>
  );
};

export default App;
