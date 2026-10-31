// All server calls go through here. The API lives on the same origin under /api,
// so no base URL or CORS setup is needed. The session cookie from sign-in is sent automatically;
// see src/api/auth.js for sign-in/up/out.
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.details);
  return data;
}

export const getCategories = () => request('/categories');
export const getResources = () => request('/resources');
export const getBookings = () => request('/bookings');

export async function getResource(id) {
  try {
    return await request(`/resources/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

export const getAvailability = (id, date) =>
  request(`/resources/${encodeURIComponent(id)}/availability?date=${encodeURIComponent(date)}`);

// Only what the customer chose is sent; the server checks hours and availability and sets the price.
export const createBooking = ({ resourceId, date, startMin, slots, customer }) =>
  request('/bookings', { method: 'POST', body: { resourceId, date, startMin, slots, customer } });

export const cancelBooking = (id) => request(`/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
