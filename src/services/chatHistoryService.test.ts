import { beforeEach, expect, it, vi } from 'vitest';
import { loadChatHistory, saveChatHistory } from './chatHistoryService';
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value) });
});
it('keeps different account conversations separate and restores dates', () => {
  saveChatHistory('a', [{ id: 'a1', role: 'user', content: 'A private message', timestamp: new Date() }]);
  expect(loadChatHistory('b')).toEqual([]);
  saveChatHistory('b', [{ id: 'b1', role: 'user', content: 'B private message', timestamp: new Date() }]);
  expect(loadChatHistory('a')[0].content).toBe('A private message');
  expect(loadChatHistory('b')[0].content).toBe('B private message');
  expect(loadChatHistory('a')[0].timestamp).toBeInstanceOf(Date);
});
