# Prompts used to generate synthetic data for the 5G4DATA use-case
This folder contains prompts used to generate diverse syntethic data for the INTEND project 5G4DATA use-case provided by Telenor.

| File name                  | Description                           |
| -------------------------- | ------------------------------------- |
| bandwidth_prompt.txt | This file was generated by the *../src/bandwidth/generate_bandwidth.py* script. It is a prompt used to generate bandwidth. The LLM model used was OpenAI ChatGPT 4o. The output from the LLM model can be found in the files *../generated-syntetic-data/Nordic_Bandwidth_Matrix.csv*. |
| packet_error_rate_prompt.txt | This file was generated by the *../src/packet_error_rate/generate_packet_error_rate.py* script. It is a prompt used to generate bandwidth. The LLM model used was OpenAI ChatGPT 4o. The output from the LLM model can be found in the files *../generated-syntetic-data/Nordic_Bandwidth_Matrix.csv*. |

The scripts uses the OpenAI API and executes the generated prompts through API calls. The prompt is saved for reference and the actual outcome of the prompt is stored in the csv files named in the table above.
