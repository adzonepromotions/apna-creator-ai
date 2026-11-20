const corsHeaders = {
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
      ...corsHeaders,
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

function cleanLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error("Reference image data is invalid.");
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function imageResultToBytes(result) {
  if (result instanceof Uint8Array) return result;
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (ArrayBuffer.isView(result)) {
    return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
  }
  const encoded = result && (result.image || result.data);
  if (typeof encoded === "string") {
    const clean = encoded.replace(/^data:image\/[^;]+;base64,/, "");
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  throw new Error("Image model returned no image bytes.");
}

function getLanguageDetails(language) {
  if (language === "Hindi") {
    return {
      locale: "hi-IN",
      voice: "hi-IN-SwaraNeural"
    };
  }
  if (language === "English") {
    return {
      locale: "en-IN",
      voice: "en-IN-NeerjaNeural"
    };
  }
  return {
    locale: "mr-IN",
    voice: "mr-IN-AarohiNeural"
  };
}

function makeStoryPrompt(story, language, duration, style) {
  return `You are a professional children's story writer and animation storyboard director.

SOURCE STORY (the only source of truth):
${story}

Create exactly 8 chronological, connected scenes. Preserve the source story's characters, setting, objects, cause-and-effect, and ending. Do not replace it with a generic children's story. Do not invent a new cast or unrelated events. Expand only where necessary to create 8 visual moments.

Target narration language: ${language}.
Cartoon style: ${style}.
Requested total video duration: ${duration}.

Before the scenes, create CHARACTER_LOCK. List every important recurring character and give each a short fixed visual description: name, approximate age/species, face, hair/fur/feathers, body shape, clothing and colors, accessories. If the source does not specify a detail, choose one simple design and keep it identical in all scenes. Do not invent extra main characters.

For every scene:
- Visual must be in English and describe one specific frame/action that actually happens in the source story.
- Include the names and fixed appearance details of characters who are visible in that scene.
- State the exact action, location, important object, and emotion. Avoid generic phrases.
- Voice must be natural ${language}, one or two short sentences, and must narrate that exact scene.
- The eight Visuals must be different and advance the same story in order.

Return only this format, with no Markdown and no extra explanation:
CHARACTER_LOCK:
Character 1: ...
Character 2: ...

SCENE 1
Visual: ...
Voice: ...

SCENE 2
Visual: ...
Voice: ...

SCENE 3
Visual: ...
Voice: ...

SCENE 4
Visual: ...
Voice: ...

SCENE 5
Visual: ...
Voice: ...

SCENE 6
Visual: ...
Voice: ...

SCENE 7
Visual: ...
Voice: ...

SCENE 8
Visual: ...
Voice: ...`;
}

function extractScenes(text) {
  const source = String(text || "")
    .replace(/```(?:text|markdown)?/gi, "")
    .replace(/```/g, "")
    .replace(/\r/g, "")
    .trim();
  const regex = /SCENE\s*([1-8])\s*:?\s*[\r\n]+\s*Visual\s*:\s*([\s\S]*?)\s*[\r\n]+\s*Voice\s*:\s*([\s\S]*?)(?=[\r\n]+\s*SCENE\s*[1-8]\b|$)/gi;
  const found = new Map();
  let match;
  while ((match = regex.exec(source)) !== null) {
    const number = Number(match[1]);
    const visual = cleanLine(match[2]);
    const voice = cleanLine(match[3]);
    if (number >= 1 && number <= 8 && visual && voice) {
      found.set(number, { number, visual, voice });
    }
  }
  return Array.from(found.values()).sort((a, b) => a.number - b.number);
}

function extractCharacterLock(text) {
  const source = String(text || "").replace(/\r/g, "");
  const match = source.match(/CHARACTER_LOCK\s*:\s*([\s\S]*?)(?=\n\s*SCENE\s*1\b)/i);
  return match ? match[1].trim() : "";
}

function buildStory(scenes) {
  return scenes.map(scene =>
    `SCENE ${scene.number}\nVisual: ${scene.visual}\nVoice: ${scene.voice}`
  ).join("\n\n");
}

async function generateStory(env, story, language, duration, style) {
  const prompt = makeStoryPrompt(story, language, duration, style);
  let lastText = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const promptToSend = attempt === 1 ? prompt : `${prompt}\n\nSTRICT RETRY: Your prior response did not contain a parseable CHARACTER_LOCK and all 8 numbered scenes. Return all sections exactly in the required format. Do not omit any scene.`;
    const result = await env.AI.run(STORY_MODEL, {
      prompt: promptToSend,
      max_tokens: 3200,
      temperature: 0.2
    });
    lastText = result && typeof result.response === "string" ? result.response : "";
    const scenes = extractScenes(lastText);
    const characterLock = extractCharacterLock(lastText);
    if (scenes.length === 8 && scenes.every((scene, index) => scene.number === index + 1) && characterLock.length >= 20) {
      return { scenes, characterLock };
    }
  }

  throw new Error(`AI did not return a valid character lock and 8 scenes. No fallback story was generated. Response: ${lastText.slice(0, 900)}`);
}

function makeImagePrompt({ story, visual, characterLock, style, sceneNumber }) {
  const styleDescription = style === "2D Cartoon"
    ? "polished 2D hand-painted children's animation"
    : style === "Kids Cartoon"
      ? "bright soft children's picture-book cartoon illustration"
      : "high quality cinematic 3D animated children's cartoon";

  return `Create ONE single cinematic frame for scene ${sceneNumber} of an existing children's story.

FULL STORY CONTEXT (use only to understand continuity):
${String(story || "").slice(0, 2500)}

FIXED CHARACTER DESIGNS — preserve these identities exactly:
${characterLock}

THIS SCENE'S EXACT VISUAL ACTION — illustrate this, not a different event:
${visual}

Continuity instructions:
- Any recurring character shown must retain the exact same face, hairstyle, skin/fur/feather colors, body proportions, clothing, clothing colors and accessories from the reference image and character descriptions.
- Use the reference image only as identity/design guidance; do not copy its old pose or background.
- Show only characters and objects required by this scene. Do not add random children, animals or props.
- One scene only, one coherent camera view, not a collage or storyboard.

Visual style: ${styleDescription}. Rich expressive faces, clear readable action, detailed story-appropriate background, warm cinematic lighting, attractive composition.

STRICT IMAGE RESTRICTIONS: no letters, no words, no numbers, no title, no captions, no subtitles, no speech bubbles, no signs with writing, no logos, no watermarks. Do not draw any text anywhere.`;
}

async function generateImage(env, data) {
  const prompt = makeImagePrompt({
    story: data.story,
    visual: data.visual,
    characterLock: data.characterLock,
    style: data.style,
    sceneNumber: data.sceneNumber
  });

  const form = new FormData();
  form.set("prompt", prompt);
  form.set("width", "1024");
  form.set("height", "768");

  if (data.referenceImage) {
    const refBytes = decodeDataUrl(data.referenceImage);
    if (refBytes.byteLength > 2_000_000) {
      throw new Error("Reference image is too large. The browser should resize it before upload.");
    }
    form.append("input_image_0", new Blob([refBytes], { type: "image/jpeg" }), "character-reference.jpg");
  }

  const multipartResponse = new Response(form);
  const result = await env.AI.run(IMAGE_MODEL, {
    multipart: {
      body: multipartResponse.body,
      contentType: multipartResponse.headers.get("content-type")
    }
  });
  return imageResultToBytes(result);
}

async function generateVoice(env, text, language) {
  if (!env.SPEECH_KEY || !env.SPEECH_REGION) {
    throw new Error("Voice setup missing. Add SPEECH_KEY (Secret) and SPEECH_REGION (Variable) in Cloudflare Worker settings.");
  }

  const details = getLanguageDetails(language);
  const ssml = `<speak version="1.0" xml:lang="${details.locale}"><voice name="${details.voice}">${escapeXml(text)}</voice></speak>`;
  const region = String(env.SPEECH_REGION).trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(region)) throw new Error("SPEECH_REGION is invalid.");

  const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": env.SPEECH_KEY,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "ApnaCreatorAI"
    },
    body: ssml
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Azure Speech failed (HTTP ${response.status}): ${detail}`);
  }
  const audio = await response.arrayBuffer();
  if (!audio.byteLength) throw new Error("Speech service returned an empty audio file.");
  return audio;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method === "GET") {
      return jsonResponse({
        success: true,
        status: "ok",
        message: "Apna Creator AI Worker is running.",
        storyModel: STORY_MODEL,
        imageModel: IMAGE_MODEL,
        voiceConfigured: Boolean(env.SPEECH_KEY && env.SPEECH_REGION)
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

        const generated = await generateStory(env, story, language, duration, style);
        return jsonResponse({
          success: true,
          language,
          duration,
          style,
          characterLock: generated.characterLock,
          scenes: generated.scenes,
          story: buildStory(generated.scenes)
        });
      }

      if (data.action === "generate-image") {
        const visual = String(data.visual || "").trim();
        const story = String(data.story || "").trim();
        const characterLock = String(data.characterLock || "").trim();
        const style = String(data.style || "3D Cartoon").trim();
        const sceneNumber = Math.max(1, Math.min(8, Number(data.sceneNumber) || 1));
        if (!visual || !characterLock) {
          return jsonResponse({ success: false, error: "Scene visual or character lock is missing. Generate the story again." }, 400);
        }

        const bytes = await generateImage(env, {
          story,
          visual,
          characterLock,
          style,
          sceneNumber,
          referenceImage: data.referenceImage || ""
        });
        return new Response(bytes, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "image/png",
            "Cache-Control": "no-store"
          }
        });
      }

      if (data.action === "generate-voice") {
        const text = String(data.text || "").trim();
        const language = String(data.language || "Marathi").trim();
        if (!text) return jsonResponse({ success: false, error: "Voice text is required." }, 400);
        const audio = await generateVoice(env, text, language);
        return new Response(audio, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "audio/mpeg",
            "Content-Length": String(audio.byteLength),
            "Cache-Control": "no-store"
          }
        });
      }

      return jsonResponse({ success: false, error: `Unknown action: ${String(data.action || "(missing)")}` }, 400);
    } catch (error) {
      console.error("APNA CREATOR AI ERROR", error);
      return jsonResponse({
        success: false,
        error: error && error.message ? error.message : "Unexpected Worker error."
      }, 500);
    }
  }
};

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
