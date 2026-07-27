package chartintent

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"strings"

	"gopkg.in/yaml.v3"
)

// IntentInfo holds objective and sustainability names from values.yaml.
type IntentInfo struct {
	Objectives     []string `json:"objectives"`
	Sustainability []string `json:"sustainability"`
}

type valuesYAML struct {
	Intent *intentSection `yaml:"intent"`
}

type intentSection struct {
	Objectives     []namedItem `yaml:"objectives"`
	Sustainability []namedItem `yaml:"sustainability"`
}

type namedItem struct {
	Name string `yaml:"name"`
}

// ExtractIntentFromChartTGZ reads values.yaml from a Helm chart .tgz and returns intent names.
func ExtractIntentFromChartTGZ(tgz []byte) (IntentInfo, error) {
	raw, err := readRootValuesYAML(tgz)
	if err != nil {
		return IntentInfo{}, err
	}
	if len(raw) == 0 {
		return IntentInfo{Objectives: []string{}, Sustainability: []string{}}, nil
	}

	var values valuesYAML
	if err := yaml.Unmarshal(raw, &values); err != nil {
		return IntentInfo{}, fmt.Errorf("parse values.yaml: %w", err)
	}
	if values.Intent == nil {
		return IntentInfo{Objectives: []string{}, Sustainability: []string{}}, nil
	}

	return IntentInfo{
		Objectives:     collectNames(values.Intent.Objectives),
		Sustainability: collectNames(values.Intent.Sustainability),
	}, nil
}

func collectNames(items []namedItem) []string {
	if len(items) == 0 {
		return []string{}
	}
	names := make([]string, 0, len(items))
	for _, item := range items {
		name := strings.TrimSpace(item.Name)
		if name != "" {
			names = append(names, name)
		}
	}
	return names
}

func readRootValuesYAML(tgz []byte) ([]byte, error) {
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
		if hdr.Typeflag == tar.TypeDir {
			continue
		}
		if !isRootValuesYAML(name) {
			if err := skipEntry(tr, hdr); err != nil {
				return nil, err
			}
			continue
		}
		if hdr.Size < 0 || hdr.Size > 1<<20 {
			return nil, fmt.Errorf("unexpected values.yaml size")
		}
		var buf bytes.Buffer
		if _, err := io.CopyN(&buf, tr, hdr.Size); err != nil {
			return nil, err
		}
		return buf.Bytes(), nil
	}
	return nil, nil
}

func isRootValuesYAML(p string) bool {
	parts := strings.Split(p, "/")
	return len(parts) == 2 && parts[1] == "values.yaml"
}

func skipEntry(tr *tar.Reader, hdr *tar.Header) error {
	if hdr.Size <= 0 {
		return nil
	}
	_, err := io.CopyN(io.Discard, tr, hdr.Size)
	return err
}
