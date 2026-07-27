import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemPrompt,
  stripMarkdownCodeFenceDelimiters
} from "../utils/prompting.js";

test("stripMarkdownCodeFenceDelimiters removes turtle fence lines but keeps content", () => {
  const markdown = `Example skeleton:

\`\`\`turtle
@prefix data5g: <http://5g4data.eu/5g4data#> .
data5g:I11112222333344445555666677778888 a icm:Intent .
\`\`\`

More prose.`;
  const stripped = stripMarkdownCodeFenceDelimiters(markdown);
  assert.doesNotMatch(stripped, /```/);
  assert.match(stripped, /@prefix data5g:/);
  assert.match(stripped, /More prose/);
});

test("stripMarkdownCodeFenceDelimiters preserves prose outside fences", () => {
  const markdown = "Intro text\n\n\`\`\`yaml\nkey: value\n\`\`\`\n\nOutro text";
  const stripped = stripMarkdownCodeFenceDelimiters(markdown);
  assert.match(stripped, /Intro text/);
  assert.match(stripped, /key: value/);
  assert.match(stripped, /Outro text/);
  assert.doesNotMatch(stripped, /```/);
});

test("buildSystemPrompt strips fence delimiters from injected skill text", () => {
  const prompt = buildSystemPrompt(
    "System rules.",
    "---\nname: test\n---\n\n\`\`\`turtle\n@prefix ex: <http://example/> .\n\`\`\`"
  );
  assert.doesNotMatch(prompt, /```/);
  assert.match(prompt, /@prefix ex:/);
});
