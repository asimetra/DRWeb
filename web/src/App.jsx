import { Navigate, Route, Routes } from "react-router-dom";
import { Register } from "./pages/Register.jsx";
import { Login } from "./pages/Login.jsx";
import { Verify } from "./pages/Verify.jsx";
import { Forgot } from "./pages/Forgot.jsx";
import { Reset } from "./pages/Reset.jsx";
import { Account } from "./pages/Account.jsx";
import { Trade } from "./pages/Trade.jsx";

export const App = () => (
  <div className="shell">
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/register" element={<Register />} />
      <Route path="/login" element={<Login />} />
      <Route path="/verify" element={<Verify />} />
      <Route path="/forgot" element={<Forgot />} />
      <Route path="/reset" element={<Reset />} />
      <Route path="/account" element={<Account />} />
      <Route path="/trade" element={<Trade />} />
      <Route path="/trade/:id" element={<Trade />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  </div>
);
