// The app's vocabulary and business rules, in one place. Used by both the browser and the server.
// Changing the domain (courts -> salon chairs -> meeting rooms) starts here.
export const LABELS = {
  appName: '__APP_NAME__',
  appEmoji: '__EMOJI__',
  resource: '__RESOURCE__',      // singular, e.g. "Court"
  resources: '__RESOURCES__',    // plural,   e.g. "Courts"
  booking: 'Booking',            // what a customer makes, e.g. "Appointment", "Reservation"
  bookings: 'Bookings',
  slot: 'slot',                  // one bookable unit of time, e.g. "session"
};

export const CURRENCY = 'USD';
export const TAX_RATE = 0;                  // e.g. 0.08 for 8%
export const MAX_ADVANCE_DAYS = 30;         // how far ahead a booking may be made
export const CANCEL_CUTOFF_HOURS = 2;       // customers can't cancel closer to the start than this
export const MAX_ACTIVE_BOOKINGS_PER_CLIENT = 10; // anonymous identity: stop one browser hoarding slots
