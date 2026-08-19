import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import ChatPage from './pages/ChatPage'
import AdminPage from './pages/AdminPage'
import LibraryPage from './pages/LibraryPage'
import ScenariosPage from './pages/ScenariosPage'
import QuantriShell from './pages/quantri/QuantriShell'
import QuantriSettings from './pages/quantri/QuantriSettings'
import QuantriUsers from './pages/quantri/QuantriUsers'
import QuantriAccount from './pages/quantri/QuantriAccount'
import QuantriBrain from './pages/quantri/QuantriBrain'
import QuantriVoice from './pages/quantri/QuantriVoice'
import QuantriTeach from './pages/quantri/QuantriTeach'
import QuantriRag from './pages/quantri/QuantriRag'
import QuantriScenarios from './pages/quantri/QuantriScenarios'

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
          <Route path="cai-dat" element={<QuantriSettings />} />
          <Route path="bo-nao" element={<QuantriBrain />} />
          <Route path="day-ai" element={<QuantriTeach />} />
          <Route path="tinh-huong" element={<QuantriScenarios />} />
          <Route path="giong-ai" element={<QuantriVoice />} />
          <Route path="rag" element={<QuantriRag />} />
          <Route path="chuyen-muc" element={<Navigate to="/quantri/cai-dat" replace />} />
          <Route path="nhan-su" element={<QuantriUsers />} />
          <Route path="tai-khoan" element={<QuantriAccount />} />
        </Route>
        <Route path="/admin" element={<Navigate to="/quantri" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
