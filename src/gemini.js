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
          generationConfig: { responseMimeType: 'application/json' },
        }),
      });
      if (!res.ok) {
        const message = res.status === 400 || res.status === 401 || res.status === 403
          ? 'Gemini rechazó la solicitud. Revisa la clave GEMINI_API_KEY y el modelo configurado.'
          : res.status === 429
            ? 'Gemini alcanzó el límite de solicitudes. Vuelve a intentarlo más tarde.'
            : 'Gemini no pudo responder. Vuelve a intentarlo.';
        const err = new Error(message);
        err.status = res.status === 429 ? 429 : 502;
        throw err;
      }
      try {
        const data = await res.json();
        const parts = data?.candidates?.[0]?.content?.parts;
        const text = Array.isArray(parts)
          ? parts.map((part) => !part?.thought && typeof part?.text === 'string' ? part.text : '').join('')
          : '';
        return JSON.parse(text);
      } catch {
        const err = new Error('Gemini devolvió una respuesta que no es JSON válido. Vuelve a intentarlo.');
        err.status = 502;
        throw err;
      }
    },
  };
}
