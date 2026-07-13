const MICROPHONE_PERMISSION_STORAGE_KEY = "microphone-permission-decision";

export type MicrophonePermissionDecision = "granted" | "denied";

function readStoredDecision(): MicrophonePermissionDecision | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(MICROPHONE_PERMISSION_STORAGE_KEY);
  return rawValue === "granted" || rawValue === "denied" ? rawValue : null;
}

function storeDecision(decision: MicrophonePermissionDecision) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(MICROPHONE_PERMISSION_STORAGE_KEY, decision);
}

export async function requestMicrophonePermissionOnce(): Promise<{
  asked: boolean;
  granted: boolean;
}> {
  const existingDecision = readStoredDecision();
  if (existingDecision) {
    return {
      asked: false,
      granted: existingDecision === "granted",
    };
  }

  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    storeDecision("denied");
    return { asked: false, granted: false };
  }

  try {
    const permissionStatus = (await (navigator.permissions?.query?.({
      name: "microphone" as PermissionName,
    }) as Promise<PermissionStatus> | undefined))?.state;

    if (permissionStatus === "granted") {
      storeDecision("granted");
      return { asked: false, granted: true };
    }

    if (permissionStatus === "denied") {
      storeDecision("denied");
      return { asked: false, granted: false };
    }
  } catch {
    // 某些瀏覽器不支援 permissions API，直接進入手動詢問流程。
  }

  const shouldAsk = window.confirm("是否允許本 App 使用麥克風進行語音輸入？");
  if (!shouldAsk) {
    storeDecision("denied");
    return { asked: true, granted: false };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    storeDecision("granted");
    return { asked: true, granted: true };
  } catch {
    storeDecision("denied");
    return { asked: true, granted: false };
  }
}
