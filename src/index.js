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
const DEFAULT_MODEL = "google/gemini-2.5-flash-image";

const server = new Server(
  { name: "gascode-image", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "generate_image",
      description:
        "Generate an image from a text prompt using OpenRouter AI models (Gemini Flash Image, Recraft V4, GPT Image, Flux, etc). Returns file path of saved image.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Text description of the image to generate",
          },
          model: {
            type: "string",
            description: `Model ID (default: ${DEFAULT_MODEL}). Use list_image_models to see available models.`,
          },
          aspect_ratio: {
            type: "string",
            description: "Aspect ratio: 1:1, 16:9, 9:16, 4:3, 3:4, 2:3, 3:2",
          },
          quality: {
            type: "string",
            enum: ["auto", "low", "medium", "high"],
            description: "Image quality (default: auto)",
          },
          output_format: {
            type: "string",
            enum: ["png", "jpeg", "webp", "svg"],
            description: "Output format (default: png)",
          },
          output_dir: {
            type: "string",
            description:
              "Directory to save the image. Defaults to ./generated in current working directory.",
          },
          n: {
            type: "number",
            description: "Number of images to generate (1-10, default: 1)",
          },
          seed: {
            type: "number",
            description: "Seed for deterministic output (optional)",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: "list_image_models",
      description:
        "List available image generation models on OpenRouter with their capabilities",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "generate_image") return handleGenerateImage(args);
  if (name === "list_image_models") return handleListModels();
  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
});

async function handleGenerateImage(args) {
  if (!API_KEY) {
    return {
      content: [{ type: "text", text: "OPENROUTER_API_KEY not set. Configure it in your MCP server environment." }],
      isError: true,
    };
  }

  const body = { model: args.model || DEFAULT_MODEL, prompt: args.prompt };
  if (args.aspect_ratio) body.aspect_ratio = args.aspect_ratio;
  if (args.quality) body.quality = args.quality;
  if (args.output_format) body.output_format = args.output_format;
  if (args.n) body.n = Math.min(Math.max(1, args.n), 10);
  if (args.seed !== undefined) body.seed = args.seed;

  const res = await fetch(`${BASE_URL}/images`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://gascode.dev",
      "X-Title": "GasCode Image MCP",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    return {
      content: [{ type: "text", text: `OpenRouter API error ${res.status}: ${err.error?.message || JSON.stringify(err)}` }],
      isError: true,
    };
  }

  const data = await res.json();
  if (!data.data?.length) {
    return {
      content: [{ type: "text", text: "No images returned from API." }],
      isError: true,
    };
  }

  const outDir = path.resolve(args.output_dir || "./generated");
  fs.mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const id = crypto.randomBytes(3).toString("hex");
  const format = args.output_format || "png";
  const saved = [];

  for (let i = 0; i < data.data.length; i++) {
    const item = data.data[i];
    const suffix = data.data.length > 1 ? `-${i + 1}` : "";
    const filename = `img-${timestamp}-${id}${suffix}.${format}`;
    const filepath = path.join(outDir, filename);
    fs.writeFileSync(filepath, Buffer.from(item.b64_json, "base64"));
    saved.push(filepath);
  }

  const usage = data.usage
    ? `\nTokens: ${data.usage.total_tokens} | Cost: $${data.usage.cost ?? "?"}`
    : "";

  const content = [
    {
      type: "text",
      text: `Generated ${saved.length} image(s) with ${body.model}:\n${saved.join("\n")}${usage}`,
    },
  ];

  for (const filepath of saved) {
    const mimeType = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml" }[format] || "image/png";
    content.push({
      type: "image",
      data: fs.readFileSync(filepath).toString("base64"),
      mimeType,
    });
  }

  return { content };
}

async function handleListModels() {
  if (!API_KEY) {
    return {
      content: [{ type: "text", text: "OPENROUTER_API_KEY not set." }],
      isError: true,
    };
  }

  const res = await fetch(`${BASE_URL}/images/models`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });

  if (!res.ok) {
    return {
      content: [{ type: "text", text: `Failed to fetch models: ${res.status} ${res.statusText}` }],
      isError: true,
    };
  }

  const data = await res.json();
  const models = (data.data || data)
    .map((m) => `- ${m.id}${m.name ? ` (${m.name})` : ""}`)
    .join("\n");

  return {
    content: [{ type: "text", text: `Available image generation models:\n\n${models}` }],
  };
}

const transport = new StdioServerTransport();
await server.connect(transport);
