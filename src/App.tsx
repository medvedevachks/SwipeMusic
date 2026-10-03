import { Route, Routes } from 'react-router-dom'
import {
  AuthGate,
  RequireAnonymous,
  RequireAuth,
} from './components/auth/AuthGate'
import LibraryBootstrap from './services/libraryPersistence/LibraryBootstrap'
import MainLayout from './layouts/MainLayout'
import Home from './pages/Home'
import Library from './pages/Library'
import Login from './pages/Login'
import Profile from './pages/Profile'
import QueuePage from './pages/Queue'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Search from './pages/Search'
import Sources from './pages/Sources'

function App() {
  return (
    <AuthGate>
      <LibraryBootstrap />
      <Routes>
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="reset-password" element={<ResetPassword />} />
        <Route element={<RequireAnonymous />}>
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route element={<MainLayout />}>
            <Route index element={<Home />} />
            <Route path="search" element={<Search />} />
            <Route path="library" element={<Library />} />
            <Route path="queue" element={<QueuePage />} />
            <Route path="profile" element={<Profile />} />
            <Route path="sources" element={<Sources />} />
          </Route>
        </Route>
      </Routes>
    </AuthGate>
  )
}

export default App
