#!/usr/bin/env npx tsx
/**
 * Pretty-print GraphDB-style intent Turtle (resolves blank nodes, RDF lists).
 *
 * Usage:
 *   cat raw.ttl | npx tsx scripts/pretty-print-intent-turtle.mts
 */
import { readFileSync } from "node:fs";
import { prettyPrintIntentTurtle } from "../SimulatorAgentPackages/5g4data-intent-generation-mistral-small4/tools/prettyPrintIntentTurtle.ts";

const raw = readFileSync(0, "utf8");
process.stdout.write(prettyPrintIntentTurtle(raw));
