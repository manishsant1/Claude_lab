import { Route, Routes } from 'react-router-dom';
import { LABELS } from '../shared/config';
import Header from './components/Header';
import Home from './pages/Home';
import ResourceDetail from './pages/ResourceDetail';
import Book from './pages/Book';
import Bookings from './pages/Bookings';
import Login from './pages/Login';
import RequireAuth from './components/RequireAuth';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <>
      <Header />
      <main className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/resource/:id" element={<ResourceDetail />} />
          <Route path="/login" element={<Login />} />
          <Route path="/book" element={<RequireAuth><Book /></RequireAuth>} />
          <Route path="/bookings" element={<RequireAuth><Bookings /></RequireAuth>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="footer">{LABELS.appName} demo · no real payment is taken</footer>
    </>
  );
}
