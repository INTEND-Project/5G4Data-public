package routes

import (
    "bytes"
    "io"
    "mime/multipart"
    "net/http"
	"os"
    "github.com/gofiber/fiber/v2"
)

var chartMuseumBaseURL = getChartMuseumBaseURL()

func getChartMuseumBaseURL() string {
    if url := os.Getenv("CHARTMUSEUM_URL"); url != "" {
        return url
    }
    return "http://localhost:8080" // fallback for local dev
}

func RegisterChartMuseumRoutes(app *fiber.App) {
    api := app.Group("/api")

    // GET /api/charts
    api.Get("/charts", getChartsFromChartMuseum)

    // Future routes:
	api.Post("/charts", uploadChartToChartMuseum)
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

    file, err := fileHeader.Open()
    if err != nil {
        return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
            "error": "Failed to open uploaded file",
        })
    }
    defer file.Close()

    // Create multipart form request to ChartMuseum
    var b bytes.Buffer
    writer := multipart.NewWriter(&b)

    formFile, err := writer.CreateFormFile("chart", fileHeader.Filename)
    if err != nil {
        return err
    }

    if _, err := io.Copy(formFile, file); err != nil {
        return err
    }

    writer.Close()

    // Send POST to ChartMuseum
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

    body, _ := io.ReadAll(resp.Body)
    c.Set("Content-Type", resp.Header.Get("Content-Type"))
    return c.Status(resp.StatusCode).Send(body)
}
