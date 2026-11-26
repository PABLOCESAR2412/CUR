const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Cliente mínimo para la API REST de Gemini. Pide JSON y lo parsea.
export function createGemini({ apiKey, model, fetchImpl = fetch }) {
  return {
    model,
    enabled: Boolean(apiKey),

    async generateJson({ system, user }) {
      if (!apiKey) {
        const err = new Error('Falta GEMINI_API_KEY en el entorno');
        err.status = 503;
        throw err;
      }
      const res = await fetchImpl(`${BASE}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        const err = new Error(`Gemini respondió ${res.status}: ${detail.slice(0, 300)}`);
        err.status = 502;
        throw err;
      }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      try {
        return JSON.parse(text);
      } catch {
        const err = new Error('Gemini devolvió una respuesta que no es JSON válido');
        err.status = 502;
        throw err;
      }
    },
  };
}
