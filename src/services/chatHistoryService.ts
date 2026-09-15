import type { ChatMessage } from '../types';

const keyFor = (userId: string) => `guardia_chat_history:${encodeURIComponent(userId)}`;

export function loadChatHistory(userId: string): ChatMessage[] {
  try {
    const rows = JSON.parse(localStorage.getItem(keyFor(userId)) || '[]');
    if (!Array.isArray(rows)) return [];
    return rows.filter((row) => row && typeof row.id === 'string'
      && ['user', 'assistant'].includes(row.role) && typeof row.content === 'string'
      && Number.isFinite(Date.parse(row.timestamp)))
      .map((row) => ({ ...row, timestamp: new Date(row.timestamp) }));
  } catch { return []; }
}

export function saveChatHistory(userId: string, messages: ChatMessage[]): void {
  try { localStorage.setItem(keyFor(userId), JSON.stringify(messages)); }
  catch { console.warn('聊天記錄無法儲存在此裝置'); }
}
