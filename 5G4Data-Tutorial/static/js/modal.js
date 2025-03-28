function openMarkdownModal(modalId, markdownPath, titleText = 'Details') {
    document.getElementById(modalId).style.display = 'flex';
    // Set the title if there's an element for it
    const titleElement = document.getElementById(`${modalId}Title`);
    if (titleElement) {
        titleElement.textContent = titleText;
    }
    
    fetch(markdownPath)
        .then(response => response.text())
        .then(markdown => {
            const converter = new showdown.Converter();
            const html = converter.makeHtml(markdown);
            document.getElementById(`${modalId}Content`).innerHTML = html;
        })
        .catch(error => {
            console.error('Error loading markdown:', error);
            document.getElementById(`${modalId}Content`).innerHTML = 'Error loading content.';
        });
}

function closeMarkdownModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// Close modal when clicking outside
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
    }
}