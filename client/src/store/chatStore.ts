import { create } from 'zustand';

// ──────────────────────────────────────────────
// Chat Store — manages chat messages + panel UI state
//
// Follows the same Zustand pattern as collabStore.ts.
// Messages are keyed by PG serial id for dedup.
// ──────────────────────────────────────────────

export interface ChatMessage {
  id: number;           // PG serial id — used for dedup
  userId: number;
  username: string;
  avatarUrl: string | null;
  text: string;
  timestamp: number;    // Unix ms
}

interface ChatStore {
  messages: ChatMessage[];
  isOpen: boolean;
  unreadCount: number;
  hasOlderMessages: boolean;
  loadingOlder: boolean;

  setHistory: (msgs: ChatMessage[]) => void;
  addMessage: (msg: ChatMessage) => void;
  prependMessages: (msgs: ChatMessage[], hasMore: boolean) => void;
  removeMessage: (id: number) => void;
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  setLoadingOlder: (loading: boolean) => void;
  markRead: () => void;
  clear: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  isOpen: false,
  unreadCount: 0,
  hasOlderMessages: true,  // assume yes until server says otherwise
  loadingOlder: false,

  setHistory: (msgs) =>
    set({
      messages: msgs,
      unreadCount: 0,
      // If we got a full page (50), there may be older messages
      hasOlderMessages: msgs.length >= 50,
    }),

  addMessage: (msg) =>
    set((state) => {
      // Dedup by id — PubSub may deliver to sender twice
      if (state.messages.some((m) => m.id === msg.id)) {
        return state;
      }
      return {
        messages: [...state.messages, msg],
        unreadCount: state.isOpen ? state.unreadCount : state.unreadCount + 1,
      };
    }),

  prependMessages: (msgs, hasMore) =>
    set((state) => {
      // Dedup — filter out any ids already present
      const existingIds = new Set(state.messages.map((m) => m.id));
      const newMsgs = msgs.filter((m) => !existingIds.has(m.id));
      return {
        messages: [...newMsgs, ...state.messages],
        hasOlderMessages: hasMore,
        loadingOlder: false,
      };
    }),

  removeMessage: (id) =>
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== id),
    })),

  toggleOpen: () =>
    set((state) => ({
      isOpen: !state.isOpen,
      unreadCount: !state.isOpen ? 0 : state.unreadCount,
    })),

  setOpen: (open) =>
    set({ isOpen: open, unreadCount: open ? 0 : get().unreadCount }),

  setLoadingOlder: (loading) =>
    set({ loadingOlder: loading }),

  markRead: () =>
    set({ unreadCount: 0 }),

  clear: () =>
    set({ messages: [], unreadCount: 0, hasOlderMessages: true, loadingOlder: false }),
}));
