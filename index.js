import express from "express";
import formidable from "formidable";
import dotenv from "dotenv";
import cors from "cors";
import { BatchClient } from "@speechmatics/batch-client";
import { openAsBlob } from "node:fs";
import fs from "fs/promises";

dotenv.config();

const myconfigs = {
  apiKeys: [
    process.env.SPEECHMATICS_API_KEY_S_FOM_SOFTTEC,
    process.env.SPEECHMATICS_API_KEY_SVI,
    process.env.SPEECHMATICS_API_KEY_SL_V_F,
    process.env.SPEECHMATICS_API_KEY_FO_SKOD,
    process.env.SPEECHMATICS_API_KEY_SLA_28,
    process.env.SPEECHMATICS_API_KEY_ARS_IV,
    process.env.SPEECHMATICS_API_KEY_TEMP_1,
    process.env.SPEECHMATICS_API_KEY_TEMP_2,
  ],
  appIds: [
    "my-app",
    "fdEGjdsfjh",
    "com.example.meet-ai-analyzer",
    "app-prod-eu-001",
    "NewApplication",
    "user_1234567890abcdef",
    "app-test-1",
    "app_myproject_20250529",
    "APP-XYZ-001",
    "App_2025_05_29",
  ],
  operatingPoints: ["standard", "enhanced"] // 2h for "standard" | and 2h for "enhanced"
}

function getRandomInt(max) {
  return Math.floor(Math.random() * max);
}

function getRandomConfig(excludeSet) {
  const total = myconfigs.apiKeys.length * myconfigs.operatingPoints.length;
  if (excludeSet.size >= total) return null; // все варианты перебраны

  while (true) {
    const apiKeyIndex = getRandomInt(myconfigs.apiKeys.length);
    const operatingPointIndex = getRandomInt(myconfigs.operatingPoints.length);
    const key = `${apiKeyIndex}_${operatingPointIndex}`;
    if (!excludeSet.has(key)) {
      return {
        apiKeyIndex,
        apiKey: myconfigs.apiKeys[apiKeyIndex],
        appId: myconfigs.appIds[apiKeyIndex],
        operating_point: myconfigs.operatingPoints[operatingPointIndex],
        key
      };
    }
  }
}


const app = express();
app.use(cors({
  origin: [
    "http://localhost:3001",
    "http://localhost:3000",
    "https://meet-ai-analyzer.vercel.app"
  ],
  credentials: true
}));

const PORT = process.env.PORT || 3000;

app.post("/upload", (req, res) => {
  const form = formidable();

  const transcribe = async (audioFile, apiKey, appId, operating_point, lang) => {
    const transcription_config = {
      language: lang,
      diarization: "speaker",
      enable_entities: true,
      operating_point
    };
    const client = new BatchClient({ apiKey, appId });
    const response = await client.transcribe(audioFile, { transcription_config });
    if (response.code >= 400) {
      throw new Error(response.detail || "Speechmatics error");
    }
    const result = await client.getJobResult(response.job.id, 'text');
    return result;
  };

  form.parse(req, async (err, fields, files) => {
    let audioFile = files.data_file;
    if (Array.isArray(audioFile)) audioFile = audioFile[0];
    if (!audioFile) {
      res.status(400).json({ error: "No audio file uploaded" });
      return;
    }
    const filePath = audioFile.filepath || audioFile.path;
    if (!filePath) {
      res.status(400).json({ error: "No file path in uploaded file" });
      return;
    }

    try {
      const lang = Array.isArray(fields.lang) ? fields.lang[0] : (fields.lang || "ru");
      const blob = await openAsBlob(filePath);
      const file = new File([blob], audioFile.originalFilename, { type: audioFile.mimetype });

      const triedCombos = new Set();
      let lastError = null;
      let success = false;

      for (let attempt = 0; attempt < 5; attempt++) {
        console.log('===>> attempt:', attempt)
        const config = getRandomConfig(triedCombos);
        console.log('===>> config:', config)
        if (!config) break; // все варианты перебраны

        try {
          const result = await transcribe(file, config.apiKey, config.appId, config.operating_point, lang);
          res.status(200).json({ transcript: result });
          success = true;
          break;
        } catch (e) {
          console.log('===>> e:', e)
          lastError = e;
          // Если ошибка лимита — пробуем другой вариант, иначе прерываем
          if (
            e.name === 'SpeechmaticsResponseError' &&
            (e.response?.error === 'Forbidden' ||
            e.response?.detail?.includes('limit'))
          ) {
            triedCombos.add(config.key);
            console.log('===>> limit error, config.key:', config.key)
            console.log('===>> triedCombos:', triedCombos)
            continue;
          } else {
            break;
          }
        }
      }

      if (!success) {
        res.status(500).json({ error: `All attempts failed. Last error: ${lastError}` });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    } finally {
      try { await fs.unlink(filePath); } catch {}
    }
  });
});

app.get("/", (req, res) => {
  res.send("Speechmatics proxy is running!");
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});