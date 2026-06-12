import type { Store } from "n3";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const ICM = "http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/";
const DATA5G = "http://5g4data.eu/5g4data#";
const GEO = "http://www.opengis.net/ont/geosparql#";
const SET = "http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/";
const LOG = "http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/";

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
      for (const metric of store.getObjects(forAll.value, `${ICM}valuesOfTargetProperty`, null)) {
        if (metric.value.startsWith(`${DATA5G}${prefix}`)) return true;
      }
    }
  }
  return false;
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
