const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Max-Age": "86400"
};

const STORY_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-9b";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

function cleanLine(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^\s*["“”]+|["“”]+\s*$/g, "")
    .trim();
}

function getLanguageRule(language) {
  if (language === "Hindi") {
    return "Write every Voice in natural, simple Hindi using Devanagari script. Translate the story meaning into Hindi if needed.";
  }
  if (language === "English") {
    return "Write every Voice in natural, simple English.";
  }
  return "Write every Voice in natural, simple Marathi using Devanagari script. Translate the story meaning into Marathi if needed.";
}

function createStoryPrompt(story, language, duration, style) {
  const durationWords = {
    "1 Minute": "about 80–110 spoken words total across all 8 scenes",
    "2 Minutes": "about 160–220 spoken words total across all 8 scenes",
    "3 Minutes": "about 240–330 spoken words total across all 8 scenes"
  };

  return `You are a children's cartoon screenwriter and animation director.

THE USER'S ORIGINAL STORY IS THE SOURCE OF TRUTH:
${story}

OUTPUT LANGUAGE: ${language}
${getLanguageRule(language)}
TARGET DURATION: ${duration}
Target narration length: ${durationWords[duration] || durationWords["1 Minute"]}.
CARTOON STYLE: ${style}

STRICT STORY RULES:
- Keep the original story, its characters, setting, cause-and-effect and ending.
- Do not replace it with a generic adventure or invent unrelated events.
- Expand only where needed to make exactly 8 connected scenes.
- If the original story is very short, add only small logical actions that fit it.
- Every scene must move the same story forward; no repeated filler scenes.

CHARACTER LOCK:
First create a concise but specific CHARACTER_LOCK section for every important character.
For each character specify identity/species, approximate age or size if relevant, face, body, hair/feathers, exact clothing and colors, accessories and distinctive features. If a detail is not supplied, choose one simple design and keep it identical in all 8 scenes. Do not invent a character unrelated to the story.

SCENE RULES:
- Exactly 8 scenes, numbered 1 to 8.
- Visual must be written in detailed English for image generation.
- Each Visual must describe the exact action, location, time/mood and which locked characters are visible.
- Visual must be different for each scene and follow the original story order.
- Voice must be 1–2 natural narration sentences in ${language}; distribute the target duration across the 8 scenes.
- Voice must narrate only what happens in that scene. Do not add unrelated moral lessons.
- No extra headings or explanations.

Return ONLY this format:
CHARACTER_LOCK:
Character 1: ...
Character 2: ...

SCENE 1
Visual: ...
Voice: ...

SCENE 2
Visual: ...
Voice: ...

Continue in the same format through SCENE 8.`;
}

function getModelText(result) {
  if (typeof result === "string") return result.trim();
  if (result && typeof result.response === "string") return result.response.trim();
  if (result && typeof result.output_text === "string") return result.output_text.trim();
  if (result && typeof result.text === "string") return result.text.trim();
  return "";
}

function extractCharacterLock(text) {
  const cleaned = String(text || "").replace(/```/g, "");
  const start = cleaned.search(/CHARACTER_LOCK\s*:/i);
  if (start < 0) return "";
  const after = cleaned.substring(start).replace(/^CHARACTER_LOCK\s*:\s*/i, "");
  const sceneStart = after.search(/SCENE\s*1\b/i);
  if (sceneStart < 0) return "";
  return after.substring(0, sceneStart).trim();
}

function extractScenes(text) {
  const cleaned = String(text || "")
    .replace(/```(?:text|markdown)?/gi, "")
    .replace(/```/g, "")
    .replace(/\r/g, "")
    .trim();

  const sceneRegex = /(?:^|\n)\s*SCENE\s*([1-8])\s*:?\s*\n\s*Visual\s*:\s*([\s\S]*?)\n\s*Voice\s*:\s*([\s\S]*?)(?=\n\s*SCENE\s*[1-8]\b|$)/gi;
  const byNumber = new Map();
  let match;

  while ((match = sceneRegex.exec(cleaned)) !== null) {
    const number = Number(match[1]);
    const visual = cleanLine(match[2]);
    const voice = cleanLine(match[3]).replace(/\s+(?:CHARACTER_LOCK|SCENE)\s*.*$/i, "").trim();
    if (number >= 1 && number <= 8 && visual && voice && !byNumber.has(number)) {
      byNumber.set(number, { number, visual, voice });
    }
  }

  return Array.from(byNumber.values()).sort((a, b) => a.number - b.number);
}

function validateScenes(scenes, characterLock) {
  if (!characterLock || !Array.isArray(scenes) || scenes.length !== 8) return false;
  return scenes.every((scene, index) =>
    scene && scene.number === index + 1 && scene.visual && scene.voice
  );
}

function buildStory(scenes) {
  return scenes.map(scene =>
    `SCENE ${scene.number}\nVisual: ${cleanLine(scene.visual)}\nVoice: ${cleanLine(scene.voice)}`
  ).join("\n\n");
}

function base64ToBytes(value) {
  let base64 = String(value || "").trim();
  base64 = base64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
  if (!base64) throw new Error("Reference image is empty.");
  if (base64.length > 12_000_000) throw new Error("Reference image is too large. Please use a smaller image.");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function detectImageContentType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  return "image/png";
}

function createImagePrompt({ visual, storyContext, characterLock, style }) {
  const styleText = style === "2D Cartoon"
    ? "polished 2D cartoon animation illustration"
    : style === "Kids Cartoon"
      ? "bright, appealing children's cartoon illustration"
      : "high-quality 3D animated family film cartoon illustration";

  return `Create ONE finished cartoon frame for a sequence of 8 images.

ORIGINAL STORY CONTEXT (do not contradict it):
${storyContext}

LOCKED CHARACTER DESIGNS — reproduce these identities faithfully:
${characterLock}

CURRENT SCENE — illustrate this exact moment and action:
${visual}

VISUAL STYLE: ${styleText}.

Continuity requirements:
- If the reference image is supplied, use it as the visual identity reference for characters only.
- Keep every recurring character's face, eye shape, body proportions, hair/feather color, clothing, clothing colors and accessories consistent with the character lock and reference image.
- Do not copy the previous scene's pose or background; illustrate only the current scene action.
- Show only characters and objects that belong in this scene.
- The scene must visibly match the described action and story context.
- Clear readable composition, expressive faces, detailed story-appropriate environment, vibrant lighting.
- No words, letters, captions, subtitles, speech bubbles, logos or watermarks.
`;
}

async function generateImage(env, data) {
  const visual = String(data.visual || "").trim();
  const storyContext = String(data.storyContext || "").trim();
  const characterLock = String(data.characterLock || "").trim();
  const style = String(data.style || "3D Cartoon").trim();

  if (!visual) throw new Error("Visual description is missing.");
  if (!storyContext) throw new Error("Story context is missing from the image request.");
  if (!characterLock) throw new Error("Character lock is missing from the image request.");

  const form = new FormData();
  form.append("prompt", createImagePrompt({ visual, storyContext, characterLock, style }));
  form.append("width", "1024");
  form.append("height", "768");

  const reference = String(data.referenceImageBase64 || "").trim();
  if (reference) {
    const referenceBytes = base64ToBytes(reference);
    const referenceBlob = new Blob([referenceBytes], { type: "image/png" });
    form.append("input_image_0", referenceBlob, "character-reference.png");
  }

  // FLUX.2 Klein uses multipart input, including image-reference inputs.
  const serialized = new Response(form);
  const modelResult = await env.AI.run(IMAGE_MODEL, {
    multipart: {
      body: serialized.body,
      contentType: serialized.headers.get("content-type")
    }
  });

  let bytes;
  if (modelResult && typeof modelResult.image === "string") {
    bytes = base64ToBytes(modelResult.image);
  } else if (modelResult instanceof ReadableStream) {
    bytes = new Uint8Array(await new Response(modelResult).arrayBuffer());
  } else if (modelResult instanceof ArrayBuffer) {
    bytes = new Uint8Array(modelResult);
  } else if (modelResult instanceof Uint8Array) {
    bytes = modelResult;
  } else if (modelResult && modelResult.image instanceof Uint8Array) {
    bytes = modelResult.image;
  } else {
    throw new Error("FLUX.2 Klein returned an unsupported image response.");
  }

  if (!bytes || !bytes.length) throw new Error("Image model returned an empty image.");
  return new Response(bytes, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": detectImageContentType(bytes),
      "Cache-Control": "no-store"
    }
  });
}

async function generateStory(env, story, language, duration, style) {
  const prompt = createStoryPrompt(story, language, duration, style);
  let lastText = "";
  let lastScenes = [];
  let lastLock = "";

  for (let attempt = 1; attempt <= 3; attempt++) {
    const retryPrompt = attempt === 1 ? prompt : `${prompt}\n\nRETRY ${attempt}: Your previous output did not follow the required format. Return a complete CHARACTER_LOCK followed by all 8 numbered scenes. Do not omit any scene. Do not use filler or generic unrelated events.`;
    const result = await env.AI.run(STORY_MODEL, {
      prompt: retryPrompt,
      max_tokens: 3000,
      temperature: 0.2
    });

    lastText = getModelText(result);
    lastScenes = extractScenes(lastText);
    lastLock = extractCharacterLock(lastText);
    if (validateScenes(lastScenes, lastLock)) break;
  }

  if (!validateScenes(lastScenes, lastLock)) {
    throw new Error(`AI could not create a complete character lock and 8 valid scenes. Parsed ${lastScenes.length}/8 scenes. Please try again with a clearer story.`);
  }

  return {
    success: true,
    language,
    duration,
    style,
    characterLock: lastLock,
    story: buildStory(lastScenes),
    scenes: lastScenes
  };
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const TTS_VOICES = {
  Marathi: { locale: "mr-IN", voice: "mr-IN-AarohiNeural" },
  Hindi: { locale: "hi-IN", voice: "hi-IN-SwaraNeural" },
  English: { locale: "en-IN", voice: "en-IN-NeerjaNeural" }
};

async function generateVoice(env, data) {
  const text = String(data.text || "").trim();
  const language = String(data.language || "Marathi").trim();
  if (!text) throw new Error("Voice text is missing.");
  if (text.length > 5000) throw new Error("Voice text is too long for one scene.");

  if (!env.SPEECH_KEY || !env.SPEECH_REGION) {
    throw new Error("Azure Speech setup is missing. Add SPEECH_KEY (Secret) and SPEECH_REGION (Variable) in Cloudflare Worker Settings.");
  }

  const selected = TTS_VOICES[language] || TTS_VOICES.Marathi;
  const ssml = `<speak version="1.0" xml:lang="${selected.locale}"><voice xml:lang="${selected.locale}" name="${selected.voice}">${escapeXml(text)}</voice></speak>`;
  const endpoint = `https://${env.SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": env.SPEECH_KEY,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
      "User-Agent": "ApnaCreatorAI"
    },
    body: ssml
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 700);
    throw new Error(`Azure Speech failed (HTTP ${response.status}): ${details || "No error details"}`);
  }

  const audio = await response.arrayBuffer();
  if (!audio.byteLength) throw new Error("Azure Speech returned an empty MP3 file.");

  return new Response(audio, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "audio/mpeg",
      "Content-Disposition": "inline; filename=scene-voice.mp3",
      "Cache-Control": "no-store"
    }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === "GET") {
      return jsonResponse({
        success: true,
        status: "ok",
        message: "Apna Creator AI backend is running.",
        storyModel: STORY_MODEL,
        imageModel: IMAGE_MODEL,
        voiceProvider: "Azure Speech"
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ success: false, error: "Method Not Allowed" }, 405);
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return jsonResponse({ success: false, error: "Request body must be valid JSON." }, 400);
    }

    try {
      if (data.action === "generate-story") {
        const story = String(data.story || "").trim();
        const language = String(data.language || "Marathi").trim();
        const duration = String(data.duration || "1 Minute").trim();
        const style = String(data.style || "3D Cartoon").trim();
        if (!story) return jsonResponse({ success: false, error: "Story is required." }, 400);
        if (story.length > 12000) return jsonResponse({ success: false, error: "Story is too long. Keep it under 12,000 characters." }, 400);
        return jsonResponse(await generateStory(env, story, language, duration, style));
      }

      if (data.action === "generate-image") {
        return await generateImage(env, data);
      }

      if (data.action === "generate-voice") {
        return await generateVoice(env, data);
      }

      return jsonResponse({ success: false, error: `Unknown action: ${String(data.action || "(missing)")}` }, 400);
    } catch (error) {
      console.error("Apna Creator AI error:", error);
      return jsonResponse({
        success: false,
        error: error && error.message ? error.message : "Unexpected backend error."
      }, 500);
    }
  }
};
