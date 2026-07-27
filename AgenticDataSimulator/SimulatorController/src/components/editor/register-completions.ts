type MetricCompletionItem = {
  label: string;
  insertText: string;
  detail: string;
  kind: "value";
};

export function buildMetricCompletionItems(metricNames: string[]): MetricCompletionItem[] {
  return metricNames.map((metricName) => ({
    label: metricName,
    insertText: metricName,
    detail: "Derived metric name",
    kind: "value",
  }));
}

export function registerMetricCompletions(
  monaco: typeof import("monaco-editor"),
  metricNames: string[],
) {
  const items = buildMetricCompletionItems(metricNames);

  return monaco.languages.registerCompletionItemProvider("plaintext", {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      return {
      suggestions: items.map((item) => ({
        ...item,
        kind: monaco.languages.CompletionItemKind.Value,
        range,
      })),
      };
    },
  });
}
