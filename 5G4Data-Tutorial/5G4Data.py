from flask import Flask, render_template, request, redirect, url_for
import sys
import requests

app = Flask(__name__)

def get_latency(start, end, latencies):
    """ Return estimated network latency between start and end points. """
    latency_mapping = {
        ("UE", "gNodeB"): latencies["g"],
        ("gNodeB", "BreakoutPoint"): latencies["b"],
        ("BreakoutPoint", "Server"): latencies["s"]
    }
    return latency_mapping.get((start, end), 0)  # Default to 0 if no match found

def get_latency_compute(latencies):
    """ Return estimated compute latency. """
    return latencies["c"]

def estimate_latency_reduction_slice(latencies):
    """ Return latency reduction from network slicing. """
    return latencies["S"]

def estimate_latency_reduction_local_dc(latencies):
    """ Return latency reduction from local data center. """
    return latencies["D"]

def run_5g4Data(latencies, required_latency):
    """
    Assess latency and determine necessary actions.
    Returns the result text and whether to show the 'Next Step' button.
    """
    # Measure current latency components
    current_latency_total = (
        get_latency("UE", "gNodeB", latencies) +
        get_latency("gNodeB", "BreakoutPoint", latencies) +
        get_latency("BreakoutPoint", "Server", latencies) +
        get_latency_compute(latencies)
    )

    output = [f"Total current latency: {current_latency_total} ms"]
    show_next_step = False  # Flag for displaying the next step button

    # Decision-making process
    if current_latency_total <= required_latency:
        output.append("✅ Current latency meets the requirement. No action needed.")
        return "\n".join(output), False

    # Evaluate latency reduction strategies
    potential_latency_reduction_slice = estimate_latency_reduction_slice(latencies)
    potential_latency_reduction_local_dc = estimate_latency_reduction_local_dc(latencies)

    new_latency_with_both = current_latency_total - (
        potential_latency_reduction_slice + potential_latency_reduction_local_dc
    )


    if (current_latency_total - potential_latency_reduction_slice) <= required_latency:
        output.append("⚡ Configure network slice")
        output.append("✅ Intent with only network slice Expectation needed.")
        show_next_step = True

    elif (current_latency_total - potential_latency_reduction_local_dc) <= required_latency:
        output.append("⚡ Place application in local data center")
        output.append("✅ Intent with only deployment to local edge Expectation needed.")
        show_next_step = True
        
    elif new_latency_with_both <= required_latency:
        output.append("⚡ Configure network slice and place application in local data center")
        output.append("✅ Intent with network slice Expectation and deployment to local edge Expectation needed.")
        show_next_step = True

    else:
        output.append("⚠️ Neither action alone can meet the latency requirement.")
        output.append("🔍 Consider both actions or further optimizations.")

    return "\n".join(output), show_next_step

@app.route("/", methods=["GET", "POST"])
def index():
    return render_template("index.html")

@app.route("/infrastructure-description")
def infrastructure_description():
    show_next_step = False
    return render_template("infrastructure-description.html", show_next_step=show_next_step)

@app.route("/intent-specification", methods=["GET", "POST"])
def intent_specification():
    result = None
    show_next_step = False
    latencies = {"L": "", "g": "", "b": "", "s": "", "c": "", "S": "", "D": ""}

    if request.method == "POST":
        latencies = {key: request.form[key] for key in latencies}
        latencies_float = {k: float(v) for k, v in latencies.items() if k != "L"}
        required_latency = float(latencies["L"])
        result, show_next_step = run_5g4Data(latencies_float, required_latency)

    return render_template("intent-specification.html", result=result, latencies=latencies, show_next_step=show_next_step)

@app.route("/create-intent-step")
def create_intent_step():
    return render_template("create-intent-step.html")

@app.route("/send-intent-step")
def send_intent_step():
    return render_template("send-intent-step.html")

@app.route("/summary")
def summary():
    return render_template("summary.html")

@app.route('/beyond-mvs')
def beyond_mvs():
    return render_template('beyond-mvs.html')

@app.route("/simulators")
def simulators():
    return render_template("simulators.html")

@app.route("/use-case")
def use_case():
    return render_template("use-case.html")

@app.route("/mvs")
def mvs():
    return render_template("mvs.html")

if __name__ == "__main__":
    port = 5000  # Default port
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])  # Convert argument to integer
        except ValueError:
            print("⚠️ Invalid port number! Using default port 5000.")

    app.run(host='0.0.0.0', port=port, debug=True)
    # app.run(
    #     host="0.0.0.0",
    #     port=port,
    #     ssl_context=(
    #          "/etc/ssl/certs/cert.pem",
    #          "/etc/ssl/certs/key.pem"
    #      )
    # )
