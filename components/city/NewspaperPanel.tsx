"use client";

import { useEffect, useState } from "react";
import { PAPER_NAME } from "@/lib/city/news";
import { useCity } from "@/lib/city/store";
import { Pill } from "./Hud";

const SERIF = { fontFamily: "Georgia, 'Times New Roman', serif" };

/**
 * Reading the "Citypower Rundschau": one edition as a newspaper page (masthead, headline,
 * articles in two columns, ads), with the previous editions to leaf through.
 */
export function NewspaperPanel() {
  const editions = useCity((s) => s.newspapers);
  const setPanel = useCity((s) => s.setPanel);
  const read = useCity((s) => s.readNewspaper);
  const [index, setIndex] = useState(0);
  useEffect(() => read(), [read, editions.length]);
  const edition = editions[Math.min(index, editions.length - 1)];

  return (
    <div className="pointer-events-auto absolute inset-x-0 top-14 bottom-20 z-30 flex justify-center px-3">
      <div className="flex w-full max-w-[780px] flex-col overflow-hidden rounded-sm border border-[#b9ad92] bg-[#f6f0e1] text-[#22201c] shadow-[0_10px_40px_rgba(0,0,0,0.35)]" style={SERIF}>
        <div className="flex items-center gap-2 border-b border-[#b9ad92] bg-[#ece4d0] px-3 py-1.5" style={{ fontFamily: "inherit" }}>
          <Pill onClick={() => setIndex((i) => Math.min(editions.length - 1, i + 1))} disabled={index >= editions.length - 1}>
            Ältere Ausgabe
          </Pill>
          <Pill onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
            Neuere
          </Pill>
          <span className="flex-1" />
          <Pill onClick={() => setPanel(null)}>Schließen</Pill>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
          {/* Masthead */}
          <div className="border-b-4 border-double border-[#22201c] pb-1 text-center">
            <div className="text-[44px] font-bold leading-none tracking-tight" style={{ fontFamily: "'Old English Text MT', 'UnifrakturMaguntia', Georgia, serif" }}>
              {PAPER_NAME}
            </div>
            <div className="mt-1 flex justify-between border-t border-[#22201c] pt-0.5 text-[11px] uppercase tracking-[0.15em]">
              <span>{edition ? `Tag ${edition.day}` : "–"}</span>
              <span>Unabhängig · Überparteilich · Seit Gründung der Stadt</span>
              <span>{edition ? `Nr. ${edition.day} · 1,50 €` : ""}</span>
            </div>
          </div>
          {!edition ? (
            <div className="py-16 text-center text-[15px] italic">Die erste Ausgabe ist noch in der Druckerei – sie erscheint, sobald der Verlag an der Straße liegt.</div>
          ) : (
            <>
              {/* Headline */}
              <div className="border-b border-[#22201c] py-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#8a1c1c]">{edition.headline.section}</div>
                <h1 className="mt-1 text-[30px] font-bold leading-[1.1]">{edition.headline.title}</h1>
                <p className="mt-2 text-[15px] leading-relaxed first-letter:float-left first-letter:mr-1.5 first-letter:text-[42px] first-letter:font-bold first-letter:leading-[0.85]">
                  {edition.headline.text}
                </p>
              </div>
              {/* Articles in two columns */}
              <div className="gap-6 pt-3 sm:columns-2" style={{ columnRule: "1px solid #b9ad92" }}>
                {edition.articles.map((a, i) => (
                  <article key={i} className="mb-4 break-inside-avoid">
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8a1c1c]">{a.section}</div>
                    <h2 className="text-[18px] font-bold leading-tight">{a.title}</h2>
                    <p className="mt-1 text-[13px] leading-relaxed">{a.text}</p>
                  </article>
                ))}
              </div>
              {edition.ads.length > 0 && (
                <div className="mt-2 border-t-2 border-[#22201c] pt-2">
                  <div className="text-center text-[10px] uppercase tracking-[0.3em]">Anzeigen</div>
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                    {edition.ads.map((ad, i) => (
                      <div key={i} className="border-2 border-[#22201c] px-2 py-1.5 text-center">
                        <div className="text-[14px] font-bold uppercase">{ad.title}</div>
                        <div className="text-[11px] leading-snug">{ad.text}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
