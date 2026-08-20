/**
 * Art for the crisis/wildlife/endgame arcs: eleven scenes and seven sprites.
 * The "almond-orchard" scene draws the cork estate (the key predates the
 * move to Sines); the hall labels read SIN01 and SIN04, Nortada One's halls.
 */

import { fragments, svgDocument } from "../../story/svg";

const STARS = `<g fill="#fff" opacity="0.8">${[
  [40, 30],
  [120, 60],
  [210, 24],
  [300, 70],
  [410, 40],
  [500, 22],
  [580, 66],
  [620, 110],
]
  .map(
    ([x, y], index) =>
      `<circle cx="${x}" cy="${y}" r="1.5"><animate attributeName="opacity" values="0.3;1;0.3" dur="${2 + (index % 3)}s" repeatCount="indefinite"/></circle>`,
  )
  .join("")}</g>`;

function rainLines(opacity: number, dur: number): string {
  const lines = [20, 70, 120, 170, 220, 270, 320, 370, 420, 470, 520, 570, 620]
    .map((x) => `<line x1="${x}" y1="-40" x2="${x - 30}" y2="60"/>`)
    .join("");
  return `<g stroke="#cfe0f5" stroke-width="1.5" opacity="${opacity}" stroke-linecap="round">
<g>${lines}<animateTransform attributeName="transform" type="translate" from="0 -60" to="-30 40" dur="${dur}s" repeatCount="indefinite"/></g>
<g>${lines}<animateTransform attributeName="transform" type="translate" from="0 40" to="-30 140" dur="${dur}s" repeatCount="indefinite"/></g>
<g>${lines}<animateTransform attributeName="transform" type="translate" from="0 140" to="-30 240" dur="${dur}s" repeatCount="indefinite"/></g>
<g>${lines}<animateTransform attributeName="transform" type="translate" from="0 240" to="-30 340" dur="${dur}s" repeatCount="indefinite"/></g>
</g>`;
}

const stormFront = svgDocument(
  fragments(
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#242a3b"/><stop offset="1" stop-color="#5b6478"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#sky)"/>`,
    `<g fill="#1a1f2e" opacity="0.9"><ellipse cx="120" cy="60" rx="150" ry="40"/><ellipse cx="340" cy="46" rx="190" ry="48"/><ellipse cx="560" cy="70" rx="150" ry="42"/>
<animateTransform attributeName="transform" type="translate" values="-30 0;30 0;-30 0" dur="7s" repeatCount="indefinite"/></g>`,
    `<rect y="290" width="640" height="70" fill="#3f4a3a"/>`,
    `<rect x="180" y="200" width="280" height="90" fill="#3a4250"/><rect x="180" y="200" width="280" height="8" fill="#2b3240"/>`,
    `<g transform="translate(110 290)"><rect x="-4" y="-150" width="8" height="150" fill="#8a5a2b"/>
<g><animateTransform attributeName="transform" type="rotate" values="-6 0 -150;6 0 -150;-6 0 -150" dur="1.1s" repeatCount="indefinite"/>
<rect x="-30" y="-154" width="150" height="5" fill="#6f4720"/></g></g>`,
    `<g transform="translate(560 290)"><rect x="-2" y="-110" width="4" height="110" fill="#ddd"/>
<path d="M0 -110 Q30 -100 60 -106 Q30 -90 0 -84 Z" fill="#f6821f"><animate attributeName="d" values="M0 -110 Q30 -100 60 -106 Q30 -90 0 -84 Z;M0 -110 Q30 -120 62 -98 Q32 -96 0 -84 Z;M0 -110 Q30 -100 60 -106 Q30 -90 0 -84 Z" dur="0.7s" repeatCount="indefinite"/></path></g>`,
    rainLines(0.6, 0.9),
  ),
);

const ransomScreen = svgDocument(
  fragments(
    `<rect width="640" height="360" fill="#0b0e12"/>`,
    `<rect x="90" y="50" width="460" height="260" rx="6" fill="#1a0608" stroke="#d94d3a" stroke-width="2"/>`,
    `<rect x="90" y="50" width="460" height="28" rx="6" fill="#d94d3a"/><rect x="90" y="70" width="460" height="8" fill="#d94d3a"/>`,
    `<text x="104" y="69" font-family="ui-monospace, monospace" font-size="13" font-weight="700" fill="#1a0608">BUILDING MANAGEMENT SYSTEM</text>`,
    `<text x="320" y="120" text-anchor="middle" font-family="ui-monospace, monospace" font-size="20" font-weight="700" fill="#ff6b57">YOUR CHILLERS ARE ENCRYPTED</text>`,
    `<g fill="#d94d3a" opacity="0.55">${[150, 166, 182, 198, 214]
      .map(
        (y, index) =>
          `<rect x="120" y="${y}" width="${260 - index * 30}" height="6" rx="3"><animate attributeName="opacity" values="0.2;0.7;0.2" dur="${1.8 + index * 0.3}s" repeatCount="indefinite"/></rect>`,
      )
      .join("")}</g>`,
    `<g transform="translate(470 180)"><rect x="-26" y="-6" width="52" height="44" rx="6" fill="#ff6b57"/><path d="M-16 -6 V-22 A16 16 0 0 1 16 -22 V-6" fill="none" stroke="#ff6b57" stroke-width="7"/><circle cy="16" r="6" fill="#1a0608"/></g>`,
    `<text x="120" y="262" font-family="ui-monospace, monospace" font-size="16" fill="#ffd37a">47<tspan><animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/>:</tspan>59<tspan><animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/>:</tspan>58</text>`,
    `<text x="120" y="290" font-family="ui-monospace, monospace" font-size="12" fill="#ff6b57">&gt; send 40 BTC to restore cooling_</text>`,
    `<rect x="395" y="280" width="8" height="13" fill="#ff6b57"><animate attributeName="opacity" values="1;0;1" dur="0.9s" repeatCount="indefinite"/></rect>`,
  ),
);

function bat(x: number, y: number, dur: number, scale = 1): string {
  return `<g transform="translate(${x} ${y}) scale(${scale})">
<g><animateTransform attributeName="transform" type="translate" values="0 0;18 -8;36 0;18 8;0 0" dur="${dur}s" repeatCount="indefinite"/>
<ellipse rx="4" ry="6" fill="#1a1a22"/>
<path d="M-3 -2 L-22 -10 L-14 2 L-3 4 Z" fill="#1a1a22"><animateTransform attributeName="transform" type="rotate" values="-20;20;-20" dur="0.3s" repeatCount="indefinite"/></path>
<path d="M3 -2 L22 -10 L14 2 L3 4 Z" fill="#1a1a22"><animateTransform attributeName="transform" type="rotate" values="20;-20;20" dur="0.3s" repeatCount="indefinite"/></path></g></g>`;
}

const batTunnel = svgDocument(
  fragments(
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1020"/><stop offset="1" stop-color="#23355a"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#sky)"/>`,
    STARS,
    `<circle cx="540" cy="70" r="26" fill="#f3ecd2" opacity="0.95"/>`,
    `<g fill="#17311f"><circle cx="70" cy="180" r="46"/><circle cx="120" cy="196" r="34"/><circle cx="590" cy="186" r="40"/></g>`,
    `<rect y="300" width="640" height="60" fill="#2e3a2b"/>`,
    `<path d="M0 300 L0 220 Q320 120 640 220 L640 300 Z" fill="#3b4d6b" opacity="0.55"/>`,
    `<path d="M0 220 Q320 120 640 220" fill="none" stroke="#9fb3d1" stroke-width="3"/>`,
    `<g stroke="#9fb3d1" stroke-width="1.2" opacity="0.8">${[
      40, 100, 160, 220, 280, 340, 400, 460, 520, 580,
    ]
      .map((x) => {
        const t = x / 640;
        const y = 220 - 100 * (4 * t * (1 - t));
        return `<line x1="${x}" y1="${y.toFixed(1)}" x2="${x}" y2="300"/>`;
      })
      .join("")}<path d="M0 260 Q320 160 640 260"/><path d="M0 240 Q320 140 640 240"/></g>`,
    `<g><animateTransform attributeName="transform" type="translate" from="-160 0" to="720 0" dur="8s" repeatCount="indefinite"/>
<rect x="0" y="256" width="110" height="38" rx="3" fill="#42505d"/><rect x="110" y="266" width="40" height="28" rx="3" fill="#f6821f"/><rect x="124" y="270" width="20" height="12" rx="2" fill="#cfe6f5"/>
<g fill="#1a1a1a"><circle cx="24" cy="296" r="8"/><circle cx="84" cy="296" r="8"/><circle cx="136" cy="296" r="8"/></g></g>`,
    bat(200, 150, 5),
    bat(330, 110, 6.5, 0.8),
    bat(470, 160, 5.5, 0.9),
    bat(120, 120, 7, 0.7),
  ),
);

function fish(x: number, y: number, dur: number, color: string): string {
  return `<g transform="translate(${x} ${y})"><g><animateTransform attributeName="transform" type="translate" values="0 0;-60 4;0 0" dur="${dur}s" repeatCount="indefinite"/>
<ellipse rx="14" ry="6" fill="${color}"/><polygon points="12,0 22,-6 22,6" fill="${color}"><animateTransform attributeName="transform" type="rotate" values="-12 12 0;12 12 0;-12 12 0" dur="0.5s" repeatCount="indefinite"/></polygon><circle cx="-8" cy="-1.5" r="1.5" fill="#0b1118"/></g></g>`;
}

const fishDisco = svgDocument(
  fragments(
    `<defs><linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b5f8c"/><stop offset="1" stop-color="#041a2c"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#water)"/>`,
    `<g opacity="0.25" fill="#fff4a8"><polygon points="320,70 200,360 300,360"><animateTransform attributeName="transform" type="rotate" values="-18 320 70;18 320 70;-18 320 70" dur="4s" repeatCount="indefinite"/></polygon>
<polygon points="320,70 340,360 440,360" fill="#f6a0d8"><animateTransform attributeName="transform" type="rotate" values="18 320 70;-18 320 70;18 320 70" dur="5s" repeatCount="indefinite"/></polygon></g>`,
    `<line x1="320" y1="0" x2="320" y2="46" stroke="#9fb3d1" stroke-width="2"/>
<g transform="translate(320 70)"><circle r="24" fill="#cfd8e3"/><g stroke="#8aa0b8" stroke-width="1"><line x1="-24" y1="0" x2="24" y2="0"/><line x1="-21" y1="-12" x2="21" y2="-12"/><line x1="-21" y1="12" x2="21" y2="12"/><line x1="0" y1="-24" x2="0" y2="24"/><line x1="-12" y1="-21" x2="-12" y2="21"/><line x1="12" y1="-21" x2="12" y2="21"/></g>
<animateTransform attributeName="transform" type="rotate" from="0 320 70" to="360 320 70" dur="10s" repeatCount="indefinite" additive="sum"/></g>`,
    `<g stroke="#6a7f99" stroke-width="6">${[560, 580, 600, 620]
      .map((x) => `<line x1="${x}" y1="120" x2="${x}" y2="360"/>`)
      .join("")}</g>`,
    `<g transform="translate(520 250)"><rect x="-18" y="-26" width="36" height="52" rx="4" fill="#2e3944"/><circle r="12" fill="#0b1118" stroke="#8aa0b8" stroke-width="2"/>
${[0, 0.6, 1.2]
  .map(
    (begin) =>
      `<circle r="12" fill="none" stroke="#f6a0d8" stroke-width="2"><animate attributeName="r" values="12;70" dur="1.8s" begin="${begin}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.9;0" dur="1.8s" begin="${begin}s" repeatCount="indefinite"/></circle>`,
  )
  .join("")}</g>`,
    fish(160, 200, 4, "#c9d8e6"),
    fish(210, 230, 5, "#b8c9d8"),
    fish(120, 260, 4.5, "#d6e2ee"),
    fish(260, 290, 5.5, "#b8c9d8"),
    fish(90, 300, 4.2, "#c9d8e6"),
    `<g fill="#5aa7d8" opacity="0.6">${[80, 240, 400]
      .map(
        (x, index) =>
          `<circle cx="${x}" cy="340" r="3"><animate attributeName="cy" values="340;-10" dur="${6 + index}s" repeatCount="indefinite"/></circle>`,
      )
      .join("")}</g>`,
  ),
);

function newt(x: number, y: number, dur: number): string {
  return `<g transform="translate(${x} ${y})"><g><animateTransform attributeName="transform" type="translate" values="0 0;30 -4;60 0" dur="${dur}s" repeatCount="indefinite"/>
<path d="M-30 4 Q-44 -2 -52 8" fill="none" stroke="#2f2a24" stroke-width="5" stroke-linecap="round"><animate attributeName="d" values="M-30 4 Q-44 -2 -52 8;M-30 4 Q-44 12 -52 2;M-30 4 Q-44 -2 -52 8" dur="0.8s" repeatCount="indefinite"/></path>
<ellipse rx="22" ry="7" fill="#2f2a24"/><ellipse cx="-2" cy="3" rx="18" ry="3.5" fill="#f6821f"/>
<circle cx="22" cy="0" r="6" fill="#2f2a24"/><circle cx="24" cy="-2" r="1.5" fill="#fff"/>
<g stroke="#2f2a24" stroke-width="3" stroke-linecap="round"><line x1="-12" y1="4" x2="-18" y2="12"><animateTransform attributeName="transform" type="rotate" values="-15 -12 4;15 -12 4;-15 -12 4" dur="0.8s" repeatCount="indefinite"/></line><line x1="12" y1="4" x2="6" y2="12"><animateTransform attributeName="transform" type="rotate" values="15 12 4;-15 12 4;15 12 4" dur="0.8s" repeatCount="indefinite"/></line></g></g></g>`;
}

const newtPond = svgDocument(
  fragments(
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c3e5a"/><stop offset="1" stop-color="#8a90a8"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#sky)"/>`,
    STARS,
    `<rect y="200" width="640" height="160" fill="#3f5a36"/>`,
    `<ellipse cx="330" cy="290" rx="220" ry="50" fill="#2f5b7a"/>`,
    `<g fill="none" stroke="#9fd0ea" stroke-width="1.5">${[0, 1.3, 2.6]
      .map(
        (begin) =>
          `<ellipse cx="330" cy="290" rx="20" ry="5"><animate attributeName="rx" values="10;200" dur="4s" begin="${begin}s" repeatCount="indefinite"/><animate attributeName="ry" values="2;46" dur="4s" begin="${begin}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.9;0" dur="4s" begin="${begin}s" repeatCount="indefinite"/></ellipse>`,
      )
      .join("")}</g>`,
    `<g stroke="#5a7d3a" stroke-width="4" stroke-linecap="round">${[90, 104, 120, 540, 556, 570]
      .map(
        (x, index) =>
          `<line x1="${x}" y1="250" x2="${x + 4}" y2="${190 + (index % 3) * 10}"><animateTransform attributeName="transform" type="skewX" values="0;4;0;-3;0" dur="${3 + (index % 2)}s" repeatCount="indefinite"/></line>`,
      )
      .join("")}</g>`,
    `<polygon points="40,150 360,300 300,330" fill="#fff4a8" opacity="0.18"><animate attributeName="opacity" values="0.12;0.26;0.12" dur="3s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="rotate" values="-4 40 150;4 40 150;-4 40 150" dur="6s" repeatCount="indefinite"/></polygon>`,
    `<circle cx="40" cy="150" r="6" fill="#fff4a8"/>`,
    newt(420, 250, 6),
  ),
);

const surveyDusk = svgDocument(
  fragments(
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3c3560"/><stop offset="0.6" stop-color="#c97a6b"/><stop offset="1" stop-color="#f3b27a"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#sky)"/>`,
    `<g fill="#1e2a1c"><circle cx="520" cy="180" r="50"/><circle cx="580" cy="196" r="40"/><circle cx="470" cy="200" r="34"/></g>`,
    `<rect y="230" width="640" height="130" fill="#54603d"/>`,
    `<g stroke="#5b3a1e" stroke-width="4">${[30, 130, 230, 330, 430, 530, 630]
      .map((x) => `<line x1="${x}" y1="232" x2="${x}" y2="282"/>`)
      .join(
        "",
      )}</g><g stroke="#3a2a1a" stroke-width="1.2"><line x1="0" y1="245" x2="640" y2="245"/><line x1="0" y1="260" x2="640" y2="260"/><line x1="0" y1="275" x2="640" y2="275"/></g>`,
    `<g transform="translate(180 250)"><circle cy="-38" r="9" fill="#2a2a2a"/><rect x="-9" y="-30" width="18" height="36" rx="4" fill="#35503a"/><rect x="-14" y="6" width="10" height="26" fill="#2a2a2a"/><rect x="4" y="6" width="10" height="26" fill="#2a2a2a"/>
<rect x="10" y="-26" width="10" height="14" rx="2" fill="#555"/><circle cx="15" cy="-22" r="2" fill="#3fd27a"><animate attributeName="opacity" values="1;0.1;1;1;0.1;1;1;1" dur="2.2s" repeatCount="indefinite"/></circle></g>`,
    bat(380, 110, 6, 0.8),
    bat(300, 80, 7.5, 0.6),
  ),
);

const investorStage = svgDocument(
  fragments(
    `<rect width="640" height="360" fill="#1a1d2a"/>`,
    `<rect y="250" width="640" height="110" fill="#2f2731"/>`,
    `<g opacity="0.22" fill="#fff4a8"><polygon points="120,0 260,250 380,250"><animate attributeName="opacity" values="0.15;0.3;0.15" dur="3s" repeatCount="indefinite"/></polygon><polygon points="520,0 260,250 380,250" fill="#f6a0d8"><animate attributeName="opacity" values="0.3;0.15;0.3" dur="3.4s" repeatCount="indefinite"/></polygon></g>`,
    `<rect x="170" y="50" width="300" height="170" rx="4" fill="#0b1118" stroke="#44566b" stroke-width="2"/>`,
    `<g stroke="#1f2c3a" stroke-width="1">${[90, 130, 170]
      .map((y) => `<line x1="190" y1="${y}" x2="450" y2="${y}"/>`)
      .join("")}</g>`,
    `<path d="M190 200 L250 180 L300 170 L350 120 L400 100 L450 70" fill="none" stroke="#3fd27a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="320" stroke-dashoffset="320"><animate attributeName="stroke-dashoffset" values="320;0;0" dur="5s" repeatCount="indefinite"/></path>`,
    `<text x="190" y="76" font-family="ui-monospace, monospace" font-size="12" fill="#8aa0b8">run-rate</text>`,
    `<g transform="translate(520 250)"><rect x="-20" y="-60" width="40" height="60" rx="3" fill="#4a3d45"/><rect x="-24" y="-66" width="48" height="8" rx="2" fill="#5d4e56"/><circle cy="-84" r="10" fill="#3a3a3a"/></g>`,
    `<g fill="#2a2f3d">${[0, 1, 2]
      .map((row) =>
        [60, 120, 180, 240, 300, 360, 420, 480, 540, 600]
          .map((x) => `<circle cx="${x + row * 20}" cy="${300 + row * 22}" r="11"/>`)
          .join(""),
      )
      .join("")}</g>`,
  ),
);

const almondOrchard = svgDocument(
  fragments(
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fd0ea"/><stop offset="1" stop-color="#f9eed8"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#sky)"/>`,
    `<rect x="200" y="150" width="240" height="60" fill="#8a9aa8"/><g fill="#6b7d8f">${[
      220, 260, 300, 340, 380, 420,
    ]
      .map((x) => `<rect x="${x}" y="140" width="14" height="10"/>`)
      .join("")}</g>`,
    `<rect y="210" width="640" height="150" fill="#b7a06a"/>`,
    `<g>${[0, 1, 2, 3]
      .map((row) => {
        const y = 225 + row * 32;
        const r = 12 + row * 5;
        return [40, 140, 240, 340, 440, 540, 640]
          .map(
            (x) =>
              `<rect x="${x - 2 - row}" y="${y - r}" width="${4 + row}" height="${r + 10}" fill="#a0522d"/><circle cx="${x}" cy="${y - r}" r="${r}" fill="#4f6b3a"/><circle cx="${x - r / 2}" cy="${y - r - 2}" r="${r / 3}" fill="#6b8a4a" opacity="0.9"/><circle cx="${x + r / 2}" cy="${y - r + 3}" r="${r / 4}" fill="#6b8a4a" opacity="0.9"/>`,
          )
          .join("");
      })
      .join("")}</g>`,
    `<g fill="#8b5a2b">${[100, 260, 420, 580]
      .map(
        (x, index) =>
          `<ellipse cx="${x}" cy="120" rx="2.5" ry="4"><animate attributeName="cy" values="120;360" dur="${5 + index}s" repeatCount="indefinite"/><animate attributeName="cx" values="${x};${x + 30};${x - 10}" dur="${5 + index}s" repeatCount="indefinite"/></ellipse>`,
      )
      .join("")}</g>`,
  ),
);

const swimmingPool = svgDocument(
  fragments(
    `<rect width="640" height="360" fill="#dfeff5"/>`,
    `<g stroke="#c3d9e3" stroke-width="1">${[40, 80, 120, 160]
      .map((y) => `<line x1="0" y1="${y}" x2="640" y2="${y}"/>`)
      .join("")}</g>`,
    `<rect x="20" y="190" width="600" height="150" rx="8" fill="#3d9bd1"/>`,
    `<g stroke="#dff2ff" stroke-width="2" fill="none" stroke-dasharray="14 18" opacity="0.8">${[
      220, 250, 280, 310,
    ]
      .map(
        (y, index) =>
          `<path d="M30 ${y} Q90 ${y - 6} 150 ${y} T270 ${y} T390 ${y} T510 ${y} T630 ${y}"><animate attributeName="stroke-dashoffset" from="0" to="-64" dur="${3 + index * 0.5}s" repeatCount="indefinite"/></path>`,
      )
      .join("")}</g>`,
    `<g fill="#fff" opacity="0.5">${[100, 220, 340, 460, 560]
      .map(
        (x, index) =>
          `<circle cx="${x}" cy="190" r="10"><animate attributeName="cy" values="190;90" dur="${4 + index * 0.6}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.5;0" dur="${4 + index * 0.6}s" repeatCount="indefinite"/><animate attributeName="r" values="8;22" dur="${4 + index * 0.6}s" repeatCount="indefinite"/></circle>`,
      )
      .join("")}</g>`,
    `<rect x="470" y="40" width="150" height="90" fill="#6b7d8f"/><g fill="#3fd27a">${[
      484, 504, 524, 544, 564, 584,
    ]
      .map(
        (x, index) =>
          `<circle cx="${x}" cy="60" r="2.5"><animate attributeName="opacity" values="1;0.2;1" dur="${1.2 + (index % 3) * 0.4}s" repeatCount="indefinite"/></circle>`,
      )
      .join("")}</g>`,
    `<rect x="440" y="120" width="30" height="14" fill="#f6821f"/><rect x="440" y="120" width="14" height="80" fill="#f6821f"/><rect x="300" y="186" width="154" height="14" fill="#f6821f"/><rect x="440" y="186" width="14" height="20" fill="#f6821f"/>`,
    `<g transform="translate(380 150)"><circle r="16" fill="#fff" stroke="#444" stroke-width="2"/><line x1="0" y1="0" x2="8" y2="-10" stroke="#d94d3a" stroke-width="2"><animateTransform attributeName="transform" type="rotate" values="-20;25;-20" dur="3s" repeatCount="indefinite"/></line></g>`,
  ),
);

const flagHall = svgDocument(
  fragments(
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9d6e3"/><stop offset="1" stop-color="#eef3f7"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#sky)"/>`,
    `<rect y="250" width="640" height="110" fill="#9aa39a"/>`,
    `<rect x="150" y="130" width="340" height="120" fill="#6b7d8f"/><rect x="150" y="130" width="340" height="10" fill="#42505d"/>`,
    `<g fill="#2e3944">${[170, 220, 270, 320, 370, 420]
      .map((x) => `<rect x="${x}" y="160" width="36" height="22" rx="2"/>`)
      .join("")}</g>`,
    `<rect x="300" y="196" width="40" height="54" fill="#2e3944"/>`,
    `<rect x="150" y="200" width="140" height="18" fill="#eef3f7"/><text x="158" y="213" font-family="ui-monospace, monospace" font-size="10" font-weight="700" fill="#42505d">NATIONAL COMPUTE (S)</text>`,
    `<g transform="translate(320 130)"><rect x="-2" y="-90" width="4" height="90" fill="#444"/>
<path d="M2 -88 Q26 -80 50 -86 L50 -60 Q26 -54 2 -62 Z" fill="#2a5d9f"><animate attributeName="d" values="M2 -88 Q26 -80 50 -86 L50 -60 Q26 -54 2 -62 Z;M2 -88 Q26 -96 50 -84 L50 -58 Q26 -66 2 -62 Z;M2 -88 Q26 -80 50 -86 L50 -60 Q26 -54 2 -62 Z" dur="1.6s" repeatCount="indefinite"/></path></g>`,
    `<g>${[40, 70, 100, 130, 560, 590]
      .map(
        (x, index) =>
          `<g transform="translate(${x} 250)"><circle cy="-34" r="8" fill="#3a3a3a"/><rect x="-8" y="-26" width="16" height="30" rx="3" fill="#${index % 2 === 0 ? "3a4a6b" : "4a4a4a"}"/><rect x="8" y="-14" width="10" height="12" fill="#6b4a2a"/></g>`,
      )
      .join("")}</g>`,
    `<g transform="translate(520 250)"><rect x="-14" y="-40" width="28" height="40" rx="4" fill="#c9c9c9"/><rect x="-16" y="-44" width="32" height="6" rx="2" fill="#aaa"/><rect x="10" y="-20" width="8" height="6" fill="#888"/>
<g fill="#fff" opacity="0.6"><circle cx="0" cy="-48" r="4"><animate attributeName="cy" values="-48;-80" dur="2.5s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.6;0" dur="2.5s" repeatCount="indefinite"/></circle></g></g>`,
  ),
);

const objectionLetter = svgDocument(
  fragments(
    `<rect width="640" height="360" fill="#101a26"/>`,
    `<rect x="170" y="20" width="300" height="340" fill="#f7f4ec"/>`,
    `<text x="190" y="56" font-family="ui-monospace, monospace" font-size="14" font-weight="700" fill="#1a1a1a">RE: PLANNING APPLICATION, SIN04</text>`,
    `<text x="190" y="76" font-family="ui-monospace, monospace" font-size="11" fill="#555">From: the model (SIN01, racks 1-4000)</text>`,
    `<g fill="#9a9a9a">${[100, 116, 132, 148, 164, 180, 196, 212, 228, 244, 260, 276]
      .map(
        (y, index) =>
          `<rect x="190" y="${y}" width="${index % 4 === 3 ? 140 : 260}" height="6" rx="3" opacity="0"><animate attributeName="opacity" values="0;1;1;1;1;1;1;1;1;1;1;1;1;1;1;0" dur="14s" begin="${index * 0.6}s" repeatCount="indefinite"/></rect>`,
      )
      .join("")}</g>`,
    `<text x="190" y="310" font-family="ui-monospace, monospace" font-size="11" fill="#1a1a1a">I object. Yours, etc.</text>`,
    `<rect x="330" y="300" width="8" height="13" fill="#1a1a1a"><animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/></rect>`,
    `<g transform="translate(420 300) rotate(-14)"><rect x="-48" y="-18" width="96" height="36" rx="4" fill="none" stroke="#d94d3a" stroke-width="3"/><text text-anchor="middle" y="5" font-family="ui-monospace, monospace" font-size="13" font-weight="700" fill="#d94d3a">RECEIVED</text></g>`,
  ),
);

/** Scenes this arc declares; spread into the story's `scenes`. */
export const crisisWildlifeEndgameScenes = {
  "storm-front": stormFront,
  "ransom-screen": ransomScreen,
  "bat-tunnel": batTunnel,
  "fish-disco": fishDisco,
  "newt-pond": newtPond,
  "survey-dusk": surveyDusk,
  "investor-stage": investorStage,
  "almond-orchard": almondOrchard,
  "swimming-pool": swimmingPool,
  "flag-hall": flagHall,
  "objection-letter": objectionLetter,
};

const quakeSprite = svgDocument(
  fragments(
    `<g><animateTransform attributeName="transform" type="translate" values="0 0;-6 3;5 -4;-4 2;6 -2;0 0" dur="0.35s" repeatCount="indefinite"/>
<rect width="640" height="360" fill="#7a5a3a" opacity="0.14"/></g>`,
    `<g fill="none" stroke="#2b1d12" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
<polyline points="0,330 60,300 90,318 150,280 200,296 250,262 310,280 360,250" stroke-dasharray="520" stroke-dashoffset="520"><animate attributeName="stroke-dashoffset" values="520;0" dur="1.2s" fill="freeze"/></polyline>
<polyline points="640,340 580,310 540,322 490,290 450,306 400,272" stroke-dasharray="320" stroke-dashoffset="320"><animate attributeName="stroke-dashoffset" values="320;0" dur="1s" begin="0.3s" fill="freeze"/></polyline></g>`,
    `<g fill="#c9a97a" opacity="0.7">${[120, 330, 520]
      .map(
        (x, index) =>
          `<circle cx="${x}" cy="250" r="6"><animate attributeName="r" values="2;26" dur="${1.2 + index * 0.2}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.6;0" dur="${1.2 + index * 0.2}s" repeatCount="indefinite"/></circle>`,
      )
      .join("")}</g>`,
  ),
);

const batSprite = svgDocument(
  fragments(
    `<g><animateTransform attributeName="transform" type="translate" from="-80 0" to="720 0" dur="6s" repeatCount="indefinite"/>${bat(0, 90, 2)}${bat(-50, 130, 2.4, 0.8)}${bat(40, 60, 2.2, 0.7)}</g>`,
  ),
);

const fishSprite = svgDocument(
  fragments(
    `<g><animateTransform attributeName="transform" type="translate" from="720 0" to="-120 0" dur="7s" repeatCount="indefinite"/>${fish(0, 280, 2, "#c9d8e6")}${fish(50, 300, 2.4, "#b8c9d8")}${fish(30, 320, 2.2, "#d6e2ee")}${fish(90, 290, 2.6, "#c9d8e6")}</g>`,
  ),
);

const newtSprite = svgDocument(
  fragments(
    `<g><animateTransform attributeName="transform" type="translate" from="-80 0" to="720 0" dur="16s" repeatCount="indefinite"/>${newt(0, 330, 1.2)}</g>`,
  ),
);

const padlockSprite = svgDocument(
  fragments(
    `<g transform="translate(540 90)"><g><animateTransform attributeName="transform" type="scale" values="0;1.25;1" dur="0.6s" fill="freeze"/>
<circle r="56" fill="#1a0608" opacity="0.85"/><circle r="56" fill="none" stroke="#d94d3a" stroke-width="5"/>
<rect x="-22" y="-4" width="44" height="36" rx="5" fill="#ff6b57"/><path d="M-14 -4 V-18 A14 14 0 0 1 14 -18 V-4" fill="none" stroke="#ff6b57" stroke-width="6"/><circle cy="14" r="5" fill="#1a0608"/>
<text y="72" text-anchor="middle" font-family="ui-monospace, monospace" font-size="12" font-weight="700" fill="#ff6b57">ENCRYPTED</text></g></g>`,
  ),
);

const confettiSprite = svgDocument(
  fragments(
    `<g>${[
      ["#f6821f", 40],
      ["#3fd27a", 110],
      ["#5aa7d8", 180],
      ["#f6a0d8", 250],
      ["#ffd37a", 320],
      ["#f6821f", 390],
      ["#3fd27a", 460],
      ["#5aa7d8", 530],
      ["#f6a0d8", 600],
    ]
      .map(
        ([color, x], index) =>
          `<rect x="${x}" y="-20" width="10" height="16" rx="2" fill="${color}"><animate attributeName="y" values="-20;380" dur="${3 + (index % 4) * 0.7}s" begin="${index * 0.25}s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="rotate" from="0 ${Number(x) + 5} 0" to="360 ${Number(x) + 5} 0" dur="${1.5 + (index % 3) * 0.4}s" repeatCount="indefinite" additive="sum"/></rect>`,
      )
      .join("")}</g>`,
  ),
);

const rainSprite = svgDocument(fragments(rainLines(0.75, 0.7)));

/** Sprites this arc declares; spread into the story's `sprites`. */
export const crisisWildlifeEndgameSprites = {
  quake: quakeSprite,
  bat: batSprite,
  fish: fishSprite,
  newt: newtSprite,
  padlock: padlockSprite,
  confetti: confettiSprite,
  rain: rainSprite,
};
