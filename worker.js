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

/* =========================================
   TEXT CLEANING
========================================= */

function cleanText(text) {
  return String(text || "")
    .replace(/```json/gi, "")
    .replace(/```text/gi, "")
    .replace(/```/g, "")
    .replace(/\r/g, "")
    .trim();
}

/* =========================================
   VOICE CLEANUP
========================================= */

function cleanVoice(text) {

  let voice = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  voice = voice
    .replace(/Here is the output.*$/i, "")
    .replace(/I will make sure.*$/i, "")
    .replace(/Please let me know.*$/i, "")
    .replace(/\bSTOP\b.*$/i, "")
    .trim();

  const parts = voice
    .split(/(?<=[.!?।])\s+/)
    .map(x => x.trim())
    .filter(Boolean);

  const unique = [];

  for (const part of parts) {

    const normalized =
      part
        .replace(/^["“”]+|["“”]+$/g, "")
        .trim();

    if (!normalized) continue;

    if (
      !unique.some(
        x =>
          x.toLowerCase() ===
          normalized.toLowerCase()
      )
    ) {
      unique.push(normalized);
    }

    if (unique.length >= 2) {
      break;
    }
  }

  if (unique.length > 0) {
    voice = unique.join(" ");
  }

  if (voice.length > 220) {

    const shortParts =
      voice
        .split(/(?<=[.!?।])\s+/)
        .slice(0, 2);

    voice =
      shortParts.join(" ").slice(0, 220).trim();
  }

  return voice;
}

/* =========================================
   VISUAL CLEANUP
========================================= */

function cleanVisual(text) {

  let visual = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  visual = visual
    .replace(/^["“”]+|["“”]+$/g, "")
    .trim();

  return visual;
}

/* =========================================
   EXTRACT SCENES
========================================= */

function extractScenes(text) {

  const cleaned = cleanText(text);

  const regex =
    /SCENE\s*([1-8])\s*[\r\n]+Visual\s*:\s*([\s\S]*?)[\r\n]+Voice\s*:\s*([\s\S]*?)(?=[\r\n]+SCENE\s*[1-8]\b|$)/gi;

  const scenes = [];

  let match;

  while ((match = regex.exec(cleaned)) !== null) {

    const number =
      Number(match[1]);

    if (number < 1 || number > 8) {
      continue;
    }

    const visual =
      cleanVisual(match[2]);

    const voice =
      cleanVoice(match[3]);

    if (visual && voice) {

      scenes.push({
        number,
        visual,
        voice
      });

    }
  }

  const unique = [];

  for (const scene of scenes) {

    if (
      !unique.some(
        x => x.number === scene.number
      )
    ) {

      unique.push(scene);

    }

  }

  unique.sort(
    (a, b) =>
      a.number - b.number
  );

  return unique;
}

/* =========================================
   VALIDATE 8 SCENES
========================================= */

function validateScenes(scenes) {

  if (
    !Array.isArray(scenes) ||
    scenes.length !== 8
  ) {
    return false;
  }

  for (let i = 0; i < 8; i++) {

    if (
      !scenes[i] ||
      scenes[i].number !== i + 1 ||
      !scenes[i].visual ||
      !scenes[i].voice
    ) {

      return false;

    }

  }

  return true;
}

/* =========================================
   BUILD STORY
========================================= */

function buildStory(scenes) {

  return scenes
    .map(scene => {

      return (
        "SCENE " +
        scene.number +
        "\nVisual: " +
        cleanVisual(scene.visual) +
        "\nVoice: " +
        cleanVoice(scene.voice)
      );

    })
    .join("\n\n");
}

/* =========================================
   LANGUAGE
========================================= */

function languageInstruction(language) {

  if (language === "Marathi") {

    return `
OUTPUT LANGUAGE: MARATHI

Write everything in natural, simple Marathi.
Use Marathi for Visual and Voice.
Do not use Hindi.
Do not use English except unavoidable proper names.
Use language suitable for children.
`;

  }

  if (language === "Hindi") {

    return `
OUTPUT LANGUAGE: HINDI

Write everything in natural, simple Hindi.
Use Hindi for Visual and Voice.
Do not use Marathi.
Use language suitable for children.
`;

  }

  return `
OUTPUT LANGUAGE: ENGLISH

Write everything in natural, simple English.
Use English for Visual and Voice.
Use language suitable for children.
`;

}

/* =========================================
   STORY PROMPT
========================================= */

function createPrompt(
  story,
  language,
  duration,
  style
) {

  return `
You are an expert children's cartoon story writer.

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

1. Return EXACTLY 8 scenes.
2. Scene numbers must be 1,2,3,4,5,6,7,8.
3. Every scene must contain exactly ONE Visual.
4. Every scene must contain exactly ONE Voice.
5. Visual must be short and describe what is visible.
6. Voice must be SHORT.
7. Voice must contain only 1 or 2 natural sentences.
8. NEVER repeat the same sentence.
9. NEVER repeat a sentence multiple times.
10. Scene 8 Voice must also contain only 1 or 2 sentences.
11. Do not add a title.
12. Do not add explanation.
13. Do not add notes.
14. Do not add markdown.
15. Do not add code fences.
16. Do not write STOP.
17. Do not write anything after Scene 8 Voice.
18. Do not repeat any scene.
19. Keep the story simple and suitable for children.

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

OUTPUT ONLY THE 8 SCENES.
`;
}

/* =========================================
   AI STORY GENERATION
========================================= */

async function generateStory(
  env,
  prompt
) {

  return await env.AI.run(
    "@cf/meta/llama-3.1-8b-instruct-fast",
    {
      prompt: prompt,
      max_tokens: 1000,
      temperature: 0.15
    }
  );

}

/* =========================================
   IMAGE PROMPT
========================================= */

function createImagePrompt(
  visual,
  style
) {

  return `
Create a high-quality children's cartoon image.

SCENE:
${visual}

STYLE:
${style}

Requirements:
- colorful children's cartoon
- child friendly
- bright lighting
- expressive characters
- detailed background
- cinematic composition
- consistent cartoon appearance
- no text
- no subtitles
- no speech bubbles
- no watermark

Create only the image.
`;

}

/* =========================================
   IMAGE GENERATION
========================================= */

async function generateImage(
  env,
  visual,
  style
) {

  const prompt =
    createImagePrompt(
      visual,
      style
    );

  return await env.AI.run(
    "@cf/black-forest-labs/flux-1-schnell",
    {
      prompt: prompt,
      steps: 4
    }
  );

}

/* =========================================
   WORKER
========================================= */

export default {

  async fetch(request, env) {

    /* =====================================
       CORS
    ===================================== */

    if (
      request.method === "OPTIONS"
    ) {

      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });

    }

    /* =====================================
       GET TEST
    ===================================== */

    if (
      request.method === "GET"
    ) {

      return jsonResponse({

        success: true,

        status: "ok",

        message:
          "Apna Creator AI Backend is running!",

        storyModel:
          "@cf/meta/llama-3.1-8b-instruct-fast",

        imageModel:
          "@cf/black-forest-labs/flux-1-schnell"

      });

    }

    /* =====================================
       ONLY POST
    ===================================== */

    if (
      request.method !== "POST"
    ) {

      return jsonResponse(
        {
          success: false,
          error: "Method Not Allowed"
        },
        405
      );

    }

    try {

      const data =
        await request.json();

      /* ===================================
         IMAGE REQUEST
      =================================== */

      if (
        data.action ===
        "generate-image"
      ) {

        const visual =
          String(
            data.visual || ""
          ).trim();

        const style =
          String(
            data.style ||
            "3D Cartoon"
          ).trim();

        if (!visual) {

          return jsonResponse(
            {
              success: false,
              error:
                "Visual is required"
            },
            400
          );

        }

        try {

          const image =
            await generateImage(
              env,
              visual,
              style
            );

          return new Response(
            image,
            {
              status: 200,

              headers: {
                ...corsHeaders,

                "Content-Type":
                  "image/png",

                "Cache-Control":
                  "no-store"
              }
            }
          );

        } catch (error) {

          return jsonResponse(
            {
              success: false,

              error:
                "Image generation failed: " +
                (
                  error &&
                  error.message
                    ? error.message
                    : "Unknown image error"
                )
            },
            500
          );

        }

      }

      /* ===================================
         STORY REQUEST
      =================================== */

      const story =
        String(
          data.story || ""
        ).trim();

      const language =
        String(
          data.language ||
          "Hindi"
        ).trim();

      const duration =
        String(
          data.duration ||
          "1 Minute"
        ).trim();

      const style =
        String(
          data.style ||
          "3D Cartoon"
        ).trim();

      if (!story) {

        return jsonResponse(
          {
            success: false,
            error:
              "Story is required"
          },
          400
        );

      }

      /* ===================================
         ATTEMPT 1
      =================================== */

      const prompt =
        createPrompt(
          story,
          language,
          duration,
          style
        );

      let result =
        await generateStory(
          env,
          prompt
        );

      let scenes =
        extractScenes(
          result &&
          result.response
            ? result.response
            : ""
        );

      if (
        validateScenes(scenes)
      ) {

        return jsonResponse({

          success: true,

          language: language,

          story:
            buildStory(scenes)

        });

      }

      /* ===================================
         ATTEMPT 2
      =================================== */

      result =
        await generateStory(
          env,
          prompt +
          `

IMPORTANT:
The previous answer was invalid.

Generate exactly 8 scenes again.

Each Voice must contain ONLY ONE short sentence.

Never repeat any sentence.

Do not add anything before Scene 1.

Do not add anything after Scene 8 Voice.
`
        );

      scenes =
        extractScenes(
          result &&
          result.response
            ? result.response
            : ""
        );

      if (
        validateScenes(scenes)
      ) {

        return jsonResponse({

          success: true,

          language: language,

          story:
            buildStory(scenes)

        });

      }

      /* ===================================
         ATTEMPT 3
      =================================== */

      result =
        await generateStory(
          env,
          `
Create exactly 8 short children's cartoon scenes.

Story:
${story}

Language:
${language}

Rules:
- Exactly 8 scenes.
- One Visual per scene.
- One short Voice sentence per scene.
- No repeated sentences.
- No extra text.
- No title.
- No explanation.
- Scene 8 must finish the story.

Use exactly:

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

OUTPUT ONLY THESE 8 SCENES.
`
        );

      scenes =
        extractScenes(
          result &&
          result.response
            ? result.response
            : ""
        );

      if (
        validateScenes(scenes)
      ) {

        return jsonResponse({

          success: true,

          language: language,

          story:
            buildStory(scenes)

        });

      }

      /* ===================================
         BEST EFFORT
      =================================== */

      if (
        scenes.length === 8
      ) {

        scenes =
          scenes.map(
            scene => ({
              number:
                scene.number,

              visual:
                cleanVisual(
                  scene.visual
                ),

              voice:
                cleanVoice(
                  scene.voice
                )
            })
          );

        return jsonResponse({

          success: true,

          language: language,

          story:
            buildStory(scenes),

          note:
            "Story generated with automatic cleanup."

        });

      }

      /* ===================================
         FAILED
      =================================== */

      return jsonResponse(
        {
          success: false,

          error:
            "AI did not return 8 usable scenes. Please try again."
        },
        500
      );

    } catch (error) {

      return jsonResponse(
        {
          success: false,

          error:
            error &&
            error.message
              ? error.message
              : "Server error"
        },
        500
      );

    }

  }

};
````
