document.addEventListener("DOMContentLoaded", () => {
    const tbody = document.getElementById("chart-table-body");
    if (!tbody) {
        console.error("Missing #chart-table-body");
        return;
    }
    const chartInput = document.getElementById("chart-upload-input");
    const addChartBtn = document.getElementById("add-chart");
    const statusEl = document.getElementById("upload-status");

    function clearChartTableBody(tableBody) {
        tableBody.querySelectorAll("img[data-chart-blob]").forEach((el) => {
            const u = el.getAttribute("data-chart-blob");
            if (u) {
                URL.revokeObjectURL(u);
            }
        });
        tableBody.innerHTML = "";
    }

    function resolveAssetURL(iconPath) {
        if (!iconPath) {
            return "";
        }
        if (/^https?:\/\//i.test(iconPath)) {
            return iconPath;
        }
        return new URL(iconPath, window.location.origin).href;
    }

    /** Load icon via fetch → blob URL so the table does not depend on <img> GET quirks (CSP, caching, proxies). */
    function attachChartIcon(cell, iconPath) {
        if (!iconPath) {
            return;
        }
        const url = resolveAssetURL(iconPath);
        const img = document.createElement("img");
        img.className = "chart-icon";
        img.alt = "icon";
        img.decoding = "async";
        img.loading = "lazy";
        cell.appendChild(img);

        fetch(url, { credentials: "same-origin" })
            .then((r) => {
                if (!r.ok) {
                    throw new Error("icon " + r.status);
                }
                return r.blob();
            })
            .then((blob) => {
                const objectUrl = URL.createObjectURL(blob);
                img.src = objectUrl;
                img.setAttribute("data-chart-blob", objectUrl);
            })
            .catch((err) => {
                console.warn("Chart icon failed:", url, err);
                img.remove();
            });
    }

    function showChartDetails(name) {
        const section = document.getElementById("chart-details");
        const title = document.getElementById("chart-details-name");
        const versionsBody = document.getElementById("chart-versions-body");

        title.textContent = name;
        versionsBody.innerHTML = "";

        fetch(`/api/charts/${encodeURIComponent(name)}`)
            .then((res) => res.json())
            .then((data) => {
                data.forEach((chart) => {
                    const row = document.createElement("tr");
                    [chart.version, chart.description, chart.type, chart.appVersion].forEach((v) => {
                        const td = document.createElement("td");
                        td.textContent = v != null && v !== "" ? String(v) : "N/A";
                        row.appendChild(td);
                    });
                    const tdCreated = document.createElement("td");
                    tdCreated.textContent = chart.created ? new Date(chart.created).toLocaleString() : "N/A";
                    row.appendChild(tdCreated);
                    versionsBody.appendChild(row);
                });

                if (section) {
                    section.style.display = "block";
                }
            })
            .catch((err) => {
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
            .then((res) => res.json())
            .then((data) => {
                const chartNames = Object.keys(data);
                totalCharts = chartNames.length;
                totalPages = Math.max(1, Math.ceil(totalCharts / chartsPerPage));
            });
    }

    function buildChartRow(chart) {
        const row = document.createElement("tr");

        const tdIcon = document.createElement("td");
        attachChartIcon(tdIcon, chart.icon);
        row.appendChild(tdIcon);

        const tdName = document.createElement("td");
        tdName.textContent = chart.name || "N/A";
        row.appendChild(tdName);

        const tdType = document.createElement("td");
        tdType.textContent = chart.type || "N/A";
        row.appendChild(tdType);

        const tdDesc = document.createElement("td");
        tdDesc.textContent = chart.description || "N/A";
        row.appendChild(tdDesc);

        const tdVer = document.createElement("td");
        tdVer.textContent = chart.version || "N/A";
        row.appendChild(tdVer);

        const tdApp = document.createElement("td");
        tdApp.textContent = chart.appVersion || "N/A";
        row.appendChild(tdApp);

        const tdDel = document.createElement("td");
        const delBtn = document.createElement("button");
        delBtn.className = "delete-btn";
        delBtn.title = "Delete chart";
        delBtn.textContent = "🗑️";
        delBtn.dataset.name = chart.name || "";
        delBtn.dataset.version = chart.version || "";
        tdDel.appendChild(delBtn);
        row.appendChild(tdDel);

        return row;
    }

    function loadChartTable(page = 1) {
        const pageInfo = document.getElementById("page-info");
        clearChartTableBody(tbody);

        const offset = (page - 1) * chartsPerPage;

        fetch(`/api/charts?offset=${offset}&limit=${chartsPerPage}`)
            .then((response) => response.json())
            .then((data) => {
                const chartEntries = Object.entries(data);
                if (chartEntries.length === 0 && page > 1) {
                    currentPage--;
                    loadChartTable(currentPage);
                    return;
                }

                chartEntries.forEach(([, versions]) => {
                    versions.forEach((chart) => {
                        tbody.appendChild(buildChartRow(chart));
                    });
                });

                pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
            })
            .catch((err) => {
                console.error("Failed to load charts:", err);
            });
    }

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

    addChartBtn.addEventListener("click", () => {
        chartInput.click();
    });

    chartInput.addEventListener("change", () => {
        if (chartInput.files.length === 0) {
            return;
        }

        const formData = new FormData();
        formData.append("chart", chartInput.files[0]);

        statusEl.textContent = "Uploading...";

        fetch("/api/charts", {
            method: "POST",
            body: formData
        })
            .then(async (res) => {
                const text = await res.text();
                if (!res.ok) {
                    throw new Error(text);
                }
                statusEl.textContent = "Upload successful!";
                return fetchTotalChartCount();
            })
            .then(() => {
                loadChartTable(currentPage);
            })
            .catch((err) => {
                console.error("Upload failed:", err);
                statusEl.textContent = "Upload failed: " + err.message;
            })
            .finally(() => {
                chartInput.value = "";
            });
    });

    tbody.addEventListener("click", function (e) {
        if (e.target.classList.contains("delete-btn")) {
            const button = e.target;
            const name = button.dataset.name;
            const version = button.dataset.version;

            if (confirm(`Delete chart "${name}" version "${version}"?`)) {
                fetch(`/api/charts/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, {
                    method: "DELETE"
                })
                    .then((res) => {
                        if (!res.ok) {
                            throw new Error("Failed to delete");
                        }
                        return fetchTotalChartCount();
                    })
                    .then(() => {
                        loadChartTable(currentPage);
                    })
                    .catch((err) => {
                        console.error("Delete error:", err);
                        alert("Failed to delete chart.");
                    });
            }
            return;
        }
        if (e.target.classList.contains("chart-name")) {
            e.preventDefault();
            showChartDetails(e.target.dataset.name);
        }
    });
});
