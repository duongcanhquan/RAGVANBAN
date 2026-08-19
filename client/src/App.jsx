import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import ChatPage from './pages/ChatPage'

const LibraryPage = lazy(() => import('./pages/LibraryPage'))
const ScenariosPage = lazy(() => import('./pages/ScenariosPage'))
const QuantriShell = lazy(() => import('./pages/quantri/QuantriShell'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const QuantriSettings = lazy(() => import('./pages/quantri/QuantriSettings'))
const QuantriUsers = lazy(() => import('./pages/quantri/QuantriUsers'))
const QuantriAccount = lazy(() => import('./pages/quantri/QuantriAccount'))
const QuantriBrain = lazy(() => import('./pages/quantri/QuantriBrain'))
const QuantriVoice = lazy(() => import('./pages/quantri/QuantriVoice'))
const QuantriTeach = lazy(() => import('./pages/quantri/QuantriTeach'))
const QuantriRag = lazy(() => import('./pages/quantri/QuantriRag'))
const QuantriScenarios = lazy(() => import('./pages/quantri/QuantriScenarios'))

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center px-4 text-sm text-[var(--hcc-muted)]">
      Đang tải…
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
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
      </Suspense>
    </BrowserRouter>
  )
}
