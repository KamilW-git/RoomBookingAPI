// Kontrola jakości testów: celowo psuje regułę nakładania się terminów (< zamienione na <=),
// uruchamia unit testy i sprawdza, czy któryś test wykrył błąd. Oryginalny kod jest ZAWSZE przywracany
// (także po błędzie i po Ctrl+C), więc skrypt nie zostawia zepsutego pliku.
// Uruchomienie: npm run test:mutation-overlap
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const file = path.join(__dirname, '..', 'src', 'modules', 'reservations', 'reservations.service.js');
const correct = 'a.startTime.getTime() < b.endTime.getTime() && b.startTime.getTime() < a.endTime.getTime()';
const broken = 'a.startTime.getTime() <= b.endTime.getTime() && b.startTime.getTime() <= a.endTime.getTime()';

const original = fs.readFileSync(file, 'utf8');
if (!original.includes(correct)) {
  console.error('Nie znaleziono reguły nakładania w reservations.service.js - skrypt nie zmienia pliku.');
  process.exit(1);
}

const restore = () => fs.writeFileSync(file, original);
process.on('SIGINT', () => {
  restore();
  process.exit(130);
});

let result;
try {
  fs.writeFileSync(file, original.replace(correct, broken));
  console.log('Wprowadzony błąd w overlaps():');
  console.log(`  było:   ${correct}`);
  console.log(`  jest:   ${broken}\n`);

  // Pełne nazwy testów i raport porażek; shell: true, żeby npx działało także w Windows
  result = spawnSync('npx jest --selectProjects unit --verbose', { stdio: 'inherit', shell: true });
} finally {
  restore();
  console.log('\nPrzywrócono poprawny kod reservations.service.js.');
}

if (result.status === 0) {
  console.log('WYNIK: żaden test nie wykrył błędu - brakuje testu przypadku brzegowego!');
  process.exit(1);
}
console.log('WYNIK: testy wykryły wprowadzony błąd (patrz testy oznaczone jako failed powyżej).');
