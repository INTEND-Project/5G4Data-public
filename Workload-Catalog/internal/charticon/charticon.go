package charticon

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"
)

const (
	manifestName = "_manifest.json"
	maxIconBytes = 2 << 20 // 2 MiB
	publicSubdir = "chart-icons"
)

// Manifest maps chart name -> version -> stored filename (under chart-icons/).
type Manifest struct {
	Icons map[string]map[string]string `json:"icons"`
}

type chartMeta struct {
	Name    string `yaml:"name"`
	Version string `yaml:"version"`
	Icon    string `yaml:"icon"`
}

var manifestMu sync.Mutex

func PublicChartIconsDir(publicRoot string) string {
	return filepath.Join(publicRoot, publicSubdir)
}

func ManifestPath(publicRoot string) string {
	return filepath.Join(PublicChartIconsDir(publicRoot), manifestName)
}

func ReadManifest(publicRoot string) (Manifest, error) {
	p := ManifestPath(publicRoot)
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return Manifest{Icons: map[string]map[string]string{}}, nil
		}
		return Manifest{}, err
	}
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return Manifest{}, err
	}
	if m.Icons == nil {
		m.Icons = map[string]map[string]string{}
	}
	return m, nil
}

func writeManifestUnlocked(publicRoot string, m Manifest) error {
	dir := PublicChartIconsDir(publicRoot)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(ManifestPath(publicRoot), data, 0644)
}

// TryExtractFromChartTGZ reads a Helm chart .tgz. If Chart.yaml references a bundled icon
// (non-HTTP URL), writes it under publicRoot/chart-icons/ and updates the manifest.
func TryExtractFromChartTGZ(publicRoot string, tgz []byte) error {
	meta, _, iconRelPath, iconData, err := findBundledIcon(tgz)
	if err != nil || meta == nil || len(iconData) == 0 {
		return err
	}

	ext := path.Ext(iconRelPath)
	if ext == "" {
		ext = ".img"
	}
	filename := fmt.Sprintf("%s-%s%s", sanitizeFilePart(meta.Name), sanitizeFilePart(meta.Version), ext)
	dir := PublicChartIconsDir(publicRoot)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	full := filepath.Join(dir, filename)
	if err := os.WriteFile(full, iconData, 0644); err != nil {
		return err
	}

	manifestMu.Lock()
	defer manifestMu.Unlock()

	m, err := ReadManifest(publicRoot)
	if err != nil {
		return err
	}
	if m.Icons[meta.Name] == nil {
		m.Icons[meta.Name] = map[string]string{}
	}
	m.Icons[meta.Name][meta.Version] = filename
	return writeManifestUnlocked(publicRoot, m)
}

// RemoveStoredIcon deletes an extracted icon file and manifest entry.
func RemoveStoredIcon(publicRoot, chartName, version string) error {
	manifestMu.Lock()
	defer manifestMu.Unlock()

	m, err := ReadManifest(publicRoot)
	if err != nil {
		return err
	}
	byVer, ok := m.Icons[chartName]
	if !ok {
		return nil
	}
	filename, ok := byVer[version]
	if !ok {
		return nil
	}
	delete(byVer, version)
	if len(byVer) == 0 {
		delete(m.Icons, chartName)
	}
	full := filepath.Join(PublicChartIconsDir(publicRoot), filename)
	_ = os.Remove(full)
	return writeManifestUnlocked(publicRoot, m)
}

func findBundledIcon(tgz []byte) (*chartMeta, string, string, []byte, error) {
	chartYAMLPath, chartYAML, err := readRootChartYAML(tgz)
	if err != nil || chartYAMLPath == "" {
		return nil, "", "", nil, err
	}

	var meta chartMeta
	if err := yaml.Unmarshal(chartYAML, &meta); err != nil {
		return nil, "", "", nil, err
	}
	icon := strings.TrimSpace(meta.Icon)
	if icon == "" {
		return nil, "", "", nil, nil
	}
	lower := strings.ToLower(icon)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		return nil, "", "", nil, nil
	}

	chartRoot := path.Dir(chartYAMLPath)
	rel := path.Clean(strings.TrimPrefix(icon, "./"))
	if rel == "." || strings.HasPrefix(rel, "..") {
		return nil, "", "", nil, nil
	}
	fullIconPath := path.Join(chartRoot, rel)
	fullIconPath = path.Clean(fullIconPath)
	if fullIconPath != chartRoot && !strings.HasPrefix(fullIconPath, chartRoot+"/") {
		return nil, "", "", nil, nil
	}

	data, err := readTarFile(tgz, fullIconPath)
	if err != nil {
		return nil, "", "", nil, err
	}
	if len(data) == 0 {
		return nil, "", "", nil, nil
	}
	if int64(len(data)) > maxIconBytes {
		return nil, "", "", nil, fmt.Errorf("icon file exceeds size limit")
	}

	return &meta, chartRoot, fullIconPath, data, nil
}

func readRootChartYAML(tgz []byte) (yamlPath string, content []byte, err error) {
	zr, err := gzip.NewReader(bytes.NewReader(tgz))
	if err != nil {
		return "", nil, err
	}
	defer zr.Close()

	tr := tar.NewReader(zr)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", nil, err
		}
		name := strings.TrimPrefix(hdr.Name, "./")
		if hdr.Typeflag == tar.TypeDir {
			continue
		}
		if !isRootChartYAML(name) {
			if err := skipEntry(tr, hdr); err != nil {
				return "", nil, err
			}
			continue
		}
		if hdr.Size < 0 || hdr.Size > 1<<20 {
			return "", nil, fmt.Errorf("unexpected Chart.yaml size")
		}
		var buf bytes.Buffer
		if _, err := io.CopyN(&buf, tr, hdr.Size); err != nil {
			return "", nil, err
		}
		return name, buf.Bytes(), nil
	}
	return "", nil, nil
}

func readTarFile(tgz []byte, wantPath string) ([]byte, error) {
	zr, err := gzip.NewReader(bytes.NewReader(tgz))
	if err != nil {
		return nil, err
	}
	defer zr.Close()

	tr := tar.NewReader(zr)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		name := strings.TrimPrefix(hdr.Name, "./")
		if name != wantPath {
			if err := skipEntry(tr, hdr); err != nil {
				return nil, err
			}
			continue
		}
		if hdr.Size < 0 || hdr.Size > maxIconBytes {
			return nil, fmt.Errorf("icon entry missing or too large")
		}
		var buf bytes.Buffer
		if _, err := io.CopyN(&buf, tr, hdr.Size); err != nil {
			return nil, err
		}
		return buf.Bytes(), nil
	}
	return nil, nil
}

func skipEntry(tr *tar.Reader, hdr *tar.Header) error {
	if hdr.Size <= 0 {
		return nil
	}
	_, err := io.CopyN(io.Discard, tr, hdr.Size)
	return err
}

func isRootChartYAML(p string) bool {
	parts := strings.Split(p, "/")
	return len(parts) == 2 && parts[1] == "Chart.yaml"
}

func sanitizeFilePart(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
		case r == '.', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	out := b.String()
	if out == "" {
		return "chart"
	}
	return out
}

// ChartIconFieldFromTGZ returns the root Chart.yaml icon field (may be relative or absolute URL).
func ChartIconFieldFromTGZ(tgz []byte) (string, error) {
	_, raw, err := readRootChartYAML(tgz)
	if err != nil {
		return "", err
	}
	if len(raw) == 0 {
		return "", fmt.Errorf("no Chart.yaml in package")
	}
	var meta chartMeta
	if err := yaml.Unmarshal(raw, &meta); err != nil {
		return "", err
	}
	return strings.TrimSpace(meta.Icon), nil
}

// FetchChartTGZ downloads a packaged chart from ChartMuseum (name-version.tgz).
func FetchChartTGZ(chartMuseumBaseURL, name, version string) ([]byte, int, error) {
	base := strings.TrimRight(chartMuseumBaseURL, "/")
	filename := url.PathEscape(name + "-" + version + ".tgz")
	reqURL := base + "/charts/" + filename
	resp, err := http.Get(reqURL)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, resp.StatusCode, fmt.Errorf("chartmuseum: status %d", resp.StatusCode)
	}
	const maxChart = 50 << 20
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxChart))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return data, resp.StatusCode, nil
}

// IconAPIPath is the UI/API-relative path used in <img src>; lazy-loads via Serve logic.
func IconAPIPath(chartName, version string) string {
	return "/api/chart-icon/" + url.PathEscape(chartName) + "/" + url.PathEscape(version)
}

// LocalURL returns `/chart-icons/<file>` when the manifest contains an extracted icon.
func (m Manifest) LocalURL(chartName, version string) string {
	byVer, ok := m.Icons[chartName]
	if !ok {
		return ""
	}
	f, ok := byVer[version]
	if !ok || f == "" {
		return ""
	}
	return "/" + publicSubdir + "/" + f
}

// LocalIconPath returns `/chart-icons/<file>` if we have a stored icon, else empty string.
func LocalIconPath(publicRoot, chartName, version string) (string, error) {
	m, err := ReadManifest(publicRoot)
	if err != nil {
		return "", err
	}
	return m.LocalURL(chartName, version), nil
}

// RewriteIconsInChartsIndex replaces icon URLs with local /chart-icons/ paths when extracted.
func RewriteIconsInChartsIndex(body []byte, m Manifest) ([]byte, error) {
	var data map[string][]map[string]interface{}
	if err := json.Unmarshal(body, &data); err != nil {
		return body, err
	}
	for _, versions := range data {
		for _, ch := range versions {
			applyLocalIcon(m, ch)
		}
	}
	return json.Marshal(data)
}

// RewriteIconsInVersionList applies the same for ChartMuseum's per-chart version array response.
func RewriteIconsInVersionList(body []byte, m Manifest) ([]byte, error) {
	var list []map[string]interface{}
	if err := json.Unmarshal(body, &list); err != nil {
		return body, err
	}
	for _, ch := range list {
		applyLocalIcon(m, ch)
	}
	return json.Marshal(list)
}

func applyLocalIcon(m Manifest, ch map[string]interface{}) {
	name, _ := ch["name"].(string)
	ver, _ := ch["version"].(string)
	if name == "" || ver == "" {
		return
	}
	icon, _ := ch["icon"].(string)
	icon = strings.TrimSpace(icon)
	lower := strings.ToLower(icon)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		return
	}
	// Relative paths like "images/icon.svg" are not valid browser URLs; manifest-only
	// /chart-icons/... files may be missing on deploy. Use API handler (disk + lazy fetch).
	if icon != "" || m.LocalURL(name, ver) != "" {
		ch["icon"] = IconAPIPath(name, ver)
	}
}
