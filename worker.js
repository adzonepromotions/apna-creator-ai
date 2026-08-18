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
  return voice.replace(/^["“”]+|["“”]+$/g, "").trim();
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

function createPrompt(story, language) {
  return `You are a professional children's 3D cartoon writer.
Write a continuous, logically progressing 8-scene cartoon story based on the user's idea.

USER STORY IDEA:
${story}

OUTPUT LANGUAGE:
${language === "Marathi" ? "Strictly MARATHI (मराठी शुद्ध वाक्यरचना)" : (language === "Hindi" ? "Strictly HINDI" : "ENGLISH")}

CRITICAL STORY RULES:
1. Create exactly 8 sequential scenes (SCENE 1 to SCENE 8) with a beginning, middle, and meaningful moral conclusion.
2. Every scene must have ONE short Visual description and ONE meaningful Voice line.
3. DO NOT repeat sentences or dialogue across scenes. Every dialogue must advance the plot.
4. Visual must describe cute 3D cartoon action.
5. Do NOT add titles, introduction, notes, or markdown.

Format MUST be exactly:
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

async function generateStory(env, prompt) {
  return await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
    prompt: prompt,
    max_tokens: 1200,
    temperature: 0.25
  });
}

function createImagePrompt(visual) {
  return `masterpiece, cute 3d pixar disney animation style, vibrant lighting, expressive character, detailed cartoon background, 8k resolution, ${visual}, cinematic composition, no text, no watermark`;
}

async function generateImage(env, visual) {
  const prompt = createImagePrompt(visual);
  try {
    return await env.AI.run("@cf/lykon/dreamshaper-8-lcm", {
      prompt: prompt,
      num_steps: 6
    });
  } catch (err) {
    return await env.AI.run("@cf/bytedance/stable-diffusion-xl-lightning", {
      prompt: prompt,
      num_steps: 4
    });
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method === "GET") {
      return jsonResponse({ success: true, message: "Backend is Active!" });
    }

    if (request.method !== "POST") {
      return jsonResponse({ success: false, error: "Method Not Allowed" }, 405);
    }

    try {
      const data = await request.json();

      if (data.action === "generate-image") {
        const visual = String(data.visual || "").trim();
        if (!visual) return jsonResponse({ success: false, error: "Visual required" }, 400);

        try {
          const image = await generateImage(env, visual);
          return new Response(image, {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "image/png",
              "Cache-Control": "no-store"
            }
          });
        } catch (error) {
          return jsonResponse({ success: false, error: error.message }, 500);
        }
      }

      const story = String(data.story || "").trim();
      const language = String(data.language || "Marathi").trim();

      if (!story) return jsonResponse({ success: false, error: "Story required" }, 400);

      const prompt = createPrompt(story, language);
      let result = await generateStory(env, prompt);
      let scenes = extractScenes(result && result.response ? result.response : "");

      if (validateScenes(scenes)) {
        return jsonResponse({ success: true, language: language, story: buildStory(scenes) });
      }

      // Retry
      result = await generateStory(env, prompt + "\n\nCRITICAL: Ensure exactly 8 distinct scenes with no repeated lines.");
      scenes = extractScenes(result && result.response ? result.response : "");

      if (scenes.length === 8) {
        return jsonResponse({ success: true, language: language, story: buildStory(scenes) });
      }

      return jsonResponse({ success: false, error: "AI could not generate 8 structured scenes. Please try again." }, 500);

    } catch (error) {
      return jsonResponse({ success: false, error: error.message }, 500);
    }
  }
};
