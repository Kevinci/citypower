import type { ReactNode } from "react";

/**
 * Game icon set: small flat vector illustrations (24×24) in one consistent style – soft
 * colours with a dark outline, matching the HUD. Use these instead of emoji everywhere.
 */

const O = "#2c3640"; // outline
const S = { stroke: O, strokeWidth: 1.2, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

const ICONS: Record<string, ReactNode> = {
  /* ---------- buildings ---------- */
  house: (
    <>
      <path d="M4 11 12 4l8 7v9H4z" fill="#f1e6c8" {...S} />
      <path d="M2.5 11.5 12 3.2l9.5 8.3" fill="none" {...S} />
      <path d="M3.5 11 12 3.8 20.5 11 19 11 12 5.2 5 11z" fill="#c0503a" {...S} />
      <rect x="10" y="14" width="4" height="6" fill="#7a4a30" {...S} />
      <rect x="6" y="12.5" width="2.6" height="2.6" fill="#7fb3d5" {...S} />
      <rect x="15.4" y="12.5" width="2.6" height="2.6" fill="#7fb3d5" {...S} />
    </>
  ),
  church: (
    <>
      <rect x="4" y="12" width="13" height="8" fill="#f4f4f0" {...S} />
      <path d="M3 12.5 10.5 8l7.5 4.5" fill="#5b6268" {...S} />
      <rect x="15" y="7" width="5" height="13" fill="#f4f4f0" {...S} />
      <path d="M17.5 1.5 14.5 7h6z" fill="#5f8f7c" {...S} />
      <path d="M8.5 20v-4a2 2 0 0 1 4 0v4" fill="#7a4a30" {...S} />
    </>
  ),
  farm: (
    <>
      <path d="M2 20h20" {...S} />
      <path d="M3 20v-8l5-4 5 4v8z" fill="#b5442f" {...S} />
      <path d="M6 20v-4h4v4" fill="#f1e6c8" {...S} />
      <rect x="15" y="7" width="4.5" height="13" rx="2.2" fill="#b9c2c9" {...S} />
      <path d="M15 9.5h4.5" {...S} />
    </>
  ),
  mill: (
    <>
      <path d="M9 21l1.5-10h3L15 21z" fill="#b5442f" {...S} />
      <path d="M12 11 6 3.5M12 11l7.5-5M12 11l-6.5 5.5M12 11l5.5 7" stroke="#7a4a30" strokeWidth={1.6} strokeLinecap="round" />
      <path d="M6 3.5 4.3 6 7.6 8.8zM19.5 6l1.2 2.8-3.7 1.3zM5.5 16.5l-1.2 2.7 3.6-.7zM17.5 18l2.6 1-1-3.6z" fill="#f1ebdd" {...S} />
      <circle cx="12" cy="11" r="1.4" fill="#5b6268" {...S} />
    </>
  ),
  bakery: (
    <>
      <rect x="3" y="9" width="18" height="11" fill="#f3ead8" {...S} />
      <path d="M2.5 9.5 5 5h14l2.5 4.5z" fill="#c0392b" {...S} />
      <path d="M5 5l1.4 4.5M9.5 5l.6 4.5M14.5 5l-.6 4.5M19 5l-1.4 4.5" stroke="#f4f1ea" strokeWidth={1.2} />
      <rect x="5" y="12" width="8" height="5" fill="#3b4a5a" {...S} />
      <rect x="15" y="12" width="3.5" height="8" fill="#7a4a30" {...S} />
    </>
  ),
  waterworks: (
    <>
      <path d="M9 21 10.5 10h3L15 21z" fill="#c9c6bf" {...S} />
      <path d="M6 10h12l-1.5-5h-9z" fill="#d6d3cc" {...S} />
      <path d="M7.5 5 12 2l4.5 3z" fill="#5b6268" {...S} />
      <path d="M12 14.5c-1.6 2-2.4 3.2-2.4 4.1a2.4 2.4 0 0 0 4.8 0c0-.9-.8-2.1-2.4-4.1z" fill="#3c95d1" {...S} />
    </>
  ),
  pool: (
    <>
      <rect x="2.5" y="9" width="19" height="11" rx="1.5" fill="#dfe9ec" {...S} />
      <rect x="4.5" y="11" width="15" height="7" rx="1" fill="#2f9fc9" {...S} />
      <path d="M5.5 14.5c1.5-1 2.5-1 4 0s2.5 1 4 0 2.5-1 4 0" fill="none" stroke="#fff" strokeWidth={1.1} />
      <path d="M17 9V4h3" fill="none" {...S} />
      <path d="M17 6h3" {...S} />
    </>
  ),
  fair: (
    <>
      <circle cx="12" cy="10" r="7" fill="none" {...S} />
      <path d="M12 3v14M5 10h14M7 5l10 10M17 5 7 15" stroke={O} strokeWidth={0.8} />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <circle key={i} cx={12 + 7 * Math.cos((i * Math.PI) / 4)} cy={10 + 7 * Math.sin((i * Math.PI) / 4)} r="1.3" fill={["#c9302c", "#f2c230", "#2d6fb7", "#3c9a5f"][i % 4]} {...S} />
      ))}
      <path d="M8.5 21 12 10l3.5 11" fill="none" {...S} />
    </>
  ),
  swim: (
    <>
      <path d="M3 16c2-1.5 3.5-1.5 5.5 0s3.5 1.5 5.5 0 3.5-1.5 5.5 0" fill="none" stroke="#2f9fc9" strokeWidth={2} strokeLinecap="round" />
      <circle cx="15" cy="7" r="2" fill="#f1c9a5" {...S} />
      <path d="M5 13 10 9l3 3" fill="none" {...S} />
    </>
  ),
  ride: (
    <>
      <path d="M4 20 12 4l8 16z" fill="#f2c230" {...S} />
      <path d="M2 20h20" {...S} />
      <circle cx="12" cy="13" r="2.5" fill="#e84a8a" {...S} />
    </>
  ),
  tannery: (
    <>
      <path d="M2 21V11l6-3v3l6-3v13z" fill="#9b6b4a" {...S} />
      <rect x="14" y="13" width="8" height="8" fill="#c9a37a" {...S} />
      <path d="M15.5 13V9.5c0-1 1.5-1.5 2.5-1s2.5 0 2.5 1V13" fill="#b08060" {...S} />
      <rect x="5" y="15" width="2.5" height="2.5" fill="#7fb3d5" {...S} />
    </>
  ),
  rubberfactory: (
    <>
      <path d="M2 21V12h8V8h12v13z" fill="#6f7a82" {...S} />
      <rect x="17" y="3" width="2.4" height="5" fill="#9aa3aa" {...S} />
      <circle cx="8" cy="16.5" r="2.8" fill="#3a3a3a" {...S} />
      <circle cx="8" cy="16.5" r="1.1" fill="#9aa3aa" />
    </>
  ),
  shoefactory: (
    <>
      <path d="M2 21V10l5 3v-3l5 3V6h10v15z" fill="#a0522d" {...S} />
      <path d="M13 18.5c0-2 .5-3.5 1.5-3.5h1.5c.5 1 1.5 1.5 3 1.8 1 .2 1.5.7 1.5 1.7z" fill="#3a2a20" {...S} />
    </>
  ),
  shoeshop: (
    <>
      <rect x="3" y="9" width="18" height="12" fill="#f1e6c8" {...S} />
      <path d="M2 9.5 4 5h16l2 4.5z" fill="#a0522d" {...S} />
      <path d="M6 18c0-2 .5-3.5 1.5-3.5H9c.5 1 1.5 1.5 3.2 1.8 1 .2 1.6.7 1.6 1.7z" fill="#3a2a20" {...S} />
      <rect x="16" y="13" width="3" height="8" fill="#7fb3d5" {...S} />
    </>
  ),
  sheepfarm: (
    <>
      <path d="M2 12 7 8l5 4v8H2z" fill="#b5523a" {...S} />
      <rect x="5.5" y="15" width="3" height="5" fill="#7a4a30" {...S} />
      <ellipse cx="17" cy="15.5" rx="4.6" ry="3.2" fill="#f4f1e6" {...S} />
      <ellipse cx="21" cy="13.8" rx="1.6" ry="1.3" fill="#3a3330" {...S} />
      <path d="M14.5 18.5v2M19 18.5v2" {...S} />
      <path d="M1.5 21h21" {...S} />
    </>
  ),
  spinning: (
    <>
      <path d="M2 21V9h13v12z" fill="#c78a6a" {...S} />
      <path d="M2 9 8.5 5 15 9" fill="#6b7177" {...S} />
      <rect x="15" y="4" width="2.2" height="17" fill="#9b6b4a" {...S} />
      <ellipse cx="19.5" cy="15.5" rx="2.6" ry="3.6" fill="#d98fb0" {...S} />
      <path d="M17.6 13.5c1.3.6 2.5.6 3.8 0M17.4 16c1.4.6 2.8.6 4.2 0" fill="none" {...S} />
      {[4.5, 8.5, 12].map((x) => (
        <rect key={x} x={x - 1} y="12" width="2" height="2.6" fill="#7fb3d5" {...S} />
      ))}
    </>
  ),
  clothing: (
    <>
      <path d="M2 21V10l5 3v-3l5 3V6h10v15z" fill="#5b7fa8" {...S} />
      <path d="M13 13.5 15 12h1.2a1.6 1.6 0 0 0 2.6 0H20l2 1.5-1.2 1.8-1-.6V20h-5v-5.3l-1 .6z" fill="#f2efe8" {...S} />
    </>
  ),
  fashion: (
    <>
      <rect x="3" y="9" width="18" height="12" fill="#f1e6c8" {...S} />
      <path d="M2 9.5 4 5h16l2 4.5z" fill="#3f6fb5" {...S} />
      <path d="M5 14 7.2 12.5h1.1a1.5 1.5 0 0 0 2.4 0h1.1L14 14l-1 1.6-.9-.5V20H7v-4.9l-.9.5z" fill="#d94a6a" {...S} />
      <rect x="16" y="13" width="3" height="8" fill="#7fb3d5" {...S} />
    </>
  ),
  chickenfarm: (
    <>
      <path d="M2.5 20V12l6-4 6 4v8z" fill="#c0503a" {...S} />
      <rect x="6.5" y="15" width="4" height="5" fill="#7a4a30" {...S} />
      <path d="M14.5 20h7M14.5 16.5h7" fill="none" {...S} />
      <ellipse cx="18" cy="12.2" rx="3" ry="2.4" fill="#f8f6f0" {...S} />
      <circle cx="20.2" cy="10" r="1.5" fill="#f8f6f0" {...S} />
      <path d="M20 8.2l.6-1 .6 1" fill="#d63a2a" {...S} />
    </>
  ),
  trader: (
    <>
      <rect x="2.5" y="13" width="9" height="7" fill="#d9774a" {...S} />
      <rect x="2.5" y="7" width="9" height="6" fill="#3f6fb5" {...S} />
      <rect x="11.5" y="13" width="9" height="7" fill="#2c8f4e" {...S} />
      <path d="M5.5 14v5M8.5 14v5M14.5 14v5M17.5 14v5M5.5 8v4M8.5 8v4" fill="none" {...S} strokeWidth={0.8} />
      <path d="M15 4.5h6M18.5 2.5l2.5 2-2.5 2M21 9.5h-6M17.5 7.5l-2.5 2 2.5 2" fill="none" {...S} />
    </>
  ),
  foodfactory: (
    <>
      <path d="M2.5 20V11l5 3V11l5 3V11l5 3V5h4v15z" fill="#e8ddc8" {...S} />
      <rect x="5" y="16" width="3" height="2.5" fill="#7fb3d5" {...S} />
      <rect x="10.5" y="16" width="3" height="2.5" fill="#7fb3d5" {...S} />
      <circle cx="19" cy="8" r="1.4" fill="#e5543a" {...S} />
    </>
  ),
  discounter: (
    <>
      <rect x="2.5" y="9" width="19" height="11" fill="#f4f4f0" {...S} />
      <path d="M2 9.5h20V6H2z" fill="#e5543a" {...S} />
      <rect x="5" y="12" width="6" height="8" fill="#7fb3d5" {...S} />
      <path d="M13.5 13h5l-.8 3.5h-3.6zM14.5 18.3h.1M17 18.3h.1" fill="#f4d03f" {...S} />
    </>
  ),
  eggs: (
    <>
      <ellipse cx="9" cy="13.5" rx="4.2" ry="5.5" fill="#f1e3c2" {...S} />
      <ellipse cx="15.5" cy="12" rx="4.2" ry="5.5" fill="#fbf7ee" {...S} />
    </>
  ),
  cocoa: (
    <>
      <path d="M12 3c4 2.5 5.5 6 5.5 9.5S15.5 20 12 21c-3.5-1-5.5-5-5.5-8.5S8 5.5 12 3z" fill="#9a5a2c" {...S} />
      <path d="M12 3.5v17M9 6.5c-.8 4-.8 8.5 0 12M15 6.5c.8 4 .8 8.5 0 12" fill="none" {...S} strokeWidth={0.9} />
    </>
  ),
  coffee: (
    <>
      <ellipse cx="9" cy="12.5" rx="4.5" ry="6" transform="rotate(-25 9 12.5)" fill="#5a3420" {...S} />
      <ellipse cx="15.5" cy="11.5" rx="4.5" ry="6" transform="rotate(20 15.5 11.5)" fill="#6b3f22" {...S} />
      <path d="M7.2 7.6c2.2 2.5 1.6 7-.2 9.6M16.6 6c-1.8 2.8-1.2 7 .8 9.4" fill="none" {...S} />
    </>
  ),
  food: (
    <>
      <rect x="3" y="8" width="8" height="12" rx="1" fill="#e5543a" {...S} />
      <rect x="4.5" y="11" width="5" height="4" fill="#f4f1e6" {...S} />
      <path d="M13 11h8v8.5a1.5 1.5 0 0 1-1.5 1.5h-5a1.5 1.5 0 0 1-1.5-1.5z" fill="#6b3f22" {...S} />
      <path d="M13 11l1.5-3h5l1.5 3" fill="#c9873a" {...S} />
    </>
  ),
  /** Pasta: a bundle of spaghetti and a farfalle. */
  pasta: (
    <>
      <path d="M4 18 14 5M6 19 16 6M8 20 18 7" fill="none" stroke="#e0b53a" strokeWidth={1.6} strokeLinecap="round" />
      <path d="M12 14l3 2.2 3-2.2v5l-3-2.2-3 2.2z" fill="#f2c94c" {...S} />
    </>
  ),
  /** Sweets: a wrapped candy. */
  sweets: (
    <>
      <path d="M3 8l4 2.5v3L3 16zM21 8l-4 2.5v3l4 2.5z" fill="#f29ac0" {...S} />
      <circle cx="12" cy="12" r="5" fill="#e84a8a" {...S} />
      <path d="M9.5 10.5c1.5-1 3.5-1 5 0" fill="none" stroke="#fff" strokeWidth={1.2} strokeLinecap="round" />
    </>
  ),
  /** Rice: a bowl heaped with grains. */
  rice: (
    <>
      <path d="M4 12.5h16c0 4.2-3.6 7.5-8 7.5s-8-3.3-8-7.5z" fill="#3f8fb5" {...S} />
      <path d="M5.5 12.5c.5-3 3.3-5 6.5-5s6 2 6.5 5z" fill="#f7f4ea" {...S} />
      <path d="M9 10.2l.8-.3M12 9.2l.8.2M14.6 10.4l.7.4M10.6 11.4l.8-.1" fill="none" stroke="#c9c2a8" strokeWidth={1} strokeLinecap="round" />
    </>
  ),
  /** Spices: a chili pod and a jar of ground spice. */
  spices: (
    <>
      <rect x="3.5" y="9" width="8" height="11" rx="1.5" fill="#d2691e" {...S} />
      <rect x="3" y="6.5" width="9" height="3" rx="1" fill="#5a3420" {...S} />
      <path d="M14 8c3 0 6 3.5 5.5 8-.3 2.5-2 4-3 3.5-1-.5.5-2.5.2-5-.3-2.4-1.7-4-2.7-6.5z" fill="#c0392b" {...S} />
      <path d="M14 8c0-1.5.8-2.8 2-3.3" fill="none" stroke="#2c8f4e" strokeWidth={1.5} strokeLinecap="round" />
    </>
  ),
  wool: (
    <>
      <circle cx="9" cy="13" r="4.5" fill="#f4f1e6" {...S} />
      <circle cx="15" cy="12" r="5" fill="#f4f1e6" {...S} />
      <circle cx="12" cy="16.5" r="4" fill="#f4f1e6" {...S} />
    </>
  ),
  yarn: (
    <>
      <circle cx="12" cy="12" r="7.5" fill="#d98fb0" {...S} />
      <path d="M5.5 9c4 1 9 1 13 0M4.8 13c4.5 1.5 10 1.5 14.4 0M7 17.5c3 1 7 1 10 0M10 4.8c-1.5 4-1.5 10 0 14.4" fill="none" {...S} />
      <path d="M18.5 16.5c1.5 1.5 2.5 3 3.5 4.5" fill="none" {...S} />
    </>
  ),
  clothes: <path d="M4 7.5 8.5 4h2a1.8 1.8 0 0 0 3 0h2L20 7.5l-2.2 3.2-1.8-1.1V20H8V9.6l-1.8 1.1z" fill="#3f6fb5" {...S} />,
  hides: <path d="M5 4c2 1 4 1 7 0s5-1 7 0c-1 3 0 5 1 8s0 6-2 8c-2-1-4-1-6 0s-4 1-6 0c-2-2-3-5-2-8s1-5 1-8z" fill="#b08060" {...S} />,
  leather: (
    <>
      <path d="M4 6h14l2 3v9H6l-2-3z" fill="#7a4a2a" {...S} />
      <path d="M6 18V9l-2-3M6 9h14" fill="none" {...S} />
    </>
  ),
  caoutchouc: (
    <>
      <path d="M8 21V7" stroke="#6b4a2a" strokeWidth={3} />
      <path d="M8 3c-4 1-5 4-4 6 2-1 3-2 4-6zM8 3c4 1 5 4 4 6-2-1-3-2-4-6z" fill="#3c9a5f" {...S} />
      <path d="M9.5 13l3 2" {...S} />
      <path d="M12 15h6v5h-6z" fill="#f2efe0" {...S} />
    </>
  ),
  rubber: (
    <>
      <circle cx="12" cy="12" r="8" fill="#3a3a3a" {...S} />
      <circle cx="12" cy="12" r="3.5" fill="#d6dce2" {...S} />
    </>
  ),
  shoes: <path d="M3 18c0-3.5 1-6 2.5-6H8c1 2 3 3 6 3.5 2.5.4 4 1.3 5 2.5v2H3z" fill="#7a4a2a" {...S} />,
  bank: (
    <>
      <path d="M2.5 9 12 3.5 21.5 9z" fill="#d8c9a6" {...S} />
      <rect x="3" y="9" width="18" height="1.8" fill="#d8c9a6" {...S} />
      {[5.5, 9.8, 14.2, 18.5].map((x) => (
        <rect key={x} x={x - 0.9} y="10.8" width="1.8" height="7.4" fill="#f1e6c8" {...S} />
      ))}
      <rect x="2.5" y="18.2" width="19" height="2.3" fill="#a7a39b" {...S} />
      <circle cx="12" cy="7.2" r="1.1" fill="#c9a23a" {...S} />
    </>
  ),
  warehouse: (
    <>
      <path d="M2.5 10 12 5l9.5 5v10.5h-19z" fill="#b8c2ca" {...S} />
      <rect x="5" y="12.5" width="6" height="8" fill="#7d8a95" {...S} />
      <path d="M5 14.5h6M5 16.5h6M5 18.5h6" stroke="#5d6a75" strokeWidth="0.8" />
      <rect x="13" y="15" width="3.5" height="3" fill="#c98a4a" {...S} />
      <rect x="16.5" y="15" width="3" height="3" fill="#2d6fb7" {...S} />
      <rect x="14.5" y="12" width="3.5" height="3" fill="#c9302c" {...S} />
    </>
  ),
  airport: (
    <>
      <rect x="2" y="17" width="20" height="4" fill="#5f6870" {...S} />
      <path d="M4 19h3M10.5 19h3M17 19h3" fill="none" stroke="#f4f4f0" strokeWidth="0.9" />
      <rect x="15.5" y="9" width="2" height="8" fill="#e8e4da" {...S} />
      <rect x="14.2" y="6.5" width="4.6" height="2.5" fill="#2d4656" {...S} />
      <path d="M2.5 9.5l7-1.8 4.5-3.6c.8-.6 1.8-.2 1.3.8l-2.2 3.2 3.4-.5-.2 1.2-6.4 1.6-2.8 2.3-1.3-.1 1-2.1-3.7.6z" fill="#f4f6f8" {...S} />
      <path d="M5.2 8.9l-1.4-2.2h1.3l1.9 1.8" fill="#1a5f9e" {...S} />
    </>
  ),
  harbour: (
    <>
      <rect x="2" y="15" width="20" height="6" fill="#4b8fc0" {...S} />
      <rect x="2" y="12.5" width="11" height="2.5" fill="#a7a39b" {...S} />
      <path d="M8 12.5V4h1.6v8.5M8.8 4.5l9 1.5M15 6v4" fill="none" stroke={O} strokeWidth="1.4" strokeLinecap="round" />
      <rect x="13.5" y="10" width="3" height="2.2" fill="#c9302c" {...S} />
      <path d="M13 17.5h8l-1.2 2.3h-6z" fill="#2c3640" {...S} />
    </>
  ),
  ship: (
    <>
      <path d="M2 14h20l-2.5 5H5z" fill="#2c3e50" {...S} />
      <rect x="15.5" y="8.5" width="4.5" height="5.5" fill="#f4f4f0" {...S} />
      <rect x="16.3" y="9.6" width="2.9" height="1.4" fill="#7fb3d5" />
      <rect x="4" y="11" width="4" height="3" fill="#c9302c" {...S} />
      <rect x="8.2" y="11" width="4" height="3" fill="#2d6fb7" {...S} />
      <rect x="6" y="8" width="4" height="3" fill="#e9b949" {...S} />
      <path d="M1 21c2-1 3 1 5 0s3 1 5 0 3 1 5 0 3 1 5 0" fill="none" stroke="#4b8fc0" strokeWidth="1.2" />
    </>
  ),
  /** Recycling yard: three chasing arrows. */
  recycling: (
    <>
      <path d="M9.5 4.5 12 3l2.5 1.5 2.6 4.5-2 1.2-2-3.5-2.1 3.6-2-1.2z" fill="#3fa45b" {...S} />
      <path d="M19.5 12.5 21 15l-1.4 2.6H14.4v-2.3h4l-2-3.5 2-1.2z" fill="#2e8b4e" {...S} />
      <path d="M4.5 17.6 3 15l1.4-2.5 1.9 1.1L4.6 16.6h5v2.3H6.1z" fill="#57b96f" {...S} />
      <rect x="8" y="19.5" width="8" height="2" rx="0.6" fill="#8a96a0" {...S} />
    </>
  ),
  /** Recycled material: a bale of pressed scrap. */
  recycled: (
    <>
      <rect x="4" y="7" width="16" height="12" rx="1.2" fill="#8bc79a" {...S} />
      <path d="M4 11h16M4 15h16M9 7v12M15 7v12" stroke="#2e8b4e" strokeWidth="1.2" />
      <path d="M12 3.5 14 6h-4z" fill="#3fa45b" {...S} />
    </>
  ),
  /** Park: two trees on a lawn by a pond. */
  park: (
    <>
      <ellipse cx="12" cy="18.5" rx="10" ry="3" fill="#7bc25a" {...S} />
      <ellipse cx="15.5" cy="18.6" rx="4" ry="1.5" fill="#5bb8e0" {...S} />
      <path d="M7 18v-4M17 16v-3" stroke="#7a5230" strokeWidth="1.6" />
      <circle cx="7" cy="10" r="4.5" fill="#3f8f3a" {...S} />
      <circle cx="17" cy="10" r="3.5" fill="#56a845" {...S} />
    </>
  ),
  /** Playground: slide with ladder and a swing. */
  playground: (
    <>
      <path d="M3 21h18" stroke="#c9a46a" strokeWidth="2" />
      <path d="M4 21V9M8 21V9M4 12h4M4 15h4M4 18h4" stroke="#e05a3a" strokeWidth="1.4" />
      <path d="M8 9c3 0 5 5 8 11" fill="none" stroke="#f2c94c" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M14 4h7M15 4v8M20 4v8" stroke="#1a8fc8" strokeWidth="1.4" />
      <rect x="15.5" y="12" width="4" height="1.4" fill="#1a8fc8" {...S} />
    </>
  ),
  /** Job centre: office with a person and an arrow to a workplace. */
  jobcenter: (
    <>
      <rect x="3" y="6" width="14" height="14.5" fill="#efe2c4" {...S} />
      <path d="M3 10h14M3 14h14" stroke="#7fb3d5" strokeWidth="1.6" />
      <circle cx="17.5" cy="9" r="2.6" fill="#f2c94c" {...S} />
      <path d="M13.5 18c0-2.6 1.8-4.4 4-4.4s4 1.8 4 4.4z" fill="#1a8fc8" {...S} />
      <path d="M5 18h6m-2-2 2 2-2 2" fill="none" stroke="#2c8f4e" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  taxoffice: (
    <>
      <rect x="3" y="5" width="18" height="15.5" fill="#dfe3e6" {...S} />
      <path d="M3 8.5h18M3 12h18M3 15.5h18" stroke="#7fb3d5" strokeWidth="1.6" />
      <rect x="2.5" y="3.5" width="19" height="2" fill="#5d6a75" {...S} />
      <circle cx="16.5" cy="15.5" r="5" fill="#2c8f4e" {...S} />
      <path d="M18.3 13.4a2.6 2.6 0 1 0 0 4.2M13.6 14.9h3.4M13.6 16.3h3.4" fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
    </>
  ),
  townhall: (
    <>
      <rect x="2.5" y="11" width="19" height="9.5" fill="#efe2c4" {...S} />
      <path d="M2 11.5 5 8.5h14l3 3" fill="#b5442f" {...S} />
      <rect x="9.5" y="6" width="5" height="14.5" fill="#d8c9a6" {...S} />
      <path d="M9 6 12 2l3 4z" fill="#5f8f7c" {...S} />
      <circle cx="12" cy="9" r="1.5" fill="#fff" {...S} />
      <path d="M11 20.5v-3.5h2v3.5" fill="#7a4a30" {...S} />
      <rect x="4.5" y="13.5" width="2.5" height="2.5" fill="#7fb3d5" {...S} />
      <rect x="17" y="13.5" width="2.5" height="2.5" fill="#7fb3d5" {...S} />
    </>
  ),
  hospital: (
    <>
      <rect x="3" y="6" width="18" height="15" fill="#f4f6f8" {...S} />
      <path d="M3 6h18" {...S} />
      <path d="M10 9h4v3h3v4h-3v3h-4v-3H7v-4h3z" fill="#d62f2f" {...S} />
    </>
  ),
  school: (
    <>
      <rect x="3" y="10" width="18" height="10" fill="#e9c46a" {...S} />
      <path d="M2 10.5 12 5l10 5.5" fill="#f4f4f0" {...S} />
      <rect x="10" y="14" width="4" height="6" fill="#7a4a30" {...S} />
      <circle cx="12" cy="9.3" r="1.6" fill="#fff" {...S} />
      <rect x="5" y="12.5" width="3" height="3" fill="#7fb3d5" {...S} />
      <rect x="16" y="12.5" width="3" height="3" fill="#7fb3d5" {...S} />
    </>
  ),
  steelworks: (
    <>
      <path d="M2 21V13l5 3v-3l5 3v-3l5 3V7h4v14z" fill="#6f7a82" {...S} />
      <path d="M17.5 7V3h2.5v4" fill="#7a4a33" {...S} />
      <circle cx="19" cy="2" r="1.4" fill="#cfcfcf" />
      <rect x="4" y="17.5" width="2.5" height="2" fill="#f5b041" />
      <rect x="9" y="17.5" width="2.5" height="2" fill="#f5b041" />
    </>
  ),
  sawmill: (
    <>
      <path d="M3 20v-8l7-4 7 4v8z" fill="#8a5a35" {...S} />
      <path d="M6 20v-5h4v5" fill="#c79a62" {...S} />
      <circle cx="18.5" cy="15.5" r="3.5" fill="#c9cdd2" {...S} />
      <path d="M18.5 12v-1M22 15.5h1M18.5 19v1M15 15.5h-1M21 13l.7-.7M21 18l.7.7M16 18l-.7.7M16 13l-.7-.7" {...S} />
      <circle cx="18.5" cy="15.5" r="1" fill={O} />
    </>
  ),

  furniture: (
    <>
      <path d="M2 21V11l5 2.5V11l5 2.5V11l5 2.5V21z" fill="#9b4a35" {...S} />
      <rect x="18" y="6" width="3" height="15" fill="#6f7a82" {...S} />
      <path d="M5 21v-3.5h3V21M11 21v-3.5h3V21" fill="#c79a62" {...S} />
      <path d="M8 6.5h6v3H8zM9 9.5v2M13 9.5v2" fill="#d9774a" {...S} />
    </>
  ),
  furniturestore: (
    <>
      <rect x="2.5" y="7" width="19" height="13" fill="#f3ead8" {...S} />
      <rect x="2" y="5" width="20" height="3" fill="#1a8fc8" {...S} />
      <rect x="4.5" y="10.5" width="9" height="7" fill="#2d4656" {...S} />
      <path d="M6 16v-2.5h6V16M6 13.5V12h6v1.5" fill="#d9774a" {...S} />
      <rect x="15.5" y="11" width="3.5" height="9" fill="#7a4a30" {...S} />
    </>
  ),
  slaughterhouse: (
    <>
      <rect x="3" y="9" width="13" height="11" fill="#e9ecec" {...S} />
      <path d="M2 9.5 9.5 5 17 9.5" fill="#4f5559" {...S} />
      <rect x="16" y="12" width="5.5" height="8" fill="#6f7a82" {...S} />
      <rect x="7.5" y="14" width="4" height="6" fill="#7a4a30" {...S} />
      <rect x="18" y="3" width="1.8" height="9" fill="#9b4a35" {...S} />
    </>
  ),
  butcher: (
    <>
      <rect x="3" y="9" width="18" height="11" fill="#eef0f0" {...S} />
      <path d="M2.5 9.5 5 5h14l2.5 4.5z" fill="#c0392b" {...S} />
      <path d="M5 5l1.4 4.5M9.5 5l.6 4.5M14.5 5l-.6 4.5M19 5l-1.4 4.5" stroke="#f4f1ea" strokeWidth={1.2} />
      <rect x="5" y="12" width="8" height="5" fill="#2d4656" {...S} />
      <path d="M6.5 15.5c0-1.5 1.2-2.3 2.5-2.3s2.5.8 2.5 2.3z" fill="#e07a7a" />
      <rect x="15" y="12" width="3.5" height="8" fill="#7a4a30" {...S} />
    </>
  ),

  restaurant: (
    <>
      <rect x="3" y="9" width="18" height="11" fill="#f3ead8" {...S} />
      <path d="M2.5 9.5 5 5h14l2.5 4.5z" fill="#2c6e49" {...S} />
      <path d="M5 5l1.4 4.5M9.5 5l.6 4.5M14.5 5l-.6 4.5M19 5l-1.4 4.5" stroke="#f4f1ea" strokeWidth={1.2} />
      <rect x="5" y="12" width="7" height="5" fill="#2d4656" {...S} />
      <path d="M15.5 12v3.5M17.5 12v8M19.5 12v3.5M15.5 15.5h4" {...S} />
    </>
  ),
  cinema: (
    <>
      <rect x="3" y="8" width="18" height="12" fill="#7d2f3a" {...S} />
      <rect x="5" y="4" width="14" height="5" fill="#f2c14e" {...S} />
      <path d="M8 6.5h8" stroke="#7d2f3a" strokeWidth={1.4} strokeLinecap="round" />
      <rect x="9" y="13" width="6" height="7" fill="#2d4656" {...S} />
      <rect x="5" y="12" width="2.5" height="4" fill="#f2c14e" {...S} />
      <rect x="16.5" y="12" width="2.5" height="4" fill="#f2c14e" {...S} />
    </>
  ),

  /* ---------- goods and needs ---------- */
  meal: (
    <>
      <ellipse cx="12" cy="14" rx="8.5" ry="5" fill="#f4f4f0" {...S} />
      <ellipse cx="12" cy="13.5" rx="5" ry="2.8" fill="#e67e22" {...S} />
      <path d="M10 12.5c1-.6 2.5-.7 4 0" fill="none" stroke="#f9d29b" strokeWidth={1.2} strokeLinecap="round" />
      <path d="M2 6v4M3.5 6v4M2 10h1.5M2.8 10v9M21.5 6c-1.2 1-1.5 3-1.5 5h1.5v8" fill="none" {...S} />
    </>
  ),
  ticket: (
    <>
      <path d="M3 8h18v3a1.6 1.6 0 0 0 0 3.2V17H3v-2.8a1.6 1.6 0 0 0 0-3.2z" fill="#8e44ad" {...S} />
      <path d="M15 8v9" stroke="#f4f1ea" strokeWidth={1.2} strokeDasharray="1.4 1.2" />
      <path d="M7 11.5h5M7 13.8h3.5" stroke="#f4f1ea" strokeWidth={1.3} strokeLinecap="round" />
    </>
  ),
  sofa: (
    <>
      <path d="M5 9a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3H5z" fill="#d9774a" {...S} />
      <path d="M2.5 12a1.8 1.8 0 0 1 3.6 0v1h11.8v-1a1.8 1.8 0 0 1 3.6 0v5.5h-19z" fill="#e8956a" {...S} />
      <path d="M4 17.5V20M20 17.5V20" {...S} />
    </>
  ),
  cattle: (
    <>
      <path d="M5 10h11.5l2.5-2 2 1.5-1 3.5h-2.5V18h-2v-3H8v3H6v-3.5c-1.4-.5-2-1.6-2-3z" fill="#8a5a3c" {...S} />
      <path d="M19 8l.5-2M21 9.5l1.5-1" {...S} />
      <circle cx="19.6" cy="10.2" r=".5" fill={O} />
      <path d="M4 11 2.5 14" {...S} />
    </>
  ),
  pig: (
    <>
      <ellipse cx="11" cy="13" rx="7.5" ry="5" fill="#f2a7b5" {...S} />
      <path d="M8 8.5 9 6.5l1.6 2.2" fill="#f2a7b5" {...S} />
      <rect x="17" y="11" width="3.5" height="3.6" rx="1.4" fill="#f7c4cd" {...S} />
      <path d="M7 17.5V20M14 17.5V20" {...S} />
      <circle cx="15" cy="10.5" r=".6" fill={O} />
      <path d="M3.5 12c-1-.3-1.3-1.4-.5-2" fill="none" {...S} />
    </>
  ),
  meat: (
    <>
      <path d="M5 9c2-4 9-5 13-2s2 9-3 10.5S4 16 4 13c0-1.5.4-2.8 1-4z" fill="#c0392b" {...S} />
      <path d="M8 11c2-2 6-2.5 8-1" fill="none" stroke="#f4dcdc" strokeWidth={1.4} strokeLinecap="round" />
      <circle cx="16.5" cy="13" r="1.8" fill="#f4f1ea" {...S} />
    </>
  ),

  wheat: (
    <>
      <path d="M12 21V8" stroke="#8a6b22" strokeWidth={1.4} strokeLinecap="round" />
      {[4, 7.5, 11, 14.5].map((y) => (
        <g key={y}>
          <ellipse cx="9.8" cy={y + 1} rx="1.6" ry="2.5" transform={`rotate(-30 9.8 ${y + 1})`} fill="#e3b23c" {...S} />
          <ellipse cx="14.2" cy={y + 1} rx="1.6" ry="2.5" transform={`rotate(30 14.2 ${y + 1})`} fill="#e3b23c" {...S} />
        </g>
      ))}
    </>
  ),
  milk: (
    <>
      <path d="M8 6h8l1.5 3v11h-11V9z" fill="#ffffff" {...S} />
      <path d="M6.5 13h11v7h-11z" fill="#8fd3ff" {...S} />
      <rect x="9" y="3" width="6" height="3" fill="#2f8fd1" {...S} />
    </>
  ),
  flour: (
    <>
      <path d="M6 8c0-2 2-4 6-4s6 2 6 4l1 11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" fill="#efe6d2" {...S} />
      <path d="M8 6.5c2 1 6 1 8 0" fill="none" {...S} />
      <path d="M12 12v6M10 14l2-2 2 2" stroke="#c9a23e" strokeWidth={1.3} fill="none" strokeLinecap="round" />
    </>
  ),
  bread: (
    <>
      <path d="M3 15c0-4.5 4-8 9-8s9 3.5 9 8v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="#d38f45" {...S} />
      <path d="M8 10.5l1.5 2.5M12 9.5v3M16 10.5l-1.5 2.5" stroke="#f4dcaf" strokeWidth={1.4} strokeLinecap="round" />
    </>
  ),
  steel: (
    <>
      <path d="M3 9h18v3H3zM3 15h18v3H3z" fill="#b9c2c9" {...S} />
      <path d="M8 12v3M16 12v3" {...S} />
    </>
  ),
  boards: (
    <>
      <rect x="3" y="6" width="18" height="3.4" fill="#c79a62" {...S} />
      <rect x="3" y="10.6" width="18" height="3.4" fill="#d6ac74" {...S} />
      <rect x="3" y="15.2" width="18" height="3.4" fill="#c79a62" {...S} />
    </>
  ),
  water: (
    <path d="M12 3c-3.5 4.3-5.5 7.3-5.5 10a5.5 5.5 0 0 0 11 0c0-2.7-2-5.7-5.5-10z" fill="#3c95d1" {...S} />
  ),
  worker: (
    <>
      <circle cx="12" cy="10" r="3.6" fill="#f1c9a5" {...S} />
      <path d="M7.5 9a4.5 4.5 0 0 1 9 0z" fill="#f5b041" {...S} />
      <path d="M6.5 9h11" {...S} />
      <path d="M5 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5z" fill="#2f6fd6" {...S} />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3" fill="#f1c9a5" {...S} />
      <circle cx="16.5" cy="9.5" r="2.4" fill="#e8b98f" {...S} />
      <path d="M3 20c0-3.8 2.7-6 6-6s6 2.2 6 6z" fill="#2f6fd6" {...S} />
      <path d="M13.5 20c.3-3 1.4-4.6 3-4.6 2.3 0 4 1.9 4 4.6z" fill="#c0503a" {...S} />
    </>
  ),
  jobs: (
    <>
      <rect x="3" y="8" width="18" height="12" rx="2" fill="#8a5a35" {...S} />
      <path d="M9 8V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v2" fill="none" {...S} />
      <path d="M3 13h18" {...S} />
      <rect x="10.5" y="11.5" width="3" height="3" fill="#f5b041" {...S} />
    </>
  ),
  education: (
    <>
      <path d="M2 9.5 12 5l10 4.5L12 14z" fill="#2c3640" {...S} />
      <path d="M6.5 11.5V16c1.5 1.5 3.5 2 5.5 2s4-.5 5.5-2v-4.5" fill="#3d4650" {...S} />
      <path d="M20 10.5V15" {...S} />
      <circle cx="20" cy="16" r="1" fill="#f5b041" {...S} />
    </>
  ),
  road: (
    <>
      <path d="M8 3 4 21h16L16 3z" fill="#4a4f55" {...S} />
      <path d="M12 5v2.5M12 10.5v3M12 16.5V19" stroke="#f4f1ea" strokeWidth={1.4} strokeLinecap="round" />
    </>
  ),
  highway: (
    <>
      <path d="M7 3 2 21h20L17 3z" fill="#4a4f55" {...S} />
      <path d="M12 3v18" stroke="#7fa65a" strokeWidth={1.6} />
      <path d="M9 6l-.6 3M8 12l-.6 3M7 18l-.4 2M15 6l.6 3M16 12l.6 3M17 18l.4 2" stroke="#f4f1ea" strokeWidth={1.1} strokeLinecap="round" />
    </>
  ),
  bike: (
    <>
      <circle cx="6" cy="15.5" r="3.8" fill="none" {...S} strokeWidth={1.6} />
      <circle cx="18" cy="15.5" r="3.8" fill="none" {...S} strokeWidth={1.6} />
      <path d="M6 15.5 9.5 8h6l2.5 7.5M9.5 8l3 7.5h-6.5M15.5 8 12.5 15.5" fill="none" stroke="#c0392b" strokeWidth={1.6} strokeLinejoin="round" />
      <path d="M8.5 6h2.5M15 5.5h2" {...S} strokeWidth={1.6} />
    </>
  ),
  rail: (
    <>
      <path d="M5 4h14M5 8h14M5 12h14M5 16h14M5 20h14" stroke="#8a6440" strokeWidth={2} strokeLinecap="round" />
      <path d="M9 2v20M15 2v20" stroke="#5b6268" strokeWidth={1.8} />
    </>
  ),
  rail2: (
    <>
      <rect x="5" y="4" width="14" height="13" rx="3" fill="#e4e6e8" {...S} />
      <rect x="7" y="6.5" width="10" height="4.5" rx="1" fill="#7fb3d5" {...S} />
      <path d="M5 13.5h14" stroke="#c0392b" strokeWidth={1.6} />
      <circle cx="8.5" cy="15" r="1" fill={O} />
      <circle cx="15.5" cy="15" r="1" fill={O} />
      <path d="M8 17l-2 4M16 17l2 4M7 19.5h10" {...S} />
    </>
  ),
  canal: (
    <>
      <rect x="2" y="5" width="20" height="14" fill="#c9bfa9" {...S} />
      <rect x="2" y="8" width="20" height="8" fill="#3c95d1" {...S} />
      <path d="M4 11c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0" fill="none" stroke="#bfe3f7" strokeWidth={1.1} />
    </>
  ),
  interchange: (
    <>
      <path d="M12 2v20M2 12h20" stroke="#4a4f55" strokeWidth={3} />
      <path d="M12 7.5c2.5 0 4.5 2 4.5 4.5" fill="none" stroke="#1a9bd7" strokeWidth={2} strokeLinecap="round" />
      <path d="M12 16.5c-2.5 0-4.5-2-4.5-4.5" fill="none" stroke="#1a9bd7" strokeWidth={2} strokeLinecap="round" />
    </>
  ),
  cloverleaf: (
    <>
      {[
        [7, 7],
        [17, 7],
        [7, 17],
        [17, 17],
      ].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r="3.6" fill="none" stroke="#1a9bd7" strokeWidth={1.8} />
      ))}
      <path d="M12 1v22M1 12h22" stroke="#4a4f55" strokeWidth={3} />
    </>
  ),
  trumpet: (
    <>
      <path d="M1 8h22" stroke="#4a4f55" strokeWidth={3} />
      <path d="M12 8v15" stroke="#4a4f55" strokeWidth={3} />
      <circle cx="16.5" cy="14" r="3.6" fill="none" stroke="#1a9bd7" strokeWidth={1.8} />
      <path d="M7 8c0 4 2 6 5 8" fill="none" stroke="#1a9bd7" strokeWidth={1.8} strokeLinecap="round" />
    </>
  ),
  money: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" fill="#7cc48f" {...S} />
      <circle cx="12" cy="12" r="3.2" fill="#d9f2df" {...S} />
      <path d="M12 10.3v3.4" {...S} />
    </>
  ),
  disk: (
    <>
      <path d="M4 4h13l3 3v13H4z" fill="#2f6fd6" {...S} />
      <rect x="7" y="4" width="9" height="5.5" fill="#e4e6e8" {...S} />
      <rect x="13" y="5" width="2" height="3.5" fill={O} />
      <rect x="7" y="13" width="10" height="7" fill="#f4f6f8" {...S} />
    </>
  ),
  powerplant: (
    <>
      <path d="M2 21v-7h11v7z" fill="#94503a" {...S} />
      <path d="M14 21c1-4 1-8-.5-12h7c-1.5 4-1.5 8-.5 12z" fill="#e2ded6" {...S} />
      <path d="M15 6c0-2 2-2 2-3.5M18.5 6c0-2 2-2 2-3.5" fill="none" stroke="#b9c2c9" strokeWidth={1.2} strokeLinecap="round" />
      <path d="M8 11 5.5 15h2l-1 3 3-4.5h-2l1-2.5z" fill="#f1c40f" {...S} />
    </>
  ),
  transformer: (
    <>
      <rect x="4" y="9" width="16" height="11" fill="#56705a" {...S} />
      <path d="M4 12h16M4 15h16" {...S} />
      <path d="M8 9V5M12 9V4M16 9V5" {...S} />
      <path d="M12.5 11.5 10.5 15h2l-1 3.5" fill="none" stroke="#f1c40f" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  coalmine: (
    <>
      <path d="M2 21 9 9l4 5 3-3 6 10z" fill="#7b7f84" {...S} />
      <path d="M13 21V7h4v14M13 11h4M13 15h4M13 7l2-3 2 3" fill="none" {...S} />
      <circle cx="15" cy="4" r="1.3" fill="#b9c2c9" {...S} />
      <path d="M3 21c1-2 4-2 5 0z" fill="#1b1b1c" {...S} />
    </>
  ),
  ironmine: (
    <>
      <path d="M2 21 9 9l4 5 3-3 6 10z" fill="#7b7f84" {...S} />
      <path d="M13 21V7h4v14M13 11h4M13 15h4M13 7l2-3 2 3" fill="none" {...S} />
      <circle cx="15" cy="4" r="1.3" fill="#b9c2c9" {...S} />
      <path d="M3 21c1-2 4-2 5 0z" fill="#9c5a3c" {...S} />
    </>
  ),
  uraniummine: (
    <>
      <path d="M2 21 9 9l4 5 3-3 6 10z" fill="#7b7f84" {...S} />
      <path d="M13 21V7h4v14M13 11h4M13 15h4M13 7l2-3 2 3" fill="none" {...S} />
      <circle cx="15" cy="4" r="1.3" fill="#b9c2c9" {...S} />
      <rect x="3" y="16" width="3" height="5" rx="0.6" fill="#e0b81f" {...S} />
      <rect x="7" y="16" width="3" height="5" rx="0.6" fill="#e0b81f" {...S} />
    </>
  ),
  /** Stock exchange: classical front with a rising price line. */
  exchange: (
    <>
      <path d="M3 9 12 4l9 5z" fill="#e9dcc2" {...S} />
      <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" fill="none" {...S} strokeWidth={1.6} />
      <path d="M3 18.5h18v2H3z" fill="#e9dcc2" {...S} />
      <path d="M4 15.5l4-3 4 2 4-4.5 4 1.5" fill="none" stroke="#2c8f4e" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  goldmine: (
    <>
      <path d="M2 21 9 9l4 5 3-3 6 10z" fill="#7b7f84" {...S} />
      <path d="M13 21V7h4v14M13 11h4M13 15h4M13 7l2-3 2 3" fill="none" {...S} />
      <circle cx="15" cy="4" r="1.3" fill="#b9c2c9" {...S} />
      <path d="M2.5 21l1.5-4h5l1.5 4z" fill="#f2c230" {...S} />
    </>
  ),
  /** Gold smelter: crucible pouring into a bar mould. */
  goldsmelter: (
    <>
      <path d="M4 4h9l-1.5 8h-6z" fill="#7b7f84" {...S} />
      <path d="M12 9c2 0 3 2 3 5" fill="none" stroke="#ff8a1f" strokeWidth={2} strokeLinecap="round" />
      <path d="M8 16h13l-1.5 4.5h-10z" fill="#f2c230" {...S} />
      <path d="M6 4.5V3M10 4.5V2.5" fill="none" {...S} />
    </>
  ),
  /** Jeweller: a ring with a diamond. */
  jeweller: (
    <>
      <circle cx="12" cy="15" r="5.5" fill="none" stroke="#c9a23a" strokeWidth={2.4} />
      <circle cx="12" cy="15" r="5.5" fill="none" stroke={O} strokeWidth={0.8} />
      <path d="M8.5 7 10 4h4l1.5 3L12 11z" fill="#bfe7ff" {...S} />
      <path d="M8.5 7h7M10 4l2 7 2-7" fill="none" {...S} strokeWidth={0.8} />
    </>
  ),
  goldore: (
    <>
      <path d="M3 18l3-6 4 1 3-5 5 3 3 7-5 3H7z" fill="#8a7a52" {...S} />
      <circle cx="10" cy="15" r="1.3" fill="#f2c230" />
      <circle cx="15" cy="12" r="1.1" fill="#f2c230" />
      <circle cx="13" cy="17" r="0.8" fill="#f2c230" />
    </>
  ),
  /** Gold bars: two on the bottom, one on top. */
  gold: (
    <>
      <path d="M2 20l2-5h7l2 5z" fill="#e8b923" {...S} />
      <path d="M11 20l2-5h7l2 5z" fill="#e8b923" {...S} />
      <path d="M6.5 14.5l2-5h7l2 5z" fill="#f5d055" {...S} />
      <path d="M9.5 11h3" stroke="#fff6c8" strokeWidth={1} strokeLinecap="round" />
    </>
  ),
  /** Jewellery: a necklace with a pendant. */
  jewellery: (
    <>
      <path d="M4 4c0 8 4 11 8 11s8-3 8-11" fill="none" stroke="#c9a23a" strokeWidth={1.6} />
      <path d="M12 14l3 3-3 4-3-4z" fill="#d08cff" {...S} />
    </>
  ),
  cable: (
    <>
      <path d="M5 21 7 4h2l2 17M5.5 9h7M6 6h5" fill="none" {...S} />
      <path d="M13 21l2-17h2l2 17M13.5 9h7M14 6h5" fill="none" {...S} />
      <path d="M2 10c4 3 8 3 11 0M11 7c3 2 6 2 9 0" fill="none" stroke="#2c3640" strokeWidth={0.9} />
    </>
  ),
  power: <path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2z" fill="#f1c40f" {...S} />,
  coal: (
    <>
      <path d="M3 18l3-6 4 1 3-5 5 3 3 7-5 3H7z" fill="#2b2b2b" {...S} />
      <path d="M9 13l2 3M15 10l-1 4" stroke="#6b6b6b" strokeWidth={1} />
    </>
  ),
  ore: (
    <>
      <path d="M3 18l3-6 4 1 3-5 5 3 3 7-5 3H7z" fill="#9c5a3c" {...S} />
      <circle cx="10" cy="15" r="1.2" fill="#c9cdd2" />
      <circle cx="15" cy="12" r="1" fill="#c9cdd2" />
    </>
  ),
  uranium: (
    <>
      <rect x="6" y="4" width="12" height="17" rx="2" fill="#e0b81f" {...S} />
      <circle cx="12" cy="12.5" r="1.3" fill={O} />
      <path d="M12 11.2 10.2 8a4.5 4.5 0 0 1 3.6 0zM13.1 13.2l3.6.2a4.5 4.5 0 0 1-1.8 3.1zM10.9 13.2l-1.8 3.3a4.5 4.5 0 0 1-1.8-3.1z" fill={O} />
    </>
  ),
  wrench: (
    <path
      d="M14.5 3.5a5 5 0 0 0-4.6 6.8L3.5 16.7a2 2 0 0 0 2.8 2.8l6.4-6.4a5 5 0 0 0 6.8-4.6l-2.9 2.9-3-.8-.8-3z"
      fill="#b9c2c9"
      {...S}
    />
  ),
  check: <path d="M4.5 12.5 9.5 17.5 19.5 6.5" fill="none" stroke="#2c8f4e" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />,
  cross: <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="#c0392b" strokeWidth={2.6} strokeLinecap="round" />,
};

export type GameIconName = keyof typeof ICONS;

export function GameIcon({ name, size = 16, className = "" }: { name: string; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`inline-block shrink-0 align-[-0.2em] ${className}`}
      aria-hidden
    >
      {ICONS[name] ?? ICONS.house}
    </svg>
  );
}
