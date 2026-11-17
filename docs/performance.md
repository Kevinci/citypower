# Performance-Test Citypower (13.11.2026)

## So wird getestet

- **Im Browser:** Spiel mit `?bench` öffnen (geht auch im Produktions-Build auf jedem Rechner), warten bis die Stadt
  steht, in der Konsole `await __city.bench()` ausführen. Optionen: `{ rounds: 12, seconds: 4, skip: ["frames"] }`.
  Der Test speichert den Spielstand vorher und stellt ihn danach wieder her.
  - **Takt:** Dauer von `tick()` bei Tempo 1/2/3, aufgeteilt in Abschnitte (`lib/city/perf.ts`), React-Rendering danach,
    Stadtwachstum als eigener Schritt.
  - **Bilder:** Bildzeit (Mittel, p95, Maximum) aus vier Kamerapositionen bei Tag und Nacht.
  - **Ruckler:** Bilder über 50 ms und lange Haupt-Thread-Aufgaben bei laufendem Spiel.
- **Schwächere Prozessoren:** Chrome DevTools → Performance → CPU-Drosselung (2×, 4×), dann `__city.bench()`.
- **Simulation ohne Browser:** `node --import ./scripts/perf/register.mjs scripts/perf/tick-profile.ts <spielstand.json> 60`
  (mit `--cpu-prof` für ein CPU-Profil). Spielstand = Export aus dem Menü „Spielstand“.

Alle Zahlen unten: Nutzer-Spielstand mit 1.714 Gebäuden, 152 Straßen, rund 11.000 Einwohnern; Apple M1 Pro
(10 Kerne, 16-Kern-GPU, 32 GB), Chrome 157, Bild 2.560 × 1.288 Pixel.

## Ergebnisse

| Messung | vorher (Dev) | nachher (Dev) | nachher (Produktion) |
|---|---|---|---|
| Spieltakt je Sekunde | 30–40 ms | 10 ms | 13 ms |
| Wachstum (eigene Zeitscheibe) | im Takt, 21 ms | 11 ms Ø | 11 ms Ø |
| React nach Gebäude-Änderung | 110–140 ms | – | – |
| Bildrate Nah / Mittel / Weit | 30 / 30 / 30 FPS | 37 / 37 / 38 FPS | 39 / 39 / 39 FPS |
| Bildzeit Fernansicht | 51 ms | 27 ms | 26 ms |
| Ruckler > 50 ms in 12 s, Tempo 3 | 13 | 8 | 0 |
| Draw-Calls Fernansicht | 4.850 | – | ca. 1.300 |
| Objekte im Szenengraph je Bild aktualisiert | 32.842 | – | ca. 21.000 (davon Tierskelette) |
| GPU-Zeit Szene 180 m / 520 m | 24 / 36 ms | 18 / 26 ms | – |

CPU-Drosselung (Produktions-Build):

| Prozessor-Leistung | Bildrate | Spieltakt | Ruckler in 12 s |
|---|---|---|---|
| 1× (M1 Pro) | 39–40 FPS | 13 ms | 0–2 |
| ½ (2× gedrosselt) | 25–28 FPS | 18 ms | ~30 |
| ¼ (4× gedrosselt) | 11–13 FPS | 36 ms | > 100 |

**Schwerster Fall:** flacher Blick über die ganze Stadt bis zum Horizont (520 m Abstand, flacher Winkel, im
Benchmark als „Horizont“): Prozessor 30 ms und GPU 36 ms je Bild, also rund 18–20 FPS auf dem M1 Pro (Dev-Modus).
Hier ist alles gleichzeitig sichtbar (Stadt, Wälder, Berge). Gemessen mit der neuen FPS-Anzeige.

Speicher (Produktion, nach dem Laden): rund **3 GB** JavaScript-Heap, Ladezeit rund **47 s** (davon ~6 s Gelände).

## Mindest-Hardware (Schätzung)

Gilt für eine große Stadt wie den Test-Spielstand, Full HD (1920 × 1080), Chrome/Edge. Kleinere Städte brauchen deutlich
weniger. Die Umrechnung von der CPU-Drosselung auf echte Prozessoren ist eine Näherung über die Single-Core-Leistung
(das Spiel läuft im Wesentlichen auf einem Kern).

| | Minimum (~30 FPS) | Empfohlen (~60 FPS) |
|---|---|---|
| Prozessor | Single-Core ≈ 60 % eines M1 Pro (Geekbench 6 ≈ 1.500): z. B. Apple M1, Intel Core i5 ab 11. Gen., AMD Ryzen 5 5600U / 3600 | Single-Core auf M1-Pro-Niveau oder besser: Apple M2/M3, Intel Core i5/i7 ab 12. Gen., AMD Ryzen 5 7600 |
| Grafik | ≈ 2,5–3 TFLOPS: Apple M1 (8-Kern-GPU), GeForce GTX 1650, Radeon 680M; Intel Iris Xe grenzwertig | GeForce GTX 1660 / RTX 3050 oder besser, Apple M1 Pro und höher |
| Arbeitsspeicher | 8 GB (Spiel belegt ~3 GB) | 16 GB |
| Browser | aktuelles Chrome oder Edge mit WebGL 2 und Hardware-Beschleunigung | dto. |

Begründung: Bei halber Prozessorleistung fällt die Bildrate unter 30 FPS (25–28), bei einem Viertel ist das Spiel nicht
mehr flüssig. Auf dem M1 Pro begrenzt inzwischen die GPU (18–26 ms je Bild bei 3,3 Mio. Pixeln); bei Full HD
(2,1 Mio. Pixel) sinkt der pixelabhängige Teil um rund ein Drittel.

## Was optimiert wurde (Grafik unverändert)

1. **Gebäude gebündelt (`components/city/StaticBatcher.tsx`):** Die statischen Teile aller Einzelgebäude werden je
   Material zu `BatchedMesh`-Bündeln zusammengefasst (10.000 Einzelteile → 199 Bündel). Danach werden die Originale
   versteckt und ihre Matrizen eingefroren; Gruppen, die nur noch Gebündeltes enthalten, verlassen den Render- und
   Schattendurchlauf. Sichtbarkeit wird je Gebäude einmal pro Bild geprüft (statt je Teil und Pass). Bewegte Teile
   (Windmühle, Fahrgeschäfte, Rauch, Dampf, Tiere) sind ausgenommen.
2. **Straßenlaternen:** alle Laternen in zwei statischen Instanz-Meshes statt drei-`Instances` je Straße, die jedes Bild
   alle Matrizen neu rechneten (~2 ms je Bild).
3. **Boden-Shader (`World.tsx`):** großflächige Farbfelder (Verzerrung, Regionen, Wiesenflecken, 75 m bis 1 km) pro
   Gitterpunkt statt pro Pixel; die Texturvariante wird je Koordinate einmal gewählt und für Farbe, Körnung,
   Normalen und Rauheit geteilt; nur der aktive Stil wird gerechnet. GPU −25 %.
4. **Unsichtbare Skelette:** ausgeblendete Fußgänger und ferne Herden werden nicht mehr jedes Bild aktualisiert.
5. **Simulation (`economy.ts`):** Straßennetze, Trafo-Zuordnung und Straßenanschluss werden zwischengespeichert,
   Lieferflüsse einmal vorsortiert statt je Betrieb durchsucht (Node: 23 → 13 ms).
6. **Schiffe:** Fahrrouten je Hafenposition gecacht (vorher ~25 ms Wegsuche bei jeder Gebäude-Änderung), Schiffsmodell
   memoisiert.
7. **Spieluhr (`CityBuilder.tsx`, `store.ts`):**
   - Takt ohne Drift: geplant gegen die echte Zeit; nach einem Hänger wird nicht im Schwall nachgeholt.
   - Wachstum in eigener Zeitscheibe nach dem nächsten Bild (`growStep`), damit Takt und Wachstum nie im selben Bild
     landen.
   - **Fehler behoben:** Pro Takt entstand höchstens ein Haus, egal bei welchem Tempo. Bei Tempo 3 wuchs die Stadt also
     nicht schneller. Jetzt bis zu „Tempo × 2“ Bauschritte je Takt (im Zeitbudget von 8 ms).
   - Flüssige Spielzeit `clockMinutes()`: Sonne, Himmel und Uhranzeige laufen zwischen den Takten weiter statt in
     1–3-Minuten-Sprüngen.

## Zweite Runde (14.11.2026): die „nächsten Schritte“ abgearbeitet

Gemessen im Produktions-Build, gleiche Stadt, M1 Pro, Bild 1.600 × 913 (separates Test-Chrome).

| Messung | nach Runde 1 | nach Runde 2 |
|---|---|---|
| Speicher (JS-Heap) | 2,9 GB | rund 1,0 GB |
| Kaltstart bis spielbar (Dev-Modus) | 30,9 s | 15,9 s |
| Kaltstart bis spielbar (Produktion) | nicht sauber gemessen | 11 s |
| Prozessorzeit je Bild | 11–15 ms | 5–6 ms |
| Bildrate nah / mittel / weit von oben | 39 FPS | 60 FPS |
| Bildrate Horizont (schwerster Fall) | 17–20 FPS (Dev) | 38 FPS |
| Simulation auf dem Haupt-Thread | 13 ms je Takt | 0 (Worker: 9 ms Wirtschaft, bis 21 ms Wachstum) |
| Gebäudeänderung (neues Haus, Ausbau) | 41–60 ms | rund 20 ms |
| Draw-Calls Horizont | 2.011 | 1.120 |

| Prozessor-Leistung | Bildrate Runde 1 | Bildrate Runde 2 | Hänger bei Tempo 3 |
|---|---|---|---|
| ½ (2× gedrosselt) | 25–28 FPS | 37–46 FPS | keine |
| ¼ (4× gedrosselt) | 11–13 FPS | 30–37 FPS | keine |

**Korrektur zu Runde 1:** Die dort genannte Ladezeit von 47 s war ein Messfehler (das Testskript wartete auf die
Meldung „Spielstand geladen“). Der echte Kaltstart lag bei rund 31 s im Dev-Modus. Auch die Geländeerzeugung kostet im
Browser nur 1,4 s, nicht 6 s (das war der Wert aus Node).

Damit sinkt die Mindest-Hardware: Bei einem Viertel der M1-Pro-Leistung läuft die große Stadt noch mit 30 FPS.
Prozessor-Minimum etwa Einzelkern-Leistung von 30–40 % eines M1 Pro (z. B. Intel Core i5 der 6.–8. Generation,
Ryzen 5 2600), 8 GB RAM reichen jetzt bequem. Die Grafikkarte begrenzt nun früher als der Prozessor (Horizont-Ansicht).

Was gemacht wurde:

1. **Speicher:** `useKitParts` klonte für jedes Pack-Gebäude alle rund 60 Kit-Modelle (jedes Modell lag 581- bis
   1.162-mal im Speicher, 2,7 GB). Jetzt ein gemeinsamer Zwischenspeicher je Modell; die ungenutzten Tangenten entfallen.
   Bündel starten klein und wachsen bei Bedarf.
2. **Ladezeit:** Straßenbau prüfte jeden Punkt gegen alle Kreuzungen und Wege der Stadt (9 s) → Vorauswahl über
   Begrenzungsrahmen (`pathsNear`, Kreuzungen je Straße), 1,3 s. Höhenprofile und geformtes Gelände wurden von jeder der
   19 nutzenden Komponenten einzeln berechnet → ein gemeinsames Ergebnis.
3. **Simulation im Web Worker** (`lib/city/sim.worker.ts`, `sim-client.ts`, Store `tickAsync`): Wirtschaft und Wachstum
   laufen neben dem Haupt-Thread. Der Worker hält eine abgeglichene Kopie der Welt (unveränderte Gebäude behalten ihre
   Identität, damit die Zwischenspeicher greifen). Ist er noch beschäftigt, wird der Takt übersprungen statt gestaut.
   Ohne Worker fällt das Spiel auf den alten Weg zurück.
4. **Szenengraph:** three.js besucht jedes Objekt in jedem Bild, auch eingefrorene. Fertig gebündelte Gebäude und
   Straßen sowie ausgeblendete Figuren werden jetzt ganz aus dem Durchlauf genommen (2.800 statt 33.000 Besuche je Bild).
5. **Straßen und Schilder gebündelt:** fertige Straßen samt Leitplanken und Brücken (789 Teile → 9 Bündel), dazu die
   Namensschilder der Gebäude.
6. **Gebäudeänderungen:** Bäume werden nur neu aufgebaut, wenn ein Gebäude wirklich Bäume trifft; Kontaktschatten je
   Gebäude zwischengespeichert; die Bündel-Prüfung nach einer Änderung über wenige Bilder verteilt.

Geprüft und verworfen (kein Gewinn gemessen): Sichtprüfung der Bündel je Renderdurchgang (kostet 2–4 ms Prozessor,
spart keine GPU-Zeit), Schattenkarte seltener aktualisieren (die Aktualisierung kostet auf dieser GPU nicht messbar),
frühere Fernstufe für Bäume (Bäume kosten im Pack-Stil nur rund 1 ms GPU).

## Offen

1. **GPU in der Horizont-Ansicht (38 FPS):** Die Szene kostet 15–17 ms, die Nachbearbeitung (4× MSAA, Bloom, SMAA,
   16-Bit-Puffer) weitere 5–8 ms. Die Kosten sind breit verteilt (Boden, Gebäude, Schattenabfrage, Straßen). Ohne
   Abstriche an der Grafik ist hier kein großer Einzelposten mehr zu holen.
2. **Kaltstart 11 s:** verteilt auf viele Posten zu je 0,5–1,5 s (Gelände, Baumerzeugung, Zäune, Brücken, Profile).
   Nächster Hebel: Gelände und Profile im Worker vorbereiten.
3. **Stromleitungs-Seile** werden bei Abriss/Rückgängig komplett neu erzeugt (rund 100 ms).
4. Messwerkzeug ohne DevTools-Anbindung: Chrome mit `--remote-debugging-port` starten und per DevTools-Protokoll
   steuern (so entstanden die Zahlen dieser Runde).
