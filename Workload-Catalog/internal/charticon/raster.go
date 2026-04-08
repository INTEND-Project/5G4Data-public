package charticon

import (
	"bytes"
	"encoding/base64"
)

// IconResponseBody returns bytes and Content-Type for chart icons.
// SVG wrappers that only embed a single PNG via data URL are sent as image/png so
// <img src="..."> works reliably across browsers (many block data: inside SVG-as-image).
func IconResponseBody(data []byte) (body []byte, contentType string) {
	data = bytes.TrimSpace(data)
	if len(data) == 0 {
		return data, "application/octet-stream"
	}
	if isPNG(data) {
		return data, "image/png"
	}
	if isJPEG(data) {
		return data, "image/jpeg"
	}
	if isWebP(data) {
		return data, "image/webp"
	}
	if looksLikeSVG(data) {
		if png, ok := embeddedPNGFromDataURLSVG(data); ok {
			return png, "image/png"
		}
		return data, "image/svg+xml"
	}
	return data, "application/octet-stream"
}

func looksLikeSVG(b []byte) bool {
	if len(b) == 0 {
		return false
	}
	n := min(512, len(b))
	return bytes.Contains(bytes.ToLower(b[:n]), []byte("<svg"))
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func isPNG(b []byte) bool {
	return len(b) >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47
}

func isJPEG(b []byte) bool {
	return len(b) >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF
}

func isWebP(b []byte) bool {
	return len(b) >= 12 && string(b[0:4]) == "RIFF" && string(b[8:12]) == "WEBP"
}

func embeddedPNGFromDataURLSVG(svg []byte) ([]byte, bool) {
	needle := []byte("data:image/png;base64,")
	idx := bytes.Index(svg, needle)
	if idx < 0 {
		return nil, false
	}
	idx += len(needle)

	end := bytes.IndexByte(svg[idx:], '"')
	if end < 0 {
		return nil, false
	}
	b64Chunk := svg[idx : idx+end]
	b64Chunk = bytes.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == '\t' || r == ' ' {
			return -1
		}
		return r
	}, b64Chunk)

	dec, err := base64.StdEncoding.DecodeString(string(b64Chunk))
	if err != nil {
		dec, err = base64.RawStdEncoding.DecodeString(string(b64Chunk))
		if err != nil {
			return nil, false
		}
	}
	if !isPNG(dec) {
		return nil, false
	}
	return dec, true
}
