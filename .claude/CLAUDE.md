# Citypower – Projektanweisungen für Claude

@../AGENTS.md

Citypower ist eine 3D-Städtebau- und Wirtschaftssimulation im Browser. Der Spieler baut
Infrastruktur (Straßen, Schienen, Kanäle) in einer Welt mit natürlichen Flüssen und Seen.
Ziel ist ein realistischer, ruhiger Look (PBR, HDRI-Himmel, echte Maße in Metern).

Weiterführend: [Architektur](docs/architecture.md) · [Roadmap & Ideen](docs/roadmap.md)

## Stack

- Next.js 16 (App Router, Turbopack) – **vor Next-spezifischem Code die Doku in
  `node_modules/next/dist/docs/` lesen** (siehe AGENTS.md).
- React 19, `@react-three/fiber` 9, `@react-three/drei` 10, `@react-three/postprocessing`, three 0.187
- zustand 5 für den Spielzustand, Tailwind 4 für die HUD-Oberfläche
- `@dgreenheck/ez-tree` für prozedurale Bäume

## Befehle

```bash
npm run dev            # Dev-Server (läuft oft schon – vorher Port prüfen, s. u.)
npx tsc --noEmit -p .  # Typecheck
npx eslint .           # Lint (inkl. React-Compiler-Regeln)
npm run build          # Produktions-Build
```

Es gibt keine Testsuite. Verifikation = Typecheck + Lint + visuelle Prüfung im Browser.

## Konventionen

- **Sprache:** UI-Texte auf Deutsch, Code, Bezeichner und Kommentare auf Englisch.
- **Einheiten:** 1 Welteinheit = 1 Meter. y ist oben. Bodenebene y = 0.
- **Reine Logik in `lib/city/`** (keine React-Imports), **Rendering in `components/city/`**.
- Geometrie wird mit `MeshBuilder` (`lib/city/road-geometry.ts`) als Quads mit UVs in Metern
  und einem `along`-Attribut (Distanz ab Pfadstart) gebaut. `along` treibt die
  Bau-Animation (`clipAlong` in `materials.ts`).
- Materialien sind modulweite Singletons in `lib/city/materials.ts`; pro Layer ein Material,
  pro Material ein Draw-Call. Keine Materialien in Render-Funktionen erzeugen.
- Geometrien in `useMemo` bauen und im `useEffect`-Cleanup `dispose()` aufrufen.
- **React-Compiler-Lint:** Werte, die in einen Hook gegeben wurden (z. B. Geometrie aus
  `useMemo`), dürfen im Effect nicht direkt mutiert werden → Mutation in eine
  Hilfsfunktion außerhalb der Komponente auslagern (siehe `applyDepth` in `World.tsx`, schreibt Höhen/Normalen je Bodenkachel).
- Shader-Anpassungen per `onBeforeCompile` auf `MeshStandardMaterial`; bei geteilten
  Basismaterialien eindeutigen `customProgramCacheKey` setzen.
- Alles deterministisch: Zufall nur über `mulberry32(seed)` aus `lib/city/random.ts`.
- Kein N8AO/SSAO (bricht mit three 0.187 bzw. zu teuer).
- Neue Assets nur mit freier Lizenz; Eintrag in `public/models/CREDITS.md` ergänzen.

## Nebeneinander bauen (wichtiges Prinzip)

Alles, was nebeneinander gebaut wird, muss sauber zusammenpassen. Regeln dafür laufen
**immer über `lib/city/adjacency.ts`** (`occupant`, `nearestAccess`, `closestOnPath`,
`waterAt`, `snapToQuay`) – nicht pro Komponente neu erfinden. Aktuell:

- Laternen, Oberleitungsmasten, Andreaskreuze stehen nie in einem Nachbarweg/Kanal.
- Leitplanken (Straße) bzw. Geländer (Radweg) entstehen automatisch neben Wasser und
  Gleisen und quer vor Straßenenden am Wasser (`barrier-geometry.ts`). Sie rücken bis
  an den Fahrbahnrand nach innen, wenn außen kein Platz ist.
- Straßen/Gleise, die auf einen Kanal gezeichnet werden, enden an der Kaikante
  (`snapToQuay`). Kaimauern entfallen nur bei echten Querungen (Brücke), der
  Treidelpfad weicht jedem Weg daneben aus.
- Schotterflanken weichen Nachbarwegen aus; Wasser an einem Wegende ist keine Brücke.
- **Zukunft Gebäude:** Häuser/Industrie sollen ihre Anbindung über `nearestAccess`
  finden (Wohnhaus → Straße, Stahlwerk → Gleis und Kanal/Hafen).

Bei neuen Bauelementen immer prüfen: Was passiert daneben, darüber, am Ende, an Kreuzungen?

## Höhen, Brücken, Querungen (`lib/city/grade.ts`, `bridge-geometry.ts`)

- Jeder Weg hat ein Höhenprofil (`Profile`, 1 Sample/m). `buildFrames(points, kind, profile)`
  setzt `frame.p.y`; **alle** Geometrie-Helfer (`at`, `box`, `strip`, `wall`, `band`, `tube`)
  rechnen Höhen relativ zum Frame. Neue Geometrie muss das ebenfalls tun.
- `computeProfiles` erkennt: Wasser (schiffbar → 6 m lichte Höhe, Bach → 1,8 m) und
  nicht-ebenerdige Kreuzungen (`crossesAtGrade`, `overOf`): Autobahn × alles,
  Spieler-Entscheidung (`separations` im Store, Taste **B**: Automatisch / Brücke drüber /
  Unterführung), oder ein Partner liegt an der Stelle schon erhöht (`LIFTED`).
  Lichte Höhen: Straße 4,7 m, Bahn 6,4 m (Oberleitung). Steigungen: Straße 7 %,
  Autobahn 4,5 %, Bahn 3 %.
- Bauwerke: Damm bis 5 m Höhe, darüber Viadukt mit Pfeilern; Widerlager an Übergängen;
  Hohlkasten-Überbau mit Gesims + Geländer; Stabbogen für schiffbare Spannweiten > 34 m.
  Keine Pfeiler in der Fahrrinne oder auf dem unterquerten Weg.
- Ebenerdig bleiben: Straße/Radweg untereinander (Kreuzung), Straße/Radweg × Gleis
  (Bahnübergang), Autobahn × Autobahn.

## Autobahn-Anschlussstellen (`lib/city/interchange.ts`)

- Werkzeug „Anschlussstelle“ (Taste 7): Klick auf eine Straße, die eine Autobahn kreuzt
  → Raute mit bis zu 4 Rampen (`kind: "ramp"`, Einbahn, in Fahrtrichtung gespeichert).
- Rampen beginnen mit Ausfädelungsstreifen auf der Autobahn (Fläche dort geclippt) und
  treffen die Straße per T-Kreuzung dort, wo sie wieder ebenerdig ist. Quadranten mit
  Wasser, Konflikten mit anderen Wegen oder zu weit entfernter Straße bekommen keine Rampe.
- **Platzierungsvorschau:** Beim Hovern zeigt das Werkzeug die geplanten Rampen grün,
  roter Ring = passt nicht. Gleiches Muster für künftige Fertigbauteile verwenden.
- Clipping gegen andere Flächen über `strip(..., { clip })` / `wall(..., clip)`: wird an
  der Position des Bandes geprüft (nicht an der Mittellinie wie `skip`).
- Gleichartige Wege, die sich an einem Ende treffen (L-Ecke, Verlängerung), werden beim
  Bauen zu einem Pfad verschmolzen (`mergeEnds` im Store) → saubere Kurve statt Kreuzung.

## Autobahnkreuz (`lib/city/cloverleaf.ts`)

- Verflechtungsstreifen: pro Fahrtrichtung ein durchgehender Zusatzstreifen (Rampe) von
  vor bis hinter der Brücke; Schleifen münden ein (−L) bzw. zweigen ab (+L). Die obere
  Autobahn und ihre Streifen überbrücken die Streifen der unteren (`plan.over`).
- **Fertigbauteil:** Über einer einzelnen Autobahn zeigt das Werkzeug einen Geist des ganzen
  Kreuzes inkl. neuer kreuzender Autobahn (±190 m, rechtwinklig, als Brücke darüber);
  Klick baut alles (`planCloverleafPrefab`). Pläne liefern `problem` statt `null`, damit der
  Geist rot angezeigt und der Grund in der Statusleiste genannt werden kann.
- Werkzeug „Autobahnkreuz“ (Taste 8), Kleeblatt: pro Fahrtrichtung eine Tangente
  (Rechtsabbieger, außen herum) und eine 270°-Schleife (Linksabbieger, R = 28 m). Braucht je
  Autobahn 160 m auf beiden Seiten, kein Wasser, nichts im Weg (sonst rot).
- **Maßstab:** Knoten sind bewusst auf ~55–60 % der Richtlinienmaße verkleinert, damit
  Platz für Städte und Dörfer bleibt. Bauprinzipien bleiben (Parallelstreifen, tangentiale
  Schleifen). Bei Änderungen darauf achten, dass Punktfolgen in Fahrtrichtung vorwärts laufen.
- Zwei Autobahnen kreuzen sich immer höhenfrei (`crossesLevel`); an den Enden dürfen sie
  sich weiter verbinden (`crossesAtGrade` = verbinden, `crossesLevel` = mittendrin kreuzen).

## Autobahndreieck (`lib/city/trumpet.ts`)

- Werkzeug „Autobahndreieck“ (Taste 9): Klick auf das Ende einer Autobahn, das ≤ 35 m vor
  einer anderen Autobahn endet → Trompete. Stamm wird 50 m vor der Hauptautobahn gekürzt.
- Zwei Varianten (Schleife für A→B oder für B→A, links-/rechtsliegende Trompete); es wird
  die erste genommen, die passt (Wasser/Hindernisse). Kreuzungen zwischen Rampen werden
  als `separations` vorgegeben (Schleifenast über Ausfädelungsstreifen).

## Entwurfsregeln für Knoten (recherchiert, RAA/Lehrunterlagen)

- Aus-/Einfahrten als **parallele** Aus-/Einfädelungsstreifen mit kurzer Verziehung
  (`ramps.ts`: `exitLane`/`entryLane`, `RAMP_LANE_V`), nie schräg über die Fahrstreifen.
- Kleeblatt = Regellösung für Kreuze (1 Bauwerk), Trompete = sparsamste Dreieckform.
- Schleifen tangential aus dem Parallelstreifen (Mittelpunkt bei `RAMP_LANE_V + R`).
- Rampen max. 6 % Steigung / 7 % Gefälle; Autobahnen und Rampen außerorts unbeleuchtet.
- Neue Knotenformen immer aus `ramps.ts`-Bausteinen bauen und mit Vorschau (grün/rot).

## Weltgröße (2.100 m, `WORLD_SIZE` in terrain.ts)

- Vergrößert von 1.400 auf 2.100 m (Nutzerwunsch). **Innen bleibt jede Welt identisch:** Fluss und Seen werden weiter aus
  `GEN_HALF` (700) erzeugt; der Fluss läuft per `meander(..., extend)` mit derselben Formel bis über die neuen Ecken
  weiter, außen kommen 2–4 Seen aus eigenem Zufallsstrom dazu. Bergwälder: alter Durchgang unverändert (`INNER_HALF`),
  außen eigener Zufall mit gleicher Dichte. Gitterpunkte liegen weiter auf geraden Metern (Raster 2 m).
- **Boden in 10 × 10 Kacheln** (`Ground` in World.tsx, Normalen aus dem ganzen Raster → keine Lichtnähte): ein Netz mit
  1,1 Mio. Punkten wurde nie aus dem Sichtfeld geschnitten. Gemessen: Bildzeit gleich wie bei 1.400 m (nah 30 ms, weit
  42 ms im Testbrowser); der Boden kostet ~15 ms – vor allem der Gras-Shader (Fragmente), nicht die Größe.
- Kamera: `PIVOT_LIMIT` = WORLD_HALF − 140, far 3200.
- **Seeufer:** Land im Quadrat um einen See wurde früher komplett auf 0 gesetzt (Stufe an der Quadratkante, lag bisher
  zufällig am Kartenrand). Jetzt läuft es weich zurück (`smooth(outer, maxOuter, dist)`); im Nutzer-Spielstand hoben sich
  dadurch 25 Gebäude am See um 0,1–1,5 m.

## Kamerafahrt (`CameraFly.tsx`, `flyTo` im Store)

- Klick auf einen Betrieb in Listen (Finanzamt: Steuerzahler/Verlustbetriebe, Rathaus: Probleme) → `flyTo(id)`: wählt aus
  und setzt `focus`; `CameraFly` gleitet den Orbit-Pivot in 1,4 s dorthin, Blickwinkel bleibt, Abstand max. 160 m.

## Spielfeldrand (`WorldEdge.tsx`, Nutzerwunsch)

- Schnittkante rund um die Welt wie eine Diorama-Scheibe: je Seite eine Wand mit zwei Punkten pro Rasterschritt (oben Gelände
  bzw. Wasserspiegel, unten `MIN_BASE` −12 m, unter tiefem Bett 3 m tiefer). Farben im Shader (`onBeforeCompile`): Gras
  (1,4 m) → Mutterboden (3,2 m) → wellige Schichten Lehm/Sand/Fels nach absoluter Höhe (Band 4 m), Wasser im Schnitt, unten
  dunkler. Sichtbar, wenn die Kamera am Kartenrand nach innen blickt (Pivot bis `WORLD_HALF − 140`, Abstand bis 520 m).

## Gelände, Gebirge, Tunnel

- `terrain.ts`: Gebirgszug im Norden/Osten (`landHeight`: Ridged Noise, Gipfel ~85 m,
  Vorberge, Flusstal frei, Mitte flach). Im Tiefenraster sind Berge **negative Tiefe**:
  `terrainHeight = -sampleDepth`. Wasser-Prüfungen (`depth > x`) bleiben gültig.
- Wege folgen dem Gelände: `terrainBase` = Mittel aus „nie unter Gelände“ und „nie darüber“,
  beide mit der Steigung des Wegtyps → auf sanftem Gelände exakt am Boden, über Tälern
  Damm/Viadukt, durch Rücken Einschnitt/Tunnel. Brücken/Kreuzungen setzen darauf auf.
- Höhen über Gelände (nicht über 0) für „erhöht?“-Fragen verwenden (`liftAtPoint`,
  `lift()` in `bridge-geometry.ts`).
- Tunnel: wo der Weg tiefer als lichte Höhe + 1,8 m unter dem Gelände liegt; Portale an den
  Übergängen (`portal()`), das Gelände selbst deckt den Tunnel ab.
- Einschnitte: `cutTerrain` senkt das Gelände entlang von Wegen in Hängen ab (Böschung 1:1);
  der Boden nutzt `useShapedGrid()`, Wasser/Planung das natürliche Raster.
- Bau-Cursor trifft das Gelände (`raycastTerrain`); Vorschau folgt dem Gelände.
- Kanäle im Flachland: Gelände bis `CANAL_MAX_CUT` (4 m) erlaubt; `stampCanal` trägt den Boden neben den
  Kaimauern auf Kaihöhe ab (Einschnitt 1:1). Vorher lag die Grenze bei 0,6 m – damit ging fast nirgends ein
  Kanal. Kein Wetter-Nebel, nur dezenter Dunst in der Ferne (s. Rendering-Qualität).

## HUD (Stil: SimCity 2013, Referenz chichanart.com/simcity-2-1)

- Baukategorien: Straßen, Autobahn-Knoten, Schiene (inkl. Bahnhof, Stellwerk), Wasserwege (Kanal, Binnenhafen), Luftfahrt (Flugplatz), Versorgung (inkl. Arbeitsamt), Sicherheit (Polizeiwache, Feuerwache, Gefängnis), Energie,
  Wirtschaft (Bäckerei, Läden, Discounter, Freizeit), Industrie (Bauernhof, Mühle, Fabriken, Erzbergwerk, Hühnerhof,
  Lebensmittelfabrik, Import-Export-Kontor, Lagerhalle).
- `components/city/Hud.tsx`: Stadt-Panel oben links, Meldungsleiste oben mittig, untere
  Leiste (Tempo/Pause, Uhr, runde Kategorie-Knöpfe, Zurück, Neue Welt), darüber
  Schublade mit Karten (`CATEGORIES`) und Zeichnen-Leiste (`DraftChip`).
- `BuildingCard.tsx`: Info-Sprechblase über dem gewählten Gebäude (drei `Html`).
- Gestaltung: helle Verlaufs-Panels (`panel`), dunkel umrandete Pills (`Pill`), runde
  Glyph-Knöpfe (`RoundButton`, SVG-Icons in `ICONS`), Akzent Blau #1a8fc8/#1a9bd7, Rot
  #c0392b nur für Probleme, Grün #2c8f4e für Geld/OK. Neue UI-Teile so weiterbauen.
- Spieltempo `speed` 0–3 (Leertaste = Pause), Spielzeit `gameMinutes` (1 Spielminute je
  Sekunde × Tempo). Next-Dev-Symbol oben rechts (`devIndicators` in next.config.ts).

## Welt, Dorf, Wirtschaft

- **Zufallswelt:** `setWorldSeed`/`getWorldSeed` in `terrain.ts`; alles (Fluss, Seen, Bach,
  Hügel, Gebirgszüge) folgt aus dem Seed. Mitte (`START_RADIUS`) bleibt flach und trocken.
  Store `newWorld(seed)` erzeugt Welt + Dorf; die Szene wird per `key={seed}` neu gemountet,
  damit alle Caches (Tiefenraster, Bäume) die neue Welt nutzen. Beim Laden: zufälliger Seed.
- **Dorf:** `village.ts` – Kreuzung, Häuser, Kirche, Brunnen (Wasserwerk Stufe 1), Rathaus und Bank an der Hauptstraße
  (Nordwest, Vorderkante am Gehweg via `sizeOf` – vorher 42 m zurückgesetzt und ohne Straßenanschluss).
- **Wirtschaft:** `economy.ts` – Gebäudetypen (`BUILDINGS`), `simulate()` pro Minute,
  Takt 1 s (`tick`, Geld += Bilanz/60). Kette: Bauernhof (Weizen, Milch) → Bäckerei (+Wasser)
  → Brot an Einwohner. Wasser über Straßennetz (Leitungen), Wasserwerk Stufen 1–3 ausbaubar.
  Waren/Wasser nur innerhalb eines zusammenhängenden Straßennetzes (`roadNetworks`).
  Anschluss: Vorderkante des Grundstücks ≤ 14 m von einer Straße (`accessRoad`).
- **Stadtwachstum (`growth.ts`):** Der Spieler baut nur Infrastruktur, die Stadt wächst selbst.
  Wachstumspunkte = Geburten (nur mit Krankenhaus im Straßennetz der Einwohner,
  `BIRTH_RATE`) + Zuzug (nur bei genug Wasser, gedrosselt ohne Brot). Je 4 Punkte: neues
  Einfamilienhaus auf freiem Grundstück an einer Straße nahe der Bebauung (`housePlots`)
  oder Aufstieg eines Hauses (Stufe 2 braucht Brot, Stufe 3 Krankenhaus + ≥ 150 Einwohner).
  Ohne Wasser verfallen Häuser eine Stufe (`decay`). Grund für Stillstand: `growthLimit`.
- **Arbeit, Bildung, Steuern:** 50 % der Einwohner arbeiten; jeder Betrieb hat `jobs`,
  produziert nur anteilig besetzt (`staffing`). Kette: Bauernhof (Weizen, Milch) → Mühle
  (Mehl) → Bäckerei (Mehl + Milch + Wasser → Brot). Stahlwerk/Holzfabrik exportieren
  (`EXPORT`), Häuser wachsen nicht näher als `INDUSTRY_BUFFER`. Schule = 300 Plätze (Stufen Schule / Gesamtschule / Schulzentrum ×1/2/3,5, wächst in die Höhe, Grundstück bleibt);
  Mehrfamilienhäuser brauchen ≥ 80 % Schulplätze. Steuersatz 5–20 % (`taxRate`): mehr
  Einnahmen, weniger Zuzug. Zuzug × Steuer-, Arbeits- und Schulfaktor.
- **Ausbau-Bedingungen an einer Stelle (`UPGRADE_NEEDS` in economy.ts, Nutzerwunsch „nicht so hoch ansetzen“):** Brot 70 %
  (vorher 80), Fleisch-Hinweis 40 % (vorher 50, keine Bedingung), Beschäftigung > 50 % für Stufe 2 / > 65 % ab Stufe 3
  (vorher 60/75), Schulplätze 65 % (80), Möbel 45 % (60) bzw. 60 % ab Wohnblock (75), Strom am Haus 75 % (90),
  150 Einwohner. growth.ts, `growthLimit`/`houseBlockers` und die Hauskarte lesen alle daraus. Test Nutzer-Spielstand:
  6 Spielstunden 349 statt 24 Aufstiege zum Doppelhaus.
- **Gebäude ganz anklickbar (`pickBuilding` in BuildingTool.tsx):** Strahl gegen die gedrehte Box jedes Gebäudes
  (Grundstück × Höhe: Häuser je Stufe `HOUSE_PICK_HEIGHT`, Wahrzeichen `PICK_HEIGHT`, sonst 14 m), nächster Treffer
  gewinnt; Grundstück am Boden als Rückfall. Vorher zählte nur der Bodenpunkt hinter einer angeklickten Wand.
- **Höchststufe je Haus (`houseCap` in economy.ts):** fest aus der Haus-ID (FNV-Hash) – 15 % bis Doppelhaus, 30 %
  Mehrfamilienhaus, 30 % Wohnblock, 12 % Hochhaus, 8 % Turmhochhaus, 5 % Wolkenkratzer (die letzten drei teilen die
  früheren 25 % Hochhaus – kein Haus kann weniger als vorher); Karte zeigt „Kann wachsen bis“.
- **Wolkenkratzer (Nutzerwunsch):** Hausstufen 6 Turmhochhaus (24 Geschosse, 68 m, 200 Einw.) und 7 Wolkenkratzer (40 Geschosse,
  112 m, 360 Einw., Glasfassade `glassFacadeTexture`, Antenne). Ab 6 Dachkrone (`CROWN_LEVEL`) und Turmfarben (`TOWER_COLOURS`)
  statt Hausfarben. `TALL_RESIDENTS` 3.000 / 6.000, `TALL_CHANCE` 0,2 / 0,12. Grundriss bleibt 11 × 10 m (Grundstücksraster).
  Wie alle Stufen ≥ 3 nur mit genug Brot (`breadOk`), Krankenhaus, Schulen, Möbeln, Strom am Haus.
- **Bank wächst mit dem Vermögen** (`BANK_WEALTH` 1/5/20 Mio € → Büroturm mit 6/12/20 Geschossen hinter dem Portal),
  **Rathaus mit den Einwohnern** (`TOWNHALL_RESIDENTS` 1.500/4.000: +Geschoss, höherer Uhrturm, ab 4.000 gläserner
  Verwaltungsturm). Die Modelle lesen nur die Stufe aus dem Store (kein Re-Render je Geldänderung).
- Hausstufen 1–7: Einfamilienhaus, Doppelhaus, Mehrfamilienhaus, Wohnblock (8 Etagen), Hochhaus
  (14 Etagen), Turmhochhaus (24), Wolkenkratzer (40); `HOUSE_RESIDENTS` 4/10/28/60/110/200/360, Darstellung je Stufe eigene Maße und Fassade
  (`HOUSE_DIMS`, `facadeTexture(floors, modern)` in `Buildings.tsx`). Stufe 4/5 erst ab
  `TALL_RESIDENTS` (500/1200 Einwohner) und nur vereinzelt (`TALL_CHANCE` 30 %/10 % je Schritt). Bewohner/Wasser immer über `residentsOf`/`waterOf`.
- Versorgung zählt alle Straßen (auch im Bau); Bau-Animation ist rein optisch.
  `jobOffsets`: an bestehende Straße angehängte Stücke animieren nur den neuen Teil.
- Kartenvorschau (`Thumbnails.tsx`): ein unsichtbarer R3F-Root (`createRoot`) rendert
  alle Motive aus der echten Geometrie nacheinander zu PNG; neue Karten dort ergänzen.
- **Häuser weichen immer (Nutzerwunsch):** `planBuilding` liefert für Nicht-Häuser überlappende Wohnhäuser in `demolish`
  statt eines Problems; `placeBuilding` reißt sie ab (Meldung „X Wohnhäuser abgerissen“, Vorschau nennt es vorher).
  Andere Gebäude blockieren weiter („Überschneidet <Gebäude>“). Ausbau (`planGrowth`) und Wege taten das schon.
- **Platzieren:** `placement.ts` – Gebäude docken mit der Front an die nächste Straße an,
  Prüfungen: Geld, Wasser, Hangneigung, Überschneidung (Wege/Gebäude). Geist grün/rot in
  `BuildingTool.tsx`, Klick ohne Werkzeug wählt ein Gebäude (Infopanel, Ausbau, Abriss).
- Darstellung `Buildings.tsx`: Häuser instanziert (Fassaden-/Dachtextur aus Canvas,
  Farbe pro Instanz), Einzelgebäude aus Boxen + Satteldach-Geometrie, Felder folgen dem Gelände.

## Saubere Einmündungen (`network.ts`: `splitAtJunctions`, `snapOutOfCorner`)

- Bug-Ursache (docs/bugs/streetbug.png): Kreuzungen werden an **jedem** Wegpunkt erkannt, `buildFrames` rundet
  aber jeden Knick (`CORNER_RADIUS`) ab → lag eine Einmündung auf einem Knick, lief die Kurve quer über die
  Kreuzung. Fix: Straßen/Radwege werden an jedem inneren Punkt, an dem ein anderer Straßen-/Radweg anliegt,
  aufgetrennt (`splitAtJunctions`) – Kreuzungen liegen immer an Wegenden, Kurven nur an freien Ecken.
  Läuft in `finishDraft` (über `cleanJunctions`, überträgt `separations`/`jobs`) und in `loadGame`
  (repariert alte Spielstände). Autobahnen/Rampen sind ausgenommen (eigene Anschlusslogik).
- Andocken im Kurvenbereich einer Ecke (Tangentenlänge + halbe Fahrbahn) rastet auf den Eckpunkt ein
  (`snapOutOfCorner` in `connectRoads` und in der Cursor-Vorschau `snapToNetwork`).
- Wege durch Gebäude: Häuser werden abgerissen (Meldung), andere Gebäude blockieren (`buildingsOnPath`).
- Offen: An einer Ecke mit Abzweig bleibt die Außenecke reiner Asphalt (Kreuzungsplatz) ohne Gehweg.
- **Anschluss-Prüfung beim Zeichnen (`lib/city/joins.ts`, `checkPoint`):** Vorher rastete ein Punkt nur ≤ 1,2 m
  neben der Mittellinie ein (`SNAP_EDGE`) → Klicks auf den Fahrbahnrand setzten freie Punkte mitten auf den
  Asphalt (Überlappung). Jetzt: Punkt irgendwo auf der Oberfläche (`OUTER_HALF_WIDTH`) rastet auf die Straße,
  näher als 12 m (`NODE_PULL`) an einem vorhandenen Punkt auf diesen. Segment darf nicht auf einer anderen
  Straße entlanglaufen und nicht spitzer als 25° anschließen/kreuzen. Ergebnis `join`/`free`/`blocked`
  → Cursor-Ring grün/gelb/rot (`cursorJoin` im Store, Größe nach Wegbreite), Grund im Ticker; `addPoint`
  lehnt `blocked` ab. Dev: `__city.screen(x, z)` liefert Bildschirmkoordinaten für synthetische Pointer-Events.

## Knotenhöhen (`grade.ts`)

- Jeder Knoten hat eine gemeinsame Höhe: die höchste der beteiligten Straßen. Alle Wege
  rampen dorthin (`NodeTarget`, `clampToNodes`). Rampen-Enden auf einer Autobahn folgen deren
  Höhe. Kreuzungsplätze (`Junction.y`) und Geländer-Öffnungen (`Structure joining`) folgen.
- Kreuzungsausschnitte richten sich nach der Breite der *anderen* Straße (`Junction.widths`);
  Bahnübergänge schneiden nur den Gleisstreifen aus (`Junction.test`).

## Verkehr (`lib/city/traffic.ts`, `components/city/Traffic.tsx`)

- Spurgraph aus fertigen Straßen/Autobahnen/Rampen, Rechtsverkehr (+n-Seite = Fahrtrichtung
  des Pfads). Rampen hängen über virtuelle Knoten an der Autobahn.
- Autos folgen Kanten, halten Abstand, wählen an Knoten zufällig (geradeaus bevorzugt,
  Wenden nur in Sackgassen). Gezeichnet wird per InstancedMesh pro Fahrzeugtyp.
- Ampeln: jeder Knoten mit ≥ 3 Zufahrten (`buildSignals`), zwei Richtungsgruppen,
  Grün 14 s / Gelb 3 s / Alles-Rot 2 s. Autos halten an der Haltlinie
  (`lightState`, `stepCars(..., time)`); Darstellung in `Traffic.tsx` (instanziert).
- Fahrzeuggrößen: Kenney-Modelle sind „chibi“ (Breite/Höhe ≈ halbe Länge) → jede Achse
  wird einzeln auf echte Maße skaliert (`VEHICLES[].size` = Länge, Breite, Höhe in m).
- Lack: `carMaterial` erkennt Lack-Texel (gesättigt, nicht hell) und färbt sie pro Auto
  per Instanzfarbe um (`PAINTS`, typische Farbanteile), Lack glänzend/metallic, Rest matt,
  Schmutzkante unten. Taxi/Polizei/Krankenwagen/Müllwagen behalten ihre Lackierung.
- Modelle: Kenney Car Kit (CC0) in `public/models/vehicles/cars/` (externe Textur
  `Textures/colormap.png` muss daneben liegen). Noch keine Vorfahrt/Ampeln an Kreuzungen.
- Pro-Frame-Mutationen in Funktionen außerhalb der Komponente (React-Compiler-Lint).

## Performance (gemessen, `Trees.tsx`)

- Messen im Browser: `gl.info.autoReset = false` über ein Bild, Dreiecke/Draw-Calls summieren; Meshes nach
  Dreiecke × Instanzen sortieren. Stand 70 Gebäude: vorher 52 Mio. Dreiecke/Bild (46 ms), davon ~95 % Bäume
  (4.856 EZ-Tree-Instanzen à 3–9 k Dreiecke, `frustumCulled={false}`, auch komplett im Schattenpass).
- Jetzt: pro Variante feste Instanzpuffer, `updateForest` füllt sie bei Kamerabewegung nur mit Bäumen im
  Sichtkegel (+25 m Rand für Schatten); näher als `LOD_DISTANCE` (340 m) volles Modell mit Schatten, weiter weg
  `buildLowVariant` (Stamm + Krone, < 400 Dreiecke, mit Schatten). Ergebnis ~4 Mio. Dreiecke, ~21 ms.
- Baum-Kandidaten hängen nur vom Gelände ab (`treeCandidates`), Wege/Gebäude filtern nur (`obstacleHash`,
  räumliches Raster) → ein neues Haus würfelt keine Bäume mehr neu und remountet nichts (vorher `key={id}`).
- **Ruckeln im Sekundentakt (nur bei laufender Uhr):** Ursache war der `tick`, nicht die GPU. (1) Ohne Bauplatz lief
  `growOnce` jede Sekunde erfolglos (~7 ms) → jetzt `growthBlocked` in `store.ts`: erneuter Versuch erst nach
  `GROWTH_RETRY` (15) Takten oder wenn sich Straßen/Gebäude ändern. (2) Jede Gebäudeänderung renderte alle Gebäude neu
  (~45 ms) → `SingleBuilding` ist `memo` (jetzt ~8 ms). Das Projekt hat **keinen** React Compiler im Build (nur die
  Lint-Regeln) → teure Listen-Kinder selbst mit `memo` absichern. Messen: `__city.store.getState().tick()` timen,
  bzw. `setState({buildings: [...]})` + `setTimeout 0`.
- **Ruckeln beim Stadtwachstum (Baugenehmigungen an):** pro neuem Haus ~30 ms → jetzt ~1–2 ms Takt + ~10 ms Render (Dev).
  (1) `housePlots` rief für jeden Kandidaten `planBuilding` auf (~10 ms) → `plotCache` in growth.ts: Ergebnisse bleiben,
  solange Straßen/Wege/Raster gleich sind; neue Gebäude entwerten nur überlappende Plätze, entfernte/verschobene leeren
  den Cache (Haus-Ausbau an gleicher Stelle zählt nicht). (2) `People` klonte bei jeder Änderung der (gerundeten)
  Fußgängerzahl die ganze Menge neu → alle `MAX_*` einmal anlegen, nur die ersten N sichtbar/animiert (`showOnly`).
  (3) Baum-Instanzmeshes hatten `key` = Baumzahl → jeder gefällte Baum erzeugte sie neu; Kapazität jetzt fest = Kandidaten
  je Sorte. (4) Trees bekommt `buildings` per `useDeferredValue` (eigener Render nach dem Takt-Frame).
- **Große Städte (Nutzer-Spielstand `docs/score/`, 1.100 Gebäude):** Takt 22 → 7 ms, 15 → 47 FPS.
  (1) `accessRoad` wird je Straßenliste + Grundstück gecacht (`accessCache` in economy.ts) – war die halbe Taktzeit.
  (2) `housePlots`: Nachbarzählung über Raster statt alle Häuser je Kandidat, bekannte tote Plätze sofort überspringen,
  höchstens `PLAN_BUDGET` (20) neue `planBuilding` je Suche (kalter Cache nach dem Laden kostete sonst 1,4 s am Stück).
  (3) Bauplatzsuche nur alle `PLOT_SEARCH_MINUTES` (30 Spielminuten, Nutzerwunsch), dazwischen werden die Plätze der
  letzten Suche verbraucht (`searchPlots`); „Kein Bauplatz“ nur nach einer echten, **vollständigen** Suche.
  **Bug „auf der neuen Fläche wird nicht gebaut“ (1.400 Gebäude):** feste 20 `planBuilding` je Suche reichten nicht – der
  erste freie Platz kam nach 84 Suchen (42 Spielstunden), nach jedem Laden von vorn; dazwischen fälschlich „Kein Bauplatz“.
  Jetzt: Vorfilter ohne `planBuilding` (Mitte ± 4 m liegt in einem Gebäude → tot, Gebäude im 40-m-Raster), Zeitbudget
  `PLAN_BUDGET_MS` (12 ms) statt Anzahl, und solange Kandidaten ungeprüft sind (`plotsUnchecked()`), sucht sie alle
  `PLOT_CATCHUP_MINUTES` (2) und der Store blockt nur 2 Takte. Ergebnis: vollständig nach ~39 Suchen (~80 s Echtzeit),
  Ø 17 ms, in 6 Spielstunden 241 neue Häuser (235 auf der neuen Fläche). Messen: `tsx`-Skript mit `housePlots` + Spielstand.
  (4) Menschen/Tiere weiter als `FIGURE_DISTANCE` (280 m) werden nicht gezeichnet – 2.600 Skinned Meshes waren
  5.200 von 6.250 Draw-Calls.
- **Arbeitsmarkt mit Pendelweg + Arbeitsamt (`labourMarket` in economy.ts):** Einwohner arbeiten nur in Betrieben bis
  `COMMUTE_DISTANCE` (800 m, gleiches Straßennetz; 400 m war zu streng – Industriegebiete hatten 0–20 Häuser im Umkreis,
  Schuhfabriken liefen mit 3–17 %). Das **Arbeitsamt** (`jobcenter`, öffentlich, Stufen Arbeitsamt /
  Jobcenter / Agentur für Arbeit, `JOBCENTRE_RADIUS` 300/450/600 m) vermittelt alle Arbeitskräfte in seinem Umkreis an
  Betriebe im ganzen Netz. Verteilung in `LABOUR_ROUNDS` Runden: jede Gruppe teilt ihre freien Leute nach offenen Stellen
  × Gewicht (`ESSENTIAL_WEIGHT`), überfragte Betriebe nehmen anteilig. Häuser im Amtsumkreis werden zu **einem Pool**
  zusammengefasst (gleiche Reichweite), Pendel-Reichweiten je Haus gecacht (`reachCache`, Signatur der Betriebe) –
  sonst 17–34 ms Takt. `employment` = Beschäftigte / Arbeitskräfte, `unemployed`, `jobcentres` (Karte, orange Umkreis
  `JobCentreArea.tsx`). Nutzer-Spielstand: ohne Amt 101 Arbeitslose, Strom 44 % (Kraftwerk/Uran weit draußen), mit
  Amt Stufe 3 im Zentrum 15 Arbeitslose, Strom 93 %.
- **Schuhfabriken teilen Leder und Gummi fair (`leatherShare`/`rubberShare`):** Nutzer-Bug „Schuhfabrik direkt neben der
  Gerberei wird nicht beliefert“ – Gerbereien lieferten 17 Leder/min, die vorhandenen Fabriken brauchten 16; `take` in
  Listenreihenfolge ließ der neuen nichts. Meldung bei Knappheit: „… in der Stadt – fair verteilt“.
- **Schuhe und Möbel neu abgestimmt (Nutzerwunsch „immer zu wenig“, Nutzer-Spielstand 11.000 Einw.: Schuhe 26 %, Möbel 35 %):**
  Engpässe waren Gerberei (6 Leder/min, kein Ausbau), Schuhgeschäft (kein Ausbau) und Stahl für Möbel. Jetzt: Gerberei 10/min,
  ausbaubar Gerberei / Große Gerberei / Lederwerk (wächst nach hinten 30 × 24/32/40); Gummifabrik 10/min, ausbaubar bis Gummiwerk
  (wächst in die Höhe); Schuhfabrik 14/min, 0,3 Leder je Paar; Schuhgeschäft 14/min, ausbaubar Schuhhaus / Schuhcenter (13 × 12/20/28,
  Kunden nach Größe wie Metzgerei); Möbelfabrik 9/min, 1,2 Bretter + 0,3 Stahl. Stufenfaktoren dieser Ketten einheitlich 1/2/3,5.
  Gleicher Spielstand danach ohne Ausbau: Schuhe 57 %, Möbel 59 %; Rest begrenzt die Besetzung (50–63 %, Arbeitskräftemangel).
  Prüfen ohne Browser: `node --import ./scripts/perf/register.mjs scripts/perf/chains.ts <save.json>` (Ist/Max je Kettenglied, Gewinne).
- **Faire Verteilung an Geschäfte (`fairShare` in simulate):** Metzgereien, Schuh-, Mode- und Möbelgeschäfte nehmen bei
  Knappheit im Netz nur ihren Anteil (Angebot/Gesamtwunsch). Vorher leerte das erste Geschäft die Fabriken, die anderen
  bekamen nichts und meldeten „… anschließen“ (sah wie ein Verbindungsfehler aus). Meldung dann „… in der Stadt – fair
  verteilt“. Gleiches Muster für neue Ladenketten verwenden (Mehl: `flourShare`).
- **Arbeitskräfte (Teufelskreis):** Bei einem gemeinsamen Besetzungsgrad liefen bei Jobmangel alle Bäckereien halb besetzt
  → Brot < 80 % → kein Haus stieg auf → nie mehr Arbeiter. Jetzt bekommt die Grundversorgung (`ESSENTIAL`: Wasser,
  Strom + Brennstoff, Krankenhaus, Schule, Hof, Mühle, Bäckerei) je Stelle `ESSENTIAL_WEIGHT` (2×) so viele Arbeiter.
- Weitere Kandidaten: ~930 Draw-Calls (Einzelgebäude aus vielen Boxen → mergen/instanzieren), 263 Skinned
  Meshes (Menschen/Tiere: Animation nur nah, sonst ausblenden), `simulate` ~7 ms je Takt (O(n²)-Stellen wie
  `flows.filter` je Gebäude, `roadNetworks` Punktvergleich aller Straßenpaare), Postprocessing in voller Auflösung.

## Performance-Test und Optimierungen (Nov. 2026, Bericht `docs/performance.md`)

- **Test:** `?bench` an die URL (auch Produktions-Build), dann `await __city.bench()` (`components/city/Benchmark.ts`):
  Takt je Tempo mit Abschnitten (`timed()` aus `lib/city/perf.ts`), Bildzeiten aus vier Kamerapositionen Tag/Nacht,
  Ruckler. Ohne Browser: `node --import ./scripts/perf/register.mjs scripts/perf/tick-profile.ts <save.json>` (`--cpu-prof`).
  Mindest-Hardware und Messwerte im Bericht.
- **StaticBatcher (`StaticBatcher.tsx`, in `Buildings`):** bündelt statische Teile aller Einzelgebäude (`userData.base`) je
  Material in `BatchedMesh`. Originale bleiben im Graph, aber `visible=false` + `userData.batched`, Matrizen eingefroren;
  reine Gruppen werden ausgeblendet. Änderungen über eine numerische Signatur je Gebäude (16 Gebäude/Bild + voller
  Durchlauf bei neuem `buildings`). **Bewegte Teile in Gebäuden mit `userData={DYNAMIC}` markieren** (aus Buildings.tsx),
  sonst frieren sie ein. Transparente, instanzierte, Skinned- und Mehrfach-Materialien werden nie gebündelt; Schilder mit
  eigener CanvasTexture auch nicht. Gleich aussehende Inline-Materialien (`<meshStandardMaterial color=…>`, ohne
  Shader-Hook) teilen sich ein Bündel. Sichtprüfung je Gebäude einmal pro Bild (`cull`, Rand 45 m für Schatten) plus
  three.js-Instanz-Culling für den Schattenpass. Shader-Hooks müssen `USE_BATCHING`/`batchingMatrix` beachten (siehe
  `nightGlow.ts`); `GroundShadows` liest gebündelte Teile weiter (`userData.batched`).
- **Laternen:** alle in `StreetLamps` (Roads.tsx) als zwei statische Instanz-Meshes; Straßen melden ihre Punkte per
  `onLamps`. Keine drei-`Instances` für große Mengen (rechnet jedes Bild alle Matrizen).
- **Boden-Shader:** Felder ≥ 75 m (Warp, Region, Macro, Mid) im Vertex-Shader (`vWarped`, `vFields`), `noTileAt` einmal je
  Koordinate für alle Texturen, nur der aktive Stil wird gerechnet. Neue großflächige Effekte ebenso per Vertex.
- **Verborgene Figuren:** `matrixWorldAutoUpdate = visible` (People, Herd) – Skelette kosteten sonst jedes Bild.
- **Simulation:** `roadNetworks` gecacht je Straßenliste, Trafo-Zuordnung (`supplyCache`, WeakMap je Gebäude),
  `accessRoad` zusätzlich mit Objekt-Cache (Gebäude werden nie verändert, nur ersetzt – das gilt weiter als Regel),
  Lieferflüsse einmal vorsortiert (`soldBy`/`boughtBy`, `deliveredOutput`). Keine `flows.filter`/`buildings.filter`
  je Gebäude mehr einbauen.
- **Spieluhr:** `CityBuilder` plant den Takt gegen die echte Zeit (kein Drift, kein Nachholen im Schwall); `growStep`
  läuft nach dem nächsten Bild in eigener Zeitscheibe (`GROW_SLICE_MS` 8 ms) und baut bis zu `Tempo × 2` Häuser je Takt
  (**vorher max. 1 Haus je Takt – Tempo 2/3 beschleunigte das Wachstum nicht**). `clockMinutes()` = Spielzeit inkl.
  Bruchteil seit dem Takt: für Sonne, Himmel und Uhr (alles, was sichtbar mit der Zeit läuft).
- Schiffsrouten gecacht je Hafenposition + Raster (`cachedRoute`), `ShipModel` memoisiert.
- **FPS-Anzeige:** Einstellungen → Anzeige → „FPS anzeigen“ (`FpsMeter` in Hud.tsx, eigener kleiner zustand-Store
  `useDisplay`, pro Browser in `localStorage` `citypower.showFps`, erst nach dem Mount gelesen wegen Server-Rendering).
- **Runde 2 (14.11.2026, Zahlen im Bericht):**
  - `useKitParts` (HousePack.tsx) teilt die Teile je Kit-Modell über `kitPartsCache` – **nie pro Komponente klonen**
    (vorher 2,7 GB: jedes Pack-Gebäude klonte alle Modelle). Geteilte Geometrien werden nicht disposed.
  - **Simulation im Worker:** `lib/city/sim.worker.ts` (Wirtschaft `simulate` + Wachstum `growOnce`), `sim-client.ts`
    (schickt nur geänderte Listen, eine Anfrage gleichzeitig), Store `tickAsync` (vom Taktgeber in CityBuilder
    aufgerufen): Ergebnis → `tick(economy)`, danach Wachstum; hat der Spieler inzwischen gebaut, wird der Wachstumsschritt
    verworfen (`buildingsDropped`). Der Worker gleicht Gebäude per Wert ab (Identität bleibt für die Caches). `tick()` und
    `growStep()` bleiben als synchroner Rückfall (und für Tests/Benchmark). Neue Eingaben von `simulate` müssen auch in
    `SimRequest` und `tickAsync`. Dev: `__city.sim()`.
  - **Aus dem Matrix-Durchlauf genommen:** three.js besucht jedes Objekt je Bild. StaticBatcher setzt für statische
    Teilbäume `updateMatrixWorld = NOOP` (Entry `roots`), People/Herd für unsichtbare Figuren (`skipMatrices`).
    Wer Transformationen in einem gebündelten Gebäude ändert, muss sicherstellen, dass die Signatur es merkt
    (`signatureOf` hasht alle statischen Nachfahren).
  - **Straßen gebündelt:** zweiter StaticBatcher in `Roads` (`__roadBatcher`); fertige `RoadView`-Gruppen tragen
    `userData.base`, Baustellen nicht.
  - **Vorauswahl:** `pathsNear(points, paths, margin)` (adjacency.ts) vor Punkt-für-Punkt-Tests gegen „alle Wege“;
    `buildRoadLayers` filtert Kreuzungen auf die Nähe der Straße.
  - `useProfiles`/`useShapedGrid` teilen ein modulweites Ergebnis (19 Aufrufer rechneten einzeln).
  - Bäume: `standingTrees` (Wege, selten) + `felledBy` (Gebäude, je Gebäude gecacht) → `forests` nur neu, wenn sich die
    gefällten Bäume ändern. Kontaktschatten je Gebäude gecacht über `unitSignature` des Batchers.
  - Browser-Messung ohne MCP: Chrome mit `--remote-debugging-port=9333 --user-data-dir=<tmp>` starten und per
    DevTools-Protokoll (WebSocket, `Runtime.evaluate`, `Profiler`) steuern; CPU-Drosselung gilt nur je Verbindung.
- Offen (siehe Bericht): GPU in der Horizont-Ansicht (~38 FPS), Kaltstart 11 s.

## Rendering-Qualität

- **Sonne folgt der Kamera (`Sun.tsx`):** Vorher lag die Schattenbox fest auf ±140 m um den Kartenursprung –
  überall sonst gab es gar keine Schatten (Gebäude/Bäume wirkten aufgeklebt). Jetzt wird sie pro Bild etwas vor
  den Orbit-Pivot (Richtung Kamera) gelegt, Größe = 0,85 × Kameradistanz (50–190 m, in Stufen ×1,15), Mittelpunkt
  im Lichtraum auf ganze Schatten-Texel gerastert (kein Flimmern beim Verschieben). Kosten: normale Ansicht
  unverändert 60 FPS; weit raus begrenzen Draw-Calls, nicht der Schatten.
- **Farbabstimmung:** warme Sonne (`#ffe4bf`, Intensität 3,3 in `Sun.tsx`) gegen kühles HDRI-Himmelslicht
  (`environmentIntensity` 0,7); `HueSaturation` +0,06 nach dem ACES-Tonemapping (gleicher Effekt-Pass, kostenlos).
  Wiesenfarben in `World.tsx` (`lush`/`fresh`/`olive`) satter, weniger Trocken-/Fotofarbanteil – vorher wirkte die
  Wiese blass gelbgrün. Höher als ~0,08 Sättigung bzw. hellere `fresh`-Werte kippen ins Neon-Limette.
- **Dunst (Luftperspektive):** `<fog>` in `CityScene.tsx` (`HAZE` #c6d3df, 450–3800 m) – nur ferne Berge/Wälder
  verblassen leicht zum Himmel, kein Wetter-Nebel. Eigene `ShaderMaterial`s brauchen dafür Fog-Chunks.
- **Kontaktschatten (`GroundShadows.tsx`):** Ersatz für SSAO. Ein instanziertes Mesh (1 Draw-Call) mit weich
  auslaufendem dunklen Rand um jedes Bauteil, das auf dem Boden steht. Automatisch gesammelt: schattenwerfende
  Meshes unter einer Gruppe mit `userData.base` (`GROUNDED` an den Gebäudegruppen in `Buildings.tsx`), Höhe
  ≥ 1,8 m, Unterkante ≤ 0,3 m über der Basis; plus alle Instanzen von Meshes mit `userData.contact` (Hauswände).
  Randbreite = 0,5 × Höhe (2,2–7 m). Neue Gebäudegruppen mit `userData={GROUNDED}` anlegen.
- **Dächer (`roofSlopes` in `Buildings.tsx`):** Die Dachflächen liegen auf der Traufe der Wände und laufen um den
  Überstand nach unten weiter; Giebeldreiecke füllen exakt (w, h, d). Vorher wurde das Dach nur nach außen
  skaliert → es schwebte bis 0,5 m über den Wänden, Giebel waren eingerückt/zu niedrig (Lücken sichtbar).
- Ferne Bäume (`buildLowVariant`): Krone aus `mergeVertices`-Ikosaeder (glatt statt facettiert), Vertexfarben
  (`shadeCrown`: unten/innen dunkel, oben hell, Sprenkel) und werfen Schatten (< 400 Dreiecke).

- Asphalt: rissfreier Ausschnitt `asphalt_clean_*` mit gespiegeltem Kacheln (das
  Original-Foto hatte einen großen Riss, der sich alle 7 m wiederholte).

- `EffectComposer multisampling={4}` (MSAA) + SMAA gegen Flimmern dünner Linien.
- Kamera near = 2,5 m / far = 2200 m für ausreichend Tiefenpräzision.
- Kein `reversedDepthBuffer`: three dreht `polygonOffset` dafür nicht um, die Straßen-
  Layer verlassen sich darauf. Markierungen haben stärkeren `polygonOffset`.

## Neue Bau-Werkzeuge hinzufügen (Checkliste)

1. `lib/city/types.ts`: Kind zu `BuildKind` hinzufügen und in **allen** Records eintragen
   (`NETWORK_OF`, `BUILD_LABEL`, `HALF_WIDTH`, `OUTER_HALF_WIDTH`, `CORNER_RADIUS`).
2. Ggf. neues Netz in `NetworkId` + `NETWORK_KEY`/`Networks` in `store.ts`.
3. Geometrie-Builder in `lib/city/<x>-geometry.ts`, Materialien in `materials.ts`.
4. Render-Komponente in `components/city/`, in `CityScene.tsx` einhängen; im Bau-Zustand
   `PathConstruction` (generisch) verwenden.
5. Toolbar-Eintrag in `TOOL_GROUPS` (`CityBuilder.tsx`) – Hotkey ergibt sich aus der Reihenfolge.
6. Bäume (`Trees.tsx`), Kreuzungen/Brücken und Nachbarschaft (`adjacency.ts`) prüfen.

## Im Browser testen

- Der Citypower-Dev-Server läuft meist auf **Port 3001** (3000 ist oft von einem anderen
  Projekt belegt). Port prüfen: `lsof -iTCP -sTCP:LISTEN | grep node` und `cwd` des Prozesses.
- Chrome DevTools MCP verwenden. Im Dev-Modus gibt es `window.__city` (`DevHandle.tsx`):
  ```js
  const s = __city.store;
  s.setState({ tool: "rail2", draft: [{x:-160,z:100},{x:80,z:100}] }); s.getState().finishDraft();
  s.setState({ tool: null });
  __city.look(x, z, distance); // Kamera auf Punkt richten
  __city.depth(x, z);          // Wassertiefe (> 0) bzw. −Geländehöhe – Wasser/Berge finden
  ```
  Bau-Animationen dauern bis zu 15 s – vor Screenshots warten.
- Screenshots als JPEG mit `quality` ~60 anfordern (PNG ist sehr groß).
- `evaluate_script` kennt keinen `timeout`-Parameter; nach Reload in einer Schleife auf
  `window.__city` warten.

## Lieferketten, Infokarten, Icons, Menschen

- **Lieferketten** (`simulate` in `economy.ts`): feste Lieferbeziehungen (`flows`): Mühle
  bezieht Weizen vom nächsten Hof, Bäckerei Mehl von der nächsten Mühle und Milch vom
  nächsten Hof (gleiches Straßennetz). Rezepte in `RECIPES`. Status je Gebäude mit
  `inputs` (benötigt/erhalten) und `outputs` (Ist/Max).
- **Infokarten** (`BuildingCard.tsx`): Abschnitte Bedarf (jede Zeile „genug“/„zu wenig“
  mit Menge und Herkunft), Produktion (Ist/Max, an wen geliefert), Versorgung, Haushalt.
  Neue Gebäude immer so beschreiben: alles, was gebraucht wird, mit Genug-Urteil.
- **Lieferlinien** (`SupplyLinks.tsx`): Bögen mit wandernden Punkten in Warenfarbe
  (`GOOD_COLOUR`), beim gewählten Gebäude oder alle über den Knopf in der unteren Leiste.
- **Keine Emojis:** alle Symbole aus `GameIcon.tsx` (eigene SVG-Icons). `BUILDINGS[].icon`
  und `GOOD_ICON` sind Icon-Namen.
- **Menschen** (`People.tsx`): Fußgänger auf Gehwegen, Radfahrer auf Radwegen/Straßenrand,
  Quaternius-Figuren (CC0) mit Lauf-/Sitz-Animation (`SkeletonUtils.clone` + Mixer je Figur),
  Fahrrad von Poly by Google (CC BY 3.0). Anzahl folgt der Einwohnerzahl. Achtung: geklonte
  Szenen-Wurzel hat eine Eigendrehung → `rotation.set(0,0,0)` vor dem Ausrichten.
- **Haushalte:** 1/2/6 je Hausstufe (`HOUSE_HOUSEHOLDS`), im Stadt-Panel und in der Hauskarte.
- Gras: `noTile()` im Bodenshader (zufällige Kachelversätze + gedrehtes Rauschen) –
  keine sichtbare Wiederholung. Neue Bodentexturen ebenfalls darüber sampeln.
- Wiesenfarbe: alle Rauschskalen domain-gewarpt (`warp`), trockene Flecken mit regional
  wechselnder Schwelle (`region`, ~700 m) – keine gleich großen, gleichmäßig verteilten
  Tupfen („Opas Sonntagshemd“). Keine einzelne Rauschskala allein über Schwellwert färben.

## Möbel- und Fleischkette, Tiere

- **Möbel:** Holzfabrik (Bretter) + Stahlwerk (Stahl) → Möbelfabrik (`furniture`, 1,5 Bretter +
  0,5 Stahl je Möbel) → Möbelhaus (`furniturestore`) → Haushalte (`FURNITURE_PER_HOUSEHOLD`).
  Industrie liefert erst an Abnehmer im Straßennetz, nur der Rest wird exportiert
  (`EXPORT_PRICE` je Einheit). `furnished` (Anteil eingerichteter Haushalte) erhöht den Zuzug
  und ist Pflicht für Mehrfamilienhäuser (≥ 60 %).
- **Fleisch:** Bauernhof ausbaubar (`upgrade`, Stufe 2 „Schweinezucht“, Stufe 3 „Gutshof“ mit
  Maschinenhalle + 2. Silo und `FARM_OUTPUT` ×1,6, `FARM_LEVEL_NAME`) →
  liefert Rinder (`FARM_CATTLE` 2,5/min) + Schweine → Schlachthof (Stufen Schlachthof / Großschlachthof / Fleischwerk,
  `LEVELS.slaughterhouse` ×1/2/3,5; Grundstück wächst **nur nach hinten**, 32 m breit, damit Nachbarn an der Straße nicht
  blockieren) → Metzgerei (Stufen Metzgerei / mit Wurstküche / Fleischermarkt, `LEVELS.butcher` ×1/2/3,5, Grundstück 13 m breit,
  wächst nach hinten, Kunden nach Größe verteilt wie bei Bäckereien; Stufe 3 lohnt erst bei viel Nachfrage) → Einwohner (`MEAT_PER_RESIDENT`),
  Fleischversorgung erhöht den Zuzug. Gebäudenamen je Stufe immer über `levelName(b)`.
- Ausbau ist generisch: jedes Gebäude mit `BUILDINGS[k].upgrade` zeigt den Ausbauknopf.
- **Tiere** (`Animals.tsx`): animierte Quaternius-Kuh/-Schwein (CC0), `Herd` wandert in einem
  Bereich (Laufen/Fressen/Stehen), Mixer nur nahe der Kamera. Fell per Materialname
  (`DAIRY_COAT` schwarz-weiß, `BEEF_COAT` braun). `Fence` = gemergter Zaun, folgt dem
  Gelände, Tor vorne. `mudMaterial()` = Matsch mit glänzenden Suhlen (Shader-Farben linear,
  also dunkel wählen). Hof-Layout: `PASTURE`, `PIG_RUN`, `WHEAT` in `Buildings.tsx`.

## Geld: Betriebe privat, Stadt lebt von Steuern (`economy.ts`)

- Betriebe (alles außer `PUBLIC` und Häusern) führen eine eigene Bilanz (`status.finance`):
  Verkauf an Betriebe (Lieferungen × `PRICE`), an Kunden (`RETAIL_PRICE`: Brot, Fleisch, Möbel,
  Mahlzeiten, Kinokarten), Rest-Lager als Großhandel/Export (`EXPORT_FACTOR`), minus Einkauf,
  Löhne (`jobsOf × staffing × WAGE`), Betriebskosten (`upkeepOf`), Wasser (`WATER_FEE`).
  Gewerbesteuer = `businessTaxRate` × Gewinn.
- Stadthaushalt (`budget`): Einkommensteuer (`taxRate` × Löhne aller Beschäftigten),
  Gewerbesteuer, Grundsteuer (`PROPERTY_TAX` je Haushalt mit Wasser), Wassergebühren;
  Ausgaben nur für öffentliche Gebäude. Baukosten zahlt weiterhin die Stadt (Ansiedlung).
- HUD: Klick auf den Saldo öffnet den Haushalt; Regler für Einkommen- und Gewerbesteuer
  (`businessTaxRate` im Store und Spielstand). Bei Preisänderungen prüfen, dass jeder Betrieb
  bei normaler Auslastung Gewinn macht (Kalibrierung im Browser über `status[id].finance`).
- **Freizeit:** Restaurant (Fleisch + Milch → Mahlzeiten) und Kino (Karten). `leisure` (0..1)
  erhöht die Geburtenrate bis × 2,5 (`LEISURE_BIRTH_BONUS`) und leicht den Zuzug.

## Strom (`lib/city/power.ts`, `PowerLines.tsx`, `PowerModels.tsx`)

- Kette: Kraftwerk → Stromleitung (Werkzeug `cable`, eigene Liste `cables` im Store/Spielstand,
  kein `BuildKind`) → Trafostation → alle Gebäude im Radius (`TRANSFORMER_RADIUS` je Stufe).
  Leitungen, die sich berühren, bilden ein Netz (`cableGrids`); Werk/Trafo hängen am Netz, wenn
  ein Leitungspunkt im Grundriss (+`CABLE_REACH`) liegt. Kabelpunkte rasten am Einspeisepunkt
  (`feedPoint`: Schaltfeld vorne links bzw. Trafo vorne) und an Masten ein (`snapCablePoint`).
- **Automatische Leitungen (`autocable.ts`, `autoConnectTransformers`):** Trafos ohne Netz mit Kraftwerk bekommen eine
  Leitung zum nächsten Kabel eines versorgten Netzes – gerade, sonst mit einem Knickmast, sonst Rasterwegsuche (2 m,
  Dijkstra) um Gebäude herum, auf wenige Masten geglättet. Nie über Gebäude (3,5 m Abstand), max. 900 m, Kosten wie
  gezeichnet (`CABLE_COST_PER_M`). Läuft in `loadGame`, beim Bauen eines Trafos und per Knopf in der Trafo-Karte
  (`autoCable`). Angeschlossene Trafos dienen nachfolgenden als Netz (Kette).
- Trafostationen brauchen keine Straße (`ROADLESS` in placement.ts): frei platzierbar, docken
  nur an eine Straße an, wenn sie ≤ 20 m entfernt ist; kein „Kein Straßenanschluss“-Problem.
- Kraftwerk Stufen 4/5: zweiter/dritter Reaktorblock (`reactorsOf`, `fuelPerMinute`, `NuclearPlant`).
- Möbelhaus Stufen: Möbelhaus → Einrichtungshaus → Wohnwelt (`STORE_LEVEL_FACTOR` 1/2/3,5 für
  Kapazität und Kundenanteil im Netz).
- Kraftwerk (öffentlich, `PUBLIC`): muss am Wasser stehen (`nearWater` in placement), Stufe 1
  Wasserkraft braucht einen Kanal ≤ `HYDRO_CANAL_DISTANCE` am Werk, Stufe 2 Kohle, Stufe 3 Uran
  (Brennstoff nach Last, über die Straße von Bergwerken; Kosten im Haushalt beim Kraftwerk).
- Bergwerke (`MINES`): nur am Berg (`mountainHeight` ≥ `MINE_MIN_HEIGHT`), steile Hänge erlaubt,
  Modell mit Fundament bis −10 m. Stahlwerk braucht Eisenerz (`ORE_PER_STEEL`).
- Wirkung: Betriebe ohne Strom arbeiten mit `UNPOWERED_WORK`, Mehrfamilienhäuser brauchen Strom
  am Haus (≥ 90 %), Zuzug × (0,85 + 0,25 · `powered`). Stromgebühr `POWER_FEE` je kW.
- Darstellung: Gittermasten instanziert, Leiterseile mit Durchhang (gemergte Tubes), gelbe
  Versorgungskreise wie `WaterCoverage` (bei gewähltem Werk/Trafo bzw. beim Kabelziehen).
- Kirche: eigenes Modul `Church.tsx`, Poly-Haven-Texturen mit UVs in Metern (`meterBox`).
- Radfahrer: Fahrrad-Modell zeigt nach −z → um π gedreht und zentriert (`placeBike`), Figur
  sitzt bei `SADDLE_Z`. Animationen werden beim Einhängen gestartet (`action.play()` im Effect),
  weil der Cleanup `stopAllAction` aufruft (StrictMode hängt Effekte doppelt ein).

## Mühle, Schwimmbad, Jahrmarkt, Fototexturen

- **Mühle Stufen 1–4:** Mühle → Mühle mit Silo → Großmühle (2 Silos) → Mühlenfabrik (Walzmühle,
  4 Silos); `MILL_FACTOR` für Mehl. Das Grundstück wächst je Stufe (`LEVEL_SIZE`/`sizeOf(b)` in
  `economy.ts` – Grundrisse **immer** über `sizeOf(b)`, nie `BUILDINGS[k].size` für gebaute Gebäude).
  `planGrowth` (placement.ts) schiebt das Gebäude von der Straße weg nach hinten, reißt Häuser im
  Weg ab; Straßen/Wasser/Hang/andere Gebäude blockieren (Grund in der Karte, Knopf gesperrt).
- **Weitere Ausbaustufen** (generisch über `LEVELS` + `levelFactor(b)` in economy.ts, Grundstück
  über `LEVEL_SIZE`): Bäckerei → Backfabrik (×4, Kunden nach Größe verteilt), Holzfabrik →
  Großsägewerk → Holzwerk (×1,8/×3), Möbelfabrik → Große Möbelfabrik → Möbelwerk (×1,8/×3),
  Möbelhaus Stufe 4 „Möbelzentrum“ (blaue Halle, gelbes Schild, großer Parkplatz; bewusst ohne
  echte Markennamen). Im Pack-Stil: breite Kit-Halle `building-q`, über das ganze 64 × 46-Grundstück gestreckt
  (`whole[4].height` 16 m → `sx`/`sz` getrennt) – die schmale `building-o` war kleiner als Stufe 3 (Nutzer-Bug). Bei wachsendem Grundstück wird das Basismodell um die Tiefendifferenz nach
  vorn verschoben (`shift`), damit es an der Straße bleibt.
- Fußgänger laufen `WALK_LIFT` (0,5 m) über dem Wegprofil (Gehweg + Fußpunkt des Modells).
- **Leder & Schuhe:** Schlachthof liefert Häute als Nebenprodukt (`HIDES_PER_CATTLE/PIG`) →
  Gerberei (Leder, viel Wasser, Industrie) → Schuhfabrik (Leder + Gummi; ausbaubar Schuhfabrik / Große Schuhfabrik /
  Schuhwerk ×1/1,8/3, **wächst nur in die Höhe**, gleiches Grundstück – Pack-Modell per `grow` gestreckt, klassisch mehr
  Fensterreihen) → Schuhgeschäft →
  Einwohner (`SHOES_PER_RESIDENT`, `shod` erhöht Zuzug leicht, Faktor „Schuhe“ im Rathaus).
  Gummifabrik kauft Kautschuk als **Import** (`imports` in `simulate`, Kosten = Menge × PRICE,
  zählt als Einkauf; Karte zeigt „Import aus Übersee“). Reste werden exportiert.
- **Schwimmbad / Jahrmarkt:** private Freizeitbetriebe wie das Kino (`ATTRACTIONS`: Gut, Bedarf je
  Einwohner, Kapazität; Waren `swim`/`ride`). `leisure` = (Essen + Kino)/2 + je 0,25 für Bad und
  Jahrmarkt. Riesenrad/Karussell drehen sich (`turnRides`), Gondeln bleiben senkrecht.
- Gebäude dürfen nicht unter Stromleitungen stehen (`planBuilding(..., cables)`).
- **Fototexturen für Gebäude:** `photoMaterial`/`withPhoto` (`components/city/photoMaterial.ts`):
  triplanare Projektion in Mesh-Achsen × Mesh-/Instanz-Skalierung, also Kacheln in Metern auch auf
  skalierten Einheitsboxen. Modus `photo` (Foto = Farbe, `color` tönt) oder `grain` (nur Hell/Dunkel-
  Struktur über vorhandene `map`/Instanzfarben, z. B. Fassaden mit Fenstern, Hausdächer). Neue
  Materialien in `Buildings.tsx`/`PowerModels.tsx` so anlegen; Texturen von Poly Haven (CC0) in
  `public/textures/<name>_diff_1k.jpg` + CREDITS.

## Textilkette (`economy.ts`, `Buildings.tsx`)

- Spinnerei-Grundstück wächst nur nach hinten (30 m breit, Tiefe 24/34/40 – vorher blockierten Nachbarn an der Straße den Ausbau).
- Schaffarm (`sheepfarm`, 4 Stufen: Schaffarm / mit Scherhalle / Große Schaffarm / Wollgut, Wolle ×1/1,6/2,4/3,5,
  Weide wächst mit dem Grundstück) → Spinnerei (`spinning`, 3 Stufen, Garn) → Kleidungsfabrik (`clothing`,
  3 Stufen bis Textilwerk, 0,75 Garn je Kleidung) → Modegeschäft (`fashion`) → Einwohner
  (`CLOTHES_PER_RESIDENT`). `dressed` erhöht den Zuzug leicht und ist Stimmungsfaktor „Kleidung“.
  Stufen generisch über `LEVELS`/`LEVEL_SIZE`. Wolle/Garn/Kleidung sind lagerbar (`STORABLE`).
- Schafe: Quaternius-Modell (CC0, `public/models/animals/sheep.glb`) über `Herd kind="sheep"`; Animationsnamen
  passen zu den Regexen in `useSpecies`. Schaffarm wird wie der Bauernhof außerhalb der Gruppe gerendert
  (`SheepFarm b grid y`), weil Weide/Zaun dem Gelände folgen.

## Lebensmittelkette und Import per Schiff (`economy.ts`, `shipping.ts`, `LogisticsCard.tsx`)

- Kette: Bauernhof (Weizen, Milch) + Hühnerhof (`chickenfarm`, Eier) + Import-Export-Kontor (`trader`, Kakao,
  Kaffee) → Lebensmittelfabrik (`foodfactory`, 3 Stufen, `FOOD_LINES`) → Discounter (`discounter`,
  `FOOD_PER_RESIDENT`) → Einwohner. `fed` erhöht den Zuzug leicht, Stimmungsfaktor „Lebensmittel“. Lebensmittel sind
  lagerbar (`STORABLE`) und gehen als Überschuss in Lager/Schiffe.
- **Import-Export-Kontor:** muss ≤ `TRADER_HARBOUR_DISTANCE` (160 m) von einem Binnenhafen stehen (harte Regel in
  `planBuilding`), Hafen im selben Straßennetz. Ausbau Kontor → Handelshaus → Handelszentrum vergrößert nur das Lager
  (`traderCapacity` = 300 × 1/2,5/6) und das Modell (Lagerhalle, Containerhof). Bestand liegt in `storage[traderId]`
  (wie Lagerhallen, aber Schiffe laden dort nicht). Importierbare Waren: `IMPORT_GOODS` (Ware + Herkunft) – neue
  Importwaren nur dort eintragen; der Bedarf ergibt sich automatisch aus den `RECIPES`-Inputs der Betriebe im Netz.
  Einkauf zu `IMPORT_COST` × PRICE (als `imports` beim Kontor), Verkauf zu PRICE an die Betriebe.
- `simulate` liefert `importOut` (je Kontor verkaufte Menge/min, der Store zieht sie wie `storageIn` mit /60 × Tempo
  ab) und `importOrders` (offene Bestellungen je Hafen = Lageranteil nach Bedarf minus Bestand).
- **Schiffe bringen die Ware als Rückfracht:** Beim Verkauf am Markt (out → back) übernimmt ein Schiff die größte offene
  Bestellung seines Hafens (`Ship.freight`, bis zur Kapazität, abzüglich dessen, was andere Schiffe schon bringen),
  beim Anlegen wird ins Kontorlager entladen; die Stadt bekommt `FREIGHT_PER_UNIT` (6 €) je Einheit (als `shipSales`).
  Ein Schiff fährt auch ohne Exportladung los, wenn ≥ `MIN_ORDER` (20) offen sind. Kautschuk der Gummifabrik ist
  (noch) direkter Import ohne Kontor.
- **Lebensmittelfabrik = drei Linien (`FOOD_LINES`), jede läuft für sich:** Nudeln (`pasta`: Mehl + Eier), Süßigkeiten
  (`sweets`: Mehl + Kakao + Milch), Lebensmittel (`food`: Milch + Eier + Kaffee). Fehlt Kakao, laufen Nudeln trotzdem.
  Mehl von Mühlen, fehlendes Mehl füllt Weizen vom Hof auf (Weizen-Zeile in der Karte). Discounter verkauft alle drei
  (`GROCERY_DEMAND` je Einwohner, Regalplatz anteilig, Umsatz über `GROCERIES`); `fed` = Summe / `FOOD_PER_RESIDENT`.
- **Reis & Gewürze (Nutzerwunsch):** reine Importwaren (`IMPORT_GOODS`: Reis aus Thailand, Gewürze aus Indien), der
  Discounter nimmt sie **direkt vom Kontor** (keine Fabrik) – `IMPORTED_GROCERY_DEMAND`, Regal = `SHELF`. Der Discounter-Block
  läuft deshalb **vor** der Kontor-Abrechnung (`importOut` = Start − Rest). Eigener Wert `spiced` (zählt nicht in `fed`):
  Zuzug ×(0,97 + 0,06·spiced), Stimmungsfaktor „Reis & Gewürze“ (Gewicht 0,6). Bestellmenge folgt aus `RECIPES.discounter`.
- **Mehl: Brot hat Vorrang (`flourShare`):** Bäckereien teilen knappes Mehl untereinander nach Bedarf (keine leert die Mühlen
  allein), Lebensmittelfabriken bekommen den Rest und füllen mit Weizen vom Hof auf. Zwischenstand war „Mehl anteilig auch mit
  den Fabriken“ (Weizen-Bug `docs/bugs/weizen_bug.png`) – das ließ im Nutzer-Spielstand 28 Bäckereien bei 79,99 % Brot hängen
  (Grenze 80 %, HUD zeigte gerundet 80 %), kein Haus stieg auf. `growthLimit` nennt jetzt alle Hausausbau-Bremsen mit Zahlen
  („es fehlen: Brot 76,5 % von 80 %, Schulplätze …, Möbel …“), abgerundet statt gerundet.
- **Herkunft in der Karte (`status.sources`, `inputSource` in BuildingCard):** `take` merkt sich Lieferanten im Netz und
  wer etwas anbot. Karte unterscheidet „kein Lieferant im Straßennetz“ / „ausverkauft – alles an andere Abnehmer“ /
  „liefert – steht, es fehlt …“. Vorher stand bei jeder ausbleibenden Lieferung „kein Lieferant im Straßennetz“.
- Kalibrierung (Test 1 Fabrik, ~60 % Auslastung): Kontor +9, Fabrik +80, Hühnerhof +41, Discounter +81 €/min.

## Gold: Bergwerk, Schmelze, Juwelier, Goldtresor (`economy.ts`, `gold.ts`, `GoldVault` in CityPanels.tsx)

- Kette: Goldbergwerk (`goldmine`, in `MINES` → nur am Berg, `Mine kind="goldmine"`, Golderz 3/min) → Goldschmelze
  (`goldsmelter`, 3 Stufen Goldschmelze / Scheideanstalt / Goldraffinerie ×1/2/3,5, wächst nach hinten 26 × 22/30/38,
  `GOLD_ORE_PER_BAR` 2) → Juwelier (`jeweller`, `JEWELLERY_GOLD` 0,2 je Schmuck, `JEWELLERY_PER_RESIDENT`, `fairShare`). Juwelier ausbaubar (Juwelier / mit Goldschmiede / Schmuckhaus ×1/2/3,5, 12 m
  breit, wächst nach hinten 12/18/26, Kunden nach Größe verteilt wie bei der Metzgerei; Stufe 3 = drittes Stockwerk).
  `adorned` → Zuzug ×(0,98 + 0,04·adorned), Stimmungsfaktor „Schmuck“.
- **Goldtresor (Nutzerwunsch):** Barren gehören der Stadt (`gold` im Store/Spielstand). Übrige Barren einer Schmelze im
  Straßennetz einer Bank kauft die Stadt automatisch an (`goldIn`, `budget.gold` = „Goldankauf“, zum Großhandelspreis wie
  Lagerankauf; `status.vault` je Schmelze). Im Bank-Panel kaufen/verkaufen (`tradeGold(n)`, ±`GOLD_SPREAD` 2 %) zum
  Goldkurs (siehe Börse).
- **Börse (`exchange`, öffentlich, einmal pro Stadt, Panel `ExchangePanel` in CityPanels.tsx):** vorerst nur der Goldkurs
  (Nutzerwunsch, Algorithmus gefakt). `goldPrice(minutes)` in gold.ts = Referenz 1.000 € × exp(Summe von Value-Noise über
  12 Tage / 3 Tage / 8 h / 1 h / 7 min) – zustandslos und deterministisch, nichts zu speichern; über ein Spieljahr ~730–1.410 €,
  max. ±2 € je Minute. **Später durch ein echtes Modell ersetzen – alles liest nur `goldPrice`/`goldQuote`.** Die Bank handelt
  zu `goldQuote(minutes, exchange)`: mit Börse Kurs, ohne Börse Festpreis 1.000 €. Panel: Kurs, Eröffnung/Hoch/Tief
  (`goldDay`), Verlauf 1/7/30 Tage, Kursliste (nur Gold, „Weitere Werte folgen“), Tresor + Knopf zur Bank. Modell: Säulenhalle,
  Kurstafel auf dem Fries zeigt live den Goldkurs (`drawTicker` zeichnet die CanvasTexture alle 5 Spielminuten neu).
  Der automatische Goldankauf der Schmelzen bleibt beim festen Großhandelspreis (`PRICE.gold`).
- `Trend` (PanelParts) ist generisch (`samples: T[]`, `zero={false}` für Preise).

## Flughafen (`economy.ts`, `Airport.tsx`, `AirportSection` in `LogisticsCard.tsx`)

- `airport` (öffentlich, HUD-Kategorie „Luftfahrt“, Icon `plane`): Flugplatz → Regionalflughafen → Flughafen
  (`LEVELS.airport`, Faktor 1/3/8, Ausbau 400 k / 1,2 Mio €). **Ein Grundstück für alle Stufen (380 × 130 m, kein
  `LEVEL_SIZE`)** – Nutzerwunsch: Ausbau ändert nur das Aussehen. Bahn läuft parallel zur Straße. Zählt als `INDUSTRY`
  (Häuser halten Abstand; Puffer nutzt `sizeOf`). Keine Hangprüfung (`MAX_UNEVEN` = Infinity), nur Wasser verhindert ihn.
- **Gelände wird eingeebnet (`levelPads` in terrain.ts):** Grundstück + 2 m auf `buildingGround` (Mittel), Hügel/Berge
  abgetragen, Senken aufgefüllt, Böschungen 1 : 1,5 (max. 160 m) zurück zum Gelände, Wasser außerhalb bleibt.
  Läuft in `useShapedGrid` **vor** `cutTerrain` (Straßen schneiden danach in die Fläche). Schlüssel nur aus den
  Flughäfen (`airportKey`), damit nicht jedes neue Haus Raster und Bodenmesh neu baut. Bäume fallen überall weg, wo
  das geformte Gelände > 0,4 m vom natürlichen abweicht (`reshaped` in Trees.tsx; gilt auch für Straßeneinschnitte).
  Das Modell hat keine eigene Plattform mehr, es liegt 0,12 m (`AIRPORT_LIFT`) über dem eingeebneten Boden.
- **Alle Einzelgebäude werden eingeebnet** (seit Bug „Jahrmarkt hängt im Boden“: flache Kiesfläche auf mittlerer Höhe,
  bergseitig im Hang): `useShapedGrid` legt für jedes Gebäude außer `UNLEVELLED` (Häuser, Höfe, Schaffarmen, Bergwerke)
  ein Pad mit `reach` 14 m / `margin` 0,5 m an; nur der Flughafen trägt ganze Hügel ab (160 m).
- **Andocken großer Grundstücke (`planBuilding`):** Fangradius = max(70, Tiefe/2 + 45) – vorher 70 m fest, beim tiefen
  Flughafen lag der Cursor (Grundstücksmitte) fast immer weiter weg → frei platziert und schräg. Frei stehende Gebäude
  (`frontToRoad`) richten sich jetzt **parallel** zur nächsten Straße aus (vorher zum nächsten Straßenpunkt gedreht).
- **Alte Spielstände:** `redockAirports` (placement.ts) läuft in `loadGame` und dockt jeden Flughafen, der schief oder
  nicht an der Straße steht, an die nächste Straße (≤ 300 m) an – wie neu platziert, Stufe bleibt, Häuser im Weg werden
  abgerissen, andere Hindernisse lassen ihn stehen (Grund in der Meldung). Idempotent: korrekt stehende bleiben unverändert.
- **Urlaub:** Nachfrage `HOLIDAY_PER_RESIDENT` × Einwohner, Plätze `AIRPORT_PASSENGERS` × Faktor × Auslastung;
  `holiday` (Anteil) → Zuzug × (1 + 0,1 · holiday) und Stimmungsfaktor „Urlaub“ (nur wenn ein Flughafen existiert,
  sonst würde er die Stimmung aller Städte ohne Flughafen senken). Gebühren `FARE` je Passagier an die Stadt.
- **Luftfracht** ab Stufe 2: `airCargoCapacity` holt die teuersten `STORABLE`-Waren aus Lagerhallen im Straßennetz
  (`airOut`, der Store zieht sie wie `importOut` ab), Verkauf zu `AIR_PRICE_FACTOR` (1,35) × PRICE – bewusst nur knapp
  über Schiffen (1,25), aber mit begrenzter Menge. Einnahmen in `budget.airport` (Finanzamt-Zeile „Flughafen“, Statistik).
- **Darstellung:** Bahnen/Markierungen als gemergte flache Boxen auf dem eingeebneten Gras. Lokales Layout `airportLayout(level)`: Straße bei −z,
  Vorfeld, Rollweg, Bahn parallel zur Straße. Flugzeuge (`PlaneModel`: prop/jet/wide/cargo aus Primitiven) fliegen einen
  festen **Echtzeit**-Fahrplan (`fly`, Zyklus 240 s: Pushback, Rollen, Start Richtung +x, Steigflug außer Sicht,
  Anflug von −x, Landung, zurück zur Position) – unabhängig vom Spieltempo, angehalten bei Pause, bei stillgelegtem
  Flughafen alle geparkt. Flugzeuge hängen **außerhalb** der `GROUNDED`-Gruppe (sonst blieben Kontaktschatten am leeren
  Standplatz zurück).

## Stadtpark und Spielplatz (`economy.ts`, `Park`/`Playground` in Buildings.tsx)

- `park` (40 × 32 m) und `playground` (22 × 16 m), öffentlich, **ohne Straße** (`ROADLESS_KINDS` in economy.ts, von
  `placement.ts` übernommen; kein „Stillgelegt“, Unterhalt läuft trotzdem). Drei Stufen auf festem Grundstück
  (Stadtpark / mit Pavillon / Großer Stadtpark; Spielplatz / Abenteuer- / Erlebnisspielplatz), Umkreis
  `RECREATION_RADIUS` (Park 250/350/450 m, Spielplatz 180/250/320 m).
- Wirkung: `green`/`play` = Anteil der Einwohner mit Park/Spielplatz im Umkreis → `leisure` +0,15/+0,1, Zuzug
  ×(0,97 + 0,06·green)(0,98 + 0,04·play), Stimmungsfaktoren „Grünflächen“/„Spielplätze“. `recreation[id]` = Einwohner
  im Umkreis (Karte „Erholung“). Umkreis-Scheibe beim Auswählen über `JobCentreArea.tsx` (`AREAS`: orange Arbeitsamt,
  grün Park, gelb Spielplatz).
- Materialien `lawn` (Blatt-Foto als Körnung, dunkel – heller Einfarbrasen wirkte neon), `sand`, `leaves`, `pond`;
  Baumstämme `log`, Zäune `plank` (`wood` ist rotbraun).
- HUD-Logo oben links = Haus aus dem Ladebildschirm (`HouseLogo` in LoadingScreen.tsx).
- Kleidungsfabrik wächst wie Spinnerei/Schlachthof nur nach hinten (34 m breit, Tiefe 24/34/42).

## Recyclinghof (`economy.ts`, `RecyclingYard` in Buildings.tsx)

- `recycling` (privat, Industrie, Stufen Recyclinghof / Wertstoffhof / Recyclingwerk ×1/2/3,5, Grundstück 30 m breit,
  wächst nach hinten 24/32/40): sammelt `RECYCLE_PER_RESIDENT` je Einwohner im Straßennetz (auf Höfe nach Größe
  verteilt), max. `RECYCLE_CAPACITY` × Faktor → Ware `recycled` („Recyclingstoffe“, lagerbar, PRICE 70).
- Möbelfabriken nehmen zuerst Recyclingstoffe für bis zu `RECYCLED_SHARE` (40 %) von Brettern **und** Stahl (anteilig),
  den Rest von Holzfabrik/Stahlwerk. Karte zeigt die Zeile nur, wenn es einen Recyclinghof gibt.
- **Ausbau prüft jetzt Stromleitungen** (`planGrowth(..., cables)`) – vorher wuchs ein Grundstück unter eine Leitung,
  ein Mast stand dann mitten im Gebäude.
- **Spielstand-Layout (`LAYOUT_VERSION` / `migrateLayout` in save.ts):** Ändern sich Grundstückstiefen je Stufe, alte
  Tiefen in `OLD_DEPTH` eintragen und `LAYOUT_VERSION` erhöhen – beim Laden wird die Mitte so verschoben, dass die
  Vorderkante an der Straße bleibt (`SAVE_VERSION` nicht erhöhen, das verwirft alte Stände).

## Bank und Rathaus (`finance.ts`, `wellbeing.ts`, `CityPanels.tsx`)

- Beide öffentlich (`PUBLIC`) und nur einmal pro Stadt (`UNIQUE`, Prüfung in `planBuilding`).
  Die Gebäudekarte hat einen Knopf, der ein großes Panel rechts öffnet (`panel` im Store).
- **Bank:** Kontostand, Verlauf, Einnahmen/Ausgaben als Balken, Kredite. `LOAN_OFFERS`
  (Betrag, Zins auf die Summe, Laufzeit in Spieltagen); Rate in „€ pro Minute“ wie der HUD-Saldo
  (`payLoans` zieht Rate/60 je Spielminute ab). Ablösen kostet nur die Restschuld ohne weitere
  Zinsen (`payoffOf`). Kreditrahmen `creditLimit` = 50 k + 150 € je Einwohner + 60 × positiver Saldo.
  Kredite nur mit Bank. HUD-Saldo und Haushalt zeigen den Saldo nach Kreditraten.
- **Rathaus:** Stimmung der Bürger = gewichtetes Mittel der `moodFactors` (Wasser, Brot, Fleisch,
  Arbeit, Gesundheit, Bildung, Strom, Einrichtung, Freizeit, Steuern), Beschwerden (< 60 %),
  Trends, Statistik, Gebäude mit Problemen (Klick wählt aus). Rein analytisch, keine Wirkung.
- Trends: `stats` (alle `STAT_INTERVAL` = 30 Spielminuten, max. `STAT_LIMIT`). `loans` und `stats`
  stehen im Spielstand.

## Finanzamt und Baugenehmigungen (`treasury.ts`, `TaxOfficePanel.tsx`, `growth.ts`)

- **Finanzamt** (`taxoffice`, öffentlich, einmal pro Stadt): alle Gelddaten laufen über
  `treasuryReport(economy, buildings, loans, businessTaxRate)` in `lib/city/treasury.ts` (Einnahmen-/
  Ausgabenzeilen inkl. Kreditraten, Saldo pro Spieltag = Rate × 24, Lohnsumme/Gewinnbasis, Ertrag je
  Steuerpunkt, Zuzugsfaktor `taxAttraction`, Branchen, größte Steuerzahler, Verlustbetriebe,
  schuldenfrei in X Tagen). Bank-Panel und Kurz-Haushalt nutzen dieselbe Funktion (`SERVICE_LABEL`).
- Steuersätze werden **nur noch im Finanzamt** eingestellt (nicht mehr oben links). Ohne Finanzamt
  bleiben sie fest; Klick auf den Saldo oben links öffnet das Finanzamt (sonst Kurz-Haushalt).
- Panel-Bausteine (`Frame`, `Heading`, `Line`, `Bar`, `Trend`) liegen in `PanelParts.tsx`.
  `StatSample.income` = Stadteinnahmen je Messpunkt.
- **Baugenehmigungen** im Rathaus-Panel: `permits` (`all` / `upgrades` = nur Ausbau / `none` = Baustopp),
  im Store und Spielstand. Wirkt nur, solange ein Rathaus steht. Bei Baustopp werden Wachstumspunkte
  bei `GROWTH_STEP` gedeckelt; Hinweis oben links und im Ticker.

## Bauen ohne Anschluss, Abriss (`placement.ts`, `bulldoze.ts`)

- **Alles darf ohne Straße gebaut werden:** Liegt keine Straße im Fangradius, steht das Gebäude frei am
  Cursor (Front zur nächsten Straße, Hafen mit dem Rücken zum Wasser). `planBuilding` liefert dann
  `warning` statt `problem` → Geist **gelb**, Meldung „stillgelegt, bis der Anschluss steht“. In `simulate`
  ist es `connected: false` (Status „Stillgelegt – kein Straßenanschluss“), produziert nichts; stillgelegte
  öffentliche Gebäude kosten keinen Unterhalt (außer Kraftwerk/Trafo). Wasser-/Flussprüfung des Hafens
  ist ebenfalls nur noch Warnung: `harbourWaterProblem` je Takt (`harbourStatus` im Store, gecacht) →
  Status „Stillgelegt – …“, seine Schiffe bleiben am Kai. Harte Regeln bleiben: Geld, Wasser unter dem
  Grundriss, Hang, Überschneidung, Stromleitung, Kraftwerk am Wasser, Bergwerk am Berg, nur eins pro Stadt.
- **Abriss-Werkzeug** (Tool `bulldoze`, Bagger-Knopf rechts neben den Kategorien): Klick entfernt das
  Segment zwischen zwei Punkten des Weges unter dem Cursor (Straße, Autobahn, Rampe, Radweg, Gleis, Kanal,
  Stromleitung), Rest bleibt als eigene Pfade (`splitOut`, zweites Stück neue ID, `separations` werden
  übertragen). Rote Vorschau in `RoadBuilder.tsx`. Rückgängig mit Strg+Z (History-Snapshot).

## Lagerhallen, Häfen, Binnenschifffahrt (`economy.ts`, `shipping.ts`, `waterways.ts`, `Ships.tsx`)

- **Lagerhalle** (`warehouse`, öffentlich, Stufen Lagerhalle/Großlager/Logistikzentrum, Kapazität
  `WAREHOUSE_CAPACITY` × `LEVELS.warehouse.factor` = 400/1200/3000). Kauft nach dem Finanzloop den
  Rest-Bestand (`stock`) der Betriebe im selben Straßennetz an (`STORABLE`: Bretter, Stahl, Möbel,
  Leder, Gummi, Schuhe, Kohle, Erz) – zum Exportpreis, den die Betriebe ohnehin bekommen; die Stadt
  zahlt das als `budget.storage` („Lagerankauf"). Bestand im Store: `storage` (Lager-ID → Ware → Menge),
  Zufluss je Minute `economy.storageIn`. **Einheiten:** Raten gelten pro HUD-Minute, im `tick` also
  `/ 60 × speed` je Spielminute (wie Geld).
- **Binnenhafen an Kanälen:** Liegt ein Kanal ≤ 45 m (`SNAP_CANAL`) vom Cursor, dockt der Hafen mit dem
  Kai an die Kanal-Außenkante (`OUTER_HALF_WIDTH.canal` + 0,8 m), Front zur Landseite; Straßenanschluss
  über `accessRoad` (Straße vor der Front). Vorher dockte er nur an Straßen → am Kanal fast immer rot.
- **Binnenhafen** (`harbour`, öffentlich, mehrere erlaubt): Rückseite am Wasser, die hinteren 8 m
  (`HARBOUR_QUAY`) dürfen im Wasser stehen (Kai). Prüfungen: `quayWater` (Wasser am Kai, schiffbare
  Tiefe ≤ 60 m) und `reachesMarkets` – das Gewässer muss die Karte verlassen (abgeschlossene Teiche/Seen
  sind verboten). Achtung: Wasser beginnt erst bei Tiefe 0,9 (`WET_DEPTH`).
- **Schiffe** (`ships` im Store/Spielstand, gehören immer zu einem Hafen, max. `HARBOUR_BERTHS` = 3):
  `SHIP_TYPES` Motorgüterschiff/Großmotorgüterschiff/Schubverband. Kauf/Verkauf (50 %) in der Hafenkarte
  (`LogisticsCard.tsx`). `stepShips`: docked → lädt wertvollste Ware aus Lagern im Hafen-Straßennetz
  (wartet bis 120 min auf ¼ Ladung) → loading (`LOAD_MINUTES`) → out (½ trip, dann Verkauf zu
  `SHIP_PRICE_FACTOR` × PRICE) → back. Erlöse in Schüben (`shipSales`, letzter Spieltag); HUD-Saldo und
  Finanzamt zeigen den Schnitt (`salesRate`). Schiffsunterhalt läuft über `budget.services.harbour`.
  Sichtbarkeit: jeder Verkauf landet als Einzelposten in `shipSales` (mit `harbour`/`ship`); der neueste blinkt
  ~20 Spielminuten als „+X €“ neben dem Kontostand, darunter „Schiffe: +X € am letzten Tag“; die Hafenkarte zeigt
  „Erlös letzter Spieltag“ (`harbourSales`) und den letzten Verkauf.
- **Wasserwege** (`waterways.ts`): Zusammenhangskomponenten des Tiefenrasters ≥ `FAIRWAY_DEPTH`, welche
  den Rand berühren (`outlet`); `routeToEdge` = Dijkstra (Mitte bevorzugt) vom Hafen zum Kartenrand.
  Schiffe liegen hintereinander auf dieser Route (`BERTH_SPACING`), fahren sie ab und verschwinden am Rand.
  Distanzen in `Float64Array` (Float32 rundet und lässt gültige Heap-Einträge verwerfen!).
  `__city.route(x, z)` im Dev-Modus zum Testen.

## Polizei, Feuerwehr, Einsätze (`lib/city/incidents.ts`, `traffic.ts`, `Traffic.tsx`, `Fires.tsx`)

- Gebäude `police` (Polizeiwache / Polizeirevier / Polizeipräsidium) und `firestation` (Feuerwache / Hauptfeuerwache /
  Berufsfeuerwehr), öffentlich, HUD-Kategorie „Sicherheit“, fester Grundriss, `LEVELS`-Faktor = Fahrzeuge (1/2/3),
  Umkreis `SERVICE_RADIUS` (450/650/900 bzw. 400/600/800 m). Modelle klassisch (`PoliceStation`/`FireStation` in
  Buildings.tsx, auch im Pack-Stil). Stimmung „Sicherheit“/„Brandschutz“ (`safety`/`fireCover` = Einwohneranteil im
  Umkreis einer angeschlossenen Wache, Zuzug ×(0,96 + 0,08·safety)(0,97 + 0,06·fireCover)); Umkreis-Scheibe in `JobCentreArea`.
- **Einsätze (`incidents` im Store/Spielstand), Nutzerwunsch „selten, Alarm selbst auslösen“:** `stepIncidents` im Takt:
  Unfall (Chance ∝ Straßen-km, Deckel 0,0025/min) oder Hausbrand (∝ Häuser, Deckel 0,0015/min), max. 4 gleichzeitig und
  mindestens `MIN_GAP` (120 Spielminuten) zwischen zwei Einsätzen (`incidentLastAt`, nicht im Spielstand). Der **Spieler**
  löst den Alarm aus (Notruf-Leiste `EmergencyCalls` unter der Meldungszeile: „Alarm auslösen“, „Zeigen“ =
  `flyToIncident`; Store `raiseAlarm` → `dispatch`): Wache gleicher Art im **selben Straßennetz** (`economy.roadNetworkOf`
  für Straßen, `networkOf` für Häuser), Einsatzort im Umkreis, freies Fahrzeug (`busyVehicles` < `vehiclesOf`), nächste
  zuerst; sonst Meldung mit Grund. Ohne Alarm: Unfall blockiert `ACCIDENT_CLEAR` (120 min), Brand macht das Haus nach
  `FIRE_BURN` (60 min) zur **Brandruine** (`kind: "ruin"`, keine Bewohner/Steuern, Problem in der Karte, Modell `Ruin`
  in Buildings.tsx) – sie muss abgerissen werden (Knopf „Abreißen“ in der Karte oder Klick mit dem Bagger, rote Vorschau in
  `RoadBuilder.tsx`; Ruinen gehen beim Bagger vor Wegen), dann bebaut das Wachstum das Grundstück neu.
  Zugewiesene Einsätze beendet die Szene (`resolveIncident`), Sicherheitsnetz 240 min. Abriss einer Wache ruft zurück.
- **Krankenwagen (Nutzerwunsch „bei Bedarf“):** 60 % der Unfälle / 40 % der Brände haben Verletzte (`injured`). Der Alarm
  schickt dann zusätzlich einen Krankenwagen (`dispatchAmbulance`): nächstes Krankenhaus im selben Straßennetz bis
  `AMBULANCE_RADIUS` (1.200 m) mit freiem Wagen (`AMBULANCES` = 2, `busyAmbulances`). Eigene Mission (`Mission.ambulance`,
  `role: "ambulance"`), hält hinter dem Wrack bzw. vor dem Löschfahrzeug, 30 s, meldet `ambulanceDone`. Ist Polizei/Feuerwehr
  vorher fertig, bleibt der Einsatz als `cleared` stehen, bis der Krankenwagen fertig ist.
- **Geld:** je erledigtem Einsatz `MISSION_FEE` (Unfall 900 €, Brand 2.500 €, Krankentransport 1.200 € „Krankenkasse“),
  direkt aufs Konto mit Meldung; laufend `budget.emergency` = Einwohner × (safety · `POLICE_FINES` 0,006 + fireCover ·
  `FIRE_LEVY` 0,004) €/min („Bußgelder & Feuerschutzabgabe“ im Finanzamt, in `income`/Statistik enthalten).
- **Fahrzeuge in Echtzeit (`Traffic.tsx`, Missionen):** `Car.role`/`route`/`stopAt`/`parked`. Abfahrt am Straßenpunkt
  vor der Wache (`stationExit`), Ziel = die Fahrtrichtung der Unfallstraße mit kürzerer Route (`nearestEdges` +
  `routeEdges`, Dijkstra über den Spurgraphen, Wenden an Straßenenden mit Strafe). Blaulicht = zwei abwechselnd
  leuchtende Instanz-Boxen (toneMapped false → Bloom). Autos vor dem Fahrzeug rücken nach rechts (`yieldT`,
  `YIELD_SHIFT`) und kriechen; das Fahrzeug fährt links vorbei (`passingTraffic`/`laneShift`), ignoriert Ampeln,
  umfährt parkende Fahrzeuge. Jeder Unfall hat ein Wrack (`syncWrecks`: schräger Sedan als geparktes Auto ohne Licht,
  Spur blockiert → Stau), auch ohne Polizei. Am Ort: `parked` → Pylonen (`cone.glb`) + Trümmer (`debris-*.glb`),
  `ON_SITE_SECONDS`, dann Rückfahrt und Löschen (das Wrack verschwindet mit dem Einsatz).
  Dev: `window.__traffic` = { graph, missions, cars, closures }. Flammen/Rauch je Brand in `Fires.tsx` (gehen aus, wenn `onSite`).
  Beim Testen mit `setState({incidents:[…]})` Einsätze setzen; ein neuer Spurgraph (HMR, Straßenbau) startet Missionen neu.

- **Vollsperrung (Nutzerwunsch):** Solange ein Fahrzeug eines Einsatzes vor Ort steht (`phase: "onsite"`), ist die ganze Straße
  von Knoten zu Knoten in beiden Richtungen gesperrt (`syncClosures` in Traffic.tsx, Kanten aus `nearestEdges`, Pylonenreihe an
  jeder Einfahrt). `chooseNext(..., closed)` meidet gesperrte Kanten (Straße: wenden, Autobahn: am Knoten warten = Stau),
  `stepCars` wählt neu, wenn `next` gesperrt wird; `closeStreet` lässt Autos vor der Einsatzstelle wenden. Einsatzfahrzeuge
  ignorieren die Sperre und fahren `EMERGENCY_SPEED` (1,8×) mit stärkerer Beschleunigung (`YIELD_RANGE` 60 m).
- **Brand = Feuerwehr + Polizei (+ Krankenwagen):** `raiseAlarm` schickt beim Brand zusätzlich einen Streifenwagen
  (`dispatchPolice`, `Incident.police`/`policeDone`, optional – ohne freien Wagen sperrt die Feuerwehr selbst). Missionen haben
  `unit` (`main`/`ambulance`/`police`); die Polizei bleibt, bis die Feuerwehr abgefahren ist (+`POLICE_LINGER` 8 s), und meldet
  `policeDone`. Ein Einsatz endet erst, wenn alle Einheiten fertig sind (`incidentDone`). `busyVehicles` zählt Brand-Einsätze mit.
- **Gebäudeliste (`BuildingsMenu` in Hud.tsx, oben rechts „Gebäude“):** alle gebauten Objekte außer Wohnhäusern, nach Art
  gruppiert und eingeklappt (Kopf mit Anzahl, Klick klappt auf; Brandruinen zuerst, rot, aufgeklappt), ohne Suche; Klick = `flyTo`.
  Aufgeklappt war die Liste im Nutzer-Spielstand ~10.000 px lang – Polizei/Feuerwehr wirkten „fehlend“.
- **Gefängnis (`prison`, Sicherheit):** Gefängnis / Justizvollzugsanstalt / Hochsicherheitsgefängnis (56 × 48 m, `LEVELS`-Faktor
  1/2,5/6 × `PRISON_PLACES` 100 Haftplätze). Wirkt nur mit Polizeiwache im selben Straßennetz (sonst Problem „bleibt leer“):
  Häftlinge = min(Plätze, Einwohner × `INMATES_PER_RESIDENT`), Land zahlt `PRISON_REFUND` €/Häftling/min (`budget.justice`,
  Finanzamt „Haftkostenerstattung“), Polizei-Bußgelder und `safety` +`PRISON_POLICE_BONUS` (40 %). Modell `Prison` in
  RailwayBuildings.tsx (Mauer, Wachtürme, Zellentrakte je Stufe).

## Bürgermeister: Privatkonto, Korruption, Villa (`mayor.ts`, `MayorPanel.tsx`, `Villa.tsx`, Nutzerwunsch)

- **Privatkonto** (`mayor` im Store/Spielstand, `MayorState`): Gehalt aus der Stadtkasse (`salary` €/min, Standard 25, bis
  `SALARY_MAX`; „angemessen“ = `fairSalary` 1,5 € je 100 Einwohner). Knopf „Bürgermeister“ oben rechts (Kontostand, rotes Abzeichen =
  offene Angebote) öffnet das Panel (`panel: "mayor"`), ebenso die Villa-Karte.
- **Angebote** (`stepMayor`, alle ≥ 150 Spielminuten, max. 4, 360 min gültig, nicht im Skandal; Nutzerwunsch „rasch bereichern“
  – vorher ~10× kleiner): Baugenehmigung (20 k + 25 €/Einwohner, +`PERMIT_POINTS`), Steuerrabatt (großer Steuerzahler 5 Tage
  steuerfrei, 60 % der Ersparnis + 20 k + 5 €/Einw.), überteuerter Auftrag (50 k + 40 €/Einw., Stadt zahlt 2,5×). Dazu
  „Stadtkasse abzweigen“ (`embezzle`) und **Schutzgeld** (`rackets`, `setProtection`: 10/25/50 % vom Gewinn eines Betriebs,
  Abschnitt in jeder Firmenkarte `ProtectionSection`; +5 Verdacht beim Start, täglich 2 + 10·Anteil je Betrieb; die Stadt verliert
  den Steueranteil auf das abgeschöpfte Geld).
- **Verdacht** 0–100: Baugenehmigung +6, Steuerrabatt +10, Auftrag +15, sinkt 1,5 je Spielstunde. Skandal sicher ab 100 (geprüft
  **vor** dem Abklingen im Takt), sonst Chance 0,0012 × s³ je Minute: 60 % des Kontos beschlagnahmt (gehen an die Stadt), 3 Tage
  Zuzug ×0,5, Stimmungsfaktor „Bürgermeister“ 0,1 mit Gewicht 3, Verdacht danach 30, alle Deals enden. **Gefängnis:** zweiter
  Skandal innerhalb `PROBATION_MINUTES` (10 Tage, `lastScandalAt`, `null` = noch keiner – JSON kennt kein −Infinity) → ganzes
  Konto beschlagnahmt, Villa enteignet (aus `buildings` entfernt), `jailUntil` 5 Tage: kein Gehalt, keine Aktionen (alle Store-
  Aktionen prüfen `jailed`).
- **Geldwäsche (Nutzerwunsch):** Bestechung, Schutzgeld und Stadtkasse sind Schwarzgeld (`dirty`, Teil von `account`).
  Pizzerias (`pizzeria`, neu: Freizeit, Mehl + Milch → Mahlzeiten, teilt die Gäste mit Restaurants, Modell `Pizzeria.tsx`) und
  Recyclinghöfe als Waschanlage (`fronts`, `setLaundering`, Abschnitt `LaunderingSection` in deren Karten): `WASH_RATE` 5.000 /
  8.000 €/min × Stufe, Gebühr 15 % / 10 %, nur angeschlossen; je `8000 + 0,8·Einwohner` gewaschene € −1 Verdacht, je Anlage
  +0,5/Tag. Natürliches Abklingen jetzt 1/Stunde. Skandal beschlagnahmt 60 % Schwarzgeld + 15 % sauberes Geld (`SEIZED_CLEAN`),
  Haft alles. Ausgaben über `spend`: Villa zuerst sauberes Geld, Casino-Einsatz zuerst Schwarzgeld (Gewinne sauber).
- **Der Stadt zurückgeben** (`repayTown`, `repayCity`): Schwarzgeld zuerst, Geld in die Stadtkasse. `goodwill` (Ansehen, max. 0,5,
  je `100 k + 20 €/Einw.` +1, −0,03/Tag) wird zur Stimmung „Bürgermeister“ addiert (auch im Skandal), Verdacht −1 je
  `16 k + 1,6 €/Einw.`. Läuft ein Skandal, kürzt die Zahlung die Restzeit um bis zu 94 % (`SCANDAL_CUT`, voll ab
  `scandalRepay` = 50 k + 25 €/Einw., darunter anteilig).
- **Bootshaus** (`boathouse`, Nutzerwunsch, `Boathouse.tsx`): einmal pro Stadt, vom Privatkonto (`MAYOR_PRIVATE` = Villa +
  Bootshaus: Bezahlen, Rückgängig-Erstattung, Enteignung bei Haft), ohne Straße, 16 × 26 m: vorne 12 m Land, hinten
  `BOAT_JETTY` 14 m Steg überm Wasser. Platzierung: Rücken zum Wasser (`backToWater`), vom Cursor aus zur Uferlinie
  verschoben; der Landteil darf bis knapp über den Wasserspiegel reichen (Strand liegt unter 0 m), 2 m Spielraum für schräge
  Ufer; am Stegende muss Wasser sein. **Nicht eingeebnet** (`UNLEVELLED`, sonst füllt das Pad den See). Höhe = Vorderkante.
  Stufen (Nutzerwunsch, festes Grundstück): Bootshaus (Holzhaus mit Satteldach, Sprossenfenster mit weißen Rahmen, Glastüren
  zum See, Blumenkästen, Schornstein) → mit Lounge (+400 k: Pergola mit Sofas, Liegen am Steg) → Luxus-Bootshaus (+2,5 Mio:
  Motoryacht vor dem Stegkopf, Whirlpool, Fahne, Steglichter). Stegkopf nur nach **links** (L), die Ausfahrt des Sportboots
  rechts vom Steg bleibt frei – vorher fuhr es durch den T-Kopf; die Yacht liegt links davon (gemessen 1,8 m Luft), die Runde
  beginnt erst 24 m draußen. Sportboot in Weltkoordinaten außerhalb der gebündelten Gruppe: legt nach 40–120 s (Echtzeit, Pause stoppt) ab und fährt eine
  Runde auf einem Kreis, der ganz im offenen Wasser liegt (`planTrip`, einmal aus dem Tiefenraster); ohne Platz bleibt es liegen.
- **Spielbank** (`casino`, Freizeit, privat, Ware `game` über `ATTRACTIONS`, +0,1·Anteil Freizeit, Modell `Casino.tsx`): Karte
  „Roulette spielen“ → `RoulettePanel` (europäisch, `roulette.ts`, Einsatz vom Privatkonto, Zahl 35:1, Dutzend 2:1, einfache
  Chancen 1:1). `playRoulette` bucht sofort, das Panel enthüllt die Zahl erst nach der Kugel (kein Ticker, Verlauf/Konto verzögert).
- **Einbindung:** `applyMayor` im Store-`tick` nach der Bahn (gilt auch für `tickAsync`): Gehalt und erlassene Steuer gehen von
  `balance` ab, `budget.mayor` = Finanzamt-Zeile „Bürgermeistergehalt“, `budget.favours` ist schon aus `businessTax` heraus.
  `economy.mayor` → Stimmungsfaktor in `moodFactors`.
- **Villa** (`villa`, einmal pro Stadt, öffentlich, `ROADLESS_KINDS`, `MAX_UNEVEN` ∞, festes Grundstück 56 × 48 für alle Stufen):
  Bürgermeistervilla / Luxusvilla / Traumvilla (150 k / +400 k / +1 Mio €) – **bezahlt vom Privatkonto** (`placeBuilding`,
  `upgrade`, Geist in BuildingTool, Baukarte, Gebäudekarte lesen dann `mayor.account`; Rückgängig erstattet über `villaValue`).
  Modell aus Kenney-Teilen: Haupthaus `building-type-p` (einziges zweigeschossiges Flachdach im Suburban-Kit, gemessen über
  waagerechte Dachflächen; `e` hat ein Satteldach), Bungalow/Poolhaus `q`, Sonnenschirme (Commercial), Zypressen/Eichen (Nature,
  Laub umgefärbt), Sportwagen + Luxus-SUV (Car-Kit, `cloneScaled` je Achse); Pool, Whirlpool, Garage, Rosengarten mit Hecken,
  Brunnen und Rosenbogen, Prunkzaun (Steinpfeiler, Eisenstäbe, Goldkappen ab Stufe 2, Goldspitzen Stufe 3), Tor mit Laternen.
  Am Berg: Pad mit `reach` 30 (useProfiles) + Natursteinsockel 14 m tief. **Höhe = Vorderkante** (`buildingGround` nimmt für
  die Villa nur `frontSamples`): mit dem Mittel des Grundstücks stand sie am Hang ~4 m über der Straße (Nutzer-Bug).

## Sound (`components/city/sound/engine.ts`, `SoundDirector.tsx`, Nutzerwunsch „Wirtschaftssimulator-Stil, manchmal spannend“)

- Alles per Web Audio synthetisiert (keine Dateien). Singleton `sound`, startet erst nach einer Nutzergeste (`ensure()` bei
  pointerdown/keydown). Musik generativ mit Vorausplanung (16tel, 50-ms-Takt, `LOOKAHEAD`): ruhig Cmaj7–Am7–Fmaj7–G6 mit Pad
  (Hall per erzeugter Impulsantwort), Sinusbass, FM-Pluck-Arpeggio; alle 16 Takte mit 35 % ein lebhafterer Abschnitt (Shaker,
  dichteres Arpeggio). `setIntensity` (0..1, geglättet): ab 0,5 Am–F–Dm–E, Achtelbass, Kick/Snare, schneller (82→96 BPM).
- `SoundDirector` (in `Hud`): Klick auf jeden Button, Bauen/Abriss (History wächst), Ausbau, Notruf, Angebot, Geld aus Deals,
  Skandal/Haft; Intensität: Haft 1, offener Notruf 0,85, Skandal 0,8, betreuter Einsatz 0,6. Pause = Musik leiser. Roulette spielt
  `spin`/`win`/`lose` selbst. Neue Ereignisse dort ergänzen.
- Einstellungen › Ton: Musik/Effekte getrennt Aus/Leise/Mittel/Laut (`useSoundSettings`, localStorage `citypower.sound`, nach
  dem Mount gelesen). Dev: `__city.sound.play("cash")`, `__city.sound.setIntensity(1)`.

## Zeitung „Citypower Rundschau“ (`lib/city/news.ts`, `NewspaperPanel.tsx`, `NewspaperHouse.tsx`, Nutzerwunsch)

- Gebäude `newspaper` „Zeitungsverlag“ (Wirtschaft › Freizeit & Medien, privat, einmal pro Stadt): verkauft Zeitungen (Ware
  `news` über `ATTRACTIONS`), Modell Backstein-Redaktion mit RUNDSCHAU-Schild, Druckhalle mit Sheddach, Papierrollen, Lieferwagen.
- **Ereignisse:** Im `tick` vergleicht `collectNews` den Stand mit dem letzten Takt (`newsSnapshot`, Modulvariable `lastNews`,
  nach `loadGame`/`newWorld` null – sonst wären alle Gebäude „neu“): neue/ausgebaute/abgerissene Gebäude (ohne Häuser), Ruinen,
  Unfälle/Brände/Rettungen, Skandal, Haft, Entlassung, Rücküberweisung, Gehaltserhöhung über „angemessen“, Einwohner-Meilensteine.
  `newsLog` hält 2 Spieltage.
- **Ausgaben** (`newspapers`, neueste zuerst, max. 10, im Spielstand): steht ein angeschlossener Verlag, erscheint sofort die
  Erstausgabe, danach jeden Spieltag eine (`makeEdition(since, …)`: nur Ereignisse seit `printedAt` der letzten Ausgabe). Schlagzeile
  = wichtigstes Ereignis (`score`), dazu feste Rubriken Wirtschaft, Umfrage (Stimmung + größte Beschwerde), Börse (mit Börse) und
  Recherche (Gerüchte ab Verdacht 35, Schutzgeld, verdächtig erfolgreiche Waschanlage), Anzeigen der vorhandenen Betriebe.
  `day` = Spieltag wie im HUD (1-basiert). Texte aus Vorlagen, je Tag deterministisch variiert.
- Lesen: Knopf „Zeitung“ oben rechts (roter Punkt = ungelesen, `newsRead`) oder Karte „Zeitung lesen“ → Panel `newspaper`
  (Zeitungsseite mit Serifenschrift, zwei Spalten, Blättern). Neue Ausgabe: Ticker-Meldung + Sound `paper`.

## Bahn: Bahnhöfe, Stellwerk, Züge (`lib/city/railway.ts`, `train-graph.ts`, `Trains.tsx`, `RailwayBuildings.tsx`)

- Nutzerwunsch mit Kenney **Train Kit** (CC0, `public/models/trains/`, Auswahl von 13 Modellen). Das Kit hat keine
  Bahnhofsgebäude → Bahnhof/Stellwerk aus Grundformen im Kenney-Look (`RailwayBuildings.tsx`).
- `trainstation` (Haltepunkt / Bahnhof / Hauptbahnhof, 64 × 20, fester Grundriss, nur Modell wächst: Bahnsteig + Dach →
  Backstein-Empfangsgebäude → Sandstein mit Uhrturm und gläserner Bahnhofshalle) und `traindepot` „Stellwerk“
  (Stellwerk / Betriebshof / Bahnbetriebswerk, 52 × 24, Abstellgleise = `LEVELS`-Faktor 2/4/8). Beide `ROADLESS_KINDS`
  (hängen am Gleis, nicht an der Straße), öffentlich. **Andocken** in `planBuilding` wie Hafen am Kanal: nächstes Gleis
  ≤ 45 m (`nearestTrack`), Rückseite zum Gleis mit `RAIL_SETBACK`; ohne Gleis Problem. Bahnsteig ragt 2,2 m über das
  Grundstück zum Gleis (`PLATFORM_REACH`). `railOf(b)` findet das Gleis an der Rückseite, `railNetworks` = über gemeinsame
  Punkte verbundene Gleise.
- **Züge** (`trains` im Store/Spielstand, `buyTrain`/`sellTrain`, Kauf in der Stellwerk-Karte `DepotSection`): `TRAIN_TYPES`
  Regionalzug (70 Fahrgäste/min), Schnellzug (160), Güterzug (90 Fracht/min). Laufen nur, wenn im Gleisnetz des Stellwerks
  ≥ 2 Bahnhöfe stehen. **Geld (`railEconomy`, im Store nach `simulate` eingerechnet):** Fahrgäste = Einwohner im
  `STATION_RADIUS` (je Haus der nächste Bahnhof) × 0,01/min, gedeckelt durch `STATION_CAPACITY` × Stufe und Zugkapazität,
  × `FARE` 4 €; Fracht = Industrie-Arbeitsplätze im Umkreis × 0,05 × `FREIGHT_RATE` 7 €; Unterhalt je Zug
  (`services.traindepot`). `budget.rail` („Bahn“ im Finanzamt), `transit` → Zuzug ×(0,97 + 0,06·transit), Stimmung
  „Bahnanschluss“ (nur wenn Bahnhöfe existieren).
- **Fahrt (`Trains.tsx`):** Gleisgraph `buildRailGraph` im Format des Spurgraphen (Doppelgleis rechts +2,25 m), Routen mit
  `routeEdges`. Pendelfolge über die Bahnhöfe in Linienreihenfolge (Hauptachse der Bahnhofspunkte), Halt mit Zugmitte am
  Bahnsteig, 12 s, an Endpunkten Richtungswechsel als Wendezug (`twinOf`, Wagen bleiben, `flip`). Beim Doppelgleis wechselt der
  Zug auf den letzten/ersten 90 m (`SWITCH`) aufs Bahnsteiggleis (`endLane`/`startLane`). Modelle je Achse skaliert
  (Wagen 19 m, Lok 16 m), Fenster leuchten nachts. **Fahrtrichtung (Nutzer-Bug „Regionalbahn falschrum“):** Die Triebköpfe
  `city-a`/`bullet-a` haben die Nase auf **+z** (gemessen: Dachhöhe fällt nach +z ab, −z = Kupplungsende) → `MODEL_YAW` 0
  (vorher π, beide Züge fuhren mit dem Heck voran). Personenzüge sind Wendezüge mit Triebkopf an beiden Enden (letzter
  Wagen = erster Wagen, wird umgedreht gezeichnet). Dev: `__trains.heads()` (Position, Fahrtrichtung, `flip` je Zug). Züge können sich auf
  eingleisigen Strecken durchdringen (keine Blockabstände) – offen.

## Baumenü (`Drawer` in Hud.tsx, Nutzerwunsch „bei Fabriken wird es eng“)

- Große Kategorien haben Unterreiter (`grouped(...)`: Versorgung, Wirtschaft, Industrie), Karten liegen in einem Raster
  (max. 6 Spalten, scrollt vertikal) statt einer langen Zeile, Suchfeld durchsucht alle Kategorien (Titel + Beschreibung,
  Tasten gehen nicht an die Spiel-Hotkeys). Neue Gebäude in die passende Gruppe eintragen.

## Tag und Nacht (`lib/city/daylight.ts`, `Sky.tsx`, `Sun.tsx`)

- Spieluhr `gameMinutes` steuert alles: `daylightAt(minutes)` liefert Himmelsmischung, Lichtrichtung/-farbe/-stärke,
  HDRI-Stärke (`scene.environmentIntensity` 0,06–0,7), Dunstfarbe (Fog) und Laternenglühen (`setLampGlow`, gemeinsames
  `LAMP_HEAD`-Material in Roads.tsx). Sonne 6–20 Uhr auf einem Bogen (Ost → Süd 60° → West), tief orange; nachts
  blauer Mond aus fester Richtung (0,35), Schatten bleiben.
- Himmel = Kuppel mit eigenem Shader (`Sky.tsx`): zwei Kenney-Panoramen (`public/sky/skybox-{day,morning,night}.jpg`,
  equirektangular 2048 px, CC0) gemischt: Nacht → Morgen (4:30–5:30) → Tag (7–8:30) → Morgen als Abendrot (18–19:12)
  → Nacht (20–21). Kuppel folgt der Kamera, immer auf der Fernebene; das HDRI ist nur noch Lichtquelle (kein
  `background`). Ein Spieltag = 24 Echtminuten bei Tempo 1.
- **Nachtlichter (`lib/city/night.ts` = Uniform `NIGHT`, `components/city/nightGlow.ts`):** `windowGlow(material, "kit"|"slate")`
  lässt Fensterglas-Texel (Kenney-Atlas hellblau `#d0e8ff…#9cbfec`, klassische Fassade Schiefer `#3b4a5a`) in ~40 % der
  Fenster warm leuchten – welche, bestimmt ein Hash der Weltposition (Zelle ≈ 1,4 m), sie gehen gestaffelt an. Hängt an
  `kitMaterial` (alle Kit-Gebäude) und am klassischen `wall`-Material. `signGlow` lässt Schilder leuchten (Bank: Geldschein auf
  dem Dach, BANK-Schild, klassisches `signBank`). Autos: Scheinwerfer/Rücklichter (Instanz-Boxen, toneMapped false) und ein
  additiver Lichtkegel auf der Straße (`drawCarLights` in Traffic.tsx), nur bei `NIGHT > 0,05`. Weitere `onBeforeCompile`-
  Materialien per `chain` anhängen (verkettet vorhandene Hooks und `customProgramCacheKey`).
- **Flughafen nachts (`AirfieldLights` in Airport.tsx):** weiße Bahnrandfeuer (alle 30 m), grüne Schwelle bei −x (Anflug),
  rote bei +x, blaue Rollwegfeuer (alle 20 m), Flutlichtmasten am Vorfeld mit additiven Lichtkreisen, Terminal-/Tower-/
  Hotelfenster per `windowGlow`, rotes Hindernisfeuer am Tower, Flugzeuge mit Positionslichtern (rot links = −z, grün
  rechts), Blitzern und Beacon (blinken auch tagsüber). Lampen = gemergte Boxen, Materialien `LIGHT` je Farbe, Farbe pro
  Bild aus `NIGHT` (`updateLamps`): tagsüber graue Leuchtkörper.

## Versorgungsbereich Wasser (`WaterCoverage.tsx`)

- Bei gewähltem Wasserwerk: grün-transparente Bänder über alle Wege seines Straßennetzes
  (Straßen ± `ACCESS_DISTANCE`, Autobahn/Rampe nur Fahrbahnbreite), plus Grundrisse aller
  angeschlossenen Gebäude. Ein gemergtes Mesh mit `depthFunc: LessDepth` + `depthWrite`, damit
  sich Überlappungen an Kreuzungen nicht verdunkeln. Muster für künftige Reichweiten
  (Krankenhaus, Schule, Polizei) wiederverwenden.
- **Straßennetze (`RoadNetworks.tsx`, Knopf „Straßennetze anzeigen“, `showNetworks`):** jedes zusammenhängende Netz
  (`roadNetworks`) eigene Farbe (größtes zuerst, `NETWORK_COLOURS`), Betriebe in der Farbe ihres Netzes, ohne
  Straßenanschluss rot; roter Ring = Straßenende < `GAP_DISTANCE` (15 m) vor einem anderen Netz. Legende `NetworkLegend`
  in `Hud.tsx` (Netze mit Straßen/Betrieben, Gebäude ohne Anschluss, Lücken).
- Übersichten unten rechts: Knöpfe „Stromnetz“ (`showPower`: alle Trafo-Kreise kräftig) und
  „Wasserversorgung“ (`showWater`: alle Netze mit Wasserwerk) neben „Lieferketten“.
  Im Stromnetz-Modus (und beim Kabelziehen) sind Gebäude mit < 90 % Strom rot (`Unpowered`).

## Ladebildschirm (`LoadingScreen.tsx`)

- Dunkelgrau (#202327), Haus baut sich Teil für Teil auf (`animate-assemble`: 8 HTML-Ebenen, nur opacity + transform →
  läuft auf dem Compositor und bleibt flüssig, während der Weltaufbau den Haupt-Thread blockiert; die alte
  stroke-dashoffset-Animation ruckelte), Schriftzug „Citypower“ in Bungee (OFL, `next/font/google`),
  ein Balken ohne Animation: Assets 0–85 %, Szene 85–95 %, Ruhephase 100 %, nie rückwärts. Die Welt lädt dahinter; ausgeblendet wird erst, wenn `ReadySignal` (letztes Kind im
  `Suspense` von `CityScene`, meldet nach 3 Bildern) gefeuert hat **und** die Loader 600 ms ruhig sind (max. 45 s).
  Pro `worldVersion` neu (`key`), also auch bei neuer Welt / geladenem Spielstand.

## Spielstände (`lib/city/save.ts`)

- `SaveGame` (Version `SAVE_VERSION`): Seed + alles Gebaute + Geld/Steuer/Zeit; Gelände
  wird aus dem Seed neu erzeugt. `toSave()` / `loadGame()` im Store, `worldVersion`
  remountet die Szene. Autosave jede Minute und bei `pagehide`; beim Start wird der
  Autosave fortgesetzt (sonst neue Welt). 3 Plätze + Export/Import als JSON im Menü
  „Spielstand“ oben rechts. Neue Spielzustände **immer** in `SaveGame`, `toSave`,
  `loadGame` und `parseSave` aufnehmen (bei inkompatiblen Änderungen Version erhöhen).

## Admin-Werkzeuge

- Knopf **Einstellungen** oben rechts (`AdminMenu` in `Hud.tsx`, Nutzerwunsch: vorher „Admin“): Geld hinzufügen
  (10 k / 100 k / 1 Mio €), Hausmodelle, Wetter. Menüs oben rechts klappen absolut unter ihrem Knopf auf (verschieben
  nichts). Keine Text-Symbole (▲▼▸ →) in der Oberfläche – Glyphen aus `ICONS` in Hud.tsx (`trendUp`, `chevronDown` …).
- Sichtbarkeit nur über `useIsAdmin()` in `lib/city/admin.ts` – aktuell immer `true`,
  später mit echtem Admin-Konto (Rolle aus der Login-Session) verbinden.
- Im Browser-Test alternativ `__city.store.getState().cheatMoney(n)`.

## City Pack (`public/models/city/`, Probe für Wohnhäuser)

- Kenney City Kits (CC0, GLB, je `License.txt` + `Preview.png`): `suburban/` (21 Häuser `building-type-a…u`, Zäune, Einfahrten,
  Wege, Bäume), `commercial/` (14 Stadthäuser `building-a…n`, 5 Hochhäuser `building-skyscraper-a…e`, 16 `low-detail-*` für die
  Ferne, Markisen/Sonnenschirme), `industrial/` (20 Hallen `building-a…t`, Schornsteine, Tanks, Container, Wassertürme,
  Windräder, Solarmodule). Wie beim Car Kit liegt die Textur extern (`Textures/colormap.png`, muss neben den GLBs bleiben);
  `variation-*.png` sind Farbvarianten derselben UV-Belegung (Textur tauschen = andere Dach-/Wandfarben).
- **Probe (`HousePack.tsx`):** Wohnhäuser aus den Kits statt der Box-Häuser, Schalter im Admin-Menü „Hausmodelle:
  Klassisch / City Pack“ (gilt auch für Fabriken, Bäckerei, Metzgerei) (`houseStyle` im Store, je Browser in `localStorage` `citypower.houseStyle`, nicht im Spielstand;
  Standard = City Pack). Modell je Haus aus der ID (`LEVEL_MODELS`: Stufe 1 kleine, 2 große Suburban-Häuser, 3/4 Commercial-
  Stadthäuser, 5–7 Hochhäuser auf 40/68/112 m gestreckt, nur Atlas `colormap`), Farbvariante aus `variant`. Je (Modell,
  Variante) ein InstancedMesh, Atlas mit Nearest-Filter, Front = Modell +z → um π gedreht. Lädt in eigenem `Suspense`, bis
  dahin stehen die Box-Häuser. Keine Kontaktschatten (GroundShadows liest die Grundfläche aus der Instanz-Skalierung).
- **Gärten (`Gardens` in HousePack.tsx, beide Hausstile, Stufe 1–2):** Die Kits haben **keine Rasen-Kacheln** (nur Wege,
  Trittsteine, Einfahrten) → Rasen selbst gemacht: gemähte Streifen als Canvas-Textur auf einer flachen Platte (`GARDEN`
  13,2 × 15,8 m um das Haus, Oberkante 5 cm über der Hausbasis, 0,6 m tief; entfällt am Hang). Holzzaun um den Garten
  hinten als eigene gemergte Box-Geometrie (Kenney-Zäune zu detailliert für 1.000 Gärten), Bäume/Trittsteine/Pflanzkübel aus
  dem Suburban-Kit. Alles instanziert. Messung Gesamtansicht: Pack 43,5 ms vs. klassisch 41,1 ms pro Bild.
- **Deko aus den Kits (`KitProps.tsx`):** `Containers` (Hafen, Kontor, Lagerhalle) = Kenney-Container, je Achse auf
  6 × 2,4 × 2,55 m skaliert; `RoofSolar` auf Discounter und Hochregallager. **Achtung:** Das Industrial-Kit speichert eine
  Knoten-Skalierung 0,27 im GLB – wer die Szene klont, muss sie zurücksetzen (Häuser/Gärten nutzen nur die Geometrie).
- **Fabriken, Bäckerei, Metzgerei im Pack-Stil (`PackBuildings.tsx`, `PACK_SPECS`):** gleicher Schalter wie die Häuser
  (`houseStyle`), in `SingleBuilding` mit `Suspense` (klassisches Modell bis geladen). Je Art: Hauptmodell vorne im
  Stufe-1-Grundstück, je Ausbaustufe ein Modell im neu dazugekommenen Streifen hinten (`extra`), oder ein Modell fürs ganze
  Grundstück (`whole`, Backfabrik); Requisiten (Schornsteine, Tanks) als Anteil der Grundstücksgröße; heller Hof, Namensschild
  mit `levelName` (Canvas, gecacht; bei schmalen Läden quer an der Grundstückskante, sonst verdeckt es das Schaufenster).
  Einpassen: gleichmäßig skaliert, in der Höhe durch `maxH` begrenzt. **Ausrichtung (`FACING`, auch in HousePack):**
  nur Suburban schaut nach +z (um π drehen), Commercial und Industrial nach −z – falsch gedreht zeigten die Läden ihre
  Rückseite zur Straße (Nutzer-Bug „spiegelverkehrt“). Industrie-GLBs haben zwei Teile
  (`colormap` + glänzendes `colormap-specular`) → `useKitParts` lädt alle Meshes, `kitMaterial(kit, variant, glossy)`.
- **Alles im Pack-Stil (Nutzerwunsch):** `PACK_SPECS` deckt jetzt auch Mühle, Kraftwerk (Stufe 1 klein, 2 Kohle mit
  Schloten, 3–5 Halle vorne `mainDepth` 0,55 + ein Kühlturm je Reaktorblock = `chimney-large`), Bergwerke (`foundation`:
  Betonsockel 10 m in den Hang), Hühnerhof, Recyclinghof, Kontor, Lagerhalle, Läden (Schuhe, Mode, Juwelier, Restaurant,
  Kino, Discounter, Möbelhaus), Wasserwerk (Wassertürme), Krankenhaus, Schule, Finanzamt, Arbeitsamt ab. Requisiten mit
  `min`/`max`-Stufe. **Bleiben klassisch:** Wahrzeichen mit eigener Wachstumslogik (Kirche, Bank, Rathaus, Börse), Hafen,
  Flughafen, Höfe/Schaffarm (Felder, Tiere), Park, Spielplatz, Schwimmbad, Jahrmarkt, Trafo.
- **Kenney-Boden (`kenneyGround.ts`, Nutzerwunsch):** Farben/Muster der `grass`- und `pavement`-Kacheln aus Kenneys
  „Starter Kit City Builder“ (aus der Colormap an den UVs der Kacheln gelesen): Rasen `#37a076` + Büschel `#5ac487` (im Spiel 7 % dunkler: `#33956e`/`#53b67d`, Nutzerwunsch),
  Platten `#81869c` + Fugen `#6a6f86`. Gelände-Shader (Büschel als Rausch-Flecken), Gärten, Fabrik- und Ladenhöfe
  (`FactoryYard`, Läden ohne Zaun), Rathausgarten.
- **Dämme und Bauwerke im Pack-Stil:** `kenneyable(material, key, hex)` hängt jedes Fotomaterial an den Uniform von
  `setRoadPack` – `EMBANKMENT_MATERIAL` (Dammgras → `#33956e` wie der Boden) und `STRUCTURE_CONCRETE` (Brücken, Pfeiler,
  Widerlager → `#c9ccd8`). Vorher hatten Straßenerhöhungen noch das Fotogras (Nutzer-Bug).
- **Straßen im Pack-Stil (`KENNEY_ROAD`/`setRoadPack` in materials.ts):** Kenneys Straßenkacheln passen nicht auf freie
  Kurven → Farben der Kacheln (Starter Kit, aus der Colormap gelesen) statt Fotos: Asphalt `#36363a`, Markierung `#c3cae6`,
  Bordstein `#6d738a`, Gehweg `#81869c`; Normal-Map aus. Ein gemeinsamer Uniform an allen `ROAD_MATERIALS` (auch die
  `clipAlong`-Klone der Baustellen, die den Basis-`onBeforeCompile` mitnehmen). Laternen matt `#b6bfe5`.
- **Boden im Pack-Stil (`World.tsx`, Uniform `uStylized`, `setGroundStyle`):** flaches Kenney-Grün mit weicher Großvariation,
  Graskörnung aus der Fototextur abgeschwächt (Nutzer: „bisschen Textur, minimal grüner“), Relief 60 %, helles Ufer, flacher
  Fels/Schnee. Umschalten ohne Shader-Neubau.
- **Fabrikhöfe (`FactoryYard.tsx`, Nutzerwunsch):** Pflaster in Sandton (Canvas-Platten statt Grau), Metallzaun rund ums
  Grundstück mit Tor vorne, und in einem Streifen rechts neben der Halle (`GOODS_STRIP` 7 m, die Halle rückt zur Seite) die
  Waren der Fabrik aus Grundformen (`goodsOf`: Stahlrollen, Stämme/Bretter, Reifen, Spulen, Stoffrollen, Mehlsäcke,
  Goldbarren, Erzhalden in Erzfarbe …) – erkennbar aus der Luft. Gilt für `GOODS_KINDS` ab 24 m Breite; Zaun für alle
  Industriegebäude.
- **Läden aus der Luft erkennbar (`RoofLandmark`, `roof` in PACK_SPECS):** 3D-Figur gerade und mittig auf einer flachen
  Dachplattform: Brezel (Bäckerei/Backfabrik), gerade Wurst mit abgebundenen Enden (Metzgerei), Goldring mit Diamant
  (Juwelier), Turnschuh (Schuhgeschäft). Keine Dachschilder (Nutzerwunsch: nur die Figuren).
  Position = Mitte des echten Dachs (`KitParts.roof`: Punkte in den obersten 12 % des Modells), nicht der Modellbox –
  Vordächer/Anbauten verschoben sonst die Brezel. Schmale Läden: kleines Namensschild parallel zur Straße an der Ecke.
- **Klassische Gebäude im Pack-Stil (`setPhotoFlat`/`flattenMap` in photoMaterial.ts):** Fototexturen zeigen nur ihre
  Durchschnittsfarbe (kleinste Mip-Stufe) → Kirche, Bank, Rathaus, Börse, Hafen, Flughafen, Höfe/Felder, Freizeit wirken
  flach eingefärbt wie die Kits und behalten Form und Wachstumsstufen. Schilder/Fenster nicht abflachen.
- **Bauernhof im Pack-Stil (`FarmPack.tsx`, `PackFarmyard`):** Wohnhaus aus dem Suburban-Kit, rote Scheune mit weißen
  Kanten, Mansarddach (Extrude) und Andreaskreuz-Tor, Silo mit roter Kuppel, Heuballen; Stufe 3 offene Maschinenhalle +
  zweites Silo. Kenney-Ränder (Nutzerwunsch): weiße Randleisten entlang der Giebelkontur + Traufbretter + Firstbalken
  (`RoofRims`), dunkler Sockel; Silos mit Betonsockel, dicken Bändern, weißem Rand unter der Kuppel, Lüfter, Leiter
  (`ladderGeometry`, gemergt je Höhe); Maschinenhallendach mit Rahmen. Felder/Weide/Auslauf bleiben (flach eingefärbt).
- **Schweine (`Pig.tsx`, `public/models/animals/pig.glb`):** Modell vom Nutzer (`docs/glb/pink pig 3d model.glb`, Tripo,
  319.000 Dreiecke, 10 MB) → `meshoptimizer` auf 3.000 Dreiecke + 512-px-Textur (119 KB). **Rig zur Laufzeit (`rigPig`):**
  Knochen torso/head/legFL…BR; Füße = Cluster der tiefsten Punkte, Hüfte bei `HIP_Y`, Kopf vor `NECK_X`; je Punkt zwei
  Einflüsse (Körper + Bein/Kopf, weich überblendet) → SkinnedMesh. Clips (`pigClips`): Trab mit diagonalen Beinpaaren,
  Fressen Kopf runter, Idle umschauen – wie die Kuh animiert (Nutzerwunsch). Modell schaut nach −x → `PIG_YAW` +90°.
- **Hof komplett im Pack-Stil (Nutzerwunsch):** Tiere = Kenney Cube Pets (`public/models/animals/cubepets/`, CC0, Knoten-Clips
  idle/walk/eat; `Herd` wählt im Pack-Stil `cowCube`/`pigCube`, Fellfarben entfallen; Clip-Suche ohne Groß/Klein), Zäune
  dicker in Weiß (Weide) bzw. Holz (Auslauf), Felder/Weide/Matsch als flache Canvas-Texturen (`packFieldMaterials`),
  Unterstand mit rotem Dach (`PackShelter`), Schweinehütten rot mit weißen Rändern (`PackPigHut`), Holztröge (`PackTrough`).
  Klassisch bleiben Quaternius-Kuh und das Nutzer-Schwein.
- **Kirche im Pack-Stil (`PackChurch` in LandmarksPack.tsx):** gleicher Grundriss wie klassisch (Turm bei z −9, Schiff
  −6,2…9, Chor hinten), helles Schiff, `GableRoof` mit weißen Randleisten, Bogenfenster (`ArchWindow`), Turm mit
  Schallöffnungen, Golduhren, Pyramidenspitze (`KRoof`) und Goldkreuz. Chor = halbes Sechseck + Halbkegel (die Halbkugel
  zeigte ins Schiff: SphereGeometry-phi 0 = −x, Halbkugel nach +z braucht phiStart 0 – Zylinder/Kegel dagegen
  thetaStart −π/2). Tür `KenneyDoor` (Rahmen, Kassettentür, Oberlicht, Griff, Stufe), Fenster mit dickem Rahmen, Sprossen,
  Lichtreflex (`ArchWindow`).
- **Gerberei im Pack-Stil (`TanneryPack.tsx`, Nutzerwunsch):** eigenes Kenney-Modell statt Kit-Halle (`custom: true` in
  `PACK_SPECS` → keine Kit-Modelle, Hof/Zaun/Waren/Schild bleiben): Backstein-Werkstatt mit weißen Kanten, Satteldach mit
  Randleisten, Schornstein; runde Gerbbottiche (einer mit Kalk), Trockengestelle mit Häuten. Stufe 2 offener Trockenschuppen
  + Bottiche, Stufe 3 Lederlager mit Rolltor. Alles links vom Warenstreifen (`GOODS_STRIP`).
- **Hühnerhof:** Halle vorne (`mainDepth` 0,45), dahinter eingezäunter Auslauf mit Rasen + Stroh und 14 Cube-Pets-Küken
  (`ChickRun`, `Herd kind="chick"`, Länge 1,25 m damit sie aus der Luft sichtbar sind).
- **Bank und Rathaus im Pack-Stil (`LandmarksPack.tsx`):** prunkvoll mit Stufen (`BANK_WEALTH`, `TOWNHALL_RESIDENTS` jetzt
  dort, Buildings.tsx importiert sie). Bank (Nutzerwunsch): modernes Glas-Hochhaus aus dem Commercial-Kit, Höhe je Vermögensstufe
  `BANK_HEIGHT` 16/22/43/72 m, gläserne Lobby mit „BANK“-Schild, auf dem Dach ein großer 100-€-Schein (Canvas) auf
  einem Gestell – kein Gold. Rathaus: cremefarbenes Haupthaus + Flügel,
  wächst nur in die Höhe (2/4/6 Geschosse, Nutzerwunsch – kein eigener Verwaltungsturm), Uhrturm 11 m über der Traufe
  (Uhr klar über dem First), Kenney-Walmdächer (`KRoof`/`hipGeometry`: dicke Traufkante, Firstbalken, Dreiecke einzeln
  nach außen gewunden; vorher verdrehter 4-seitiger Kegel), Rückseite mit Fenstern, Vorbau (`TownAnnex`) und Garten mit
  Brunnen, Büschen, Bank (`TownGarden`), Fahnen, Brunnen; Kenney-Fenster (`TownWindow`: weißer Rahmen, hellblaues Glas mit Kreuz, Bank, Sturz,
  Ziergiebel im Erdgeschoss). `KitModel` kann jetzt `sy` (Höhenstreckung) und `y`.
- **Bäume im Pack-Stil (`KenneyForest` in Trees.tsx):** Kenney Nature Kit (CC0, `public/models/nature/`, 7 Bäume + 2 Büsche,
  je ein Modell pro Wald-Variante, gleiche Standorte). Stamm/Krone nach Materialname getrennt, auf 1 m normiert, Blattgrün
  statt Kit-Türkis (`KENNEY_LEAVES`); gleiche Geometrie nah und fern. Gesamtansicht 48 ms (Pack) vs. 44 ms (klassisch).
- Quelle: OpenGameArt-Spiegel (`opengameart.org/sites/default/files/kenney_city-kit-<name>_<ver>.zip`); kenney.nl selbst
  vergibt Download-Links nur per Browser-Dialog.

## Bekannte Fallen

- Dachflächen (`roofGeometry().slopes`) brauchen doppelseitige Materialien, sonst fehlt das Dach.

- three r187: Instanzfarben kommen im **Fragment**-Shader als `USE_COLOR` / `vec4 vColor`
  an, nicht als `USE_INSTANCING_COLOR`. `instanceColor` vor dem ersten Rendern anlegen.

- Auch Änderungen an Modulen, die der Store importiert (`placement.ts`, `shipping.ts`, `waterways.ts` …),
  erzeugen per HMR eine frische Welt. Danach **nicht** einfach neu laden: veraltete Stores schreiben beim
  `pagehide` ihren Stand in den Autosave. Sicher: Tab auf `about:blank`, neu öffnen, dann
  `loadGame(JSON.parse(localStorage.__backup))` im frischen Store und Autosave direkt schreiben.
- Änderungen an `economy.ts`/`store.ts` laden den Store per HMR neu → im Tab entsteht eine frische
  Welt, die den Autosave überschreiben kann. Vor solchen Änderungen Backup in localStorage, danach
  zurückschreiben und neu laden.
- Hot-Reload von Modulen, die den Store importieren, legt einen neuen Store an; `__city`
  zeigt danach auf den alten. Für Browser-Tests nach Code-Änderungen die Seite neu laden.
- Browser-Tests ändern den Autosave des Test-Browsers. Testgebäude/-stufen danach zurücksetzen
  **und** den Autosave direkt schreiben (`localStorage["citypower.save.auto"] = toSave()`): wird der
  Browser neu gestartet, fehlt sonst das `pagehide`-Speichern und alte Teststände bleiben.

- `onBeforeCompile`-Materialien mit gleichem Quelltext teilen sich sonst ein Shader-Programm
  → immer `customProgramCacheKey` mit den Parametern setzen (siehe `desaturate`).
- Das Tiefenraster (2 m) verschmiert Kanalkanten; für exakte Kanal-Abfragen
  `occupant(..., { networks: ["water"], core: true })` statt `sampleDepth` nutzen.

## Arbeitsweise

- Nutzer schreibt Deutsch; Antworten auf Deutsch.
- Nach jeder Änderung: Typecheck + Lint, bei visuellen Änderungen Screenshot prüfen.
- Bei neuen Erkenntnissen über das Projekt diese Dateien aktualisieren
  (`.claude/CLAUDE.md`, `.claude/docs/*`).
