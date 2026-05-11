type ScriptSummary = {
  name: string;
  detail: string;
  active?: boolean;
};

type ScriptListProps = {
  scripts: ScriptSummary[];
};

export function ScriptList({ scripts }: ScriptListProps) {
  return (
    <div className="workspace-section">
      <div className="workspace-heading-row">
        <h2>Scripts</h2>
        <span className="workspace-chip">{scripts.length} scripts</span>
      </div>
      <div className="workspace-stack">
        {scripts.length === 0 ? (
          <article className="workspace-card">
            <strong>No scripts yet</strong>
            <p>Create a script in the selected domain to start stage 1 authoring.</p>
          </article>
        ) : null}
        {scripts.map((script) => (
          <article
            className={`workspace-card ${script.active ? "workspace-card-active" : ""}`}
            key={script.name}
          >
            <strong>{script.name}</strong>
            <p>{script.detail}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
