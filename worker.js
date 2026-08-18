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
  return String(text || "").replace(/```json|```text|```|\r/gi, "").trim();
}

function cleanLine(text) {
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
    const visual = cleanLine(match[2]);
    const voice = cleanLine(match[3]);
    if (visual && voice) scenes.push({ number, visual, voice });
  }

  const unique = [];
  for (const s of scenes) {
    if (!unique.some(x => x.number === s.number)) unique.push(s);
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
  return `You are a children's 3D cartoon movie director.
Create an 8-scene connected cartoon story from this idea: "${story}"

LANGUAGE RULES:
- Output language for Voice must be: ${language === "Marathi" ? "Natural MARATHI (मराठी वाक्यरचना)" : (language === "Hindi" ? "HINDI" : "ENGLISH")}.
- Visual description MUST BE IN SIMPLE ENGLISH (so image generator understands it perfectly).
- Voice must be a single, meaningful sentence that connects logically with the next scene.
- No repeated sentences.

OUTPUT FORMAT EXACTLY:
SCENE 1
Visual: English description of cute 3d scene
Voice: Dialogue in chosen language

SCENE 2
Visual: English description of cute 3d scene
Voice: Dialogue in chosen language

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

async function generateImage(env, visual) {
  const prompt = `cute 3D Pixar animated cartoon character, bright daylight, vibrant vivid colors, cinematic 3D render, highly detailed background, disney pixar style, ${visual}, no text, masterpiece`;
  
  try {
    return await env.AI.run("@cf/bytedance/stable-diffusion-xl-lightning", {
      prompt: prompt,
      num_steps: 4
    });
  } catch (err) {
    return await env.AI.run("@cf/lykon/dreamshaper-8-lcm", {
      prompt: prompt,
      num_steps: 6
    });
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method === "GET") {
      return jsonResponse({ success: true, status: "ok" });
    }

    try {
      const data = await request.json();

      if (data.action === "generate-image") {
        const visual = String(data.visual || "").trim();
        const img = await generateImage(env, visual);
        return new Response(img, {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "image/png" }
        });
      }

      const story = String(data.story || "").trim();
      const language = String(data.language || "Marathi").trim();

      const prompt = createStoryPrompt(story, language);
      const res = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
        prompt: prompt,
        max_tokens: 1200,
        temperature: 0.2
      });

      const scenes = extractScenes(res && res.response ? res.response : "");

      if (scenes.length >= 6) {
        return jsonResponse({ success: true, story: buildStory(scenes) });
      }

      return jsonResponse({ success: false, error: "कृपया पुन्हा प्रयत्न करा." }, 500);

    } catch (err) {
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  }
};
