const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function withoutUnknownEmails(answer, context) {
    const known = new Set((context.match(EMAIL) || []).map((e) => e.toLowerCase()));
    return answer.replace(EMAIL, (email) => {
        if (known.has(email.toLowerCase())) return email;
        console.error(`e-mail inventado removido da resposta: ${email}`);
        return 'e-mail não informado no site';
    });
}

const QUESTION_START = /^(quem|qual|quais|como|onde|quando|quanto|quantos|quantas|o que|que|por que|porque|pra que|para que|posso|pode|podem|existe|existem|tem|há|devo|preciso|é possível)\b/i;

function looksLikeQuestion(message) {
    const text = (message || '').trim();
    return /\?\s*$/.test(text) || QUESTION_START.test(text);
}

module.exports = { withoutUnknownEmails, looksLikeQuestion };
