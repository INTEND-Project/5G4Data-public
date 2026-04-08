package charticon

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"
)

func TestTryExtractFromChartTGZ_bundledIcon(t *testing.T) {
	dir := t.TempDir()
	public := filepath.Join(dir, "public")

	chartYAML := `apiVersion: v2
name: test-chart
version: 1.2.3
icon: images/icon.svg
`
	svg := `<svg xmlns="http://www.w3.org/2000/svg"></svg>`
	tgz := mustPackChart(t, map[string]string{
		"test-chart/Chart.yaml":    chartYAML,
		"test-chart/images/icon.svg": svg,
	})

	if err := TryExtractFromChartTGZ(public, tgz); err != nil {
		t.Fatal(err)
	}

	wantFile := filepath.Join(public, "chart-icons", "test-chart-1.2.3.svg")
	if _, err := os.Stat(wantFile); err != nil {
		t.Fatalf("expected extracted icon: %v", err)
	}

	m, err := ReadManifest(public)
	if err != nil {
		t.Fatal(err)
	}
	if m.LocalURL("test-chart", "1.2.3") != "/chart-icons/test-chart-1.2.3.svg" {
		t.Fatalf("manifest: %+v", m)
	}
}

func TestTryExtractFromChartTGZ_skipsHTTPicon(t *testing.T) {
	dir := t.TempDir()
	public := filepath.Join(dir, "public")

	chartYAML := `apiVersion: v2
name: test-chart
version: 1.0.0
icon: https://example.com/i.png
`
	tgz := mustPackChart(t, map[string]string{
		"test-chart/Chart.yaml": chartYAML,
	})

	if err := TryExtractFromChartTGZ(public, tgz); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(public, "chart-icons")); !os.IsNotExist(err) {
		t.Fatalf("expected no chart-icons dir, stat err=%v", err)
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
