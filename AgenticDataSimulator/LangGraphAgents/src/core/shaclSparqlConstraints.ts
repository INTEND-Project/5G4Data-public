import type { Store } from "n3";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const ICM = "http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/";
const DATA5G = "http://5g4data.eu/5g4data#";
const GEO = "http://www.opengis.net/ont/geosparql#";
const SET = "http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/";
const LOG = "http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/";
const UT = "http://tio.models.tmforum.org/tio/v3.6.0/Utility/";
const FUN = "http://tio.models.tmforum.org/tio/v3.6.0/FunctionOntology/";
const TIME = "http://tio.models.tmforum.org/tio/v3.8.0/TimeOntology/";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const QUAN = "http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/";

export interface ShaclViolation {
  focusNode?: string;
  path?: string;
  message: string;
}

function localName(iri: string): string {
  const hash = iri.lastIndexOf("#");
  if (hash >= 0) return iri.slice(hash + 1);
  const slash = iri.lastIndexOf("/");
  return slash >= 0 ? iri.slice(slash + 1) : iri;
}

function hasType(store: Store, node: string, typeIri: string): boolean {
  return store.getQuads(node, RDF_TYPE, typeIri, null).length > 0;
}

function allOfMembers(store: Store, subject: string): string[] {
  return store.getObjects(subject, `${LOG}allOf`, null).map((term) => term.value);
}

function reportingTargets(store: Store, intentIri: string): Set<string> {
  const targets = new Set<string>();
  for (const member of allOfMembers(store, intentIri)) {
    if (
      !hasType(store, member, `${ICM}ReportingExpectation`) &&
      !hasType(store, member, `${ICM}ObservationReportingExpectation`)
    ) {
      continue;
    }
    for (const target of store.getObjects(member, `${ICM}target`, null)) {
      targets.add(target.value);
    }
  }
  return targets;
}

function expectReportingForExpectation(args: {
  store: Store;
  intentIri: string;
  expectationType: string;
  reportingTarget: string;
  message: string;
}): ShaclViolation | null {
  const members = allOfMembers(args.store, args.intentIri);
  const hasExpectation = members.some((member) => hasType(args.store, member, args.expectationType));
  if (!hasExpectation) return null;
  const targets = reportingTargets(args.store, args.intentIri);
  if (targets.has(args.reportingTarget)) return null;
  return {
    focusNode: localName(args.intentIri),
    path: "log:allOf",
    message: args.message
  };
}

function networkMetricExists(store: Store, networkExpectation: string, prefix: string): boolean {
  for (const member of allOfMembers(store, networkExpectation)) {
    if (!hasType(store, member, `${ICM}Condition`)) continue;
    for (const forAll of store.getObjects(member, `${SET}forAll`, null)) {
      for (const metric of store.getObjects(forAll, `${ICM}valuesOfTargetProperty`, null)) {
        if (metric.value.startsWith(`${DATA5G}${prefix}`)) return true;
      }
    }
  }
  return false;
}

function metricConditionCount(store: Store, expectationIri: string): number {
  let count = 0;
  for (const member of allOfMembers(store, expectationIri)) {
    if (!hasType(store, member, `${ICM}Condition`)) continue;
    if (store.getObjects(member, `${SET}forAll`, null).length === 0) continue;
    count++;
  }
  return count;
}

function coordinationForMetricCount(store: Store, coordinationIri: string): number | null {
  for (const utility of store.getObjects(coordinationIri, `${UT}utility`, null)) {
    return store.getObjects(utility, `${UT}forMetric`, null).length;
  }
  return null;
}

function expectationHasForbiddenDuration(
  store: Store,
  expectationIri: string,
  expectationLabel: string
): ShaclViolation | null {
  if (store.getQuads(expectationIri, `${TIME}numericDuration`, null, null).length > 0) {
    return {
      focusNode: localName(expectationIri),
      path: "time:numericDuration",
      message: `${expectationLabel} must not declare time:numericDuration; use scoped reporting duration nodes instead.`
    };
  }
  if (store.getQuads(expectationIri, `${TIME}unitType`, null, null).length > 0) {
    return {
      focusNode: localName(expectationIri),
      path: "time:unitType",
      message: `${expectationLabel} must not declare time:unitType; use scoped reporting duration nodes instead.`
    };
  }
  return null;
}

function coordinationUtilityArityMax(store: Store, coordinationIri: string): number | null {
  for (const utility of store.getObjects(coordinationIri, `${UT}utility`, null)) {
    for (const fn of store.getObjects(utility, `${UT}function`, null)) {
      for (const arity of store.getObjects(fn, `${FUN}arityMax`, null)) {
        const parsed = Number(arity.value);
        if (!Number.isNaN(parsed)) return parsed;
      }
    }
  }
  return null;
}

export function validateShaclSparqlConstraints(store: Store): ShaclViolation[] {
  const violations: ShaclViolation[] = [];

  for (const intentQuad of store.getQuads(null, RDF_TYPE, `${ICM}Intent`, null)) {
    const intentIri = intentQuad.subject.value;

    const coverageChecks = [
      {
        expectationType: `${DATA5G}DeploymentExpectation`,
        reportingTarget: `${DATA5G}deployment`,
        message:
          "When deployment expectation is present, a reporting expectation targeting data5g:deployment must also be present in intent log:allOf."
      },
      {
        expectationType: `${DATA5G}NetworkExpectation`,
        reportingTarget: `${DATA5G}network-slice`,
        message:
          "When network expectation is present, a reporting expectation targeting data5g:network-slice must also be present in intent log:allOf."
      },
      {
        expectationType: `${DATA5G}SustainabilityExpectation`,
        reportingTarget: `${DATA5G}sustainability`,
        message:
          "When sustainability expectation is present, a reporting expectation targeting data5g:sustainability must also be present in intent log:allOf."
      },
      {
        expectationType: `${DATA5G}CoordinationExpectation`,
        reportingTarget: `${DATA5G}coordination-service`,
        message:
          "When coordination expectation is present, a reporting expectation targeting data5g:coordination-service must also be present in intent log:allOf."
      }
    ] as const;

    for (const check of coverageChecks) {
      const violation = expectReportingForExpectation({
        store,
        intentIri,
        expectationType: check.expectationType,
        reportingTarget: check.reportingTarget,
        message: check.message
      });
      if (violation) violations.push(violation);
    }
  }

  for (const ceQuad of store.getQuads(null, RDF_TYPE, `${DATA5G}CoordinationExpectation`, null)) {
    const ceIri = ceQuad.subject.value;
    const coCount = metricConditionCount(store, ceIri);
    if (coCount === 0) {
      violations.push({
        focusNode: localName(ceIri),
        path: "log:allOf",
        message:
          "CoordinationExpectation must reference at least one metric condition (icm:Condition with set:forAll) in log:allOf."
      });
      continue;
    }
    const arity = coordinationUtilityArityMax(store, ceIri);
    if (arity !== null && coCount !== arity) {
      violations.push({
        focusNode: localName(ceIri),
        path: "log:allOf",
        message:
          "CoordinationExpectation metric condition count must match linked utility function arityMax."
      });
    }
    const forMetricCount = coordinationForMetricCount(store, ceIri);
    if (forMetricCount !== null && forMetricCount !== coCount) {
      violations.push({
        focusNode: localName(ceIri),
        path: "ut:forMetric",
        message: "ut:forMetric count must match CoordinationExpectation metric condition count."
      });
    }
    const durationViolation = expectationHasForbiddenDuration(
      store,
      ceIri,
      "CoordinationExpectation"
    );
    if (durationViolation) violations.push(durationViolation);
  }

  for (const deQuad of store.getQuads(null, RDF_TYPE, `${DATA5G}DeploymentExpectation`, null)) {
    const violation = expectationHasForbiddenDuration(
      store,
      deQuad.subject.value,
      "DeploymentExpectation"
    );
    if (violation) violations.push(violation);
  }

  for (const seQuad of store.getQuads(null, RDF_TYPE, `${DATA5G}SustainabilityExpectation`, null)) {
    const violation = expectationHasForbiddenDuration(
      store,
      seQuad.subject.value,
      "SustainabilityExpectation"
    );
    if (violation) violations.push(violation);
  }

  for (const fnQuad of store.getQuads(null, RDF_TYPE, `${FUN}function`, null)) {
    const fnIri = fnQuad.subject.value;
    if (!localName(fnIri).includes("utilityFn_") && !/^UN[0-9a-f]{32}$/i.test(localName(fnIri))) continue;
    const valueNodes = store.getObjects(fnIri, `${RDF}value`, null);
    if (valueNodes.length > 1) {
      violations.push({
        focusNode: localName(fnIri),
        path: "rdf:value",
        message: "Coordination utility function must have exactly one rdf:value."
      });
      continue;
    }
    for (const valueNode of valueNodes) {
      const sums = store.getObjects(valueNode, `${QUAN}sum`, null);
      if (sums.length > 1) {
        violations.push({
          focusNode: localName(fnIri),
          path: "quan:sum",
          message: "Coordination utility function rdf:value must contain exactly one quan:sum."
        });
      }
    }
  }

  for (const networkQuad of store.getQuads(null, RDF_TYPE, `${DATA5G}NetworkExpectation`, null)) {
    const networkIri = networkQuad.subject.value;
    if (!networkMetricExists(store, networkIri, "bandwidth_")) {
      violations.push({
        focusNode: localName(networkIri),
        path: "log:allOf",
        message:
          "NetworkExpectation must include at least one referenced condition using a bandwidth metric property (data5g:bandwidth_*)."
      });
    }
    if (!networkMetricExists(store, networkIri, "latency_")) {
      violations.push({
        focusNode: localName(networkIri),
        path: "log:allOf",
        message:
          "NetworkExpectation must include at least one referenced condition using a latency metric property (data5g:latency_*)."
      });
    }
  }

  for (const contextQuad of store.getQuads(null, RDF_TYPE, `${ICM}Context`, null)) {
    const contextIri = contextQuad.subject.value;
    const hasDeploymentDescriptor =
      store.getQuads(contextIri, `${DATA5G}DeploymentDescriptor`, null, null).length > 0;
    const hasDataCenter = store.getQuads(contextIri, `${DATA5G}DataCenter`, null, null).length > 0;
    if (hasDeploymentDescriptor && !hasDataCenter) {
      violations.push({
        focusNode: localName(contextIri),
        path: "data5g:DataCenter",
        message:
          "A context with deployment semantics must include exactly one data5g:DataCenter and one data5g:DeploymentDescriptor."
      });
    }

    const hasRegion = store.getQuads(contextIri, `${DATA5G}appliesToRegion`, null, null).length > 0;
    const hasCustomer = store.getQuads(contextIri, `${DATA5G}appliesToCustomer`, null, null).length > 0;
    if (hasRegion && !hasCustomer) {
      violations.push({
        focusNode: localName(contextIri),
        path: "data5g:appliesToCustomer",
        message: "A context with appliesToRegion must also include appliesToCustomer."
      });
    }

    for (const regionQuad of store.getQuads(contextIri, `${DATA5G}appliesToRegion`, null, null)) {
      if (!hasType(store, regionQuad.object.value, `${GEO}Feature`)) {
        violations.push({
          focusNode: localName(contextIri),
          path: "data5g:appliesToRegion",
          message: "data5g:appliesToRegion must point to a geo:Feature."
        });
      }
    }
  }

  return violations;
}
