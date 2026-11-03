-- Proby zlamania kazdego constraintu recznym INSERT / DELETE (Zadanie 03, cz. 1).
-- Kazda instrukcja oznaczona "BLAD OCZEKIWANY" musi skonczyc sie ERROR-em z bazy.
-- Uruchomienie (PowerShell):
--   Get-Content scripts\constraint-checks.sql | docker compose exec -T db psql -a -U roombooking -d roombooking
-- (-a wypisuje kazda instrukcje przed jej wynikiem). Skrypt sam czysci dane na poczatku i na koncu.
-- Wymaga kont uzytkownikow z seeda (user_id 2-6): npm run seed:run

TRUNCATE reservations, rooms, buildings RESTART IDENTITY CASCADE;

\echo
\echo '=== Dane bazowe (poprawne, powinny przejsc) ==='
INSERT INTO buildings (name, address) VALUES ('Budynek A', 'ul. Warszawska 24, Krakow');
INSERT INTO buildings (name, address) VALUES ('Budynek B', 'ul. Florianska 1, Krakow');
INSERT INTO rooms (building_id, name, capacity) VALUES (1, '101', 30);
INSERT INTO reservations (room_id, user_id, participants, start_time, end_time)
VALUES (1, 3, 20, '2026-11-10 10:00:00+00', '2026-11-10 12:00:00+00');

\echo
\echo '=== 1. buildings.name UNIQUE - duplikat nazwy budynku (BLAD OCZEKIWANY) ==='
INSERT INTO buildings (name, address) VALUES ('Budynek A', 'inny adres');

\echo
\echo '=== 2a. rooms (building_id, name) UNIQUE - sala "101" drugi raz w budynku 1 (BLAD OCZEKIWANY) ==='
INSERT INTO rooms (building_id, name, capacity) VALUES (1, '101', 40);

\echo
\echo '=== 2b. ta sama nazwa "101" w INNYM budynku jest dozwolona (powinno przejsc) ==='
INSERT INTO rooms (building_id, name, capacity) VALUES (2, '101', 40);

\echo
\echo '=== 3a. rooms.capacity CHECK (> 0) - capacity = 0 (BLAD OCZEKIWANY) ==='
INSERT INTO rooms (building_id, name, capacity) VALUES (1, '102', 0);

\echo
\echo '=== 3b. rooms.capacity CHECK (> 0) - capacity = -5 (BLAD OCZEKIWANY) ==='
INSERT INTO rooms (building_id, name, capacity) VALUES (1, '103', -5);

\echo
\echo '=== 4a. reservations: end_time > start_time - koniec przed poczatkiem (BLAD OCZEKIWANY) ==='
INSERT INTO reservations (room_id, user_id, participants, start_time, end_time)
VALUES (1, 4, 5, '2026-11-11 12:00:00+00', '2026-11-11 10:00:00+00');

\echo
\echo '=== 4b. reservations: end_time > start_time - koniec rowny poczatkowi (BLAD OCZEKIWANY) ==='
INSERT INTO reservations (room_id, user_id, participants, start_time, end_time)
VALUES (1, 4, 5, '2026-11-11 10:00:00+00', '2026-11-11 10:00:00+00');

\echo
\echo '=== 5. reservations.status CHECK - niedozwolony status "DONE" (BLAD OCZEKIWANY) ==='
INSERT INTO reservations (room_id, user_id, participants, start_time, end_time, status)
VALUES (1, 4, 5, '2026-11-12 10:00:00+00', '2026-11-12 12:00:00+00', 'DONE');

\echo
\echo '=== 6. reservations.participants CHECK (> 0) - participants = 0 (BLAD OCZEKIWANY) ==='
INSERT INTO reservations (room_id, user_id, participants, start_time, end_time)
VALUES (1, 4, 0, '2026-11-13 10:00:00+00', '2026-11-13 12:00:00+00');

\echo
\echo '=== 7a. FK rooms.building_id - nieistniejacy budynek 999 (BLAD OCZEKIWANY) ==='
INSERT INTO rooms (building_id, name, capacity) VALUES (999, '201', 10);

\echo
\echo '=== 7b. FK reservations.room_id - nieistniejaca sala 999 (BLAD OCZEKIWANY) ==='
INSERT INTO reservations (room_id, user_id, participants, start_time, end_time)
VALUES (999, 4, 5, '2026-11-14 10:00:00+00', '2026-11-14 12:00:00+00');

\echo
\echo '=== 7c. FK reservations.user_id - nieistniejacy uzytkownik 999 (BLAD OCZEKIWANY) ==='
INSERT INTO reservations (room_id, user_id, participants, start_time, end_time)
VALUES (1, 999, 5, '2026-11-14 12:00:00+00', '2026-11-14 14:00:00+00');

\echo
\echo '=== 8. NOT NULL - user_id = NULL (BLAD OCZEKIWANY) ==='
INSERT INTO reservations (room_id, user_id, participants, start_time, end_time)
VALUES (1, NULL, 5, '2026-11-15 10:00:00+00', '2026-11-15 12:00:00+00');

\echo
\echo '=== 9a. ON DELETE RESTRICT - usuniecie budynku 1, ktory ma sale (BLAD OCZEKIWANY) ==='
DELETE FROM buildings WHERE id = 1;

\echo
\echo '=== 9b. ON DELETE RESTRICT - usuniecie sali 1, ktora ma rezerwacje (BLAD OCZEKIWANY) ==='
DELETE FROM rooms WHERE id = 1;

\echo
\echo '=== Stan koncowy: w bazie zostaly tylko poprawne dane bazowe ==='
SELECT (SELECT count(*) FROM buildings) AS buildings,
       (SELECT count(*) FROM rooms) AS rooms,
       (SELECT count(*) FROM reservations) AS reservations;

TRUNCATE reservations, rooms, buildings RESTART IDENTITY CASCADE;
