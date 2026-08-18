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
   TEXT CLEAN
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
   LINE CLEAN
========================================= */

function cleanLine(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^["“”]+|["“”]+$/g, "")
    .trim();
}

/* =========================================
   EXTRACT 8 SCENES
========================================= */

function extractScenes(text) {

  const cleaned = cleanText(text);

  const regex =
    /SCENE\s*([1-8])\s*[\r\n]+Visual\s*:\s*([\s\S]*?)[\r\n]+Voice\s*:\s*([\s\S]*?)(?=[\r\n]+SCENE\s*[1-8]\b|$)/gi;

  const scenes = [];

  let match;

  while ((match = regex.exec(cleaned)) !== null) {

    const number = Number(match[1]);

    if (number < 1 || number > 8) {
      continue;
    }

    const visual =
      cleanLine(match[2]);

    const voice =
      cleanLine(match[3]);

    if (visual && voice) {

      scenes.push({
        number,
        visual,
        voice
      });

    }

  }

  /* Remove duplicate scene numbers */

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
        cleanLine(scene.visual) +
        "\nVoice: " +
        cleanLine(scene.voice)
      );

    })
    .join("\n\n");
}

/* =========================================
   LANGUAGE
========================================= */

function createLanguageInstruction(language) {

  if (language === "Marathi") {

    return `
OUTPUT LANGUAGE: MARATHI

Voice must be written in natural, simple Marathi.
Do not use Hindi or unnecessary English words.
Use language suitable for children.
`;

  }

  if (language === "Hindi") {

    return `
OUTPUT LANGUAGE: HINDI

Voice must be written in natural, simple Hindi.
Do not use Marathi or unnecessary English words.
Use language suitable for children.
`;

  }

  return `
OUTPUT LANGUAGE: ENGLISH

Voice must be written in simple, child-friendly English.
`;

}

/* =========================================
   STORY PROMPT
========================================= */

function createStoryPrompt(
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

DURATION:
${duration}

CARTOON STYLE:
${style}

${createLanguageInstruction(language)}

Create exactly 8 connected scenes.

IMPORTANT RULES:

1. Return EXACTLY 8 scenes.
2. Scene numbers must be 1 through 8.
3. Every scene must contain exactly one Visual.
4. Every scene must contain exactly one Voice.
5. Visual must ALWAYS be written in ENGLISH.
6. Visual must clearly describe what should appear in the cartoon image.
7. Voice must be in the selected language.
8. Voice must contain exactly ONE short sentence.
9. Do not repeat sentences.
10. Do not repeat scenes.
11. Keep the story simple and interesting for children.
12. Scene 8 must properly finish the story.
13. Do not add a title.
14. Do not add explanation.
15. Do not add markdown.
16. Do not add code fences.
17. Do not add anything before Scene 1.
18. Do not add anything after Scene 8 Voice.

Use EXACTLY this format:

SCENE 1
Visual: English visual description
Voice: One short sentence

SCENE 2
Visual: English visual description
Voice: One short sentence

SCENE 3
Visual: English visual description
Voice: One short sentence

SCENE 4
Visual: English visual description
Voice: One short sentence

SCENE 5
Visual: English visual description
Voice: One short sentence

SCENE 6
Visual: English visual description
Voice: One short sentence

SCENE 7
Visual: English visual description
Voice: One short sentence

SCENE 8
Visual: English visual description
Voice: One short sentence

OUTPUT ONLY THE 8 SCENES.
`;

}

/* =========================================
   STORY AI
========================================= */

async function generateStory(
  env,
  prompt
) {

  return await env.AI.run(
    "@cf/meta/llama-3.1-8b-instruct-fast",
    {
      prompt: prompt,
      max_tokens: 1200,
      temperature: 0.2
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
Create a high-quality children's cartoon illustration.

Scene description:
${visual}

Cartoon style:
${style}

Requirements:

- cute 3D animated cartoon
- colorful
- bright lighting
- child friendly
- expressive characters
- detailed environment
- cinematic composition
- beautiful background
- consistent cartoon appearance
- clear main subject
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

  /*
    IMPORTANT:
    num_steps intentionally removed.

    The previous Worker was returning:
    Additional or unevaluated properties
    '/num_steps' at '/' not allowed

    Therefore we only send the required
    prompt parameter.
  */

  return await env.AI.run(
    "@cf/bytedance/stable-diffusion-xl-lightning",
    {
      prompt: prompt
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

      return new Response(
        null,
        {
          status: 204,
          headers: corsHeaders
        }
      );

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
          "@cf/bytedance/stable-diffusion-xl-lightning"

      });

    }

    /* =====================================
       POST ONLY
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

        }
        catch (error) {

          console.error(
            "IMAGE ERROR:",
            error
          );

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
          "Marathi"
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
        createStoryPrompt(
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

          language:
            language,

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

IMPORTANT CORRECTION:

Your previous response was invalid.

Generate the complete story again.

You MUST return exactly 8 scenes.

Scene numbers:
1, 2, 3, 4, 5, 6, 7, 8

Each scene must have:
Visual:
Voice:

Each Voice must contain exactly one short sentence.

Do not repeat sentences.

Do not add any extra text.
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

          language:
            language,

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
Create exactly 8 connected children's
cartoon scenes.

USER STORY:
${story}

LANGUAGE:
${language}

STYLE:
${style}

IMPORTANT:

- Exactly 8 scenes.
- Scene 1 to Scene 8.
- Visual must be in English.
- Voice must be in ${language}.
- One short Voice sentence per scene.
- No repeated sentences.
- No extra text.
- No title.
- No explanation.
- Scene 8 must finish the story.

FORMAT:

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

          language:
            language,

          story:
            buildStory(scenes)

        });

      }

      /* ===================================
         FAILED
      =================================== */

      return jsonResponse(
        {
          success: false,

          error:
            "AI could not create exactly 8 usable scenes. Please try again."
        },
        500
      );

    }
    catch (error) {

      console.error(
        "WORKER ERROR:",
        error
      );

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
