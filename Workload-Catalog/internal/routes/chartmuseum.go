package routes

import (
	"bytes"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/arne-munch-ellingsen/intend-5g4data-workload-catalog/internal/charticon"
	"github.com/gofiber/fiber/v2"
)

var chartMuseumBaseURL = getChartMuseumBaseURL()

func getChartMuseumBaseURL() string {
	if url := os.Getenv("CHARTMUSEUM_URL"); url != "" {
		return url
	}
	return "http://localhost:8080" // fallback for local dev
}

func publicStaticRoot() string {
	if root := os.Getenv("PUBLIC_ROOT"); root != "" {
		return root
	}
	return "./public"
}

func RegisterChartMuseumRoutes(router fiber.Router) {
	// Helm repository surface (consumed by `helm repo add`, `helm install`, etc.)
	router.Get("/index.yaml", getIndexYaml)
	router.Get("/charts/:filename", getChartAsset)

	api := router.Group("/api")

	api.Get("/chart-icon/:name/:version", serveChartIcon)

	// GET /webapp/api/charts
	api.Get("/charts", getChartsFromChartMuseum)

	// POST /webapp/api/charts
	api.Post("/charts", uploadChartToChartMuseum)

	// Other endpoints
	api.Post("/prov", notImplemented("POST /api/prov"))
	api.Delete("/charts/:name/:version", deleteChartVersion)
	api.Get("/charts/:name", getChartVersions)
	api.Head("/charts/:name", notImplemented("HEAD /api/charts/:name"))
	api.Head("/charts/:name/:version", notImplemented("HEAD /api/charts/:name/:version"))
}

func uploadChartToChartMuseum(c *fiber.Ctx) error {
	// Get the uploaded file from the form
	fileHeader, err := c.FormFile("chart")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Missing or invalid chart file",
		})
	}

	log.Println("File header: " + fileHeader.Filename)

	file, err := fileHeader.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to open uploaded file",
		})
	}
	chartBytes, err := io.ReadAll(file)
	file.Close()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read uploaded chart",
		})
	}

	if err := charticon.TryExtractFromChartTGZ(publicStaticRoot(), chartBytes); err != nil {
		log.Printf("chart icon extract: %v", err)
	}

	// Create multipart form request to ChartMuseum
	var b bytes.Buffer
	writer := multipart.NewWriter(&b)

	formFile, err := writer.CreateFormFile("chart", fileHeader.Filename)
	if err != nil {
		return err
	}

	if _, err := formFile.Write(chartBytes); err != nil {
		return err
	}

	writer.Close()

	// Send POST to ChartMuseum
	log.Println("POST to:", chartMuseumBaseURL+"/api/charts")
	req, err := http.NewRequest("POST", chartMuseumBaseURL+"/api/charts", &b)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error": "Failed to connect to ChartMuseum",
		})
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	return c.Status(resp.StatusCode).Send(body)
}

func notImplemented(endpoint string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{
			"message": endpoint + " not implemented yet",
		})
	}
}

func getChartsFromChartMuseum(c *fiber.Ctx) error {
	// Preserve query parameters
	fullURL := chartMuseumBaseURL + "/api/charts" + "?" + c.Context().QueryArgs().String()
	log.Println("Request from client:", c.OriginalURL())
	log.Println("Forwarding to ChartMuseum:", fullURL)

	// Make GET request to ChartMuseum
	resp, err := http.Get(fullURL)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error": "Failed to connect to ChartMuseum",
		})
	}
	defer resp.Body.Close()

	// Copy headers and status code
	c.Set("Content-Type", resp.Header.Get("Content-Type"))
	c.Status(resp.StatusCode)

	// Copy body to Fiber response
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read response from ChartMuseum",
		})
	}

	if resp.StatusCode == http.StatusOK {
		m, err := charticon.ReadManifest(publicStaticRoot())
		if err != nil {
			log.Printf("chart icon manifest read: %v", err)
			return c.Send(body)
		}
		rewritten, err := charticon.RewriteIconsInChartsIndex(body, m)
		if err != nil {
			log.Printf("chart icon rewrite: %v", err)
			return c.Send(body)
		}
		body = rewritten
	}

	return c.Send(body)
}

func deleteChartVersion(c *fiber.Ctx) error {
	name := c.Params("name")
	version := c.Params("version")

	url := chartMuseumBaseURL + "/api/charts/" + name + "/" + version

	req, err := http.NewRequest(http.MethodDelete, url, nil)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to create request"})
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "Failed to reach ChartMuseum"})
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		if err := charticon.RemoveStoredIcon(publicStaticRoot(), name, version); err != nil {
			log.Printf("chart icon delete: %v", err)
		}
	}

	return c.SendStatus(resp.StatusCode)
}

func getChartVersions(c *fiber.Ctx) error {
	name := c.Params("name")
	url := chartMuseumBaseURL + "/api/charts/" + name

	resp, err := http.Get(url)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error": "Failed to connect to ChartMuseum",
		})
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read response from ChartMuseum",
		})
	}

	if resp.StatusCode == http.StatusOK {
		m, merr := charticon.ReadManifest(publicStaticRoot())
		if merr != nil {
			log.Printf("chart icon manifest read: %v", merr)
			c.Set("Content-Type", resp.Header.Get("Content-Type"))
			return c.Status(resp.StatusCode).Send(body)
		}
		if rewritten, werr := charticon.RewriteIconsInVersionList(body, m); werr == nil {
			body = rewritten
		} else {
			log.Printf("chart icon rewrite: %v", werr)
		}
	}

	c.Set("Content-Type", resp.Header.Get("Content-Type"))
	return c.Status(resp.StatusCode).Send(body)
}

func getIndexYaml(c *fiber.Ctx) error {
	return proxyChartMuseumRequest(c, "/index.yaml")
}

func getChartAsset(c *fiber.Ctx) error {
	filename := c.Params("filename")
	if filename == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "missing chart filename",
		})
	}
	return proxyChartMuseumRequest(c, "/charts/"+filename)
}

func proxyChartMuseumRequest(c *fiber.Ctx, path string) error {
	url := chartMuseumBaseURL + path
	resp, err := http.Get(url)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error": "Failed to connect to ChartMuseum",
		})
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to read response from ChartMuseum",
		})
	}

	c.Set("Content-Type", resp.Header.Get("Content-Type"))
	return c.Status(resp.StatusCode).Send(body)
}

// serveChartIcon returns a bundled icon from disk, or lazily fetches the chart .tgz from
// ChartMuseum, extracts the icon, or redirects when Chart.yaml points at an http(s) URL.
func serveChartIcon(c *fiber.Ctx) error {
	name := c.Params("name")
	version := c.Params("version")
	if name == "" || version == "" {
		return c.SendStatus(fiber.StatusNotFound)
	}
	publicRoot := publicStaticRoot()

	resolveFile := func() string {
		m, err := charticon.ReadManifest(publicRoot)
		if err != nil {
			return ""
		}
		byVer, ok := m.Icons[name]
		if !ok {
			return ""
		}
		f := byVer[version]
		if f == "" {
			return ""
		}
		return filepath.Join(charticon.PublicChartIconsDir(publicRoot), f)
	}

	if full := resolveFile(); full != "" {
		if st, err := os.Stat(full); err == nil && !st.IsDir() {
			return sendChartIconFile(c, full)
		}
	}

	tgz, status, err := charticon.FetchChartTGZ(chartMuseumBaseURL, name, version)
	if err != nil || status != http.StatusOK {
		log.Printf("chart icon fetch %s-%s: %v http=%d", name, version, err, status)
		return c.SendStatus(fiber.StatusNotFound)
	}

	if err := charticon.TryExtractFromChartTGZ(publicRoot, tgz); err != nil {
		log.Printf("lazy chart icon extract: %v", err)
	}

	if full := resolveFile(); full != "" {
		if st, err := os.Stat(full); err == nil && !st.IsDir() {
			return sendChartIconFile(c, full)
		}
	}

	iconField, err := charticon.ChartIconFieldFromTGZ(tgz)
	if err == nil {
		low := strings.ToLower(strings.TrimSpace(iconField))
		if strings.HasPrefix(low, "http://") || strings.HasPrefix(low, "https://") {
			return c.Redirect(iconField, http.StatusFound)
		}
	}
	return c.SendStatus(fiber.StatusNotFound)
}

func sendChartIconFile(c *fiber.Ctx, fullPath string) error {
	data, err := os.ReadFile(fullPath)
	if err != nil {
		return c.SendStatus(fiber.StatusNotFound)
	}
	body, ct := charticon.IconResponseBody(data)
	c.Set("Content-Type", ct)
	return c.Send(body)
}
