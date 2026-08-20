/**
 * Art for Nortada One: self-contained SVG scenes (the centerpiece) and
 * sprites (transient overlays), served as story://datacenter/scenes/{id}
 * and story://datacenter/sprites/{id}. The "desert" scene is the Sines
 * establishing shot (the sea, the dead coal plant's two chimneys, the cold
 * seawater basin, the heath with its survey stakes); its key predates the
 * move to the coast and is kept for the resource URI. The construction
 * scene reads `--build-progress` to raise the hall.
 */

import { fragments, svgDocument } from "../../story/svg";

const SKY_COAST = `<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#7fb3d9"/><stop offset="0.55" stop-color="#cfe6f5"/><stop offset="1" stop-color="#eef6fb"/>
</linearGradient>
<linearGradient id="sand" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#c9b98a"/><stop offset="1" stop-color="#a89563"/>
</linearGradient>
<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#2b7bb0"/><stop offset="1" stop-color="#4f9fd1"/>
</linearGradient>
</defs>
<rect width="640" height="360" fill="url(#sky)"/>`;

const SUN = `<circle cx="520" cy="84" r="30" fill="#ffd37a" opacity="0.95">
<animate attributeName="r" values="30;33;30" dur="6s" repeatCount="indefinite"/>
</circle>
<circle cx="520" cy="84" r="48" fill="#ffd37a" opacity="0.18">
<animate attributeName="opacity" values="0.18;0.3;0.18" dur="6s" repeatCount="indefinite"/>
</circle>`;

/** The Atlantic along the horizon, from `top` down `height` pixels. */
function sea(top: number, height: number): string {
  const mid = top + height * 0.3;
  const low = top + height * 0.7;
  return `<rect y="${top}" width="640" height="${height}" fill="url(#sea)"/>
<g stroke="#dff2ff" stroke-width="1.5" fill="none" stroke-dasharray="14 22" opacity="0.7">
<path d="M0 ${mid} Q60 ${mid - 6} 120 ${mid} T240 ${mid} T360 ${mid} T480 ${mid} T600 ${mid} T720 ${mid}"><animate attributeName="stroke-dashoffset" from="0" to="-72" dur="4s" repeatCount="indefinite"/></path>
<path d="M0 ${low} Q60 ${low - 6} 120 ${low} T240 ${low} T360 ${low} T480 ${low} T600 ${low} T720 ${low}" opacity="0.6"><animate attributeName="stroke-dashoffset" from="0" to="-72" dur="5.5s" repeatCount="indefinite"/></path></g>`;
}

/** The dead coal plant: a grey block and two cold chimneys, red-banded, no smoke. */
function chimneys(x: number, scale: number): string {
  return `<g transform="translate(${x} 0) scale(${scale})">
<rect x="0" y="150" width="150" height="68" fill="#8a97a6"/><rect x="0" y="150" width="150" height="8" fill="#6b7885"/>
<rect x="40" y="40" width="14" height="110" fill="#b8c2cc" stroke="#8a97a6"/><rect x="40" y="40" width="14" height="8" fill="#c0392b"/>
<rect x="90" y="30" width="14" height="120" fill="#b8c2cc" stroke="#8a97a6"/><rect x="90" y="30" width="14" height="8" fill="#c0392b"/>
</g>`;
}

/** The old plant's cold seawater basin, relined, with its channel to the sea. */
const BASIN = `<path d="M610 218 L614 258" stroke="#2f6f9a" stroke-width="8" stroke-linecap="round"/>
<path d="M430 262 L620 258 L600 300 L450 304 Z" fill="#2f6f9a"/>
<rect x="426" y="258" width="198" height="4" fill="#6b7885"/>
<g stroke="#9fd0ea" stroke-width="1.2" fill="none" opacity="0.7"><path d="M455 276 Q500 270 545 276 T600 274"><animate attributeName="opacity" values="0.3;0.8;0.3" dur="3s" repeatCount="indefinite"/></path>
<path d="M462 290 Q505 284 548 290 T596 288"><animate attributeName="opacity" values="0.8;0.3;0.8" dur="3.6s" repeatCount="indefinite"/></path></g>`;

function corkOak(x: number, y: number, scale: number): string {
  return `<g transform="translate(${x} ${y}) scale(${scale})"><rect x="-3" y="-18" width="6" height="26" fill="#a0522d"/><rect x="-3" y="-18" width="6" height="12" fill="#5b3a1e"/>
<circle cx="-9" cy="-26" r="12" fill="#4f6b3a"/><circle cx="9" cy="-28" r="13" fill="#55753f"/><circle cx="0" cy="-37" r="11" fill="#4f6b3a"/></g>`;
}

function stake(x: number, delay: number): string {
  return `<g transform="translate(${x} 0)">
<rect x="-1.5" y="250" width="3" height="40" fill="#5b3a1e"/>
<polygon points="0,250 22,256 0,262" fill="#f6821f">
<animateTransform attributeName="transform" type="skewY" values="0;6;0;-4;0" dur="${2.4 + delay}s" repeatCount="indefinite"/>
</polygon></g>`;
}

const desert = svgDocument(
  fragments(
    SKY_COAST,
    SUN,
    sea(178, 40),
    chimneys(30, 1),
    `<rect y="215" width="640" height="145" fill="url(#sand)"/>`,
    `<path d="M0 238 Q160 228 320 240 T640 236" stroke="#b98a55" stroke-width="2" fill="none" opacity="0.5"/>`,
    corkOak(90, 280, 1.4),
    corkOak(560, 246, 0.9),
    BASIN,
    stake(300, 0),
    stake(345, 0.6),
    stake(390, 1.1),
    // The nortada: wind lines that never stop.
    `<g stroke="#fff" stroke-width="1" opacity="0.35"><path d="M180 205 q20 -6 40 0 t40 0"><animate attributeName="opacity" values="0.2;0.6;0.2" dur="3s" repeatCount="indefinite"/></path>
<path d="M420 208 q20 -6 40 0 t40 0"><animate attributeName="opacity" values="0.6;0.2;0.6" dur="3.6s" repeatCount="indefinite"/></path></g>`,
  ),
);

const river = svgDocument(
  fragments(
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe0f6"/><stop offset="1" stop-color="#eaf4f9"/></linearGradient>
<linearGradient id="water" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3d86bb"/><stop offset="1" stop-color="#5aa7d8"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#sky)"/>`,
    `<polygon points="0,200 120,140 260,170 380,130 520,165 640,140 640,220 0,220" fill="#7fa86a"/>`,
    `<rect y="215" width="640" height="145" fill="#9cc27c"/>`,
    `<path d="M0 300 C120 260 200 340 320 290 S520 250 640 300 L640 360 L0 360 Z" fill="url(#water)"/>`,
    `<g stroke="#dff2ff" stroke-width="2" fill="none" stroke-dasharray="18 26" opacity="0.8">
<path d="M0 312 C120 272 200 352 320 302 S520 262 640 312"><animate attributeName="stroke-dashoffset" from="0" to="-88" dur="4s" repeatCount="indefinite"/></path>
<path d="M0 330 C120 290 200 360 320 318 S520 280 640 330" opacity="0.6"><animate attributeName="stroke-dashoffset" from="0" to="-88" dur="5.5s" repeatCount="indefinite"/></path></g>`,
    `<g fill="#3f6b3a"><circle cx="80" cy="228" r="22"/><circle cx="104" cy="236" r="16"/><circle cx="560" cy="224" r="20"/><circle cx="590" cy="234" r="15"/></g>
<g fill="#5b3a1e"><rect x="77" y="246" width="6" height="20"/><rect x="557" y="240" width="6" height="22"/></g>`,
    `<g fill="#f6821f"><rect x="300" y="232" width="4" height="26"/><polygon points="304,232 324,238 304,244"><animateTransform attributeName="transform" type="skewY" values="0;5;0;-3;0" dur="2.6s" repeatCount="indefinite"/></polygon></g>`,
  ),
);

const construction = svgDocument(
  fragments(
    SKY_COAST,
    sea(192, 38),
    chimneys(520, 0.7),
    `<rect y="230" width="640" height="130" fill="url(#sand)"/>`,
    `<path d="M0 250 H640" stroke="#b98a55" stroke-width="2" opacity="0.5"/>`,
    // The hall: footprint outline, and the fill that rises with --build-progress.
    `<rect x="180" y="120" width="280" height="130" fill="none" stroke="#7d5a3a" stroke-width="2" stroke-dasharray="6 6" opacity="0.7"/>`,
    `<g class="rise"><rect x="180" y="120" width="280" height="130" fill="#6b7d8f"/>
<rect x="180" y="120" width="280" height="130" fill="none" stroke="#42505d" stroke-width="3"/>
<g fill="#2e3944"><rect x="200" y="150" width="30" height="18" rx="2"/><rect x="250" y="150" width="30" height="18" rx="2"/><rect x="300" y="150" width="30" height="18" rx="2"/><rect x="350" y="150" width="30" height="18" rx="2"/><rect x="400" y="150" width="30" height="18" rx="2"/>
<rect x="200" y="190" width="30" height="18" rx="2"/><rect x="250" y="190" width="30" height="18" rx="2"/><rect x="300" y="190" width="30" height="18" rx="2"/><rect x="350" y="190" width="30" height="18" rx="2"/><rect x="400" y="190" width="30" height="18" rx="2"/></g></g>`,
    // The crane.
    `<g transform="translate(120 250)"><rect x="-5" y="-200" width="10" height="200" fill="#f6821f"/>
<g><animateTransform attributeName="transform" type="rotate" values="-4 0 -200;4 0 -200;-4 0 -200" dur="9s" repeatCount="indefinite"/>
<rect x="-40" y="-206" width="220" height="6" fill="#d96d12"/><path d="M-5 -200 L90 -230 L180 -206" stroke="#d96d12" stroke-width="3" fill="none"/>
<line x1="150" y1="-200" x2="150" y2="-110" stroke="#444" stroke-width="2"><animate attributeName="y2" values="-110;-60;-110" dur="9s" repeatCount="indefinite"/></line>
<rect x="140" y="-110" width="20" height="14" fill="#42505d"><animate attributeName="y" values="-110;-60;-110" dur="9s" repeatCount="indefinite"/></rect></g></g>`,
    `<g fill="#8a6a4a"><rect x="500" y="238" width="90" height="8" rx="2"/><rect x="506" y="230" width="78" height="8" rx="2"/><rect x="514" y="222" width="62" height="8" rx="2"/></g>`,
    `<g stroke="#5b3a1e" stroke-width="3"><line x1="20" y1="262" x2="20" y2="300"/><line x1="60" y1="262" x2="60" y2="300"/><line x1="600" y1="262" x2="600" y2="300"/><line x1="630" y1="262" x2="630" y2="300"/></g>
<g stroke="#5b3a1e" stroke-width="1.5" opacity="0.8"><line x1="20" y1="270" x2="60" y2="270"/><line x1="20" y1="290" x2="60" y2="290"/><line x1="600" y1="270" x2="630" y2="270"/><line x1="600" y1="290" x2="630" y2="290"/></g>`,
  ),
  `.rise{transform:scaleY(var(--build-progress,0));transform-origin:320px 250px;transition:transform 1.2s ease-out}`,
);

function rack(x: number, begin: number): string {
  return `<g transform="translate(${x} 0)"><rect x="0" y="120" width="36" height="150" rx="3" fill="#1d2733" stroke="#2f3d4c"/>
<g fill="#3fd27a"><circle cx="8" cy="135" r="2"><animate attributeName="opacity" values="1;0.2;1" dur="1.3s" begin="${begin}s" repeatCount="indefinite"/></circle>
<circle cx="8" cy="160" r="2"><animate attributeName="opacity" values="0.3;1;0.3" dur="1.7s" begin="${begin + 0.4}s" repeatCount="indefinite"/></circle>
<circle cx="8" cy="185" r="2"><animate attributeName="opacity" values="1;0.1;1" dur="0.9s" begin="${begin + 0.2}s" repeatCount="indefinite"/></circle>
<circle cx="8" cy="210" r="2"><animate attributeName="opacity" values="0.5;1;0.5" dur="2.1s" begin="${begin + 0.7}s" repeatCount="indefinite"/></circle></g>
<g fill="#5aa7d8" opacity="0.8"><rect x="16" y="132" width="14" height="3"/><rect x="16" y="157" width="14" height="3"/><rect x="16" y="182" width="14" height="3"/><rect x="16" y="207" width="14" height="3"/></g></g>`;
}

const HALL_BASE = fragments(
  `<defs><linearGradient id="glow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b3a5c"/><stop offset="1" stop-color="#0b1118"/></linearGradient></defs>`,
  `<rect width="640" height="360" fill="url(#glow)"/>`,
  `<g stroke="#1f2c3a" stroke-width="1"><line x1="0" y1="300" x2="640" y2="300"/><line x1="320" y1="300" x2="60" y2="360"/><line x1="320" y1="300" x2="580" y2="360"/><line x1="320" y1="300" x2="200" y2="360"/><line x1="320" y1="300" x2="440" y2="360"/></g>`,
  `<rect y="270" width="640" height="90" fill="#0e151d"/>`,
);

const hall = svgDocument(
  fragments(
    HALL_BASE,
    rack(60, 0),
    rack(110, 0.3),
    rack(160, 0.6),
    rack(210, 0.9),
    rack(390, 0.2),
    rack(440, 0.5),
    rack(490, 0.8),
    rack(540, 1.1),
    `<rect x="0" y="0" width="640" height="60" fill="#5aa7d8" opacity="0.08"><animate attributeName="opacity" values="0.06;0.14;0.06" dur="4s" repeatCount="indefinite"/></rect>`,
    `<g stroke="#5aa7d8" stroke-width="1" opacity="0.5"><line x1="260" y1="120" x2="260" y2="270"/><line x1="380" y1="120" x2="380" y2="270"/></g>`,
  ),
);

const darkHall = svgDocument(
  fragments(
    `<rect width="640" height="360" fill="#0b0e12"/>`,
    `<rect y="270" width="640" height="90" fill="#090b0e"/>`,
    `<g fill="#151b22" stroke="#1c242d">${[60, 110, 160, 210, 390, 440, 490, 540]
      .map((x) => `<rect x="${x}" y="120" width="36" height="150" rx="3"/>`)
      .join("")}</g>`,
    `<circle cx="320" cy="60" r="6" fill="#d94d3a"><animate attributeName="opacity" values="0.1;1;0.1;0.1;0.8;0.1" dur="3.2s" repeatCount="indefinite"/></circle>
<circle cx="320" cy="60" r="40" fill="#d94d3a" opacity="0.08"><animate attributeName="opacity" values="0.02;0.12;0.02;0.02;0.1;0.02" dur="3.2s" repeatCount="indefinite"/></circle>`,
    `<g stroke="#2a3440" stroke-width="1" opacity="0.7"><line x1="0" y1="300" x2="640" y2="300"/></g>`,
  ),
);

const training = svgDocument(
  fragments(
    `<defs><linearGradient id="panel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101a26"/><stop offset="1" stop-color="#0a0f15"/></linearGradient>
<linearGradient id="curve" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f6821f"/><stop offset="1" stop-color="#3fd27a"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#panel)"/>`,
    `<g stroke="#1f2c3a" stroke-width="1">${[80, 130, 180, 230, 280]
      .map((y) => `<line x1="70" y1="${y}" x2="600" y2="${y}"/>`)
      .join("")}${[170, 270, 370, 470, 570]
      .map((x) => `<line x1="${x}" y1="50" x2="${x}" y2="300"/>`)
      .join("")}</g>`,
    `<g stroke="#44566b" stroke-width="2"><line x1="70" y1="50" x2="70" y2="300"/><line x1="70" y1="300" x2="600" y2="300"/></g>`,
    `<path d="M70 70 C140 100 170 210 250 230 S420 260 600 272" fill="none" stroke="url(#curve)" stroke-width="4" stroke-linecap="round" stroke-dasharray="760" stroke-dashoffset="760">
<animate attributeName="stroke-dashoffset" from="760" to="0" dur="8s" fill="freeze"/>
<animate attributeName="stroke-dashoffset" values="760;0" dur="8s" begin="9s" repeatCount="indefinite"/></path>`,
    `<circle cx="600" cy="272" r="5" fill="#3fd27a"><animate attributeName="r" values="4;7;4" dur="1.4s" repeatCount="indefinite"/></circle>`,
    `<text x="80" y="40" font-family="ui-monospace, monospace" font-size="13" fill="#8aa0b8">loss</text>
<text x="560" y="322" font-family="ui-monospace, monospace" font-size="13" fill="#8aa0b8">steps</text>`,
  ),
);

export const scenes = {
  desert,
  river,
  construction,
  hall,
  "dark-hall": darkHall,
  training,
};

const storm = svgDocument(
  fragments(
    `<rect width="640" height="360" fill="#1d1f33" opacity="0.35"><animate attributeName="opacity" values="0.25;0.45;0.25" dur="3s" repeatCount="indefinite"/></rect>`,
    `<g fill="#3b3f5c" opacity="0.9"><ellipse cx="140" cy="50" rx="120" ry="36"/><ellipse cx="330" cy="40" rx="150" ry="42"/><ellipse cx="520" cy="56" rx="130" ry="38"/></g>`,
    `<polyline points="330,70 310,130 340,126 300,200" fill="none" stroke="#fff4a8" stroke-width="4" stroke-linejoin="round" opacity="0">
<animate attributeName="opacity" values="0;1;0;0;0;1;0;0" dur="2.6s" repeatCount="indefinite"/></polyline>`,
    `<rect width="640" height="360" fill="#fff4a8" opacity="0"><animate attributeName="opacity" values="0;0.25;0;0;0;0.18;0;0" dur="2.6s" repeatCount="indefinite"/></rect>`,
  ),
);

const owl = svgDocument(
  fragments(
    `<g transform="translate(500 220)">
<ellipse cx="0" cy="50" rx="44" ry="56" fill="#5b4632"/><circle cx="0" cy="0" r="40" fill="#6d563d"/>
<circle cx="-15" cy="-4" r="13" fill="#f7e7b3"/><circle cx="15" cy="-4" r="13" fill="#f7e7b3"/>
<g fill="#1a1a1a"><circle cx="-15" cy="-4" r="6"><animate attributeName="r" values="6;6;1;6;6" dur="4s" repeatCount="indefinite"/></circle>
<circle cx="15" cy="-4" r="6"><animate attributeName="r" values="6;6;1;6;6" dur="4s" repeatCount="indefinite"/></circle></g>
<polygon points="0,6 -6,16 6,16" fill="#f6a21f"/>
<polygon points="-38,-20 -28,-40 -18,-22" fill="#6d563d"/><polygon points="38,-20 28,-40 18,-22" fill="#6d563d"/>
<g fill="#4a3826"><ellipse cx="-30" cy="56" rx="12" ry="30"/><ellipse cx="30" cy="56" rx="12" ry="30"/></g>
<animateTransform attributeName="transform" type="translate" values="500 220;500 216;500 220" dur="3s" repeatCount="indefinite" additive="replace"/></g>`,
  ),
);

const tortoise = svgDocument(
  fragments(
    `<g><animateTransform attributeName="transform" type="translate" from="-120 0" to="720 0" dur="14s" repeatCount="indefinite"/>
<g transform="translate(0 300)"><ellipse cx="0" cy="0" rx="46" ry="26" fill="#6b7f3a"/><path d="M-30 -8 Q0 -30 30 -8" fill="none" stroke="#4e5f2a" stroke-width="3"/>
<line x1="-12" y1="-16" x2="-12" y2="18" stroke="#4e5f2a" stroke-width="3"/><line x1="12" y1="-16" x2="12" y2="18" stroke="#4e5f2a" stroke-width="3"/>
<circle cx="50" cy="4" r="10" fill="#8a9c4e"/><circle cx="54" cy="1" r="2" fill="#222"/>
<g fill="#8a9c4e"><rect x="-36" y="18" width="12" height="10" rx="3"><animateTransform attributeName="transform" type="rotate" values="-12 -30 18;12 -30 18;-12 -30 18" dur="1.4s" repeatCount="indefinite"/></rect>
<rect x="22" y="18" width="12" height="10" rx="3"><animateTransform attributeName="transform" type="rotate" values="12 28 18;-12 28 18;12 28 18" dur="1.4s" repeatCount="indefinite"/></rect></g></g></g>`,
  ),
);

const truck = svgDocument(
  fragments(
    `<g><animateTransform attributeName="transform" type="translate" from="-220 0" to="760 0" dur="6s" repeatCount="indefinite"/>
<g transform="translate(0 286)"><rect x="0" y="-40" width="130" height="40" fill="#42505d"/><rect x="8" y="-34" width="114" height="28" fill="#5aa7d8" opacity="0.9"/>
<rect x="130" y="-30" width="50" height="30" rx="4" fill="#f6821f"/><rect x="150" y="-26" width="22" height="14" rx="2" fill="#cfe6f5"/>
<g fill="#1a1a1a"><circle cx="30" cy="4" r="10"/><circle cx="100" cy="4" r="10"/><circle cx="160" cy="4" r="10"/></g>
<g fill="#888"><circle cx="30" cy="4" r="4"/><circle cx="100" cy="4" r="4"/><circle cx="160" cy="4" r="4"/></g></g>
<g fill="#d9c4a0" opacity="0.6"><circle cx="-10" cy="290" r="8"><animate attributeName="r" values="4;12;4" dur="1s" repeatCount="indefinite"/></circle></g></g>`,
  ),
);

function placard(x: number, delay: number, color: string): string {
  return `<g transform="translate(${x} 0)"><rect x="-2" y="250" width="4" height="70" fill="#5b3a1e"/>
<rect x="-26" y="220" width="52" height="34" rx="3" fill="${color}"/><line x1="-16" y1="232" x2="16" y2="232" stroke="#222" stroke-width="3"/><line x1="-16" y1="242" x2="8" y2="242" stroke="#222" stroke-width="3"/>
<animateTransform attributeName="transform" type="translate" values="${x} 0;${x} -8;${x} 0" dur="1.6s" begin="${delay}s" repeatCount="indefinite"/></g>`;
}

const protest = svgDocument(
  fragments(
    placard(60, 0, "#f3d35b"),
    placard(120, 0.4, "#ffffff"),
    placard(180, 0.8, "#f3a35b"),
    `<g fill="#3a3a3a"><circle cx="60" cy="330" r="14"/><circle cx="120" cy="334" r="14"/><circle cx="180" cy="330" r="14"/></g>`,
  ),
);

const stamp = svgDocument(
  fragments(
    `<g transform="translate(520 90)"><g>
<animateTransform attributeName="transform" type="scale" values="0;1.25;1" dur="0.6s" fill="freeze"/>
<circle r="56" fill="none" stroke="#2a9d5c" stroke-width="6"/><circle r="44" fill="none" stroke="#2a9d5c" stroke-width="2"/>
<path d="M-24 2 L-8 18 L26 -18" fill="none" stroke="#2a9d5c" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
<text y="70" text-anchor="middle" font-family="ui-monospace, monospace" font-size="12" font-weight="700" fill="#2a9d5c">APPROVED</text></g></g>`,
  ),
);

export const sprites = {
  storm,
  owl,
  tortoise,
  truck,
  protest,
  stamp,
};
