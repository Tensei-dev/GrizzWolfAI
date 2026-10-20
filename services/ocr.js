const { createWorker } = require('tesseract.js');

const SCALE = 2;

async function ocrPdf(parser) {
    const screenshots = await parser.getScreenshot({ scale: SCALE, imageDataUrl: false });
    const worker = await createWorker('por');
    try {
        const pages = [];
        for (const shot of screenshots.pages) {
            const { data } = await worker.recognize(Buffer.from(shot.data));
            pages.push({ num: shot.pageNumber, text: data.text });
        }
        return pages;
    } finally {
        await worker.terminate();
    }
}

module.exports = { ocrPdf };
