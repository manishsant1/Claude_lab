import { Link, NavLink, useNavigate } from 'react-router-dom';
import { LABELS } from '../../shared/config';
import { signOut, useSession } from '../api/auth';

export default function Header() {
  const { data: session } = useSession();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut().catch(() => {});
    navigate('/');
  }

  return (
    <header className="header">
      <div className="container header-inner">
        <Link to="/" className="logo">{LABELS.appEmoji} {LABELS.appName}</Link>
        <nav className="nav">
          <NavLink to="/" end>{LABELS.resources}</NavLink>
          <NavLink to="/bookings">My {LABELS.bookings.toLowerCase()}</NavLink>
          {session ? (
            <>
              <span className="nav-user muted small">{session.user.name}</span>
              <button className="link-btn" onClick={handleSignOut}>Sign out</button>
            </>
          ) : (
            <NavLink to="/login">Sign in</NavLink>
          )}
        </nav>
      </div>
    </header>
  );
}
