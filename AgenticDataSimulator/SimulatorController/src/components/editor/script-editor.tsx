"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import Editor from "@monaco-editor/react";

import { registerMetricCompletions } from "@/components/editor/register-completions";

type ScriptEditorProps = {
  value: string;
  metricNames: string[];
  heightPx?: number;
  onChange?: (value: string) => void;
  onSave?: () => void;
};

const DEFAULT_EDITOR_HEIGHT_PX = 360;

export const ScriptEditor = memo(function ScriptEditor({
  value,
  metricNames,
  heightPx = DEFAULT_EDITOR_HEIGHT_PX,
  onChange,
  onSave,
}: ScriptEditorProps) {
  const completionRegistrationRef = useRef<{ dispose(): void } | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

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
        height={`${heightPx}px`}
        options={{
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "on",
        }}
        onChange={(nextValue) => onChange?.(nextValue ?? "")}
        onMount={(editor, monaco) => {
          completionRegistrationRef.current?.dispose();
          completionRegistrationRef.current = registerMetricCompletions(
            monaco,
            dedupedMetricNames,
          );
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            onSaveRef.current?.();
          });
        }}
        theme="vs-dark"
        value={value}
      />
    </div>
  );
});
