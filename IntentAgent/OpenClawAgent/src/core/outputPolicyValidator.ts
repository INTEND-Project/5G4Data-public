import { requestImpliesDeployment, requestImpliesLocality } from "../utils/prompting.js";

function requestImpliesNetworkQos(userText: string): boolean {
  const lowered = userText.toLowerCase();
  return [
    "latency",
    "bandwidth",
    "throughput",
    "qos",
    "jitter",
    "packet loss",
    "network",
    "response time",
    "delay"
  ].some((signal) => lowered.includes(signal));
}

function violatesOutputPolicy(text: string): boolean {
  const lowered = text.toLowerCase();
  const hasPlaceholder = ["<uuid4>", "<same-uuid4>", "<condition-id>"].some((m) =>
    lowered.includes(m)
  );
  const hasNarration = [
    "i will proceed",
    "please hold on",
    "now, i will",
    "now i will",
    "i will create the intent",
    "i will create"
  ].some((m) => lowered.includes(m));
  return hasPlaceholder || hasNarration;
}

export function looksLikeTurtleIntent(text: string): boolean {
  return text.includes("@prefix") && text.includes("icm:Intent");
}

export function collectOutputIssues(args: {
  text: string;
  userText: string;
  runtimeContext: string;
}): string[] {
  const { text, userText, runtimeContext } = args;
  const issues: string[] = [];
  const lowered = text.toLowerCase();
  const runtimeLowered = runtimeContext.toLowerCase();
  const runtimeHasSelectedWorkload =
    runtimeLowered.includes("[selected workload objectives]") || runtimeLowered.includes("selected chart:");

  if (violatesOutputPolicy(text)) {
    issues.push("Contains narration/progress text or placeholder markers.");
  }

  if (looksLikeTurtleIntent(text)) {
    if (runtimeLowered.includes("[deployment datacenter clarification required]")) {
      issues.push(
        "Deployment without geolocation hint requires a clarification question before generating Turtle."
      );
    }
    const requiredTokens = ["icm:Intent", "icm:ReportingExpectation"];
    if (runtimeHasSelectedWorkload || requestImpliesDeployment(userText)) {
      requiredTokens.push("data5g:DeploymentExpectation");
    }
    if (requestImpliesNetworkQos(userText)) {
      requiredTokens.push("data5g:NetworkExpectation");
    }
    const missing = requiredTokens.filter((token) => !text.includes(token));
    if (missing.length > 0) {
      issues.push(`Missing required classes/blocks: ${missing.join(", ")}`);
    }
    if (
      requestImpliesLocality(userText) &&
      text.includes("data5g:DeploymentExpectation") &&
      !text.includes("data5g:DataCenter")
    ) {
      issues.push("Missing data5g:DataCenter for locality-aware deployment.");
    }
    if (
      requestImpliesLocality(userText) &&
      requestImpliesNetworkQos(userText) &&
      text.includes("data5g:NetworkExpectation")
    ) {
      if (!text.includes("data5g:appliesToRegion")) {
        issues.push("NetworkExpectation with geographic intent must include data5g:appliesToRegion.");
      }
      if (!text.includes("geo:Feature") || !text.includes("geo:asWKT")) {
        issues.push("Network region must be encoded as geo:Feature with geo:asWKT.");
      }
    }
  }

  if (lowered.includes("please provide the following details")) {
    issues.push("Asked for details that should be auto-filled by defaults policy.");
  }
  if (lowered.includes("please provide") && lowered.includes("handler")) {
    issues.push("Asked user for handler though handler is fixed.");
  }
  if (lowered.includes("please provide") && lowered.includes("owner")) {
    issues.push("Asked user for owner though owner is fixed.");
  }
  return issues;
}
