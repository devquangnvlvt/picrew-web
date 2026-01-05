const startBtn = document.getElementById('startBtn');
const picrewUrlInput = document.getElementById('picrewUrl');
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
        const response = await fetch('/api/scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
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
                showResult(data.downloadUrl);
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

function showResult(url) {
    progressSection.classList.add('hidden');
    resultSection.classList.remove('hidden');
    startBtn.disabled = false;

    // Tự động kích hoạt tải xuống
    setTimeout(() => {
        const autoLink = document.createElement('a');
        autoLink.href = url;
        autoLink.setAttribute('download', ''); // Force download attribute
        document.body.appendChild(autoLink);
        autoLink.click();
        document.body.removeChild(autoLink);

        // Fallback cho một số trình duyệt chặn click lập trình
        setTimeout(() => {
            if (!document.hidden) {
                // Nếu vẫn ở trang này, có thể thử dùng window.location
                // window.location.href = url; // Lưu ý: cái này có thể làm mới trang
            }
        }, 1000);
    }, 500);
}

function showError(msg) {
    progressSection.classList.add('hidden');
    errorSection.classList.remove('hidden');
    errorMessage.innerText = msg;
    startBtn.disabled = false;
}
