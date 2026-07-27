package chartintent

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"reflect"
	"testing"
)

func TestExtractIntentFromChartTGZ_fullIntent(t *testing.T) {
	valuesYAML := `intent:
  objectives:
    - name: p99-token-target
      value: 0.0
  sustainability:
    - name: container-cpu-joules-total
    - name: container-cpu-watts
`
	tgz := mustPackChart(t, map[string]string{
		"test-chart/Chart.yaml":  "name: test-chart\nversion: 1.0.0\n",
		"test-chart/values.yaml": valuesYAML,
	})

	got, err := ExtractIntentFromChartTGZ(tgz)
	if err != nil {
		t.Fatal(err)
	}
	want := IntentInfo{
		Objectives:     []string{"p99-token-target"},
		Sustainability: []string{"container-cpu-joules-total", "container-cpu-watts"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestExtractIntentFromChartTGZ_noIntent(t *testing.T) {
	valuesYAML := `replicaCount: 1
`
	tgz := mustPackChart(t, map[string]string{
		"test-chart/Chart.yaml":  "name: test-chart\nversion: 1.0.0\n",
		"test-chart/values.yaml": valuesYAML,
	})

	got, err := ExtractIntentFromChartTGZ(tgz)
	if err != nil {
		t.Fatal(err)
	}
	want := IntentInfo{Objectives: []string{}, Sustainability: []string{}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestExtractIntentFromChartTGZ_objectivesOnly(t *testing.T) {
	valuesYAML := `intent:
  objectives:
    - name: detection-latency
`
	tgz := mustPackChart(t, map[string]string{
		"test-chart/Chart.yaml":  "name: test-chart\nversion: 1.0.0\n",
		"test-chart/values.yaml": valuesYAML,
	})

	got, err := ExtractIntentFromChartTGZ(tgz)
	if err != nil {
		t.Fatal(err)
	}
	want := IntentInfo{
		Objectives:     []string{"detection-latency"},
		Sustainability: []string{},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestExtractIntentFromChartTGZ_noValuesYAML(t *testing.T) {
	tgz := mustPackChart(t, map[string]string{
		"test-chart/Chart.yaml": "name: test-chart\nversion: 1.0.0\n",
	})

	got, err := ExtractIntentFromChartTGZ(tgz)
	if err != nil {
		t.Fatal(err)
	}
	want := IntentInfo{Objectives: []string{}, Sustainability: []string{}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func mustPackChart(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, body := range files {
		hdr := &tar.Header{
			Name: name,
			Mode: 0644,
			Size: int64(len(body)),
		}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
