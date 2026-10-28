require('dotenv').config();
const path = require('path');
const express = require('express');
const Feedback = require('./models/Feedback');
const { answer, EMPTY_PROFILE, MAX_PROFILE_PROMPTS } = require('./services/agent');
const { COURSES } = require('./services/courses');

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QUESTION_CHARS = 1000;
const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_CHARS = 4000;

const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : null);

function readHistory(value) {
    if (!Array.isArray(value)) return [];
    return value
        .slice(-MAX_HISTORY_MESSAGES)
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_HISTORY_CHARS) }));
}

function readProfile(value) {
    if (!value || typeof value !== 'object') return { ...EMPTY_PROFILE };
    const year = Number(value.entryYear);
    const prompts = Number(value.profilePrompts);
    return {
        course: COURSES[value.course] ? value.course : null,
        entryYear: Number.isInteger(year) && year >= 1980 && year <= new Date().getFullYear() ? year : null,
        prospective: value.prospective === true,
        pendingQuestion: text(value.pendingQuestion, MAX_QUESTION_CHARS),
        yearAsked: value.yearAsked === true,
        profilePrompts: Number.isInteger(prompts) ? Math.min(Math.max(prompts, 0), MAX_PROFILE_PROMPTS) : 0,
    };
}

app.post('/api/chat', async (req, res) => {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (!question) return res.status(400).json({ error: 'Pergunta vazia.' });
    if (question.length > MAX_QUESTION_CHARS) {
        return res.status(400).json({ error: `A pergunta pode ter no máximo ${MAX_QUESTION_CHARS} caracteres.` });
    }

    res.json(await answer({
        message: question,
        history: readHistory(req.body.history),
        profile: readProfile(req.body.profile),
    }));
});

app.post('/api/feedback', async (req, res) => {
    const body = req.body || {};
    const rating = Number(body.rating);
    const question = text(body.question, MAX_QUESTION_CHARS);
    const answerText = text(body.answer, MAX_HISTORY_CHARS * 2);
    if (!UUID.test(body.answerId || '') || ![1, -1].includes(rating) || !question || !answerText) {
        return res.status(400).json({ error: 'Avaliação inválida.' });
    }

    const sources = (Array.isArray(body.sources) ? body.sources : []).slice(0, 10).map((s) => ({
        n: Number(s?.n) || null,
        chunkId: Number(s?.chunkId) || null,
        title: text(s?.title, 300),
        page: Number(s?.page) || null,
        sourceUrl: text(s?.sourceUrl, 500),
    }));
    const profile = readProfile(body.profile);

    const feedback = await Feedback.create({
        answerId: body.answerId,
        rating,
        comment: text(body.comment, 1000),
        question,
        answer: answerText,
        sources,
        course: profile.course,
        entryYear: profile.entryYear,
        model: text(body.model, 100),
    });
    if (!feedback) return res.status(409).json({ error: 'Essa resposta já foi avaliada.' });
    res.status(201).end();
});

app.use((err, req, res, next) => {
    console.error(err);
    const busy = /\b429\b|cota/i.test(err.message);
    res.status(busy ? 503 : 500).json({
        error: busy
            ? 'O lobo está sem fôlego: atingimos o limite de uso gratuito. Espere um minutinho e mande de novo.'
            : 'O lobo tropeçou. Tente de novo em instantes.',
    });
});

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`GrizzWolfAI rodando em http://localhost:${PORT}`));
}

module.exports = app;
