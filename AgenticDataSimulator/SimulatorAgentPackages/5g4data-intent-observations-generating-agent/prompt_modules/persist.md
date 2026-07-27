Persistence rules:
- Default path:
  - push datapoints to Prometheus,
  - store query metadata in GraphDB.
- In `--noGraphDB` mode:
  - do not write observation reports or metadata to GraphDB,
  - print each generated report payload in a clearly delimited block,
  - include marker line: `GraphDB write skipped (--noGraphDB)`.
