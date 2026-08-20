/**
 * Art for the Odyssey: self-contained SVG scenes (the centerpiece, 640x360)
 * and sprites (transient overlays), served as story://odyssey/scenes/{id}
 * and story://odyssey/sprites/{id}. The boat scene reads `--build-progress`
 * to move the ship along the voyage.
 */

import { fragments, svgDocument } from "../../story/svg";

/** Sky and sea gradients, ids prefixed per scene so inlined documents never clash. */
function seaDefs(tag: string): string {
  return (
    `<defs><linearGradient id="${tag}-sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#4f9bd6"/><stop offset="0.62" stop-color="#c9e3f4"/><stop offset="1" stop-color="#f4e4c4"/></linearGradient>` +
    `<linearGradient id="${tag}-sea" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#2b7db5"/><stop offset="1" stop-color="#0f3556"/></linearGradient></defs>`
  );
}

/** One horizontally repeating wave band (period 160px) rolling left on SMIL. */
function wave(y: number, fill: string, dur: number, opacity: number): string {
  const segment = "q20 -9 40 0 t40 0 t40 0 t40 0";
  const d = `M-320 ${y} ${segment} ${segment} ${segment} ${segment} ${segment} ${segment} ${segment} V360 H-320 Z`;
  return (
    `<path d="${d}" fill="${fill}" opacity="${opacity}">` +
    `<animateTransform attributeName="transform" type="translate" from="0 0" to="-160 0" dur="${dur}s" repeatCount="indefinite"/></path>`
  );
}

/** A flickering flame (brazier, hearth, camp fire) centred on (x, y). */
function flame(x: number, y: number, scale = 1, dur = 1): string {
  return (
    `<g transform="translate(${x} ${y}) scale(${scale})">` +
    `<ellipse cx="0" cy="0" rx="10" ry="18" fill="#ff9a3c"><animate attributeName="ry" values="18;24;16;22;18" dur="${dur}s" repeatCount="indefinite"/></ellipse>` +
    `<ellipse cx="0" cy="4" rx="5" ry="10" fill="#ffe08a"><animate attributeName="ry" values="10;14;8;12;10" dur="${dur * 0.8}s" repeatCount="indefinite"/></ellipse>` +
    `<circle cx="0" cy="0" r="70" fill="#ff9a3c" opacity="0.08"><animate attributeName="opacity" values="0.05;0.12;0.05" dur="${dur}s" repeatCount="indefinite"/></circle></g>`
  );
}

/**
 * The black ship, in local coordinates: waterline at y=0, bow at x=0, stern
 * post at x≈170. Sail bellies and oars stroke on SMIL.
 */
const SHIP_BODY = fragments(
  `<path d="M-6 -40 L4 -16 L146 -16 L170 -44 L158 -8 Q146 12 116 14 L34 14 Q6 10 -2 -12 Z" fill="#6a4120"/>`,
  `<path d="M4 -16 L146 -16" stroke="#3b2411" stroke-width="3"/>`,
  `<circle cx="18" cy="-25" r="3.5" fill="#f4ead2"/><circle cx="19" cy="-25" r="1.6" fill="#111"/>`,
  `<rect x="78" y="-112" width="5" height="96" fill="#3b2411"/>`,
  `<line x1="46" y1="-100" x2="116" y2="-100" stroke="#3b2411" stroke-width="3"/>`,
  `<path d="M50 -98 L112 -98 Q128 -64 112 -32 L50 -32 Q66 -64 50 -98 Z" fill="#f1e6cf" stroke="#d9c7a0">` +
    `<animate attributeName="d" values="M50 -98 L112 -98 Q128 -64 112 -32 L50 -32 Q66 -64 50 -98 Z;M50 -98 L112 -98 Q136 -64 112 -32 L50 -32 Q72 -64 50 -98 Z;M50 -98 L112 -98 Q128 -64 112 -32 L50 -32 Q66 -64 50 -98 Z" dur="3s" repeatCount="indefinite"/></path>`,
  `<path d="M158 -8 L172 14" stroke="#3b2411" stroke-width="4" stroke-linecap="round"/>`,
  `<g stroke="#3b2411" stroke-width="2.5">${[36, 60, 84, 108, 132]
    .map(
      (x, i) =>
        `<line x1="${x}" y1="-10" x2="${x - 12}" y2="20"><animateTransform attributeName="transform" type="rotate" values="-9 ${x} -10;9 ${x} -10;-9 ${x} -10" dur="2.2s" begin="${i * 0.08}s" repeatCount="indefinite"/></line>`,
    )
    .join("")}</g>`,
  `<g fill="#e0b98a">${[42, 64, 92, 114, 136].map((x) => `<circle cx="${x}" cy="-21" r="4"/>`).join("")}</g>`,
);

/** The ship bobbing and rolling at (x, y) with the given scale. */
function ship(x: number, y: number, scale: number, className = ""): string {
  const cls = className === "" ? "" : ` class="${className}"`;
  return (
    `<g${cls}><g transform="translate(${x} ${y}) scale(${scale})">` +
    `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0;0 4;0 0" dur="4s" repeatCount="indefinite"/>` +
    `<g><animateTransform attributeName="transform" type="rotate" values="-2 80 0;2 80 0;-2 80 0" dur="5s" repeatCount="indefinite"/>` +
    `${SHIP_BODY}</g></g></g></g>`
  );
}

/** A gull crossing the sky. */
function gull(x: number, y: number, dur: number, begin: number): string {
  return (
    `<path d="M${x} ${y} q6 -7 12 0 q6 -7 12 0" stroke="#ffffff" stroke-width="2" fill="none" opacity="0.8">` +
    `<animateTransform attributeName="transform" type="translate" values="0 0;-60 -8;-120 0" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>` +
    `<animate attributeName="opacity" values="0;0.8;0" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></path>`
  );
}

const SCENE_BOAT = svgDocument(
  fragments(
    seaDefs("boat"),
    `<rect width="640" height="360" fill="url(#boat-sky)"/>`,
    `<circle cx="548" cy="72" r="26" fill="#ffe08a"/><circle cx="548" cy="72" r="46" fill="#ffe08a" opacity="0.22"><animate attributeName="r" values="42;52;42" dur="7s" repeatCount="indefinite"/></circle>`,
    `<polygon points="0,216 60,196 120,208 180,190 240,212 0,212" fill="#8ea3b8" opacity="0.45"/><polygon points="420,214 470,198 520,206 580,192 640,210 640,214" fill="#8ea3b8" opacity="0.35"/>`,
    gull(300, 120, 14, 0),
    gull(460, 90, 18, 5),
    `<rect y="212" width="640" height="148" fill="url(#boat-sea)"/>`,
    wave(222, "#3f93c9", 7, 0.9),
    ship(60, 248, 0.95, "voyage"),
    wave(266, "#2a7fb8", 5, 0.9),
    wave(306, "#1e6394", 4, 0.95),
    `<g fill="#fff" opacity="0.7"><circle cx="380" cy="240" r="1.5"><animate attributeName="opacity" values="0;1;0" dur="2.2s" repeatCount="indefinite"/></circle><circle cx="470" cy="256" r="1.5"><animate attributeName="opacity" values="0;1;0" dur="2.8s" begin="1s" repeatCount="indefinite"/></circle><circle cx="250" cy="292" r="1.5"><animate attributeName="opacity" values="0;1;0" dur="3.1s" begin="0.4s" repeatCount="indefinite"/></circle></g>`,
  ),
  `.voyage{transform:translateX(calc(var(--build-progress,0) * 330px));transition:transform 2s ease-in-out}`,
);

const SCENE_SHORE = svgDocument(
  fragments(
    seaDefs("shore"),
    `<rect width="640" height="360" fill="url(#shore-sky)"/>`,
    `<circle cx="110" cy="80" r="22" fill="#ffe08a" opacity="0.9"/>`,
    `<rect y="214" width="640" height="146" fill="url(#shore-sea)"/>`,
    wave(226, "#3f93c9", 6, 0.9),
    `<path d="M0 360 L0 284 Q120 244 260 274 T640 252 L640 360 Z" fill="#e8d3a3"/>`,
    `<path d="M0 304 Q120 266 260 296 T640 276" stroke="#fff" stroke-width="3" fill="none" opacity="0.6"><animate attributeName="opacity" values="0.3;0.8;0.3" dur="3s" repeatCount="indefinite"/></path>`,
    `<g fill="#5b3a1e"><rect x="76" y="150" width="9" height="134"/><rect x="562" y="176" width="8" height="104"/></g>`,
    `<g fill="#55783a"><ellipse cx="82" cy="146" rx="50" ry="24"/><ellipse cx="66" cy="128" rx="32" ry="18"/><ellipse cx="100" cy="128" rx="26" ry="14"/><ellipse cx="566" cy="172" rx="40" ry="20"/><ellipse cx="554" cy="156" rx="24" ry="14"/></g>`,
    `<g transform="translate(330 262) scale(0.5) rotate(-6)">${SHIP_BODY}</g>`,
    flame(150, 318, 0.6, 1.1),
    `<g fill="#6a4120"><rect x="134" y="326" width="36" height="5" rx="2"/><rect x="140" y="330" width="26" height="4" rx="2"/></g>`,
  ),
);

const SCENE_CAVE = svgDocument(
  fragments(
    `<rect width="640" height="360" fill="#120e0c"/>`,
    `<path d="M0 0 H640 V360 H0 Z M150 360 Q160 130 320 100 Q480 130 490 360 Z" fill="#2c2320" fill-rule="evenodd"/>`,
    `<ellipse cx="320" cy="360" rx="170" ry="40" fill="#1b1412"/>`,
    `<g fill="#4a3c34"><rect x="190" y="190" width="120" height="6"/><rect x="190" y="230" width="120" height="6"/></g>`,
    `<g fill="#e8d3a3" opacity="0.9">${[200, 236, 272].map((x) => `<ellipse cx="${x + 12}" cy="185" rx="13" ry="8"/><ellipse cx="${x + 12}" cy="225" rx="13" ry="8"/>`).join("")}</g>`,
    `<g fill="#f3ead8" opacity="0.92">${[
      [250, 300],
      [290, 312],
      [340, 306],
    ]
      .map(
        ([x, y]) =>
          `<ellipse cx="${x}" cy="${y}" rx="22" ry="13"/><circle cx="${Number(x) + 20}" cy="${Number(y) - 6}" r="7"/>`,
      )
      .join("")}</g>`,
    flame(420, 250, 1, 1.1),
    `<circle cx="530" cy="330" r="74" fill="#3b3431"/><circle cx="530" cy="330" r="74" fill="none" stroke="#52473f" stroke-width="2"/>`,
    `<g stroke="#8a6a4a" stroke-width="6" stroke-linecap="round"><line x1="200" y1="200" x2="180" y2="330"/></g><circle cx="200" cy="196" r="7" fill="#ff5a2a"><animate attributeName="opacity" values="0.6;1;0.6" dur="0.7s" repeatCount="indefinite"/></circle>`,
  ),
);

const SCENE_AEOLIA = svgDocument(
  fragments(
    `<defs><linearGradient id="aeolia-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d7fc4"/><stop offset="1" stop-color="#bcdcf2"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#aeolia-sky)"/>`,
    `<g fill="#ffffff" opacity="0.85">${[
      [40, 60, 1],
      [300, 40, 0.8],
      [520, 90, 1.1],
      [160, 300, 0.9],
      [470, 320, 1.2],
    ]
      .map(
        ([x, y, s]) =>
          `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="60" ry="18"/><ellipse cx="-30" cy="-10" rx="30" ry="16"/><ellipse cx="26" cy="-12" rx="36" ry="20"/><animateTransform attributeName="transform" type="translate" values="${x} ${y};${Number(x) + 24} ${y};${x} ${y}" dur="${12 + Number(s) * 4}s" repeatCount="indefinite" additive="sum"/></g>`,
      )
      .join("")}</g>`,
    `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -8;0 0" dur="6s" repeatCount="indefinite"/>` +
      `<path d="M160 200 Q200 290 320 300 Q440 290 480 200 Z" fill="#5a4738"/>` +
      `<path d="M150 200 H490 V180 H150 Z" fill="#c98a3c"/><path d="M150 180 H490 V172 H150 Z" fill="#e0b23a"/>` +
      `<g fill="#c98a3c">${[150, 200, 250, 300, 350, 400, 450].map((x) => `<rect x="${x}" y="160" width="16" height="14"/>`).join("")}</g>` +
      `<path d="M200 170 V120 H440 V170 Z" fill="#f1e6cf"/><path d="M190 120 L320 80 L450 120 Z" fill="#d8cbb5"/>` +
      `<g fill="#8a6a4a">${[220, 260, 300, 340, 380, 420].map((x) => `<rect x="${x}" y="128" width="10" height="42"/>`).join("")}</g>` +
      `<rect x="310" y="140" width="20" height="30" fill="#3b2411"/></g>`,
    `<g stroke="#e8f4ff" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.8">${[110, 250, 340].map((y, i) => `<path d="M-200 ${y} q40 -16 80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0"><animateTransform attributeName="transform" type="translate" from="0 0" to="160 0" dur="${2 + i * 0.5}s" repeatCount="indefinite"/></path>`).join("")}</g>`,
  ),
);

const SCENE_HARBOR = svgDocument(
  fragments(
    `<defs><linearGradient id="harbor-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a8ea3"/><stop offset="1" stop-color="#cfd9e2"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#harbor-sky)"/>`,
    `<ellipse cx="320" cy="300" rx="300" ry="70" fill="#0b2238"/>`,
    `<polygon points="0,0 240,0 200,110 160,170 120,240 60,300 0,360" fill="#2e2f36"/><polygon points="640,0 420,0 450,100 500,170 540,240 590,300 640,360" fill="#292a31"/>`,
    `<polygon points="0,0 120,0 90,140 40,230 0,300" fill="#3a3b44"/><polygon points="640,0 540,0 570,140 600,230 640,300" fill="#36373f"/>`,
    `<g fill="#1b1c22">${[
      [150, 150, 1],
      [520, 130, 1.2],
      [70, 260, 0.9],
    ]
      .map(
        ([x, y, s]) =>
          `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-8" y="-40" width="16" height="44" rx="6"/><circle cx="0" cy="-46" r="9"/><rect x="-22" y="-36" width="10" height="24" rx="4"><animateTransform attributeName="transform" type="rotate" values="0 -18 -36;-50 -18 -36;0 -18 -36" dur="2.4s" repeatCount="indefinite"/></rect></g>`,
      )
      .join("")}</g>`,
    `<g fill="#3b2411">${[260, 300, 340, 380, 300, 350].map((x, i) => `<g><path d="M${x - 14} ${286 + (i % 2) * 10} h28 l-4 6 h-20 z"/><rect x="${x - 1}" y="${270 + (i % 2) * 10}" width="2" height="16"/></g>`).join("")}</g>`,
    `<g fill="#4a4b55">${[
      [180, 0],
      [430, 1.1],
      [330, 2],
    ]
      .map(
        ([x, begin]) =>
          `<circle cx="${x}" cy="40" r="16"><animate attributeName="cy" values="40;290" dur="1.6s" begin="${begin}s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;1;0" dur="1.6s" begin="${begin}s" repeatCount="indefinite"/></circle>` +
          `<circle cx="${x}" cy="292" r="4" fill="#dff2ff" opacity="0"><animate attributeName="r" values="4;40" dur="1s" begin="${Number(begin) + 1.5}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.8;0" dur="1s" begin="${Number(begin) + 1.5}s" repeatCount="indefinite"/></circle>`,
      )
      .join("")}</g>`,
  ),
);

const SCENE_HALL = svgDocument(
  fragments(
    `<defs><linearGradient id="hall-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b2a4a"/><stop offset="1" stop-color="#1c1424"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#hall-wall)"/>`,
    `<rect y="290" width="640" height="70" fill="#2a1f33"/><g stroke="#3f3050" stroke-width="1"><line x1="0" y1="312" x2="640" y2="312"/><line x1="0" y1="336" x2="640" y2="336"/></g>`,
    `<g fill="#d8cbb5">${[70, 190, 450, 570].map((x) => `<rect x="${x}" y="60" width="26" height="230"/><rect x="${x - 8}" y="52" width="42" height="12"/><rect x="${x - 8}" y="286" width="42" height="10"/>`).join("")}</g>`,
    `<g><rect x="250" y="90" width="140" height="6" fill="#8a6a4a"/><rect x="252" y="96" width="4" height="120" fill="#8a6a4a"/><rect x="384" y="96" width="4" height="120" fill="#8a6a4a"/>` +
      `<g stroke="#e8d3a3" stroke-width="1" opacity="0.8">${[262, 274, 286, 298, 310, 322, 334, 346, 358, 370].map((x) => `<line x1="${x}" y1="96" x2="${x}" y2="210"/>`).join("")}</g>` +
      `<rect x="258" y="150" width="124" height="8" fill="#c1446b"><animate attributeName="y" values="150;196;150" dur="6s" repeatCount="indefinite"/></rect></g>`,
    `<g fill="#8a6a4a"><rect x="440" y="236" width="110" height="12" rx="3"/><rect x="450" y="248" width="8" height="42"/><rect x="532" y="248" width="8" height="42"/></g>` +
      `<g><path d="M488 232 L504 232 L500 214 L492 214 Z" fill="#e0b23a"/><ellipse cx="496" cy="214" rx="5" ry="2" fill="#c1446b"><animate attributeName="opacity" values="0.7;1;0.7" dur="2s" repeatCount="indefinite"/></ellipse></g>`,
    `<g fill="#6b5a4a"><ellipse cx="130" cy="282" rx="40" ry="14"/><circle cx="166" cy="270" r="11"/><path d="M160 262 l4 -10 l4 10 z M168 262 l4 -10 l4 10 z"/><ellipse cx="130" cy="282" rx="40" ry="14"><animate attributeName="ry" values="14;15;14" dur="3s" repeatCount="indefinite"/></ellipse></g>`,
    `<g fill="#a8884a"><ellipse cx="360" cy="280" rx="44" ry="15"/><circle cx="400" cy="266" r="13"/><circle cx="400" cy="266" r="20" fill="#8a6a2a" opacity="0.6"/></g>`,
    flame(40, 150, 0.8, 0.9),
    flame(600, 150, 0.8, 1.05),
  ),
);

const SCENE_UNDERWORLD = svgDocument(
  fragments(
    `<defs><linearGradient id="under-mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2f36"/><stop offset="1" stop-color="#0d0f12"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#under-mist)"/>`,
    `<path d="M0 250 Q160 230 320 250 T640 244 V360 H0 Z" fill="#15171c"/>`,
    `<ellipse cx="320" cy="330" rx="120" ry="22" fill="#5a1a1a"/><ellipse cx="320" cy="330" rx="120" ry="22" fill="none" stroke="#7a2a2a" stroke-width="2"><animate attributeName="rx" values="118;124;118" dur="4s" repeatCount="indefinite"/></ellipse>`,
    `${[
      [70, 0, 9],
      [170, 2, 12],
      [470, 1, 10],
      [570, 3, 11],
      [250, 4, 13],
      [400, 1.5, 14],
    ]
      .map(
        ([x, begin, dur]) =>
          `<g opacity="0.35"><path d="M${x} 300 Q${Number(x) - 20} 240 ${x} 180 Q${Number(x) + 20} 240 ${x} 300 Z" fill="#9aa3ad"/><circle cx="${x}" cy="176" r="12" fill="#9aa3ad"/>` +
          `<animateTransform attributeName="transform" type="translate" values="0 0;0 -14;0 0" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.2;0.5;0.2" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></g>`,
      )
      .join("")}`,
    `<g fill="#c9ced4" opacity="0.9"><path d="M320 300 Q300 240 320 180 Q340 240 320 300 Z"/><circle cx="320" cy="176" r="12"/></g>`,
    `<g stroke="#6b5a4a" stroke-width="4" stroke-linecap="round"><line x1="300" y1="300" x2="300" y2="220"/></g>`,
    `<rect width="640" height="360" fill="#9aa3ad" opacity="0.06"><animate attributeName="opacity" values="0.03;0.1;0.03" dur="6s" repeatCount="indefinite"/></rect>`,
  ),
);

const SCENE_STRAIT = svgDocument(
  fragments(
    seaDefs("strait"),
    `<rect width="640" height="360" fill="#4a6f8f"/>`,
    `<rect y="200" width="640" height="160" fill="url(#strait-sea)"/>`,
    wave(212, "#3f93c9", 6, 0.8),
    `<polygon points="0,0 180,0 160,90 200,180 140,360 0,360" fill="#3a3a44"/><polygon points="640,0 460,0 490,100 440,200 510,360 640,360" fill="#33333d"/>`,
    `<ellipse cx="120" cy="120" rx="34" ry="26" fill="#15151a"/>`,
    `<g transform="translate(460 290)"><g><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="6s" repeatCount="indefinite"/>` +
      `<path d="M0 0 m0 -4 a4 4 0 1 1 0 8 a8 8 0 1 1 0 -16 a14 14 0 1 1 0 28 a22 22 0 1 1 0 -44 a32 32 0 1 1 0 64 a44 44 0 1 1 0 -88" fill="none" stroke="#dff2ff" stroke-width="3" opacity="0.8"/></g>` +
      `<ellipse cx="0" cy="0" rx="54" ry="18" fill="#0b2a44" opacity="0.5"/></g>`,
    `<g><rect x="488" y="150" width="8" height="60" fill="#5b3a1e"/><ellipse cx="492" cy="146" rx="40" ry="22" fill="#3f6b2f"><animate attributeName="rx" values="40;43;40" dur="3s" repeatCount="indefinite"/></ellipse></g>`,
    `<g transform="translate(250 212) scale(0.5)">${SHIP_BODY}</g>`,
    `<g fill="#fff" opacity="0.6">${[300, 360, 420].map((x, i) => `<circle cx="${x}" cy="230" r="2"><animate attributeName="opacity" values="0;0.9;0" dur="${1.4 + i * 0.3}s" repeatCount="indefinite"/></circle>`).join("")}</g>`,
  ),
);

const SCENE_MEADOW = svgDocument(
  fragments(
    `<defs><linearGradient id="meadow-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd98a"/><stop offset="1" stop-color="#fff2cf"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#meadow-gold)"/>`,
    `<circle cx="320" cy="110" r="54" fill="#ffb347"><animate attributeName="r" values="54;58;54" dur="5s" repeatCount="indefinite"/></circle><circle cx="320" cy="110" r="90" fill="#ffb347" opacity="0.25"><animate attributeName="r" values="86;98;86" dur="5s" repeatCount="indefinite"/></circle>`,
    `<path d="M0 230 Q160 200 320 228 T640 224 V360 H0 Z" fill="#9cbf5a"/><path d="M0 270 Q200 250 400 272 T640 262 V360 H0 Z" fill="#7ea94a"/>`,
    `${[
      [120, 280, 1],
      [240, 300, 0.9],
      [420, 292, 1.1],
      [540, 306, 0.95],
      [330, 250, 0.6],
    ]
      .map(
        ([x, y, s]) =>
          `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="34" ry="18" fill="#f3ead8"/><circle cx="34" cy="-8" r="11" fill="#f3ead8"/><path d="M40 -18 q4 -10 10 -6 M30 -18 q-4 -10 -10 -6" stroke="#d9c7a0" stroke-width="3" fill="none"/>` +
          `<g fill="#d9c7a0"><rect x="-26" y="14" width="6" height="16"/><rect x="-8" y="14" width="6" height="16"/><rect x="10" y="14" width="6" height="16"/><rect x="24" y="14" width="6" height="16"/></g>` +
          `<animateTransform attributeName="transform" type="translate" values="${x} ${y};${x} ${Number(y) - 2};${x} ${y}" dur="3s" repeatCount="indefinite" additive="sum"/></g>`,
      )
      .join("")}`,
  ),
);

const SCENE_GROTTO = svgDocument(
  fragments(
    seaDefs("grotto"),
    `<rect width="640" height="360" fill="url(#grotto-sky)"/>`,
    `<rect y="220" width="640" height="140" fill="url(#grotto-sea)"/>`,
    wave(232, "#3f93c9", 6, 0.9),
    `<path d="M0 0 H640 V360 H0 Z M120 360 Q60 200 200 90 Q320 40 460 100 Q580 200 520 360 Z" fill="#2f2a36" fill-rule="evenodd"/>`,
    `<g stroke="#4f8a3a" stroke-width="6" stroke-linecap="round" fill="none">${[180, 230, 300, 380, 440].map((x, i) => `<path d="M${x} 60 q10 40 -6 80"><animate attributeName="d" values="M${x} 60 q10 40 -6 80;M${x} 60 q14 44 -2 84;M${x} 60 q10 40 -6 80" dur="${3 + i * 0.4}s" repeatCount="indefinite"/></path>`).join("")}</g>`,
    `<g stroke="#7fc4ff" stroke-width="3" fill="none" opacity="0.8">${[150, 500].map((x, i) => `<path d="M${x} 200 q6 40 -4 80 q-4 30 8 60"><animate attributeName="opacity" values="0.5;0.9;0.5" dur="${2 + i}s" repeatCount="indefinite"/></path>`).join("")}</g>`,
    `<g fill="#6b4423"><rect x="260" y="300" width="120" height="10"/><rect x="268" y="290" width="104" height="10"/><rect x="276" y="280" width="88" height="10"/></g>`,
    flame(180, 300, 0.9, 1),
  ),
);

const SCENE_COURT = svgDocument(
  fragments(
    `<defs><linearGradient id="court-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1e3c3"/><stop offset="1" stop-color="#c9a874"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#court-wall)"/>`,
    `<rect y="286" width="640" height="74" fill="#9a7a4a"/><g stroke="#7a5a30" stroke-width="1"><line x1="0" y1="308" x2="640" y2="308"/><line x1="0" y1="334" x2="640" y2="334"/></g>`,
    `<g fill="#fff8ea">${[60, 180, 460, 580].map((x) => `<rect x="${x}" y="50" width="28" height="236"/><rect x="${x - 8}" y="42" width="44" height="12"/><rect x="${x - 8}" y="282" width="44" height="10"/>`).join("")}</g>`,
    `<g fill="#b8863a"><rect x="230" y="228" width="180" height="12" rx="3"/><rect x="242" y="240" width="8" height="46"/><rect x="390" y="240" width="8" height="46"/></g>`,
    `<g fill="#e0b23a">${[260, 300, 340, 380].map((x) => `<path d="M${x} 226 l14 0 l-3 -14 l-8 0 z"/>`).join("")}</g>`,
    `<g transform="translate(320 120)"><path d="M-30 40 Q-44 0 -20 -40 M30 40 Q44 0 20 -40" stroke="#c98a3c" stroke-width="6" fill="none" stroke-linecap="round"/><line x1="-22" y1="-36" x2="22" y2="-36" stroke="#c98a3c" stroke-width="6"/>` +
      `<g stroke="#f4ead2" stroke-width="1.5">${[-16, -8, 0, 8, 16].map((x, i) => `<line x1="${x}" y1="-34" x2="${x * 0.6}" y2="36"><animate attributeName="opacity" values="1;0.4;1" dur="${0.6 + i * 0.15}s" repeatCount="indefinite"/></line>`).join("")}</g></g>`,
    `<g><rect x="540" y="216" width="60" height="70" rx="4" fill="#8a6a4a"/><rect x="548" y="176" width="44" height="44" rx="4" fill="#8a6a4a"/><rect x="556" y="182" width="28" height="32" fill="#2a7fb8" opacity="0.9"/></g>`,
    flame(110, 150, 0.7, 0.9),
    flame(530, 150, 0.7, 1.05),
  ),
);

const SCENE_PALACE = svgDocument(
  fragments(
    `<defs><linearGradient id="palace-stone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6d5b4a"/><stop offset="1" stop-color="#2f2620"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#palace-stone)"/>`,
    `<rect y="280" width="640" height="80" fill="#3d3128"/>`,
    `<g fill="#d8cbb5" opacity="0.9">${[50, 590].map((x) => `<rect x="${x - 13}" y="60" width="26" height="220"/>`).join("")}</g>`,
    `<g stroke="#8a8a8a" stroke-width="4">${[150, 186, 222, 258, 294, 330, 366, 402, 438, 474, 510, 546].map((x) => `<line x1="${x}" y1="206" x2="${x}" y2="280"/>`).join("")}</g>` +
      `<g fill="#b8b8b8">${[150, 186, 222, 258, 294, 330, 366, 402, 438, 474, 510, 546].map((x) => `<path d="M${x - 10} 202 q10 -16 20 0 q-10 6 -20 0 z"/>`).join("")}</g>`,
    `<g transform="translate(320 110)"><path d="M-70 0 Q0 -46 70 0" stroke="#c98a3c" stroke-width="6" fill="none"/><line x1="-70" y1="0" x2="70" y2="0" stroke="#f4ead2" stroke-width="2"><animate attributeName="y1" values="0;-6;0" dur="2s" repeatCount="indefinite"/><animate attributeName="y2" values="0;-6;0" dur="2s" repeatCount="indefinite"/></line></g>`,
    `<g><rect x="70" y="210" width="60" height="70" rx="4" fill="#8a6a4a"/><rect x="78" y="170" width="44" height="44" rx="4" fill="#8a6a4a"/><rect x="86" y="176" width="28" height="32" fill="#c1446b" opacity="0.9"/></g>`,
    flame(600, 150, 0.8, 0.9),
    `<g><ellipse cx="320" cy="300" rx="60" ry="10" fill="#2a211c"/>${flame(320, 284, 0.7, 1.2)}</g>`,
  ),
);

export const scenes = {
  boat: SCENE_BOAT,
  shore: SCENE_SHORE,
  cave: SCENE_CAVE,
  aeolia: SCENE_AEOLIA,
  harbor: SCENE_HARBOR,
  hall: SCENE_HALL,
  underworld: SCENE_UNDERWORLD,
  strait: SCENE_STRAIT,
  meadow: SCENE_MEADOW,
  grotto: SCENE_GROTTO,
  court: SCENE_COURT,
  palace: SCENE_PALACE,
};

const SPRITE_CYCLOPS = svgDocument(
  fragments(
    `<g transform="translate(480 40)"><animateTransform attributeName="transform" type="translate" values="480 40;480 34;480 40" dur="3s" repeatCount="indefinite"/>` +
      `<path d="M-66 320 L-44 110 Q0 36 44 110 L66 320 Z" fill="#4a3a34" opacity="0.95"/>` +
      `<circle cx="0" cy="90" r="60" fill="#5a463e"/>` +
      `<ellipse cx="0" cy="92" rx="26" ry="17" fill="#f4ead2"><animate attributeName="ry" values="17;17;17;2;17" dur="4s" repeatCount="indefinite"/></ellipse>` +
      `<circle cx="0" cy="92" r="10" fill="#3b7a2a"/><circle cx="0" cy="92" r="5" fill="#111"/>` +
      `<path d="M-30 66 Q0 54 30 66" stroke="#2a1e1a" stroke-width="6" fill="none" stroke-linecap="round"/>` +
      `<path d="M-30 134 Q0 150 30 134" stroke="#2a1e1a" stroke-width="4" fill="none"><animate attributeName="d" values="M-30 134 Q0 150 30 134;M-30 134 Q0 160 30 134;M-30 134 Q0 150 30 134" dur="2s" repeatCount="indefinite"/></path>` +
      `<g fill="#f4ead2">${[-14, -5, 4, 13].map((x) => `<rect x="${x}" y="138" width="6" height="9"/>`).join("")}</g>` +
      `<path d="M-120 260 Q-140 200 -96 190 Q-80 200 -84 240 Z" fill="#5a463e"><animateTransform attributeName="transform" type="rotate" values="0 -96 220;-10 -96 220;0 -96 220" dur="2.6s" repeatCount="indefinite"/></path></g>`,
  ),
);

const SPRITE_SIRENS = svgDocument(
  fragments(
    `${[
      [140, 0],
      [520, 1.2],
    ]
      .map(
        ([x, begin]) =>
          `<g transform="translate(${x} 120)"><animateTransform attributeName="transform" type="translate" values="${x} 120;${x} 108;${x} 120" dur="3.2s" begin="${begin}s" repeatCount="indefinite"/>` +
          `<path d="M-52 20 Q-32 -22 -6 6 Q-20 32 -52 20 Z" fill="#d8cbb5" opacity="0.9"><animateTransform attributeName="transform" type="rotate" values="-10 -6 6;12 -6 6;-10 -6 6" dur="1s" repeatCount="indefinite"/></path>` +
          `<path d="M52 20 Q32 -22 6 6 Q20 32 52 20 Z" fill="#d8cbb5" opacity="0.9"><animateTransform attributeName="transform" type="rotate" values="10 6 6;-12 6 6;10 6 6" dur="1s" repeatCount="indefinite"/></path>` +
          `<ellipse cx="0" cy="20" rx="14" ry="30" fill="#c1446b"/><circle cx="0" cy="-14" r="12" fill="#f3d9c0"/><path d="M-12 -20 Q0 -34 12 -20" stroke="#3b2411" stroke-width="4" fill="none"/></g>`,
      )
      .join("")}`,
    `<g fill="#fff" font-family="serif" font-size="28" opacity="0.8">${[200, 260, 440, 480].map((x, i) => `<text x="${x}" y="120">&#9834;<animateTransform attributeName="transform" type="translate" values="0 0;0 -60" dur="${2.5 + i * 0.3}s" begin="${i * 0.6}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.9;0" dur="${2.5 + i * 0.3}s" begin="${i * 0.6}s" repeatCount="indefinite"/></text>`).join("")}</g>`,
  ),
);

const SPRITE_STORM = svgDocument(
  fragments(
    `<rect width="640" height="360" fill="#1d1f33" opacity="0.4"><animate attributeName="opacity" values="0.3;0.5;0.3" dur="2.5s" repeatCount="indefinite"/></rect>`,
    `<g fill="#2f3350" opacity="0.95"><ellipse cx="120" cy="50" rx="130" ry="40"/><ellipse cx="330" cy="40" rx="160" ry="46"/><ellipse cx="540" cy="60" rx="130" ry="40"/></g>`,
    `<g stroke="#cfe6f5" stroke-width="2" opacity="0.6">${[60, 160, 260, 360, 460, 560].map((x, i) => `<line x1="${x}" y1="90" x2="${x - 30}" y2="200"><animate attributeName="opacity" values="0;0.8;0" dur="0.7s" begin="${i * 0.12}s" repeatCount="indefinite"/></line>`).join("")}</g>`,
    `<polyline points="330,80 306,150 338,144 296,230" fill="none" stroke="#fff4a8" stroke-width="4" stroke-linejoin="round" opacity="0"><animate attributeName="opacity" values="0;1;0;0;0;0;1;0" dur="3s" repeatCount="indefinite"/></polyline>`,
    `<rect width="640" height="360" fill="#fff4a8" opacity="0"><animate attributeName="opacity" values="0;0.22;0;0;0;0;0.16;0" dur="3s" repeatCount="indefinite"/></rect>`,
  ),
);

const SPRITE_SCYLLA = svgDocument(
  fragments(
    `<g>${[
      [560, 120, 0],
      [600, 90, 0.3],
      [520, 70, 0.6],
      [630, 150, 0.9],
      [580, 40, 1.2],
      [540, 170, 1.5],
    ]
      .map(([x, y, begin]) => {
        const nx = Number(x);
        const ny = Number(y);
        return (
          `<g><path d="M640 360 Q${nx + 40} ${ny + 120} ${nx} ${ny}" stroke="#2f6b4f" stroke-width="14" fill="none" stroke-linecap="round"><animate attributeName="d" values="M640 360 Q${nx + 40} ${ny + 120} ${nx} ${ny};M640 360 Q${nx + 10} ${ny + 100} ${nx - 14} ${ny - 8};M640 360 Q${nx + 40} ${ny + 120} ${nx} ${ny}" dur="2s" begin="${begin}s" repeatCount="indefinite"/></path>` +
          `<circle cx="${nx}" cy="${ny}" r="12" fill="#2f6b4f"><animate attributeName="cx" values="${nx};${nx - 14};${nx}" dur="2s" begin="${begin}s" repeatCount="indefinite"/><animate attributeName="cy" values="${ny};${ny - 8};${ny}" dur="2s" begin="${begin}s" repeatCount="indefinite"/></circle>` +
          `<circle cx="${nx - 4}" cy="${ny - 3}" r="3" fill="#ffe08a"><animate attributeName="cx" values="${nx - 4};${nx - 18};${nx - 4}" dur="2s" begin="${begin}s" repeatCount="indefinite"/><animate attributeName="cy" values="${ny - 3};${ny - 11};${ny - 3}" dur="2s" begin="${begin}s" repeatCount="indefinite"/></circle></g>`
        );
      })
      .join("")}</g>`,
  ),
);

const SPRITE_WINDS = svgDocument(
  fragments(
    `<g stroke="#e8f4ff" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.85">${[80, 140, 200, 260].map((y, i) => `<path d="M-200 ${y} q40 -20 80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0"><animateTransform attributeName="transform" type="translate" from="0 0" to="160 0" dur="${1.6 + i * 0.3}s" repeatCount="indefinite"/></path>`).join("")}</g>`,
    `<g transform="translate(110 250)"><path d="M-40 0 Q-50 -70 0 -80 Q50 -70 40 0 Q0 20 -40 0 Z" fill="#8a6a4a"><animate attributeName="d" values="M-40 0 Q-50 -70 0 -80 Q50 -70 40 0 Q0 20 -40 0 Z;M-48 0 Q-60 -80 0 -92 Q60 -80 48 0 Q0 24 -48 0 Z;M-40 0 Q-50 -70 0 -80 Q50 -70 40 0 Q0 20 -40 0 Z" dur="1.4s" repeatCount="indefinite"/></path><path d="M-10 -80 Q0 -92 10 -80" stroke="#c98a3c" stroke-width="4" fill="none"/></g>`,
  ),
);

const SPRITE_LIGHTNING = svgDocument(
  fragments(
    `<rect width="640" height="360" fill="#fff8d6" opacity="0"><animate attributeName="opacity" values="0;0.7;0;0.4;0" dur="1.2s" repeatCount="indefinite"/></rect>`,
    `<polyline points="320,0 290,120 330,110 280,260 340,140 300,150 330,40" fill="#fff4a8" stroke="#ffd84a" stroke-width="3" stroke-linejoin="round" opacity="0"><animate attributeName="opacity" values="0;1;0.2;1;0" dur="1.2s" repeatCount="indefinite"/></polyline>`,
  ),
);

const SPRITE_OWL = svgDocument(
  fragments(
    `<g transform="translate(150 120)"><animateTransform attributeName="transform" type="translate" values="150 120;150 116;150 120" dur="3s" repeatCount="indefinite"/>` +
      `<ellipse cx="0" cy="26" rx="22" ry="30" fill="#6d563d"/><circle cx="0" cy="-6" r="20" fill="#7a6246"/>` +
      `<path d="M-18 -20 L-10 -30 L-4 -18 Z M18 -20 L10 -30 L4 -18 Z" fill="#7a6246"/>` +
      `<circle cx="-8" cy="-6" r="7" fill="#ffe08a"/><circle cx="8" cy="-6" r="7" fill="#ffe08a"/>` +
      `<circle cx="-8" cy="-6" r="3" fill="#111"><animate attributeName="r" values="3;3;3;0.5;3" dur="4s" repeatCount="indefinite"/></circle><circle cx="8" cy="-6" r="3" fill="#111"><animate attributeName="r" values="3;3;3;0.5;3" dur="4s" repeatCount="indefinite"/></circle>` +
      `<path d="M-3 0 L3 0 L0 6 Z" fill="#e0b23a"/>` +
      `<g stroke="#4a3a2a" stroke-width="2">${[-10, -4, 2, 8].map((x) => `<line x1="${x}" y1="${14 + Math.abs(x) / 2}" x2="${x}" y2="${30 + Math.abs(x) / 3}" opacity="0.5"/>`).join("")}</g>` +
      `<line x1="-40" y1="56" x2="40" y2="56" stroke="#3b2411" stroke-width="4"/></g>`,
    `<circle cx="150" cy="130" r="70" fill="#ffe08a" opacity="0"><animate attributeName="opacity" values="0;0.18;0" dur="3s" repeatCount="indefinite"/></circle>`,
  ),
);

const SPRITE_MOLY = svgDocument(
  fragments(
    `<g transform="translate(200 230)">` +
      `<path d="M0 0 q-8 30 4 60 M0 0 q10 26 -2 58" stroke="#111" stroke-width="5" fill="none" stroke-linecap="round"/>` +
      `<path d="M0 0 L0 -40" stroke="#4f8a3a" stroke-width="4"/>` +
      `<g fill="#fff"><animateTransform attributeName="transform" type="rotate" values="0 0 -40;8 0 -40;0 0 -40;-8 0 -40;0 0 -40" dur="4s" repeatCount="indefinite"/>${[0, 60, 120, 180, 240, 300].map((a) => `<ellipse cx="0" cy="-54" rx="6" ry="14" transform="rotate(${a} 0 -40)"/>`).join("")}</g>` +
      `<circle cx="0" cy="-40" r="5" fill="#ffe08a"/>` +
      `<circle cx="0" cy="-40" r="40" fill="#fff" opacity="0.1"><animate attributeName="r" values="30;46;30" dur="2.5s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.05;0.18;0.05" dur="2.5s" repeatCount="indefinite"/></circle></g>`,
  ),
);

const SPRITE_EAGLE = svgDocument(
  fragments(
    `<g><animateTransform attributeName="transform" type="translate" values="-80 0;720 -60" dur="6s" repeatCount="indefinite"/>` +
      `<g transform="translate(0 110)"><path d="M-50 0 Q-30 -16 0 -4 Q30 -16 50 0 Q30 -4 0 6 Q-30 -4 -50 0 Z" fill="#3b2a1a"><animate attributeName="d" values="M-50 0 Q-30 -16 0 -4 Q30 -16 50 0 Q30 -4 0 6 Q-30 -4 -50 0 Z;M-50 10 Q-30 6 0 -4 Q30 6 50 10 Q30 0 0 6 Q-30 0 -50 10 Z;M-50 0 Q-30 -16 0 -4 Q30 -16 50 0 Q30 -4 0 6 Q-30 -4 -50 0 Z" dur="0.8s" repeatCount="indefinite"/></path>` +
      `<circle cx="6" cy="-2" r="5" fill="#3b2a1a"/><path d="M10 -2 l7 2 l-7 2 z" fill="#e0b23a"/></g></g>`,
  ),
);

export const sprites = {
  cyclops: SPRITE_CYCLOPS,
  sirens: SPRITE_SIRENS,
  storm: SPRITE_STORM,
  scylla: SPRITE_SCYLLA,
  winds: SPRITE_WINDS,
  lightning: SPRITE_LIGHTNING,
  owl: SPRITE_OWL,
  moly: SPRITE_MOLY,
  eagle: SPRITE_EAGLE,
};
