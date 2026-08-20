/**
 * The readability gate for the shipped stories' prose (reading age ten, no
 * slop): a pure report over every text field a player reads — beats (node
 * beats and roll-branch beats), fork scenes, option labels, action labels,
 * endings, and the picker blurb — and the assertions the rewriters drive to
 * green. Structure is the validator's job (src/story/validate.ts); this
 * suite is only about the words.
 *
 * Rules, per story:
 *   - no em dashes or en dashes anywhere (full stops and commas instead)
 *   - no semicolons in prose (the semicolon is this text's em dash)
 *   - mean sentence length at most MAX_MEAN_SENTENCE_WORDS, no sentence
 *     longer than MAX_SENTENCE_WORDS
 *   - beats average at most MAX_MEAN_BEAT_WORDS words and run to at most
 *     MAX_BEAT_SENTENCES sentences (one idea per beat)
 *   - every fork scene ends with its question
 *   - option and action labels are at most MAX_LABEL_WORDS words (the
 *     client shows them as buttons under the question)
 *
 * `readabilityReport` is exported so a scratch script can print the whole
 * offender list while rewriting.
 */

import { describe, expect, it } from "vitest";
import { fillName, type Story } from "../src/story/format";
import { datacenterStory, odysseyStory } from "../src/stories";

export const MAX_SENTENCE_WORDS = 22;
export const MAX_MEAN_SENTENCE_WORDS = 14;
export const MAX_MEAN_BEAT_WORDS = 14;
export const MAX_BEAT_SENTENCES = 2;
export const MAX_LABEL_WORDS = 4;

export type TextField = "beat" | "scene" | "option" | "action" | "ending" | "blurb";

export interface TextUnit {
  field: TextField;
  /** The node the text belongs to ("(story)" for the blurb and the standing set). */
  node: string;
  /** The text as the player reads it: "{name}" filled with the story's default name. */
  text: string;
}

export interface Offender {
  node: string;
  field: TextField;
  text: string;
  /** What tripped the rule (a count, the sentence, ...). */
  detail: string;
}

export interface ReadabilityReport {
  units: number;
  sentences: number;
  meanSentenceWords: number;
  meanBeatWords: number;
  dashes: Offender[];
  semicolons: Offender[];
  longSentences: Offender[];
  longBeats: Offender[];
  forksWithoutQuestion: Offender[];
  longOptionLabels: Offender[];
  longActionLabels: Offender[];
}

/** Whitespace-delimited words. */
export function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

/**
 * Sentences of a text: split after terminal punctuation (optionally closed
 * by a quote or bracket) when the next sentence opens with a capital, a
 * digit, or an opening quote. "a.m.", "p.m.", decimals, and common
 * abbreviations do not end a sentence.
 */
export function sentencesOf(text: string): string[] {
  const protectedText = text
    .replace(/\b([ap])\.m\./gi, "$1m")
    .replace(/(\d)\.(\d)/g, "$1$2")
    .replace(/\b(Mr|Mrs|Ms|Dr|St|No|vs|etc)\./g, "$1");
  return protectedText
    .split(/(?<=[.!?]["')\]]?)\s+(?=["'({[]?[A-Z0-9{])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** Every text a player reads, in node order. */
export function textUnits(story: Story): TextUnit[] {
  const name = story.defaultName;
  const units: TextUnit[] = [
    { field: "blurb", node: "(story)", text: fillName(story.blurb, name) },
  ];
  for (const action of story.actions ?? []) {
    units.push({ field: "action", node: "(story)", text: fillName(action.label, name) });
  }
  for (const [id, node] of Object.entries(story.nodes)) {
    for (const beat of node.beats) {
      units.push({ field: "beat", node: id, text: fillName(beat, name) });
    }
    for (const branch of node.roll?.branches ?? []) {
      if (branch.beat !== undefined) {
        units.push({ field: "beat", node: id, text: fillName(branch.beat, name) });
      }
    }
    if (node.decision !== undefined) {
      units.push({ field: "scene", node: id, text: fillName(node.decision.scene, name) });
      for (const option of node.decision.options) {
        units.push({ field: "option", node: id, text: fillName(option.label, name) });
      }
    }
    for (const action of node.actions ?? []) {
      units.push({ field: "action", node: id, text: fillName(action.label, name) });
    }
    if (node.ending !== undefined) {
      units.push({ field: "ending", node: id, text: fillName(node.ending.prose, name) });
    }
  }
  return units;
}

function offender(unit: TextUnit, detail: string): Offender {
  return { node: unit.node, field: unit.field, text: unit.text, detail };
}

/** The pure readability report over every text unit of a story. */
export function readabilityReport(story: Story): ReadabilityReport {
  const units = textUnits(story);
  const dashes: Offender[] = [];
  const semicolons: Offender[] = [];
  const longSentences: Offender[] = [];
  const longBeats: Offender[] = [];
  const forksWithoutQuestion: Offender[] = [];
  const longOptionLabels: Offender[] = [];
  const longActionLabels: Offender[] = [];
  let sentenceCount = 0;
  let sentenceWords = 0;
  let beatCount = 0;
  let beatWords = 0;

  for (const unit of units) {
    const dashCount = (unit.text.match(/[–—]/g) ?? []).length;
    if (dashCount > 0) {
      dashes.push(offender(unit, `${dashCount} dash(es)`));
    }
    const semicolonCount = (unit.text.match(/;/g) ?? []).length;
    if (semicolonCount > 0) {
      semicolons.push(offender(unit, `${semicolonCount} semicolon(s)`));
    }
    const sentences = sentencesOf(unit.text);
    for (const sentence of sentences) {
      const words = wordCount(sentence);
      sentenceCount += 1;
      sentenceWords += words;
      if (words > MAX_SENTENCE_WORDS) {
        longSentences.push(offender(unit, `${words} words: "${sentence}"`));
      }
    }
    switch (unit.field) {
      case "beat": {
        const words = wordCount(unit.text);
        beatCount += 1;
        beatWords += words;
        if (sentences.length > MAX_BEAT_SENTENCES) {
          longBeats.push(offender(unit, `${sentences.length} sentences`));
        }
        break;
      }
      case "scene":
        if (!unit.text.trimEnd().endsWith("?")) {
          forksWithoutQuestion.push(offender(unit, "does not end with ?"));
        }
        break;
      case "option": {
        const words = wordCount(unit.text);
        if (words > MAX_LABEL_WORDS) {
          longOptionLabels.push(offender(unit, `${words} words`));
        }
        break;
      }
      case "action": {
        const words = wordCount(unit.text);
        if (words > MAX_LABEL_WORDS) {
          longActionLabels.push(offender(unit, `${words} words`));
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    units: units.length,
    sentences: sentenceCount,
    meanSentenceWords: sentenceCount === 0 ? 0 : sentenceWords / sentenceCount,
    meanBeatWords: beatCount === 0 ? 0 : beatWords / beatCount,
    dashes,
    semicolons,
    longSentences,
    longBeats,
    forksWithoutQuestion,
    longOptionLabels,
    longActionLabels,
  };
}

/** A failure message: the count, then the first few offenders. */
function describeOffenders(label: string, offenders: Offender[]): string {
  const sample = offenders
    .slice(0, 5)
    .map((entry) => `  ${entry.node} [${entry.field}] ${entry.detail}: ${entry.text}`)
    .join("\n");
  return `${offenders.length} ${label}\n${sample}${offenders.length > 5 ? "\n  ..." : ""}`;
}

const STORIES = [datacenterStory, odysseyStory];

describe("story prose reads at age ten (the readability gate)", () => {
  for (const story of STORIES) {
    describe(story.id, () => {
      const report = readabilityReport(story);

      it("has no em dashes or en dashes in any beat, scene, option label, action label, ending, or blurb", () => {
        expect(report.dashes.length, describeOffenders("texts with dashes", report.dashes)).toBe(0);
      });

      it("has no semicolons in prose (use a full stop or a comma)", () => {
        expect(
          report.semicolons.length,
          describeOffenders("texts with semicolons", report.semicolons),
        ).toBe(0);
      });

      it(`averages at most ${MAX_MEAN_SENTENCE_WORDS} words per sentence`, () => {
        expect(
          report.meanSentenceWords,
          `mean sentence length ${report.meanSentenceWords.toFixed(2)} words over ${report.sentences} sentences`,
        ).toBeLessThanOrEqual(MAX_MEAN_SENTENCE_WORDS);
      });

      it(`has no sentence longer than ${MAX_SENTENCE_WORDS} words`, () => {
        expect(
          report.longSentences.length,
          describeOffenders(`sentences over ${MAX_SENTENCE_WORDS} words`, report.longSentences),
        ).toBe(0);
      });

      it(`averages at most ${MAX_MEAN_BEAT_WORDS} words per beat`, () => {
        expect(
          report.meanBeatWords,
          `mean beat length ${report.meanBeatWords.toFixed(2)} words`,
        ).toBeLessThanOrEqual(MAX_MEAN_BEAT_WORDS);
      });

      it(`has no beat longer than ${MAX_BEAT_SENTENCES} sentences`, () => {
        expect(
          report.longBeats.length,
          describeOffenders(`beats over ${MAX_BEAT_SENTENCES} sentences`, report.longBeats),
        ).toBe(0);
      });

      it("ends every fork scene with its question", () => {
        expect(
          report.forksWithoutQuestion.length,
          describeOffenders("fork scenes without a question", report.forksWithoutQuestion),
        ).toBe(0);
      });

      it(`keeps option labels to ${MAX_LABEL_WORDS} words`, () => {
        expect(
          report.longOptionLabels.length,
          describeOffenders(`option labels over ${MAX_LABEL_WORDS} words`, report.longOptionLabels),
        ).toBe(0);
      });

      it(`keeps action labels to ${MAX_LABEL_WORDS} words`, () => {
        expect(
          report.longActionLabels.length,
          describeOffenders(`action labels over ${MAX_LABEL_WORDS} words`, report.longActionLabels),
        ).toBe(0);
      });
    });
  }
});

describe("the sentence splitter", () => {
  it("splits on terminal punctuation and keeps a.m., decimals, and quoted endings whole", () => {
    expect(sentencesOf("At 4:47 a.m. the ground moves. The crane is swinging!")).toEqual([
      "At 4:47 am the ground moves.",
      "The crane is swinging!",
    ]);
    expect(sentencesOf("The headline reads 'Smooth Sailing'. Nobody laughs.")).toEqual([
      "The headline reads 'Smooth Sailing'.",
      "Nobody laughs.",
    ]);
    expect(sentencesOf("Where does Nortada One put its chips?")).toEqual([
      "Where does Nortada One put its chips?",
    ]);
    expect(wordCount("  one two   three ")).toBe(3);
  });
});
