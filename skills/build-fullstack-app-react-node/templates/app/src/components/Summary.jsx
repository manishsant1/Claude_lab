import { TAX_RATE } from '../../shared/config';
import { formatPrice } from '../lib/format';

export default function Summary({ totals }) {
  return (
    <dl className="summary">
      <dt>Subtotal</dt><dd>{formatPrice(totals.subtotal)}</dd>
      {TAX_RATE > 0 && <><dt>Tax ({Math.round(TAX_RATE * 100)}%)</dt><dd>{formatPrice(totals.tax)}</dd></>}
      <dt className="total">Total</dt><dd className="total">{formatPrice(totals.total)}</dd>
    </dl>
  );
}
