const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=UTF-8"
    }
  });
}

function cleanText(text) {
  return String(text || "")
    .replace(/```json/gi, "")
    .replace(/```text/gi, "")
    .replace(/```/g, "")
    .replace(/\r/g, "")
    .trim();
}

function cleanVoice(text) {
  let voice = String(text || "").replace(/\s+/g, " ").trim();
  voice = voice
    .replace(/Here is the output.*$/i, "")
    .replace(/I will make sure.*$/i, "")
    .replace(/Please let me know.*$/i, "")
    .replace(/\bSTOP\b.*$/i, "")
    .trim();

  const parts = voice.split(/(?<=[.!?।])\s+/).map(x => x.trim()).filter(Boolean);
  const unique = [];

  for (const part of parts) {
    const normalized = part.replace(/^["“”]+|["“”]+$/g, "").trim();
    if (!normalized) continue;
    if (!unique.some(x => x.toLowerCase() === normalized.toLowerCase())) {
      unique.push(normalized);
    }
    if (unique.length >= 2) break;
  }

  if (unique.length > 0) voice = unique.join(" ");
  if (voice.length > 220) {
    const shortParts = voice.split(/(?<=[.!?।])\s+/).slice(0, 2);
    voice = shortParts.join(" ").slice(0, 220).trim();
  }
  return voice;
}

function cleanVisual(text) {
  return String(text || "").replace(/\s+/g, " ").replace(/^["“”]+|["“”]+$/g, "").trim();
}

function extractScenes(text) {
  const cleaned = cleanText(text);
  const regex = /SCENE\s*([1-8])\s*[\r\n]+Visual\s*:\s*([\s\S]*?)[\r\n]+Voice\s*:\s*([\s\S]*?)(?=[\r\n]+SCENE\s*[1-8]\b|$)/gi;
  const scenes = [];
  let match;

  while ((match = regex.exec(cleaned)) !== null) {
    const number = Number(match[1]);
    if (number < 1 || number > 8) continue;
    const visual = cleanVisual(match[2]);
    const voice = cleanVoice(match[3]);
    if (visual && voice) scenes.push({ number, visual, voice });
  }

  const unique = [];
  for (const scene of scenes) {
    if (!unique.some(x => x.number === scene.number)) unique.push(scene);
  }
  unique.sort((a, b) => a.number - b.number);
  return unique;
}

function validateScenes(scenes) {
  if (!Array.isArray(scenes) || scenes.length !== 8) return false;
  for (let i = 0; i < 8; i++) {
    if (!scenes[i] || scenes[i].number !== i + 1 || !scenes[i].visual || !scenes[i].voice) return false;
  }
  return true;
}

function buildStory(scenes) {
  return scenes
    .map(scene => "SCENE " + scene.number + "\nVisual: " + cleanVisual(scene.visual) + "\nVoice: " + cleanVoice(scene.voice))
    .join("\n\n");
}

function languageInstruction(language) {
  if (language === "Marathi") {
    return "OUTPUT LANGUAGE: MARATHI\nWrite everything in natural, simple Marathi.\nUse Marathi for Visual and Voice.\nDo not use English except unavoidable proper names.\nUse language suitable for children.";
  }
  if (language === "Hindi") {
    return "OUTPUT LANGUAGE: HINDI\nWrite everything in natural, simple Hindi.\nUse Hindi for Visual and Voice.\nUse language suitable for children.";
  }
  return "OUTPUT LANGUAGE: ENGLISH\nWrite everything in natural, simple English.\nUse English for Visual and Voice.\nUse language suitable for children.";
}

function createPrompt(story, language, duration, style) {
  return `You are an expert children's cartoon story writer.

USER STORY:
${story}

LANGUAGE:
${language}

VIDEO DURATION:
${duration}

STYLE:
${style}

${languageInstruction(language)}

Create exactly 8 connected scenes.

VERY IMPORTANT RULES:
1. Return EXACTLY 8 scenes (1 to 8).
2. Every scene must contain exactly ONE Visual and ONE Voice.
3. Visual must be short description.
4. Voice must contain only 1 or 2 natural sentences.
5. NEVER repeat sentences.
6. Do not add title, markdown, or commentary.

Use EXACTLY this format:
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
Voice: ...

OUTPUT ONLY THE 8 SCENES.`;
}

async function generateStory(env, prompt) {
  return await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
    prompt: prompt,
    max_tokens: 1000,
    temperature: 0.15
  });
}

function createImagePrompt(visual, style) {
  return `masterpiece, 3d pixar disney style animated cartoon, ${visual}, 8k resolution, vibrant colors, cinematic lighting, cute expressive character, high quality 3d render, detailed environment, no text, no watermark`;
}

/* ========================================================
   स्मार्ट इमेज जनरेटर (Automatic Model Fallback)
   १. आधी Dreamshaper LCM ट्राय करेल (अतिशय वेगवान व नो-एरर)
   २. लोड असेल तर SDXL Lightning ट्राय करेल
   ३. शेवटी Flux ट्राय करेल
======================================================== */
async function generateImage(env, visual, style) {
  const prompt = createImagePrompt(visual, style);

  // Model 1: Dreamshaper LCM (सुपरफास्ट आणि क्षमतेची समस्या येत नाही)
  try {
    return await env.AI.run("@cf/lykon/dreamshaper-8-lcm", {
      prompt: prompt,
      num_steps: 6
    });
  } catch (err1) {
    // Model 2: SDXL Lightning
    try {
      return await env.AI.run("@cf/bytedance/stable-diffusion-xl-lightning", {
        prompt: prompt,
        num_steps: 4
      });
    } catch (err2) {
      // Model 3: Flux Schnell
      return await env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
        prompt: prompt,
        steps: 4
      });
    }
  }
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
        message: "Apna Creator AI Backend is running with Multi-Model Image Support!"
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ success: false, error: "Method Not Allowed" }, 405);
    }

    try {
      const data = await request.json();

      if (data.action === "generate-image") {
        const visual = String(data.visual || "").trim();
        const style = String(data.style || "3D Cartoon").trim();

        if (!visual) {
          return jsonResponse({ success: false, error: "Visual is required" }, 400);
        }

        try {
          const image = await generateImage(env, visual, style);
          return new Response(image, {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "image/png",
              "Cache-Control": "no-store"
            }
          });
        } catch (error) {
          return jsonResponse({
            success: false,
            error: "Image generation failed: " + (error && error.message ? error.message : "Unknown error")
          }, 500);
        }
      }

      const story = String(data.story || "").trim();
      const language = String(data.language || "Hindi").trim();
      const duration = String(data.duration || "1 Minute").trim();
      const style = String(data.style || "3D Cartoon").trim();

      if (!story) {
        return jsonResponse({ success: false, error: "Story is required" }, 400);
      }

      const prompt = createPrompt(story, language, duration, style);
      let result = await generateStory(env, prompt);
      let scenes = extractScenes(result && result.response ? result.response : "");

      if (validateScenes(scenes)) {
        return jsonResponse({ success: true, language: language, story: buildStory(scenes) });
      }

      result = await generateStory(env, prompt + "\n\nIMPORTANT: Generate exactly 8 scenes again. Each Voice must contain ONLY ONE short sentence.");
      scenes = extractScenes(result && result.response ? result.response : "");

      if (validateScenes(scenes)) {
        return jsonResponse({ success: true, language: language, story: buildStory(scenes) });
      }

      if (scenes.length === 8) {
        scenes = scenes.map(scene => ({
          number: scene.number,
          visual: cleanVisual(scene.visual),
          voice: cleanVoice(scene.voice)
        }));
        return jsonResponse({
          success: true,
          language: language,
          story: buildStory(scenes)
        });
      }

      return jsonResponse({ success: false, error: "AI did not return 8 usable scenes. Please try again." }, 500);
    } catch (error) {
      return jsonResponse({ success: false, error: error && error.message ? error.message : "Server error" }, 500);
    }
  }
};
