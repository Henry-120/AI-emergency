import React, { useState, useEffect, useRef } from "react";
import { analyzeDisaster } from "./services/geminiService";
import { AuthUser, ChatMessage, DisasterAnalysis, UserStatus } from "./types";
import { fetchLatestAlert, EarthquakeAlert } from "./services/cwaService";
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
    const voices = window.speechSynthesis.getVoices();
    const chineseVoice =
      voices.find((v) => v.lang.includes("zh-TW")) ||
      voices.find((v) => v.lang.includes("zh-HK")) ||
      voices.find((v) => v.lang.includes("zh-CN"));

    if (chineseVoice) {
      document.body.click(); // 嘗試觸發使用者互動以符合瀏覽器政策
      utterance.voice = chineseVoice;
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

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    setMessages([
      {
        id: "1",
        role: "assistant",
        content:
          "我是 GuardiaAI 生存助手。請描述您目前遇到的緊急狀況，或直接上傳現場照片。",
        timestamp: new Date(),
      },
    ]);

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
    
    // 合併：同時檢查 authUser 以及確保有輸入文字或選擇了要傳送的圖片
    if (!authUser || (!input.trim() && !selectedImage) || isAnalyzing) return;

    // 紀錄這次發送要使用的圖片，並立刻清空全局圖片暫存
    const imageToSend = selectedImage;
    setSelectedImage(null);

    // 補上 imageBase64 欄位，讓歷史訊息狀態記得圖片資訊
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

    // 1. 即時判斷：檢測瀏覽器目前是否有網路
    const isCurrentlyOffline = !navigator.onLine;

    // --- 狀況 A：明確處於斷網狀態 ---
    if (isCurrentlyOffline) {
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
        saveEmergencyReportLocally(
          authUser.id,
          offlineAnalysis.emergencySummary,
          [...updatedMessages, assistantMsg],
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

      // 呼叫雲端分析服務
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

      // 無論是否有網路都先寫入裝置端 SQLite，線上時再同步至後端伺服器
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
        playAudio(text).catch(() => {
          console.log("切換至原生語音降級模式");
          speak(text);
        });
      } else if (analysis.missingInfoRequests?.length) {
        speak(`請提供更多資訊：${analysis.missingInfoRequests[0]}`);
      }

    } catch (error) {
      // 🌟 2. 終極保險 (Fallback)：系統判定有網路，但可能遇上訊號死角或 DNS 解析失敗
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
        saveEmergencyReportLocally(
          authUser.id,
          offlineAnalysis.emergencySummary,
          [...updatedMessages, fallbackMsg],
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

  const handleOfflineOption = (option: string) => {
    setInput(option);
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