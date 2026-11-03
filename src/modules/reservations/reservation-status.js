const STATUS = Object.freeze({ CONFIRMED: 'CONFIRMED', CANCELLED: 'CANCELLED' });

const ALLOWED_TRANSITIONS = Object.freeze({
  [STATUS.CONFIRMED]: [STATUS.CANCELLED],
  [STATUS.CANCELLED]: [],
});

function canTransition(from, to) {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

module.exports = { STATUS, ALLOWED_TRANSITIONS, canTransition };
