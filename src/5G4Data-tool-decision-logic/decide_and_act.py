from flask import Flask, render_template, request

app = Flask(__name__)

def get_latency(start, end, latencies):
    """
    Return estimated network latency between start and end points
    based on user input values.
    """
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

def decide_and_act(latencies, required_latency):
    """
    Main function to assess latency and take necessary actions.
    """
    # Measure current latency components
    current_latency_ue_to_gNodeB = get_latency("UE", "gNodeB", latencies)
    current_latency_gNodeB_to_breakout = get_latency("gNodeB", "BreakoutPoint", latencies)
    current_latency_breakout_to_server = get_latency("BreakoutPoint", "Server", latencies)
    current_latency_server_compute = get_latency_compute(latencies)

    # Calculate total latency
    current_latency_total = (
        current_latency_ue_to_gNodeB +
        current_latency_gNodeB_to_breakout +
        current_latency_breakout_to_server +
        current_latency_server_compute
    )

    output = []
    output.append(f"Total current latency: {current_latency_total} ms")

    # Decision-making process
    if current_latency_total <= required_latency:
        output.append("✅ Current latency meets the requirement. No action needed.")
        return "\n".join(output)

    # Evaluate latency reduction strategies
    potential_latency_reduction_slice = estimate_latency_reduction_slice(latencies)
    new_latency_with_slice = current_latency_total - potential_latency_reduction_slice

    potential_latency_reduction_local_dc = estimate_latency_reduction_local_dc(latencies)
    new_latency_with_local_dc = current_latency_total - potential_latency_reduction_local_dc

    new_latency_with_both = current_latency_total - (
        potential_latency_reduction_slice + potential_latency_reduction_local_dc
    )

    # Decision logic
    if new_latency_with_both <= required_latency:
        output.append("⚡ Configure network slice and place application in local data center")
        output.append("✅ Both actions executed to meet latency requirement.")

    elif new_latency_with_slice <= required_latency:
        output.append("⚡ Configure network slice")
        output.append("✅ Network slice configured to meet latency requirement.")

    elif new_latency_with_local_dc <= required_latency:
        output.append("⚡ Place application in local data center")
        output.append("✅ Application placed in local data center to meet latency requirement.")

    else:
        output.append("⚠️ Neither action alone can meet the latency requirement.")
        output.append("🔍 Consider both actions or further optimizations.")

    return "\n".join(output)

@app.route("/", methods=["GET", "POST"])
def index():
    result = None
    latencies = {"L": "", "g": "", "b": "", "s": "", "c": "", "S": "", "D": ""}  # Default empty values

    if request.method == "POST":
        # Get user inputs from form
        latencies = {
            "L": request.form["L"],  # Required latency input
            "g": request.form["g"],  
            "b": request.form["b"],
            "s": request.form["s"],
            "c": request.form["c"],
            "S": request.form["S"],
            "D": request.form["D"]
        }
        
        # Convert to float only when performing calculations
        latencies_float = {k: float(v) for k, v in latencies.items() if k != "L"}
        required_latency = float(latencies["L"])
        result = decide_and_act(latencies_float, required_latency)

    return render_template("index.html", result=result, latencies=latencies)

if __name__ == "__main__":
    # app.run(debug=True)
    app.run(host='0.0.0.0', port=5000, debug=True)

