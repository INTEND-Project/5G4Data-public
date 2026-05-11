type DomainSelectorProps = {
  domains: string[];
  selectedDomain: string;
};

export function DomainSelector({ domains, selectedDomain }: DomainSelectorProps) {
  return (
    <div className="workspace-section workspace-section-compact workspace-section-domain">
      <label className="workspace-label workspace-section-title" htmlFor="domain-select">
        Select domain:
      </label>
      <select
        className="workspace-select workspace-select-compact workspace-select-tight"
        id="domain-select"
        defaultValue={selectedDomain}
      >
        {domains.map((domain) => (
          <option key={domain} value={domain}>
            {domain}
          </option>
        ))}
      </select>
    </div>
  );
}
