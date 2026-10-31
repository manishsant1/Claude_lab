import { Link } from 'react-router-dom';
import { LABELS } from '../../shared/config';

export default function NotFound() {
  return (
    <div className="empty">
      <h2>Page not found</h2>
      <Link to="/" className="btn">Browse {LABELS.resources.toLowerCase()}</Link>
    </div>
  );
}
