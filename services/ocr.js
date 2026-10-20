const { createWorker } = require('tesseract.js');

const SCALE = 2; // renderiza as páginas em 2x: o OCR erra bem menos em imagem maior

// parser: um PDFParse já aberto; retorna [{ num, text }] lido das imagens das páginas
async function ocrPdf(parser) {
    const screenshots = await parser.getScreenshot({ scale: SCALE, imageDataUrl: false });
    const worker = await createWorker('por'); // baixa os dados do português na primeira vez
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
