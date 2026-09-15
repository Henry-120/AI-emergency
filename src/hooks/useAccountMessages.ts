import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { ChatMessage } from '../types';
import { loadChatHistory, saveChatHistory } from '../services/chatHistoryService';

const welcome = (): ChatMessage[] => [{
  id: '1', role: 'assistant',
  content: '我是 GuardiaAI 生存助手。請描述您目前遇到的緊急狀況，或直接上傳現場照片。',
  timestamp: new Date(),
}];

export function useAccountMessages(userId: string | null) {
  const active = useRef({ userId, generation: 0 });
  if (active.current.userId !== userId) {
    active.current = { userId, generation: active.current.generation + 1 };
  }
  const generation = active.current.generation;
  const [state, setState] = useState(() => ({ userId, generation, messages: userId ? loadChatHistory(userId) : [] }));
  const current = state.userId === userId && state.generation === generation;
  const messages = current ? state.messages : [];
  useEffect(() => {
    const loaded = userId ? loadChatHistory(userId) : [];
    setState({ userId, generation, messages: userId ? loaded.length ? loaded : welcome() : [] });
  }, [userId, generation]);
  const setMessages = useCallback((update: SetStateAction<ChatMessage[]>) => {
    if (!userId || active.current.userId !== userId || active.current.generation !== generation) return;
    setState((previous) => {
      if (active.current.userId !== userId || active.current.generation !== generation) return previous;
      const base = previous.userId === userId && previous.generation === generation ? previous.messages : loadChatHistory(userId);
      return { userId, generation, messages: typeof update === 'function' ? update(base) : update };
    });
  }, [userId, generation]);
  useEffect(() => {
    if (userId && current) saveChatHistory(userId, state.messages);
  }, [userId, current, state]);
  return [messages, setMessages] as const;
}
