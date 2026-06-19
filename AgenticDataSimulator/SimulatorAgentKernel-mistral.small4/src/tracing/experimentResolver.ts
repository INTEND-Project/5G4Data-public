export interface ResolveExperimentOptions {
  trackingUri: string;
  experimentId?: string;
  experimentName?: string;
  experimentDescription?: string;
}

function apiBase(trackingUri: string): string {
  return trackingUri.replace(/\/+$/, "");
}

export async function experimentExistsById(
  trackingUri: string,
  experimentId: string
): Promise<boolean> {
  const url = `${apiBase(trackingUri)}/api/2.0/mlflow/experiments/get?experiment_id=${encodeURIComponent(experimentId)}`;
  const response = await fetch(url, { method: "GET" });
  if (response.status === 404) return false;
  if (!response.ok) {
    const body = await response.text();
    if (/RESOURCE_DOES_NOT_EXIST|does not exist/i.test(body)) return false;
    throw new Error(`MLflow experiment get failed (${response.status}): ${body}`);
  }
  const payload = (await response.json()) as {
    experiment?: { lifecycle_stage?: string };
  };
  return payload.experiment?.lifecycle_stage !== "deleted";
}

async function getExperimentByName(
  trackingUri: string,
  experimentName: string
): Promise<{ experimentId: string; lifecycleStage: string } | undefined> {
  const url = `${apiBase(trackingUri)}/api/2.0/mlflow/experiments/get-by-name?experiment_name=${encodeURIComponent(experimentName)}`;
  const response = await fetch(url, { method: "GET" });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    const body = await response.text();
    if (/RESOURCE_DOES_NOT_EXIST|does not exist/i.test(body)) return undefined;
    throw new Error(`MLflow experiment get-by-name failed (${response.status}): ${body}`);
  }
  const payload = (await response.json()) as {
    experiment?: { experiment_id?: string; lifecycle_stage?: string };
  };
  const experimentId = payload.experiment?.experiment_id?.trim();
  if (!experimentId) return undefined;
  return {
    experimentId,
    lifecycleStage: payload.experiment?.lifecycle_stage?.trim() || "active"
  };
}

async function restoreExperiment(trackingUri: string, experimentId: string): Promise<void> {
  const url = `${apiBase(trackingUri)}/api/2.0/mlflow/experiments/restore`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ experiment_id: experimentId })
  });
  if (!response.ok) {
    throw new Error(
      `MLflow experiment restore failed (${response.status}): ${await response.text()}`
    );
  }
}

async function setExperimentTag(
  trackingUri: string,
  experimentId: string,
  key: string,
  value: string,
): Promise<void> {
  const url = `${apiBase(trackingUri)}/api/2.0/mlflow/experiments/set-experiment-tag`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ experiment_id: experimentId, key, value }),
  });
  if (!response.ok) {
    throw new Error(
      `MLflow set-experiment-tag failed (${response.status}): ${await response.text()}`,
    );
  }
}

async function createExperiment(
  trackingUri: string,
  experimentName: string,
  experimentDescription?: string,
): Promise<string> {
  const body: {
    name: string;
    tags?: Array<{ key: string; value: string }>;
  } = { name: experimentName };
  const description = experimentDescription?.trim();
  if (description) {
    body.tags = [{ key: "mlflow.note.content", value: description }];
  }
  const url = `${apiBase(trackingUri)}/api/2.0/mlflow/experiments/create`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `MLflow experiment create failed (${response.status}): ${await response.text()}`
    );
  }
  const payload = (await response.json()) as { experiment_id?: string };
  const id = payload.experiment_id?.trim();
  if (!id) {
    throw new Error(`MLflow experiment create returned no experiment_id for ${experimentName}`);
  }
  return id;
}

export async function resolveMlflowExperimentId(
  options: ResolveExperimentOptions
): Promise<string> {
  const experimentName = options.experimentName?.trim();
  const experimentDescription = options.experimentDescription?.trim();
  if (experimentName) {
    const existing = await getExperimentByName(options.trackingUri, experimentName);
    if (existing) {
      if (existing.lifecycleStage === "deleted") {
        await restoreExperiment(options.trackingUri, existing.experimentId);
      }
      if (experimentDescription) {
        await setExperimentTag(
          options.trackingUri,
          existing.experimentId,
          "mlflow.note.content",
          experimentDescription,
        );
      }
      return existing.experimentId;
    }
    try {
      return await createExperiment(options.trackingUri, experimentName, experimentDescription);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/RESOURCE_ALREADY_EXISTS|already exists/i.test(message)) {
        const raced = await getExperimentByName(options.trackingUri, experimentName);
        if (raced) {
          if (raced.lifecycleStage === "deleted") {
            await restoreExperiment(options.trackingUri, raced.experimentId);
          }
          return raced.experimentId;
        }
      }
      throw error;
    }
  }

  const explicitId = options.experimentId?.trim();
  if (!explicitId) {
    throw new Error("MLFLOW_EXPERIMENT_ID or MLFLOW_EXPERIMENT_NAME is required for tracing.");
  }

  if (await experimentExistsById(options.trackingUri, explicitId)) {
    return explicitId;
  }

  throw new Error(
    `MLflow experiment ${explicitId} does not exist. Set MLFLOW_EXPERIMENT_NAME or recreate the experiment.`
  );
}
