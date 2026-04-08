package charticon

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIconResponseBody_embeddedPNGSVG(t *testing.T) {
	// 1×1 transparent PNG
	const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
	svg := `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1" height="1">
  <image xlink:href="data:image/png;base64,` + b64 + `"/></svg>`

	body, ct := IconResponseBody([]byte(svg))
	if ct != "image/png" {
		t.Fatalf("content-type: %s", ct)
	}
	if !isPNG(body) {
		t.Fatal("expected decoded PNG")
	}
}

func TestIconResponseBody_rustyHelmIconFile(t *testing.T) {
	p := filepath.Join("..", "..", "workloads", "ai-server", "helm", "rusty-llm", "icon.svg")
	raw, err := os.ReadFile(p)
	if err != nil {
		t.Skip("rusty-llm icon.svg not in tree:", err)
	}
	body, ct := IconResponseBody(raw)
	if ct != "image/png" {
		t.Fatalf("content-type: %s (expected image/png)", ct)
	}
	if !isPNG(body) {
		t.Fatal("expected PNG payload from embedded wrapper SVG")
	}
}

func TestIconResponseBody_plainSVG(t *testing.T) {
	svg := `<svg xmlns="http://www.w3.org/2000/svg"><circle cx="1" cy="1" r="1"/></svg>`
	body, ct := IconResponseBody([]byte(svg))
	if ct != "image/svg+xml" {
		t.Fatalf("content-type: %s", ct)
	}
	if !strings.Contains(string(body), "<svg") {
		t.Fatal("expected svg bytes")
	}
}
