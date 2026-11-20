const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Max-Age": "86400"
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

function cleanLine(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^["“”]+|["“”]+$/g, "")
    .trim();
}

/* =========================================
   LANGUAGE
========================================= */

function getLanguageRule(language) {

  if (language === "Hindi") {
    return `
TARGET LANGUAGE: HINDI

The final Voice must be natural, simple Hindi.
Translate the meaning into Hindi if the user's story is in another language.
Do NOT copy Marathi or English sentences into Voice.
Use Devanagari Hindi script.
`;
  }

  if (language === "English") {
    return `
TARGET LANGUAGE: ENGLISH

The final Voice must be natural, simple English.
Translate the meaning into English if the user's story is in another language.
Do NOT copy Marathi or Hindi sentences into Voice.
`;
  }

  return `
TARGET LANGUAGE: MARATHI

The final Voice must be natural, simple Marathi.
Translate the meaning into Marathi if the user's story is in another language.
Do NOT copy Hindi or English sentences into Voice.
Use natural Marathi grammar.
`;
}

/* =========================================
   STORY PROMPT
========================================= */

function createStoryPrompt(story, language) {

  return `
You are an expert children's cartoon screenwriter and animation director.

USER STORY:
${story}

${getLanguageRule(language)}

IMPORTANT:

The user's story is the source of truth.

DO NOT replace the user's story with a different story.

DO NOT invent unrelated events.

Keep the same main characters, animals, objects and important events from the user's story.

You may expand the story into 8 connected scenes, but the story must remain faithful to the user's idea.

Create EXACTLY 8 connected scenes.

CHARACTER CONSISTENCY IS EXTREMELY IMPORTANT.

First identify the important characters from the user's story.

For every important character, create a short CHARACTER LOCK description containing:
- character type
- age or size if known
- gender if clearly known
- body appearance
- face appearance
- hair or feathers
- clothing
- clothing colors
- important accessories
- important identifying features

If the story does not specify something, choose a simple appearance and KEEP IT EXACTLY THE SAME in all 8 scenes.

Do not change character clothes, colors, hairstyle, feathers, body type or face between scenes.

The same character must look like the same character in every image.

VISUAL RULE:

Visual must be written in ENGLISH.

Visual must describe the actual action happening in that scene.

Do NOT write generic filler such as:
"fun adventure"
"beautiful jungle"
"happy friends"
unless that is actually part of the scene.

Every Visual must include the relevant character names or character descriptions and the exact action.

VOICE RULE:

Voice must be exactly ONE short sentence.

Voice must be in ${language}.

Voice must describe or support the actual scene.

Do not repeat Voice sentences.

No title.
No explanation.
No markdown.
No code fences.

OUTPUT EXACTLY IN THIS FORMAT:

CHARACTER_LOCK:
Character 1: ...
Character 2: ...
Character 3: ...

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

OUTPUT ONLY CHARACTER_LOCK AND THE 8 SCENES.
`;
}

/* =========================================
   EXTRACT CHARACTER LOCK
========================================= */

function extractCharacterLock(text) {

  const cleaned = cleanText(text);

  const start =
    cleaned.search(/CHARACTER_LOCK\s*:/i);

  if (start < 0) {
    return "";
  }

  const after =
    cleaned.substring(start);

  const sceneStart =
    after.search(/SCENE\s*1\b/i);

  if (sceneStart < 0) {
    return "";
  }

  const lock =
    after.substring(0, sceneStart).trim();

  return lock
    .replace(/^CHARACTER_LOCK\s*:\s*/i, "")
    .trim();
}

/* =========================================
   EXTRACT SCENES
========================================= */

function extractScenes(text) {

  const cleaned =
    cleanText(text);

  const regex =
    /SCENE\s*([1-8])\s*[\r\n]+Visual\s*:\s*([\s\S]*?)[\r\n]+Voice\s*:\s*([\s\S]*?)(?=[\r\n]+SCENE\s*[1-8]\b|$)/gi;

  const scenes = [];

  let match;

  while (
    (match = regex.exec(cleaned)) !== null
  ) {

    const number =
      Number(match[1]);

    if (
      number < 1 ||
      number > 8
    ) {
      continue;
    }

    let visual =
      cleanLine(match[2]);

    let voice =
      cleanLine(match[3]);

    /*
      Remove accidental extra text
      after Voice.
    */

    voice =
      voice
        .replace(
          /\s+(CHARACTER_LOCK|SCENE)\s*.*$/i,
          ""
        )
        .trim();

    if (
      visual &&
      voice
    ) {

      scenes.push({
        number,
        visual,
        voice
      });

    }

  }

  /*
    Remove duplicate scenes.
  */

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

  for (
    let i = 0;
    i < 8;
    i++
  ) {

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
   IMAGE PROMPT
========================================= */

function createImagePrompt(
  visual,
  characterLock,
  style
) {

  const styleText =
    style === "2D Cartoon"
      ? "high quality 2D children's cartoon animation"
      : style === "Kids Cartoon"
        ? "bright colorful children's cartoon animation"
        : "high quality 3D children's cartoon animation";

  return `
Create ONE children's cartoon image.

IMPORTANT CHARACTER CONSISTENCY RULE:

The characters described below are LOCKED.

CHARACTER LOCK:
${characterLock || "Keep all characters exactly consistent with the previous scene."}

NEVER change:
- character identity
- face
- body shape
- age
- hairstyle
- hair color
- feather color
- clothing
- clothing colors
- accessories
- important identifying features

If the same character appears in another scene, it MUST look like the SAME character.

CURRENT SCENE:
${visual}

IMAGE STYLE:
${styleText}

Requirements:
- child friendly
- expressive characters
- clear character faces
- consistent character design
- detailed environment matching the scene
- cinematic composition
- good lighting
- vibrant colors
- high quality
- no text
- no subtitles
- no speech bubbles
- no watermark
- no random characters
- no unrelated objects
- do not change the story
- show exactly what the current scene describes

Create only the image.
`;
}

/* =========================================
   IMAGE GENERATION
========================================= */

async function generateImage(
  env,
  visual,
  characterLock,
  style
) {

  const prompt =
    createImagePrompt(
      visual,
      characterLock,
      style
    );

  /*
    IMPORTANT:
    No num_steps parameter.
    This avoids the previous
    Cloudflare schema error.
  */

  return await env.AI.run(
    "@cf/bytedance/stable-diffusion-xl-lightning",
    {
      prompt: prompt
    }
  );
}

/* =========================================
   STORY GENERATION
========================================= */

async function generateStory(
  env,
  prompt
) {

  return await env.AI.run(
    "@cf/meta/llama-3.1-8b-instruct-fast",
    {
      prompt: prompt,
      max_tokens: 1800,
      temperature: 0.15
    }
  );
}

/* =========================================
   FALLBACK STORY
========================================= */

function createFallbackScenes(
  story,
  language
) {

  const safeStory =
    cleanLine(story);

  let voices;

  if (language === "Hindi") {

    voices = [
      "आज हम इस कहानी की शुरुआत करते हैं।",
      "हम आगे बढ़ते हैं और नई चीज़ देखते हैं।",
      "यह अनुभव बहुत रोचक है।",
      "हम अपने दोस्तों के साथ आगे बढ़ते हैं।",
      "यह दृश्य हमें एक नई बात सिखाता है।",
      "हम मिलकर इस समस्या का हल खोजते हैं।",
      "अब हमें कहानी का महत्वपूर्ण सबक समझ आता है।",
      "इस कहानी से हमें हमेशा एक अच्छी सीख मिलती है।"
    ];

  } else if (language === "English") {

    voices = [
      "Our story begins with a wonderful adventure.",
      "We move forward and discover something new.",
      "This moment is very exciting.",
      "We continue the journey together.",
      "This scene teaches us something important.",
      "Together, we find a way forward.",
      "Now we understand the important lesson.",
      "This story gives us a wonderful lesson."
    ];

  } else {

    voices = [
      "आपली सुंदर गोष्ट आता सुरू होते.",
      "आपण पुढे जाताना एक नवीन गोष्ट पाहतो.",
      "हा क्षण खूपच रोमांचक आहे.",
      "आपण सगळे मिळून पुढे जातो.",
      "या प्रसंगातून आपल्याला एक महत्त्वाची गोष्ट शिकायला मिळते.",
      "आपण मिळून या समस्येचा मार्ग शोधतो.",
      "आता आपल्याला या गोष्टीचा महत्त्वाचा धडा समजतो.",
      "या गोष्टीतून आपल्याला एक सुंदर शिकवण मिळते."
    ];

  }

  const scenes = [];

  for (
    let i = 0;
    i < 8;
    i++
  ) {

    scenes.push({

      number:
        i + 1,

      visual:
        `Children's cartoon scene based directly on this user story: ${safeStory}. Scene ${i + 1} continues the same story and keeps all characters consistent.`,

      voice:
        voices[i]

    });

  }

  return scenes;
}

/* =========================================
   WORKER
========================================= */

export default {

  async fetch(
    request,
    env
  ) {

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

        success:
          true,

        status:
          "ok",

        message:
          "Apna Creator AI Backend is active and running!",

        storyModel:
          "@cf/meta/llama-3.1-8b-instruct-fast",

        imageModel:
          "@cf/bytedance/stable-diffusion-xl-lightning"

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
          success:
            false,

          error:
            "Method Not Allowed"
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

        const characterLock =
          String(
            data.characterLock || ""
          ).trim();

        const style =
          String(
            data.style ||
            "3D Cartoon"
          ).trim();

        if (!visual) {

          return jsonResponse(
            {
              success:
                false,

              error:
                "Visual description required"
            },
            400
          );

        }

        try {

          const image =
            await generateImage(
              env,
              visual,
              characterLock,
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

        } catch (imageError) {

          return jsonResponse(
            {
              success:
                false,

              error:
                "Image generation failed: " +
                (
                  imageError &&
                  imageError.message
                    ? imageError.message
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
            success:
              false,

            error:
              "Story is required"
          },
          400
        );

      }

      /* ===================================
         CREATE PROMPT
      =================================== */

      const prompt =
        createStoryPrompt(
          story,
          language
        );

      /* ===================================
         ATTEMPT 1
      =================================== */

      let result =
        await generateStory(
          env,
          prompt
        );

      let raw =
        result &&
        result.response
          ? result.response
          : "";

      let scenes =
        extractScenes(raw);

      let characterLock =
        extractCharacterLock(raw);

      /* ===================================
         ATTEMPT 2
      =================================== */

      if (
        !validateScenes(scenes)
      ) {

        const retryPrompt =
          prompt +
          `

CRITICAL RETRY:

Your previous response was invalid.

You MUST return:
1 CHARACTER_LOCK
AND
EXACTLY 8 SCENES.

The scene numbers MUST be:
1, 2, 3, 4, 5, 6, 7, 8.

Every scene MUST contain:
Visual:
Voice:

Every Voice MUST be in ${language}.

Visual MUST be in English.

Do not change the user's story.

Return nothing except CHARACTER_LOCK and the 8 scenes.
`;

        result =
          await generateStory(
            env,
            retryPrompt
          );

        raw =
          result &&
          result.response
            ? result.response
            : "";

        scenes =
          extractScenes(raw);

        characterLock =
          extractCharacterLock(raw);

      }

      /* ===================================
         ATTEMPT 3
      =================================== */

      if (
        !validateScenes(scenes)
      ) {

        const finalPrompt = `
You are a children's cartoon director.

USER STORY:
${story}

TARGET LANGUAGE:
${language}

Create exactly 8 scenes.

Keep the user's story and characters.

Create a CHARACTER_LOCK first.

Then create exactly:

SCENE 1
Visual: English
Voice: ${language}

SCENE 2
Visual: English
Voice: ${language}

SCENE 3
Visual: English
Voice: ${language}

SCENE 4
Visual: English
Voice: ${language}

SCENE 5
Visual: English
Voice: ${language}

SCENE 6
Visual: English
Voice: ${language}

SCENE 7
Visual: English
Voice: ${language}

SCENE 8
Visual: English
Voice: ${language}

Rules:
- exactly 8 scenes
- same characters throughout
- no unrelated story
- no repeated scenes
- no repeated Voice
- one short Voice sentence per scene
- Visual in English
- Voice only in ${language}
- no markdown
- no explanation
- no title
`;

        result =
          await generateStory(
            env,
            finalPrompt
          );

        raw =
          result &&
          result.response
            ? result.response
            : "";

        scenes =
          extractScenes(raw);

        characterLock =
          extractCharacterLock(raw);

      }

      /* ===================================
         FINAL VALIDATION
      =================================== */

      if (
        validateScenes(scenes)
      ) {

        return jsonResponse({

          success:
            true,

          language:
            language,

          duration:
            duration,

          style:
            style,

          characterLock:
            characterLock,

          story:
            buildStory(scenes)

        });

      }

      /* ===================================
         FALLBACK
      =================================== */

      const fallbackScenes =
        createFallbackScenes(
          story,
          language
        );

      return jsonResponse({

        success:
          true,

        language:
          language,

        duration:
          duration,

        style:
          style,

        characterLock:
          `Keep the exact characters from the user's original story consistent in every scene.`,

        story:
          buildStory(
            fallbackScenes
          ),

        note:
          "Automatic fallback was used because the AI did not return a valid 8-scene structure."

      });

    } catch (error) {

      console.error(
        "Worker error:",
        error
      );

      return jsonResponse(
        {
          success:
            false,

          error:
            error &&
            error.message
              ? error.message
              : "Server Error"
        },
        500
      );

    }

  }

};
