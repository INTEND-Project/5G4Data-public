from langchain_openai import ChatOpenAI
from langchain.schema import SystemMessage, HumanMessage
from langchain.schema.runnable import RunnableSequence
from langchain.prompts import ChatPromptTemplate
import streamlit as st
from dotenv import load_dotenv
import os

def read_system_prompt(file_path: str) -> str:
    """ Reads the system prompt template from a file. """
    with open(file_path, 'r', encoding='utf-8') as file:
        return file.read().strip()

def write_rdf_response(file_path: str, rdf_data: str):
    """ Writes the generated RDF Turtle data to a file. """
    with open(file_path, 'w', encoding='utf-8') as file:
        file.write(rdf_data)

def generate_turtle_rdf(user_input: str, system_prompt_file: str, output_file: str) -> str:
    """
    Uses the TM Forum Intent Ontology instructions in the System Prompt
    to generate RDF Turtle triples from user_input using RunnableSequence.
    """
    # Read system prompt from the specified file
    system_prompt_template = read_system_prompt(system_prompt_file)

    system_message = SystemMessage(content=system_prompt_template)
    user_message = HumanMessage(content=user_input.strip())

    # Create a ChatPromptTemplate from system + user messages
    chat_prompt = ChatPromptTemplate.from_messages([system_message, user_message])

    # Load environment variables from .env file
    load_dotenv()
    openai_key = os.getenv("OPENAI_API_KEY")

    # Instantiate the language model
    llm = ChatOpenAI(
        model_name="o1", 
        openai_api_key=openai_key
    )

    # Wrap the prompt and the model in a RunnableSequence
    chain = chat_prompt | llm

    # Invoke the sequence to get the result
    ai_response = chain.invoke({})
    output_turtle = ai_response.content  # Convert AIMessage to string
    # Write the output to the specified file
    write_rdf_response(output_file, output_turtle)
    return output_turtle

if __name__ == "__main__":
    st.title("5G4Data INTEND inChat")

    # Paths to the system prompt template file and output RDF file
    system_prompt_file = "system_prompt_template.txt"
    output_file = "rdf_response.ttl"

    with st.form("my_form"):
      user_query = st.text_area(
          "Hello, I am an AI assistant designed to help convert natural language inputs into TM Forum intents in RDF Turtle format. How can I assist you today?",
          "Enter text:",
      )
      submitted = st.form_submit_button("Submit")

      # Default user query
      if not user_query:
        user_query = (
            "My retail store AR application is not giving my customers a good experience. "
            "It seems to be lagging, possibly due to high latency or poor bandwidth. Please fix it. "
            "The AR goggles are connected to Telenor 5G network in my store in Tromsø, Norway. My store is "
            "located in the K1 shopping mall."
        )

      rdf_response = generate_turtle_rdf(user_query, system_prompt_file, output_file)
      st.info(f"RDF output has been written to {output_file}")
    #print("=== Generated RDF (Turtle) ===")
    #print(f"RDF output has been written to {output_file}")
