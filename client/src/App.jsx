import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import ChatPage from './pages/ChatPage'
import AdminPage from './pages/AdminPage'
import LibraryPage from './pages/LibraryPage'
import ScenariosPage from './pages/ScenariosPage'
import QuantriShell from './pages/quantri/QuantriShell'
import QuantriUsers from './pages/quantri/QuantriUsers'
import QuantriAccount from './pages/quantri/QuantriAccount'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<ChatPage />} />
          <Route path="/thu-vien" element={<LibraryPage />} />
          <Route path="/tinh-huong" element={<ScenariosPage />} />
        </Route>
        <Route path="/quantri" element={<QuantriShell />}>
          <Route index element={<AdminPage />} />
          <Route path="nhan-su" element={<QuantriUsers />} />
          <Route path="tai-khoan" element={<QuantriAccount />} />
        </Route>
        <Route path="/admin" element={<Navigate to="/quantri" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
