#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

function loadEnv() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(dir, "../.env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const API_KEY = process.env.OPENROUTER_API_KEY;
const BASE_URL = "https://openrouter.ai/api/v1";
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
  "HTTP-Referer": "https://gascode.dev",
  "X-Title": "GasCode Media MCP",
};

function noKey() {
  return { content: [{ type: "text", text: "OPENROUTER_API_KEY not set." }], isError: true };
}

function apiErr(status, err) {
  return { content: [{ type: "text", text: `OpenRouter API error ${status}: ${err?.error?.message || JSON.stringify(err)}` }], isError: true };
}

function fileId() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${ts}-${crypto.randomBytes(3).toString("hex")}`;
}

// ─── Server ───

const server = new Server(
  { name: "gascode-media", version: "1.1.0" },
  { capabilities: { tools: {} } }
);

// ─── Tool definitions ───

const TOOLS = [
  {
    name: "generate_image",
    description: "Generate image from text prompt via OpenRouter (Gemini Flash Image, Recraft V4, GPT Image, Flux, etc). Saves to file.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text description of the image" },
        model: { type: "string", description: "Model ID (default: google/gemini-2.5-flash-image)" },
        aspect_ratio: { type: "string", description: "1:1, 16:9, 9:16, 4:3, 3:4" },
        quality: { type: "string", enum: ["auto", "low", "medium", "high"] },
        output_format: { type: "string", enum: ["png", "jpeg", "webp", "svg"], description: "Default: png" },
        output_dir: { type: "string", description: "Save directory (default: ./generated)" },
        n: { type: "number", description: "Number of images (1-10, default: 1)" },
        seed: { type: "number", description: "Seed for deterministic output" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "generate_video",
    description: "Generate video from text prompt via OpenRouter (Veo, etc). Async — polls until complete, downloads video file.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text description of the video" },
        model: { type: "string", description: "Model ID (default: google/veo-3.1)" },
        duration: { type: "number", description: "Duration in seconds" },
        aspect_ratio: { type: "string", description: "16:9, 9:16, 1:1, 4:3, 3:4" },
        resolution: { type: "string", description: "480p, 720p, 1080p, 2K, 4K" },
        generate_audio: { type: "boolean", description: "Generate audio track (default: false)" },
        output_dir: { type: "string", description: "Save directory (default: ./generated)" },
        seed: { type: "number", description: "Seed for deterministic output" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "text_to_speech",
    description: "Convert text to speech audio via OpenRouter TTS models (OpenAI, Mistral Voxtral, Fish Audio, Microsoft MAI-Voice). Saves audio file.",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string", description: "Text to convert to speech" },
        model: { type: "string", description: "TTS model (default: openai/gpt-4o-mini-tts)" },
        voice: { type: "string", description: "Voice ID, e.g. alloy, nova, shimmer, echo, onyx, coral, ash, sage, fable" },
        response_format: { type: "string", enum: ["mp3", "pcm"], description: "Audio format (default: mp3)" },
        speed: { type: "number", description: "Playback speed multiplier (OpenAI models only)" },
        output_dir: { type: "string", description: "Save directory (default: ./generated)" },
      },
      required: ["input"],
    },
  },
  {
    name: "list_image_models",
    description: "List available image generation models on OpenRouter",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_video_models",
    description: "List available video generation models on OpenRouter",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_tts_models",
    description: "List available TTS (text-to-speech) models on OpenRouter",
    inputSchema: { type: "object", properties: {} },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

// ─── Tool router ───

const handlers = {
  generate_image: handleGenerateImage,
  generate_video: handleGenerateVideo,
  text_to_speech: handleTTS,
  list_image_models: () => handleListModels("images"),
  list_video_models: () => handleListModels("videos"),
  list_tts_models: () => handleListModels("tts"),
};

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = handlers[name];
  if (!handler) return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  return handler(args);
});

// ─── Image generation ───

async function handleGenerateImage(args) {
  if (!API_KEY) return noKey();

  const body = { model: args.model || "google/gemini-2.5-flash-image", prompt: args.prompt };
  if (args.aspect_ratio) body.aspect_ratio = args.aspect_ratio;
  if (args.quality) body.quality = args.quality;
  if (args.output_format) body.output_format = args.output_format;
  if (args.n) body.n = Math.min(Math.max(1, args.n), 10);
  if (args.seed !== undefined) body.seed = args.seed;

  const res = await fetch(`${BASE_URL}/images`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });

  if (!res.ok) return apiErr(res.status, await res.json().catch(() => ({})));

  const data = await res.json();
  if (!data.data?.length) return { content: [{ type: "text", text: "No images returned." }], isError: true };

  const outDir = path.resolve(args.output_dir || "./generated");
  fs.mkdirSync(outDir, { recursive: true });

  const format = args.output_format || "png";
  const id = fileId();
  const saved = [];

  for (let i = 0; i < data.data.length; i++) {
    const suffix = data.data.length > 1 ? `-${i + 1}` : "";
    const filename = `img-${id}${suffix}.${format}`;
    const filepath = path.join(outDir, filename);
    fs.writeFileSync(filepath, Buffer.from(data.data[i].b64_json, "base64"));
    saved.push(filepath);
  }

  const usage = data.usage ? `\nTokens: ${data.usage.total_tokens} | Cost: $${data.usage.cost ?? "?"}` : "";

  const content = [{ type: "text", text: `Generated ${saved.length} image(s) with ${body.model}:\n${saved.join("\n")}${usage}` }];
  for (const fp of saved) {
    const mime = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml" }[format] || "image/png";
    content.push({ type: "image", data: fs.readFileSync(fp).toString("base64"), mimeType: mime });
  }
  return { content };
}

// ─── Video generation (async polling) ───

async function handleGenerateVideo(args) {
  if (!API_KEY) return noKey();

  const body = { model: args.model || "google/veo-3.1", prompt: args.prompt };
  if (args.duration) body.duration = args.duration;
  if (args.aspect_ratio) body.aspect_ratio = args.aspect_ratio;
  if (args.resolution) body.resolution = args.resolution;
  if (args.generate_audio !== undefined) body.generate_audio = args.generate_audio;
  if (args.seed !== undefined) body.seed = args.seed;

  const res = await fetch(`${BASE_URL}/videos`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });

  if (!res.ok) return apiErr(res.status, await res.json().catch(() => ({})));

  const job = await res.json();
  const jobId = job.id;
  if (!jobId) return { content: [{ type: "text", text: `Unexpected response: ${JSON.stringify(job)}` }], isError: true };

  const pollUrl = job.polling_url || `${BASE_URL}/videos/${jobId}`;
  const maxWait = 10 * 60 * 1000;
  const start = Date.now();
  let status = "pending";
  let result;

  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, 5000));

    const poll = await fetch(pollUrl, { headers: { Authorization: `Bearer ${API_KEY}` } });
    if (!poll.ok) continue;

    result = await poll.json();
    status = result.status;
    if (status === "completed" || status === "failed" || status === "cancelled" || status === "expired") break;
  }

  if (status !== "completed") {
    return { content: [{ type: "text", text: `Video generation ${status}. Job ID: ${jobId}${result?.error ? ` — ${result.error.message}` : ""}` }], isError: status !== "completed" };
  }

  const urls = result.unsigned_urls || result.data?.map((d) => d.url) || [];
  if (!urls.length) return { content: [{ type: "text", text: `Video completed but no download URLs. Job: ${jobId}` }], isError: true };

  const outDir = path.resolve(args.output_dir || "./generated");
  fs.mkdirSync(outDir, { recursive: true });

  const id = fileId();
  const saved = [];

  for (let i = 0; i < urls.length; i++) {
    const dlRes = await fetch(urls[i]);
    if (!dlRes.ok) continue;
    const buffer = Buffer.from(await dlRes.arrayBuffer());
    const suffix = urls.length > 1 ? `-${i + 1}` : "";
    const filename = `vid-${id}${suffix}.mp4`;
    const filepath = path.join(outDir, filename);
    fs.writeFileSync(filepath, buffer);
    saved.push({ path: filepath, size: `${(buffer.length / 1024 / 1024).toFixed(1)} MB` });
  }

  const usage = result.usage ? `\nCost: $${result.usage.cost ?? "?"}` : "";
  return {
    content: [{
      type: "text",
      text: `Video generated with ${body.model}:\n${saved.map((s) => `${s.path} (${s.size})`).join("\n")}${usage}`,
    }],
  };
}

// ─── TTS ───

async function handleTTS(args) {
  if (!API_KEY) return noKey();

  const body = { model: args.model || "openai/gpt-4o-mini-tts", input: args.input };
  if (args.voice) body.voice = args.voice;
  if (args.response_format) body.response_format = args.response_format;
  if (args.speed) body.speed = args.speed;

  const res = await fetch(`${BASE_URL}/audio/speech`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    return apiErr(res.status, err);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const outDir = path.resolve(args.output_dir || "./generated");
  fs.mkdirSync(outDir, { recursive: true });

  const ext = args.response_format === "pcm" ? "pcm" : "mp3";
  const filename = `tts-${fileId()}.${ext}`;
  const filepath = path.join(outDir, filename);
  fs.writeFileSync(filepath, buffer);

  const size = `${(buffer.length / 1024).toFixed(1)} KB`;
  return {
    content: [{
      type: "text",
      text: `Audio generated with ${body.model}:\n${filepath} (${size})\nVoice: ${body.voice || "default"} | Format: ${ext}`,
    }],
  };
}

// ─── List models ───

async function handleListModels(type) {
  if (!API_KEY) return noKey();

  let url;
  if (type === "images") url = `${BASE_URL}/images/models`;
  else if (type === "videos") url = `${BASE_URL}/videos/models`;
  else url = `${BASE_URL}/models?output_modalities=speech`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } });
  if (!res.ok) return { content: [{ type: "text", text: `Failed: ${res.status} ${res.statusText}` }], isError: true };

  const data = await res.json();
  const list = (data.data || data).map((m) => `- ${m.id}${m.name ? ` (${m.name})` : ""}`).join("\n");

  const labels = { images: "image generation", videos: "video generation", tts: "TTS (text-to-speech)" };
  return { content: [{ type: "text", text: `Available ${labels[type]} models:\n\n${list}` }] };
}

// ─── Start ───

const transport = new StdioServerTransport();
await server.connect(transport);
