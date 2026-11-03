// Role w systemie. USER: przegląda budynki i sale, tworzy i anuluje własne rezerwacje.
// ADMIN: wszystko co USER + zarządza budynkami i salami + widzi i anuluje wszystkie rezerwacje.
const ROLE = Object.freeze({ USER: 'USER', ADMIN: 'ADMIN' });

module.exports = { ROLE };
