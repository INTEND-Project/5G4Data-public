"use client";

import { useEffect, useMemo, useRef } from "react";
import Editor from "@monaco-editor/react";

import { registerMetricCompletions } from "@/components/editor/register-completions";

type ScriptEditorProps = {
  value: string;
  metricNames: string[];
};

export function ScriptEditor({ value, metricNames }: ScriptEditorProps) {
  const completionRegistrationRef = useRef<{ dispose(): void } | null>(null);
  const dedupedMetricNames = useMemo(
    () => Array.from(new Set(metricNames)).sort(),
    [metricNames],
  );

  useEffect(() => {
    return () => {
      completionRegistrationRef.current?.dispose();
      completionRegistrationRef.current = null;
    };
  }, []);

  return (
    <div className="workspace-editor-container">
      <Editor
        defaultLanguage="plaintext"
        height="360px"
        options={{
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "on",
        }}
        onMount={(_editor, monaco) => {
          completionRegistrationRef.current?.dispose();
          completionRegistrationRef.current = registerMetricCompletions(
            monaco,
            dedupedMetricNames,
          );
        }}
        theme="vs-dark"
        value={value}
      />
    </div>
  );
}
