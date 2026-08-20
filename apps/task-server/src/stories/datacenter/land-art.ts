/**
 * Art for the site/permits arc: the potsherd, the cork oak (under the
 * "almond" key, which predates the move to Sines), the banjo, and the gavel
 * sprites.
 */

import type { StoryInput } from "../../story/format";
import { fragments, svgDocument } from "../../story/svg";

type SpriteTable = StoryInput["sprites"];

const potsherd = svgDocument(
  fragments(
    `<g transform="translate(430 250)">`,
    `<animateTransform attributeName="transform" type="translate" values="430 290;430 246;430 250" dur="1.4s" fill="freeze"/>`,
    `<path d="M-46 10 C-40 -30 -10 -44 26 -38 C44 -34 48 -16 40 8 C30 32 -8 40 -32 28 C-42 23 -48 18 -46 10 Z" fill="#a0613a" stroke="#5b3a1e" stroke-width="2"/>`,
    `<path d="M-30 8 L-16 -8 L-2 6 L12 -10 L26 4" fill="none" stroke="#3a2412" stroke-width="3" stroke-linejoin="round"/>`,
    `<path d="M-38 20 Q0 30 34 18" fill="none" stroke="#3a2412" stroke-width="2" opacity="0.7"/>`,
    `</g>`,
    `<g fill="#d9c4a0" opacity="0.7"><circle cx="395" cy="296" r="5"><animate attributeName="r" values="3;10;3" dur="1.6s" repeatCount="2"/><animate attributeName="opacity" values="0.7;0;0.7" dur="1.6s" repeatCount="2"/></circle>`,
    `<circle cx="470" cy="298" r="4"><animate attributeName="r" values="2;8;2" dur="1.3s" repeatCount="2"/><animate attributeName="opacity" values="0.7;0;0.7" dur="1.3s" repeatCount="2"/></circle></g>`,
  ),
);

function acorn(x: number, delay: number): string {
  return `<ellipse cx="${x}" cy="170" rx="3" ry="4.5" fill="#8b5a2b" opacity="0.9">
<animate attributeName="cy" values="170;330" dur="${4 + delay}s" begin="${delay}s" repeatCount="indefinite"/>
<animate attributeName="cx" values="${x};${x + 14};${x - 6};${x + 10}" dur="${4 + delay}s" begin="${delay}s" repeatCount="indefinite"/>
<animate attributeName="opacity" values="0.9;0.9;0" dur="${4 + delay}s" begin="${delay}s" repeatCount="indefinite"/></ellipse>`;
}

/** A cork oak: the stripped orange trunk, a dark canopy, and acorns dropping. */
const almond = svgDocument(
  fragments(
    `<g transform="translate(120 0)">`,
    `<rect x="-7" y="210" width="14" height="80" fill="#a0522d"/>`,
    `<rect x="-7" y="210" width="14" height="28" fill="#6b4a2b"/>`,
    `<path d="M0 215 L-22 185 M0 205 L24 178 M0 225 L-14 200" stroke="#6b4a2b" stroke-width="6" stroke-linecap="round"/>`,
    `<g fill="#4f6b3a"><circle cx="-30" cy="176" r="28"/><circle cx="8" cy="158" r="34"/><circle cx="40" cy="180" r="26"/><circle cx="4" cy="196" r="24"/></g>`,
    `<g fill="#6b8a4a"><circle cx="-22" cy="168" r="6"/><circle cx="18" cy="150" r="7"/><circle cx="42" cy="176" r="5"/><circle cx="-4" cy="190" r="5"/></g>`,
    `<g fill="#8a9c4e"><ellipse cx="-48" cy="300" rx="34" ry="5"/><ellipse cx="52" cy="302" rx="28" ry="5"/></g>`,
    `</g>`,
    acorn(100, 0),
    acorn(140, 1.2),
    acorn(160, 2.1),
    acorn(120, 0.6),
  ),
);

function note(x: number, delay: number): string {
  return `<g transform="translate(${x} 230)" fill="#f6821f" opacity="0">
<animateTransform attributeName="transform" type="translate" values="${x} 230;${x + 12} 150;${x - 4} 80" dur="3s" begin="${delay}s" repeatCount="indefinite"/>
<animate attributeName="opacity" values="0;1;0" dur="3s" begin="${delay}s" repeatCount="indefinite"/>
<ellipse cx="0" cy="0" rx="7" ry="5" transform="rotate(-20)"/><rect x="5" y="-26" width="3" height="27"/><path d="M8 -26 q12 4 10 16" fill="none" stroke="#f6821f" stroke-width="3"/></g>`;
}

const banjo = svgDocument(
  fragments(
    // Outer group places the banjo; the inner group strums (rotates about its own origin).
    `<g transform="translate(520 262)"><g>`,
    `<animateTransform attributeName="transform" type="rotate" values="-28;-24;-28" dur="0.5s" repeatCount="indefinite"/>`,
    `<circle r="40" fill="#f1dcb4" stroke="#6b4a2b" stroke-width="6"/>`,
    `<rect x="-5" y="-150" width="10" height="112" fill="#6b4a2b"/>`,
    `<rect x="-10" y="-160" width="20" height="14" rx="3" fill="#3a2412"/>`,
    `<g stroke="#e8e8e8" stroke-width="1"><line x1="-6" y1="-150" x2="-6" y2="30"/><line x1="-2" y1="-150" x2="-2" y2="30"/><line x1="2" y1="-150" x2="2" y2="30"/><line x1="6" y1="-150" x2="6" y2="30"/></g>`,
    `<rect x="-12" y="12" width="24" height="5" fill="#3a2412"/>`,
    `</g></g>`,
    note(470, 0),
    note(500, 0.9),
    note(440, 1.7),
  ),
);

const gavel = svgDocument(
  fragments(
    // The gavel pivots at the hand (outer translate); the handle runs along +x to the head.
    `<g transform="translate(440 170)"><g>`,
    `<animateTransform attributeName="transform" type="rotate" values="-10;35;-10" keyTimes="0;0.2;1" dur="1.8s" repeatCount="indefinite"/>`,
    `<rect x="0" y="-6" width="110" height="12" rx="4" fill="#6b4a2b"/>`,
    `<rect x="92" y="-42" width="40" height="84" rx="8" fill="#8a5a2e" stroke="#3a2412" stroke-width="3"/>`,
    `</g></g>`,
    `<rect x="480" y="262" width="140" height="16" rx="4" fill="#5b3a1e"/>`,
    `<g stroke="#f3d35b" stroke-width="3" opacity="0"><animate attributeName="opacity" values="0;1;0;0" keyTimes="0;0.2;0.35;1" dur="1.8s" repeatCount="indefinite"/>`,
    `<line x1="572" y1="236" x2="590" y2="218"/><line x1="584" y1="254" x2="610" y2="252"/><line x1="556" y1="228" x2="560" y2="204"/></g>`,
  ),
);

/** Overlays this arc fires; merge into the datacenter story's `sprites`. */
export const landPermitsSprites: SpriteTable = { potsherd, almond, banjo, gavel };
