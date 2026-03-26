import { create } from 'zustand';
import { ConnectedRepo } from '../api/admin.js';

interface RepoStore {
  repos: ConnectedRepo[];
  selectedRepo: ConnectedRepo | null;
  selectedBranch: string | null;
  fileTree: { path: string; type: string }[] | null;
  loading: boolean;

  setRepos: (repos: ConnectedRepo[]) => void;
  selectRepo: (repo: ConnectedRepo) => void;
  selectBranch: (branch: string) => void;
  setFileTree: (tree: { path: string; type: string }[]) => void;
  setLoading: (loading: boolean) => void;
  clear: () => void;
}

export const useRepoStore = create<RepoStore>((set) => ({
  repos: [],
  selectedRepo: null,
  selectedBranch: null,
  fileTree: null,
  loading: false,

  setRepos: (repos) => set({ repos }),
  selectRepo: (repo) => set({ selectedRepo: repo, selectedBranch: null, fileTree: null }),
  selectBranch: (branch) => set({ selectedBranch: branch, fileTree: null }),
  setFileTree: (tree) => set({ fileTree: tree }),
  setLoading: (loading) => set({ loading }),
  clear: () => set({ repos: [], selectedRepo: null, selectedBranch: null, fileTree: null }),
}));
