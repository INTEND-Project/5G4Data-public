package main

import (
    "github.com/gofiber/fiber/v2"
    "github.com/arne-munch-ellingsen/intend-5g4data-workload-catalog/internal/routes"
)

func main() {
    app := fiber.New()

    // Serve static files
    app.Static("/", "./public")

    routes.RegisterChartMuseumRoutes(app)

    // SPA fallback (optional)
    app.Get("*", func(c *fiber.Ctx) error {
        return c.SendFile("./public/index.html")
    })

    app.Listen(":3000")
}
