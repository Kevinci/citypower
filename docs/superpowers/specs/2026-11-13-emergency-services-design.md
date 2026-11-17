# Polizei und Feuerwehr mit Einsatzfahrzeugen – Design (2026-11-13)

## Absicht

Nutzerwunsch: „eine Polizeistation und eine Feuerwehr und jeweils Autos dazu, die dann mit Blaulicht zu
Einsätzen fahren – Unfälle und Hausbrände, erstmal mit Absperren; das Car Kit bitte einbauen.“
Ziel: sichtbares Leben in der Stadt (Blaulicht, Absperrung) plus ein leichter Spielanreiz, beide Wachen zu bauen.

## Ziele / Nicht-Ziele

- Ziel: Zwei öffentliche Gebäude (Polizeiwache, Feuerwache, je 3 Stufen = Zahl der Fahrzeuge und Umkreis).
- Ziel: Einsätze entstehen von selbst (Unfall auf einer Straße mit Verkehr, Brand in einem Wohnhaus).
  Das nächste Fahrzeug einer Wache im selben Straßennetz fährt mit Blaulicht hin, sperrt ab (Pylonen aus dem Car Kit),
  bleibt eine Weile und fährt zurück. Autos weichen aus / stauen sich hinter dem Unfall.
- Ziel: Ohne zuständige Wache: Unfall räumt sich nach langer Zeit von selbst, ein Brand lässt das Haus abbrennen
  (Haus verschwindet). Mit Wache: Haus bleibt.
- Ziel: Car Kit 3.1 vollständig als Quelle genutzt (Feuerwehr, Pylonen, Trümmer); Credits bleiben korrekt.
- Nicht-Ziel (später): Löschen mit Wasser, Krankenwagen, Verbrechen, Unfallursachen aus dem Verkehr.
- Anti-Ziel: Einsätze als Dauer-Spam oder spürbare Takt-Kosten in großen Städten.

## Entscheidungen (meine Vorgaben, da keine Rückfrage möglich)

- Gebäudearten `police` (Polizeiwache / Polizeirevier / Polizeipräsidium, 24 × 18 m) und `firestation`
  (Feuerwache / Hauptfeuerwache / Berufsfeuerwehr, 28 × 20 m), öffentlich, Stufen über `LEVELS`,
  Fahrzeuge je Stufe 1/2/3, Umkreis `SERVICE_RADIUS` Polizei 450/650/900 m, Feuerwehr 400/600/800 m.
  Fester Grundriss (Ausbau ändert nur das Modell: mehr Tore, Turm).
- Neue HUD-Kategorie „Sicherheit“ (Schild-Icon) mit beiden Karten.
- Stimmung: Faktoren „Sicherheit“ (Anteil Einwohner im Umkreis einer Polizeiwache, Gewicht 1) und
  „Brandschutz“ (Feuerwache, Gewicht 0,8); Zuzug × (0,96 + 0,08·safety) × (0,97 + 0,06·fireCover).
- Einsätze (`lib/city/incidents.ts`, Store `incidents`, im Spielstand): Unfallrate ∝ Straßenlänge,
  Brandrate ∝ Hauszahl, max. 6 gleichzeitig. Zuweisung beim Entstehen: Wache gleicher Art im selben
  Straßennetz, Einsatzort im Umkreis, mit freiem Fahrzeug (Zählung offener Einsätze je Wache), nächste zuerst.
  Nicht zugewiesen → Unfall läuft nach 90 Spielminuten aus, Brand brennt nach 60 Spielminuten das Haus ab.
  Zugewiesen → Fahrzeug (Echtzeit, wie Verkehr) fährt hin, arbeitet `ON_SITE_SECONDS`, zurück; dann wird der
  Einsatz gelöscht (`resolveIncident`). Sicherheitsnetz: zugewiesene Einsätze enden spätestens nach
  240 Spielminuten (z. B. kein Fahrweg).
- Fahrzeuge in `Traffic.tsx` integriert (gleicher Spurgraph): Route per Dijkstra, Blaulicht (zwei abwechselnd
  leuchtende Lampen, toneMapped = false), ignoriert Ampeln, Autos vor ihm rücken nach rechts und bremsen.
  Am Unfallort: Wrack (Sedan schräg) + Trümmer, Pylonen um die Stelle, Autos in der Spur halten dahinter.
  Am Brandort: Flammen/Rauch am Haus, Löschfahrzeug vor dem Haus, Pylonen.
- Modelle: `firetruck.glb`, `cone.glb`, `debris-*.glb` aus Car Kit 3.1 (CC0) nach `public/models/vehicles/cars/`.

## Offen für den Bauer

Ausgestaltung der Gebäudemodelle (Boxen, Kenney-Farben), Flammen-Darstellung, exakte Raten.

## Nachtrag: Tag und Nacht (gleiche Sitzung, Nutzerwunsch „mit Tag- und Nachtzeit, Kenney Skyboxes“)

- Himmelskuppel aus den Kenney-Skybox-Panoramen (Tag, Morgen, Nacht), per Spieluhr überblendet; Sonne wandert
  6–20 Uhr, nachts Mond + leuchtende Laternen; HDRI nur noch als Lichtquelle. Details in `.claude/CLAUDE.md`.
