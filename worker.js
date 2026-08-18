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
  let langInstruction = "";
  if (language === "Marathi") {
    langInstruction = "Voice must be in pure, natural MARATHI (मराठी शुद्ध वाक्यरचना). No Hindi or English words in Voice.";
  } else if (language === "Hindi") {
    langInstruction = "Voice must be in natural, conversational HINDI. No Marathi or English words in Voice.";
  } else {
    langInstruction = "Voice must be in fluent, child-friendly ENGLISH.";
  }

  return `You are an expert children's 3D animated cartoon director and scriptwriter.
Write an engaging 8-scene cartoon story based on the user's idea: "${story}"

RULES:
1. Provide exactly 8 sequentially connected scenes (SCENE 1 to SCENE 8) with a clear storyline and moral ending.
2. ${langInstruction}
3. Visual description MUST ALWAYS be in ENGLISH (so the 3D image generator understands it perfectly).
4. Each scene Voice must be 1 single, clear, expressive sentence. Do not repeat dialogue.
5. No titles, markdown headers, or explanations.

OUTPUT FORMAT:
SCENE 1
Visual: English description of 3D scene
Voice: Single dialogue line in target language

SCENE 2
Visual: English description of 3D scene
Voice: Single dialogue line in target language

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
  const prompt = `masterpiece, cute 3D Disney Pixar animated cartoon, vibrant lighting, expressive character, detailed 3D environment, 8k resolution, cinematic composition, ${visual}, no text, no watermark`;
  
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
      return jsonResponse({ success: true, message: "Apna Creator AI Backend is Active!" });
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
        temperature: 0.25
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
