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

function cleanLine(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^["“”]+|["“”]+$/g, "")
    .trim();
}

function extractScenes(text) {
  const cleaned = cleanText(text);
  const regex = /SCENE\s*([1-8])\s*[\r\n]+Visual\s*:\s*([\s\S]*?)[\r\n]+Voice\s*:\s*([\s\S]*?)(?=[\r\n]+SCENE\s*[1-8]\b|$)/gi;
  const scenes = [];
  let match;

  while ((match = regex.exec(cleaned)) !== null) {
    const number = Number(match[1]);
    if (number < 1 || number > 8) continue;
    const visual = cleanLine(match[2]);
    const voice = cleanLine(match[3]);
    if (visual && voice) {
      scenes.push({ number, visual, voice });
    }
  }

  const unique = [];
  for (const s of scenes) {
    if (!unique.some(x => x.number === s.number)) {
      unique.push(s);
    }
  }
  unique.sort((a, b) => a.number - b.number);
  return unique;
}

function buildStory(scenes) {
  return scenes
    .map(s => `SCENE ${s.number}\nVisual: ${cleanLine(s.visual)}\nVoice: ${cleanLine(s.voice)}`)
    .join("\n\n");
}

function createStoryPrompt(story, language) {
  let langRule = "Write Voice in natural, simple MARATHI (मराठी वाक्यरचना).";
  if (language === "Hindi") langRule = "Write Voice in natural, simple HINDI.";
  if (language === "English") langRule = "Write Voice in simple, fluent ENGLISH.";

  return `You are an expert children's 3D cartoon story writer.
Create exactly 8 connected cartoon scenes based on: "${story}"

RULES:
1. Return EXACTLY 8 scenes (SCENE 1 to SCENE 8).
2. Visual MUST ALWAYS be written in ENGLISH (clear description of 3D animated scene).
3. ${langRule}
4. Each Voice must be exactly ONE meaningful short sentence. No repeated sentences.
5. No title, no introduction, no markdown fences.

FORMAT:
SCENE 1
Visual: English visual description
Voice: Short dialogue sentence

SCENE 2
Visual: English visual description
Voice: Short dialogue sentence

SCENE 3
Visual: English visual description
Voice: Short dialogue sentence

SCENE 4
Visual: English visual description
Voice: Short dialogue sentence

SCENE 5
Visual: English visual description
Voice: Short dialogue sentence

SCENE 6
Visual: English visual description
Voice: Short dialogue sentence

SCENE 7
Visual: English visual description
Voice: Short dialogue sentence

SCENE 8
Visual: English visual description
Voice: Short dialogue sentence`;
}

async function generateImage(env, visual) {
  const prompt = `masterpiece, cute 3D Disney Pixar animated cartoon illustration, ${visual}, bright lighting, vibrant colors, child friendly, 8k resolution, cinematic composition, highly detailed 3d render, no text, no watermark`;
  
  // No num_steps parameter to avoid schema rejection
  return await env.AI.run("@cf/bytedance/stable-diffusion-xl-lightning", {
    prompt: prompt
  });
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
        message: "Apna Creator AI Backend is active and running!"
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({ success: false, error: "Method Not Allowed" }, 405);
    }

    try {
      const data = await request.json();

      /* 1. IMAGE GENERATION */
      if (data.action === "generate-image") {
        const visual = String(data.visual || "").trim();
        if (!visual) {
          return jsonResponse({ success: false, error: "Visual description required" }, 400);
        }

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
        } catch (imgErr) {
          return jsonResponse({ success: false, error: "Image error: " + imgErr.message }, 500);
        }
      }

      /* 2. STORY GENERATION */
      const story = String(data.story || "").trim();
      const language = String(data.language || "Marathi").trim();

      if (!story) {
        return jsonResponse({ success: false, error: "Story is required" }, 400);
      }

      const prompt = createStoryPrompt(story, language);
      const res = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
        prompt: prompt,
        max_tokens: 1200,
        temperature: 0.2
      });

      let scenes = extractScenes(res && res.response ? res.response : "");

      if (scenes.length >= 6) {
        return jsonResponse({
          success: true,
          language: language,
          story: buildStory(scenes)
        });
      }

      // Retry Attempt
      const retryRes = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
        prompt: prompt + "\n\nCRITICAL: You MUST return all 8 scenes from SCENE 1 to SCENE 8.",
        max_tokens: 1200,
        temperature: 0.1
      });

      scenes = extractScenes(retryRes && retryRes.response ? retryRes.response : "");

      if (scenes.length >= 6) {
        return jsonResponse({
          success: true,
          language: language,
          story: buildStory(scenes)
        });
      }

      return jsonResponse({
        success: false,
        error: "AI could not generate 8 structured scenes. Please try again."
      }, 500);

    } catch (err) {
      return jsonResponse({ success: false, error: err.message || "Server Error" }, 500);
    }
  }
};
