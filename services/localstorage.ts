export const uploadPendingData = async (pendingData: any[]) => {
  if (pendingData.length === 0) return;

  try {
    // 呼叫我們剛才討論的 FastAPI 批量接口
    const response = await fetch("http://localhost:8000/api/sync/bulk_status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: pendingData }), // 注意這裡要包在 records 欄位裡
    });

    if (response.ok) {
      console.log("離線數據同步成功！");
      localStorage.removeItem("pending_status"); // 清空已同步的資料
    }
  } catch (error) {
    console.error("同步失敗，等待下次連線：", error);
  }
};
