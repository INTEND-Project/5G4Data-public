from langchain_community.chat_message_histories import StreamlitChatMessageHistory
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_openai import ChatOpenAI
from dotenv import load_dotenv
import os
import streamlit as st

def read_system_prompt(file_path: str) -> str:
    """ Reads the system prompt template from a file. """
    with open(file_path, 'r', encoding='utf-8') as file:
        return file.read().strip()

def write_rdf_response(file_path: str, rdf_data: str):
    """ Writes the generated RDF Turtle data to a file. """
    with open(file_path, 'w', encoding='utf-8') as file:
        file.write(rdf_data)

st.set_page_config(page_title="StreamlitChatMessageHistory", page_icon="📖")
st.title("5G4Data pre-MVS agent :sunglasses:")
st.header("Natural language to TM Forum intent")

# Set up memory
msgs = StreamlitChatMessageHistory(key="langchain_messages")
if len(msgs.messages) == 0:
    msgs.add_ai_message("Hello, I am an AI assistant designed to help convert natural language inputs into TM Forum intents in RDF Turtle format for the 5G4Data use-case.\n How can I assist you today?")

load_dotenv()
openai_api_key = os.getenv("OPENAI_API_KEY")

# Set up the LangChain, passing in Message History
system = read_system_prompt("system_prompt_template.txt")
abstract_system = read_system_prompt("abstract_system_prompt_template.txt")
prompt = ChatPromptTemplate.from_messages(
    [
        ("system", system),
        MessagesPlaceholder(variable_name="history"),
        ("human", "{question}"),
    ]
)

chain = prompt | ChatOpenAI(api_key=openai_api_key, model="o3-mini")
chain_with_history = RunnableWithMessageHistory(
    chain,
    lambda session_id: msgs,
    input_messages_key="question",
    history_messages_key="history",
)

abstract_prompt = ChatPromptTemplate.from_messages([
    ("user", abstract_system),
    ("human", "{chatbot_response}"),
])
abstract_chain = abstract_prompt | ChatOpenAI(api_key=openai_api_key, model="o1-mini")

# Render current messages from StreamlitChatMessageHistory
#for msg in msgs.messages:
#    st.chat_message(msg.type).write(msg.content)

for i, msg in enumerate(msgs.messages, start=1):
    # Omit the turtle messages
    if msg.content.startswith("@prefix icm"):
        continue  # Skip displaying in Streamlit chat
    # Display in Streamlit chat only if it doesn't start with "@prefix icm"
    st.chat_message(msg.type).write(msg.content)

output_file = "rdf_response.ttl"
# If user inputs a new prompt, generate and draw a new response
if prompt := st.chat_input():
    st.chat_message("human").write(prompt)
    # Note: new messages are saved to history automatically by Langchain during run
    config = {"configurable": {"session_id": "any"}}
    response = chain_with_history.invoke({"question": prompt}, config)
    write_rdf_response(output_file, response.content)
    st.chat_message("ai").write(f"The TM Forum formatted intent is output to the file {output_file}. You can ask me questions about it or give me a new business objectiv to transform, but wait, I will first give you an abstract of the created intent.")
    abstract = abstract_chain.invoke({"chatbot_response": response.content}, config)
    st.chat_message("ai").write("Here is an abstract of the created intent:\n\n" + abstract.content)
