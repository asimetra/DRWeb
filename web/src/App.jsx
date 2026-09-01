import { Navigate, Route, Routes } from "react-router-dom";
import { ViewerProvider } from "./viewer.jsx";
import { Home } from "./pages/Home.jsx";
import { Leaderboard } from "./pages/Leaderboard.jsx";
import { Register } from "./pages/Register.jsx";
import { Login } from "./pages/Login.jsx";
import { Verify } from "./pages/Verify.jsx";
import { Forgot } from "./pages/Forgot.jsx";
import { Reset } from "./pages/Reset.jsx";
import { Account } from "./pages/Account.jsx";
import { Market } from "./pages/Market.jsx";
import { Player } from "./pages/Player.jsx";

export const App = () => (
  <ViewerProvider>
    <div className="shell">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/reset" element={<Reset />} />
        <Route path="/account" element={<Account />} />
        <Route path="/market" element={<Market />} />
        <Route path="/player/:name" element={<Player />} />
        {/* Anything unknown lands on the front page rather than a login form. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  </ViewerProvider>
);
