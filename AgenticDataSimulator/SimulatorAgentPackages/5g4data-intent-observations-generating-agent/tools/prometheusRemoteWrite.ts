import protobuf from "protobufjs";
import snappy from "snappyjs";

const REMOTE_WRITE_PROTO = `
syntax = "proto3";

message WriteRequest {
  repeated TimeSeries timeseries = 1;
}

message TimeSeries {
  repeated Label labels = 1;
  repeated Sample samples = 2;
}

message Label {
  string name = 1;
  string value = 2;
}

message Sample {
  double value = 1;
  int64 timestamp = 2;
}
`;

export interface RemoteWriteSample {
  metricName: string;
  value: number;
  labels?: Record<string, string>;
  timestampMs: number;
}

let writeRequestType: protobuf.Type | null = null;

function getWriteRequestType(): protobuf.Type {
  if (!writeRequestType) {
    const root = protobuf.parse(REMOTE_WRITE_PROTO).root;
    writeRequestType = root.lookupType("WriteRequest");
  }
  return writeRequestType;
}

function seriesKey(metricName: string, labels: Record<string, string>): string {
  const pairs = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  return `${metricName}|${pairs.join(",")}`;
}

/** Build snappy-compressed Prometheus remote-write protobuf body. */
export function encodeRemoteWriteBody(samples: RemoteWriteSample[]): Uint8Array {
  if (samples.length === 0) {
    throw new Error("remote write requires at least one sample");
  }

  const grouped = new Map<
    string,
    { metricName: string; labels: Record<string, string>; samples: Array<{ value: number; timestampMs: number }> }
  >();

  for (const sample of samples) {
    const labels = { ...(sample.labels ?? {}) };
    const key = seriesKey(sample.metricName, labels);
    const existing = grouped.get(key);
    if (existing) {
      existing.samples.push({ value: sample.value, timestampMs: sample.timestampMs });
    } else {
      grouped.set(key, {
        metricName: sample.metricName,
        labels,
        samples: [{ value: sample.value, timestampMs: sample.timestampMs }]
      });
    }
  }

  const timeseries = [...grouped.values()].map((entry) => {
    const labelList = [
      { name: "__name__", value: entry.metricName },
      ...Object.entries(entry.labels)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, value]) => ({ name, value }))
    ];
    return {
      labels: labelList,
      samples: entry.samples.map((s) => ({
        value: s.value,
        timestamp: s.timestampMs
      }))
    };
  });

  const WriteRequest = getWriteRequestType();
  const err = WriteRequest.verify({ timeseries });
  if (err) throw new Error(`WriteRequest verify failed: ${err}`);
  const message = WriteRequest.create({ timeseries });
  const encoded = WriteRequest.encode(message).finish();
  return snappy.compress(encoded);
}

export function prometheusRemoteWriteUrl(
  explicitUrl?: string,
  prometheusBaseUrl?: string
): string | undefined {
  const trimmed = explicitUrl?.trim();
  if (trimmed) return trimmed.replace(/\/$/, "");
  const base = prometheusBaseUrl?.trim()?.replace(/\/$/, "");
  if (!base) return undefined;
  return `${base}/api/v1/write`;
}

export async function postRemoteWrite(
  url: string,
  samples: RemoteWriteSample[]
): Promise<boolean> {
  const body = encodeRemoteWriteBody(samples);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-protobuf",
      "Content-Encoding": "snappy",
      "X-Prometheus-Remote-Write-Version": "0.1.0"
    },
    body: Buffer.from(body)
  });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      `HTTP ${response.status}${detail ? `: ${detail}` : ""} (${samples.length} samples)`
    );
  }
  return true;
}
