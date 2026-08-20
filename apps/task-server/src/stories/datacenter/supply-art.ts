/** Art for the GPUs/labor arc: three scenes and six sprites. */

import { fragments, svgDocument } from "../../story/svg";

function rig(x: number, y: number, begin: number): string {
  return `<g transform="translate(${x} ${y})"><rect width="44" height="26" rx="2" fill="#2a2d33" stroke="#3a3e47"/>
<g fill="#f59e0b"><circle cx="8" cy="8" r="2"><animate attributeName="opacity" values="1;0.1;1" dur="${1.1 + begin}s" repeatCount="indefinite"/></circle>
<circle cx="8" cy="18" r="2"><animate attributeName="opacity" values="0.2;1;0.2" dur="${1.6 + begin}s" repeatCount="indefinite"/></circle></g>
<g fill="#5b6270"><circle cx="24" cy="13" r="6"/><circle cx="37" cy="13" r="6"/></g>
<g fill="#1b1d22"><circle cx="24" cy="13" r="2"/><circle cx="37" cy="13" r="2"/></g></g>`;
}

function rigRow(y: number, begin: number): string {
  return [40, 96, 152, 208, 264, 320, 376, 432, 488]
    .map((x, index) => rig(x, y, begin + index * 0.17))
    .join("\n");
}

const auction = svgDocument(
  fragments(
    `<defs><linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f1014"/><stop offset="1" stop-color="#1c1a14"/></linearGradient>
<radialGradient id="sodium" cx="0.5" cy="0" r="0.8"><stop offset="0" stop-color="#f5b041" stop-opacity="0.55"/><stop offset="1" stop-color="#f5b041" stop-opacity="0"/></radialGradient></defs>`,
    `<rect width="640" height="360" fill="url(#dusk)"/>`,
    `<g><ellipse cx="160" cy="40" rx="160" ry="170" fill="url(#sodium)"><animate attributeName="opacity" values="0.9;0.7;0.9" dur="5s" repeatCount="indefinite"/></ellipse>
<ellipse cx="480" cy="40" rx="160" ry="170" fill="url(#sodium)"><animate attributeName="opacity" values="0.7;0.95;0.7" dur="6.5s" repeatCount="indefinite"/></ellipse></g>`,
    `<g stroke="#3a3e47" stroke-width="3"><line x1="160" y1="0" x2="160" y2="34"/><line x1="480" y1="0" x2="480" y2="34"/></g>
<g fill="#ffd37a"><ellipse cx="160" cy="36" rx="18" ry="5"/><ellipse cx="480" cy="36" rx="18" ry="5"/></g>`,
    rigRow(110, 0),
    rigRow(150, 0.4),
    rigRow(190, 0.8),
    rigRow(230, 1.2),
    `<rect y="276" width="640" height="84" fill="#15161a"/>`,
    `<g transform="translate(556 226)"><rect x="0" y="0" width="56" height="50" fill="#4b3621"/><rect x="-6" y="-6" width="68" height="10" fill="#5b4027"/>
<rect x="16" y="-30" width="24" height="24" rx="12" fill="#c9a27a"/><rect x="8" y="-36" width="40" height="8" rx="2" fill="#2a2420"/><rect x="14" y="-46" width="28" height="12" rx="2" fill="#2a2420"/></g>`,
    `<g fill="#c8c8c8" opacity="0.7"><circle cx="80" cy="300" r="5"><animate attributeName="cx" values="80;96;80" dur="7s" repeatCount="indefinite"/></circle><circle cx="112" cy="306" r="5"><animate attributeName="cx" values="112;98;112" dur="9s" repeatCount="indefinite"/></circle></g>`,
    `<text x="24" y="340" font-family="ui-monospace, monospace" font-size="12" fill="#8a8378">LOT 7: ACCELERATORS (AS SEEN)</text>`,
  ),
);

const fullMoon = svgDocument(
  fragments(
    `<defs><linearGradient id="night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070a18"/><stop offset="0.7" stop-color="#141a3a"/><stop offset="1" stop-color="#232a4a"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#night)"/>`,
    `<g fill="#ffffff">${[
      [40, 30],
      [90, 70],
      [150, 22],
      [220, 58],
      [300, 34],
      [370, 80],
      [450, 26],
      [600, 60],
      [560, 110],
      [120, 120],
    ]
      .map(
        ([x, y], index) =>
          `<circle cx="${x}" cy="${y}" r="1.4"><animate attributeName="opacity" values="0.3;1;0.3" dur="${2 + (index % 4) * 0.7}s" repeatCount="indefinite"/></circle>`,
      )
      .join("")}</g>`,
    `<circle cx="500" cy="90" r="62" fill="#f3efd5" opacity="0.16"><animate attributeName="r" values="62;70;62" dur="7s" repeatCount="indefinite"/></circle>
<circle cx="500" cy="90" r="40" fill="#f3efd5"/><g fill="#d9d3b4" opacity="0.7"><circle cx="486" cy="78" r="7"/><circle cx="512" cy="100" r="5"/><circle cx="496" cy="106" r="3"/></g>`,
    `<polygon points="0,228 70,190 150,186 200,228" fill="#0b0e1c"/><polygon points="420,226 500,196 600,192 640,220 640,236" fill="#0b0e1c"/>`,
    `<rect y="226" width="640" height="134" fill="#0d1020"/>`,
    `<rect x="180" y="150" width="280" height="80" fill="#161b2b" stroke="#2a3150" stroke-width="2"/>`,
    `<g fill="#2a3150"><rect x="200" y="170" width="30" height="18" rx="2"/><rect x="250" y="170" width="30" height="18" rx="2"/><rect x="300" y="170" width="30" height="18" rx="2"/><rect x="350" y="170" width="30" height="18" rx="2"/><rect x="400" y="170" width="30" height="18" rx="2"/></g>`,
    `<rect x="200" y="170" width="30" height="18" rx="2" fill="#ffe9a8"><animate attributeName="x" values="200;250;300;350;400;350;300;250;200" dur="18s" repeatCount="indefinite" calcMode="discrete"/><animate attributeName="opacity" values="0.9;0.6;0.9" dur="1.2s" repeatCount="indefinite"/></rect>`,
    `<g stroke="#1f2640" stroke-width="3"><line x1="40" y1="230" x2="40" y2="300"/><line x1="600" y1="230" x2="600" y2="300"/></g>`,
    `<g fill="#8a8fb0" opacity="0.7"><ellipse cx="40" cy="302" rx="14" ry="4"/><ellipse cx="600" cy="302" rx="14" ry="4"/></g>`,
  ),
);

function rackFrame(x: number): string {
  return `<rect x="${x}" y="110" width="36" height="160" rx="3" fill="#111922" stroke="#243140" stroke-dasharray="4 4"/>`;
}

function litRack(x: number, begin: number): string {
  return `<g transform="translate(${x} 0)"><rect y="110" width="36" height="160" rx="3" fill="#1d2733" stroke="#2f3d4c"/>
<g fill="#3fd27a"><circle cx="8" cy="126" r="2"><animate attributeName="opacity" values="1;0.2;1" dur="1.3s" begin="${begin}s" repeatCount="indefinite"/></circle>
<circle cx="8" cy="156" r="2"><animate attributeName="opacity" values="0.3;1;0.3" dur="1.7s" begin="${begin + 0.4}s" repeatCount="indefinite"/></circle>
<circle cx="8" cy="186" r="2"><animate attributeName="opacity" values="1;0.1;1" dur="0.9s" begin="${begin + 0.2}s" repeatCount="indefinite"/></circle>
<circle cx="8" cy="216" r="2"><animate attributeName="opacity" values="0.5;1;0.5" dur="2.1s" begin="${begin + 0.7}s" repeatCount="indefinite"/></circle>
<circle cx="8" cy="246" r="2"><animate attributeName="opacity" values="0.8;0.2;0.8" dur="1.5s" begin="${begin + 0.9}s" repeatCount="indefinite"/></circle></g>
<g fill="#5aa7d8" opacity="0.8"><rect x="16" y="123" width="14" height="3"/><rect x="16" y="153" width="14" height="3"/><rect x="16" y="183" width="14" height="3"/><rect x="16" y="213" width="14" height="3"/><rect x="16" y="243" width="14" height="3"/></g></g>`;
}

const RACK_X = [40, 88, 136, 184, 232, 280, 328, 376, 424, 472, 520, 568];

const coldAisle = svgDocument(
  fragments(
    `<defs><linearGradient id="aisle" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1118"/><stop offset="1" stop-color="#16222e"/></linearGradient></defs>`,
    `<rect width="640" height="360" fill="url(#aisle)"/>`,
    `<rect y="270" width="640" height="90" fill="#0e151d"/><g stroke="#1f2c3a" stroke-width="1">${RACK_X.map((x) => `<line x1="${x}" y1="270" x2="${x - 20}" y2="360"/>`).join("")}</g>`,
    `<g>${RACK_X.map((x) => rackFrame(x)).join("")}</g>`,
    `<g class="fill">${RACK_X.map((x, index) => litRack(x, index * 0.23)).join("\n")}</g>`,
    `<rect x="0" y="0" width="640" height="50" fill="#5aa7d8" opacity="0.08"><animate attributeName="opacity" values="0.06;0.14;0.06" dur="4s" repeatCount="indefinite"/></rect>`,
    `<g transform="translate(0 0)"><animateTransform attributeName="transform" type="translate" values="-80 0;660 0" dur="16s" repeatCount="indefinite"/>
<rect x="0" y="238" width="44" height="30" rx="3" fill="#f6821f"/><rect x="-8" y="230" width="10" height="40" fill="#42505d"/><g fill="#1a1a1a"><circle cx="8" cy="272" r="6"/><circle cx="36" cy="272" r="6"/></g></g>`,
  ),
  `.fill{clip-path:inset(0 calc(100% - var(--build-progress,0) * 100%) 0 0);transition:clip-path 1.2s ease-out}`,
);

export const supplyLaborScenes: Record<string, string> = {
  auction,
  "full-moon": fullMoon,
  "cold-aisle": coldAisle,
};

const crate = svgDocument(
  fragments(
    `<g transform="translate(470 120)"><animateTransform attributeName="transform" type="translate" values="470 -160;470 120;470 120" keyTimes="0;0.35;1" dur="5s" fill="freeze"/>
<rect x="-60" y="100" width="140" height="14" fill="#8a6a4a"/><g fill="#6f5439"><rect x="-54" y="114" width="12" height="8"/><rect x="4" y="114" width="12" height="8"/><rect x="62" y="114" width="12" height="8"/></g>
<rect x="-50" y="0" width="120" height="100" fill="#c9a063" stroke="#8a6a4a" stroke-width="3"/>
<g stroke="#8a6a4a" stroke-width="3"><line x1="-50" y1="0" x2="70" y2="100"/><line x1="70" y1="0" x2="-50" y2="100"/></g>
<g stroke="#2a2a2a" stroke-width="3" fill="none"><polyline points="-32,40 -20,22 -8,40"/><line x1="-20" y1="22" x2="-20" y2="58"/></g>
<text x="14" y="62" font-family="ui-monospace, monospace" font-size="11" font-weight="700" fill="#2a2a2a">FRAGILE</text></g>`,
  ),
);

const moon = svgDocument(
  fragments(
    `<g transform="translate(540 80)"><animateTransform attributeName="transform" type="translate" values="540 200;540 80" dur="6s" fill="freeze"/>
<circle r="64" fill="#f3efd5" opacity="0.14"><animate attributeName="r" values="64;74;64" dur="6s" repeatCount="indefinite"/></circle>
<circle r="42" fill="#f3efd5"/><g fill="#d9d3b4" opacity="0.7"><circle cx="-14" cy="-12" r="7"/><circle cx="12" cy="10" r="5"/><circle cx="-4" cy="16" r="3"/></g></g>`,
  ),
);

const wrench = svgDocument(
  fragments(
    `<g transform="translate(120 220)"><g><animateTransform attributeName="transform" type="rotate" values="-18 0 0;18 0 0;-18 0 0" dur="2.2s" repeatCount="indefinite"/>
<rect x="-8" y="-30" width="16" height="130" rx="6" fill="#8a93a3"/>
<path d="M-28 -74 h56 v26 h-18 v16 h-20 v-16 h-18 z" fill="#8a93a3"/><rect x="-26" y="-52" width="52" height="4" fill="#5f6875"/>
<rect x="-8" y="70" width="16" height="30" fill="#c9463d"/></g></g>`,
    `<g fill="#5aa7d8"><circle cx="150" cy="300" r="4"><animate attributeName="cy" values="290;340" dur="1.1s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur="1.1s" repeatCount="indefinite"/></circle>
<circle cx="164" cy="300" r="3"><animate attributeName="cy" values="292;340" dur="1.5s" begin="0.5s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur="1.5s" begin="0.5s" repeatCount="indefinite"/></circle></g>`,
  ),
);

const recruiter = svgDocument(
  fragments(
    `<g><animateTransform attributeName="transform" type="translate" values="-260 0;40 0;40 0" keyTimes="0;0.3;1" dur="8s" fill="freeze"/>
<g transform="translate(0 286)"><rect x="0" y="-56" width="150" height="56" rx="6" fill="#e9c46a"/><rect x="10" y="-48" width="60" height="26" rx="3" fill="#fff7dd"/><rect x="80" y="-48" width="60" height="26" rx="3" fill="#fff7dd"/>
<rect x="150" y="-36" width="44" height="36" rx="4" fill="#e76f51"/><rect x="160" y="-30" width="24" height="14" rx="2" fill="#cfe6f5"/>
<g fill="#1a1a1a"><circle cx="34" cy="4" r="10"/><circle cx="120" cy="4" r="10"/><circle cx="176" cy="4" r="10"/></g><g fill="#888"><circle cx="34" cy="4" r="4"/><circle cx="120" cy="4" r="4"/><circle cx="176" cy="4" r="4"/></g>
<text x="20" y="-8" font-family="ui-monospace, monospace" font-size="10" font-weight="700" fill="#5b3a1e">BIFANAS · SIGNING BONUS</text></g>
<g transform="translate(60 160)"><rect x="-2" y="0" width="4" height="70" fill="#5b3a1e"/><rect x="-46" y="-30" width="92" height="34" rx="3" fill="#ffffff"/><text x="0" y="-8" text-anchor="middle" font-family="ui-monospace, monospace" font-size="11" font-weight="700" fill="#c9463d">NOW HIRING</text>
<animateTransform attributeName="transform" type="translate" values="60 160;60 154;60 160" dur="1.8s" repeatCount="indefinite"/></g></g>`,
  ),
);

const sparks = svgDocument(
  fragments(
    `<g fill="#fff4a8">${[
      [320, 200],
      [330, 214],
      [312, 222],
      [338, 196],
      [326, 232],
      [306, 206],
    ]
      .map(
        ([x, y], index) =>
          `<circle cx="${x}" cy="${y}" r="3.5" opacity="0"><animate attributeName="opacity" values="0;1;0" dur="${0.5 + (index % 3) * 0.2}s" begin="${index * 0.13}s" repeatCount="indefinite"/><animate attributeName="cy" values="${y};${y + 36}" dur="${0.5 + (index % 3) * 0.2}s" begin="${index * 0.13}s" repeatCount="indefinite"/></circle>`,
      )
      .join("")}</g>`,
    `<polyline points="320,150 310,180 328,178 312,210" fill="none" stroke="#fff4a8" stroke-width="3" stroke-linejoin="round" opacity="0"><animate attributeName="opacity" values="0;1;0;0;0;1;0;0;0;0" dur="2s" repeatCount="indefinite"/></polyline>`,
    `<rect width="640" height="360" fill="#fff4a8" opacity="0"><animate attributeName="opacity" values="0;0.12;0;0;0;0.08;0;0;0;0" dur="2s" repeatCount="indefinite"/></rect>`,
  ),
);

const gavel = svgDocument(
  fragments(
    `<g transform="translate(520 110)"><rect x="-70" y="80" width="120" height="12" rx="3" fill="#5b3a1e"/>
<g><animateTransform attributeName="transform" type="rotate" values="-50 0 0;12 0 0;-50 0 0" keyTimes="0;0.45;1" dur="1.4s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 1 1;0 0 0.2 1"/>
<rect x="-6" y="0" width="12" height="80" rx="4" fill="#8a5a2b"/><rect x="-34" y="-24" width="68" height="30" rx="6" fill="#6b4320"/></g>
<g fill="#fff4a8" opacity="0"><circle cx="-40" cy="76" r="3"/><circle cx="-52" cy="66" r="2"/><circle cx="-30" cy="64" r="2"/><animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.43;0.47;0.6;1" dur="1.4s" repeatCount="indefinite"/></g></g>`,
  ),
);

export const supplyLaborSprites: Record<string, string> = {
  crate,
  moon,
  wrench,
  recruiter,
  sparks,
  "auction-gavel": gavel,
};
