import { Route, Routes } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'
import Home from './pages/Home'
import Library from './pages/Library'
import Profile from './pages/Profile'
import QueuePage from './pages/Queue'
import Search from './pages/Search'
import Sources from './pages/Sources'

function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<Home />} />
        <Route path="search" element={<Search />} />
        <Route path="library" element={<Library />} />
        <Route path="queue" element={<QueuePage />} />
        <Route path="profile" element={<Profile />} />
        <Route path="sources" element={<Sources />} />
      </Route>
    </Routes>
  )
}

export default App
