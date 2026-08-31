import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api.js";

/**
 * Who is looking, when anybody is.
 *
 * Signed out is an ordinary state rather than an error: most of this site can
 * be read without an account, and the header has to say "Log in" or "Account"
 * without every page having to ask. So a 401 from `/api/me` resolves to null
 * here instead of throwing.
 */
const ViewerContext = createContext({ viewer: null, ready: false, refresh: async () => {} });

export const ViewerProvider = ({ children }) => {
  const [state, setState] = useState({ viewer: null, ready: false });

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me();
      setState({ viewer: user, ready: true });
    } catch {
      setState({ viewer: null, ready: true });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <ViewerContext.Provider value={{ ...state, refresh }}>{children}</ViewerContext.Provider>
  );
};

export const useViewer = () => useContext(ViewerContext);
