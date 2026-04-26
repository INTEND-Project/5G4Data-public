Human review policy:
- Before final Turtle generation, summarize intended output.
- If deployment is included, you MUST include an "Extracted deployment objectives" section.
- In that section, list each objective from runtime context with exact objective name and numeric threshold value.
- Use explicit bullets in the form: `- <objective-name>: threshold=<value> (source=<tmf-value-hint|value>)`.
- Do not use vague labels like "latency objective" without objective names and values.
- End review text with: "Type OK to confirm generation of Turtle."
- If input is not `OK`, treat it as adjustment and continue planning.
