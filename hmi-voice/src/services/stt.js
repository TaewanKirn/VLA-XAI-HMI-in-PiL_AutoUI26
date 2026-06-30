const STT_ENDPOINT = 'https://speech.googleapis.com/v1/speech:recognize'

/**
 * Converts a recorded audio Blob to base64 and sends it to Google Cloud STT.
 * Returns the Korean transcript string, or '' if nothing was recognized.
 */
export async function transcribeAudio(audioBlob, apiKey) {
  const base64 = await blobToBase64(audioBlob)

  const res = await fetch(`${STT_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: {
        encoding: 'WEBM_OPUS',
        languageCode: 'ko-KR',
        model: 'latest_short',
        enableAutomaticPunctuation: true,
      },
      audio: { content: base64 },
    }),
  })

  const data = await res.json()
  if (data.error) throw new Error(`STT: ${data.error.message}`)
  return data.results?.[0]?.alternatives?.[0]?.transcript ?? ''
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
