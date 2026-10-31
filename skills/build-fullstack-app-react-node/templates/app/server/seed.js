// Starter data, loaded the first time the server starts against an empty database.
// REPLACE this with data for the real domain (the example below is tennis courts).
// openMin / closeMin are minutes since midnight in `timezone`; 480 = 8:00, 1320 = 22:00.
const TZ = 'America/New_York';

export const RESOURCES = [
  { id: 'court-1', name: 'Center Court', category: 'Hard', emoji: '🎾', pricePerSlot: 30, slotMinutes: 60, openMin: 480, closeMin: 1320, maxSlots: 3, timezone: TZ, description: 'Show court with stadium seating and floodlights.' },
  { id: 'court-2', name: 'Court 2', category: 'Hard', emoji: '🎾', pricePerSlot: 24, slotMinutes: 60, openMin: 480, closeMin: 1320, maxSlots: 3, timezone: TZ, description: 'Standard hard court with floodlights.' },
  { id: 'court-3', name: 'Clay Court', category: 'Clay', emoji: '🟠', pricePerSlot: 28, slotMinutes: 60, openMin: 480, closeMin: 1200, maxSlots: 2, timezone: TZ, description: 'Slow red clay, brushed between bookings.' },
  { id: 'court-4', name: 'Practice Wall', category: 'Practice', emoji: '🧱', pricePerSlot: 8, slotMinutes: 30, openMin: 420, closeMin: 1260, maxSlots: 4, timezone: TZ, description: 'Half-hour solo sessions against the backboard.' },
];
