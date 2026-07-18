# Disco LLM API Documentation

## Overview

The Disco LLM API provides access to multiple AI language models and image generation capabilities through a unified interface. Direct OpenAI support is GPT-5-family only, with GPT-5.6 Luna as the default to keep implicit calls cost-conscious, alongside Deepseek, OpenRouter, and image generation with automatic cost tracking and conversation state management.

## Quick Start

```typescript
import { disco } from "@discomedia/utils";

// Basic text generation
const response = await disco.llm.call("Explain quantum computing");

// Image generation
const image = await disco.llm.images("A beautiful sunset over mountains");

// Deepseek API
const seekResponse = await disco.llm.seek("What is the capital of France?");

// OpenRouter API
const openResponse = await disco.llm.open("Explain quantum computing");
```

## Core Functions

### `disco.llm.call(input, options?)`

Main function for OpenAI text generation using the Responses API.

**Input:**

```typescript
input: string
options?: {
  apiKey?: string;
  model?: LLMModel;
  responseFormat?: OpenAIResponseFormat; // 'text' | 'json' | { type: 'json_schema', ... }
  schema?: OpenAISchemaInput; // JSON Schema object or Zod schema
  schemaName?: string; // defaults to 'response'
  schemaDescription?: string;
  schemaStrict?: boolean;
  tools?: Tool[];
  useCodeInterpreter?: boolean;
  useWebSearch?: boolean;
  image?: OpenAIImageInput;
  images?: OpenAIImageInput[];
  imageBase64?: string; // legacy single-image shortcut, still supported
  imageDetail?: 'low' | 'high' | 'auto' | 'original';
  context?: ContextMessage[];
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  reasoningMode?: 'standard' | 'pro';
  reasoningContext?: 'auto' | 'current_turn' | 'all_turns';
}
```

`OpenAIImageInput` accepts one of these shapes:

```typescript
type OpenAIImageInput =
  | { url: string; detail?: "low" | "high" | "auto" | "original" }
  | { dataUrl: string; detail?: "low" | "high" | "auto" | "original" }
  | {
      base64: string;
      mimeType?: string;
      detail?: "low" | "high" | "auto" | "original";
    }
  | { fileId: string; detail?: "low" | "high" | "auto" | "original" }
  | {
      filePath: string;
      filename?: string;
      mimeType?: string;
      detail?: "low" | "high" | "auto" | "original";
    };
```

Local `filePath` uploads are intended for Node.js/server usage. In browser code, use a remote URL, a data URL, raw base64, or a pre-uploaded `fileId`.

**Output:**

```typescript
{
  response: T;
  usage: LLMUsage;
  tool_calls?: ChatCompletionMessageToolCall[];
  code_interpreter_outputs?: ResponseCodeInterpreterToolCall['outputs'];
}
```

**Usage:**

```typescript
// Basic text response
const response = await disco.llm.call("What is TypeScript?");

// JSON response
const data = await disco.llm.call("List 3 programming languages", {
  responseFormat: "json",
});

// Zod schema response (preferred for structured outputs)
import { z } from "zod";
const profileSchema = z.object({
  name: z.string(),
  age: z.number(),
  interests: z.array(z.string()),
});
const profile = await disco.llm.call("Create a sample user profile", {
  schema: profileSchema,
  schemaName: "user_profile",
});

// With conversation context
const contextResponse = await disco.llm.call("What did I ask about earlier?", {
  context: [
    { role: "user", content: "What is React?" },
    { role: "assistant", content: "React is a JavaScript library..." },
  ],
});

// With image analysis
const imageResponse = await disco.llm.call("Describe this image", {
  image: {
    base64: "base64-encoded-image-data",
    mimeType: "image/png",
  },
  imageDetail: "high",
});

// With an image URL
const urlVisionResponse = await disco.llm.call("What is in this image?", {
  image: {
    url: "https://openai-documentation.vercel.app/images/cat_and_otter.png",
    detail: "low",
  },
});

// With multiple images in a single prompt
const compareResponse = await disco.llm.call("Compare these two images.", {
  images: [
    { url: "https://example.com/before.png" },
    { fileId: "file_abc123", detail: "original" },
  ],
});

// With a local file path in Node.js
const fileVisionResponse = await disco.llm.call("Summarize this screenshot.", {
  image: {
    filePath: "/absolute/path/to/screenshot.png",
    detail: "original",
  },
});

// With web search
const webResponse = await disco.llm.call("Latest AI news", {
  useWebSearch: true,
});

// With code interpreter
const codeResponse = await disco.llm.call("Create a chart of sales data", {
  useCodeInterpreter: true,
});
```

If you want to upload a local file once and reuse it across multiple prompts, use `disco.llm.uploadVisionFile` to get a `fileId` first:

```typescript
const fileId = await disco.llm.uploadVisionFile(
  "/absolute/path/to/invoice.jpg",
);

const result = await disco.llm.call("Extract the invoice date.", {
  image: {
    fileId,
    detail: "high",
  },
});
```

`imageBase64` remains available for backward compatibility, but new code should prefer `image` or `images` because they also support URLs, `fileId`, and local files.

### `disco.llm.images(prompt, options?)`

Generate images using OpenAI's image generation API.

**Input:**

```typescript
prompt: string
options?: {
  model?: OpenAIImageModel; // defaults to 'gpt-image-2'
  size?: ImageGenerateParams['size']; // gpt-image-2 supports valid WIDTHxHEIGHT strings
  outputFormat?: 'jpeg' | 'png' | 'webp';
  compression?: number;
  quality?: 'auto' | 'low' | 'medium' | 'high';
  count?: number;
  background?: 'auto' | 'transparent' | 'opaque';
  moderation?: 'auto' | 'low';
  apiKey?: string;
  visionModel?: LLMModel; // e.g., 'gpt-5.6-terra' to pair with a reasoning follow-up
}
```

`gpt-image-2` is the default model when none is provided, giving you the latest GPT Image quality without extra configuration. The exported `OPENAI_IMAGE_MODELS` list and `OpenAIImageModel` type mirror the text-model exports.

`gpt-image-2` supports custom valid `WIDTHxHEIGHT` sizes, but it does not support `background: 'transparent'`; use `auto` or `opaque` with the default model.

Image cost tracking estimates output-image cost from the current OpenAI guide for common GPT Image sizes. For `auto` or custom `gpt-image-2` dimensions, the helper falls back to the default estimate of `high` quality at `1024x1024`; text prompt tokens and edit input image tokens are not included in this estimate.

**Common GPT Image output estimates (USD per image)**

| Model            | Quality | 1024x1024 | 1024x1536 | 1536x1024 |
| ---------------- | ------- | --------- | --------- | --------- |
| gpt-image-2      | low     | $0.006    | $0.005    | $0.005    |
| gpt-image-2      | medium  | $0.053    | $0.041    | $0.041    |
| gpt-image-2      | high    | $0.211    | $0.165    | $0.165    |
| gpt-image-1.5    | low     | $0.009    | $0.013    | $0.013    |
| gpt-image-1.5    | medium  | $0.034    | $0.050    | $0.050    |
| gpt-image-1.5    | high    | $0.133    | $0.200    | $0.200    |
| gpt-image-1      | low     | $0.011    | $0.016    | $0.016    |
| gpt-image-1      | medium  | $0.042    | $0.063    | $0.063    |
| gpt-image-1      | high    | $0.167    | $0.250    | $0.250    |
| gpt-image-1-mini | low     | $0.005    | $0.006    | $0.006    |
| gpt-image-1-mini | medium  | $0.011    | $0.015    | $0.015    |
| gpt-image-1-mini | high    | $0.036    | $0.052    | $0.052    |

**Output:**

```typescript
{
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
  usage: {
    provider: string;
    model: string;
    cost: number;
    visionModel?: LLMModel;
  };
}
```

**Usage:**

```typescript
// Basic image generation
const image = await disco.llm.images("A futuristic cityscape");

// Multiple images with custom options
const images = await disco.llm.images("A birthday cake", {
  size: "1024x1024",
  outputFormat: "png",
  quality: "high",
  count: 3,
});

// High compression for web
const webImage = await disco.llm.images("Logo design", {
  outputFormat: "webp",
  compression: 80,
});

// Opt into a different model explicitly
const dalleImage = await disco.llm.images(
  "Editorial illustration of a skyline",
  {
    model: "dall-e-3",
  },
);

// Request a common GPT Image 2 size
const square = await disco.llm.images("Editorial product photo on white", {
  model: "gpt-image-2",
  size: "1024x1024",
  quality: "medium",
});

// Pair with a multimodal reasoning model (GPT-5.6 series)
const blueprint = await disco.llm.images("Blueprint for a tiny house", {
  visionModel: "gpt-5.6-terra",
});
console.log(blueprint.usage?.visionModel); // 'gpt-5.6-terra'
```

### `disco.llm.seek(content, responseFormat?, options?)`

Call Deepseek AI models for cost-effective text generation.

**Input:**

```typescript
content: string | ChatCompletionContentPart[]
responseFormat?: 'text' | 'json'
options?: LLMOptions
```

**Output:**

```typescript
{
  response: T;
  usage: LLMUsage;
  tool_calls?: ChatCompletionMessageToolCall[];
}
```

**Usage:**

```typescript
// Basic Deepseek call
const response = await disco.llm.seek("Explain machine learning");

// JSON response
const data = await disco.llm.seek("List programming concepts", "json");

// With reasoning model
const reasoning = await disco.llm.seek(
  "Solve this math problem step by step",
  "text",
  {
    model: "deepseek-reasoner",
  },
);

// With context
const contextual = await disco.llm.seek("Continue our discussion", "text", {
  context: [
    { role: "user", content: "What is AI?" },
    { role: "assistant", content: "AI stands for..." },
  ],
});
```

### `disco.llm.open(input, options?)`

Call OpenRouter API for access to multiple model providers including OpenAI, Google, Deepseek, and Z.ai models through a unified interface.

**Input:**

```typescript
input: string
options?: {
  apiKey?: string;
  model?: OpenRouterModel | string;
  responseFormat?: 'text' | 'json' | OpenAIResponseFormat;
  tools?: ChatCompletionTool[];
  toolChoice?: ToolChoice;
  context?: ContextMessage[];
  developerPrompt?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  seed?: number;
  referer?: string;
  title?: string;
}
```

**Output:**

```typescript
{
  response: T;
  usage: LLMUsage;
  tool_calls?: ChatCompletionMessageToolCall[];
}
```

**Usage:**

```typescript
// Basic OpenRouter call
const response = await disco.llm.open("Explain machine learning");

// With specific model
const modelResponse = await disco.llm.open("Explain AI", {
  model: "openai/gpt-5.5",
});

// With Google model
const googleResponse = await disco.llm.open("Explain quantum computing", {
  model: "google/gemini-2.5-flash",
});

// With custom headers
const customResponse = await disco.llm.open("Hello", {
  referer: "https://myapp.com",
  title: "My App",
});

// JSON response
const data = await disco.llm.open("List 3 colors", {
  responseFormat: "json",
});

// With tools
const toolsResponse = await disco.llm.open("Get weather", {
  tools: [weatherTool],
  toolChoice: "auto",
});
```

## Models & Capabilities

### OpenAI Models

- **gpt-5.6**: Alias for GPT-5.6 Sol, the flagship GPT-5.6 tier
- **gpt-5.6-sol**: Frontier GPT-5.6 model for complex professional work, coding, research, and advanced agentic workflows
- **gpt-5.6-terra**: Strong everyday balance of intelligence, latency, and cost
- **gpt-5.6-luna**: Default model; cost-sensitive GPT-5.6 tier for fast, high-volume workloads
- **gpt-5**: Next-gen model with advanced reasoning
- **gpt-5.1**: Drop-in GPT-5 upgrade tuned for Responses API
- **gpt-5.4**: Previous frontier GPT-5 model for complex reasoning, agentic workflows, and multimodal tasks
- **gpt-5.5**: Latest frontier GPT-5 model for complex professional work, coding, tool-heavy agents, and long-context retrieval
- **gpt-5.5-pro**: High-compute GPT-5.5 variant for tougher prompts that need more precision
- **gpt-5.2**: Previous frontier GPT-5 model with configurable reasoning effort
- **gpt-5.2-pro**: High-compute GPT-5.2 variant for very difficult prompts
- **gpt-5-mini**: Cost-effective version of GPT-5
- **gpt-5.4-mini**: Cost-effective version of GPT-5.4
- **gpt-5.4-nano**: Cheapest GPT-5.4-class model for simple high-volume tasks
- **gpt-5-nano**: Ultra-low cost, basic tasks
- **gpt-5.1-codex**: Optimized for interactive coding flows inside Codex CLI
- **gpt-5.1-codex-max**: Highest-capability coding model with support for xhigh reasoning

**GPT-5.x Pricing (per 1M tokens, standard tier)**

Source: [OpenAI API pricing](https://platform.openai.com/docs/pricing) and [GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/latest-model), checked 2026-07-10. GPT-5.6 cache writes are billed at 1.25x the uncached input rate.

| Model                                      | Input  | Cached Input | Output  |
| ------------------------------------------ | ------ | ------------ | ------- |
| gpt-5.6 / gpt-5.6-sol (<272K input tokens) | $5.00  | $0.50        | $30.00  |
| gpt-5.6-terra (<272K input tokens)         | $2.50  | $0.25        | $15.00  |
| gpt-5.6-luna (<272K input tokens)          | $1.00  | $0.10        | $6.00   |
| gpt-5.5 (<272K input tokens)               | $5.00  | $0.50        | $30.00  |
| gpt-5.5-pro                                | $30.00 | -            | $180.00 |
| gpt-5.4 (<272K input tokens)               | $2.50  | $0.25        | $15.00  |
| gpt-5.4-mini                               | $0.75  | $0.075       | $4.50   |
| gpt-5.4-nano                               | $0.20  | $0.02        | $1.25   |
| gpt-5.2                                    | $1.75  | $0.175       | $14.00  |
| gpt-5.2-pro                                | $21.00 | -            | $168.00 |
| gpt-5.1-codex                              | $1.25  | $0.125       | $10.00  |
| gpt-5.1-codex-max                          | $1.25  | $0.125       | $10.00  |

### Deepseek Models

- **deepseek-chat**: General purpose, supports tools/JSON
- **deepseek-reasoner**: Specialized for reasoning tasks

### OpenRouter Models

- **openai/gpt-5**: Next-gen OpenAI model via OpenRouter
- **openai/gpt-5-mini**: Cost-effective GPT-5 via OpenRouter
- **openai/gpt-5.4-mini**: Cost-effective GPT-5.4 via OpenRouter
- **openai/gpt-5.4-nano**: Cheapest GPT-5.4-class model via OpenRouter
- **openai/gpt-5-nano**: Ultra-low cost GPT-5 via OpenRouter
- **openai/gpt-5.4**: GPT-5.4 flagship via OpenRouter
- **openai/gpt-5.4-pro**: Highest-precision GPT-5.4 variant via OpenRouter
- **openai/gpt-5.5**: Latest GPT-5.5 frontier model via OpenRouter
- **openai/gpt-5.5-pro**: High-compute GPT-5.5 variant via OpenRouter
- **openai/gpt-5.2**: GPT-5.2 flagship via OpenRouter for complex reasoning
- **openai/gpt-5.2-pro**: Highest quality GPT-5.2 variant via OpenRouter
- **openai/gpt-5.1-codex**: Coding-oriented GPT-5.1 via OpenRouter
- **openai/gpt-5.1-codex-max**: Maximum-strength Codex model via OpenRouter
- **openai/gpt-oss-120b**: Open source 120B parameter model
- **z.ai/glm-4.5**: Z.ai's GLM-4.5 model
- **z.ai/glm-4.5-air**: Z.ai's GLM-4.5 Air model
- **google/gemini-2.5-flash**: Google's Gemini 2.5 Flash model
- **google/gemini-2.5-flash-lite**: Lightweight Gemini 2.5 Flash
- **deepseek/deepseek-r1-0528**: Deepseek R1 model via OpenRouter
- **deepseek/deepseek-chat-v3-0324**: Deepseek Chat v3 model via OpenRouter

### Model Features

```typescript
// Direct OpenAI support is GPT-5-family only.
import { supportsTemperature } from "@discomedia/utils";

const hasTemp = supportsTemperature("gpt-5.6-terra"); // false
```

Pre-GPT-5 direct OpenAI model IDs such as `gpt-4o`, `gpt-4.1`, `o1`, `o3`, and `o4-mini` are deprecated. They fail TypeScript checks and runtime validation instead of being aliased.

#### GPT-5.6 reasoning controls

- All GPT-5.6 models support `reasoningEffort`: `'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`. OpenAI defaults GPT-5.6 to `medium`; reserve `max` for the hardest quality-first workloads.
- Set `reasoningMode: 'pro'` when a difficult quality-first request justifies additional latency and token usage; it is an execution mode, not a separate model ID. `reasoningContext` supports `'auto' | 'current_turn' | 'all_turns'` for multi-turn reasoning reuse.
- GPT-5.6 accepts text and image inputs, supports the Responses and Chat Completions APIs, and supports structured outputs, function calling, file search, web search, and prompt caching.
- `gpt-5.6` is an alias for `gpt-5.6-sol`; use an explicit Sol, Terra, or Luna ID when you need a fixed capability/cost tier.
- The wrapper treats GPT-5 models as reasoning-style models for API constraints: it does not send `temperature`, and it avoids forcing built-in `tool_choice` for web search or code interpreter.
- `gpt-5.4-nano` is available through Chat Completions and Responses. OpenAI describes it as optimized for simple high-volume tasks where speed and cost matter most; it supports compaction, but not tool search or computer use.
- GPT-5.6 models, `gpt-5.5`, and `gpt-5.4` use high-context pricing for prompts above 272K input tokens. Pricing shifts to 2x input and 1.5x output for the entire request.
- Responses API can now pass concise reasoning summaries plus compaction metadata, making it easier to resume long agentic tasks.

#### Verbosity options

- Keep `text.verbosity` at `medium` for balanced answers, or move to `high` for detailed walk-throughs. `low` compresses answers for quick SQL/code snippets.

#### Coding-specialized GPT-5.1 Codex models

- `gpt-5.1-codex` focuses on interactive coding in Codex/Codex-like shells.
- `gpt-5.1-codex-max` adds the `xhigh` reasoning level, structured outputs, and native compaction for very long coding sessions.

## Built-in Tools

### Web Search

```typescript
const response = await disco.llm.call("Current weather in Tokyo", {
  useWebSearch: true,
});
```

### Code Interpreter

```typescript
const response = await disco.llm.call("Plot a sine wave", {
  useCodeInterpreter: true,
});
// Access code outputs
console.log(response.code_interpreter_outputs);
```

### Custom Tools

```typescript
const tools = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string" },
        },
      },
    },
  },
];

const response = await disco.llm.call("Weather in Paris", { tools });
```

## Conversation Context

### Context Messages

```typescript
interface ContextMessage {
  role: "user" | "assistant" | "system" | "developer";
  content: string;
}
```

### Multi-turn Conversations

```typescript
const conversation: ContextMessage[] = [
  { role: "user", content: "What is React?" },
  { role: "assistant", content: "React is a JavaScript library..." },
  { role: "user", content: "What about Vue?" },
  { role: "assistant", content: "Vue is another JavaScript framework..." },
];

const response = await disco.llm.call("Compare them", {
  context: conversation,
});
```

## Response Formats

### Text Response

```typescript
const response = await disco.llm.call("Explain AI");
console.log(response.response); // string
```

### JSON Response

```typescript
const response = await disco.llm.call("List 3 colors", {
  responseFormat: "json",
});
console.log(response.response); // parsed JSON object
```

### Structured JSON (OpenAI only)

```typescript
const response = await disco.llm.call("Create user profile", {
  responseFormat: {
    type: "json_schema",
    name: "user_profile",
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        interests: { type: "array", items: { type: "string" } },
      },
      required: ["name", "age"],
    },
  },
});
```

### Structured JSON With Zod (OpenAI only)

```typescript
import { z } from "zod";

const userSchema = z.object({
  name: z.string(),
  age: z.number(),
  interests: z.array(z.string()),
});

const response = await disco.llm.call("Create user profile", {
  schema: userSchema,
  schemaName: "user_profile",
  schemaDescription: "A basic user profile object",
});
```

## Usage & Cost Tracking

### Usage Information

```typescript
const response = await disco.llm.call("Hello world");
console.log(response.usage);
/*
{
  prompt_tokens: 12,
  completion_tokens: 8,
  reasoning_tokens: 0,
  provider: 'openai',
  model: 'gpt-5.6-terra',
  cost: 0.000123
}
*/
```

### Cost Optimization

```typescript
// Use cost-effective models for simple tasks
const simple = await disco.llm.call("Say hello", { model: "gpt-5.6-luna" });

// Use Deepseek for budget-friendly alternatives
const budget = await disco.llm.seek("Explain concepts");

// Use higher-capability GPT-5 models for difficult prompts
const complex = await disco.llm.call("Solve complex problem", {
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
});
```

## Error Handling

```typescript
try {
  const response = await disco.llm.call("Hello");
} catch (error) {
  if (error.message.includes("API key")) {
    console.error("Check your API key configuration");
  } else if (error.message.includes("model")) {
    console.error("Unsupported model specified");
  } else {
    console.error("API call failed:", error.message);
  }
}
```

## Environment Setup

```bash
# Required environment variables
OPENAI_API_KEY=your-openai-key
DEEPSEEK_API_KEY=your-deepseek-key
```

## Types

### Core Types

```typescript
interface LLMResponse<T> {
  response: T;
  usage: LLMUsage;
  tool_calls?: ChatCompletionMessageToolCall[];
}

interface LLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens?: number;
  provider: string;
  model: LLMModel;
  cost: number;
}

type LLMModel = OpenAIModel | DeepseekModel | OpenRouterModel;
export const OPENAI_MODELS = [
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5-nano",
  "gpt-5.1",
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.2",
  "gpt-5.2-pro",
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
] as const;
const OPENAI_IMAGE_MODELS = [
  "gpt-image-2",
  "gpt-image-2-2026-04-21",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
  "chatgpt-image-latest",
  "dall-e-2",
  "dall-e-3",
] as const;
type OpenAIImageModel = (typeof OPENAI_IMAGE_MODELS)[number];
type OpenAIModel =
  | "gpt-5.6"
  | "gpt-5.6-sol"
  | "gpt-5.6-terra"
  | "gpt-5.6-luna"
  | "gpt-5"
  | "gpt-5-mini"
  | "gpt-5.4-mini"
  | "gpt-5.4-nano"
  | "gpt-5-nano"
  | "gpt-5.1"
  | "gpt-5.4"
  | "gpt-5.5"
  | "gpt-5.5-pro"
  | "gpt-5.2"
  | "gpt-5.2-pro"
  | "gpt-5.1-codex"
  | "gpt-5.1-codex-max";
type DeepseekModel = "deepseek-chat" | "deepseek-reasoner";
type OpenRouterModel =
  | "openai/gpt-5"
  | "openai/gpt-5-mini"
  | "openai/gpt-5.4-mini"
  | "openai/gpt-5.4-nano"
  | "openai/gpt-5-nano"
  | "openai/gpt-5.1"
  | "openai/gpt-5.4"
  | "openai/gpt-5.4-pro"
  | "openai/gpt-5.5"
  | "openai/gpt-5.5-pro"
  | "openai/gpt-5.2"
  | "openai/gpt-5.2-pro"
  | "openai/gpt-5.1-codex"
  | "openai/gpt-5.1-codex-max"
  | "openai/gpt-oss-120b"
  | "z.ai/glm-4.5"
  | "z.ai/glm-4.5-air"
  | "google/gemini-2.5-flash"
  | "google/gemini-2.5-flash-lite"
  | "deepseek/deepseek-r1-0528"
  | "deepseek/deepseek-chat-v3-0324";

interface OpenRouterCallOptions {
  apiKey?: string;
  model?: OpenRouterModel | string;
  responseFormat?: "text" | "json" | OpenAIResponseFormat;
  tools?: ChatCompletionTool[];
  toolChoice?: ToolChoice;
  context?: ContextMessage[];
  developerPrompt?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  seed?: number;
  referer?: string;
  title?: string;
}
```
