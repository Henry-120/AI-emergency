/**
 * 把照片縮到長邊 maxSize、轉成 JPEG data URL，給 AI 分析用。
 * 手機原圖動輒數 MB，原封不動上傳又慢又耗流量；判斷現場狀況也用不到那麼高的解析度。
 */
export async function compressImageToDataUrl(
  file: Blob,
  maxSize = 1280,
  quality = 0.8,
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("無法處理照片");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    bitmap.close();
  }
}
