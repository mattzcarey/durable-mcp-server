/**
 * Art for the power/water/cooling arc: four scenes (the pylons inland, the
 * coast with the own intake and its surfers, the reactor brochure, the
 * drained cold basin) and five sprites.
 */

import type { StoryInput } from "../../story/format";
import { fragments, svgDocument } from "../../story/svg";

function pylon(x: number, scale: number): string {
  return `<g transform="translate(${x} 232) scale(${scale})" stroke="#4b5563" stroke-width="2" fill="none">
<path d="M-14 0 L-5 -120 L5 -120 L14 0"/><path d="M-22 -96 H22"/><path d="M-18 -72 H18"/><path d="M-10 -48 H10"/>
<path d="M-14 0 L14 -24 M14 0 L-14 -24 M-12 -24 L12 -48 M12 -24 L-12 -48 M-10 -48 L10 -72 M10 -48 L-10 -72"/></g>`;
}

const pylons = svgDocument(
  fragments(
    `<defs><linearGradient id="pw-moor-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fb3c8"/><stop offset="1" stop-color="#e6edf3"/></linearGradient>
<linearGradient id="pw-moor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a6b8f"/><stop offset="1" stop-color="#5c6b4a"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#pw-moor-sky)"/>`,
    `<g fill="#fff" opacity="0.5"><ellipse cx="120" cy="70" rx="90" ry="18"><animateTransform attributeName="transform" type="translate" values="0 0;40 0;0 0" dur="18s" repeatCount="indefinite"/></ellipse>
<ellipse cx="430" cy="50" rx="120" ry="22"><animateTransform attributeName="transform" type="translate" values="0 0;-50 0;0 0" dur="22s" repeatCount="indefinite"/></ellipse></g>`,
    `<path d="M0 230 C120 180 220 210 320 190 S520 160 640 200 L640 360 L0 360 Z" fill="url(#pw-moor)"/>`,
    `<path d="M0 262 C160 236 300 270 460 246 S600 236 640 250 L640 360 L0 360 Z" fill="#6e7d50"/>`,
    pylon(90, 0.9),
    pylon(300, 1.1),
    pylon(520, 1.3),
    `<g stroke="#374151" stroke-width="1.5" fill="none" opacity="0.8">
<path d="M68 138 Q190 170 279 108"><animate attributeName="d" values="M68 138 Q190 170 279 108;M68 138 Q190 176 279 108;M68 138 Q190 170 279 108" dur="5s" repeatCount="indefinite"/></path>
<path d="M321 108 Q430 160 494 80"><animate attributeName="d" values="M321 108 Q430 160 494 80;M321 108 Q430 168 494 80;M321 108 Q430 160 494 80" dur="6s" repeatCount="indefinite"/></path>
<path d="M-40 150 Q20 170 68 138"/><path d="M546 80 Q600 120 680 100"/></g>`,
    `<g fill="#f3f4f6"><ellipse cx="180" cy="300" rx="14" ry="9"/><ellipse cx="212" cy="306" rx="12" ry="8"/><ellipse cx="570" cy="316" rx="14" ry="9"/></g>
<g fill="#1f2937"><circle cx="168" cy="297" r="4"/><circle cx="202" cy="303" r="3.5"/><circle cx="558" cy="313" r="4"/></g>`,
    `<g fill="#d1d5db" opacity="0.35"><rect x="0" y="240" width="640" height="40"><animate attributeName="opacity" values="0.2;0.45;0.2" dur="7s" repeatCount="indefinite"/></rect></g>`,
  ),
);

const coast = svgDocument(
  fragments(
    `<defs><linearGradient id="pw-coast-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ec5e8"/><stop offset="1" stop-color="#e8f4fb"/></linearGradient>
<linearGradient id="pw-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b7bb0"/><stop offset="1" stop-color="#174a73"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#pw-coast-sky)"/>`,
    `<circle cx="540" cy="70" r="26" fill="#ffe08a"><animate attributeName="r" values="26;28;26" dur="5s" repeatCount="indefinite"/></circle>`,
    `<rect y="190" width="640" height="170" fill="url(#pw-sea)"/>`,
    `<g stroke="#dff2ff" stroke-width="2" fill="none" stroke-dasharray="20 30" opacity="0.7">
<path d="M0 215 Q80 205 160 215 T320 215 T480 215 T640 215"><animate attributeName="stroke-dashoffset" from="0" to="-100" dur="4s" repeatCount="indefinite"/></path>
<path d="M0 255 Q80 245 160 255 T320 255 T480 255 T640 255" opacity="0.6"><animate attributeName="stroke-dashoffset" from="0" to="-100" dur="5.5s" repeatCount="indefinite"/></path>
<path d="M0 300 Q80 290 160 300 T320 300 T480 300 T640 300" opacity="0.5"><animate attributeName="stroke-dashoffset" from="0" to="-100" dur="6.5s" repeatCount="indefinite"/></path></g>`,
    `<path d="M0 200 L0 130 L90 120 L170 150 L240 160 L260 200 Z" fill="#8a7a5c"/><path d="M0 160 L90 150 L170 170 L240 178 L250 200 L0 200 Z" fill="#6e8a4a"/>`,
    `<g><rect x="40" y="96" width="110" height="44" rx="3" fill="#cfd8e3" stroke="#8a97a6"/><rect x="52" y="84" width="20" height="14" fill="#8a97a6"/><rect x="100" y="80" width="12" height="18" fill="#8a97a6"/>
<circle cx="140" cy="104" r="4" fill="#d94d3a"><animate attributeName="opacity" values="1;0.2;1" dur="1.8s" repeatCount="indefinite"/></circle></g>`,
    `<path d="M150 136 Q210 150 250 190 T330 250" stroke="#9aa8b6" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M150 136 Q210 150 250 190 T330 250" stroke="#c8e4f5" stroke-width="2" fill="none" stroke-dasharray="6 10"><animate attributeName="stroke-dashoffset" from="0" to="-32" dur="2s" repeatCount="indefinite"/></path>`,
    `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" dur="3s" repeatCount="indefinite"/>
<ellipse cx="470" cy="262" rx="28" ry="5" fill="#f6e7b3"/><line x1="470" y1="258" x2="470" y2="236" stroke="#222" stroke-width="3"/><circle cx="470" cy="231" r="5" fill="#222"/>
<line x1="470" y1="244" x2="486" y2="236" stroke="#222" stroke-width="3"/></g>`,
  ),
);

const reactor = svgDocument(
  fragments(
    `<defs><linearGradient id="pw-reactor-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c7dff0"/><stop offset="1" stop-color="#eef5fa"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#pw-reactor-sky)"/>`,
    `<rect y="240" width="640" height="120" fill="#86a85c"/><path d="M0 250 Q160 236 320 248 T640 244" stroke="#6f8f4b" stroke-width="2" fill="none"/>`,
    `<g><ellipse cx="420" cy="120" rx="26" ry="14" fill="#fff" opacity="0.9"><animate attributeName="cy" values="120;60;0" dur="6s" repeatCount="indefinite"/><animate attributeName="rx" values="18;40;60" dur="6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.9;0.5;0" dur="6s" repeatCount="indefinite"/></ellipse>
<ellipse cx="420" cy="120" rx="26" ry="14" fill="#fff" opacity="0.9"><animate attributeName="cy" values="120;60;0" dur="6s" begin="3s" repeatCount="indefinite"/><animate attributeName="rx" values="18;40;60" dur="6s" begin="3s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.9;0.5;0" dur="6s" begin="3s" repeatCount="indefinite"/></ellipse></g>`,
    `<path d="M392 240 L400 130 L440 130 L448 240 Z" fill="#c9d2db" stroke="#98a4b1"/>`,
    `<g><path d="M200 240 V170 A80 80 0 0 1 360 170 V240 Z" fill="#e3e8ee" stroke="#9aa6b3" stroke-width="2"/>
<rect x="230" y="200" width="100" height="40" fill="#d0d8e0"/><rect x="272" y="212" width="16" height="28" fill="#4b5563"/>
<circle cx="280" cy="150" r="5" fill="#d94d3a"><animate attributeName="opacity" values="1;0.1;1" dur="2s" repeatCount="indefinite"/></circle></g>`,
    `<g stroke="#6b5b45" stroke-width="3">${[30, 80, 130, 510, 560, 610]
      .map((x) => `<line x1="${x}" y1="250" x2="${x}" y2="290"/>`)
      .join("")}</g>
<g stroke="#6b5b45" stroke-width="1.5"><line x1="30" y1="262" x2="130" y2="262"/><line x1="30" y1="280" x2="130" y2="280"/><line x1="510" y1="262" x2="610" y2="262"/><line x1="510" y1="280" x2="610" y2="280"/></g>`,
    `<g transform="translate(560 296)"><rect x="-30" y="-24" width="60" height="22" rx="2" fill="#f3d35b" stroke="#7a6a22"/><text y="-9" text-anchor="middle" font-family="ui-monospace, monospace" font-size="9" font-weight="700" fill="#3b3310">LICENCE PENDING</text><rect x="-2" y="-2" width="4" height="30" fill="#6b5b45"/></g>`,
  ),
);

const dryReservoir = svgDocument(
  fragments(
    `<defs><linearGradient id="pw-dry-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2d7a0"/><stop offset="1" stop-color="#fbf1dc"/></linearGradient>
<linearGradient id="pw-mud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9a26c"/><stop offset="1" stop-color="#a77c48"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#pw-dry-sky)"/>`,
    `<circle cx="320" cy="90" r="40" fill="#fff1b8"><animate attributeName="r" values="40;44;40" dur="4s" repeatCount="indefinite"/></circle>
<circle cx="320" cy="90" r="70" fill="#fff1b8" opacity="0.25"><animate attributeName="opacity" values="0.2;0.4;0.2" dur="4s" repeatCount="indefinite"/></circle>`,
    `<rect y="200" width="640" height="160" fill="url(#pw-mud)"/>`,
    `<g stroke="#7d5a30" stroke-width="1.5" fill="none" opacity="0.8"><path d="M20 230 L80 250 L60 300 L120 340"/><path d="M80 250 L150 236 L210 262 L190 320"/><path d="M150 236 L240 210 L300 228"/><path d="M420 214 L480 250 L560 236 L620 270"/><path d="M480 250 L470 300 L520 350"/><path d="M560 236 L580 300"/><path d="M300 330 L340 290 L400 300"/></g>`,
    `<ellipse cx="330" cy="300" rx="110" ry="22" fill="#3d86bb" opacity="0.8"><animate attributeName="rx" values="110;90;110" dur="9s" repeatCount="indefinite"/><animate attributeName="ry" values="22;16;22" dur="9s" repeatCount="indefinite"/></ellipse>`,
    `<g stroke="#5b3a1e" stroke-width="4" fill="none" stroke-linecap="round"><path d="M560 200 V140 M560 165 L540 140 M560 150 L580 130 M540 140 L530 120"/></g>`,
    `<g stroke="#fff" stroke-width="1" opacity="0.4"><path d="M100 190 q20 -6 40 0 t40 0"><animate attributeName="opacity" values="0.2;0.6;0.2" dur="2.5s" repeatCount="indefinite"/></path><path d="M420 186 q20 -6 40 0 t40 0"><animate attributeName="opacity" values="0.6;0.2;0.6" dur="3s" repeatCount="indefinite"/></path></g>`,
  ),
);

/** Scenes the arc switches to (spread into the story's `scenes` at merge). */
export const powerWaterScenes: StoryInput["scenes"] = {
  pylons,
  coast,
  reactor,
  "dry-reservoir": dryReservoir,
};

function bat(delay: number, y: number): string {
  return `<g><animateTransform attributeName="transform" type="translate" values="-80 ${y};720 ${y - 40}" dur="7s" begin="${delay}s" repeatCount="indefinite"/>
<g fill="#1f1a2e"><path d="M0 0 Q-12 -14 -26 -4 Q-16 -2 -10 6 Z"><animateTransform attributeName="transform" type="scale" values="1 1;1 0.3;1 1" dur="0.35s" repeatCount="indefinite"/></path>
<path d="M0 0 Q12 -14 26 -4 Q16 -2 10 6 Z"><animateTransform attributeName="transform" type="scale" values="1 1;1 0.3;1 1" dur="0.35s" repeatCount="indefinite"/></path><circle r="4"/></g></g>`;
}

const batSprite = svgDocument(fragments(bat(0, 110), bat(0.8, 150), bat(1.7, 90)));

const surfer = svgDocument(
  fragments(
    `<g transform="translate(520 280)"><animateTransform attributeName="transform" type="translate" values="520 280;520 272;520 280" dur="2.6s" repeatCount="indefinite" additive="replace"/>
<ellipse cx="0" cy="22" rx="44" ry="8" fill="#f6e7b3" stroke="#c9a96b"/>
<line x1="0" y1="16" x2="0" y2="-18" stroke="#222" stroke-width="4"/><circle cx="0" cy="-26" r="8" fill="#222"/>
<line x1="0" y1="-6" x2="22" y2="-30" stroke="#222" stroke-width="4"/><line x1="0" y1="-6" x2="-16" y2="6" stroke="#222" stroke-width="4"/>
<g transform="translate(22 -30)"><rect x="0" y="-40" width="4" height="44" fill="#5b3a1e"/><rect x="-30" y="-62" width="64" height="26" rx="2" fill="#fff" stroke="#333"/>
<text x="2" y="-44" text-anchor="middle" font-family="ui-sans-serif, sans-serif" font-size="10" font-weight="700" fill="#c0392b">NO PLUME</text></g></g>`,
  ),
);

const ticket = svgDocument(
  fragments(
    `<g transform="translate(110 90)"><g><animateTransform attributeName="transform" type="rotate" values="-12;-6;-12" dur="4s" repeatCount="indefinite"/>
<rect x="-70" y="-32" width="140" height="64" rx="6" fill="#fdf6d8" stroke="#b8a76a" stroke-width="2" stroke-dasharray="4 3"/>
<text y="-8" text-anchor="middle" font-family="ui-monospace, monospace" font-size="10" fill="#6b6140">INTERCONNECTION QUEUE</text>
<text y="18" text-anchor="middle" font-family="ui-monospace, monospace" font-size="22" font-weight="700" fill="#3b3310">No. 1,847</text></g></g>`,
  ),
);

function wisp(x: number, delay: number): string {
  return `<path d="M${x} 250 q-10 -20 0 -40 t0 -40" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity="0">
<animate attributeName="opacity" values="0;0.7;0" dur="3.5s" begin="${delay}s" repeatCount="indefinite"/>
<animateTransform attributeName="transform" type="translate" values="0 0;0 -60" dur="3.5s" begin="${delay}s" repeatCount="indefinite"/></path>`;
}

const steam = svgDocument(fragments(wisp(420, 0), wisp(470, 1.1), wisp(520, 2.2), wisp(560, 0.6)));

function tomato(x: number, y: number, delay: number): string {
  return `<g transform="translate(${x} ${y})"><g><animateTransform attributeName="transform" type="scale" values="0;1.2;1" dur="0.7s" begin="${delay}s" fill="freeze"/>
<circle r="22" fill="#d8382a"/><circle cx="-7" cy="-8" r="6" fill="#f07a6c" opacity="0.7"/>
<path d="M-10 -18 Q0 -30 10 -18 M0 -20 V-34" stroke="#3f8f3a" stroke-width="4" fill="none" stroke-linecap="round"/></g></g>`;
}

const tomatoSprite = svgDocument(
  fragments(tomato(470, 250, 0), tomato(520, 270, 0.3), tomato(565, 240, 0.6)),
);

/** Sprite overlays the arc fires (spread into the story's `sprites` at merge). */
export const powerWaterSprites: StoryInput["sprites"] = {
  bat: batSprite,
  surfer,
  ticket,
  steam,
  tomato: tomatoSprite,
};
