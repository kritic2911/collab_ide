import { create } from 'zustand';

interface FileStore {
  // Map of filePath → raw file content
  openFiles: Map<string, string>;
  activePath: string | null;
  activeBranch: string | null;

  setFileContent: (path: string, content: string) => void;
  setActivePath: (path: string) => void;
  setActiveBranch: (branch: string) => void;
}

export const useFileStore = create<FileStore>((set) => ({
  openFiles: new Map(),
  activePath: null,
  activeBranch: null,

  setFileContent: (path, content) =>
    set(state => {
      const next = new Map(state.openFiles);
      next.set(path, content);
      return { openFiles: next, activePath: path };
    }),

  setActivePath: (path) => set({ activePath: path }),
  setActiveBranch: (branch) => set({ activeBranch: branch, openFiles: new Map(), activePath: null }),
}));