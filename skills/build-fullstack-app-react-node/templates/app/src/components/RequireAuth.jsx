import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '../api/auth';

// Wraps pages that need an account. Sends anonymous visitors to /login and brings them back
// (with any router state, e.g. the chosen slot) afterwards.
export default function RequireAuth({ children }) {
  const { data: session, isPending } = useSession();
  const location = useLocation();
  if (isPending) return <p className="muted">Loading…</p>;
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}
