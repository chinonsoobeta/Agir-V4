import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyWorkspaces, PERSONAL_WORKSPACE_ID, type Workspace } from "./workspaces.functions";
import { savePreferenceData } from "./preferences.functions";

type WorkspaceContextValue = {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  activeWorkspaceId: string;
  setActiveWorkspace: (id: string) => void;
  isLoading: boolean;
  refetch: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const ACTIVE_KEY = "agir-active-workspace";

function storedActive(): string {
  if (typeof window === "undefined") return PERSONAL_WORKSPACE_ID;
  return window.localStorage.getItem(ACTIVE_KEY) || PERSONAL_WORKSPACE_ID;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string>(storedActive);
  const saveFn = useServerFn(savePreferenceData);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => listMyWorkspaces(),
    staleTime: 60_000,
  });
  const workspaces = useMemo(() => data ?? [], [data]);

  // The resolved active workspace: the stored id if still a member, else the first.
  const activeWorkspace = useMemo(() => {
    if (!workspaces.length) return null;
    return workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  }, [workspaces, activeId]);

  const setActiveWorkspace = useCallback(
    (id: string) => {
      setActiveId(id);
      if (typeof window !== "undefined") window.localStorage.setItem(ACTIVE_KEY, id);
      // Best-effort server mirror; ignore when preferences table is absent.
      Promise.resolve(saveFn({ data: { key: "activeWorkspaceId", value: id } })).catch(() => {});
    },
    [saveFn],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      activeWorkspace,
      activeWorkspaceId: activeWorkspace?.id ?? PERSONAL_WORKSPACE_ID,
      setActiveWorkspace,
      isLoading,
      refetch: () => void refetch(),
    }),
    [workspaces, activeWorkspace, setActiveWorkspace, isLoading, refetch],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return value;
}
