import pandas as pd
from openai import OpenAI
from dotenv import load_dotenv
import sys
import os
import io
import re

# Load environment variables
load_dotenv("../../.env") # the .env file is to folders up

# Initialize OpenAI Client
client = OpenAI()

# File paths for input matrices
latency_file = "../../generated-syntetic-data/Nordic_Latencies_Matrix.csv"
distance_file = "../../generated-syntetic-data/Nordic_Distances_Matrix.csv"

# Output paths for generated files
packet_error_rate_file = "../../generated-syntetic-data/Nordic_Packet_Error_Rate_Matrix.csv"
prompt_file = "../../prompts/packet_error_rate_prompt.txt"

# Load matrices
latency_matrix = pd.read_csv(latency_file, index_col=0, encoding="utf-16")
distance_matrix = pd.read_csv(distance_file, index_col=0, encoding="utf-16")

# Define hub cities
hub_cities = {
    "Norway": ["Tromsø", "Harstad", "Bodø", "Trondheim", "Oslo", "Bergen", "Stavanger"],
    "Finland": ["Oulu", "Helsinki"],
    "Sweden": ["Stockholm", "Malmö", "Gothenburg", "Luleå"],
    "Denmark": ["Copenhagen", "Odense"]
}
hub_list = [city for cities in hub_cities.values() for city in cities]

# Generate prompt
prompt = f"""
We have these Edge data center locations (with latencies between them expressed in milliseconds (ms)):
{latency_matrix.to_string()}

The hubs within a country are all connected with fiber networks of new advanced types with bandwidth between 20 and 60 Tbs/s. The hubs from different countries are connected with bandwidth between 5 Tbs/s up to 40 Tbs/s.

{', '.join(hub_list)}

The rest of the cities are connected to the nearest hubs with older technology fiber cables with bandwidth between 20Gbs/s up to 2Tbs/s. The distances between the cities are given by this matrix:

{distance_matrix.to_string()}

Create a plausible matrix with packet error rates between the cities in a CSV format and return it in the response with the column header being the name of the cities and the row headers being the name of the cities.
Where the row and column name is the same city, insert 0 as packet error rate.
In other words, the output should be in the same format as the latency natrix provided, but with the calculated packet error rate numbers in the cells.
Do not add text in the cells, only the number representing the packet error rate.
Typical error rates for older technology fiber is between 0.00000001 and 0.000000009 and for newer types of fiber it is between 0.000000001 and 0.0000000009.
The packet error rate will increase with distance.
Use scientific notation in the cells.
Only return the CSV formatted output, nothing else.
"""

# Save prompt to file
os.makedirs(os.path.dirname(prompt_file), exist_ok=True)
with open(prompt_file, "w", encoding="utf-8") as file:
    file.write(prompt)

print(f"Prompt saved successfully:\n- {prompt_file}")
sys.exit()

# OpenAI API Call
response = client.chat.completions.create(
    model="o1-mini",  # Use the latest GPT-4 model
    messages=[
        {"role": "system", "content": "You are a data scientist."},
        {"role": "user", "content": prompt}
    ],
)

# Extract text from OpenAI response
generated_text = response.choices[0].message.content

# Use regex to extract the CSV portion
csv_pattern = r"([^\n]*,.*\n(?:[^\n]*\n)*)"  # Captures anything that looks like CSV

match = re.search(csv_pattern, generated_text, re.DOTALL)
if match:
    csv_content = match.group(1).strip()
else:
    raise ValueError("Could not find valid CSV content in OpenAI response.")

# Convert extracted CSV text to DataFrame
bandwidth_df = pd.read_csv(io.StringIO(csv_content), index_col=0)

# Save matrices
os.makedirs(os.path.dirname(packet_error_rate_file), exist_ok=True)
bandwidth_df.to_csv(packet_error_rate_file, encoding="utf-16")

print(f"Bandwidth matrix saved successfully:\n- {packet_error_rate_file}")
