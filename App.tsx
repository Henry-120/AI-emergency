import React, { useState, useEffect, useRef } from "react";
import { analyzeDisaster } from "./services/geminiService";
import { ChatMessage, DisasterAnalysis, UserStatus } from "./types";
import { fetchLatestAlert, EarthquakeAlert } from "./services/cwaService";
import { AppFooter } from "./components/app/AppFooter";
import { AppHeader } from "./components/app/AppHeader";
import { ChatMessageList } from "./components/app/ChatMessageList";
import { OfflineMapPage } from "./components/offline/OfflineMapPage";
import { ShelterNavigatorPage } from "./components/offline/ShelterNavigatorPage";
import { BleMessengerPage } from "./components/ble/BleMessengerPage";
import { playAudio } from "./services/VoiceTTS";
import { getOfflineAnalysis } from "./services/offlineService";
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
  saveUserStatusSnapshot,
  syncPendingUserStatusRecords,
} from "./services/offlineQueueService";
import { AuthPage } from "./components/auth/AuthPage";
import { MedicalCardPage } from "./components/medical/MedicalCardPage";
import { getCurrentUser, logout } from "./services/authService";
import {
  getMedicalCard,
  summarizeMedicalCard,
} from "./services/medicalCardService";
import { AuthUser } from "./types";

const App: React.FC = () => {
  // 登入狀態（離線優先：以 localStorage session 為準）
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
    };
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

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
    if (!input.trim() || isAnalyzing) return;

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
      const offlineAnalysis = getOfflineAnalysis(currentInput);

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "⚠️ 偵測到目前無網路連線，已啟動內建緊急應變模組：",
        analysis: offlineAnalysis,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setCurrentAnalysis(offlineAnalysis);
      speak(offlineAnalysis.immediateActions[0].description);
      return; // 離線模式處理完畢，直接結束
    }
    // --- 離線邏輯結束 ---
    setIsAnalyzing(true);

    try {
      const quakeInfo = earthquakeAlert
        ? `最近地震: 規模 ${earthquakeAlert.magnitude}, 震央 ${earthquakeAlert.location}, 時間 ${earthquakeAlert.time}`
        : "目前無即時地震資料";
      const medicalSummary = summarizeMedicalCard(getMedicalCard());
      const medicalInfo = medicalSummary ? `, 醫療卡: ${medicalSummary}` : "";
      const sensorContext = `BPM: ${userStatus.heartRate}, 電量: ${userStatus.batteryLevel.toFixed(0)}%, 定位: ${userStatus.location ? "正常" : "無訊號"}, ${quakeInfo}${medicalInfo}`;

      // 將整個對話歷史傳送給 AI
      const analysis = await analyzeDisaster(updatedMessages, sensorContext);

      // AI 回應中包含缺少資訊的請求時，優先提示使用者提供這些資訊`
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: analysis.missingInfoRequests?.length
          ? `收到回報。為了提供更精確的逃生指令，我還需要一些細節：`
          : `分析更新：根據最新資訊，請優先執行以下行動：`,
        analysis,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setCurrentAnalysis(analysis);

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
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "分析引擎繁忙中，請嘗試簡短描述您觀察到的新狀況。",
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

  // 未登入時，先顯示註冊 / 登入頁
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
    <div className="h-screen flex flex-col bg-[#020617] overflow-hidden">
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
      <AppFooter
        downloadedMaps={downloadedMaps}
        input={input}
        isAnalyzing={isAnalyzing}
        offlineMapStatus={offlineMapStatus}
        onDeleteMap={handleDeleteMap}
        onSubmit={handleSubmit}
        onViewMap={handleViewMap}
        setInput={setInput}
      />
    </div>
  );
};

export default App;
