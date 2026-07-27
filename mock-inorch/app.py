"""mock-inorch: a minimal stand-in for inOrch-TMF-Proxy.

It presents the same TMF921 intent endpoint that inServ routes a
DeploymentExpectation to (`POST /tmf-api/intentManagement/v5/intent`), parses the
Helm chart URL + application name out of the Turtle expression, and deploys the
workload with a plain `helm upgrade --install`.

Everything inOrch does that we do NOT need for a local rusty-llm energy study is
skipped on purpose: no GraphDB domain lookup, no ChartMuseum download/host
rewrite, no image-pull-secret copying, no INTEND Intent/KPIProfile CR injection.
InSustain (via Kepler) measures the resulting pod regardless of namespace.
"""

import logging
import os
import subprocess
import uuid

from flask import Flask, jsonify, request
from rdflib import Graph, Namespace, RDF, URIRef

# --- Config (env-overridable) ------------------------------------------------
PORT = int(os.getenv("MOCK_INORCH_PORT", "3020"))
HOST = os.getenv("MOCK_INORCH_HOST", "0.0.0.0")
API_PATH = os.getenv("API_PATH", "/tmf-api/intentManagement/v5")

# Local chart to install. Defaults to the packaged rusty-llm the Workload-Catalog
# already serves, resolved relative to this file so it works from any cwd.
_DEFAULT_CHART = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "Workload-Catalog",
    "charts",
    "rusty-llm-0.1.26.tgz",
)
CHART_PATH = os.path.abspath(os.getenv("MOCK_INORCH_CHART", _DEFAULT_CHART))
RELEASE = os.getenv("MOCK_INORCH_RELEASE", "rusty-llm")
KUBE_CONTEXT = os.getenv("MOCK_INORCH_KUBE_CONTEXT", "")  # empty = current context
# Namespace: default to the app name from the intent; overridable to pin it.
FIXED_NAMESPACE = os.getenv("MOCK_INORCH_NAMESPACE", "")
# Extra `--set` flags. The two CR guards keep us off the (absent) INTEND CRDs.
HELM_SET = os.getenv(
    "MOCK_INORCH_HELM_SET",
    "intent.enabled=false,kpiProfile.enabled=false",
)
HELM_TIMEOUT = os.getenv("MOCK_INORCH_HELM_TIMEOUT", "600s")
HELM_WAIT = os.getenv("MOCK_INORCH_HELM_WAIT", "false").lower() in ("1", "true", "yes")

DATA5G_NS = Namespace("http://5g4data.eu/5g4data#")

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s [mock-inorch] %(message)s",
)
logger = logging.getLogger("mock-inorch")

app = Flask(__name__)


# --- Turtle parsing ----------------------------------------------------------
def _find_context_for_deployment(graph):
    """Return the Context node linked from a DeploymentExpectation via log:allOf.

    Falls back to any node carrying a data5g:DeploymentDescriptor if the
    expectation->context link is not structured as expected.
    """
    log_all_of = URIRef(
        "http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/allOf"
    )
    de_type = DATA5G_NS.DeploymentExpectation
    descriptor = DATA5G_NS.DeploymentDescriptor

    for de in graph.subjects(RDF.type, de_type):
        for member in graph.objects(de, log_all_of):
            if (member, descriptor, None) in graph:
                return member
    # Fallback: first subject that has a DeploymentDescriptor at all.
    for subj in graph.subjects(descriptor, None):
        return subj
    return None


def parse_deployment_info(turtle_data):
    """Extract {application, deployment_descriptor} from the intent Turtle.

    Mirrors inServ's TurtleParser.parse_deployment_info contract.
    """
    graph = Graph()
    graph.parse(data=turtle_data, format="turtle")

    context = _find_context_for_deployment(graph)
    if context is None:
        return None

    def _first(prop):
        for obj in graph.objects(context, DATA5G_NS[prop]):
            return str(obj)
        return None

    descriptor = _first("DeploymentDescriptor")
    application = _first("Application")
    if not descriptor:
        return None

    return {
        "deployment_descriptor": descriptor,
        "application": application,
    }


# --- Helm deploy -------------------------------------------------------------
def deploy(namespace):
    """Run `helm upgrade --install` for the local rusty-llm chart."""
    cmd = ["helm", "upgrade", "--install", RELEASE, CHART_PATH]
    if KUBE_CONTEXT:
        cmd += ["--kube-context", KUBE_CONTEXT]
    cmd += ["--namespace", namespace, "--create-namespace"]
    if HELM_SET:
        cmd += ["--set", HELM_SET]
    if HELM_WAIT:
        cmd += ["--wait", "--timeout", HELM_TIMEOUT]

    logger.info("Deploying: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        logger.error("helm failed (%d):\n%s", result.returncode, result.stderr)
        return False, result.stderr.strip() or result.stdout.strip()
    logger.info("helm ok:\n%s", result.stdout)
    return True, result.stdout.strip()


# --- Routes ------------------------------------------------------------------
@app.get("/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "role": "mock-inorch",
            "chart": CHART_PATH,
            "release": RELEASE,
            "kube_context": KUBE_CONTEXT or "(current)",
        }
    )


@app.post(f"{API_PATH}/intent")
def create_intent():
    body = request.get_json(silent=True) or {}
    expression = body.get("expression", {})
    turtle = expression.get("expressionValue", "")
    if not turtle:
        return (
            jsonify({"code": "400", "reason": "Missing expression.expressionValue"}),
            400,
        )

    try:
        info = parse_deployment_info(turtle)
    except Exception as exc:  # noqa: BLE001 - report parse errors to caller
        logger.exception("Turtle parse failed")
        return jsonify({"code": "400", "reason": f"Turtle parse error: {exc}"}), 400

    if not info:
        return (
            jsonify(
                {
                    "code": "400",
                    "reason": "No DeploymentDescriptor found in intent",
                }
            ),
            400,
        )

    namespace = FIXED_NAMESPACE or (info.get("application") or RELEASE)
    # k8s namespaces must be DNS-1123 labels.
    namespace = namespace.lower().replace("_", "-")

    logger.info(
        "Intent received: app=%s descriptor=%s -> namespace=%s",
        info.get("application"),
        info.get("deployment_descriptor"),
        namespace,
    )

    ok, detail = deploy(namespace)
    intent_id = str(uuid.uuid4())
    if not ok:
        return (
            jsonify(
                {
                    "code": "500",
                    "reason": "Helm deploy failed",
                    "message": detail,
                }
            ),
            500,
        )

    return (
        jsonify(
            {
                "id": intent_id,
                "handler": "mock-inorch",
                "namespace": namespace,
                "release": RELEASE,
                "descriptor": info.get("deployment_descriptor"),
                "message": f"Deployed {RELEASE} to namespace {namespace}",
            }
        ),
        201,
    )


if __name__ == "__main__":
    logger.info(
        "mock-inorch starting on %s:%d, path %s/intent, chart=%s",
        HOST,
        PORT,
        API_PATH,
        CHART_PATH,
    )
    app.run(host=HOST, port=PORT)
