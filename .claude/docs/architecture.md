# Architektur

## Verzeichnisse

```
app/                      Next.js App Router – rendert nur <CityBuilder/>
components/city/
  CityBuilder.tsx         HUD: Toolbar (TOOL_GROUPS), Statusleiste, Hotkeys
  CityScene.tsx           <Canvas>: Licht, HDRI, Post-Processing, alle Weltobjekte
  World.tsx               Terrain-Mesh (aus Tiefenraster) + Bodenshader, Bau-Raster
  Water.tsx               eine globale Wasserfläche mit Tiefen-Shader
  Roads.tsx               Straßen, Kreuzungsplätze, Laternen, Straßenbrücken
  Rails.tsx               Gleise, Bahnübergänge, Andreaskreuze, <Bridge/>
  Canals.tsx              Kanal-Ufer (Kaimauern, Treidelpfad)
  RoadBuilder.tsx         Maus-Eingabe + Vorschau für alle Bau-Werkzeuge
  RoadConstruction.tsx    Baustellen-Animation Straße (Graben, Rohre, Arbeiter)
  PathConstruction.tsx    generische Baustellen-Animation (Gleis, Kanal)
  Trees.tsx               instanzierte EZ-Tree-Wälder, weichen Wegen und Wasser aus
  Traffic.tsx             autonome Autos (Kenney Car Kit, instanziert)
  Structure.tsx           Brücken/Dämme unter erhöhten Wegen
  useWater.ts             useDepthGrid(), useFinishedCanals()
  DevHandle.tsx           window.__city im Dev-Modus
  models/                 Bagger, Kipper, Arbeiter, glTF-Baking
lib/city/
  types.ts                Path/BuildKind/NetworkId + Maß-Tabellen pro Kind
  store.ts                zustand-Store: roads, rails, canals, draft, tool, jobs, history
  network.ts              Snapping, Verbinden/Splitten, Kreuzungen, findCrossings
  road-geometry.ts        buildFrames (Fillets), MeshBuilder, strip/wall/band/tube, Straßen
  rail-geometry.ts        Schotterbett, Schwellen, Schienen, Oberleitung, Bahnübergang-Rampe
  water-geometry.ts       Kanal-Ufer, Brücken (bridgeSpans, buildBridgeGeometry)
  terrain.ts              Tiefenraster: natürliche Flüsse/Seen + Kanäle, sampleDepth
  adjacency.ts            Nachbarschaft: occupant, nearestAccess, snapToQuay (auch für Gebäude)
  barrier-geometry.ts     Leitplanken/Geländer neben Wasser & Gleisen, an Wegenden
  grade.ts                Höhenprofile: Erkennung Wasser/Kreuzungen, Rampen, lichte Höhen
  bridge-geometry.ts      Damm, Widerlager, Überbau, Pfeiler, Viadukt, Stabbogen
  interchange.ts          Planung Autobahn-Anschlussstelle (Raute, 4 Rampen)
  cloverleaf.ts           Planung Autobahnkreuz (Kleeblatt, 8 Rampen)
  trumpet.ts              Planung Autobahndreieck (Trompete, 2 Varianten)
  ramps.ts                Bausteine: Achsen, parallele Aus-/Einfädelungsstreifen, Bögen
  traffic.ts              Spurgraph + Fahrzeugsimulation
  materials.ts            alle Materialien, clipAlong (Reveal-Shader)
  construction.ts         Bauzeit-Formel und Fortschritt
```

## Datenmodell

- Alles Gebaute ist ein `Path { id, kind, points }` – Kontrollpunkte im 2-m-Raster,
  Segmente in 45°-Schritten. `buildFrames` rundet Ecken mit `CORNER_RADIUS[kind]` ab.
- Drei getrennte Netze (`NetworkId`): `road`, `rail`, `water`. Ein Pfad snappt und
  verbindet sich nur mit Pfaden des eigenen Netzes (`connectRoads` ist generisch).
- `jobs` = IDs von Pfaden im Bau. Die Bau-Komponente ruft am Ende `finishJob(id)`.
- Undo: `history` speichert Snapshots aller drei Listen.

## Terrain & Wasser

- `terrain.ts` hält ein `Float32Array`-Tiefenraster (2 m Auflösung, 701×701 über 1400 m).
  Wert = Meter unter y = 0. Index = `row * TERRAIN_N + col`, row ↔ z, col ↔ x.
- Natürliches Wasser (`naturalWater()`) ist fest und deterministisch: ein Fluss südlich
  des Startbereichs (z ≈ 110…250), ein Bach nach Westen, zwei Seen, ein Teich.
- Fertige Kanäle werden zusätzlich eingestempelt (`depthGrid(canals)`, gecacht nach IDs).
  Kanäle im Bau sind noch nicht ausgehoben.
- `WATER_LEVEL = -0.9`: eine Wasserfläche über der ganzen Welt, sichtbar nur wo das
  Terrain tiefer liegt. Der Wasser-Shader liest die Tiefe als 8-bit-Textur
  (`depth / DEPTH_TEXTURE_SCALE`) für Farbe und Transparenz.
- Bodenshader färbt nach Höhe: Gras → Sand (Ufer) → Schlamm (Grund).

## Kreuzungen

- Straße × Straße: echte Knoten, Kreuzungsplatz (`findJunctions`).
- Schiene × Straße: Bahnübergang. `useRailRoadCrossings()` liefert die Punkte;
  die Straße spart Bordstein/Gehweg/Markierung aus (`crossingCutRadius`), das Gleis
  senkt sich über ~10 m auf Straßenniveau und bekommt eine Übergangsplatte.
- Straße/Schiene × Wasser (natürlich oder Kanal): Weg steigt auf Brückenhöhe
  (schiffbar 6 m über Wasser), Bogenbrücke bei langen schiffbaren Spannweiten.
- Autobahn × alles bzw. per Taste B gewählte Querungen: Über-/Unterführung (`grade.ts`).
- Kanal × Straße/Schiene: Kaimauer und Treidelpfad laufen unter der Brücke durch.
- Kanal × Kanal / natürliches Wasser: Mauern entfallen dort, Wasser verbindet sich.
- Weg endet am Kanal: Endpunkt rastet an der Kaikante ein, Leitplanke/Geländer quer.
- Weg parallel zu Wasser/Gleis: Leitplanke auf der gefährdeten Seite, Laternen nur auf
  der freien Seite, Treidelpfad unter dem Weg entfällt.
- Radweg (`bike`) gehört zum Straßennetz: verbindet sich mit Straßen, Kreuzungsplatz
  richtet sich nach dem durchgehenden Weg (`Junction.plaza`).

## Werkzeuge & Hotkeys

1 Straße · 2 Autobahn · 3 Radweg · 4 Gleis · 5 Doppelgleis · 6 Kanal · 7 Anschlussstelle · 8 Autobahnkreuz · 9 Autobahndreieck · B Querungsmodus
(Reihenfolge = `TOOL_GROUPS` in `CityBuilder.tsx`).
