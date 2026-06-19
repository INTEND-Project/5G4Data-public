"use client";

import { useRouter } from "next/navigation";

import { withAppBasePath } from "@/lib/app-paths";

type DomainSelectorProps = {
  domains: string[];
  selectedDomain: string;
};

export function DomainSelector({ domains, selectedDomain }: DomainSelectorProps) {
  const router = useRouter();

  return (
    <div className="workspace-section workspace-section-compact workspace-section-domain">
      <label className="workspace-label workspace-section-title" htmlFor="domain-select">
        Select domain:
      </label>
      <select
        className="workspace-select workspace-select-compact workspace-select-tight"
        id="domain-select"
        onChange={(event) => {
          const nextDomain = event.target.value;
          if (nextDomain === selectedDomain) {
            return;
          }

          const params = new URLSearchParams({ domain: nextDomain });
          router.push(`${withAppBasePath("/workspace")}?${params.toString()}`);
        }}
        value={selectedDomain}
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
