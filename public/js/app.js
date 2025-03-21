document.addEventListener("DOMContentLoaded", () => {
    const tbody = document.getElementById("chart-table-body");
    const chartInput = document.getElementById("chart-upload-input");
    const addChartBtn = document.getElementById("add-chart");
    const statusEl = document.getElementById("upload-status");

    function showChartDetails(name) {
        const section = document.getElementById("chart-details");
        const title = document.getElementById("chart-details-name");
        const tbody = document.getElementById("chart-versions-body");

        title.textContent = name;
        tbody.innerHTML = "";

        fetch(`/api/charts/${name}`)
            .then(res => res.json())
            .then(data => {
                data.forEach(chart => {
                    const row = document.createElement("tr");
                    row.innerHTML = `
                        <td>${chart.version}</td>
                        <td>${chart.description || "N/A"}</td>
                        <td>${chart.type || "N/A"}</td>
                        <td>${chart.appVersion || "N/A"}</td>
                        <td>${new Date(chart.created).toLocaleString()}</td>
                    `;
                    tbody.appendChild(row);
                });

                section.style.display = "block";
            })
            .catch(err => {
                console.error("Failed to load chart details:", err);
                section.style.display = "none";
            });
    }

    let totalPages = 1;
    let totalCharts = 0;
    const chartsPerPage = 5;
    let currentPage = 1;

    function fetchTotalChartCount() {
        return fetch("/api/charts")
            .then(res => res.json())
            .then(data => {
                const chartNames = Object.keys(data);
                totalCharts = chartNames.length;
                totalPages = Math.max(1, Math.ceil(totalCharts / chartsPerPage));
            });
    }

    function loadChartTable(page = 1) {
        const tbody = document.getElementById("chart-table-body");
        const pageInfo = document.getElementById("page-info");
        tbody.innerHTML = "";

        const offset = (page - 1) * chartsPerPage;

        fetch(`/api/charts?offset=${offset}&limit=${chartsPerPage}`)
            .then(response => response.json())
            .then(data => {
                const chartEntries = Object.entries(data);
                if (chartEntries.length === 0 && page > 1) {
                    currentPage--;
                    loadChartTable(currentPage);
                    return;
                }

                chartEntries.forEach(([name, versions]) => {
                    versions.forEach(chart => {
                        const row = document.createElement("tr");

                        row.innerHTML = `
                            <td>
                                ${chart.icon ? `<img src="${chart.icon}" alt="icon" class="chart-icon">` : ""}
                            </td>
                            <td><a href="#" class="chart-name" data-name="${chart.name}">${chart.name}</a></td>
                            <td>${chart.type || "N/A"}</td>
                            <td>${chart.description || "N/A"}</td>
                            <td>${chart.version}</td>
                            <td>${chart.appVersion || "N/A"}</td>
                            <td>
                                <button class="delete-btn" data-name="${chart.name}" data-version="${chart.version}" title="Delete chart">
                                    🗑️
                                </button>
                            </td>
                        `;

                        tbody.appendChild(row);
                    });
                });

                pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
            })
            .catch(err => {
                console.error("Failed to load charts:", err);
            });
    }

    // Initial table load (after getting total chart count)
    fetchTotalChartCount().then(() => {
        loadChartTable(currentPage);
    });

    document.getElementById("prev-page").addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage--;
            loadChartTable(currentPage);
        }
    });

    document.getElementById("next-page").addEventListener("click", () => {
        if (currentPage < totalPages) {
            currentPage++;
            loadChartTable(currentPage);
        }
    });

    // Handle chart upload
    addChartBtn.addEventListener("click", () => {
        chartInput.click();
    });

    chartInput.addEventListener("change", () => {
        if (chartInput.files.length === 0) return;

        const formData = new FormData();
        formData.append("chart", chartInput.files[0]);

        statusEl.textContent = "Uploading...";

        fetch("/api/charts", {
            method: "POST",
            body: formData
        })
            .then(async res => {
                const text = await res.text();
                if (!res.ok) throw new Error(text);
                statusEl.textContent = "Upload successful!";
                return fetchTotalChartCount();
            })
            .then(() => {
                loadChartTable(currentPage);
            })
            .catch(err => {
                console.error("Upload failed:", err);
                statusEl.textContent = "Upload failed: " + err.message;
            })
            .finally(() => {
                chartInput.value = "";
            });
    });

    // Handle delete clicks (event delegation)
    if (tbody) {
        tbody.addEventListener("click", function (e) {
            if (e.target.classList.contains("delete-btn")) {
                const button = e.target;
                const name = button.dataset.name;
                const version = button.dataset.version;

                if (confirm(`Delete chart "${name}" version "${version}"?`)) {
                    fetch(`/api/charts/${name}/${version}`, {
                        method: "DELETE"
                    })
                        .then(res => {
                            if (!res.ok) throw new Error("Failed to delete");
                            return fetchTotalChartCount();
                        })
                        .then(() => {
                            loadChartTable(currentPage);
                        })
                        .catch(err => {
                            console.error("Delete error:", err);
                            alert("Failed to delete chart.");
                        });
                }
            }
        });
    }

    // Handle clicks on chart name links
    tbody.addEventListener("click", function (e) {
        if (e.target.classList.contains("chart-name")) {
            e.preventDefault();
            const chartName = e.target.dataset.name;
            showChartDetails(chartName);
        }
    });
});
