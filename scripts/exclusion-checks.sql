-- Proby zlamania exclusion constraintu reservations_no_overlap recznym INSERT (Zadanie 03, cz. 5).
-- Instrukcje oznaczone "BLAD OCZEKIWANY" musza skonczyc sie ERROR-em 23P01, pozostale musza przejsc.
-- Uruchomienie (cmd, w katalogu projektu):
--   docker cp scripts\exclusion-checks.sql roombooking-db:/tmp/exclusion-checks.sql && docker compose exec -T db sh -c "stdbuf -oL psql -a -U roombooking -d roombooking -f /tmp/exclusion-checks.sql 2>&1"
-- Skrypt sam czysci dane na poczatku i na koncu. Wymaga kont uzytkownikow z seeda (user_id 2-6): npm run seed:run

TRUNCATE reservations, rooms, buildings RESTART IDENTITY CASCADE;
INSERT INTO buildings (name, address) VALUES ('Budynek A', 'ul. Warszawska 24, Krakow');
INSERT INTO rooms (building_id, name, capacity) VALUES (1, '101', 30), (1, '102', 30);

\echo
\echo '=== 1. Rezerwacja bazowa: sala 1, 10:00-12:00, CONFIRMED (powinno przejsc) ==='
INSERT INTO reservations (room_id, user_id, participants, start_time, end_time, status)
VALUES (1, 3, 10, '2026-12-10 10:00+00', '2026-12-10 12:00+00', 'CONFIRMED');

\echo
\echo '=== 2. Nakladajaca sie CONFIRMED 11:00-13:00 w tej samej sali (BLAD OCZEKIWANY 23P01) ==='
INSERT INTO reservations (room_id, user_id, participants, start_time, end_time, status)
VALUES (1, 4, 10, '2026-12-10 11:00+00', '2026-12-10 13:00+00', 'CONFIRMED');

\echo
\echo '=== 3. Zawierajaca cala istniejaca CONFIRMED 09:00-13:00 (BLAD OCZEKIWANY 23P01) ==='
INSERT INTO reservations (room_id, user_id, participants, start_time, end_time, status)
VALUES (1, 4, 10, '2026-12-10 09:00+00', '2026-12-10 13:00+00', 'CONFIRMED');

\echo
\echo '=== 4. Stykajaca sie 12:00-13:00 - koniec jednej = poczatek drugiej (powinno przejsc) ==='
INSERT INTO reservations (room_id, user_id, participants, start_time, end_time, status)
VALUES (1, 4, 10, '2026-12-10 12:00+00', '2026-12-10 13:00+00', 'CONFIRMED');

\echo
\echo '=== 5. Stykajaca sie 08:00-10:00 (powinno przejsc) ==='
INSERT INTO reservations (room_id, user_id, participants, start_time, end_time, status)
VALUES (1, 2, 10, '2026-12-10 08:00+00', '2026-12-10 10:00+00', 'CONFIRMED');

\echo
\echo '=== 6. Ten sam przedzial 10:00-12:00, ale w INNEJ sali (powinno przejsc) ==='
INSERT INTO reservations (room_id, user_id, participants, start_time, end_time, status)
VALUES (2, 6, 10, '2026-12-10 10:00+00', '2026-12-10 12:00+00', 'CONFIRMED');

\echo
\echo '=== 7. Ten sam przedzial 10:00-12:00 jako CANCELLED - anulowana nie blokuje (powinno przejsc) ==='
INSERT INTO reservations (room_id, user_id, participants, start_time, end_time, status, cancelled_at)
VALUES (1, 5, 10, '2026-12-10 10:00+00', '2026-12-10 12:00+00', 'CANCELLED', now());

\echo
\echo '=== 8. Przywrocenie anulowanej (rezerwacja z kroku 7) do CONFIRMED w zajetym terminie (BLAD OCZEKIWANY 23P01) ==='
UPDATE reservations SET status = 'CONFIRMED', cancelled_at = NULL WHERE user_id = 5;

\echo
\echo '=== 9. Anulowana rezerwacja zwalnia termin: anulujemy bazowa 10:00-12:00 i dodajemy nowa CONFIRMED w tym samym terminie (powinno przejsc) ==='
UPDATE reservations SET status = 'CANCELLED', cancelled_at = now() WHERE user_id = 3;
INSERT INTO reservations (room_id, user_id, participants, start_time, end_time, status)
VALUES (1, 3, 10, '2026-12-10 10:00+00', '2026-12-10 12:00+00', 'CONFIRMED');

\echo
\echo '=== Stan koncowy sali 1 (aktywne i anulowane rezerwacje) ==='
SELECT id, room_id, user_id, start_time, end_time, status FROM reservations WHERE room_id = 1 ORDER BY start_time, id;

TRUNCATE reservations, rooms, buildings RESTART IDENTITY CASCADE;
