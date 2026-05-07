import { useCallback, useEffect, useState } from "react";

const CURRENT_PROJECT_STORAGE_KEY = "sidebar_project_id";
const CURRENT_PROJECT_EVENT = "qaira:current-project-change";
const CURRENT_APP_TYPE_STORAGE_KEY = "sidebar_app_type_id";
const CURRENT_APP_TYPE_EVENT = "qaira:current-app-type-change";

const dispatchScopedEvent = (eventName: string, detail: Record<string, string>) => {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(eventName, { detail }));
};

const readCurrentProjectId = () => {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY) || "";
};

const writeCurrentProjectId = (projectId: string | number) => {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedId = projectId != null ? String(projectId) : "";

  if (normalizedId) {
    window.localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, normalizedId);
  } else {
    window.localStorage.removeItem(CURRENT_PROJECT_STORAGE_KEY);
  }

  dispatchScopedEvent(CURRENT_PROJECT_EVENT, { projectId: normalizedId });
};

export function useCurrentProject() {
  const [projectId, setProjectIdState] = useState(readCurrentProjectId);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncProjectId = (event?: Event) => {
      const detailProjectId = event instanceof CustomEvent && event.detail?.projectId != null
        ? String(event.detail.projectId)
        : null;
      setProjectIdState(detailProjectId ?? readCurrentProjectId());
    };

    window.addEventListener("storage", syncProjectId);
    window.addEventListener(CURRENT_PROJECT_EVENT, syncProjectId);

    return () => {
      window.removeEventListener("storage", syncProjectId);
      window.removeEventListener(CURRENT_PROJECT_EVENT, syncProjectId);
    };
  }, []);

  const setProjectId = useCallback((nextProjectId: string | number) => {
    const normalizedId = nextProjectId != null ? String(nextProjectId) : "";
    setProjectIdState(normalizedId);
    writeCurrentProjectId(normalizedId);
  }, []);

  return [projectId, setProjectId] as const;
}

const readStoredAppTypeMap = () => {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(CURRENT_APP_TYPE_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
};

const readCurrentAppTypeId = (projectId: string) => {
  if (!projectId) {
    return "";
  }

  return readStoredAppTypeMap()[projectId] || "";
};

const writeCurrentAppTypeId = (projectId: string, appTypeId: string) => {
  if (typeof window === "undefined" || !projectId) {
    return;
  }

  const next = readStoredAppTypeMap();

  if (appTypeId) {
    next[projectId] = appTypeId;
  } else {
    delete next[projectId];
  }

  window.localStorage.setItem(CURRENT_APP_TYPE_STORAGE_KEY, JSON.stringify(next));
  dispatchScopedEvent(CURRENT_APP_TYPE_EVENT, { projectId, appTypeId });
};

export function useCurrentAppType(projectId: string) {
  const [appTypeId, setAppTypeIdState] = useState(() => readCurrentAppTypeId(projectId));

  useEffect(() => {
    setAppTypeIdState(readCurrentAppTypeId(projectId));
  }, [projectId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncAppTypeId = (event?: Event) => {
      if (event instanceof CustomEvent && typeof event.detail?.projectId === "string" && event.detail.projectId !== projectId) {
        return;
      }

      setAppTypeIdState(readCurrentAppTypeId(projectId));
    };

    window.addEventListener("storage", syncAppTypeId);
    window.addEventListener(CURRENT_APP_TYPE_EVENT, syncAppTypeId);

    return () => {
      window.removeEventListener("storage", syncAppTypeId);
      window.removeEventListener(CURRENT_APP_TYPE_EVENT, syncAppTypeId);
    };
  }, [projectId]);

  const setAppTypeId = useCallback((nextAppTypeId: string) => {
    setAppTypeIdState(nextAppTypeId);
    writeCurrentAppTypeId(projectId, nextAppTypeId);
  }, [projectId]);

  return [appTypeId, setAppTypeId] as const;
}
