# GasCode Media MCP

**Generate images, video, and speech from any MCP client, through one OpenRouter key.**

![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-339933) ![MCP](https://img.shields.io/badge/Model_Context_Protocol-stdio-000) ![License: MIT](https://img.shields.io/badge/License-MIT-blue)

A small [Model Context Protocol](https://modelcontextprotocol.io) server that lets Claude Code, Claude Desktop, Cursor, or any other MCP client call OpenRouter's media models and save the results as files on disk. One dependency, one file, no build step.

## Tools

| Tool | What it does | Default model |
|---|---|---|
| `generate_image` | Text → image (PNG, JPEG, WebP, SVG), 1–10 at a time, with aspect ratio and seed | `google/gemini-2.5-flash-image` |
| `generate_video` | Text → video; polls the async job and downloads the MP4 | `google/veo-3.1` |
| `text_to_speech` | Text → MP3 or PCM with a chosen voice and speed | `openai/gpt-4o-mini-tts` |
| `list_image_models` | Lists image models available on OpenRouter | — |
| `list_video_models` | Lists video models available on OpenRouter | — |
| `list_tts_models` | Lists speech models available on OpenRouter | — |

Any model ID on OpenRouter can be passed in place of the default. Files are saved to `./generated` unless `output_dir` is set.

## Setup

```bash
git clone https://github.com/zullabs-id/gascode-image-mcp.git
cd gascode-image-mcp
npm install
cp .env.example .env   # then add your OpenRouter key
```

The key can also come from the `OPENROUTER_API_KEY` environment variable, which takes priority over `.env`.

### Claude Code

```bash
claude mcp add gascode-media -- node /absolute/path/to/gascode-image-mcp/src/index.js
```

### Claude Desktop, Cursor, and other clients

```json
{
  "mcpServers": {
    "gascode-media": {
      "command": "node",
      "args": ["/absolute/path/to/gascode-image-mcp/src/index.js"],
      "env": { "OPENROUTER_API_KEY": "sk-or-..." }
    }
  }
}
```

## Example prompts

- "Generate a 16:9 hero image of a lighthouse at dusk, three variations."
- "Make a 6-second 9:16 video of coffee being poured, with audio."
- "Read this paragraph aloud with the `nova` voice and save it as MP3."

## Costs

Generation is billed by OpenRouter to your own key at each model's listed price. Video models are the most expensive, so check the price with `list_video_models` before running them in bulk.

---

<sub>Built by [Zul Labs](https://zullabs.co.id) as part of GasCode. MIT licensed.</sub>
