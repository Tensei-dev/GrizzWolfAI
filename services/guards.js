// Conferências da resposta do modelo contra o que ele recebeu.

// E-mail que não está no contexto foi montado pelo modelo (ex.: "gabriel.firme@ufu.br" a partir do nome do secretário,
// quando o certo é gabrielfirme@ufu.br): sai da resposta, porque um e-mail errado manda o estudante para o vazio.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function withoutUnknownEmails(answer, context) {
    const known = new Set((context.match(EMAIL) || []).map((e) => e.toLowerCase()));
    return answer.replace(EMAIL, (email) => {
        if (known.has(email.toLowerCase())) return email;
        console.error(`e-mail inventado removido da resposta: ${email}`);
        return 'e-mail não informado no site';
    });
}

module.exports = { withoutUnknownEmails };
