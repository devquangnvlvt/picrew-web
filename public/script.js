const startBtn = document.getElementById('startBtn');
const picrewUrlInput = document.getElementById('picrewUrl');
const savePathInput = document.getElementById('savePath');
const progressSection = document.getElementById('progressSection');
const resultSection = document.getElementById('resultSection');
const errorSection = document.getElementById('errorSection');
const statusText = document.getElementById('statusText');
const percentageText = document.getElementById('percentage');
const progressBar = document.getElementById('progressBar');
const downloadCount = document.getElementById('downloadCount');
const errorMessage = document.getElementById('errorMessage');

let pollInterval;

startBtn.addEventListener('click', async () => {
    let url = picrewUrlInput.value.trim();
    if (!url) return alert('Vui lòng nhập ID hoặc URL Picrew');

    // Simple normalization
    if (!url.startsWith('http') && !isNaN(url)) {
        url = `https://picrew.me/en/image_maker/${url}`;
    }

    // Reset UI
    startBtn.disabled = true;
    progressSection.classList.remove('hidden');
    resultSection.classList.add('hidden');
    errorSection.classList.add('hidden');

    try {
        const savePath = savePathInput.value.trim();
        const response = await fetch('/api/scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, savePath: savePath || null })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        startPolling(data.sessionId);
    } catch (err) {
        showError(err.message);
    }
});

function startPolling(sessionId) {
    pollInterval = setInterval(async () => {
        try {
            const res = await fetch(`/api/status/${sessionId}`);
            const data = await res.json();

            updateProgress(data);

            if (data.status === 'completed') {
                clearInterval(pollInterval);
                showResult(data.downloadUrl, data.savedTo);
            } else if (data.status === 'error') {
                clearInterval(pollInterval);
                showError(data.message || 'Lỗi không xác định');
            }
        } catch (err) {
            console.error('Polling error:', err);
        }
    }, 1000);
}

function updateProgress(data) {
    const statusMap = {
        'starting': 'Đang chuẩn bị...',
        'downloading': 'Đang tải ảnh...',
        'zipping': 'Đang đóng gói ZIP...',
        'completed': 'Hoàn tất!'
    };

    statusText.innerText = statusMap[data.status] || 'Đang xử lý...';

    if (data.status === 'downloading') {
        const percent = Math.round((data.progress / data.total) * 100) || 0;
        progressBar.style.width = `${percent}%`;
        percentageText.innerText = `${percent}%`;
        downloadCount.innerText = `${data.progress}/${data.total}`;
    } else if (data.status === 'zipping') {
        progressBar.style.width = '95%';
        percentageText.innerText = '95%';
    }
}

function showResult(downloadUrl, savedTo) {
    progressSection.classList.add('hidden');
    resultSection.classList.remove('hidden');
    startBtn.disabled = false;

    const resultDesc = document.querySelector('#resultSection p');
    const downloadLink = document.getElementById('downloadLink');

    if (savedTo) {
        // Custom path mode: show folder path, no ZIP download
        resultDesc.innerHTML = `Đã lưu thành công vào:<br><code style="font-size:0.85rem;word-break:break-all;">${savedTo}</code>`;
        downloadLink.style.display = 'none';
    } else {
        // Default mode: trigger ZIP download
        resultDesc.textContent = 'Dữ liệu của bạn đã được đóng gói và sẵn sàng.';
        downloadLink.style.display = '';
        setTimeout(() => {
            const autoLink = document.createElement('a');
            autoLink.href = downloadUrl;
            autoLink.setAttribute('download', '');
            document.body.appendChild(autoLink);
            autoLink.click();
            document.body.removeChild(autoLink);
        }, 500);
    }
}

function showError(msg) {
    progressSection.classList.add('hidden');
    errorSection.classList.remove('hidden');
    errorMessage.innerText = msg;
    startBtn.disabled = false;
}
