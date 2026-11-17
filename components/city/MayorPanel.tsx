"use client";

import { BUILDINGS, levelName } from "@/lib/city/economy";
import { fairSalary, jailed, JAIL_MINUTES, OFFER_LABEL, offerText, PROBATION_MINUTES, RACKET_SHARES, racketIncome, SALARY_MAX, SCANDAL_MINUTES, SEIZED, SEIZED_CLEAN, SCANDAL_CUT, scandalRepay, GOODWILL_MAX, WASH_FEE, WASH_RATE, washRate } from "@/lib/city/mayor";
import { useCity } from "@/lib/city/store";
import { euro, Pill } from "./Hud";
import { Bar, Frame, Heading, Line } from "./PanelParts";

/** Salary steps (€ per minute) and amounts to move out of the town's till. */
const SALARY_STEPS = [-100, -10, 10, 100];
const TILL_AMOUNTS = [10000, 100000, 1000000];

/**
 * The mayor's private side: account, salary, confidential offers, the town's till and the
 * suspicion they raise; the villa is paid from here.
 */
export function MayorPanel() {
  const mayor = useCity((s) => s.mayor);
  const residents = useCity((s) => s.economy?.residents ?? 0);
  const money = useCity((s) => s.money);
  const minutes = useCity((s) => s.gameMinutes);
  const buildings = useCity((s) => s.buildings);
  const setSalary = useCity((s) => s.setSalary);
  const accept = useCity((s) => s.acceptBribe);
  const decline = useCity((s) => s.declineBribe);
  const embezzle = useCity((s) => s.embezzle);
  const startPlacing = useCity((s) => s.startPlacing);
  const flyTo = useCity((s) => s.flyTo);
  const fair = fairSalary(residents);
  const scandal = mayor.scandalUntil > minutes;
  const villa = buildings.find((b) => b.kind === "villa");
  const boathouse = buildings.find((b) => b.kind === "boathouse");
  const boathouseNext = boathouse ? BUILDINGS.boathouse.upgrade?.[boathouse.level + 1] : undefined;
  const nextCost = villa ? BUILDINGS.villa.upgrade?.[villa.level + 1] : BUILDINGS.villa.cost;
  const suspicion = mayor.suspicion / 100;
  const inJail = jailed(mayor, minutes);
  const economy = useCity((s) => s.economy);
  const setProtection = useCity((s) => s.setProtection);
  const setLaundering = useCity((s) => s.setLaundering);
  const repayCity = useCity((s) => s.repayCity);
  const fullCut = scandalRepay(residents);
  const onProbation = mayor.lastScandalAt !== null && minutes - mayor.lastScandalAt < PROBATION_MINUTES;

  return (
    <Frame title="Bürgermeister – privat" icon="villa">
      {inJail && (
        <div className="mx-4 mt-3 rounded border border-[#c0392b]/50 bg-[#f3e1df] px-2 py-1.5 text-[12px] text-[#c0392b]">
          <b>Im Gefängnis.</b> Noch {Math.ceil((mayor.jailUntil - minutes) / 60)} Spielstunden: kein Gehalt, keine Geschäfte, Konto und Villa sind weg.
        </div>
      )}
      <Heading>Privatkonto</Heading>
      <div className="px-4 font-mono text-2xl text-[#2c8f4e]">{euro(Math.round(mayor.account))}</div>
      <Line label="Gehalt von der Stadt" value={`${euro(mayor.salary)} / min`} tone={mayor.salary > fair ? "bad" : undefined} sub={`angemessen: ${euro(fair)}`} />
      <Line label="davon Schwarzgeld" value={euro(Math.round(mayor.dirty))} tone={mayor.dirty > 0 ? "bad" : undefined} sub="wird im Skandal zuerst beschlagnahmt" />
      <Line label="Sonderzahlungen insgesamt" value={euro(Math.round(mayor.taken))} />
      <div className="flex flex-wrap gap-1.5 px-4 pt-1.5">
        {SALARY_STEPS.map((d) => (
          <Pill key={d} onClick={() => setSalary(mayor.salary + d)} disabled={(d < 0 && mayor.salary <= 0) || (d > 0 && mayor.salary >= SALARY_MAX)}>
            {d > 0 ? "+" : "−"}
            {Math.abs(d)} €
          </Pill>
        ))}
        <Pill onClick={() => setSalary(fair)} title="Gehalt, das die Bürger für angemessen halten">
          Angemessen
        </Pill>
      </div>
      <div className="px-4 pt-1 text-[10px] text-[#7a8794]">Mehr Gehalt als angemessen verärgert die Bürger (Stimmung, etwas weniger Zuzug).</div>

      <Heading>Verdacht</Heading>
      <div className="px-4">
        {/* Bar shows the remaining trust: full = no suspicion. */}
        <Bar value={1 - suspicion} warn={0.7} />
      </div>
      <Line label="Verdacht der Presse" value={`${Math.round(mayor.suspicion)} %`} tone={suspicion > 0.5 ? "bad" : undefined} sub="sinkt langsam" />
      {scandal ? (
        <div className="mx-4 mt-1 rounded border border-[#c0392b]/40 bg-[#f3e1df] px-2 py-1 text-[11px] text-[#c0392b]">
          Korruptionsskandal! Noch {Math.ceil((mayor.scandalUntil - minutes) / 60)} Spielstunden: kaum Zuzug, die Bürger sind empört, niemand bietet Geld an.
        </div>
      ) : null}
      {onProbation && !scandal && !inJail && (
        <div className="mx-4 mt-1 rounded border border-[#e0a030]/60 bg-[#fbf0d9] px-2 py-1 text-[11px] text-[#9a6200]">
          Auf Bewährung: noch {Math.ceil((mayor.lastScandalAt! + PROBATION_MINUTES - minutes) / 60)} Spielstunden – der nächste Skandal heißt Gefängnis.
        </div>
      )}
      {!scandal && (
        <div className="px-4 pt-0.5 text-[10px] text-[#7a8794]">
          Je höher der Verdacht, desto eher fliegt alles auf: {Math.round(SEIZED * 100)} % des Privatkontos werden beschlagnahmt, {SCANDAL_MINUTES / 1440} Tage Skandal. Ein zweiter Skandal innerhalb von {PROBATION_MINUTES / 1440} Tagen bringt {JAIL_MINUTES / 1440} Tage Gefängnis.
        </div>
      )}

      <Heading>Vertrauliche Angebote</Heading>
      {mayor.offers.length === 0 && <div className="px-4 text-[12px] text-[#7a8794]">{scandal ? "Während des Skandals traut sich niemand." : "Gerade keine – Bauträger und Firmen melden sich von selbst."}</div>}
      {mayor.offers.map((o) => (
        <div key={o.id} className="mx-3 my-1 rounded-lg border border-black/10 bg-white/60 px-2.5 py-1.5 text-[12px]">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold text-[#1d2a35]">{OFFER_LABEL[o.kind]}</span>
            <span className="font-mono text-[#2c8f4e]">+{euro(o.amount)}</span>
          </div>
          <div className="text-[11px] text-[#2c3640]">{offerText(o, buildings)}</div>
          <div className="mt-1 flex items-center gap-1.5">
            <Pill tone="go" onClick={() => accept(o.id)} disabled={inJail}>
              Annehmen
            </Pill>
            <Pill onClick={() => decline(o.id)}>Ablehnen</Pill>
            {o.building && (
              <Pill onClick={() => flyTo(o.building!)} title="Zum Betrieb">
                Zeigen
              </Pill>
            )}
            <span className="ml-auto text-[10px] text-[#7a8794]">noch {Math.max(0, Math.ceil((o.expires - minutes) / 60))} h</span>
          </div>
        </div>
      ))}
      {mayor.favours.length > 0 && (
        <>
          <Heading>Laufende Gefälligkeiten</Heading>
          {mayor.favours.map((f) => {
            const b = buildings.find((x) => x.id === f.building);
            return <Line key={f.building} label={b ? levelName(b) : "Betrieb"} value={`noch ${Math.ceil((f.until - minutes) / 60)} h`} sub="zahlt keine Gewerbesteuer" />;
          })}
        </>
      )}

      <Heading>Schutzgeld</Heading>
      {mayor.rackets.length === 0 && <div className="px-4 text-[12px] text-[#7a8794]">Noch kein Betrieb zahlt – einen Betrieb anklicken und in seiner Karte Schutzgeld verlangen.</div>}
      {mayor.rackets.map((r) => {
        const b = buildings.find((x) => x.id === r.building);
        return (
          <div key={r.building} className="flex items-center gap-2 px-4 py-[2px] text-[12px]">
            <button type="button" className="flex-1 truncate text-left text-[#1d5f86] hover:underline" onClick={() => flyTo(r.building)}>
              {b ? levelName(b) : "Betrieb"} <span className="text-[10px] text-[#7a8794]">{Math.round(r.share * 100)} %</span>
            </button>
            <span className="font-mono text-[#2c8f4e]">+{euro(Math.round(racketIncome(r, economy)))}/min</span>
            <Pill onClick={() => setProtection(r.building, 0)}>Ende</Pill>
          </div>
        );
      })}
      {mayor.rackets.length > 0 && <div className="px-4 pt-0.5 text-[10px] text-[#7a8794]">Jeder zahlende Betrieb lässt den Verdacht täglich steigen, umso mehr, je höher der Anteil.</div>}

      <Heading>Geldwäsche</Heading>
      {mayor.fronts.length === 0 && (
        <div className="px-4 text-[12px] text-[#7a8794]">Keine Waschanlage – eine Pizzeria oder einen Recyclinghof anklicken und in seiner Karte „Geld waschen“ wählen.</div>
      )}
      {mayor.fronts.map((id) => {
        const b = buildings.find((x) => x.id === id);
        if (!b) return null;
        const working = economy?.status[id]?.connected !== false;
        return (
          <div key={id} className="flex items-center gap-2 px-4 py-[2px] text-[12px]">
            <button type="button" className="flex-1 truncate text-left text-[#1d5f86] hover:underline" onClick={() => flyTo(id)}>
              {levelName(b)} <span className="text-[10px] text-[#7a8794]">{Math.round((WASH_FEE[b.kind] ?? 0) * 100)} % Gebühr</span>
            </button>
            <span className={`font-mono ${working ? "text-[#2c3640]" : "text-[#c0392b]"}`}>{working ? `${euro(washRate(b))}/min` : "stillgelegt"}</span>
            <Pill onClick={() => setLaundering(id, false)}>Ende</Pill>
          </div>
        );
      })}
      <div className="px-4 pt-0.5 text-[10px] text-[#7a8794]">
        Gewaschenes Geld ist sauber (im Skandal nur {Math.round(SEIZED_CLEAN * 100)} % statt {Math.round(SEIZED * 100)} % weg) und jeder gewaschene Euro senkt den Verdacht. Casino-Einsätze gehen zuerst vom Schwarzgeld ab, Gewinne sind sauber.
      </div>

      <Heading>Der Stadt zurückgeben</Heading>
      <Line label="Ansehen" value={`${Math.round(((mayor.goodwill ?? 0) / GOODWILL_MAX) * 100)} %`} tone={(mayor.goodwill ?? 0) > 0 ? "good" : undefined} sub="sinkt langsam wieder" />
      <div className="flex flex-wrap gap-1.5 px-4 pt-1">
        {TILL_AMOUNTS.map((n) => (
          <Pill key={n} tone="go" onClick={() => repayCity(n)} disabled={mayor.account < n || inJail}>
            {euro(n)}
          </Pill>
        ))}
        {scandal && (
          <Pill tone="go" onClick={() => repayCity(fullCut)} disabled={mayor.account <= 0 || inJail} title="Volle Wiedergutmachung">
            {euro(fullCut)}
          </Pill>
        )}
        <Pill onClick={() => repayCity(mayor.dirty)} disabled={mayor.dirty <= 0 || inJail}>
          Alles Schwarzgeld
        </Pill>
      </div>
      <div className="px-4 pt-1 text-[10px] text-[#7a8794]">
        Schwarzgeld geht zuerst zurück. Verbessert das Ansehen (Stimmung „Bürgermeister“) und senkt den Verdacht.
        {scandal
          ? ` Im Skandal: ab ${euro(fullCut)} wird die Restzeit um ${Math.round(SCANDAL_CUT * 100)} % gekürzt, kleinere Beträge anteilig.`
          : ` Bei einem Skandal kürzt eine Wiedergutmachung ab ${euro(fullCut)} die Restzeit um ${Math.round(SCANDAL_CUT * 100)} %.`}
      </div>

      <Heading>Stadtkasse abzweigen</Heading>
      <div className="flex flex-wrap gap-1.5 px-4">
        {TILL_AMOUNTS.map((n) => (
          <Pill key={n} tone="danger" onClick={() => embezzle(n)} disabled={money <= 0 || inJail}>
            {euro(n)}
          </Pill>
        ))}
      </div>
      <div className="px-4 pt-1 text-[10px] text-[#7a8794]">Sehr riskant: große Summen treiben den Verdacht sofort in die Höhe.</div>

      <Heading>Bürgermeistervilla</Heading>
      {villa ? (
        <>
          <Line label={levelName(villa)} value={nextCost !== undefined ? `Ausbau ${euro(nextCost)}` : "fertig"} tone={nextCost !== undefined && mayor.account < nextCost ? "bad" : "good"} />
          <div className="px-4 pt-1">
            <Pill onClick={() => flyTo(villa.id)}>Zur Villa</Pill>
          </div>
        </>
      ) : (
        <>
          <Line label="Noch nicht gebaut" value={euro(BUILDINGS.villa.cost)} tone={mayor.account < BUILDINGS.villa.cost ? "bad" : "good"} sub="vom Privatkonto" />
          <div className="px-4 pt-1">
            <Pill tone="go" disabled={mayor.account < BUILDINGS.villa.cost} onClick={() => startPlacing("villa")}>
              Villa bauen
            </Pill>
          </div>
        </>
      )}

      <Heading>Bootshaus</Heading>
      {boathouse ? (
        <>
          <Line
            label={levelName(boathouse)}
            value={boathouseNext !== undefined ? `Ausbau ${euro(boathouseNext)}` : "fertig"}
            tone={boathouseNext !== undefined && mayor.account < boathouseNext ? "bad" : "good"}
            sub={boathouse.level >= 3 ? "mit Yacht" : boathouse.level === 2 ? "nächste Stufe: Yacht" : undefined}
          />
          <div className="px-4 pt-1">
            <Pill onClick={() => flyTo(boathouse.id)}>Zum Bootshaus</Pill>
          </div>
        </>
      ) : (
        <>
          <Line label="Noch nicht gebaut" value={euro(BUILDINGS.boathouse.cost)} tone={mayor.account < BUILDINGS.boathouse.cost ? "bad" : "good"} sub="am Ufer, vom Privatkonto" />
          <div className="px-4 pt-1">
            <Pill tone="go" disabled={mayor.account < BUILDINGS.boathouse.cost || inJail} onClick={() => startPlacing("boathouse")}>
              Bootshaus bauen
            </Pill>
          </div>
        </>
      )}
    </Frame>
  );
}

/** In a firm's card: demand protection money (a share of its profit) for the mayor. */
export function ProtectionSection({ building }: { building: string }) {
  const racket = useCity((s) => s.mayor.rackets.find((r) => r.building === building));
  const inJail = useCity((s) => jailed(s.mayor, s.gameMinutes));
  const economy = useCity((s) => s.economy);
  const setProtection = useCity((s) => s.setProtection);
  return (
    <div className="border-t border-black/10 py-1">
      <div className="px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a8794]">Schutzgeld (Bürgermeister)</div>
      {racket && (
        <div className="flex justify-between gap-4 px-3 py-[3px] text-[11px]">
          <span className="text-[#1d5f86]">Zahlt {Math.round(racket.share * 100)} % vom Gewinn</span>
          <span className="font-mono text-[#2c8f4e]">+{euro(Math.round(racketIncome(racket, economy)))} / min</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1 px-3 py-[3px]">
        {RACKET_SHARES.map((sh) => (
          <Pill key={sh} active={racket?.share === sh} tone={racket ? "default" : "danger"} disabled={inJail} onClick={() => setProtection(building, sh)}>
            {Math.round(sh * 100)} %
          </Pill>
        ))}
        {racket && <Pill onClick={() => setProtection(building, 0)}>Beenden</Pill>}
      </div>
    </div>
  );
}

/** In the card of a pizzeria or recycling yard: use it to launder the mayor's dirty money. */
export function LaunderingSection({ building }: { building: string }) {
  const b = useCity((s) => s.buildings.find((x) => x.id === building));
  const on = useCity((s) => s.mayor.fronts.includes(building));
  const dirty = useCity((s) => s.mayor.dirty);
  const inJail = useCity((s) => jailed(s.mayor, s.gameMinutes));
  const setLaundering = useCity((s) => s.setLaundering);
  if (!b || !WASH_RATE[b.kind]) return null;
  return (
    <div className="border-t border-black/10 py-1">
      <div className="px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a8794]">Geldwäsche (Bürgermeister)</div>
      <div className="flex justify-between gap-4 px-3 py-[3px] text-[11px]">
        <span className="text-[#1d5f86]">{on ? (dirty > 0 ? "Wäscht Schwarzgeld" : "Bereit – kein Schwarzgeld da") : "Wäscht bis"}</span>
        <span className="font-mono text-[#1d2a35]">
          {euro(washRate(b))} / min · {Math.round((WASH_FEE[b.kind] ?? 0) * 100)} % Gebühr
        </span>
      </div>
      <div className="flex gap-1 px-3 py-[3px]">
        <Pill tone={on ? "default" : "danger"} active={on} disabled={inJail} onClick={() => setLaundering(building, !on)}>
          {on ? "Waschen beenden" : "Geld waschen"}
        </Pill>
      </div>
    </div>
  );
}
