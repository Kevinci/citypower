# Roadmap & Ideen

Status-Legende: ✅ fertig · 🚧 in Arbeit · ⏭️ geplant

## Infrastruktur

- ✅ Straße, Autobahn (Kreuzungen, Laternen, Baustellen-Animation)
- ✅ Gleis, Doppelgleis (Schotter, Schwellen, Oberleitung, Bahnübergänge mit Andreaskreuz)
- ✅ Kanal (Kaimauern, Treidelpfad, eckige Enden, Verbindung zu natürlichem Wasser)
- ✅ Automatische Brücken für Straße/Schiene über Wasser
- ✅ Radweg (rot, 3 m, Zweirichtung) im Straßennetz
- ✅ Nebeneinander bauen: Leitplanken/Geländer, Andocken an Kaikante, Laternen/Masten weichen aus
- ✅ Brücken mit lichter Höhe (Schiffe, LKW, Züge), Rampen, Dämme, Viadukte, Stabbögen
- ✅ Über-/Unterführungen Autobahn × Straße/Gleis, Querungsmodus per Taste B
- ✅ Autobahn-Anschlussstellen (Raute) per Werkzeug
- ✅ Autonomer Autoverkehr (Kenney Car Kit, CC0)
- ✅ Ampeln an Kreuzungen (≥ 3 Zufahrten) mit Haltlinien
- ✅ Platzierungsvorschau grün/rot für Anschlussstellen
- ✅ Autobahnkreuz (Kleeblatt) mit Vorschau
- ✅ Autobahndreieck (Trompete, beide Varianten), parallele Aus-/Einfädelungsstreifen
- ⏭️ Fertigbauteile: Birne / Dreieck-Grundform, kompakte Anschlussstelle am Brückenkopf,
  Kreuz mit Überwerfungsbauwerken statt Schleifen (mehr Leistung)
- ✅ Verflechtungsstreifen im Kleeblatt
- ✅ Autobahnkreuz als Fertigbauteil mit Geist-Vorschau (grün/rot) auf einer Autobahn
- ⏭️ Fertigbauteil drehen (Kreuzungswinkel), Dreieck als Fertigbauteil
- ✅ Fahrzeuge in echten Maßen, realistische Lackfarben, Glanz/Schmutz
- ⏭️ Spurwechsel auf Verflechtungsstreifen/Autobahn, Fahrzeuge mit echten Texturen (Scheiben, Lichter)
- ⏭️ Vorfahrt ohne Ampel (rechts vor links / Einmündung), Einfädeln auf Autobahn,
  Spurwechsel, Blinker/Licht bei Nacht
- ⏭️ Züge auf den Gleisen, Schiffe auf Kanälen
- ⏭️ Rampen, die direkt am Brückenkopf anschließen (kompaktere Raute)
- ⏭️ Tunnel/Trog (Weg unter Gelände absenken) als Alternative zur Brücke
- ⏭️ Straße mit Radfahrstreifen als eigene Variante; Radwegpiktogramme
- ⏭️ Züge und Zugverbindungen: Bahnhöfe, Linien, Fahrzeuge auf den Gleis-Frames
  (Frames aus `buildFrames` + `TRACK_OFFSETS` als Fahrweg nutzen)
- ⏭️ Weichen-Darstellung an Gleisknoten (aktuell überlappen die Betten nur)
- ⏭️ Schranken/Blinklichter an Bahnübergängen
- ⏭️ Häfen/Anleger und Schiffe auf Kanälen und Flüssen
- ⏭️ Abriss-Werkzeug (Pfade löschen)
- ⏭️ Bau über Wasser optional verbieten oder Kosten erhöhen

## Welt

- ✅ Natürlicher Fluss, Bach, Seen (fest, deterministisch)
- ✅ Gebirge mit Fels, Schnee, Bergwald; Wege folgen dem Gelände, automatische Tunnel/Einschnitte
- ⏭️ Wettersimulation (Nebel, Regen, Schnee, Tageszeit)
- ⏭️ Gelände-Werkzeuge (anheben/absenken/glätten), Tunnel-Innenansicht
- ⏭️ Ufervegetation (Schilf, Büsche am Ufer)
- ⏭️ Fließrichtung im Wasser-Shader für Flüsse

## Gebäude (Vorbereitung vorhanden)

- ⏭️ Gebäude-Footprints als eigener Typ, in `adjacency.ts` als Hindernis/Nachbar aufnehmen
- ⏭️ Anbindung: Wohnhäuser an Straße, Stahlwerk/Industrie an Gleis (Anschlussgleis) und
  Kanal (Hafen) über `nearestAccess`; Gebäude ohne Anbindung funktionieren nicht

## Oberfläche

- ✅ HUD im SimCity-Stil (Leiste, Schubladen, Info-Sprechblasen, Tempo, Uhr)
- ⏭️ Datenansichten (Wasser-, Versorgungs-, Verkehrs-Overlay), Budget-Fenster, Einstellungen

## Wirtschaft (begonnen)

- ✅ Zufallswelt per Seed, Startdorf, Geld/Einwohner, Bauernhof → Bäckerei → Brot, Wasserwerk 1–3
- ⏭️ Lagerbestände und Transport per LKW/Zug statt Netz-Sofortversorgung
- ✅ Krankenhaus (Geburten), selbstständiges Stadtwachstum mit 3 Hausstufen, Verfall ohne Wasser
- ✅ 3D-Vorschaubilder in den Baukarten
- ✅ Arbeitsplätze, Schule, Mühle (Weizen → Mehl), Stahlwerk und Holzfabrik, Steuersatz
- ✅ Lieferketten Hof → Mühle → Bäckerei mit Lieferlinien, Bedarfsanzeige „genug/zu wenig“
- ✅ Eigene Icons statt Emojis, Fußgänger und Radfahrer (animiert), Haushalte
- ⏭️ Menschen mit Zielen (Wohnung → Arbeit → Einkauf), mehr Figurenvarianten
- ⏭️ Rohstoffe für Industrie (Erz, Kohle, Holz aus Wäldern) per Zug/LKW, Pendlerverkehr
- ⏭️ Schulen, Polizei, Feuerwehr als weitere Wachstumsbedingungen; Bodenwert
- ✅ Speichern/Laden (Autosave, 3 Plätze, Datei-Export/-Import)
- ✅ Möbelkette (Holz + Stahl → Möbelfabrik → Möbelhaus), Schweinezucht → Schlachthof → Metzgerei, animierte Kühe/Schweine mit Weide, Zaun und Matsch
- ✅ Private Betriebe mit eigener Bilanz, Stadthaushalt (Einkommen-, Gewerbe-, Grundsteuer, Wassergebühren), Kino und Restaurant (mehr Geburten)
- ⏭️ Baukosten für Straßen/Schienen, Spielstände im Konto (Server)
- ✅ Strom: Kraftwerk am Wasser (Wasserkraft mit Kanal → Kohle → Atom), Freileitungen, Trafostationen mit Radius (ausbaubar), Kohle-/Erz-/Uranbergwerke am Berg, Stahlwerk braucht Eisenerz
- ✅ Kirche mit Fototexturen (Bruchstein, Schiefer), Radfahrer sitzen richtig herum
- ⏭️ **Lieferungen sichtbar per LKW (Straße) oder Zug (Gleis)** – Nutzerwunsch: Kohle, Erz, Uran und andere Waren nicht mehr abstrakt über das Straßennetz, sondern mit Fahrzeugen; Bahn als Alternative für Bergwerke/Kraftwerk mit Gleisanschluss
- ⏭️ Strom: Leitungen abreißen/umlegen, Erdkabel in der Stadt, Umspannwerke für große Netze

## Simulation

- ⏭️ Wirtschaft, Budget, Baukosten
- ⏭️ Zonen und Gebäude
- ⏭️ Speichern/Laden (Store ist serialisierbar: roads, rails, canals)

- ⏭️ Kautschuk-Import später per Hafen/Zug statt als pauschaler Einkauf (Gummifabrik)
- ✅ Finanzamt (Steuern, Auswertungen) und Baustopp/Baugenehmigungen im Rathaus
- ✅ Lagerhallen (3 Stufen), Binnenhafen, Schiffe kaufen (Export flussabwärts)
- ⏭️ LKW- und Bahnexport aus den Lagerhallen (Güterbahnhof, Spedition)
- ⏭️ Je Lagerhalle wählbar, welche Waren eingelagert werden (z. B. keine Kohle)
- ⏭️ Schiffe bringen Importe mit (Kautschuk, Erz), Kanäle als Wasserstraßen zum Fluss
- ⏭️ Grundsteuer-Hebesatz im Finanzamt einstellbar
- ✅ Bauen ohne Anschluss (stillgelegt bis Straße/Wasser da), Abriss-Werkzeug für Wege und Leitungen
- ⏭️ Abriss mit Rückerstattung / Abrisskosten, Abriss per Ziehen über mehrere Segmente
