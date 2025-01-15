This folder holds experiments to analyse and use content in the knowledge graph as part of the lifecycle management of intents.

It is recomended to create a python environment to isolate the needed library imports from your standard python environment. This can be done like this:
```
# Create the environment
python -m venv lifecycle_python_env
# Activate the environment
source lifecycle_python_env/bin/activate
# Install the needed libraries, note that the requirements.txt file was created like this:
# pip list --not-required --format=freeze > requirements.txt
pip install -r requirements.txt
```

**slice_measurement_QA_agent.py**
This program is an agent that can be used to ask questions and get answers based on intent reports (e.g. latency measurements for a slice that was created from an intent) stored in knowledge graphs. It uses Langchain and OpenAI LLM to create the QA agent. Note that we have observed that when the graph is large (e.g. thousands of measurements) OpenAI complains that the input is larger than the context window, while at the same time SPARQL queries directly in GraphDB still seems to perform well (with respect to how long it takes to perform them). The work was inspired by [this](https://www.ontotext.com/blog/natural-language-querying-of-graphdb-in-langchain/) article from OntoText.