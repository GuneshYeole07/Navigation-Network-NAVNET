import { createContext, useContext, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { useAuth } from "./AuthContext";
import { API_BASE } from "../services/api";

const SocketContext = createContext({ socket: null, connected: false });

/** One authenticated socket per session; reconnects automatically. */
export function SocketProvider({ children }) {
  const { token, user } = useAuth();
  const userId = user?.id;
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!token || !userId) return undefined;
    const s = io(import.meta.env.VITE_SOCKET_URL || API_BASE || undefined, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnectionDelayMax: 5000,
    });
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    s.on("connect", on);
    s.on("disconnect", off);
    s.on("connect_error", off);
    setSocket(s);
    return () => {
      s.close();
      setSocket(null);
      setConnected(false);
    };
  }, [token, userId]);

  return <SocketContext.Provider value={{ socket, connected }}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);
