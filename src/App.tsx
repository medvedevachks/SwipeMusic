import { Route, Routes } from 'react-router-dom'
import ImportPrompt from './components/ImportPrompt'
import AuthLayout from './layouts/AuthLayout'
import MainLayout from './layouts/MainLayout'
import ForgotPassword from './pages/ForgotPassword'
import Home from './pages/Home'
import Library from './pages/Library'
import Login from './pages/Login'
import Player from './pages/Player'
import Profile from './pages/Profile'
import Register from './pages/Register'
import ResetPassword from './pages/ResetPassword'
import Search from './pages/Search'

function App() {
  return (
    <>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="forgot-password" element={<ForgotPassword />} />
          <Route path="reset-password" element={<ResetPassword />} />
        </Route>
        <Route element={<MainLayout />}>
          <Route index element={<Home />} />
          <Route path="search" element={<Search />} />
          <Route path="library" element={<Library />} />
          <Route path="player" element={<Player />} />
          <Route path="profile" element={<Profile />} />
        </Route>
      </Routes>
      <ImportPrompt />
    </>
  )
}

export default App
