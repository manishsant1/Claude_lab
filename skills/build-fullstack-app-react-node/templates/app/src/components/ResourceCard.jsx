import { Link } from 'react-router-dom';
import { formatPrice } from '../lib/format';

export default function ResourceCard({ resource }) {
  return (
    <Link to={`/resource/${resource.id}`} className="card card-link">
      <div className="thumb">{resource.emoji}</div>
      <div className="card-body">
        <span className="muted small">{resource.category}</span>
        <h3>{resource.name}</h3>
        <p className="muted small">{resource.description}</p>
        <div className="price">
          {formatPrice(resource.pricePerSlot)} <span className="muted small">/ {resource.slotMinutes} min</span>
        </div>
      </div>
    </Link>
  );
}
